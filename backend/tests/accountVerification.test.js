import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import express from "express";
import cookieParser from "cookie-parser";
import User from "../models/User.js";
import KycVerification from "../models/KycVerification.js";
import PreKycDocument from "../models/PreKycDocument.js";
import Booking from "../models/Booking.js";
import LoginChallenge from "../models/LoginChallenge.js";
import LoginActivity from "../models/LoginActivity.js";
import RevokedSession from "../models/RevokedSession.js";
import { getAccountVerification, assertAccountEligibility } from "../services/accountVerification.service.js";
import { reconcileUserKyc, reviewKycDocument } from "../services/kycReview.service.js";
import { loginUser } from "../controllers/auth.controller.js";
import { createBooking } from "../controllers/booking.controller.js";
import { updateOwnerBookingStatus } from "../controllers/ownerDashboard.controller.js";
import bookingRouter from "../routes/booking.routes.js";
import ownerRouter from "../routes/owner.routes.js";
import adminRouter from "../routes/admin.routes.js";
import kycRouter from "../routes/kyc.routes.js";
import authRouter from "../routes/auth.routes.js";
import { issuePreKycSession } from "../utils/preKycSession.js";

const userId = "507f1f77bcf86cd799439011", ownerId = "507f1f77bcf86cd799439015", adminId = "507f1f77bcf86cd799439013";
const query = value => ({ select() { return this; }, populate() { return this; }, lean: async () => value,
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const at = (obj, key) => key.split(".").reduce((value, part) => value?.[part], obj);
function matches(object, filter) {
  return Boolean(object) && Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some(entry => matches(object, entry));
    const actual = at(object, key);
    if (value === null) return actual == null;
    if (value && typeof value === "object" && !(value instanceof Date)) return Object.entries(value).every(([op, expected]) =>
      op === "$in" ? expected.includes(actual) : op === "$exists" ? (actual !== undefined) === expected
        : op === "$lte" ? actual <= expected : op === "$gt" ? actual > expected : op === "$ne" ? actual !== expected : false);
    return value instanceof Date ? new Date(actual).getTime() === value.getTime() : String(actual) === String(value);
  });
}
function write(object, update) {
  for (const [key, value] of Object.entries(update.$set || {})) {
    const parts = key.split("."); const leaf = parts.pop();
    parts.reduce((obj, part) => obj[part] ||= {}, object)[leaf] = value;
  }
  for (const [key, value] of Object.entries(update.$push || {})) (object[key] ||= []).push(value);
  object.updatedAt = new Date(); return object;
}
function fixture(t, { role = "user", approved = false } = {}) {
  const user = { _id: userId, name: "Synthetic Applicant", email: "fixture@gmail.com", role, isVerified: true,
    registrationDraftId: "owned-draft", kycStatus: approved ? "approved" : "challenge_passed" };
  const owner = { _id: ownerId, role: "owner", isVerified: true, kycStatus: "approved", email: "legacy-owner@gmail.com" };
  const admin = { _id: adminId, role: "admin", isVerified: true };
  const kyc = { _id: "case", user: userId, status: user.kycStatus, registrationSessionId: "owned-session", idDocumentHash: "id-hash",
    challengePassedAt: new Date(), registrationDocumentVersions: { id: "id-v1", ...(role === "owner" ? { supporting: "business-v1" } : {}) }, updatedAt: new Date() };
  const docs = ["id", ...(role === "owner" ? ["supporting"] : [])].map((docType, index) => ({
    _id: index ? "507f1f77bcf86cd799439014" : "507f1f77bcf86cd799439012", docType, role, registeredUser: userId,
    email: user.email, sessionId: "owned-session", reviewVersion: index ? "business-v1" : "id-v1",
    fileHash: index ? "business-hash" : "id-hash", detailsMatched: true, status: approved ? "verified" : "pending_review", provider: "gemini" }));
  t.mock.method(User, "findById", id => query([user, owner, admin].find(entry => String(entry._id) === String(id))));
  t.mock.method(User, "updateOne", async (filter, update) => { const entry = [user, owner].find(entry => matches(entry, filter)); if (entry) write(entry, update); return { matchedCount: Number(Boolean(entry)) }; });
  t.mock.method(KycVerification, "findOne", async filter => matches(kyc, filter) ? kyc : null);
  t.mock.method(KycVerification, "findOneAndUpdate", async (filter, update) => matches(kyc, filter) ? write(kyc, update) : null);
  t.mock.method(KycVerification, "updateOne", async (filter, update) => { const matched = matches(kyc, filter); if (matched) write(kyc, update); return { matchedCount: Number(matched) }; });
  t.mock.method(PreKycDocument, "findOne", async filter => docs.find(doc => matches(doc, filter)) || null);
  t.mock.method(PreKycDocument, "findById", async id => docs.find(doc => doc._id === id) || null);
  t.mock.method(PreKycDocument, "findOneAndUpdate", async (filter, update) => { const doc = docs.find(doc => matches(doc, filter)); return doc ? write(doc, update) : null; });
  return { user, owner, admin, kyc, docs };
}
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, cookie() {}, clearCookie() {} });

for (const role of ["user", "owner"]) {
  test(`${role} can log in while pending or rejected, but email and account suspensions still block login`, async t => {
    const { user } = fixture(t, { role });
    const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = "synthetic-login-test-secret";
    t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
    const answerHash = await bcrypt.hash("7", 4);
    t.mock.method(LoginChallenge, "findOne", () => query({ answerHash, attempts: 0, maxAttempts: 5, save: async () => {} }));
    t.mock.method(User, "findOne", () => query({ ...user, matchPassword: async () => true }));
    t.mock.method(LoginActivity, "create", async () => ({}));
    for (const status of ["challenge_passed", "rejected", "approved"]) {
      user.kycStatus = status; const res = response();
      await loginUser({ body: { email: user.email, password: "FixturePass1!", captchaId: "fixture", captchaAnswer: "7" }, ip: "127.0.0.1", get: () => "fixture" }, res);
      assert.equal(res.statusCode, 200); assert.equal(res.body.user.kycStatus, status);
    }
    for (const field of ["isDisabled", "isArchived", "isVerified"]) {
      user[field] = field !== "isVerified"; const res = response();
      await loginUser({ body: { email: user.email, password: "FixturePass1!", captchaId: "fixture", captchaAnswer: "7" }, ip: "127.0.0.1" }, res);
      assert.equal(res.statusCode, 403); user[field] = field === "isVerified";
    }
  });
  test(`${role} eligibility requires email, active account, all pinned document decisions and the current selfie`, async t => {
    const { user, kyc, docs } = fixture(t, { role, approved: true });
    assert.equal((await getAccountVerification(user)).bookingEligible, true);
    for (const doc of docs) for (const status of ["pending_review", "rejected", "queued"]) {
      doc.status = status; assert.equal((await getAccountVerification(user)).bookingEligible, false); doc.status = "verified";
    }
    for (const doc of docs) { const version = doc.reviewVersion; doc.reviewVersion = "replacement";
      await assert.rejects(assertAccountEligibility(user._id), { status: 403 }); doc.reviewVersion = version; }
    kyc.challengePassedAt = null; assert.equal((await getAccountVerification(user)).bookingEligible, false);
    kyc.challengePassedAt = new Date(); user.isVerified = false; assert.equal((await getAccountVerification(user)).bookingEligible, false);
    user.isVerified = true; user.isDisabled = true; assert.equal((await getAccountVerification(user)).bookingEligible, false);
  });
}

test("independent business rejection and replacement preserve approved ID and selfie, then restore access only after business approval", async t => {
  const { user, kyc, docs } = fixture(t, { role: "owner", approved: true });
  const identity = docs[0], selfie = kyc.challengePassedAt;
  docs[1].status = "pending_review";
  await reviewKycDocument({ id: docs[1]._id, action: "reject", remarks: "The permit is unreadable. Upload a clear copy.", reviewerId: adminId, reviewVersion: "business-v1" });
  assert.equal(user.kycStatus, "rejected"); assert.equal(identity.status, "verified"); assert.equal(kyc.challengePassedAt, selfie);
  docs[1].status = "pending_review"; docs[1].reviewVersion = "business-v2"; kyc.registrationDocumentVersions.supporting = "business-v2";
  await reconcileUserKyc(userId); assert.equal(user.kycStatus, "challenge_passed");
  await assert.rejects(reviewKycDocument({ id: docs[1]._id, action: "approve", reviewerId: adminId, reviewVersion: "business-v1" }), { status: 409 });
  await reviewKycDocument({ id: docs[1]._id, action: "approve", reviewerId: adminId, reviewVersion: "business-v2" });
  assert.equal((await getAccountVerification(user)).listingEligible, true); assert.equal(docs[1].reviewHistory.length, 2);
  assert.equal(identity.status, "verified"); assert.equal(kyc.challengePassedAt, selfie);
});

test("a stale approved account summary cannot bypass direct booking creation or confirmation", async t => {
  const { user, owner, docs } = fixture(t, { approved: true }); docs[0].status = "pending_review";
  const created = t.mock.method(Booking, "create", async () => { throw Error("Ineligible account reached booking write"); });
  const res = response(); await createBooking({ user, body: { vehicleId: "vehicle", pickupAt: new Date(Date.now() + 86400000).toISOString(),
    returnAt: new Date(Date.now() + 90000000).toISOString() } }, res); assert.equal(res.statusCode, 403); assert.equal(created.mock.callCount(), 0);
  const booking = { _id: "booking", owner, renter: user, status: "pending", pickupAt: new Date(Date.now() + 86400000), returnAt: new Date(Date.now() + 90000000) };
  t.mock.method(Booking, "findOne", () => query(booking));
  const write = t.mock.method(Booking, "updateOne", async () => { throw Error("Ineligible renter reached confirmation"); });
  const confirm = response(); await updateOwnerBookingStatus({ user: owner, params: { id: booking._id }, body: { status: "confirmed" } }, confirm);
  assert.equal(confirm.statusCode, 403); assert.equal(write.mock.callCount(), 0); assert.equal(booking.status, "pending");
  assert.equal(confirm.body.code, "RENTER_VERIFICATION_REQUIRED"); assert.equal(confirm.body.verification, undefined);
  assert.equal(JSON.stringify(confirm.body).includes("id-v1"), false);
});

test("another party receives no private document references or correction notes from an eligibility failure", async t => {
  const { user, docs } = fixture(t, { role: "owner", approved: true });
  docs[1].status = "rejected"; docs[1].reason = "Private correction instructions for this applicant.";
  await assert.rejects(assertAccountEligibility(user._id, "listing", { exposeDetails: false }), error =>
    error.status === 403 && error.code === "OWNER_VERIFICATION_REQUIRED" && error.verification === undefined && !error.message.includes("Private correction"));
});

test("refreshing a tracked approval cannot undo an administrator's requirement to verify again", async t => {
  const { user, kyc } = fixture(t, { approved: true });
  user.kycStatus = "not_started"; user.kycStatusUpdatedAt = new Date();
  await reconcileUserKyc(userId);
  assert.equal(user.kycStatus, "not_started"); assert.equal(kyc.status, "approved");
  assert.equal((await getAccountVerification(user)).bookingEligible, false);
});

test("a newly registered account cannot use a summary approval without its durable case and required bindings", async t => {
  const { user, kyc } = fixture(t, { role: "owner", approved: true });
  assert.equal((await getAccountVerification(user, null)).listingEligible, false);
  delete kyc.registrationDocumentVersions.supporting;
  assert.equal((await getAccountVerification(user)).listingEligible, false);
});

test("actual authenticated APIs allow pending profile access and deny booking, listing and unauthorized reviews", async t => {
  const { user, kyc, docs } = fixture(t, { role: "owner" });
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = "synthetic-route-test-secret";
  t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
  t.mock.method(RevokedSession, "exists", async () => false);
  const app = express(); app.use(express.json()); app.use(cookieParser());
  app.use("/api/auth", authRouter); app.use("/api/bookings", bookingRouter); app.use("/api/owner", ownerRouter); app.use("/api/admin", adminRouter); app.use("/api/kyc", kycRouter);
  const server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { cookie: `token=${jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "5m" })}`, "Content-Type": "application/json" };
  assert.equal((await fetch(base + "/api/auth/me", { headers })).status, 200);
  const privatePreview = base + "/api/admin/documents/507f1f77bcf86cd799439012/file";
  assert.equal((await fetch(privatePreview, { headers })).status, 403);
  assert.equal((await fetch(privatePreview)).status, 401);
  for (const [method, route, body] of [["POST", "/api/bookings", {}], ["POST", "/api/owner/vehicles", {}],
    ["PUT", "/api/owner/vehicles/507f1f77bcf86cd799439012", {}], ["PATCH", "/api/owner/vehicles/507f1f77bcf86cd799439012/availability", { availabilityStatus: "available" }],
    ["PATCH", "/api/owner/vehicles/507f1f77bcf86cd799439012/availability", { availabilityStatus: " AVAILABLE " }],
    ["PATCH", "/api/admin/documents/507f1f77bcf86cd799439012", { approval: "Approved", reviewVersion: "id-v1" }],
    ["PATCH", "/api/kyc/admin/reviews/507f1f77bcf86cd799439012", { action: "approve" }]]) {
    const res = await fetch(base + route, { method, headers, body: JSON.stringify(body) }); assert.equal(res.status, 403, route);
  }
  user.kycStatus = "approved"; kyc.status = "approved"; docs.forEach(doc => { doc.status = "verified"; });
  for (const route of ["/api/bookings", "/api/owner/vehicles"]) {
    const res = await fetch(base + route, { method: "POST", headers, body: "{}" });
    assert.equal(res.status, 400, `${route} reaches input validation after all approvals`);
  }
});

test("owner-upgrade document uploads require the matching signed-in, email-verified, identity-approved renter", async t => {
  const { user } = fixture(t, { approved: true });
  const previous = { jwt: process.env.JWT_SECRET, pre: process.env.PRE_KYC_SESSION_SECRET };
  process.env.JWT_SECRET = "synthetic-upgrade-route-secret"; process.env.PRE_KYC_SESSION_SECRET = "synthetic-upgrade-session-secret";
  t.after(() => { for (const [key, value] of [["JWT_SECRET", previous.jwt], ["PRE_KYC_SESSION_SECRET", previous.pre]])
    if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  t.mock.method(RevokedSession, "exists", async () => false);
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use("/api/kyc", kycRouter);
  const server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/kyc/pre/supporting-doc/verify`;
  const headers = { cookie: `token=${jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "5m" })}`, "Content-Type": "application/json" };
  const send = (email, loggedIn = true) => fetch(url, { method: "POST", headers: loggedIn ? headers : { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role: "owner", preKycToken: issuePreKycSession({ email, role: "owner" }).token }) });
  assert.equal((await send(user.email)).status, 400); // The authenticated request reaches document validation.
  assert.equal((await send("other@gmail.com")).status, 403);
  assert.equal((await send(user.email, false)).status, 403);
  user.isVerified = false; assert.equal((await send(user.email)).status, 403); user.isVerified = true;
  user.kycStatus = "challenge_passed"; assert.equal((await send(user.email)).status, 403);
});
