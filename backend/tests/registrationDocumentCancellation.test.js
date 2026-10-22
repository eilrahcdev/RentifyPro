import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import axios from "axios";
import express from "express";
import PreKycDocument from "../models/PreKycDocument.js";
import RegistrationDraft from "../models/RegistrationDraft.js";
import User from "../models/User.js";
import kycRouter from "../routes/kyc.routes.js";
import { issuePreKycSession } from "../utils/preKycSession.js";
import { prepareRegistrationDocument, cancelRegistrationDocument, assertRegistrationUpload } from "../controllers/registrationDocument.controller.js";

const id = crypto.randomUUID();
const request = (extra = {}) => ({ params: { docType: "id" }, body: { uploadAttemptId: id, upload_attempt_id: id },
  preKyc: { email: "applicant@example.test", role: "user", sessionId: "fixture-session" },
  registrationDraft: { _id: "fixture-draft", revision: 1, expiresAt: new Date(Date.now() + 3600000) }, ...extra });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const query = value => ({ select() { return this; }, then(resolve) { return Promise.resolve(value).then(resolve); } });
beforeEach(t => { t.mock.method(RegistrationDraft, "findOneAndUpdate", () => query({})); });

test("only draft-owned ID/owner business attempts can be prepared or cancelled", async t => {
  const write = t.mock.method(PreKycDocument, "findOneAndUpdate", async () => { throw Error("Unexpected document write"); });
  for (const handler of [prepareRegistrationDocument, cancelRegistrationDocument]) {
    for (const extra of [{ registrationDraft: null }, { params: { docType: "supporting" } }, { params: { docType: "other" } }]) {
      const res = response(); await handler(request(extra), res); assert.equal(res.statusCode, 403);
    }
  }
  assert.equal(write.mock.callCount(), 0);
});

test("prepare preserves the previous document and uses a fresh, atomically reserved upload ID", async t => {
  const previous = { _id: "document", sessionId: "fixture-session", role: "user", status: "verified", reviewVersion: "previous",
    uploadAttemptId: "previous", fileKey: "previous.png", expiresAt: new Date(Date.now() + 3600000) };
  t.mock.method(PreKycDocument, "findOne", async () => previous);
  t.mock.method(PreKycDocument, "findOneAndUpdate", async (filter, update) => {
    assert.equal(filter.reviewVersion, "previous"); assert.equal(filter.uploadAttemptId, "previous");
    assert.deepEqual(Object.keys(update.$set).sort(), ["uploadAttemptId", "uploadCancelledAt"]);
    return { ...previous, ...update.$set };
  });
  const res = response(); await prepareRegistrationDocument(request(), res);
  assert.equal(res.statusCode, 200); assert.match(res.body.uploadAttemptId, /^[\da-f-]{36}$/);
  assert.notEqual(res.body.uploadAttemptId, id); assert.equal(previous.status, "verified");
});

test("prepare rejects foreign/account documents and active evidence without weakening the lease", async t => {
  for (const existing of [{ registeredUser: "account" }, { sessionId: "another", role: "user", expiresAt: new Date(Date.now() + 10000) }]) {
    t.mock.method(PreKycDocument, "findOne", async () => existing);
    const res = response(); await prepareRegistrationDocument(request(), res); assert.equal(res.statusCode, 409);
    t.mock.restoreAll();
  }
  const res = response(); await prepareRegistrationDocument(request({ registrationDraft: { evidenceUntil: new Date(Date.now() + 10000) } }), res);
  assert.equal(res.statusCode, 409); assert.equal(res.body.code, "REGISTRATION_BUSY");
});

test("preparing a fresh registration never adopts the private bytes or verification of an expired foreign draft", async t => {
  t.mock.method(PreKycDocument, "findOne", async () => ({ _id: "expired-document", sessionId: "expired-foreign-session", role: "owner",
    reviewVersion: "old-version", fileKey: "old-private-file.png", fileHash: "old-hash", expiresAt: new Date(Date.now() - 1) }));
  t.mock.method(PreKycDocument, "findOneAndUpdate", async (_filter, update) => {
    assert.equal(update.$set.sessionId, "fixture-session"); assert.equal(update.$set.role, "user");
    assert.equal(update.$set.fileKey, ""); assert.equal(update.$set.fileHash, ""); assert.equal(update.$set.filePath, "");
    assert.deepEqual(update.$set.profileSnapshot, {}); assert.equal(update.$set.detailsMatched, false);
    assert.equal(update.$set.status, "reupload_required"); assert.notEqual(update.$set.reviewVersion, "old-version");
    assert.deepEqual(update.$setOnInsert, {});
    return { ...update.$set };
  });
  const res = response(); await prepareRegistrationDocument(request(), res); assert.equal(res.statusCode, 200);
  assert.equal("fileKey" in res.body, false);
});

test("cancellation scopes its atomic update to the current unfinished document and only releases its own upload lease", async t => {
  t.mock.method(RegistrationDraft, "findOneAndUpdate", (filter, update) => {
    assert.equal(filter.revision, 1); assert.equal(filter.registeredUser, null); assert.equal(filter.submissionDocuments, null);
    assert.equal(filter.cancelledAt, null); assert.ok(filter.expiresAt.$gt); assert.ok(filter.absoluteExpiresAt.$gt);
    assert.deepEqual(filter.$or.at(-1), { evidenceAttemptId: id });
    assert.equal(update.$set.evidenceAttemptId, id);
    return query({});
  });
  t.mock.method(PreKycDocument, "findOneAndUpdate", async (filter, pipeline) => {
    assert.equal(filter.email, "applicant@example.test"); assert.equal(filter.sessionId, "fixture-session");
    assert.equal(filter.role, "user"); assert.equal(filter.docType, "id"); assert.equal(filter.registeredUser, null);
    assert.deepEqual(filter.$and, [{ $or: [{ reviewVersion: { $ne: id } }, { reviewedAt: null }] }]); assert.ok(filter.expiresAt.$gt);
    assert.deepEqual(filter.$or, [{ uploadAttemptId: id }, { reviewVersion: id, uploadAttemptId: null }]);
    const changes = pipeline[0].$set;
    assert.ok(changes.uploadCancelledAt instanceof Date);
    assert.deepEqual(changes.status.$cond, [{ $eq: ["$reviewVersion", id] }, { $literal: "reupload_required" }, "$status"]);
    assert.deepEqual(changes.selfieVerification.$cond[1], { $literal: null });
    assert.deepEqual(changes.privateScreening.$cond[1], { $literal: null });
    assert.equal("fileKey" in changes, false);
    assert.deepEqual(changes.reviewVersion.$cond[0], { $eq: ["$reviewVersion", id] });
    assert.notEqual(changes.reviewVersion.$cond[1].$literal, id);
    assert.equal(changes.reviewVersion.$cond[2], "$reviewVersion");
    return { reviewVersion: id };
  });
  t.mock.method(RegistrationDraft, "updateOne", async (filter, update) => {
    assert.match(filter.evidenceToken, /^[\da-f-]{36}$/);
    assert.deepEqual({ ...filter, evidenceToken: undefined }, { _id: "fixture-draft", role: "user", sessionId: "fixture-session", evidenceAttemptId: id, evidenceToken: undefined });
    assert.deepEqual(update.$unset, { evidenceToken: "", evidenceUntil: "", evidenceAttemptId: "" });
    return { matchedCount: 1 };
  });
  const res = response(); await cancelRegistrationDocument(request(), res); assert.equal(res.body.cancelled, true);
});

test("malformed, stale, foreign or already reviewed cancellation cannot claim success", async t => {
  const release = t.mock.method(RegistrationDraft, "updateOne", async filter => { assert.ok(filter.evidenceToken); return { matchedCount: 1 }; });
  t.mock.method(PreKycDocument, "findOneAndUpdate", async () => null);
  for (const uploadAttemptId of ["", "$ne", {}, "older-invalid-version", id]) {
    const res = response(); await cancelRegistrationDocument(request({ body: { uploadAttemptId } }), res);
    assert.equal(res.statusCode, uploadAttemptId === id ? 409 : 400); assert.notEqual(res.body.cancelled, true);
  }
  assert.equal(release.mock.callCount(), 1, "Only the well-formed request temporarily claims and releases its cancellation lease");
});

test("a concurrent submission or another verification prevents cancellation before any document write", async t => {
  t.mock.method(RegistrationDraft, "findOneAndUpdate", () => query(null));
  const write = t.mock.method(PreKycDocument, "findOneAndUpdate", async () => { throw Error("Unexpected document mutation"); });
  const res = response(); await cancelRegistrationDocument(request(), res);
  assert.equal(res.statusCode, 409); assert.equal(write.mock.callCount(), 0);
});

test("a failed cancellation restores the existing upload lease instead of unlocking an unfinished verification", async t => {
  const expiresAt = new Date(Date.now() + 10000);
  t.mock.method(RegistrationDraft, "findOneAndUpdate", () => query({ evidenceToken: "original-upload-lease", evidenceAttemptId: id, evidenceUntil: expiresAt }));
  t.mock.method(PreKycDocument, "findOneAndUpdate", async () => { throw Error("Synthetic storage interruption"); });
  t.mock.method(RegistrationDraft, "updateOne", async (filter, update) => {
    assert.notEqual(filter.evidenceToken, "original-upload-lease");
    assert.deepEqual(update, { $set: { evidenceToken: "original-upload-lease", evidenceAttemptId: id, evidenceUntil: expiresAt } });
    return { matchedCount: 1 };
  });
  const res = response(); await cancelRegistrationDocument(request(), res); assert.equal(res.statusCode, 503);
});

test("the cancellation pipeline passes through the installed Mongoose query engine", async t => {
  const write = t.mock.method(PreKycDocument.collection, "findOneAndUpdate", async (filter, pipeline) => {
    assert.equal(filter.uploadCancelledAt, undefined);
    assert.equal(filter.sessionId, "fixture-session");
    assert.ok(Array.isArray(pipeline));
    assert.ok(pipeline[0].$set.uploadCancelledAt instanceof Date);
    return { email: "applicant@example.test", sessionId: "fixture-session", role: "user", docType: "id", reviewVersion: id };
  });
  t.mock.method(RegistrationDraft, "updateOne", async () => ({ matchedCount: 0 }));
  const res = response(); await cancelRegistrationDocument(request(), res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.cancelled, true); assert.equal(write.mock.callCount(), 1);
});

test("cancelled/replaced reservations reject late arrivals while existing clients retain their contract", async t => {
  t.mock.method(PreKycDocument, "exists", async filter => {
    assert.equal(filter.uploadAttemptId, id); assert.equal(filter.uploadCancelledAt, null);
    assert.equal(filter.registeredUser, null); assert.equal(filter.role, "user"); return null;
  });
  await assert.rejects(assertRegistrationUpload(request(), "id"), /cancelled or replaced/);
  assert.equal(await assertRegistrationUpload(request({ body: {} }), "id"), "");
});

test("HTTP document control enforces signed sessions, current draft ownership, email verification and owner-only business documents", async t => {
  const previousSecret = process.env.PRE_KYC_SESSION_SECRET;
  process.env.PRE_KYC_SESSION_SECRET = "synthetic-document-control-secret";
  t.after(() => { if (previousSecret === undefined) delete process.env.PRE_KYC_SESSION_SECRET; else process.env.PRE_KYC_SESSION_SECRET = previousSecret; });
  const draft = { _id: "f".repeat(64), role: "user", sessionId: "fixture-session", fields: { email: "applicant@gmail.com" },
    verifiedEmail: "applicant@gmail.com", emailVerifiedAt: new Date(), createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3600000), absoluteExpiresAt: new Date(Date.now() + 7200000) };
  t.mock.method(RegistrationDraft, "findOne", async filter => filter.sessionId === draft.sessionId && filter.role === draft.role ? draft : null);
  t.mock.method(RegistrationDraft, "updateOne", async () => ({ matchedCount: 1 }));
  t.mock.method(User, "exists", async () => false);
  t.mock.method(PreKycDocument, "findOneAndUpdate", async filter => {
    assert.equal(filter.role, "owner"); assert.equal(filter.sessionId, "fixture-session");
    assert.equal(filter.docType, "supporting"); assert.equal(filter.registeredUser, null);
    return { reviewVersion: id };
  });
  const app = express(); app.use(express.json()); app.use("/api/kyc", kycRouter);
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/kyc/pre/documents`;
  const token = role => issuePreKycSession({ email: "applicant@gmail.com", role, sessionId: "fixture-session", draftId: draft._id }).token;
  const post = (type, sessionToken) => fetch(`${base}/${type}/cancel`, { method: "POST", headers: {
    "content-type": "application/json", ...(sessionToken ? { "x-pre-kyc-token": sessionToken } : {}) }, body: JSON.stringify({ uploadAttemptId: id }) });
  assert.equal((await post("id")).status, 401);
  const renter = token("user"); draft.emailVerifiedAt = null;
  assert.equal((await post("id", renter)).status, 403);
  draft.emailVerifiedAt = new Date();
  assert.equal((await post("supporting", renter)).status, 403);
  draft.sessionId = "foreign-session";
  assert.equal((await post("id", renter)).status, 401);
  draft.sessionId = "fixture-session"; draft.role = "owner"; draft.fields = { businessEmail: "applicant@gmail.com" };
  const owner = token("owner"); const approved = await post("supporting", owner);
  assert.equal(approved.status, 200); assert.equal((await approved.json()).cancelled, true);
  draft.registeredUser = "account";
  assert.equal((await post("supporting", owner)).status, 409);
});

test("a cancelled ID cannot apply a delayed successful face-service response", { timeout: 5000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rentify-cancel-document-"));
  const prior = { KYC_UPLOAD_DIR: process.env.KYC_UPLOAD_DIR, INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
    FACE_SERVICE_URL: process.env.FACE_SERVICE_URL, KYC_DOCUMENT_QUEUE_ENABLED: process.env.KYC_DOCUMENT_QUEUE_ENABLED };
  Object.assign(process.env, { KYC_UPLOAD_DIR: directory, INTERNAL_API_KEY: "fixture-internal-key",
    FACE_SERVICE_URL: "http://face.example.test", KYC_DOCUMENT_QUEUE_ENABLED: "false" });
  t.after(async () => { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await fs.rm(directory, { recursive: true, force: true }); });
  const { preRegisterIdFace } = await import("../controllers/kyc.controller.js?cancelled-face-result");
  let cancelled = false, stored, resolveFace, enteredFace;
  const faceStarted = new Promise(resolve => { enteredFace = resolve; });
  t.mock.method(PreKycDocument, "exists", async () => !cancelled);
  t.mock.method(PreKycDocument, "findOne", () => query({ _id: "document", uploadAttemptId: id,
    sessionId: "fixture-session", role: "user", expiresAt: new Date(Date.now() + 10000) }));
  t.mock.method(PreKycDocument, "findOneAndUpdate", async (filter, update) => {
    assert.equal(filter.uploadAttemptId, id); assert.equal(filter.uploadCancelledAt, null);
    stored = { _id: "document", ...update.$set }; return stored;
  });
  t.mock.method(axios, "post", async () => { enteredFace(); return new Promise(resolve => { resolveFace = resolve; }); });
  const image = Buffer.alloc(40); Buffer.from([137,80,78,71,13,10,26,10]).copy(image);
  const req = request({ body: { upload_attempt_id: id, id_image_base64: image.toString("base64"),
    id_image_mime: "image/png", id_type: "Philippine Passport", full_name: "Sample Applicant", user_profile: { full_name: "Sample Applicant" } } });
  const res = response(); const upload = preRegisterIdFace(req, res); await faceStarted;
  assert.equal(stored.reviewVersion, id); cancelled = true; stored.status = "reupload_required";
  resolveFace({ data: { success: true } }); await upload;
  assert.equal(res.statusCode, 409); assert.notEqual(res.body.success, true); assert.equal(stored.status, "reupload_required");
});
