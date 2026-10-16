import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import AdminCredential from "../models/AdminCredential.js";
import AdminAuditLog from "../models/AdminAuditLog.js";
import { getAdminVisualReviewContext, prepareAdminVisualReview } from "../services/adminVisualReview.service.js";
import { compareAdminKycDocument, validateAdminKycDecision } from "../services/privateKycReview.service.js";
import { createAdminDataRouter } from "../routes/adminData.routes.js";
import { createDocumentFingerprint } from "../data/private-kyc/services/documentValidation.service.js";

const bytes = Buffer.from("Synthetic visual inspection evidence");
const fixture = () => ({ _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439012"), email: "fixture@example.test",
  registeredUser: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"), sessionId: "user:507f1f77bcf86cd799439011",
  status: "pending_review", provider: "private-ocr", docType: "id", role: "user", selectedDocCategory: "Philippine Passport",
  fileHash: createHash("sha256").update(bytes).digest("hex"), reviewVersion: "visual-v1", fileKey: "fixture.jpg", detailsMatched: false,
  profileSnapshot: { first_name: "Sample", last_name: "Applicant", date_of_birth: "1990-05-12" }, reviewHistory: [] });
const inspection = doc => ({ reviewMode: "visual", fileHash: doc.fileHash, reviewVersion: doc.reviewVersion,
  documentType: doc.selectedDocCategory, remarks: "Inspected the original and confirmed its details and validity.",
  confirmations: { documentInspected: true, registrationDetailsMatch: true, currentlyValid: true } });
function environment(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
}
async function evidence(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "admin-visual-review-"));
  t.after(async () => { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); await fs.rm(directory, { recursive: true, force: true }); });
  await fs.writeFile(path.join(directory, "fixture.jpg"), bytes);
  return directory;
}

test("visual inspection records human comparison without retyping or inventing extracted fields", t => {
  environment(t, { KYC_DOCUMENT_FINGERPRINT_SECRET: "v".repeat(32) });
  const doc = { ...fixture(), documentNumberFingerprint: "existing-server-fingerprint" };
  const result = prepareAdminVisualReview(doc, { ...inspection(doc), fields: { full_name: "Untrusted client name" } }, "fixture-admin");
  assert.equal(result.detailsMatched, true);
  assert.equal(result.manualComparison.reviewMethod, "visual");
  assert.deepEqual(result.manualComparison.fieldsCompared, ["first_name", "last_name", "date_of_birth"]);
  assert.equal(result.documentNumberFingerprint, doc.documentNumberFingerprint);
  assert.equal(Object.hasOwn(result, "extractedData"), false);
  assert.equal(JSON.stringify(result).includes("Untrusted client name"), false);
  assert.equal(doc.status, "pending_review");
  assert.doesNotThrow(() => validateAdminKycDecision({ ...doc, ...result }, "Approved", doc.reviewVersion));
  const noIdentifier = prepareAdminVisualReview(fixture(), inspection(fixture()), "fixture-admin");
  assert.equal(noIdentifier.manualComparison.identifierDuplicateCheck, "file_hash_only");
});

test("visual inspection refuses missing confirmations, stale revisions, type conflicts, failed validity and alteration flags", t => {
  environment(t, { KYC_DOCUMENT_FINGERPRINT_SECRET: "v".repeat(32) });
  const doc = fixture();
  for (const key of ["documentInspected", "registrationDetailsMatch", "currentlyValid"]) {
    const input = inspection(doc); input.confirmations[key] = false;
    assert.throws(() => prepareAdminVisualReview(doc, input, "fixture-admin"), /confirm/);
  }
  assert.throws(() => prepareAdminVisualReview(doc, { ...inspection(doc), reviewVersion: "stale" }, "fixture-admin"), /changed/);
  assert.throws(() => prepareAdminVisualReview({ ...doc, privateScreening: { candidateType: "PRC ID" } }, inspection(doc), "fixture-admin"), /document type/);
  assert.throws(() => prepareAdminVisualReview({ ...doc, validationChecks: { documentNotExpired: false } }, inspection(doc), "fixture-admin"), /validity/);
  assert.throws(() => prepareAdminVisualReview({ ...doc, suspectedTampering: true }, inspection(doc), "fixture-admin"), /alteration/);
  assert.throws(() => prepareAdminVisualReview({ ...doc, profileSnapshot: {} }, inspection(doc), "fixture-admin"), /registration/);
});

test("business inspection uses saved BIR identifiers for duplicate fingerprints and requires complete registration", t => {
  environment(t, { KYC_DOCUMENT_FINGERPRINT_SECRET: "v".repeat(32) });
  const doc = { ...fixture(), docType: "supporting", selectedDocCategory: "BIR Certificate of Registration (Form 2303)",
    profileSnapshot: { business_name: "Synthetic Rentals", tax_identification_number: "123-456-789", branch_code: "00000" } };
  const result = prepareAdminVisualReview(doc, inspection(doc), "fixture-admin");
  assert.equal(result.documentNumberFingerprint, createDocumentFingerprint("123-456-789-00000"));
  assert.equal(JSON.stringify(result.manualComparison).includes("123-456-789"), false);
  assert.throws(() => prepareAdminVisualReview({ ...doc, profileSnapshot: { business_name: "Synthetic Rentals" } }, inspection(doc), "fixture-admin"), /registration/);
});

test("visual context loads hash-checked registration details without another OCR request", async t => {
  const directory = await evidence(t);
  environment(t, { KYC_DOCUMENT_PROVIDER: "private_ocr", KYC_PRIVATE_SERVICE_URL: "http://127.0.0.1:8020" });
  const request = t.mock.method(globalThis, "fetch", async () => { throw new Error("OCR must not run for visual context"); });
  const result = await getAdminVisualReviewContext({ ...fixture(), profileSnapshot: { ...fixture().profileSnapshot, secret: "excluded" } }, directory);
  assert.deepEqual(result.profile, fixture().profileSnapshot);
  assert.equal(request.mock.callCount(), 0);
  assert.equal(Object.hasOwn(result, "fields"), false);
  await fs.writeFile(path.join(directory, "fixture.jpg"), "changed original");
  await assert.rejects(getAdminVisualReviewContext(fixture(), directory), /integrity/);
});

test("visual comparison rejects duplicate originals and stale writes before approval", async t => {
  const directory = await evidence(t);
  environment(t, { KYC_DOCUMENT_FINGERPRINT_SECRET: "v".repeat(32), KYC_DOCUMENT_PROVIDER: "manual" });
  const doc = fixture(); let duplicate = true, writes = 0;
  const collection = { findOne: async filter => duplicate && filter.fileHash ? { _id: "duplicate" } : null,
    findOneAndUpdate: async () => { writes++; return null; } };
  const compare = () => compareAdminKycDocument({ collection, document: doc, input: inspection(doc), reviewerId: "fixture-admin", directory });
  await assert.rejects(compare(), /another registration/); assert.equal(writes, 0);
  duplicate = false; await assert.rejects(compare(), /changed/); assert.equal(writes, 1);
});

test("approval without a typed reason saves the inspection and decision while preserving password and selfie verification", async t => {
  const directory = await evidence(t);
  environment(t, { KYC_DOCUMENT_FINGERPRINT_SECRET: "v".repeat(32), KYC_DOCUMENT_PROVIDER: "manual", KYC_UPLOAD_DIR: directory });
  const doc = fixture();
  const user = { _id: doc.registeredUser, role: "user", name: "Sample Applicant", email: doc.email, isVerified: true, kycStatus: "id_uploaded" };
  const kyc = { _id: "case", user: user._id, status: "id_uploaded", updatedAt: new Date(),
    registrationDocumentVersions: { id: doc.reviewVersion }, idDocumentHash: doc.fileHash };
  const oldDatabase = mongoose.connection.db;
  mongoose.connection.db = { collection: name => ({
    findOne: async filter => name === "prekycdocuments" ? filter._id?.$ne ? null : doc : name === "users" ? user : kyc,
    findOneAndUpdate: async (filter, update) => {
      if (filter.reviewVersion !== doc.reviewVersion || filter.status !== doc.status) return null;
      Object.assign(doc, update.$set);
      if (update.$push?.reviewHistory) doc.reviewHistory.push(update.$push.reviewHistory);
      return { ...doc };
    },
    updateOne: async (_filter, update) => { if (name === "users" && update.$set) Object.assign(user, update.$set); return { modifiedCount: 1 }; },
  }) };
  t.after(() => { mongoose.connection.db = oldDatabase; });
  const passwordHash = await bcrypt.hash("SyntheticAdmin1!", 4);
  t.mock.method(AdminCredential, "findOne", () => ({ select: async () => ({ passwordHash }) }));
  t.mock.method(AdminAuditLog, "create", async () => ({}));
  const app = express(); app.use(express.json());
  app.use(createAdminDataRouter({ requireAdminSession: (req, res, next) => {
    if (req.headers["x-synthetic-admin"] !== "yes") return res.sendStatus(401);
    req.adminAccount = { key: "fixture-admin", email: "admin@example.test" }; next();
  } }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/documents/${doc._id}`;
  const send = (body, loggedIn = true) => fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json", ...(loggedIn ? { "x-synthetic-admin": "yes" } : {}) }, body: JSON.stringify(body) });
  const body = { approval: "Approved", reviewVersion: doc.reviewVersion,
    adminPassword: "SyntheticAdmin1!", inspection: inspection(doc) };
  assert.equal((await send(body, false)).status, 401);
  assert.equal((await send({ ...body, adminPassword: "wrong" })).status, 403);
  assert.equal((await send({ ...body, inspection: undefined })).status, 409);
  assert.equal((await send({ ...body, inspection: { ...body.inspection, confirmations: {} } })).status, 400);
  assert.equal(doc.status, "pending_review"); assert.equal(doc.reviewHistory.length, 0);
  const response = await send(body); assert.equal(response.status, 200, await response.text());
  assert.equal(doc.status, "verified"); assert.equal(doc.manualComparison.reviewMethod, "visual");
  assert.equal(doc.manualComparison.remarks, "Document approved by the Super Admin.");
  assert.equal(doc.reason, "Document approved by the Super Admin.");
  assert.equal(doc.reviewHistory.length, 1); assert.equal(doc.reviewHistory[0].notificationPending, true);
  assert.equal(user.kycStatus, "id_uploaded");
  assert.equal((await send(body)).status, 200); assert.equal(doc.reviewHistory.length, 1);
});
