import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import axios from "axios";
import PreKycDocument from "../models/PreKycDocument.js";
import KycVerification from "../models/KycVerification.js";
import User from "../models/User.js";
import { getAccountVerification } from "../services/accountVerification.service.js";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rentify-account-documents-"));
process.env.KYC_UPLOAD_DIR = directory;
process.env.INTERNAL_API_KEY = "synthetic-internal-key-only";
process.env.KYC_DOCUMENT_PROVIDER = "manual";
process.env.KYC_DOCUMENT_QUEUE_ENABLED = "false";
process.env.FACE_SERVICE_AUTOSTART = "false";
const { replaceAccountDocument, selfieVerify, registerReverificationId, internalUpdateStatus } = await import("../controllers/kyc.controller.js");
test.after(async () => { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); await fs.rm(directory, { recursive: true, force: true }); });
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRmkAAAAASUVORK5CYII=";
const userId = "507f1f77bcf86cd799439011";
const query = value => ({ select() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const at = (object, key) => key.split(".").reduce((entry, part) => entry?.[part], object);
function match(object, filter) {
  return Boolean(object) && Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some(entry => match(object, entry));
    const actual = at(object, key);
    if (value === null) return actual == null;
    if (value && typeof value === "object" && !(value instanceof Date)) return Object.entries(value).every(([op, expected]) =>
      op === "$eq" ? actual == expected : op === "$in" ? expected.includes(actual) : op === "$exists" ? (actual !== undefined) === expected
        : op === "$lte" ? actual <= expected : op === "$gt" ? actual > expected : false);
    return value instanceof Date ? new Date(actual).getTime() === value.getTime() : String(actual) === String(value);
  });
}
function write(object, update) {
  for (const [key, value] of Object.entries(update.$set || update)) {
    if (key.startsWith("$")) continue;
    const parts = key.split("."); const leaf = parts.pop(); parts.reduce((obj, part) => obj[part] ||= {}, object)[leaf] = value;
  }
  for (const key of Object.keys(update.$unset || {})) delete object[key];
  object.updatedAt = new Date(); return object;
}
function fixture(t) {
  const user = { _id: userId, email: "owner@gmail.com", role: "owner", name: "Sample Applicant", businessName: "Sample Rentals",
    permitNumber: "PERMIT123", isVerified: true, kycStatus: "approved", registrationDraftId: "draft" };
  const kyc = { _id: "case", user: userId, status: "approved", idDocumentHash: "original-id-hash", challengePassedAt: new Date(),
    registrationSessionId: "registration", registrationDocumentVersions: { id: "id-v1", supporting: "business-v1" }, updatedAt: new Date() };
  const docs = ["id", "supporting"].map((docType, index) => ({ _id: index ? "507f1f77bcf86cd799439014" : "507f1f77bcf86cd799439012",
    email: user.email, role: "owner", sessionId: "registration", registeredUser: userId, docType, status: "verified", provider: "gemini",
    detailsMatched: true, fileHash: index ? "original-business-hash" : "original-id-hash", fileKey: "prior-fixture.png",
    reviewVersion: index ? "business-v1" : "id-v1", selectedDocCategory: index ? "DTI Business Name Registration" : "Philippine Passport",
    profileSnapshot: { full_name: user.name, first_name: "Sample", last_name: "Applicant", business_name: user.businessName,
      permit_number: user.permitNumber, tax_identification_number: index ? "123456789" : undefined, branch_code: index ? "000" : undefined },
    reviewHistory: [{ action: "approve", reviewVersion: index ? "business-v1" : "id-v1" }] }));
  const requests = [];
  t.mock.method(axios, "post", async (url, body) => { requests.push({ url, body }); return { data: url.endsWith("/register") ? { success: true } : { verified: true } }; });
  t.mock.method(User, "findById", () => query(user));
  t.mock.method(User, "updateOne", async (filter, update) => { if (match(user, filter)) write(user, update); return { matchedCount: 1 }; });
  t.mock.method(KycVerification, "findOne", async filter => match(kyc, filter) ? structuredClone(kyc) : null);
  t.mock.method(KycVerification, "findOneAndUpdate", async (filter, update) => match(kyc, filter) ? structuredClone(write(kyc, update)) : null);
  t.mock.method(KycVerification, "updateOne", async (filter, update) => { const matched = match(kyc, filter); if (matched) write(kyc, update); return { matchedCount: Number(matched) }; });
  t.mock.method(PreKycDocument, "findOne", filter => query(structuredClone(docs.find(doc => match(doc, filter)) || null)));
  t.mock.method(PreKycDocument, "exists", async filter => docs.find(doc => match(doc, filter)) || null);
  t.mock.method(PreKycDocument, "findOneAndUpdate", async (filter, update, options) => {
    let doc = docs.find(doc => match(doc, filter));
    if (!doc && options?.upsert) { doc = { _id: "temporary-reverification" }; docs.push(doc); }
    return doc ? structuredClone(write(doc, update)) : null;
  });
  return { user, kyc, docs, requests };
}
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("authenticated business PDF replacement persists privately, keeps BIR details and unrelated ID/selfie, and deduplicates retries", async t => {
  const state = fixture(t); const identity = structuredClone(state.docs[0]), selfie = state.kyc.challengePassedAt;
  const pdf = Buffer.from("%PDF-1.4\nSynthetic replacement business evidence\n%%EOF").toString("base64");
  const req = { user: state.user, params: { docType: "supporting" }, body: { supporting_doc_type: "BIR Certificate of Registration (Form 2303)",
    doc_image_base64: pdf, doc_image_mime: "application/pdf", user_profile: { tax_identification_number: "999999999" } } };
  const res = response(); await replaceAccountDocument(req, res); assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const business = state.docs[1], version = business.reviewVersion;
  assert.equal(business.mimeType, "application/pdf"); assert.equal(business.expiresAt, undefined); assert.equal(business.registeredUser, userId);
  assert.equal(business.profileSnapshot.tax_identification_number, "123456789"); assert.equal(business.profileSnapshot.branch_code, "000");
  assert.deepEqual(state.docs[0], identity); assert.equal(state.kyc.challengePassedAt.getTime(), selfie.getTime());
  assert.equal(state.user.kycStatus, "challenge_passed"); assert.equal(business.reviewHistory[0].reviewVersion, "business-v1");
  await assert.doesNotReject(fs.stat(path.join(directory, business.fileKey)));
  const fileCount = (await fs.readdir(directory)).length;
  const again = response(); await replaceAccountDocument(req, again); assert.equal(again.statusCode, 200);
  assert.equal(state.docs[1].reviewVersion, version); assert.equal((await fs.readdir(directory)).length, fileCount);
  business.status = "verified"; business.detailsMatched = true;
  const { reconcileUserKyc } = await import("../services/kycReview.service.js"); await reconcileUserKyc(userId);
  const approved = response(); await replaceAccountDocument(req, approved);
  assert.equal(approved.statusCode, 200); assert.match(approved.body.message, /unchanged/);
  assert.equal(state.user.kycStatus, "approved"); assert.equal(state.docs[1].reviewVersion, version);
});

test("an actual ID replacement disables approval, rotates its face key and rejects a delayed result for the old version", async t => {
  const state = fixture(t); const business = structuredClone(state.docs[1]);
  const res = response(); await replaceAccountDocument({ user: state.user, params: { docType: "id" }, body: { id_type: "Philippine Passport", id_image_base64: image, id_image_mime: "image/png" } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body)); assert.equal(state.user.kycStatus, "id_uploaded"); assert.equal(state.kyc.challengePassedAt, null);
  assert.deepEqual(state.docs[1], business); assert.equal(state.docs[0].expiresAt, undefined);
  assert.match(state.requests[0].body.user_id, /^pre:account:/); assert.ok(state.requests[0].body.user_id.endsWith(state.docs[0].reviewVersion));
  const version = state.docs[0].reviewVersion, fileCount = (await fs.readdir(directory)).length;
  const again = response(); await replaceAccountDocument({ user: state.user, params: { docType: "id" }, body: { id_type: "Philippine Passport", id_image_base64: image, id_image_mime: "image/png" } }, again);
  assert.equal(again.statusCode, 200); assert.equal(state.docs[0].reviewVersion, version);
  assert.equal(state.requests.length, 1); assert.equal((await fs.readdir(directory)).length, fileCount);
  state.docs[0].status = "pending_review"; state.docs[0].detailsMatched = true; state.docs[0].provider = "gemini";
  t.mock.method(axios, "post", async () => { state.docs[0].reviewVersion = "concurrent-replacement"; return { data: { verified: true } }; });
  const selfie = response(); await selfieVerify({ user: state.user, body: { selfie_image_base64: image } }, selfie);
  assert.equal(selfie.statusCode, 409); assert.equal(state.kyc.challengePassedAt, null);
  const callback = response(); await internalUpdateStatus({ headers: { "x-internal-key": process.env.INTERNAL_API_KEY }, body: { user_id: userId, status: "approved" } }, callback);
  assert.equal(callback.statusCode, 202); assert.equal(state.kyc.challengePassedAt, null);
});

test("optional face reverification stores a separate document and retains current account eligibility", async t => {
  const state = fixture(t); const original = structuredClone(state.docs);
  const res = response(); await registerReverificationId({ user: state.user, body: { id_type: "Philippine Passport", id_image_base64: image, id_image_mime: "image/png" } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body)); assert.equal(state.docs.length, 3);
  assert.deepEqual(state.docs.slice(0, 2), original); assert.match(state.docs[2].email, /^reverify:/);
  assert.equal(state.kyc.status, "approved"); assert.equal((await getAccountVerification(state.user)).listingEligible, true);
});

test("a legacy approved owner can replace business evidence without losing its historical ID approval", async t => {
  const state = fixture(t); delete state.user.registrationDraftId; delete state.kyc.registrationDocumentVersions.id;
  const res = response(); await replaceAccountDocument({ user: state.user, params: { docType: "supporting" }, body: {
    supporting_doc_type: "DTI Business Name Registration", doc_image_base64: image, doc_image_mime: "image/png" } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body)); assert.ok(state.kyc.legacyIdentityApprovedAt);
  assert.equal((await getAccountVerification(state.user)).listingEligible, false);
  state.docs[1].status = "verified"; state.docs[1].detailsMatched = true;
  const { reconcileUserKyc } = await import("../services/kycReview.service.js");
  await reconcileUserKyc(userId);
  const result = await getAccountVerification(state.user);
  assert.equal(result.listingEligible, true); assert.equal(result.selfieVerified, true);
  assert.equal(result.documents[0].status, "legacy_approved");
});

test("an interrupted ID face setup restores the saved reference and resumes without another upload", async t => {
  const state = fixture(t);
  t.mock.method(axios, "post", async () => { throw Object.assign(new Error("Synthetic face provider interruption"), { response: { status: 503 } }); });
  const failed = response(); await replaceAccountDocument({ user: state.user, params: { docType: "id" }, body: {
    id_type: "Philippine Passport", id_image_base64: image, id_image_mime: "image/png" } }, failed);
  assert.equal(failed.statusCode, 500); assert.equal(state.kyc.idRegisteredAt, null);
  const recovered = await getAccountVerification(state.user);
  assert.equal(recovered.documents[0].reference, state.docs[0]._id); assert.equal(recovered.documents[0].faceSetupRequired, true);
  assert.equal(recovered.bookingEligible, false); assert.equal(recovered.selfieVerified, false);
  const count = (await fs.readdir(directory)).length, version = state.docs[0].reviewVersion;
  t.mock.method(axios, "post", async (_url, body) => { assert.equal(body.id_image_base64, image.split(",")[1]); return { data: { success: true } }; });
  const resumed = response(); await replaceAccountDocument({ user: state.user, params: { docType: "id" }, body: {
    document_revision: version, id_type: "Philippine Passport" } }, resumed);
  assert.equal(resumed.statusCode, 200, JSON.stringify(resumed.body)); assert.ok(state.kyc.idRegisteredAt);
  assert.equal(state.docs[0].reviewVersion, version); assert.equal((await fs.readdir(directory)).length, count);
  const foreign = response(); await replaceAccountDocument({ user: { ...state.user, _id: "507f1f77bcf86cd799439099" }, params: { docType: "id" }, body: { document_revision: version } }, foreign);
  assert.equal(foreign.statusCode, 409);
});

test("a delayed ID registration cannot replace a newer saved version's verification binding", async t => {
  const state = fixture(t);
  t.mock.method(axios, "post", async () => { state.docs[0].reviewVersion = "newer-id"; return { data: { success: true } }; });
  const stale = response(); await replaceAccountDocument({ user: state.user, params: { docType: "id" }, body: {
    id_type: "Philippine Passport", id_image_base64: image, id_image_mime: "image/png" } }, stale);
  assert.equal(stale.statusCode, 409); assert.equal(state.kyc.idRegisteredAt, null); assert.equal((await getAccountVerification(state.user)).bookingEligible, false);
});

test("a saved-ID retry discards its unused file if the document changes before the queue write", async t => {
  const state = fixture(t);
  t.mock.method(axios, "post", async () => { throw Object.assign(new Error("Synthetic interruption"), { response: { status: 503 } }); });
  await replaceAccountDocument({ user: state.user, params: { docType: "id" }, body: {
    id_type: "Philippine Passport", id_image_base64: image, id_image_mime: "image/png" } }, response());
  const version = state.docs[0].reviewVersion, fileCount = (await fs.readdir(directory)).length;
  t.mock.method(PreKycDocument, "findOne", filter => {
    if (filter.email && filter.docType === "id") state.docs[0].reviewVersion = "newer-document";
    return query(structuredClone(state.docs.find(doc => match(doc, filter)) || null));
  });
  const retry = response(); await replaceAccountDocument({ user: state.user, params: { docType: "id" }, body: {
    document_revision: version, id_type: "Philippine Passport" } }, retry);
  assert.equal(retry.statusCode, 409); assert.equal(state.docs[0].reviewVersion, "newer-document");
  assert.equal((await fs.readdir(directory)).length, fileCount);
});
