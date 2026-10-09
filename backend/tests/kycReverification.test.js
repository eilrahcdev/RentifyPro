import test from "node:test";
import assert from "node:assert/strict";
import KycVerification from "../models/KycVerification.js";
import PreKycDocument from "../models/PreKycDocument.js";
import User from "../models/User.js";
import { startFaceReverification, recordFaceReverification, reconcileFaceReverification,
  cancelFaceReverification, getFaceReverificationAttempt, reverificationFaceKey, publicReverification } from "../services/kycReverification.service.js";
import kycRouter from "../routes/kyc.routes.js";

const userId = "507f1f77bcf86cd799439011";
const attemptId = "a156e9ce-b146-4c3e-a4b6-57aa67f29226";
const profile = { full_name: "Test Renter", date_of_birth: "2000-01-01" };

function fixture(t, { documentStatus = "verified", detailsMatched = true, userStatus = "approved" } = {}) {
  const verifiedAt = new Date("2026-08-25T00:00:00Z");
  const kyc = { _id: "case", user: userId, status: "approved", verifiedAt, updatedAt: verifiedAt, faceReverification: {
    attemptId, status: "id_uploaded", documentHash: "bound-id", profileSnapshot: profile,
    createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000),
  } };
  const document = { status: documentStatus, detailsMatched, expiresAt: new Date(Date.now() + 3_600_000) };
  const user = { _id: userId, role: "user", name: profile.full_name, dateOfBirth: profile.date_of_birth, kycStatus: userStatus };
  const writes = [];
  const matches = (filter) => Object.entries(filter).every(([key, expected]) => {
    const actual = key.split(".").reduce((obj, part) => obj?.[part], kyc);
    if (expected?.$in) return expected.$in.includes(actual);
    if (expected?.$gt) return actual > expected.$gt;
    return String(actual) === String(expected);
  });
  const apply = (update) => {
    for (const [key, value] of Object.entries(update.$set)) {
      const parts = key.split(".");
      const last = parts.pop();
      parts.reduce((obj, part) => obj[part], kyc)[last] = value;
    }
  };
  t.mock.method(KycVerification, "findOne", async (filter) => matches(filter) ? kyc : null);
  t.mock.method(KycVerification, "updateOne", async (filter, update, options) => {
    if (!matches(filter)) return { matchedCount: 0 };
    writes.push({ filter, update, options }); apply(update); return { matchedCount: 1 };
  });
  t.mock.method(KycVerification, "findOneAndUpdate", async (filter, update, options) => {
    if (!matches(filter)) return null;
    writes.push({ filter, update, options }); apply(update); return kyc;
  });
  t.mock.method(PreKycDocument, "findOne", async (filter) => {
    assert.equal(filter.sessionId, `reverify:${userId}:${kyc.faceReverification.attemptId}`);
    assert.equal(filter.fileHash, kyc.faceReverification.documentHash);
    return document;
  });
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  t.mock.method(User, "updateOne", async () => { throw new Error("Voluntary reverification must not change authorization"); });
  return { kyc, user, document, writes, verifiedAt };
}

test("starting reverification retains approval and uses an isolated temporary face key", async (t) => {
  const { kyc, user, verifiedAt, writes } = fixture(t);
  const result = await startFaceReverification(user, "new-id", profile);
  assert.match(result.sessionId, /^reverify:/);
  assert.match(reverificationFaceKey(result.attemptId), /^pre:reverify:/);
  assert.equal(kyc.status, "approved");
  assert.equal(kyc.verifiedAt, verifiedAt);
  assert.equal(kyc.updatedAt, verifiedAt);
  assert.equal(writes[0].options.timestamps, false);
});

test("a matched selfie completes only after matching document approval", async (t) => {
  const { kyc, writes, verifiedAt } = fixture(t);
  await recordFaceReverification(userId, attemptId, { verified: true, confidence: 91 });
  assert.equal(kyc.faceReverification.status, "approved");
  assert.ok(kyc.lastFaceReverifiedAt);
  assert.equal(kyc.verifiedAt, verifiedAt);
  assert.equal(kyc.status, "approved");
  assert.ok(writes.every((write) => write.options.timestamps === false));
});

test("a matched selfie stays pending until private document review finishes", async (t) => {
  const { kyc, document } = fixture(t, { documentStatus: "pending_review" });
  await recordFaceReverification(userId, attemptId, { verified: true, confidence: 91 });
  assert.equal(kyc.faceReverification.status, "selfie_matched");
  assert.equal(kyc.lastFaceReverifiedAt, undefined);
  document.status = "verified";
  await reconcileFaceReverification(userId);
  assert.equal(kyc.faceReverification.status, "approved");
});

test("face failure or document rejection retains the existing identity approval", async (t) => {
  const { kyc } = fixture(t, { documentStatus: "rejected" });
  await recordFaceReverification(userId, attemptId, { verified: false, confidence: 12 });
  assert.equal(kyc.faceReverification.status, "rejected");
  assert.equal(kyc.status, "approved");
  await recordFaceReverification(userId, attemptId, { verified: true, confidence: 91 });
  assert.equal(kyc.faceReverification.status, "rejected");
  assert.equal(kyc.lastFaceReverifiedAt, undefined);
  assert.equal(kyc.status, "approved");
});

test("unmatched document details and a newer user restriction cannot complete reverification", async (t) => {
  const { kyc, document, user } = fixture(t, { detailsMatched: false });
  await recordFaceReverification(userId, attemptId, { verified: true, confidence: 91 });
  assert.equal(kyc.lastFaceReverifiedAt, undefined);
  document.detailsMatched = true;
  user.kycStatus = "not_started";
  await reconcileFaceReverification(userId);
  assert.equal(kyc.lastFaceReverifiedAt, undefined);
  user.kycStatus = "approved";
  user.name = "Changed Identity";
  await reconcileFaceReverification(userId);
  assert.equal(kyc.faceReverification.status, "rejected");
});

test("owner reverification preserves the existing name-only policy when no birth date was collected", async (t) => {
  const { user, kyc } = fixture(t);
  user.role = "owner";
  user.dateOfBirth = undefined;
  kyc.faceReverification.profileSnapshot = { full_name: profile.full_name };
  await recordFaceReverification(userId, attemptId, { verified: true, confidence: 91 });
  assert.equal(kyc.faceReverification.status, "approved");
});

test("cancelled, expired, and replaced attempts cannot accept a delayed successful selfie", async (t) => {
  const { kyc } = fixture(t);
  await cancelFaceReverification(userId, attemptId);
  await assert.rejects(recordFaceReverification(userId, attemptId, { verified: true }), { status: 409 });
  kyc.faceReverification.status = "id_uploaded";
  kyc.faceReverification.expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(recordFaceReverification(userId, attemptId, { verified: true }), { status: 409 });
  kyc.faceReverification.expiresAt = new Date(Date.now() + 1000);
  kyc.faceReverification.attemptId = "b156e9ce-b146-4c3e-a4b6-57aa67f29226";
  await assert.rejects(recordFaceReverification(userId, attemptId, { verified: true }), { status: 409 });
  assert.equal(kyc.status, "approved");
  assert.equal(kyc.lastFaceReverifiedAt, undefined);
});

test("attempt queries reject operator injection and another account's attempt", async (t) => {
  fixture(t);
  await assert.rejects(getFaceReverificationAttempt(userId, { $ne: null }), { status: 409 });
  await assert.rejects(getFaceReverificationAttempt("507f1f77bcf86cd799439012", attemptId), { status: 409 });
});

test("the public attempt exposes no identity snapshot or face score", () => {
  assert.deepEqual(publicReverification({ faceReverification: {
    attemptId, status: "selfie_matched", expiresAt: new Date(0), profileSnapshot: profile, faceMatchScore: 92,
  } }), { attemptId, status: "expired", completedAt: null });
});

test("reverification upload and selfie routes require authentication, rate limiting, and approved identity", () => {
  for (const path of ["/reverify/id-register", "/reverify/selfie/verify"]) {
    const route = kycRouter.stack.find((layer) => layer.route?.path === path).route;
    assert.deepEqual(route.stack.map((layer) => layer.handle.name).filter(Boolean), ["protect", "requireKyc", path.endsWith("id-register") ? "registerReverificationId" : "verifyReverificationSelfie"]);
    assert.equal(route.stack.length, 4);
  }
});
