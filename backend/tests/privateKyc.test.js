import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import axios from "axios";
import PreKycDocument from "../models/PreKycDocument.js";
import PreKycFace from "../models/PreKycFace.js";
import { isIdentityReadyForSelfie } from "../utils/preKycDocs.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import { prepareManualDocumentComparison } from "../services/manualDocumentComparison.js";
import { normalizePrivateOcrResponse, inspectPrivateKycDocument } from "../services/privateKycOcr.service.js";
import { evaluatePrivateDocumentInspection, extractPrivateDocumentFields } from "../services/privateDocumentExtraction.service.js";
import { getPrivateKycReviewContext, readPrivateKycEvidence } from "../services/privateKycReviewContext.js";
import { compareManualKycDocument } from "../services/manualKycComparison.service.js";
import { reviewKycDocument } from "../services/kycReview.service.js";
import { processNextKycDocument, triggerKycDocumentProcessing } from "../jobs/kycDocumentProcessing.job.js";
import { getPreKycStatus, preVerifySupportingDocument } from "../controllers/kyc.controller.js";
import { getProductionConfigurationErrors } from "../utils/productionConfig.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import adminRouter from "../routes/admin.routes.js";

function env(t, values = {}) {
  for (const [key, value] of Object.entries({ NODE_ENV: "test", KYC_DOCUMENT_PROVIDER: "private_ocr",
    KYC_PRIVATE_SERVICE_URL: "http://127.0.0.1:8020", INTERNAL_API_KEY: "i".repeat(32),
    KYC_PRIVATE_INTERNAL_API_KEY: undefined,
    GEMINI_SENSITIVE_DATA_APPROVED: "false", KYC_DOCUMENT_FINGERPRINT_SECRET: "f".repeat(32), ...values })) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}
const doc = (extra = {}) => ({ _id: "507f1f77bcf86cd799439012", email: "applicant@example.test", sessionId: "registration-fixture",
  provider: "private-ocr", status: "pending_review", docType: "id", role: "user", fileKey: "synthetic.jpg", fileHash: "synthetic-hash",
  mimeType: "image/jpeg",
  reviewVersion: "current-review", selectedDocCategory: "Philippine Passport",
  profileSnapshot: { first_name: "Sample", last_name: "Applicant", date_of_birth: "1990-05-12" }, ...extra });
const input = (extra = {}) => ({ fileHash: "synthetic-hash", reviewVersion: "current-review", documentType: "Philippine Passport",
  issuingCountry: "PH", remarks: "Compared every visible field against registration.",
  confirmations: { readable: true, original: true, officialLayout: true, officialMarkings: true, noVisibleAlteration: true,
    holderPortrait: true, machineReadableZone: true },
  fields: { full_name: "SAMPLE APPLICANT", birth_date: "1990-05-12", document_number: "SYNTHETIC123", expiration_date: "2099-05-12" }, ...extra });
const ocr = (texts = ["PHILIPPINE PASSPORT", "Full Name: SAMPLE APPLICANT", "Date of Birth: 1990-05-12", "Passport No: SYNTHETIC123", "Expiration Date: 2099-05-12"]) => ({
  schema_version: 1, provider: "paddleocr", pages: 1, layout_version: 2,
  lines: texts.map((text, index) => ({ text, confidence: 0.98, page: 1, bbox: [0.1, 0.05 + index * 0.1, 0.9, 0.08 + index * 0.1] })),
});

test("private OCR sends only image bytes to the selected private endpoint while Gemini remains disabled", async (t) => {
  env(t);
  const provider = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "http://127.0.0.1:8020/inspect");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["x-internal-key"], "i".repeat(32));
    assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), ["base64", "mime_type", "schema_version"]);
    return Response.json(ocr());
  });
  assert.equal((await inspectPrivateKycDocument({ base64: "synthetic", mimeType: "image/jpeg" })).lines.length, 5);
  assert.equal(provider.mock.callCount(), 1);
});

test("dedicated private OCR key preserves the shared Face and Chatbot service key", async (t) => {
  env(t, { INTERNAL_API_KEY: "existing-shared-key", KYC_PRIVATE_INTERNAL_API_KEY: "p".repeat(32) });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.headers["x-internal-key"], "p".repeat(32));
    return Response.json(ocr());
  });
  await inspectPrivateKycDocument({ base64: "synthetic", mimeType: "image/jpeg" });
  assert.equal(process.env.INTERNAL_API_KEY, "existing-shared-key");
});

test("live legacy OCR responses require a service update instead of claiming the document is unreadable", async (t) => {
  env(t);
  for (const version of [undefined, 1, 3]) {
    const legacy = ocr();
    if (version === undefined) { delete legacy.layout_version; legacy.lines.forEach((line) => delete line.bbox); }
    else legacy.layout_version = version;
    const provider = t.mock.method(globalThis, "fetch", async (url) => {
      assert.equal(url, "http://127.0.0.1:8020/inspect");
      return Response.json(legacy);
    });
    await assert.rejects(inspectPrivateKycDocument({ base64: "synthetic", mimeType: "image/jpeg" }),
      (error) => error.code === "PRIVATE_KYC_SERVICE_INCOMPATIBLE" && error.status === 503
        && error.retryable === false && !/unreadable/i.test(error.message));
    assert.equal(provider.mock.callCount(), 1);
  }
});

test("invalid URLs, disabled providers and changed configuration prevent private document transmission", async (t) => {
  for (const values of [{ KYC_PRIVATE_SERVICE_URL: "https://example.test/inspect?key=secret" },
    { KYC_PRIVATE_SERVICE_URL: "http://external.example.test" }, { KYC_DOCUMENT_PROVIDER: "manual" }, { INTERNAL_API_KEY: "short" }]) {
    env(t, values);
    const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("No transmission allowed"); });
    await assert.rejects(inspectPrivateKycDocument({ base64: "synthetic", mimeType: "image/jpeg" }), { code: "KYC_SCREENING_DISABLED" });
    assert.equal(provider.mock.callCount(), 0);
  }
});

test("OCR response validation rejects malformed, oversized and non-finite readings", () => {
  for (const payload of [{ ...ocr(), schema_version: 2 }, { ...ocr(), pages: 11 },
    { ...ocr(), lines: [{ text: "sample", confidence: Infinity, page: 1 }] },
    { ...ocr(), lines: [{ text: "x".repeat(401), confidence: 0.9, page: 1 }] }]) {
    assert.throws(() => normalizePrivateOcrResponse(payload));
  }
});

test("private API failures preserve retry status and never fall back to Gemini", async (t) => {
  env(t);
  for (const status of [401, 422, 429, 503]) {
    const provider = t.mock.method(globalThis, "fetch", async () => new Response("", { status }));
    await assert.rejects(inspectPrivateKycDocument({ base64: "synthetic", mimeType: "image/jpeg" }),
      (error) => error.status === status && error.retryable === [429, 503].includes(status));
    assert.equal(provider.mock.callCount(), 1);
  }
  t.mock.method(globalThis, "fetch", async () => new Response("{}", { headers: { "content-length": "900000" } }));
  await assert.rejects(inspectPrivateKycDocument({ base64: "synthetic", mimeType: "image/jpeg" }), /size limit/);
});

test("OCR reads labelled fields independently and does not invent ambiguous numeric dates", () => {
  const inspection = normalizePrivateOcrResponse(ocr(["Given names: SAMPLE", "Surname: APPLICANT", "Date of Birth: 12 May 1990"]));
  assert.equal(extractPrivateDocumentFields(inspection).data.full_name, "SAMPLE APPLICANT");
  assert.equal(extractPrivateDocumentFields(inspection).data.birth_date, "1990-05-12");
  assert.equal(extractPrivateDocumentFields(normalizePrivateOcrResponse(ocr(["Date of Birth: 05/12/1990"]))).data.birth_date, "");
});

test("matching OCR text does not assert authenticity or final approval", () => {
  const decision = evaluatePrivateDocumentInspection({ inspection: normalizePrivateOcrResponse(ocr()), docType: "id",
    selectedDocType: "Philippine Passport", profile: doc().profileSnapshot });
  assert.equal(decision.status, "pending_review");
  assert.equal(decision.checks.registrationDataCompared, false);
  assert.equal(decision.privateScreening.preliminaryComparison.nameMatches, true);
  assert.equal(decision.classificationConfidence, 98);
  assert.equal(decision.checks.documentTypeMatches, true);
  assert.equal(decision.documentSurface, "UNKNOWN");
  assert.equal(JSON.stringify(decision).includes("SYNTHETIC123"), false);
});

test("queue uses private OCR with Gemini false even when automatic verification is requested", async (t) => {
  env(t, { KYC_ALLOW_RULE_BASED_AUTO_VERIFY: "true" });
  const bytes = Buffer.from("synthetic document bytes");
  const document = doc({ processingAttempts: 1, processingLockedAt: new Date(), fileHash: crypto.createHash("sha256").update(bytes).digest("hex") });
  t.mock.method(PreKycDocument, "findOneAndUpdate", () => ({ select: async () => document }));
  t.mock.method(PreKycDocument, "exists", async () => false);
  t.mock.method(fs, "readFile", async () => bytes);
  t.mock.method(auditLog, "info", () => {});
  const writes = [];
  t.mock.method(PreKycDocument, "updateOne", async (_filter, update) => { writes.push(update.$set); return { modifiedCount: 1 }; });
  t.mock.method(globalThis, "fetch", async (url) => { assert.match(url, /^http:\/\/127\.0\.0\.1:8020\/inspect$/); return Response.json(ocr()); });
  await processNextKycDocument();
  assert.equal(writes[0].status, "pending_review");
  assert.equal(writes[0].detailsMatched, false);
  assert.equal(writes[0].provider, "private-ocr");
  assert.equal(writes[0].verifiedAt, null);
  assert.equal(isIdentityReadyForSelfie({ ...document, ...writes[0] }), true);
  assert.equal(writes[0].status, "pending_review");
});

test("an incompatible OCR worker preserves the upload for manual review and never unlocks selfies", async (t) => {
  env(t);
  const bytes = Buffer.from("synthetic old-worker fixture");
  const document = doc({ processingAttempts: 1, processingLockedAt: new Date(),
    fileHash: crypto.createHash("sha256").update(bytes).digest("hex") });
  t.mock.method(PreKycDocument, "findOneAndUpdate", () => ({ select: async () => document }));
  t.mock.method(fs, "readFile", async () => bytes);
  t.mock.method(auditLog, "warn", () => {});
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "http://127.0.0.1:8020/inspect");
    const legacy = ocr(); delete legacy.layout_version;
    legacy.lines.forEach((line) => delete line.bbox);
    return Response.json(legacy);
  });
  let saved;
  t.mock.method(PreKycDocument, "updateOne", async (_filter, update) => { saved = update.$set; return { modifiedCount: 1 }; });
  const removal = t.mock.method(fs, "unlink", async () => assert.fail("Service incompatibility must not delete the original upload"));
  await processNextKycDocument();
  assert.equal(saved.status, "pending_review");
  assert.equal(saved.provider, "private-ocr");
  assert.equal(saved.reasonCode, "PRIVATE_KYC_SERVICE_INCOMPATIBLE");
  assert.match(saved.reason, /temporarily unavailable/);
  assert.doesNotMatch(saved.reason, /unreadable|clearer|name/i);
  assert.equal(saved.verifiedAt, null);
  assert.equal(saved.nextAttemptAt, null);
  assert.equal(saved.fileKey, undefined);
  assert.equal(removal.mock.callCount(), 0);
  assert.equal(isIdentityReadyForSelfie({ ...document, ...saved }), false);
});

test("human comparison uses existing matching rules and records evidence without approving", (t) => {
  env(t);
  const fields = prepareManualDocumentComparison(doc(), input(), "admin-fixture");
  assert.equal(fields.detailsMatched, true);
  assert.equal(fields.status, undefined);
  assert.equal(fields.manualComparison.reviewVersion, "current-review");
  assert.equal(fields.manualComparison.fileHash, "synthetic-hash");
  assert.equal(fields.validationChecks.registrationDataCompared, true);
  assert.ok(fields.documentNumberFingerprint);
  assert.equal(JSON.stringify(fields).includes("SYNTHETIC123"), false);
  assert.equal(fields.confidence, undefined);
});

test("a duplicate identifier found after successful OCR matching keeps selfies locked for manual review", async (t) => {
  env(t);
  const bytes = Buffer.from("synthetic duplicate document"), document = doc({ processingAttempts: 1, processingLockedAt: new Date(),
    fileHash: crypto.createHash("sha256").update(bytes).digest("hex") });
  t.mock.method(PreKycDocument, "findOneAndUpdate", () => ({ select: async () => document }));
  t.mock.method(PreKycDocument, "exists", async () => true);
  t.mock.method(fs, "readFile", async () => bytes);
  t.mock.method(auditLog, "info", () => {});
  t.mock.method(globalThis, "fetch", async (url) => { assert.equal(url, "http://127.0.0.1:8020/inspect"); return Response.json(ocr()); });
  let saved;
  t.mock.method(PreKycDocument, "updateOne", async (_filter, update) => { saved = update.$set; return { modifiedCount: 1 }; });
  await processNextKycDocument();
  assert.equal(saved.status, "pending_review");
  assert.equal(saved.reasonCode, "DUPLICATE_DOCUMENT");
  assert.equal(saved.privateScreening.automatedCheck.outcome, "review_needed");
  assert.equal(isIdentityReadyForSelfie({ ...document, ...saved }), false);
});

test("mismatches, missing checks, wrong types, expiry and stale review cannot pass human comparison", (t) => {
  env(t);
  for (const update of [{ fields: { ...input().fields, full_name: "WRONG PERSON" } },
    { fields: { ...input().fields, birth_date: "1991-01-01" } },
    { fields: { ...input().fields, expiration_date: "2000-01-01" } },
    { fields: { ...input().fields, expiration_date: "2099-02-31" } },
    { fields: { ...input().fields, issue_date: "not a date" } },
    { confirmations: { ...input().confirmations, officialLayout: false } },
    { documentType: "LTO Driver's License" }, { fileHash: "replacement" }, { reviewVersion: "stale" }, { issuingCountry: "US" }]) {
    assert.throws(() => prepareManualDocumentComparison(doc(), input(update), "admin-fixture"));
  }
  assert.throws(() => prepareManualDocumentComparison(doc({ expiresAt: new Date(0) }), input(), "admin-fixture"));
  assert.throws(() => prepareManualDocumentComparison(doc({ provider: "gemini" }), input(), "admin-fixture"));
});

test("BIR comparison requires the registered business, TIN and branch while Barangay can have no number", (t) => {
  env(t);
  const document = doc({ docType: "supporting", role: "owner", selectedDocCategory: "BIR Certificate of Registration (Form 2303)",
    profileSnapshot: { business_name: "Sample Rentals", tax_identification_number: "123456789", branch_code: "00000" } });
  const comparison = input({ documentType: document.selectedDocCategory,
    fields: { business_name: "Sample Rentals", tax_identification_number: "123456789", branch_code: "00000" } });
  assert.equal(prepareManualDocumentComparison(document, comparison, "admin-fixture").detailsMatched, true);
  assert.throws(() => prepareManualDocumentComparison(document, { ...comparison, fields: { ...comparison.fields, branch_code: "00001" } }, "admin-fixture"));
  const barangay = { ...document, selectedDocCategory: "Barangay Business Clearance", profileSnapshot: { business_name: "Sample Rentals" } };
  assert.equal(prepareManualDocumentComparison(barangay, { ...comparison, documentType: barangay.selectedDocCategory,
    fields: { business_name: "Sample Rentals" } }, "admin-fixture").detailsMatched, true);
});

test("private file integrity, duplicates and replacement races block comparison writes", async (t) => {
  env(t);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "private-kyc-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  });
  const bytes = Buffer.from("synthetic evidence");
  await fs.writeFile(path.join(root, "synthetic.jpg"), bytes);
  const document = doc({ fileHash: crypto.createHash("sha256").update(bytes).digest("hex") });
  env(t, { KYC_UPLOAD_DIR: root });
  t.mock.method(globalThis, "fetch", async () => Response.json(ocr()));
  t.mock.method(PreKycDocument, "findById", () => ({ select: async () => document }));
  t.mock.method(PreKycDocument, "exists", async () => true);
  const write = t.mock.method(PreKycDocument, "findOneAndUpdate", async () => null);
  await assert.rejects(compareManualKycDocument({ id: document._id, input: input({ fileHash: document.fileHash }), reviewerId: "admin-fixture" }), /another registration/);
  assert.equal(write.mock.callCount(), 0);
  t.mock.method(PreKycDocument, "exists", async () => false);
  await assert.rejects(compareManualKycDocument({ id: document._id, input: input({ fileHash: document.fileHash }), reviewerId: "admin-fixture" }), /changed/);
  await assert.rejects(readPrivateKycEvidence({ ...document, fileKey: "../synthetic.jpg" }, root), /Invalid/);
  await assert.rejects(readPrivateKycEvidence({ ...document, fileHash: "wrong" }, root), /integrity/);
  env(t, { KYC_DOCUMENT_PROVIDER: "manual" });
  const context = await getPrivateKycReviewContext(document, root);
  assert.equal(context.profile.date_of_birth, "1990-05-12");
  assert.deepEqual(context.fields, {});
});

test("private document approval requires a current recorded comparison and stays separate from selfie", async (t) => {
  env(t);
  const document = doc({ detailsMatched: false });
  t.mock.method(PreKycDocument, "findById", async () => document);
  const write = t.mock.method(PreKycDocument, "findOneAndUpdate", async (_filter, update) => ({ ...document, ...update.$set }));
  t.mock.method(auditLog, "info", () => {});
  await assert.rejects(reviewKycDocument({ id: document._id, action: "approve", reviewerId: "admin-fixture" }), /review version/);
  await assert.rejects(reviewKycDocument({ id: document._id, action: "approve", reviewVersion: document.reviewVersion, reviewerId: "admin-fixture" }), /cannot be approved/);
  document.detailsMatched = true;
  await assert.rejects(reviewKycDocument({ id: document._id, action: "approve", reviewVersion: document.reviewVersion, reviewerId: "admin-fixture" }), /manual document comparison/);
  assert.equal(write.mock.callCount(), 0);
  document.manualComparison = { fileHash: document.fileHash, reviewVersion: document.reviewVersion };
  await assert.rejects(reviewKycDocument({ id: document._id, action: "approve", reviewVersion: document.reviewVersion, reviewerId: "admin-fixture" }), /document type/);
  Object.assign(document, prepareManualDocumentComparison(document, input(), "admin-fixture"));
  const approved = await reviewKycDocument({ id: document._id, action: "approve", reviewVersion: document.reviewVersion, reviewerId: "admin-fixture" });
  assert.equal(approved.status, "verified");
  assert.equal(write.mock.callCount(), 1);
});

test("queue requires the correct document type even when all OCR personal details match", async (t) => {
  env(t);
  const bytes = Buffer.from("synthetic wrong-type fixture");
  const document = doc({ processingAttempts: 1, processingLockedAt: new Date(),
    fileHash: crypto.createHash("sha256").update(bytes).digest("hex") });
  t.mock.method(PreKycDocument, "findOneAndUpdate", () => ({ select: async () => document }));
  t.mock.method(fs, "readFile", async () => bytes);
  t.mock.method(auditLog, "info", () => {});
  let saved;
  t.mock.method(PreKycDocument, "updateOne", async (_filter, update) => { saved = update.$set; return { modifiedCount: 1 }; });
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "http://127.0.0.1:8020/inspect");
    return Response.json(ocr(["PROFESSIONAL REGULATION COMMISSION", "PRC ID", "Full Name: SAMPLE APPLICANT", "Date of Birth: 1990-05-12"]));
  });
  await processNextKycDocument();
  assert.equal(saved.status, "reupload_required");
  assert.equal(saved.reasonCode, "DOCUMENT_TYPE_MISMATCH");
  assert.equal(saved.validationChecks.documentTypeMatches, false);
  assert.equal(saved.detailsMatched, false);
  assert.equal(saved.verifiedAt, null);
  assert.equal(saved.privateScreening.typeCheck.fileHash, document.fileHash);
  assert.equal(saved.privateScreening.preliminaryComparison.nameMatches, null);
});

test("legacy pending documents are rechecked before comparison and client type selection cannot override OCR", async (t) => {
  env(t);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "private-type-legacy-"));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); await fs.rm(root, { recursive: true, force: true }); });
  const bytes = Buffer.from("synthetic legacy fixture");
  await fs.writeFile(path.join(root, "synthetic.jpg"), bytes);
  env(t, { KYC_UPLOAD_DIR: root });
  const document = doc({ fileHash: crypto.createHash("sha256").update(bytes).digest("hex") });
  t.mock.method(PreKycDocument, "findById", () => ({ select: async () => document }));
  t.mock.method(PreKycDocument, "exists", async () => false);
  const write = t.mock.method(PreKycDocument, "findOneAndUpdate", async (_filter, update) => ({ ...document, ...update.$set }));
  t.mock.method(auditLog, "info", () => {});
  let output = ocr(["PROFESSIONAL REGULATION COMMISSION", "PRC ID", "Full Name: SAMPLE APPLICANT", "Date of Birth: 1990-05-12"]);
  const request = t.mock.method(globalThis, "fetch", async (url) => { assert.equal(url, "http://127.0.0.1:8020/inspect"); return Response.json(output); });
  const compare = () => compareManualKycDocument({ id: document._id, input: input({ fileHash: document.fileHash }), reviewerId: "admin-fixture" });
  await assert.rejects(compare(), /document type/);
  output = ocr(["Full Name: SAMPLE APPLICANT", "Date of Birth: 1990-05-12"]);
  await assert.rejects(compare(), /document type/);
  assert.equal(write.mock.callCount(), 0);
  output = ocr();
  const updated = await compare();
  assert.equal(updated.validationChecks.documentTypeMatches, true);
  assert.equal(updated.privateScreening.typeCheck.documentTypeMatches, true);
  assert.equal(updated.manualComparison.documentType, "Philippine Passport");
  assert.equal(updated.status, "pending_review");
  assert.equal(request.mock.callCount(), 3);
});

test("production adds private-provider validation without relaxing existing requirements", () => {
  const base = { NODE_ENV: "production", GEMINI_SENSITIVE_DATA_APPROVED: "false" };
  const previous = getProductionConfigurationErrors(base);
  const configured = getProductionConfigurationErrors({ ...base, KYC_DOCUMENT_PROVIDER: "private_ocr",
    KYC_PRIVATE_SERVICE_URL: "https://owned-checker.example.test", KYC_DOCUMENT_FINGERPRINT_SECRET: "f".repeat(32) });
  assert.deepEqual(configured, previous);
  assert.ok(getProductionConfigurationErrors({ ...base, KYC_DOCUMENT_PROVIDER: "private_ocr" }).some((error) => error.includes("KYC_PRIVATE_SERVICE_URL")));
  assert.ok(getProductionConfigurationErrors({ ...base, KYC_DOCUMENT_PROVIDER: "private_ocr", KYC_PRIVATE_INTERNAL_API_KEY: "short" })
    .some((error) => error.includes("KYC_PRIVATE_INTERNAL_API_KEY")));
  assert.deepEqual(getProductionConfigurationErrors({ ...base, KYC_DOCUMENT_PROVIDER: "private_ocr",
    KYC_PRIVATE_SERVICE_URL: "https://owned-checker.example.test", KYC_DOCUMENT_FINGERPRINT_SECRET: "f".repeat(32),
    KYC_PRIVATE_INTERNAL_API_KEY: "p".repeat(32) }), previous);
});

test("private failures on legacy queued documents remain manually comparable and never contact Gemini", async (t) => {
  env(t);
  const bytes = Buffer.from("synthetic failure fixture");
  const document = doc({ provider: "gemini-queued", processingAttempts: 3, processingLockedAt: new Date(),
    fileHash: crypto.createHash("sha256").update(bytes).digest("hex") });
  t.mock.method(PreKycDocument, "findOneAndUpdate", () => ({ select: async () => document }));
  t.mock.method(fs, "readFile", async () => bytes);
  t.mock.method(auditLog, "warn", () => {});
  let saved;
  t.mock.method(PreKycDocument, "updateOne", async (_filter, update) => { saved = update.$set; return { modifiedCount: 1 }; });
  const fetch = t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "http://127.0.0.1:8020/inspect");
    return new Response("", { status: 422 });
  });
  await processNextKycDocument();
  assert.equal(saved.status, "pending_review");
  assert.equal(saved.provider, "private-ocr");
  assert.equal(saved.verifiedAt, null);
  assert.equal(fetch.mock.callCount(), 1);
});

test("website comparison routes remain behind authenticated admin authorization", () => {
  const protection = adminRouter.stack.filter((layer) => !layer.route);
  assert.ok(protection.length >= 2);
  for (const method of ["get", "post"]) {
    const route = adminRouter.stack.find((layer) => layer.route?.path === "/documents/:id/comparison" && layer.route.methods[method]);
    assert.ok(route);
    assert.ok(protection.every((layer) => adminRouter.stack.indexOf(layer) < adminRouter.stack.indexOf(route)));
  }
});

test("private busy retries are short and bounded independently of Gemini attempt settings", async (t) => {
  env(t, { KYC_GEMINI_MAX_ATTEMPTS: "99", KYC_DOCUMENT_QUEUE_ENABLED: "true" });
  const bytes = Buffer.from("synthetic document bytes");
  const document = doc({ processingAttempts: 1, processingLockedAt: new Date(), fileHash: crypto.createHash("sha256").update(bytes).digest("hex") });
  t.mock.method(PreKycDocument, "findOneAndUpdate", () => ({ select: async () => document }));
  t.mock.method(fs, "readFile", async () => bytes);
  t.mock.method(auditLog, "warn", () => {});
  let saved;
  t.mock.method(PreKycDocument, "updateOne", async (_filter, update) => { saved = update.$set; return { modifiedCount: 1 }; });
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 429 }));
  const started = Date.now();
  await processNextKycDocument();
  assert.equal(saved.status, "retry_wait");
  assert.ok(saved.nextAttemptAt.getTime() >= started + 3000 && saved.nextAttemptAt.getTime() <= Date.now() + 3000);
  document.processingAttempts = 2;
  await processNextKycDocument();
  assert.equal(saved.status, "pending_review");
  assert.equal(saved.nextAttemptAt, null);
  assert.equal(saved.verifiedAt, null);
});

test("a private timeout preserves manual review without repeating potentially running inference", async (t) => {
  env(t, { KYC_DOCUMENT_QUEUE_ENABLED: "true" });
  const bytes = Buffer.from("synthetic document bytes");
  const document = doc({ processingAttempts: 1, processingLockedAt: new Date(), fileHash: crypto.createHash("sha256").update(bytes).digest("hex") });
  t.mock.method(PreKycDocument, "findOneAndUpdate", () => ({ select: async () => document }));
  t.mock.method(fs, "readFile", async () => bytes);
  t.mock.method(auditLog, "warn", () => {});
  let saved;
  t.mock.method(PreKycDocument, "updateOne", async (_filter, update) => { saved = update.$set; return { modifiedCount: 1 }; });
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("", { status: 504 }));
  await processNextKycDocument();
  assert.equal(saved.status, "pending_review");
  assert.equal(saved.nextAttemptAt, null);
  assert.equal(fetch.mock.callCount(), 1);
});

test("private queue drains ready documents sequentially without timer gaps or duplicate claims", async (t) => {
  env(t, { KYC_DOCUMENT_QUEUE_ENABLED: "true" });
  const bytes = Buffer.from("synthetic document bytes"), hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const documents = [doc({ fileHash: hash, processingAttempts: 1, processingLockedAt: new Date() }),
    doc({ _id: "507f1f77bcf86cd799439013", fileHash: hash, processingAttempts: 1, processingLockedAt: new Date() })];
  const claim = t.mock.method(PreKycDocument, "findOneAndUpdate", () => ({ select: async () => documents.shift() || null }));
  t.mock.method(PreKycDocument, "exists", async () => false);
  t.mock.method(fs, "readFile", async () => bytes);
  t.mock.method(auditLog, "info", () => {});
  const processed = [];
  t.mock.method(PreKycDocument, "updateOne", async (filter) => { processed.push(filter._id); return { modifiedCount: 1 }; });
  t.mock.method(globalThis, "fetch", async () => Response.json(ocr()));
  triggerKycDocumentProcessing(); triggerKycDocumentProcessing();
  for (let attempt = 0; attempt < 25 && processed.length < 2; attempt++) await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.equal(processed.length, 2);
  assert.equal(new Set(processed).size, 2);
  assert.equal(claim.mock.callCount(), 3);
});

test("applicant status exposes safe current screening checks and revision without private evidence", async (t) => {
  env(t);
  const document = doc();
  document.privateScreening = evaluatePrivateDocumentInspection({ inspection: normalizePrivateOcrResponse(ocr()), docType: "id",
    selectedDocType: document.selectedDocCategory, profile: document.profileSnapshot, sessionId: document.sessionId, role: document.role,
    fileHash: document.fileHash, reviewVersion: document.reviewVersion }).privateScreening;
  t.mock.method(PreKycDocument, "find", () => ({ select: () => ({ sort: () => ({ lean: async () => [document] }) }) }));
  let response;
  await getPreKycStatus({ preKyc: { email: document.email, sessionId: document.sessionId } }, { json: (value) => { response = value; } });
  assert.equal(response.documents[0].automatedScreening.outcome, "passed");
  assert.equal(response.documents[0].documentRevision, "current-review");
  assert.equal(response.documents[0].identityReadyForSelfie, true);
  for (const key of ["privateScreening", "manualComparison", "fileHash", "reviewVersion", "validationChecks", "provider", "profileSnapshot", "sessionId", "role"])
    assert.equal(Object.hasOwn(response.documents[0], key), false);
});

test("selfie HTTP handler permits current automated matching and refuses direct calls after replacement or mismatch", async (t) => {
  env(t, { FACE_SERVICE_URL: "http://127.0.0.1:8010" });
  const { preSelfieVerify } = await import("../controllers/kyc.controller.js?selfie-bound-fixture");
  const document = doc();
  document.privateScreening = evaluatePrivateDocumentInspection({ inspection: normalizePrivateOcrResponse(ocr()), docType: "id",
    selectedDocType: document.selectedDocCategory, profile: document.profileSnapshot, sessionId: document.sessionId, role: document.role,
    fileHash: document.fileHash, reviewVersion: document.reviewVersion }).privateScreening;
  t.mock.method(PreKycDocument, "findOne", () => ({ select: () => ({ lean: async () => document }) }));
  t.mock.method(PreKycFace, "findOneAndUpdate", async () => null);
  t.mock.method(auditLog, "info", () => {});
  const faceRequest = t.mock.method(axios, "post", async () => ({ data: { success: true, verified: true } }));
  const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("synthetic fixture")]).toString("base64");
  const invoke = async () => {
    let status, response;
    await preSelfieVerify({ preKyc: { email: document.email, role: document.role, sessionId: document.sessionId },
      body: { selfie_image_base64: image } }, { json: (value) => { response = value; }, status(value) { status = value; return this; } });
    return { status, response };
  };
  assert.equal((await invoke()).response.verified, true);
  for (const mutation of [() => { document.reviewVersion = "replacement"; },
    () => { document.reviewVersion = "current-review"; document.profileSnapshot.first_name = "Wrong"; },
    () => { document.profileSnapshot.first_name = "Sample"; document.status = "rejected"; }]) {
    mutation();
    const result = await invoke();
    assert.equal(result.status, 409);
    assert.equal(result.response.code, "ID_DETAILS_NOT_MATCHED");
  }
  assert.equal(faceRequest.mock.callCount(), 1);
});

test("a delayed screening-status read cannot turn a completed ID upload into a failed upload", async (t) => {
  env(t, { KYC_DOCUMENT_PROVIDER: "manual", KYC_DOCUMENT_QUEUE_ENABLED: "false", FACE_SERVICE_URL: "http://127.0.0.1:8010" });
  const { preRegisterIdFace } = await import("../controllers/kyc.controller.js?upload-status-fixture");
  const document = doc();
  t.mock.method(fs, "mkdir", async () => {});
  t.mock.method(fs, "writeFile", async () => {});
  t.mock.method(auditLog, "info", () => {});
  t.mock.method(auditLog, "warn", () => {});
  t.mock.method(PreKycDocument, "findOneAndUpdate", async () => document);
  t.mock.method(PreKycDocument, "findOne", (filter) => ({ select: async () => {
    if (!filter._id) return null;
    assert.equal(filter.reviewVersion, document.reviewVersion);
    throw Error("Fixture status read temporarily unavailable");
  } }));
  const faceRequest = t.mock.method(axios, "post", async () => ({ data: { success: true } }));
  let response, httpStatus;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  await preRegisterIdFace({ preKyc: { email: document.email, role: "user", sessionId: document.sessionId },
    body: { id_type: "Philippine Passport", id_image_mime: "image/png",
      id_image_base64: Buffer.concat([signature, Buffer.from("synthetic fixture")]).toString("base64"),
      full_name: "Sample Applicant", user_profile: document.profileSnapshot } }, {
    json: (value) => { response = value; }, status(value) { httpStatus = value; return this; },
  });
  assert.equal(httpStatus, undefined);
  assert.equal(response.success, true);
  assert.equal(response.documentStatus, "pending_review");
  assert.equal(response.documentRevision, document.reviewVersion);
  assert.equal(response.automatedScreening, null);
  assert.equal(faceRequest.mock.callCount(), 1);
});

test("same-file submissions refresh legacy screening without overwriting approved documents or current manual comparisons", async (t) => {
  env(t, { KYC_DOCUMENT_QUEUE_ENABLED: "false" });
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("synthetic cache fixture")]);
  const profile = { full_name: "Sample Applicant", first_name: "Sample", last_name: "Applicant", business_name: "Sample Rentals", permit_number: "TEST123" };
  const document = doc({ docType: "supporting", role: "owner", selectedDocCategory: "DTI Business Name Registration", profileSnapshot: profile,
    fileHash: crypto.createHash("sha256").update(bytes).digest("hex") });
  const fresh = evaluatePrivateDocumentInspection({ inspection: normalizePrivateOcrResponse(ocr(["DEPARTMENT OF TRADE AND INDUSTRY",
    "CERTIFICATE OF BUSINESS NAME REGISTRATION", "Business Name: SAMPLE RENTALS", "Permit Number: TEST123"])), docType: "supporting",
    selectedDocType: document.selectedDocCategory, profile, sessionId: document.sessionId, role: document.role,
    fileHash: document.fileHash, reviewVersion: document.reviewVersion });
  document.privateScreening = structuredClone(fresh.privateScreening);
  document.privateScreening.automatedCheck.version = 1;
  t.mock.method(PreKycDocument, "findOne", () => ({ select: async () => document }));
  t.mock.method(fs, "mkdir", async () => {});
  t.mock.method(fs, "writeFile", async () => {});
  const write = t.mock.method(PreKycDocument, "findOneAndUpdate", async (_query, update) => ({ ...document, ...update.$set }));
  const submit = async () => {
    let result;
    await preVerifySupportingDocument({ preKyc: { email: document.email, role: document.role, sessionId: document.sessionId },
      body: { doc_image_base64: bytes.toString("base64"), doc_image_mime: "image/png", supporting_doc_type: document.selectedDocCategory, user_profile: profile } },
      { json: (value) => { result = value; }, status(value) { throw Error(`Unexpected HTTP ${value}`); } });
    return result;
  };
  assert.equal((await submit()).documentStatus, "queued");
  assert.equal(write.mock.callCount(), 1);
  assert.equal(write.mock.calls[0].arguments[1].$set.manualComparison, null);
  assert.notEqual(write.mock.calls[0].arguments[1].$set.reviewVersion, document.reviewVersion);
  document.status = "verified";
  assert.equal((await submit()).documentStatus, "verified");
  document.status = "pending_review"; document.detailsMatched = true;
  document.validationChecks = { documentTypeMatches: true };
  document.manualComparison = { fileHash: document.fileHash, reviewVersion: document.reviewVersion,
    documentType: document.selectedDocCategory, documentTypeCheckVersion: 1 };
  assert.equal((await submit()).documentStatus, "pending_review");
  delete document.manualComparison; document.detailsMatched = false;
  document.privateScreening = fresh.privateScreening;
  assert.equal((await submit()).documentStatus, "pending_review");
  assert.equal(write.mock.callCount(), 1);
  document.reasonCode = "PRIVATE_KYC_SERVICE_INCOMPATIBLE";
  assert.equal((await submit()).documentStatus, "queued");
  assert.equal(write.mock.callCount(), 2);
  document.status = "verified";
  assert.equal((await submit()).documentStatus, "verified");
  document.status = "pending_review"; document.detailsMatched = true;
  document.validationChecks = { documentTypeMatches: true };
  document.manualComparison = { fileHash: document.fileHash, reviewVersion: document.reviewVersion,
    documentType: document.selectedDocCategory, documentTypeCheckVersion: 1 };
  assert.equal((await submit()).documentStatus, "pending_review");
  assert.equal(write.mock.callCount(), 2);
});

test("admin KYC assets load from an isolated backend and match source when the admin checkout is available", async (t) => {
  const backend = fileURLToPath(new URL("..", import.meta.url));
  const files = ["services/documentValidation.service.js", "services/manualDocumentComparison.js",
    "services/privateDocumentExtraction.service.js", "services/privateDocumentLayout.service.js", "services/privateKycReviewContext.js",
    "services/privateKycOcr.service.js", "utils/kycScreeningProvider.js", "utils/geminiDataPolicy.js"];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "isolated-admin-kyc-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  const adminAssets = path.resolve(backend, "..", "..", "rentifypro admin", "backend", "data", "private-kyc");
  let checkAdmin = false;
  const staleAssets = [];
  try { await fs.access(adminAssets); checkAdmin = true; } catch {}
  for (const file of files) {
    const bytes = await fs.readFile(path.join(backend, file));
    const target = path.join(root, "data", "private-kyc", file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    if (checkAdmin) {
      try { if (!(await fs.readFile(path.join(adminAssets, file))).equals(bytes)) staleAssets.push(file); }
      catch (error) { if (error.code === "ENOENT") staleAssets.push(file); else throw error; }
    }
  }
  const module = await import(pathToFileURL(path.join(root, "data/private-kyc/services/privateKycReviewContext.js")));
  assert.equal(typeof module.getPrivateKycReviewContext, "function");
  assert.equal(typeof module.readPrivateKycEvidence, "function");
  assert.equal(staleAssets.length, 0, `Admin KYC assets require synchronization: ${staleAssets.join(", ")}`);
});
