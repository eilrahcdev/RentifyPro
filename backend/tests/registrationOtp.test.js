import test from "node:test";
import assert from "node:assert/strict";
import RegistrationDraft from "../models/RegistrationDraft.js";
import User from "../models/User.js";
import PreKycDocument from "../models/PreKycDocument.js";
import PreKycFace from "../models/PreKycFace.js";
import KycVerification from "../models/KycVerification.js";
import Otp from "../models/Otp.js";
import { reconcileUserKyc, reviewKycDocument } from "../services/kycReview.service.js";
import { requireKyc } from "../middleware/rbac.middleware.js";
import nodemailer from "nodemailer";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import cookieParser from "cookie-parser";
import kycRouter from "../routes/kyc.routes.js";
import ownerRouter from "../routes/owner.routes.js";
import { sendRegistrationOtp, verifyRegistrationOtp, getRegistrationDraft, saveRegistrationDraft, deleteRegistrationDraft, registrationRecoveryState } from "../controllers/registrationDraft.controller.js";
import { requireRegistrationEmail } from "../middleware/preKycSession.middleware.js";
import { registrationOtpHash } from "../utils/emailOtp.js";
import { issuePreKycSession } from "../utils/preKycSession.js";
import { registerUser } from "../controllers/auth.controller.js";
import { requestRegistrationReview } from "../controllers/kyc.controller.js";
import { activeRegistrationDraft } from "../utils/registrationDraft.js";
import { cleanupCancelledRegistration } from "../services/registrationCleanup.service.js";
import { supportsRegistrationTransactions, createRegistrationAccount } from "../services/registrationFinalization.service.js";

test("registration rejects a signed draft whose email has not passed OTP", async t => {
  t.mock.method(User, "findOne", async () => { throw new Error("Unverified email reached account lookup"); });
  const previous = process.env.PRE_KYC_SESSION_SECRET;
  process.env.PRE_KYC_SESSION_SECRET = "registration-otp-fixture-only-secret";
  t.after(() => { if (previous === undefined) delete process.env.PRE_KYC_SESSION_SECRET; else process.env.PRE_KYC_SESSION_SECRET = previous; });
  t.mock.method(RegistrationDraft, "findOne", async () => ({ _id: "draft", role: "user", sessionId: "session",
    fields: { email: "new@gmail.com" }, createdAt: new Date(), expiresAt: new Date(Date.now() + 60000), absoluteExpiresAt: new Date(Date.now() + 60000) }));
  const { token } = issuePreKycSession({ email: "new@gmail.com", role: "user", sessionId: "session", draftId: "draft" });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await registerUser({ body: { name: "Test Applicant", email: "new@gmail.com", password: "Example123!", preKycToken: token } }, res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /verify.*email/i);
});

const fields = { firstName: "Alice", lastName: "Example", email: "alice@gmail.com", phone: "9123456789",
  dateOfBirth: "1995-01-01", gender: "Female", region: "01", province: "0101", city: "010101", barangay: "010101001",
  emergencyContactName: "Bob Example", emergencyContactPhone: "9987654321", emergencyContactRelationship: "Friend", idType: "Philippine Passport" };
const cookie = "a".repeat(64);
const draftId = crypto.createHash("sha256").update(cookie).digest("hex");
const response = () => ({ statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }, setHeader(key, value) { this.headers[key] = value; }, cookie() {}, clearCookie() {} });
const valueAt = (object, key) => key.split(".").reduce((value, part) => value?.[part], object);
const equal = (left, right) => left instanceof Date || right instanceof Date ? new Date(left).getTime() === new Date(right).getTime() : left === right;
function matches(object, filter) {
  return Boolean(object) && Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") return expected.some(entry => matches(object, entry));
    if (key === "$and") return expected.every(entry => matches(object, entry));
    const actual = valueAt(object, key);
    if (expected === null) return actual == null;
    if (expected && typeof expected === "object" && !(expected instanceof Date)) return Object.entries(expected).every(([operator, value]) => {
      if (operator === "$exists") return (actual !== undefined) === value;
      if (operator === "$gt") return actual > value;
      if (operator === "$lt") return actual < value;
      if (operator === "$lte") return actual <= value;
      if (operator === "$eq") return equal(actual, value);
      if (operator === "$ne") return !equal(actual, value);
      if (operator === "$in") return value.includes(actual);
      throw new Error(`Unhandled mock operator ${operator}`);
    });
    return equal(actual, expected);
  });
}
function write(object, update, insert = false) {
  for (const [operation, entries] of Object.entries(update)) for (const [key, value] of Object.entries(entries)) {
    if (operation === "$setOnInsert" && !insert) continue;
    const parts = key.split("."); const leaf = parts.pop();
    const target = parts.reduce((value, part) => value[part] ||= {}, object);
    if (operation === "$unset") delete target[leaf];
    else if (operation === "$inc") target[leaf] = (target[leaf] || 0) + value;
    else target[leaf] = structuredClone(value);
  }
  object.updatedAt = new Date(); return object;
}
const query = value => ({ select() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
let mails = [], mailFails = false;
const { mock } = await import("node:test");
mock.method(nodemailer, "createTransport", () => ({ sendMail: async message => {
  if (mailFails) throw new Error("Synthetic mail interruption"); mails.push(message); return { messageId: "fixture" };
} }));

async function fixture(t, { role = "user", verified = false, docs = true } = {}) {
  const old = { ...process.env };
  process.env.PRE_KYC_SESSION_SECRET = "registration-otp-fixture-only-secret";
  process.env.SMTP_USER = "sender@example.test"; process.env.SMTP_PASS = "fixture-only";
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rentify-otp-"));
  process.env.KYC_UPLOAD_DIR = directory;
  t.after(async () => { for (const key of ["PRE_KYC_SESSION_SECRET", "SMTP_USER", "SMTP_PASS", "KYC_UPLOAD_DIR"])
    if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
    await fs.rm(directory, { recursive: true, force: true }); });
  mails = []; mailFails = false;
  let nextCode = 120000;
  t.mock.method(crypto, "randomInt", () => ++nextCode);
  const otpRecords = [];
  t.mock.method(Otp, "findOneAndUpdate", async (filter, update) => {
    const record = otpRecords.find(record => record._id === filter._id);
    if (record && !matches(record, filter)) throw Object.assign(new Error("recent email code"), { code: 11000 });
    if (record) return write(record, update);
    const created = write({ _id: filter._id }, update); otpRecords.push(created); return created;
  });
  const email = role === "owner" ? "owner@gmail.com" : fields.email;
  const draftFields = role === "owner" ? { ...fields, businessEmail: email, ownerType: "business", businessName: "Example Transport",
    permitNumber: "TEST123", supportingDocType: "DTI Business Name Registration" } : { ...fields };
  const draft = { _id: draftId, role, sessionId: "fixture-session", evidenceEmail: email, fields: draftFields,
    step: 5, revision: 1, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 3600000),
    absoluteExpiresAt: new Date(Date.now() + 7200000), otpAttemptsTotal: 0, verifiedEmail: verified ? email : "", emailVerifiedAt: verified ? new Date() : null };
  const bytes = Buffer.from("Synthetic private evidence for registration tests");
  await fs.writeFile(path.join(directory, "review-fixture.jpg"), bytes);
  const documents = docs ? ["id", ...(role === "owner" ? ["supporting"] : [])].map(docType => ({
    _id: docType === "id" ? "507f1f77bcf86cd799439012" : "507f1f77bcf86cd799439014", email, role, sessionId: draft.sessionId, docType, fileKey: "review-fixture.jpg",
    fileHash: crypto.createHash("sha256").update(bytes).digest("hex"), reviewVersion: `${docType}-version`,
    status: "pending_review", detailsMatched: true, provider: "gemini", selectedDocCategory: docType === "id" ? fields.idType : draftFields.supportingDocType,
    profileSnapshot: { full_name: "Alice Example", date_of_birth: fields.dateOfBirth, business_name: draftFields.businessName,
      permit_number: draftFields.permitNumber }, expiresAt: new Date(Date.now() + 7200000),
    ...(docType === "id" ? { selfieVerification: { status: "approved", idDocumentRevision: "id-version",
      idDocumentHash: crypto.createHash("sha256").update(bytes).digest("hex"), verifiedAt: new Date(), expiresAt: new Date(Date.now() + 7200000) } } : {}),
  })) : [];
  const users = []; let kyc;
  t.mock.method(RegistrationDraft, "findOne", filter => query(matches(draft, filter) ? structuredClone(draft) : null));
  t.mock.method(RegistrationDraft, "findOneAndUpdate", async (filter, update) => matches(draft, filter) ? structuredClone(write(draft, update)) : null);
  t.mock.method(RegistrationDraft, "updateOne", async (filter, update) => { const matched = matches(draft, filter); if (matched) write(draft, update); return { matchedCount: Number(matched) }; });
  t.mock.method(PreKycDocument, "find", filter => query(documents.filter(doc => matches(doc, filter)).map(doc => structuredClone(doc))));
  t.mock.method(PreKycDocument, "findOne", filter => query(structuredClone(documents.find(doc => matches(doc, filter)) || null)));
  t.mock.method(PreKycDocument, "findById", async id => structuredClone(documents.find(doc => doc._id === id) || null));
  t.mock.method(PreKycDocument, "findOneAndUpdate", async (filter, update) => {
    const doc = documents.find(doc => matches(doc, filter)); return doc ? structuredClone(write(doc, update)) : null;
  });
  t.mock.method(PreKycDocument, "exists", async filter => documents.find(doc => matches(doc, filter)) || null);
  t.mock.method(PreKycDocument, "updateOne", async (filter, update) => { const doc = documents.find(doc => matches(doc, filter)); if (doc) write(doc, update); return { matchedCount: Number(Boolean(doc)) }; });
  t.mock.method(PreKycDocument, "updateMany", async (filter, update) => { const rows = documents.filter(doc => matches(doc, filter)); rows.forEach(doc => write(doc, update)); return { matchedCount: rows.length }; });
  t.mock.method(User, "exists", async filter => users.find(user => matches(user, filter)) || null);
  t.mock.method(User, "findOne", filter => query(users.find(user => matches(user, filter)) || null));
  t.mock.method(User, "findById", id => query(users.find(user => user._id === id) || null));
  t.mock.method(User, "updateOne", async (filter, update) => { const user = users.find(user => matches(user, filter)); if (user) write(user, update); return { matchedCount: Number(Boolean(user)) }; });
  t.mock.method(User, "create", async input => { if (users.some(user => user.email === input.email)) throw Object.assign(new Error("duplicate"), { code: 11000, keyPattern: { email: 1 } });
    const user = { _id: "507f1f77bcf86cd799439011", ...input }; users.push(user); return user; });
  t.mock.method(KycVerification, "findOne", async () => kyc ? structuredClone(kyc) : null);
  t.mock.method(KycVerification, "findOneAndUpdate", async (filter, update) => { const insert = !kyc; kyc ||= { _id: "kyc-case" }; return structuredClone(write(kyc, update, insert)); });
  t.mock.method(KycVerification, "updateOne", async (filter, update) => { write(kyc, update); return { matchedCount: 1 }; });
  const req = body => ({ query: { role }, cookies: { [`rentify_registration_${role}`]: cookie }, body, ip: "127.0.0.1" });
  const registration = () => {
    const currentEmail = draft.fields[role === "owner" ? "businessEmail" : "email"];
    return { ...req(), body: { ...draft.fields, name: "Alice Example", email: currentEmail, role, password: "Example123!",
      preKycToken: issuePreKycSession({ email: currentEmail, role, sessionId: draft.sessionId, draftId }).token } };
  };
  return { draft, documents, users, otpRecords, req, registration, get kyc() { return kyc; } };
}
const deliveredCode = () => mails.at(-1).html.match(/>(\d{6})<\/span>/)[1];

test("clearing a draft ignores a client completion claim and deletes only its unsubmitted evidence", async t => {
  const state = await fixture(t, { verified: true });
  const owned = state.documents[0];
  state.documents.push({ ...owned, _id: "linked", registeredUser: "507f1f77bcf86cd799439011" },
    { ...owned, _id: "other-email", email: "other@gmail.com" },
    { ...owned, _id: "other-session", sessionId: "another-registration" });
  t.mock.method(RegistrationDraft, "findOneAndDelete", async filter => matches(state.draft, filter) ? state.draft : null);
  const removed = t.mock.method(PreKycDocument, "deleteMany", async filter => {
    for (let index = state.documents.length - 1; index >= 0; index--) if (matches(state.documents[index], filter)) state.documents.splice(index, 1);
    return {};
  });
  const faces = t.mock.method(PreKycFace, "deleteMany", async filter => {
    assert.deepEqual(filter, { sessionId: state.draft.sessionId, role: "user", email: { $in: [fields.email] } }); return {};
  });
  const cleared = response(); await deleteRegistrationDraft(state.req({ complete: true }), cleared);
  assert.equal(cleared.statusCode, 200); assert.equal(removed.mock.callCount(), 1); assert.equal(faces.mock.callCount(), 1);
  assert.deepEqual(state.documents.map(doc => doc._id), ["linked", "other-email", "other-session"]);
  await assert.doesNotReject(fs.stat(path.join(process.env.KYC_UPLOAD_DIR, owned.fileKey)));
});

test("clearing an uncertain submission or an existing account's draft preserves its evidence", async t => {
  const state = await fixture(t, { verified: true });
  t.mock.method(RegistrationDraft, "findOneAndDelete", async () => state.draft);
  const removed = t.mock.method(PreKycDocument, "deleteMany", async () => { throw new Error("Account evidence must remain"); });
  state.draft.submissionDocuments = state.documents.map(doc => ({ id: doc._id }));
  const uncertain = response(); await deleteRegistrationDraft(state.req({}), uncertain);
  assert.equal(uncertain.statusCode, 409);
  delete state.draft.submissionDocuments;
  state.users.push({ email: fields.email, registrationDraftId: state.draft._id });
  const account = response(); await deleteRegistrationDraft(state.req({}), account);
  assert.equal(account.statusCode, 200); assert.equal(removed.mock.callCount(), 0);
  assert.equal(state.documents.length, 1);
});

test("draft OTP is hashed, single-use, bound to its owner and restores verified progress", async t => {
  const state = await fixture(t);
  const sent = response(); await sendRegistrationOtp(state.req({}), sent);
  assert.equal(sent.statusCode, 200); assert.equal(mails.length, 1);
  const code = deliveredCode(); assert.notEqual(state.draft.emailOtp.hash, code);
  assert.equal(state.draft.emailOtp.hash, registrationOtpHash(state.draft, code));
  assert.equal(JSON.stringify(sent.body).includes(code), false); assert.equal(sent.body.draft.emailVerified, false);
  const verified = response(); await verifyRegistrationOtp(state.req({ otp: code }), verified);
  assert.equal(verified.statusCode, 200); assert.equal(state.draft.emailOtp, null);
  assert.equal(verified.body.draft.emailVerified, true); assert.equal(verified.body.draft.step, 5);
  assert.equal(verified.body.draft.verificationPhase, "face");
  const again = response(); await verifyRegistrationOtp(state.req({ otp: code }), again);
  assert.equal(again.body.draft.emailVerified, true); assert.equal(state.draft.otpAttemptsTotal, 1);
  const recovery = response(); await getRegistrationDraft(state.req(), recovery);
  assert.equal(recovery.body.draft.emailVerified, true); assert.equal(recovery.body.draft.selfieVerified, true);
  const wrongRole = response(); await verifyRegistrationOtp({ ...state.req({ otp: code }), query: { role: "owner" } }, wrongRole);
  assert.notEqual(wrongRole.statusCode, 200);
});

test("simultaneous resends send one email and enforce a server cooldown", async t => {
  const state = await fixture(t); const replies = [response(), response()];
  await Promise.all(replies.map(res => sendRegistrationOtp(state.req({}), res)));
  assert.equal(mails.length, 1); assert.equal(replies.filter(res => res.statusCode === 200).length, 1);
  const early = response(); await sendRegistrationOtp(state.req({}), early);
  assert.equal(early.statusCode, 429); assert.ok(Number(early.headers["Retry-After"]) > 0);
  state.draft.otpLastSentAt = new Date(Date.now() - 60000);
  state.otpRecords[0].lastSentAt = state.draft.otpLastSentAt;
  const next = response(); await sendRegistrationOtp(state.req({}), next); assert.equal(next.statusCode, 200); assert.equal(mails.length, 2);
});

test("concurrent correct OTP submissions consume one challenge and return the same verified state", async t => {
  const state = await fixture(t); await sendRegistrationOtp(state.req({}), response());
  const code = deliveredCode(); const replies = Array.from({ length: 8 }, response);
  await Promise.all(replies.map(res => verifyRegistrationOtp(state.req({ otp: code }), res)));
  assert.equal(replies.every(res => res.statusCode === 200 && res.body.draft.emailVerified), true);
  assert.equal(state.draft.emailOtp, null); assert.ok(state.draft.otpAttemptsTotal <= 5);
  assert.equal(mails.length, 1);
});

test("wrong and concurrent codes cannot bypass attempt limits, expiry or resend invalidation", async t => {
  const state = await fixture(t); await sendRegistrationOtp(state.req({}), response()); const firstCode = deliveredCode();
  const wrong = firstCode === "999999" ? "888888" : "999999";
  await Promise.all(Array.from({ length: 8 }, () => verifyRegistrationOtp(state.req({ otp: wrong }), response())));
  assert.equal(state.draft.emailOtp.attempts, 5); assert.equal(state.draft.otpAttemptsTotal, 5);
  const exhausted = response(); await verifyRegistrationOtp(state.req({ otp: firstCode }), exhausted); assert.equal(exhausted.statusCode, 400);
  state.draft.otpLastSentAt = new Date(Date.now() - 60000); state.otpRecords[0].lastSentAt = state.draft.otpLastSentAt;
  await sendRegistrationOtp(state.req({}), response());
  const oldCode = response(); await verifyRegistrationOtp(state.req({ otp: firstCode }), oldCode); assert.equal(oldCode.statusCode, 400);
  state.draft.emailOtp.expiresAt = new Date(Date.now() - 1);
  const expired = response(); await verifyRegistrationOtp(state.req({ otp: deliveredCode() }), expired); assert.equal(expired.statusCode, 400);
  state.draft.otpAttemptsTotal = 25; state.draft.otpLastSentAt = new Date(Date.now() - 60000);
  const total = response(); await sendRegistrationOtp(state.req({}), total); assert.equal(total.statusCode, 429);
});

test("email edits invalidate OTP while preserving the draft's document and face versions", async t => {
  const state = await fixture(t, { verified: true });
  const session = state.draft.sessionId;
  const res = response(); await saveRegistrationDraft(state.req({ fields: { ...fields, email: "changed@gmail.com" }, step: 5, revision: 1 }), res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.draft.emailVerified, false); assert.equal(res.body.draft.step, 4);
  assert.equal(state.draft.sessionId, session); assert.equal(res.body.draft.selfieVerified, true); assert.equal(res.body.draft.verificationPhase, "email");
  await sendRegistrationOtp(state.req({}), response()); assert.equal(mails[0].to, "changed@gmail.com");
  const verified = response(); await verifyRegistrationOtp(state.req({ otp: deliveredCode() }), verified);
  assert.equal(verified.body.draft.step, 5); assert.equal(verified.body.draft.documents.length, 1);
  const registered = response(); await registerUser(state.registration(), registered);
  assert.equal(registered.statusCode, 201); assert.equal(registered.body.user.email, "changed@gmail.com");
  assert.equal(state.documents[0].email, "changed@gmail.com"); assert.equal(state.documents[0].reviewVersion, "id-version");
});

test("email changes before any upload cannot retain an unrelated account's evidence address", async t => {
  const state = await fixture(t, { docs: false });
  state.draft.evidenceEmail = "existing@gmail.com"; state.draft.fields.email = "existing@gmail.com";
  const changed = response(); await saveRegistrationDraft(state.req({ fields, step: 4, revision: 1 }), changed);
  assert.equal(changed.statusCode, 200); assert.equal(state.draft.evidenceEmail, fields.email);
  state.draft.verifiedEmail = fields.email; state.draft.emailVerifiedAt = new Date();
  state.users.push({ email: fields.email });
  const rejected = response(); let allowed = false;
  await requireRegistrationEmail({ registrationDraft: state.draft }, rejected, () => { allowed = true; });
  assert.equal(allowed, false); assert.equal(rejected.statusCode, 409);
});

test("SMTP failure, expired drafts and forged completion claims fail closed", async t => {
  const state = await fixture(t); mailFails = true;
  const failed = response(); await sendRegistrationOtp(state.req({}), failed);
  assert.equal(failed.statusCode, 503); assert.equal(state.draft.emailOtp, null); assert.equal(failed.body.draft, undefined);
  for (const draft of [undefined, state.draft, { ...state.draft, verifiedEmail: "other@gmail.com", emailVerifiedAt: new Date() }]) {
    const res = response(); let next = false;
    requireRegistrationEmail({ registrationDraft: draft, body: { emailVerified: true } }, res, () => { next = true; });
    assert.equal(next, false); assert.equal(res.statusCode, 403);
  }
  state.draft.expiresAt = new Date(Date.now() - 1);
  const expired = response(); await verifyRegistrationOtp(state.req({ otp: "123456" }), expired); assert.equal(expired.statusCode, 410);
});

test("a new browser draft cannot bypass the email-wide resend cooldown", async t => {
  const state = await fixture(t); await sendRegistrationOtp(state.req({}), response());
  delete state.draft.otpLastSentAt; state.draft.emailOtp = null;
  const another = response(); await sendRegistrationOtp(state.req({}), another);
  assert.equal(another.statusCode, 429); assert.equal(mails.length, 1);
  assert.equal(state.otpRecords[0].purpose, "registration_draft"); assert.equal(state.otpRecords[0].otp, undefined);
});

test("owner business replacement preserves email and the unaffected selfie; ID replacement invalidates the selfie", async t => {
  const state = await fixture(t, { role: "owner", verified: true });
  state.documents.find(doc => doc.docType === "supporting").status = "queued";
  const business = await registrationRecoveryState(state.draft);
  assert.equal(business.emailVerified, true); assert.equal(business.selfieVerified, true); assert.equal(business.verificationPhase, "documents");
  state.documents[0].reviewVersion = "new-id";
  const identity = await registrationRecoveryState(state.draft);
  assert.equal(identity.emailVerified, true); assert.equal(identity.selfieVerified, false); assert.equal(identity.step, 4);
});

test("an earlier verification phase survives refresh while completion is revalidated and forged phases are clamped", async t => {
  const state = await fixture(t, { verified: true });
  const saved = response(); await saveRegistrationDraft(state.req({ fields, step: 4, phase: "documents", revision: 1 }), saved);
  assert.equal(saved.statusCode, 200); assert.equal(saved.body.draft.verificationPhase, "documents");
  const recovery = response(); await getRegistrationDraft(state.req(), recovery);
  assert.equal(recovery.body.draft.verificationPhase, "documents"); assert.equal(recovery.body.draft.selfieVerified, true);
  state.draft.verifiedEmail = ""; state.draft.verificationPhase = "face";
  const forged = await registrationRecoveryState(state.draft);
  assert.equal(forged.verificationPhase, "email"); assert.equal(forged.step, 4);
});

test("a corrected account ID can be approved without bypassing its original business review", async t => {
  const state = await fixture(t, { role: "owner", verified: true });
  await registerUser(state.registration(), response());
  state.documents[0].sessionId = `user:${state.users[0]._id}`;
  state.documents[0].registeredUser = null; state.documents[0].reviewVersion = "corrected-id"; state.documents[0].status = "verified";
  write(state.kyc, { $set: { registrationIdentitySessionId: state.documents[0].sessionId, "registrationDocumentVersions.id": "corrected-id" } });
  assert.equal((await reconcileUserKyc(state.users[0]._id)).status, "challenge_passed");
  state.documents[1].status = "verified";
  assert.equal((await reconcileUserKyc(state.users[0]._id)).status, "approved");
});

test("owner approval waits for both pinned documents and the account booking gate remains closed during review", async t => {
  const state = await fixture(t, { role: "owner", verified: true });
  await registerUser(state.registration(), response());
  let allowed = false; const blocked = response();
  await requireKyc({ user: state.users[0] }, blocked, () => { allowed = true; });
  assert.equal(allowed, false); assert.equal(blocked.statusCode, 403);
  state.documents[0].status = "verified";
  assert.equal((await reconcileUserKyc(state.users[0]._id)).status, "challenge_passed");
  state.documents[1].status = "verified"; state.documents[1].reviewVersion = "replacement";
  assert.equal((await reconcileUserKyc(state.users[0]._id)).status, "challenge_passed");
  state.documents[1].reviewVersion = "supporting-version";
  assert.equal((await reconcileUserKyc(state.users[0]._id)).status, "approved");
  assert.equal(state.users[0].kycStatus, "approved");
});

test("admin review links the new owner account and grants approval only after both required decisions", async t => {
  const state = await fixture(t, { role: "owner", verified: true });
  await registerUser(state.registration(), response());
  const decide = doc => reviewKycDocument({ id: doc._id, action: "approve", reviewerId: "507f1f77bcf86cd799439013", reviewVersion: doc.reviewVersion });
  await decide(state.documents[0]); assert.equal(state.users[0].kycStatus, "challenge_passed");
  await decide(state.documents[1]); assert.equal(state.users[0].kycStatus, "approved");
  assert.equal(state.kyc.status, "approved");
});

for (const role of ["user", "owner"]) test(`${role} account creation accepts Pending Review, verifies email, keeps evidence and retries without duplicates`, async t => {
  const state = await fixture(t, { role, verified: true });
  const res = response(); await registerUser(state.registration(), res);
  assert.equal(res.statusCode, 201); assert.equal(res.body.user.isVerified, true); assert.equal(res.body.user.kycStatus, "challenge_passed");
  assert.match(res.body.message, /Pending Review/); assert.equal(state.users.length, 1); assert.match(state.users[0].password, /^\$2/);
  assert.equal(state.kyc.status, "challenge_passed"); assert.equal(state.kyc.registrationSessionId, state.draft.sessionId);
  for (const doc of state.documents) { assert.equal(doc.registeredUser, state.users[0]._id); assert.equal(doc.expiresAt, undefined); }
  const again = response(); await registerUser(state.registration(), again); assert.equal(again.statusCode, 201); assert.equal(state.users.length, 1);
  const recovery = response(); await getRegistrationDraft(state.req(), recovery); assert.equal(recovery.body.draft.registrationComplete, true);
  assert.equal(recovery.body.draft.selfieVerified, true); assert.equal(recovery.body.draft.step, 5);
});

test("concurrent Create Account requests create one account and one KYC case", async t => {
  const state = await fixture(t, { verified: true }); const replies = [response(), response()];
  await Promise.all(replies.map(res => registerUser(state.registration(), res)));
  assert.equal(state.users.length, 1); assert.equal(replies.filter(res => res.statusCode === 201).length, 1);
  assert.equal(replies.find(res => res.statusCode !== 201).statusCode, 409);
});

test("interrupted finalization is repaired on owned-draft recovery without a second account", async t => {
  const state = await fixture(t, { verified: true });
  const original = KycVerification.findOneAndUpdate; let interrupted = true;
  t.mock.method(KycVerification, "findOneAndUpdate", async (...args) => { if (interrupted) { interrupted = false; throw new Error("Synthetic KYC write interruption"); } return original(...args); });
  const create = response(); await registerUser(state.registration(), create); assert.equal(create.statusCode, 500); assert.equal(state.users.length, 1);
  const restore = response(); await getRegistrationDraft(state.req(), restore);
  assert.equal(restore.statusCode, 200); assert.equal(restore.body.draft.registrationComplete, true); assert.equal(state.users.length, 1);
  assert.equal(state.documents[0].registeredUser, state.users[0]._id); assert.equal(state.kyc.status, "challenge_passed");
});

test("a lost database create acknowledgement retains enough progress to finalize the one created account", async t => {
  const state = await fixture(t, { verified: true });
  const create = User.create;
  t.mock.method(User, "create", async (...args) => { await create(...args); throw new Error("Synthetic lost create acknowledgement"); });
  const res = response(); await registerUser(state.registration(), res);
  assert.equal(res.statusCode, 500); assert.equal(state.users.length, 1); assert.ok(state.draft.submissionDocuments);
  const recovered = response(); await getRegistrationDraft(state.req(), recovered);
  assert.equal(recovered.body.draft.registrationComplete, true); assert.equal(state.users.length, 1);
  assert.equal(state.documents[0].registeredUser, state.users[0]._id);
});

test("a failed create can retry after its lease without losing verification or changing an uncertain submission", async t => {
  const state = await fixture(t, { verified: true }); const create = User.create; let interrupted = true;
  t.mock.method(User, "create", async (...args) => { if (interrupted) { interrupted = false; throw new Error("Synthetic create network failure"); } return create(...args); });
  const first = response(); await registerUser(state.registration(), first);
  assert.equal(first.statusCode, 500); assert.equal(state.users.length, 0); assert.ok(state.draft.submissionDocuments);
  state.draft.submissionUntil = new Date(Date.now() - 1);
  const changed = response(); await saveRegistrationDraft(state.req({ fields: { ...fields, email: "changed@gmail.com" }, revision: 1, step: 5 }), changed);
  assert.equal(changed.statusCode, 409);
  const saved = response(); await saveRegistrationDraft(state.req({ fields, revision: 1, step: 5, phase: "face" }), saved);
  assert.equal(saved.statusCode, 200); assert.equal(saved.body.draft.selfieVerified, true); assert.equal(saved.body.draft.emailVerified, true);
  const retry = response(); await registerUser(state.registration(), retry);
  assert.equal(retry.statusCode, 201); assert.equal(state.users.length, 1); assert.equal(state.documents[0].reviewVersion, "id-version");
});

test("current profile, actual document and selfie state are still required before creation", async t => {
  const state = await fixture(t, { verified: true });
  for (const change of [() => { state.documents[0].selfieVerification.idDocumentRevision = "old"; },
    () => { state.documents[0].selfieVerification.idDocumentRevision = "id-version"; state.documents[0].status = "rejected"; }]) {
    change(); const res = response(); await registerUser(state.registration(), res); assert.equal(res.statusCode, 409); assert.equal(state.users.length, 0);
  }
  state.documents[0].status = "pending_review";
  const req = state.registration(); req.body.name = "Changed Person";
  const changed = response(); await registerUser(req, changed); assert.equal(changed.statusCode, 409); assert.equal(state.users.length, 0);
  state.draft.verifiedEmail = "";
  assert.equal((await registrationRecoveryState(state.draft)).step, 4);
});

test("actual HTTP upload and OTP endpoints reject bypasses and scope success to the private cookie", async t => {
  const state = await fixture(t, { docs: false });
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use("/api/kyc", kycRouter);
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/kyc/pre`;
  const token = state.registration().body.preKycToken;
  for (const endpoint of ["id-register", "selfie/verify", "supporting-doc/verify"]) {
    const blocked = await fetch(`${base}/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", "x-pre-kyc-token": token }, body: "{}" });
    assert.equal(blocked.status, 403); assert.equal((await blocked.json()).code, "EMAIL_VERIFICATION_REQUIRED");
  }
  const post = (endpoint, body, owned = true) => fetch(`${base}/draft/otp/${endpoint}?role=user`, { method: "POST",
    headers: { "Content-Type": "application/json", "x-registration-draft": "1", ...(owned ? { Cookie: `rentify_registration_user=${cookie}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post("send", {}, false)).status, 401);
  const sent = await post("send", {}); assert.equal(sent.status, 200); assert.equal(sent.headers.get("cache-control"), "private, no-store");
  const verified = await post("verify", { otp: deliveredCode() }); assert.equal(verified.status, 200);
  const result = await verified.json(); assert.equal(result.draft.emailVerified, true); assert.equal(result.draft.verificationPhase, "documents");
});

test("legacy owner signup cannot create a second registration or bypass the verified draft", async t => {
  const state = await fixture(t, { role: "owner", verified: true });
  const app = express(); app.use(express.json()); app.use("/api/owner", ownerRouter);
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/owner`;
  const post = (endpoint, body) => fetch(`${base}/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  for (const endpoint of ["verify-otp", "resend-otp"]) {
    const old = await post(endpoint, { email: state.draft.verifiedEmail, otp: "123456" });
    assert.equal(old.status, 410); assert.equal((await old.json()).code, "REGISTRATION_WIZARD_REQUIRED");
  }
  const body = { ...state.registration().body, address: "Fixture address" };
  state.draft.verifiedEmail = "";
  const bypass = await post("register", body); assert.equal(bypass.status, 403); assert.equal(state.users.length, 0);
  state.draft.verifiedEmail = body.email;
  const legacyNames = { ...body, firstName: "Alice", lastName: "Example", role: "admin" }; delete legacyNames.name;
  const created = await post("register", legacyNames);
  const result = await created.json();
  assert.equal(created.status, 201, JSON.stringify(result)); assert.equal(result.user.role, "owner");
  assert.equal(result.user.isVerified, true); assert.equal(result.user.kycStatus, "challenge_passed"); assert.equal(state.users.length, 1);
});

function mockEvidenceDeletion(t, state) {
  t.mock.method(PreKycDocument, "deleteMany", async filter => {
    for (let i = state.documents.length - 1; i >= 0; i--) if (matches(state.documents[i], filter)) state.documents.splice(i, 1);
    return {};
  });
  t.mock.method(PreKycFace, "deleteMany", async () => ({}));
}

for (const role of ["user", "owner"]) test(`${role} can cancel after all verification without creating an account, and stale submissions fail`, async t => {
  const state = await fixture(t, { role, verified: true }); mockEvidenceDeletion(t, state);
  const stale = state.registration(); const savedFields = structuredClone(state.draft.fields);
  const cancelled = response(); await deleteRegistrationDraft(state.req(), cancelled);
  assert.equal(cancelled.statusCode, 200); assert.equal(cancelled.body.cancelled, true);
  assert.equal(state.users.length, 0); assert.equal(state.documents.length, 0);
  assert.equal(activeRegistrationDraft(state.draft), false); assert.deepEqual(state.draft.fields, {});
  const submit = response(); await registerUser(stale, submit); assert.equal(submit.statusCode, 401);
  const save = response(); await saveRegistrationDraft(state.req({ fields: savedFields, revision: 1 }), save); assert.equal(save.statusCode, 410);
  const again = response(); await deleteRegistrationDraft(state.req(), again); assert.equal(again.body.cancelled, true);
});

test("active verification and submission claims prevent cancellation before evidence can be removed", async t => {
  const state = await fixture(t, { verified: true }); mockEvidenceDeletion(t, state);
  state.draft.evidenceUntil = new Date(Date.now() + 30000);
  const running = response(); await deleteRegistrationDraft(state.req(), running);
  assert.equal(running.statusCode, 409); assert.equal(state.documents.length, 1); assert.equal(state.draft.cancelledAt, undefined);
  delete state.draft.evidenceUntil;
  state.draft.submissionDocuments = [{}];
  const submitting = response(); await deleteRegistrationDraft(state.req(), submitting);
  assert.equal(submitting.statusCode, 409); assert.equal(state.documents.length, 1);
});

test("a failed private-file deletion keeps retry references on the cancelled draft", async t => {
  const state = await fixture(t, { verified: true }); mockEvidenceDeletion(t, state);
  const unlink = fs.unlink;
  const failure = t.mock.method(fs, "unlink", async () => { throw Object.assign(new Error("Synthetic locked file"), { code: "EBUSY" }); });
  const cancelled = response(); await deleteRegistrationDraft(state.req(), cancelled);
  assert.equal(cancelled.body.cancelled, true); assert.equal(cancelled.body.cleanupPending, true);
  assert.deepEqual(state.draft.cleanupFileKeys, ["review-fixture.jpg"]); assert.equal(state.documents.length, 0);
  failure.mock.restore();
  assert.equal(await cleanupCancelledRegistration(state.draft), true);
  assert.deepEqual(state.draft.cleanupFileKeys, []);
  await assert.rejects(fs.stat(path.join(process.env.KYC_UPLOAD_DIR, "review-fixture.jpg")), { code: "ENOENT" });
  assert.equal(fs.unlink, unlink);
});

test("owner business corrections block final submission while uncertain readings keep final approval pending", async t => {
  const state = await fixture(t, { role: "owner", verified: true }); const business = state.documents[1];
  business.privateScreening = { automatedCheck: { version: 1, fileHash: business.fileHash, reviewVersion: business.reviewVersion, outcome: "correction_needed", checks: {} } };
  const blocked = response(); await registerUser(state.registration(), blocked);
  assert.equal(blocked.statusCode, 409); assert.equal(state.users.length, 0);
  business.privateScreening.automatedCheck.outcome = "review_needed";
  const allowed = response(); await registerUser(state.registration(), allowed);
  assert.equal(allowed.statusCode, 201); assert.equal(state.users[0].kycStatus, "challenge_passed");
});

test("manual ID assistance requires a current unresolved ID, is idempotent, and grants no approval", async t => {
  const state = await fixture(t, { verified: true }); const id = state.documents[0];
  id.selfieVerification = null; id.detailsMatched = false;
  const req = { preKyc: { email: id.email, role: id.role, sessionId: id.sessionId, draftId: state.draft._id }, body: { documentRevision: id.reviewVersion } };
  const first = response(); await requestRegistrationReview(req, first);
  assert.equal(first.statusCode, 200); assert.ok(state.documents[0].manualReviewRequestedAt);
  const requested = state.documents[0].manualReviewRequestedAt.getTime();
  const again = response(); await requestRegistrationReview(req, again);
  assert.equal(again.statusCode, 200); assert.equal(state.documents[0].manualReviewRequestedAt.getTime(), requested);
  assert.equal(state.documents[0].status, "pending_review"); assert.equal(state.users.length, 0);
  const stale = response(); await requestRegistrationReview({ ...req, body: { documentRevision: "old" } }, stale);
  assert.equal(stale.statusCode, 409);
});

test("replica-set registration uses one transaction for the account, KYC case, evidence, and draft", async t => {
  const state = await fixture(t, { verified: true }); const req = state.registration();
  const documents = state.documents.map(doc => ({ reference: doc._id, docType: doc.docType, documentRevision: doc.reviewVersion, fileHash: doc.fileHash }));
  state.draft.submissionDocuments = documents; state.draft.submissionUntil = new Date(Date.now() + 120000);
  let committed = 0, ended = 0;
  const session = { withTransaction: async fn => { await fn(); committed++; }, endSession: async () => { ended++; } };
  const connection = { readyState: 1, getClient: () => ({ topology: { description: { type: "ReplicaSetWithPrimary" } } }), startSession: async () => session };
  const create = User.create;
  t.mock.method(User, "create", async (input, options) => { assert.equal(options.session, session); assert.ok(Array.isArray(input)); return [await create(input[0])]; });
  const user = await createRegistrationAccount({ name: "Alice Example", email: req.body.email, registrationDraftId: state.draft._id, role: "user", isVerified: true }, state.draft, connection);
  assert.equal(committed, 1); assert.equal(ended, 1); assert.equal(state.users.length, 1);
  assert.equal(state.draft.registeredUser, user._id); assert.equal(state.documents[0].registeredUser, user._id); assert.ok(state.kyc);
  assert.equal(supportsRegistrationTransactions({ readyState: 1, getClient: () => ({ topology: { description: { type: "Single", servers: new Map() } } }) }), false);
});
