import test from "node:test";
import assert from "node:assert/strict";
import PreKycDocument from "../models/PreKycDocument.js";
import KycVerification from "../models/KycVerification.js";
import User from "../models/User.js";
import adminRouter from "../routes/admin.routes.js";
import mongoose from "mongoose";
import { reconcileUserKyc, reviewKycDocument } from "../services/kycReview.service.js";

const userId = "507f1f77bcf86cd799439011";
const docId = "507f1f77bcf86cd799439012";
const adminId = "507f1f77bcf86cd799439013";
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

function fixture(t, { facePassed = true, documentStatus = "pending_review", sessionId = `user:${userId}`, caseStatus, syncPending = false, detailsMatched = true, reasonCode = "REVIEW_REQUIRED" } = {}) {
  const document = { _id: docId, sessionId, docType: "id", role: "user", email: "applicant@example.test", fileHash: "current-id", status: documentStatus, detailsMatched, reasonCode };
  const kyc = { _id: "case", user: userId, status: caseStatus || (facePassed ? "challenge_passed" : "id_uploaded"), idDocumentHash: "current-id", challengePassedAt: facePassed ? new Date() : null, updatedAt: new Date(), summarySyncPending: syncPending };
  const writes = [];
  t.mock.method(PreKycDocument, "findOneAndUpdate", async (filter, update) => {
    if (!filter.status.$in.includes(document.status) || (filter.fileHash && filter.fileHash !== document.fileHash)) return null;
    Object.assign(document, update.$set); return { ...document };
  });
  t.mock.method(PreKycDocument, "findById", async () => ({ ...document }));
  t.mock.method(PreKycDocument, "findOne", async () => sessionId === `user:${userId}` ? { ...document } : null);
  t.mock.method(KycVerification, "findOne", async () => ({ ...kyc }));
  t.mock.method(KycVerification, "findOneAndUpdate", async (_filter, update) => { Object.assign(kyc, update.$set, { updatedAt: new Date() }); return { ...kyc }; });
  t.mock.method(KycVerification, "updateOne", async (_filter, update) => { Object.assign(kyc, update.$set); return { modifiedCount: 1 }; });
  t.mock.method(User, "updateOne", async (filter, update) => { writes.push({ filter, update }); return { modifiedCount: 1 }; });
  return { document, kyc, writes };
}

test("the actual admin Documents endpoint approves a completed selfie and synchronizes access", async (t) => {
  const { document, kyc, writes } = fixture(t);
  const originalDb = mongoose.connection.db;
  mongoose.connection.db = { collection: () => ({ findOne: async () => ({ name: "Applicant", email: document.email, role: "user" }) }) };
  t.after(() => { mongoose.connection.db = originalDb; });
  const route = adminRouter.stack.find((layer) => layer.route?.path === "/documents/:id" && layer.route.methods.patch).route;
  const res = response();
  await route.stack.at(-1).handle({ params: { id: docId }, body: { approval: "Approved", reviewVersion: "current-id" }, user: { _id: adminId } }, res, (error) => { throw error; });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.document.approval, "Approved");
  assert.equal(kyc.status, "approved");
  assert.equal(writes.at(-1).update.$set.kycStatus, "approved");
  assert.equal(document.reviewedBy, adminId);
});

test("document approval alone does not bypass the selfie requirement; a later selfie completes it", async (t) => {
  const { kyc, writes } = fixture(t, { facePassed: false });
  await reviewKycDocument({ id: docId, action: "approve", reviewerId: adminId });
  assert.equal(kyc.status, "id_uploaded");
  assert.equal(writes.length, 0);
  kyc.status = "challenge_passed"; kyc.challengePassedAt = new Date();
  await reconcileUserKyc(userId);
  assert.equal(kyc.status, "approved");
});

test("rejection requires correction instructions and is visible to the applicant", async (t) => {
  const { kyc } = fixture(t);
  await assert.rejects(reviewKycDocument({ id: docId, action: "reject", reviewerId: adminId }), { status: 400 });
  await reviewKycDocument({ id: docId, action: "reject", reviewerId: adminId, remarks: "The name is unreadable. Upload a clearer photo." });
  assert.equal(kyc.status, "rejected");
  assert.match(kyc.remarks, /Upload a clearer photo/);
});

test("documents cannot be approved before automated screening reaches manual review", async (t) => {
  const { document } = fixture(t, { documentStatus: "processing" });
  await assert.rejects(
    reviewKycDocument({ id: docId, action: "approve", reviewerId: adminId }),
    (error) => error?.status === 409 && /not finished/i.test(error.message),
  );
  assert.equal(document.status, "processing");
});

test("an unresolved identity mismatch cannot be manually approved", async (t) => {
  const { document } = fixture(t, { detailsMatched: false, reasonCode: "IDENTITY_DATA_MISMATCH" });
  await assert.rejects(
    reviewKycDocument({ id: docId, action: "approve", reviewerId: adminId }),
    (error) => error?.status === 409 && /cannot be approved/i.test(error.message),
  );
  assert.equal(document.status, "pending_review");
  await reviewKycDocument({
    id: docId,
    action: "reject",
    reviewerId: adminId,
    remarks: "The ID details do not match the registration. Upload the matching ID.",
  });
  assert.equal(document.status, "rejected");
});

test("a saved decision can recover from a failed user update without changing the decision", async (t) => {
  const { document, kyc } = fixture(t);
  let attempts = 0;
  t.mock.method(User, "updateOne", async () => { if (++attempts === 1) throw new Error("temporary write failure"); return { modifiedCount: 1 }; });
  await assert.rejects(reviewKycDocument({ id: docId, action: "approve", reviewerId: adminId }), /temporary/);
  assert.equal(document.status, "verified");
  assert.equal(kyc.summarySyncPending, true);
  await reconcileUserKyc(userId);
  assert.equal(attempts, 2);
  assert.equal(kyc.summarySyncPending, false);
});

test("opposing repeated decisions and replacement documents require a fresh review", async (t) => {
  const { document } = fixture(t);
  await reviewKycDocument({ id: docId, action: "approve", reviewerId: adminId });
  await assert.rejects(reviewKycDocument({ id: docId, action: "reject", remarks: "Upload a clear ID photo.", reviewerId: adminId }), { status: 409 });
  document.status = "pending_review"; document.fileHash = "replacement";
  await assert.rejects(reviewKycDocument({ id: docId, action: "approve", reviewVersion: "current-id", reviewerId: adminId }), { status: 409 });
  assert.equal(document.status, "pending_review");
});

test("same-file rescreening after corrected details invalidates the old admin review", async (t) => {
  const { document } = fixture(t);
  document.reviewVersion = "new-screening";
  await assert.rejects(
    reviewKycDocument({ id: docId, action: "approve", reviewVersion: "old-screening", reviewerId: adminId }),
    { status: 409 },
  );
  assert.equal(document.status, "pending_review");
  await reviewKycDocument({ id: docId, action: "approve", reviewVersion: "new-screening", reviewerId: adminId });
  assert.equal(document.status, "verified");
});

test("pre-registration decisions and unchanged legacy cases do not overwrite an existing account", async (t) => {
  const { writes } = fixture(t, { sessionId: "signed-registration-attempt", caseStatus: "approved" });
  await reviewKycDocument({ id: docId, action: "approve", reviewerId: adminId });
  await reconcileUserKyc(userId);
  assert.equal(writes.length, 0);
});

test("a failed face match cannot be promoted by an approved document", async (t) => {
  const { kyc, writes } = fixture(t, { facePassed: false, caseStatus: "rejected", documentStatus: "verified" });
  await reconcileUserKyc(userId);
  assert.equal(kyc.status, "rejected");
  assert.equal(writes.length, 0);
});

test("a verified status without a passed identity comparison cannot approve an account", async (t) => {
  const { kyc, writes } = fixture(t, { documentStatus: "verified", detailsMatched: false });
  await reconcileUserKyc(userId);
  assert.equal(kyc.status, "challenge_passed");
  assert.equal(writes.length, 0);
});
