import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { reconcileAdminAccountDocuments } from "../services/privateKycReview.service.js";

function fixture(role = "owner") {
  const user = { _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"), role, kycStatus: "challenge_passed" };
  const kyc = { _id: "case", user: user._id, status: "challenge_passed", updatedAt: new Date(), challengePassedAt: new Date(),
    registrationSessionId: "registration", registrationDocumentVersions: { id: "id-v1", ...(role === "owner" ? { supporting: "business-v1" } : {}) }, idDocumentHash: "id-hash" };
  const docs = ["id", ...(role === "owner" ? ["supporting"] : [])].map(docType => ({ docType, registeredUser: user._id,
    sessionId: "registration", reviewVersion: docType === "id" ? "id-v1" : "business-v1", fileHash: docType === "id" ? "id-hash" : "business-hash",
    detailsMatched: true, status: docType === "id" ? "verified" : "pending_review" }));
  const match = (object, filter) => Object.entries(filter).every(([key, value]) => key === "$or" || String(object[key]) === String(value));
  const database = { collection: name => ({
    findOne: async filter => name === "users" ? user : name === "kyc_cases" ? kyc : docs.find(doc => match(doc, filter)) || null,
    updateOne: async (filter, update) => { const object = name === "users" ? user : kyc; if (!match(object, filter)) return { modifiedCount: 0 };
      Object.assign(object, update.$set); return { modifiedCount: 1 }; },
  }) };
  return { user, kyc, docs, database };
}
test("Super Admin approval waits for every current owner document and preserves independent selfie proof", async () => {
  const { user, kyc, docs, database } = fixture(); const selfie = kyc.challengePassedAt;
  await reconcileAdminAccountDocuments(database, docs[0]); assert.equal(user.kycStatus, "challenge_passed");
  docs[1].status = "verified"; await reconcileAdminAccountDocuments(database, docs[1]);
  assert.equal(user.kycStatus, "approved"); assert.equal(kyc.challengePassedAt, selfie);
  docs[1].status = "rejected"; docs[1].reason = "Replace the unreadable permit.";
  await reconcileAdminAccountDocuments(database, docs[1]); assert.equal(user.kycStatus, "rejected");
  assert.equal(docs[0].status, "verified"); assert.equal(kyc.challengePassedAt, selfie);
  docs[1].status = "pending_review"; docs[1].reviewVersion = "business-v2";
  kyc.registrationDocumentVersions.supporting = "business-v2";
  await reconcileAdminAccountDocuments(database, docs[1]); assert.equal(user.kycStatus, "challenge_passed");
  docs[1].status = "verified"; await reconcileAdminAccountDocuments(database, docs[1]); assert.equal(user.kycStatus, "approved");
});
test("Super Admin cannot promote a replaced ID, missing required documents, or an unverified face", async () => {
  for (const mutation of [state => { state.docs[0].reviewVersion = "replacement"; }, state => { state.docs.splice(1); }, state => { state.kyc.challengePassedAt = null; },
    state => { state.kyc.identityUploadAttemptId = "interrupted-setup"; state.kyc.idRegisteredAt = null; },
    state => { state.user.registrationDraftId = "draft"; state.kyc.registrationDocumentVersions = {}; }]) {
    const state = fixture(); state.docs[1].status = "verified"; mutation(state);
    await reconcileAdminAccountDocuments(state.database, state.docs[0]); assert.notEqual(state.user.kycStatus, "approved");
  }
});
test("Super Admin renter reconciliation supports linked registration and authenticated correction sessions", async () => {
  const state = fixture("user"); await reconcileAdminAccountDocuments(state.database, state.docs[0]); assert.equal(state.user.kycStatus, "approved");
  state.docs[0].sessionId = `user:${state.user._id}`; state.docs[0].reviewVersion = "corrected-id";
  state.kyc.registrationIdentitySessionId = state.docs[0].sessionId; state.kyc.registrationDocumentVersions.id = "corrected-id";
  state.kyc.status = "challenge_passed"; state.user.kycStatus = "challenge_passed";
  await reconcileAdminAccountDocuments(state.database, state.docs[0]); assert.equal(state.user.kycStatus, "approved");
});

test("Super Admin document decisions cannot undo a newer account reverification restriction", async () => {
  const state = fixture("user"); state.user.kycStatus = "not_started";
  await reconcileAdminAccountDocuments(state.database, state.docs[0]); assert.equal(state.user.kycStatus, "not_started");
});

test("approving an unlinked registration cannot activate a customer with a different pending ID", async () => {
  const state = fixture("user");
  state.docs[0].status = "pending_review";
  await reconcileAdminAccountDocuments(state.database, { ...state.docs[0], registeredUser: null, sessionId: "other-registration", status: "verified" });
  assert.equal(state.user.kycStatus, "challenge_passed");
  assert.equal(state.docs[0].status, "pending_review");
  state.docs[0].status = "verified";
  await reconcileAdminAccountDocuments(state.database, state.docs[0]);
  assert.equal(state.user.kycStatus, "approved");
  assert.equal(state.kyc.status, "approved");
});
