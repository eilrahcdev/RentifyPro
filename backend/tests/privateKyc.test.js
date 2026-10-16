import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compareAdminKycDocument, validateAdminKycDecision, canReconcileApprovedIdentity } from "../services/privateKycReview.service.js";
import { createAdminDataRouter } from "../routes/adminData.routes.js";

const document = () => ({ registeredUser: "507f1f77bcf86cd799439011", _id: "507f1f77bcf86cd799439012", email: "fixture@example.test", status: "pending_review",
  provider: "private-ocr", docType: "id", role: "user", selectedDocCategory: "Philippine Passport",
  fileHash: "fixture-hash", reviewVersion: "fixture-version", fileKey: "fixture.jpg", detailsMatched: false,
  profileSnapshot: { first_name: "Sample", last_name: "Applicant", date_of_birth: "1990-05-12" } });
const input = (doc) => ({ fileHash: doc.fileHash, reviewVersion: doc.reviewVersion, documentType: doc.selectedDocCategory,
  issuingCountry: "PH", remarks: "Inspected original and compared all required document fields.",
  fields: { full_name: "SAMPLE APPLICANT", birth_date: "1990-05-12", document_number: "SYNTHETIC123", expiration_date: "2099-05-12" },
  confirmations: { readable: true, original: true, officialLayout: true, officialMarkings: true,
    noVisibleAlteration: true, holderPortrait: true, machineReadableZone: true } });

test("private KYC routes retain session protection and password reauthentication", async () => {
  const session = (_req, _res, next) => next();
  const router = createAdminDataRouter({ requireAdminSession: session });
  const index = router.stack.findIndex((layer) => layer.handle === session);
  for (const [route, method] of [["/documents/:id/comparison", "get"], ["/documents/:id/comparison", "post"], ["/documents/:id", "patch"]]) {
    const layer = router.stack.find((item) => item.route?.path === route && item.route.methods[method]);
    assert.ok(layer && router.stack.indexOf(layer) > index);
    if (method === "get") continue;
    const response = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
    await layer.route.stack[0].handle({ params: { id: document()._id }, body: { approval: "Approved" } }, response, (error) => { throw error; });
    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /password/);
  }
});

test("admin approval requires a current comparison and cannot approve queued documents", () => {
  const doc = document();
  assert.throws(() => validateAdminKycDecision(doc, "Approved", doc.reviewVersion));
  doc.detailsMatched = true;
  assert.throws(() => validateAdminKycDecision(doc, "Approved", doc.reviewVersion));
  doc.manualComparison = { fileHash: doc.fileHash, reviewVersion: doc.reviewVersion };
  assert.throws(() => validateAdminKycDecision(doc, "Approved", doc.reviewVersion), /document type/);
  doc.manualComparison.documentType = doc.selectedDocCategory;
  doc.manualComparison.documentTypeCheckVersion = 1;
  doc.validationChecks = { documentTypeMatches: true };
  assert.doesNotThrow(() => validateAdminKycDecision(doc, "Approved", doc.reviewVersion));
  assert.throws(() => validateAdminKycDecision(doc, "Approved", "old-version"));
  assert.throws(() => validateAdminKycDecision({ ...doc, status: "processing" }, "Rejected", doc.reviewVersion));
  assert.throws(() => validateAdminKycDecision({ ...doc, expiresAt: new Date(Date.now() - 1000) }, "Approved", doc.reviewVersion), /expired/);
});

test("private comparison checks file integrity, duplicates and stale writes without approving", async (t) => {
  const previous = process.env.KYC_DOCUMENT_FINGERPRINT_SECRET;
  process.env.KYC_DOCUMENT_FINGERPRINT_SECRET = "f".repeat(32);
  t.after(() => { if (previous === undefined) delete process.env.KYC_DOCUMENT_FINGERPRINT_SECRET; else process.env.KYC_DOCUMENT_FINGERPRINT_SECRET = previous; });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "admin-private-kyc-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const bytes = Buffer.from("synthetic evidence");
  await fs.writeFile(path.join(directory, "fixture.jpg"), bytes);
  const doc = { ...document(), fileHash: crypto.createHash("sha256").update(bytes).digest("hex") };
  let writes = 0, duplicate = false, stale = false;
  const collection = { findOne: async () => duplicate ? { _id: "another" } : null,
    findOneAndUpdate: async (filter, update) => { writes++; assert.equal(filter.fileHash, doc.fileHash); assert.equal(filter.reviewVersion, doc.reviewVersion);
      return stale ? null : { ...doc, ...update.$set }; } };
  const compare = () => compareAdminKycDocument({ collection, document: doc, input: input(doc), reviewerId: "fixture-admin", directory });
  const result = await compare();
  assert.equal(result.detailsMatched, true);
  assert.equal(result.status, "pending_review");
  assert.equal(result.manualComparison.reviewedBy, "fixture-admin");
  assert.equal(JSON.stringify(result.manualComparison).includes("SYNTHETIC123"), false);
  duplicate = true;
  await assert.rejects(compare(), /another registration/);
  assert.equal(writes, 1);
  duplicate = false; stale = true;
  await assert.rejects(compare(), /changed/);
  await fs.writeFile(path.join(directory, "fixture.jpg"), "replacement");
  await assert.rejects(compare(), /integrity/);
});

test("admin approval cannot override a known OCR type mismatch even with matching fields and a saved comparison", () => {
  for (const [selected, detected, docType] of [["Philippine Passport", "PRC ID", "id"],
    ["BIR Certificate of Registration (Form 2303)", "BIR Notice to Issue Receipt/Invoice", "supporting"]]) {
    const doc = { ...document(), docType, selectedDocCategory: selected, detailsMatched: true,
      validationChecks: { documentTypeMatches: true }, privateScreening: { candidateType: detected } };
    doc.manualComparison = { fileHash: doc.fileHash, reviewVersion: doc.reviewVersion,
      documentType: selected, documentTypeCheckVersion: 1 };
    assert.throws(() => validateAdminKycDecision(doc, "Approved", doc.reviewVersion), /document type/);
  }
});

test("document approval preserves the selfie requirement and rejects replacement-document cases", () => {
  const doc = { ...document(), status: "verified", detailsMatched: true };
  const kycCase = { status: "challenge_passed", challengePassedAt: new Date(), idDocumentHash: doc.fileHash };
  assert.equal(canReconcileApprovedIdentity(doc, kycCase), true);
  assert.equal(canReconcileApprovedIdentity(doc, { ...kycCase, idDocumentHash: "replacement" }), false);
  assert.equal(canReconcileApprovedIdentity(doc, { ...kycCase, challengePassedAt: null }), false);
  assert.equal(canReconcileApprovedIdentity({ ...doc, docType: "supporting" }, kycCase), false);
});

test("legacy admin comparison rechecks OCR type and cannot save matching personal data from a different ID", async (t) => {
  const values = { NODE_ENV: "test", KYC_DOCUMENT_PROVIDER: "private_ocr", KYC_PRIVATE_SERVICE_URL: "http://127.0.0.1:8020",
    GEMINI_SENSITIVE_DATA_APPROVED: "false", KYC_PRIVATE_INTERNAL_API_KEY: "p".repeat(32), KYC_DOCUMENT_FINGERPRINT_SECRET: "f".repeat(32) };
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "admin-type-legacy-"));
  t.after(async () => { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); await fs.rm(directory, { recursive: true, force: true }); });
  const bytes = Buffer.from("synthetic legacy type fixture");
  await fs.writeFile(path.join(directory, "fixture.jpg"), bytes);
  const doc = { ...document(), mimeType: "image/jpeg", fileHash: crypto.createHash("sha256").update(bytes).digest("hex") };
  let writes = 0;
  const collection = { findOne: async () => null, findOneAndUpdate: async (_filter, update) => { writes++; return { ...doc, ...update.$set }; } };
  const request = t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "http://127.0.0.1:8020/inspect");
    return Response.json({ schema_version: 1, provider: "paddleocr", pages: 1, layout_version: 2,
      lines: ["PROFESSIONAL REGULATION COMMISSION", "PRC ID", "Full Name: SAMPLE APPLICANT", "Date of Birth: 1990-05-12"]
        .map((text, index) => ({ text, page: 1, confidence: 0.98, bbox: [0.1, 0.05 + index * 0.1, 0.9, 0.08 + index * 0.1] })) });
  });
  await assert.rejects(compareAdminKycDocument({ collection, document: doc, input: input(doc), reviewerId: "fixture-admin", directory }), /document type/);
  assert.equal(writes, 0);
  assert.equal(request.mock.callCount(), 1);
});
