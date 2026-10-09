import test from "node:test";
import assert from "node:assert/strict";
import User from "../models/User.js";
import KycVerification from "../models/KycVerification.js";
import { repairLegacyKycSummary } from "../services/kycSummary.service.js";
import { reconcileUserKyc } from "../services/kycReview.service.js";
import PreKycDocument from "../models/PreKycDocument.js";
import { publicKycStatus } from "../utils/publicKycStatus.js";
import { getNotificationSettings, updateNotificationSettings } from "../controllers/auth.controller.js";

const verifiedAt = new Date("2026-08-25T16:49:11.832Z");
const userId = "507f1f77bcf86cd799439011";
const approved = { user: userId, status: "approved", verifiedAt, updatedAt: new Date("2026-10-09T00:00:00Z"), remarks: "Face verified with 92.5% confidence.", faceMatchScore: 92.5 };

test("a migrated renter summary is repaired using the approval date, not the latest case edit", async (t) => {
  const user = { _id: userId, role: "user", kycStatus: "not_started" };
  let writes = 0;
  t.mock.method(User, "updateOne", async (filter, update) => {
    writes++;
    assert.equal(filter.kycStatus, "not_started");
    assert.equal(filter.$or.at(-1).kycStatusUpdatedAt.$lt, verifiedAt);
    assert.equal(update.$set.kycStatusUpdatedAt, verifiedAt);
    return { matchedCount: 1 };
  });
  assert.equal(await repairLegacyKycSummary(user, approved), true);
  assert.equal(user.kycStatus, "approved");
  assert.equal(writes, 1);
});

test("older approvals never undo newer revocation, rejection, or an active verification attempt", async (t) => {
  t.mock.method(User, "updateOne", async () => { throw new Error("Must not restore access"); });
  for (const status of ["rejected", "id_uploaded", "challenge_passed"]) {
    assert.equal(await repairLegacyKycSummary({ _id: userId, role: "user", kycStatus: status }, approved), false);
  }
  for (const when of [verifiedAt, new Date("2026-09-01T00:00:00Z")]) {
    assert.equal(await repairLegacyKycSummary({ _id: userId, role: "user", kycStatus: "not_started", kycStatusUpdatedAt: when }, approved), false);
  }
});

test("a lost conditional repair does not mark the in-memory user approved", async (t) => {
  t.mock.method(User, "updateOne", async () => ({ matchedCount: 0 }));
  const user = { _id: userId, role: "user", kycStatus: "not_started" };
  assert.equal(await repairLegacyKycSummary(user, approved), false);
  assert.equal(user.kycStatus, "not_started");
});

test("legacy approved cases without a pending sync marker still repair the renter summary", async (t) => {
  const user = { _id: userId, role: "user", kycStatus: "not_started" };
  t.mock.method(KycVerification, "findOne", async () => approved);
  t.mock.method(PreKycDocument, "findOne", async () => null);
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  t.mock.method(User, "updateOne", async () => ({ matchedCount: 1 }));
  assert.equal((await reconcileUserKyc(userId)).status, "approved");
  assert.equal(user.kycStatus, "approved");
});

test("applicant status omits technical scores and legacy confidence remarks", () => {
  const response = publicKycStatus({ ...approved, faceReverification: {
    attemptId: "attempt", status: "approved", completedAt: new Date(), profileSnapshot: { full_name: "Private identity" }, faceMatchScore: 90,
  } }, { kycStatus: "approved" });
  assert.equal(response.status, "approved");
  assert.doesNotMatch(JSON.stringify(response), /confidence|faceMatchScore|Private identity|92\.5|%/i);
  const correction = publicKycStatus({ status: "rejected", remarks: "Face confidence was 20%. Upload a clearer ID." });
  assert.equal(correction.remarks, "Upload a clearer ID.");
});

test("settings does not show an old approval after a newer administrator reverification request", () => {
  const response = publicKycStatus(approved, { kycStatus: "not_started", kycStatusUpdatedAt: new Date("2026-09-01T00:00:00Z") });
  assert.equal(response.status, "not_started");
  assert.equal(response.verifiedAt, null);
});

test("renter preferences expose supported options and retain dormant legacy settings", async (t) => {
  const user = { notificationSettings: { email: true, bookingUpdates: true, sms: true, promotions: true }, async save() {} };
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  const res = { json(body) { this.body = body; }, status() { return this; } };
  await getNotificationSettings({ user: { _id: userId, role: "user" } }, res);
  assert.deepEqual(res.body.settings, { email: true, bookingUpdates: true });
  await updateNotificationSettings({ user: { _id: userId, role: "user" }, body: { email: false, bookingUpdates: false, sms: false, promotions: false } }, res);
  assert.deepEqual(res.body.settings, { email: false, bookingUpdates: false });
  assert.equal(user.notificationSettings.sms, true);
  assert.equal(user.notificationSettings.promotions, true);
});
