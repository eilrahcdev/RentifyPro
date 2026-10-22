import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import axios from "axios";
import express from "express";
import cookieParser from "cookie-parser";
import kycRouter from "../routes/kyc.routes.js";
import RegistrationDraft from "../models/RegistrationDraft.js";
import User from "../models/User.js";
import PreKycDocument from "../models/PreKycDocument.js";
import PreKycFace from "../models/PreKycFace.js";
import { getRegistrationDraft, saveRegistrationDraft, registrationDraftGuard, registrationRecoveryState, deleteRegistrationDraft } from "../controllers/registrationDraft.controller.js";
import { activeRegistrationDraft, assertActiveRegistrationDraft, selectRegistrationFields, validRegistrationStep, DRAFT_IDLE_MS, DRAFT_MAX_MS } from "../utils/registrationDraft.js";
import { isBoundPreKycFace, isPreKycFaceVerified } from "../utils/preKycFace.js";
import { verifyPreKycSession, issuePreKycSession, renewPreKycSession } from "../utils/preKycSession.js";
import { requirePreKycSession } from "../middleware/preKycSession.middleware.js";
import { purgeExpiredKycFiles } from "../jobs/kycFileCleanup.job.js";
import { readPrivateKycEvidence } from "../services/privateKycReviewContext.js";

const fields = { firstName: "Alice", lastName: "Example", email: "alice@gmail.com", phone: "9123456789", dateOfBirth: "1995-01-01",
  gender: "Female", region: "01", province: "0101", city: "010101", barangay: "010101001",
  emergencyContactName: "Bob Example", emergencyContactPhone: "9987654321", emergencyContactRelationship: "Friend", idType: "Philippine Passport" };
const ownerFields = { ...fields, businessEmail: "owner@gmail.com", ownerType: "business", businessName: "Example Transport",
  permitNumber: "TEST123", supportingDocType: "DTI Business Name Registration" };
const cookie = "a".repeat(64);
const id = crypto.createHash("sha256").update(cookie).digest("hex");
const draft = (extra = {}) => ({ _id: id, role: "user", sessionId: "fixture-session", fields,
  verifiedEmail: fields.email, emailVerifiedAt: new Date(),
  revision: 1, step: 5, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + DRAFT_IDLE_MS),
  absoluteExpiresAt: new Date(Date.now() + DRAFT_MAX_MS), ...extra });
const req = (extra = {}) => ({ query: { role: "user" }, headers: { "x-registration-draft": "1" }, cookies: { rentify_registration_user: cookie }, ...extra });
const res = () => ({ statusCode: 200, cookies: [], status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }, cookie(...args) { this.cookies.push(args); }, clearCookie(...args) { this.cleared = args; } });
const query = value => ({ select() { return this; }, sort() { return this; }, async lean() { return value; } });
function emptyKyc(t) { t.mock.method(PreKycDocument, "find", () => query([])); t.mock.method(PreKycDocument, "updateMany", async () => ({ matchedCount: 0 })); }
function secret(t) { const prior = process.env.PRE_KYC_SESSION_SECRET; process.env.PRE_KYC_SESSION_SECRET = "registration-draft-fixture-only-secret";
  t.after(() => { if (prior === undefined) delete process.env.PRE_KYC_SESSION_SECRET; else process.env.PRE_KYC_SESSION_SECRET = prior; }); }
async function privateFile(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rentify-registration-"));
  const prior = process.env.KYC_UPLOAD_DIR; process.env.KYC_UPLOAD_DIR = directory;
  const bytes = Buffer.from("synthetic private evidence");
  await fs.writeFile(path.join(directory, "review-fixture.jpg"), bytes);
  t.after(async () => { if (prior === undefined) delete process.env.KYC_UPLOAD_DIR; else process.env.KYC_UPLOAD_DIR = prior;
    await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, bytes };
}
const document = bytes => ({ _id: "fixture-document", email: fields.email, role: "user", sessionId: "fixture-session", docType: "id",
  status: "verified", detailsMatched: true, provider: "manual", selectedDocCategory: fields.idType,
  reviewVersion: "version-one", fileKey: "review-fixture.jpg", fileHash: crypto.createHash("sha256").update(bytes).digest("hex"),
  profileSnapshot: { full_name: "Alice Example", date_of_birth: fields.dateOfBirth }, expiresAt: new Date(Date.now() + DRAFT_MAX_MS) });
const face = doc => ({ email: doc.email, role: doc.role, sessionId: doc.sessionId, status: "approved", idDocumentHash: doc.fileHash,
  idDocumentRevision: doc.reviewVersion, expiresAt: new Date(Date.now() + DRAFT_IDLE_MS) });

test("draft guard rejects cross-origin, simple form and wrong-role requests", () => {
  for (const request of [req({ headers: {} }), req({ headers: { "x-registration-draft": "1", origin: "https://attacker.example" } }), req({ query: { role: "admin" } })]) {
    const response = res(); let next = false;
    registrationDraftGuard(request, response, () => { next = true; });
    assert.equal(next, false); assert.ok(response.statusCode >= 400);
  }
});
test("drafts allowlist fields and never store passwords, files, consent or verification claims", async t => {
  secret(t); emptyKyc(t);
  t.mock.method(RegistrationDraft, "create", async record => {
    assert.deepEqual(record.fields, selectRegistrationFields("user", fields));
    assert.equal(JSON.stringify(record).includes("plaintext-secret"), false);
    return draft(record);
  });
  const response = res();
  await saveRegistrationDraft(req({ cookies: {}, body: { fields: { ...fields, password: "plaintext-secret", confirmPassword: "plaintext-secret",
    selfieVerified: true, idCardFile: "base64", preKycToken: "private", agree: true }, step: 5, revision: null } }), response);
  assert.equal(response.statusCode, 200); assert.equal(response.body.draft.step, 4);
  const [name, token, options] = response.cookies[0];
  assert.equal(name, "rentify_registration_user"); assert.match(token, /^[a-f0-9]{64}$/); assert.equal(options.httpOnly, true);
  assert.notEqual(token, response.body.draft._id);
  const signed = verifyPreKycSession(response.body.preKycToken);
  assert.ok(signed.sessionId);
  assert.equal(signed.email, fields.email);
  assert.equal(signed.draftId, crypto.createHash("sha256").update(token).digest("hex"));
});
test("only the cookie owner and role can recover; reads never extend expiry", async t => {
  secret(t); emptyKyc(t); const current = draft();
  t.mock.method(RegistrationDraft, "findOne", async filter => { assert.equal(filter._id, id); assert.equal(filter.role, "user"); return current; });
  const update = t.mock.method(RegistrationDraft, "findOneAndUpdate", async () => { throw Error("GET cannot update"); });
  const response = res(); await getRegistrationDraft(req(), response);
  assert.equal(response.body.draft.recovered, true); assert.equal(response.body.draft.expiresAt, current.expiresAt);
  assert.equal(update.mock.callCount(), 0);
  const anonymous = res(); await getRegistrationDraft(req({ cookies: {} }), anonymous); assert.equal(anonymous.body.draft, null);
});
test("expired, deleted and malformed cookie-owned drafts cannot be revived by saving", async t => {
  const update = t.mock.method(RegistrationDraft, "findOneAndUpdate", async () => { throw Error("Cannot revive expired draft"); });
  const response = res(); t.mock.method(RegistrationDraft, "findOne", async () => draft({ expiresAt: new Date(Date.now() - 1) }));
  await saveRegistrationDraft(req({ body: { fields, revision: 1 } }), response); assert.equal(response.statusCode, 410);
  const deleted = res(); t.mock.method(RegistrationDraft, "findOne", async () => null); await getRegistrationDraft(req(), deleted); assert.equal(deleted.statusCode, 410);
  const forged = res(); await getRegistrationDraft(req({ cookies: { rentify_registration_user: "forged" } }), forged); assert.equal(forged.statusCode, 401);
  assert.equal(update.mock.callCount(), 0);
  assert.equal(activeRegistrationDraft(draft({ absoluteExpiresAt: new Date(Date.now() - 1) })), false);
});
test("stale tabs and racing autosaves cannot overwrite newer data", async t => {
  t.mock.method(RegistrationDraft, "findOne", async () => draft());
  const update = t.mock.method(RegistrationDraft, "findOneAndUpdate", async filter => {
    assert.equal(filter._id, id); assert.equal(filter.revision, 1); assert.ok(filter.expiresAt.$gt); return null;
  });
  const stale = res(); await saveRegistrationDraft(req({ body: { fields, revision: 0 } }), stale);
  assert.equal(stale.statusCode, 409); assert.equal(update.mock.callCount(), 0);
  const race = res(); await saveRegistrationDraft(req({ body: { fields, revision: 1 } }), race);
  assert.equal(race.statusCode, 409); assert.equal(update.mock.callCount(), 1);
});
test("recovery restores a current private ID and version-bound selfie; mismatched or missing evidence rolls progress back", async t => {
  const { bytes, directory } = await privateFile(t); const doc = document(bytes); const verified = face(doc);
  t.mock.method(PreKycDocument, "find", filter => { assert.equal(filter.sessionId, "fixture-session"); assert.equal(filter.role, "user"); assert.ok(filter.expiresAt.$gt); return query([doc]); });
  t.mock.method(PreKycFace, "findOne", () => query(verified));
  const recovered = await registrationRecoveryState(draft());
  assert.equal(recovered.step, 5); assert.equal(recovered.selfieVerified, true); assert.equal(recovered.documents[0].reference, doc._id);
  for (const key of ["fileKey", "fileHash", "profileSnapshot", "manualComparison", "privateScreening"]) assert.equal(key in recovered.documents[0], false);
  assert.equal((await registrationRecoveryState(draft({ fields: { ...fields, lastName: "Changed" } }))).selfieVerified, false);
  doc.reviewVersion = "replacement"; assert.equal((await registrationRecoveryState(draft())).step, 4);
  doc.reviewVersion = "version-one"; verified.expiresAt = new Date(Date.now() - 1); assert.equal((await registrationRecoveryState(draft())).selfieVerified, false);
  await fs.unlink(path.join(directory, doc.fileKey)); const missing = await registrationRecoveryState(draft());
  assert.equal(missing.step, 4); assert.equal(missing.documents[0].available, false); assert.equal(missing.documents[0].status, "reupload_required");
});
test("backend completeness restricts every renter and owner step without treating a lost password as lost progress", () => {
  const idDoc = { docType: "id", profileMatches: true, identityReadyForSelfie: true, status: "verified" };
  const supporting = { docType: "supporting", profileMatches: true, status: "pending_review" };
  for (const role of ["user", "owner"]) for (let step = 1; step <= 5; step++)
    assert.equal(validRegistrationStep(role, role === "user" ? fields : ownerFields, step, [idDoc, supporting], true, true), step);
  assert.equal(validRegistrationStep("user", { ...fields, phone: "invalid" }, 5, [idDoc], true), 1);
  assert.equal(validRegistrationStep("user", { ...fields, dateOfBirth: "2015-01-01" }, 5, [idDoc], true), 2);
  assert.equal(validRegistrationStep("user", { ...fields, dateOfBirth: "1995-02-31" }, 5, [idDoc], true), 2);
  assert.equal(validRegistrationStep("user", { ...fields, city: "" }, 5, [idDoc], true), 3);
  assert.equal(validRegistrationStep("owner", ownerFields, 5, [idDoc], true, true), 4);
  assert.equal(validRegistrationStep("user", fields, 5, [idDoc], true, false), 4);
  assert.equal(validRegistrationStep("user", fields, 5, [idDoc], false), 4);
});
test("selfie binding rejects stale document versions, roles, sessions, expiry and legacy unbound results", async t => {
  const doc = document(Buffer.from("fixture")); const verified = face(doc);
  assert.equal(isBoundPreKycFace(verified, doc), true);
  for (const changed of [{ role: "owner" }, { sessionId: "other" }, { idDocumentHash: "replacement" }, { idDocumentRevision: "replacement" },
    { idDocumentRevision: "" }, { expiresAt: new Date(Date.now() - 1) }]) assert.equal(isBoundPreKycFace({ ...verified, ...changed }, doc), false);
  t.mock.method(PreKycFace, "findOne", () => query(verified)); t.mock.method(PreKycDocument, "findOne", () => query(doc));
  assert.equal(await isPreKycFaceVerified(fields.email, doc.sessionId), true);
  doc.status = "rejected"; assert.equal(await isPreKycFaceVerified(fields.email, doc.sessionId), false);
});
test("draft-bound KYC tokens retain the draft through renewal and reject restart/expiry", async t => {
  secret(t); const current = draft();
  const issued = issuePreKycSession({ email: fields.email, role: "user", sessionId: current.sessionId, draftId: id });
  const session = verifyPreKycSession(renewPreKycSession(issued.token).token); assert.equal(session.draftId, id);
  t.mock.method(RegistrationDraft, "findOne", async () => current);
  await assertActiveRegistrationDraft(session);
  current.sessionId = "changed";
  t.mock.method(RegistrationDraft, "findOne", async () => null);
  const response = res(); let next = false;
  await requirePreKycSession({ headers: { "x-pre-kyc-token": issued.token } }, response, () => { next = true; });
  assert.equal(response.statusCode, 401); assert.equal(next, false);
});
test("private cleanup preserves active evidence even past nominal file retention and purges expired drafts", async t => {
  const { directory } = await privateFile(t); const expired = path.join(directory, "review-orphan.jpg");
  await fs.writeFile(expired, "orphan"); const old = new Date(Date.now() - 80 * 60 * 60 * 1000);
  await fs.utimes(expired, old, old); await fs.utimes(path.join(directory, "review-fixture.jpg"), old, old);
  const purge = t.mock.method(RegistrationDraft, "deleteMany", async filter => { assert.ok(filter.$or[0].expiresAt.$lte); return {}; });
  t.mock.method(RegistrationDraft, "find", () => ({ select() { return this; }, limit() { return this; }, lean: async () => [] }));
  t.mock.method(PreKycDocument, "find", () => ({ select() { return this; }, limit() { return this; }, lean: async () => [] }));
  t.mock.method(PreKycDocument, "exists", async filter => filter.fileKey === "review-fixture.jpg");
  assert.equal(await purgeExpiredKycFiles(), 1); assert.equal(purge.mock.callCount(), 1);
  await assert.doesNotReject(fs.stat(path.join(directory, "review-fixture.jpg"))); await assert.rejects(fs.stat(expired), { code: "ENOENT" });
});
test("a completed registration clears its draft without deleting approved evidence", async t => {
  t.mock.method(RegistrationDraft, "findOne", filter => { assert.equal(filter._id, id); return { select: async () => draft({ registeredUser: "507f1f77bcf86cd799439011" }) }; });
  const documents = t.mock.method(PreKycDocument, "deleteMany", async () => { throw Error("Approved evidence must remain"); });
  const response = res(); await deleteRegistrationDraft(req({ body: { complete: true } }), response);
  assert.equal(response.statusCode, 200); assert.equal(documents.mock.callCount(), 0); assert.equal(response.cleared[0], "rentify_registration_user");
});

test("repeated uploads retain one private file, stored-reference rescreening creates no new file, and failed writes clean up", async t => {
  const { directory } = await privateFile(t);
  const priorProvider = process.env.KYC_DOCUMENT_PROVIDER, priorQueue = process.env.KYC_DOCUMENT_QUEUE_ENABLED;
  process.env.KYC_DOCUMENT_PROVIDER = "manual"; process.env.KYC_DOCUMENT_QUEUE_ENABLED = "false";
  t.after(() => { if (priorProvider === undefined) delete process.env.KYC_DOCUMENT_PROVIDER; else process.env.KYC_DOCUMENT_PROVIDER = priorProvider;
    if (priorQueue === undefined) delete process.env.KYC_DOCUMENT_QUEUE_ENABLED; else process.env.KYC_DOCUMENT_QUEUE_ENABLED = priorQueue; });
  const { preVerifySupportingDocument } = await import("../controllers/kyc.controller.js?registration-upload-cleanup");
  let stored = null, failWrite = false;
  const query = value => ({ select() { return this; }, lean: async () => value, then(resolve) { return Promise.resolve(value).then(resolve); } });
  t.mock.method(PreKycDocument, "findOne", filter => query(filter.reviewVersion && filter.reviewVersion !== stored?.reviewVersion ? null : stored));
  t.mock.method(PreKycDocument, "exists", async filter => stored?.fileKey === filter.fileKey);
  t.mock.method(PreKycDocument, "findOneAndUpdate", async (filter, update) => {
    if (failWrite) throw Error("Synthetic database interruption");
    if (stored) assert.equal(filter.reviewVersion.$eq, stored.reviewVersion);
    else assert.equal(filter.reviewVersion.$exists, false);
    stored = { _id: "fixture-supporting", ...stored, ...update.$set }; return stored;
  });
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("synthetic document")]);
  const profile = { full_name: "Alice Example", first_name: "Alice", last_name: "Example", business_name: "Example Transport", permit_number: "TEST123" };
  const request = (body = {}) => ({ preKyc: { email: "owner@gmail.com", role: "owner", sessionId: "fixture-session" },
    body: { doc_image_base64: bytes.toString("base64"), doc_image_mime: "image/png", supporting_doc_type: ownerFields.supportingDocType, user_profile: profile, ...body } });
  const before = (await fs.readdir(directory)).length;
  const first = res(); await preVerifySupportingDocument(request(), first); assert.equal(first.statusCode, 200);
  assert.equal((await fs.readdir(directory)).length, before + 1);
  const firstRevision = stored.reviewVersion; const firstKey = stored.fileKey;
  const repeat = res(); await preVerifySupportingDocument(request(), repeat); assert.equal(repeat.statusCode, 200);
  assert.equal(stored.reviewVersion, firstRevision); assert.equal((await fs.readdir(directory)).length, before + 1);
  const resumed = res(); await preVerifySupportingDocument(request({ doc_image_base64: "", document_revision: firstRevision,
    user_profile: { ...profile, permit_number: "CORRECTED" } }), resumed);
  assert.equal(resumed.statusCode, 200); assert.notEqual(stored.reviewVersion, firstRevision); assert.equal(stored.fileKey, firstKey);
  assert.equal((await fs.readdir(directory)).length, before + 1);
  const stale = res(); await preVerifySupportingDocument(request({ doc_image_base64: "", document_revision: firstRevision }), stale);
  assert.equal(stale.statusCode, 409);
  failWrite = true; const failed = res(); await preVerifySupportingDocument(request({ user_profile: { ...profile, permit_number: "NEW" } }), failed);
  assert.equal(failed.statusCode, 500); assert.equal((await fs.readdir(directory)).length, before + 1);
});

test("5 MB IDs and business documents survive upload and private recovery while selfies retain their 4 MB limit", async t => {
  const { directory } = await privateFile(t);
  const prior = { KYC_DOCUMENT_PROVIDER: process.env.KYC_DOCUMENT_PROVIDER, KYC_DOCUMENT_QUEUE_ENABLED: process.env.KYC_DOCUMENT_QUEUE_ENABLED,
    KYC_DOC_MAX_BYTES: process.env.KYC_DOC_MAX_BYTES, KYC_IMAGE_MAX_BYTES: process.env.KYC_IMAGE_MAX_BYTES,
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY, FACE_SERVICE_URL: process.env.FACE_SERVICE_URL };
  process.env.KYC_DOCUMENT_PROVIDER = "manual"; process.env.KYC_DOCUMENT_QUEUE_ENABLED = "false";
  process.env.INTERNAL_API_KEY = "document-upload-test-only-key"; process.env.FACE_SERVICE_URL = "http://face-service.example.test";
  delete process.env.KYC_DOC_MAX_BYTES; delete process.env.KYC_IMAGE_MAX_BYTES;
  t.after(() => { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const { preVerifySupportingDocument, preRegisterIdFace, preSelfieVerify } = await import("../controllers/kyc.controller.js?five-mb-documents");
  const bytes = Buffer.alloc(5 * 1024 * 1024);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  let stored;
  const result = value => ({ select() { return this; }, lean: async () => value, then(resolve) { return Promise.resolve(value).then(resolve); } });
  t.mock.method(PreKycDocument, "findOne", () => result(null));
  t.mock.method(PreKycDocument, "findOneAndUpdate", async (_filter, update) => (stored = { _id: "fixture-upload", ...update.$set }));
  t.mock.method(axios, "post", async () => ({ data: { success: true } }));
  const preKyc = { email: "owner@gmail.com", role: "owner", sessionId: "fixture-session" };
  const profile = { full_name: "Alice Example", business_name: "Example Transport", permit_number: "TEST123" };
  for (const type of ["supporting", "id"]) {
    const handler = type === "supporting" ? preVerifySupportingDocument : preRegisterIdFace;
    const body = type === "supporting" ? { doc_image_base64: bytes.toString("base64"), doc_image_mime: "image/png",
      supporting_doc_type: ownerFields.supportingDocType, user_profile: profile }
      : { id_image_base64: bytes.toString("base64"), id_image_mime: "image/png", id_type: fields.idType, full_name: "Alice Example", user_profile: profile };
    const accepted = res(); await handler({ preKyc, body }, accepted);
    assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
    assert.equal(stored.fileSize, bytes.length);
    assert.deepEqual(await readPrivateKycEvidence(stored, directory), bytes);
    const rejected = res(); await handler({ preKyc, body: { ...body,
      [type === "supporting" ? "doc_image_base64" : "id_image_base64"]: Buffer.concat([bytes, Buffer.from([0])]).toString("base64") } }, rejected);
    assert.equal(rejected.statusCode, 413);
  }
  const selfie = res(); await preSelfieVerify({ preKyc, body: { selfie_image_base64: bytes.toString("base64") } }, selfie);
  assert.equal(selfie.statusCode, 413);
  assert.match(selfie.body.message, /4 MB/);
  const forged = { ...stored, fileHash: "incorrect" };
  await assert.rejects(readPrivateKycEvidence(forged, directory), /integrity/);
  const oversized = Buffer.concat([bytes, Buffer.from([0])]);
  await fs.writeFile(path.join(directory, "oversized.png"), oversized);
  for (const invalidLimit of ["not-a-size", "Infinity", "-1", "10000000"]) {
    process.env.KYC_DOC_MAX_BYTES = invalidLimit;
    await assert.rejects(readPrivateKycEvidence({ ...stored, fileKey: "oversized.png",
      fileHash: crypto.createHash("sha256").update(oversized).digest("hex") }, directory), /cannot be reviewed securely/);
  }
});

test("a document replacement during face matching cannot persist an approved selfie", async t => {
  const { bytes } = await privateFile(t);
  const priorFace = process.env.FACE_SERVICE_URL, priorKey = process.env.INTERNAL_API_KEY;
  process.env.FACE_SERVICE_URL = "http://127.0.0.1:8010"; process.env.INTERNAL_API_KEY = "synthetic-internal-fixture-key";
  t.after(() => { if (priorFace === undefined) delete process.env.FACE_SERVICE_URL; else process.env.FACE_SERVICE_URL = priorFace;
    if (priorKey === undefined) delete process.env.INTERNAL_API_KEY; else process.env.INTERNAL_API_KEY = priorKey; });
  const { preSelfieVerify } = await import("../controllers/kyc.controller.js?registration-selfie-race");
  const doc = document(bytes); let current = doc;
  t.mock.method(PreKycDocument, "findOne", filter => query(filter.reviewVersion && filter.reviewVersion !== current.reviewVersion ? null : current));
  const write = t.mock.method(PreKycFace, "findOneAndUpdate", async () => { throw Error("Stale face cannot be saved"); });
  const provider = t.mock.method(axios, "post", async (url, body) => {
    assert.equal(body.user_id, "pre:fixture-session:version-one");
    if (url.endsWith("/selfie/verify")) current = { ...doc, reviewVersion: "replacement", fileHash: "replacement" };
    return { data: { success: true, verified: true } };
  });
  const response = res(); await preSelfieVerify({ preKyc: { email: fields.email, role: "user", sessionId: doc.sessionId },
    body: { selfie_image_base64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64") } }, response);
  assert.equal(response.statusCode, 409); assert.equal(response.body.verified, false);
  assert.equal(provider.mock.callCount(), 2); assert.equal(write.mock.callCount(), 0);
});

test("atomic document verification preserves the current selfie even when a delayed legacy summary is stale", async t => {
  const doc = document(Buffer.from("fixture"));
  doc.selfieVerification = { ...face(doc), verifiedAt: new Date() };
  t.mock.method(PreKycDocument, "findOne", () => query(doc));
  const legacy = t.mock.method(PreKycFace, "findOne", () => { throw Error("Current approval must not depend on the legacy summary"); });
  assert.equal(await isPreKycFaceVerified(fields.email, doc.sessionId), true);
  assert.equal(legacy.mock.callCount(), 0);
  doc.selfieVerification.status = "rejected";
  assert.equal(isBoundPreKycFace(face(doc), doc), false);
  doc.selfieVerification.status = "approved"; doc.reviewVersion = "replacement";
  assert.equal(isBoundPreKycFace(face(doc), doc), false);
});

test("HTTP draft recovery uses private cookies and no-store responses, enforcing role ownership and expiry", async t => {
  secret(t); emptyKyc(t);
  t.mock.method(User, "exists", async () => false);
  t.mock.method(PreKycDocument, "deleteMany", async () => ({}));
  t.mock.method(PreKycFace, "deleteMany", async () => ({}));
  const records = new Map();
  t.mock.method(RegistrationDraft, "create", async input => { const record = draft({ ...input }); records.set(record._id, record); return record; });
  t.mock.method(RegistrationDraft, "findOne", filter => ({ select() { return this; }, then(resolve) {
    const record = records.get(filter._id); return Promise.resolve(record?.role === filter.role ? record : null).then(resolve);
  } }));
  t.mock.method(RegistrationDraft, "findOneAndUpdate", async (filter, update) => {
    const record = records.get(filter._id); if (!record || record.cancelledAt) return null;
    Object.assign(record, update.$set); return record;
  });
  t.mock.method(RegistrationDraft, "updateOne", async () => ({ matchedCount: 1 }));
  t.mock.method(RegistrationDraft, "findOneAndDelete", async filter => {
    const record = records.get(filter._id); if (record?.role !== filter.role) return null;
    records.delete(filter._id); return record;
  });
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use("/api/kyc", kycRouter);
  const server = await new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/kyc/pre/draft`;
  const headers = { "Content-Type": "application/json", "x-registration-draft": "1" };
  const created = await fetch(`${base}?role=user`, { method: "POST", headers,
    body: JSON.stringify({ fields: { ...fields, password: "must-never-persist" }, step: 4, revision: null }) });
  assert.equal(created.status, 200);
  const setCookie = created.headers.get("set-cookie"); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Path=\/api\/kyc\/pre/);
  assert.match(created.headers.get("cache-control"), /no-store/);
  const cookieHeader = setCookie.split(";")[0]; const createdBody = await created.json(); assert.equal(createdBody.draft.fields.password, undefined);
  const restored = await fetch(`${base}?role=user`, { headers: { ...headers, cookie: cookieHeader } });
  assert.equal(restored.status, 200); assert.equal((await restored.json()).draft.step, 4);
  const wrongRole = await fetch(`${base}?role=owner`, { headers: { ...headers, cookie: cookieHeader } });
  assert.equal((await wrongRole.json()).draft, null);
  const unauthenticated = await fetch(`${base}?role=user&email=${fields.email}`, { headers }); assert.equal((await unauthenticated.json()).draft, null);
  const simpleForm = await fetch(`${base}?role=user`, { method: "POST", headers: { "Content-Type": "application/json", cookie: cookieHeader }, body: "{}" });
  assert.equal(simpleForm.status, 403);
  records.values().next().value.expiresAt = new Date(Date.now() - 1);
  const expired = await fetch(`${base}?role=user`, { headers: { ...headers, cookie: cookieHeader } }); assert.equal(expired.status, 410);
  const cleared = await fetch(`${base}?role=user`, { method: "DELETE", headers: { ...headers, cookie: cookieHeader }, body: JSON.stringify({ complete: true }) });
  assert.equal(cleared.status, 200); assert.match(cleared.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
  assert.equal(records.size, 1);
  assert.ok(records.values().next().value.cancelledAt);
  const cancelled = await fetch(`${base}?role=user`, { headers: { ...headers, cookie: cookieHeader } });
  assert.equal(cancelled.status, 410);
});

test("legacy recovery adopts uploads only with their signed session and infers missing document selections", async t => {
  t.mock.method(PreKycDocument, "updateMany", async () => ({ matchedCount: 1 }));
  secret(t); const { bytes } = await privateFile(t); const doc = document(bytes);
  const session = issuePreKycSession({ email: fields.email, role: "user", sessionId: doc.sessionId });
  t.mock.method(PreKycDocument, "find", filter => { assert.equal(filter.sessionId, doc.sessionId); return query([doc]); });
  t.mock.method(PreKycFace, "findOne", () => query(null));
  t.mock.method(RegistrationDraft, "create", async record => {
    assert.equal(record.sessionId, session.sessionId); assert.equal(record.fields.idType, doc.selectedDocCategory);
    return draft(record);
  });
  const legacyFields = { ...fields }; delete legacyFields.idType;
  const response = res(); await saveRegistrationDraft(req({ cookies: {}, body: { fields: legacyFields, step: 5, revision: null, previousToken: session.token } }), response);
  assert.equal(response.statusCode, 200); assert.equal(response.body.draft.documents[0].available, true);
  assert.equal(response.body.draft.documents[0].profileMatches, true); assert.equal(response.body.draft.step, 4);
  const forged = res(); await saveRegistrationDraft(req({ cookies: {}, body: { fields, previousToken: "forged" } }), forged);
  assert.equal(forged.statusCode, 401);
});

test("draft lifetime respects a shorter existing KYC session renewal policy", async t => {
  t.mock.method(PreKycDocument, "updateMany", async () => ({ matchedCount: 0 }));
  secret(t); emptyKyc(t);
  const prior = process.env.PRE_KYC_SESSION_MAX_RENEWAL_HOURS; process.env.PRE_KYC_SESSION_MAX_RENEWAL_HOURS = "2";
  t.after(() => { if (prior === undefined) delete process.env.PRE_KYC_SESSION_MAX_RENEWAL_HOURS; else process.env.PRE_KYC_SESSION_MAX_RENEWAL_HOURS = prior; });
  t.mock.method(RegistrationDraft, "create", async record => {
    assert.ok(new Date(record.absoluteExpiresAt).getTime() <= Date.now() + 2 * 60 * 60 * 1000);
    return draft(record);
  });
  const response = res(); await saveRegistrationDraft(req({ cookies: {}, body: { fields, step: 1, revision: null } }), response);
  assert.equal(response.statusCode, 200);
});
