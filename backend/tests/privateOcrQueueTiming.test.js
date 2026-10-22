import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import PreKycDocument from "../models/PreKycDocument.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import { processNextKycDocument } from "../jobs/kycDocumentProcessing.job.js";
import { isIdentityReadyForSelfie } from "../utils/preKycDocs.js";
import { privateOcrServiceManager } from "../utils/privateOcrServiceManager.js";

function environment(t, values = {}) {
  for (const [key, value] of Object.entries({ NODE_ENV: "test", KYC_DOCUMENT_PROVIDER: "private_ocr",
    KYC_PRIVATE_SERVICE_AUTOSTART: "false", KYC_PRIVATE_SERVICE_URL: "http://127.0.0.1:8020", INTERNAL_API_KEY: "i".repeat(32),
    KYC_DOCUMENT_QUEUE_ENABLED: "true", KYC_PROCESSING_LOCK_TIMEOUT_MS: undefined, KYC_PRIVATE_REQUEST_TIMEOUT_MS: undefined,
    GEMINI_SENSITIVE_DATA_APPROVED: "false", KYC_DOCUMENT_FINGERPRINT_SECRET: "f".repeat(32), ...values })) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

const reading = () => ({ schema_version: 1, provider: "paddleocr", layout_version: 2, pages: 1,
  lines: ["PHILIPPINE PASSPORT", "Full Name: SAMPLE APPLICANT", "Date of Birth: 1990-05-12",
    "Passport No.: SYNTHETIC123", "Expiration Date: 2099-05-12"].map((text, index) =>
    ({ text, page: 1, confidence: 0.99, bbox: [0.1, 0.1 + index * 0.1, 0.9, 0.14 + index * 0.1] })) });

test("private startup finishes before claiming a document and cannot create a concurrent claim", async (t) => {
  environment(t);
  let ready;
  const starting = new Promise((resolve) => { ready = resolve; });
  const warmup = t.mock.method(privateOcrServiceManager, "warmup", () => starting);
  const claim = t.mock.method(PreKycDocument, "findOneAndUpdate", () => ({ select: async () => null }));
  const processing = processNextKycDocument();
  try {
    await new Promise(setImmediate);
    assert.equal(warmup.mock.callCount(), 1);
    assert.equal(claim.mock.callCount(), 0);
    assert.equal(await processNextKycDocument(), false);
  } finally { ready(true); await processing; }
  assert.equal(claim.mock.callCount(), 1);
});

test("default private processing locks recover after one minute while Gemini retains its existing ten-minute policy", async (t) => {
  for (const [provider, expected] of [["private_ocr", 60000], ["gemini", 600000]]) await t.test(provider, async (t) => {
    environment(t, { KYC_DOCUMENT_PROVIDER: provider });
    let filter;
    t.mock.method(PreKycDocument, "findOneAndUpdate", (query) => { filter = query; return { select: async () => null }; });
    const before = Date.now();
    assert.equal(await processNextKycDocument(), false);
    const cutoff = filter.$or.find((query) => query.status === "processing").processingLockedAt.$lte.getTime();
    assert.ok(cutoff >= before - expected && cutoff <= Date.now() - expected);
  });
});

test("private recovery always allows the HTTP timeout plus write grace and respects longer explicit leases", async (t) => {
  for (const [settings, expected] of [
    [{ KYC_PRIVATE_REQUEST_TIMEOUT_MS: "120000" }, 150000],
    [{ KYC_PRIVATE_REQUEST_TIMEOUT_MS: "invalid" }, 60000],
    [{ KYC_PRIVATE_REQUEST_TIMEOUT_MS: "900000" }, 60000],
    [{ KYC_PROCESSING_LOCK_TIMEOUT_MS: "1" }, 60000],
    [{ KYC_PROCESSING_LOCK_TIMEOUT_MS: "180000" }, 180000],
  ]) await t.test(JSON.stringify(settings), async (t) => {
    environment(t, settings);
    let filter;
    t.mock.method(PreKycDocument, "findOneAndUpdate", (query) => { filter = query; return { select: async () => null }; });
    const before = Date.now();
    await processNextKycDocument();
    const cutoff = filter.$or.find((query) => query.status === "processing").processingLockedAt.$lte.getTime();
    assert.ok(cutoff >= before - expected && cutoff <= Date.now() - expected);
  });
});

test("a restarted worker can recheck an abandoned private upload without approving it or accepting stale writes", async (t) => {
  environment(t);
  const bytes = Buffer.from("synthetic restart fixture"), oldLock = new Date(Date.now() - 90000);
  const document = { _id: "507f1f77bcf86cd799439012", email: "synthetic@example.test", sessionId: "synthetic-session",
    role: "user", docType: "id", provider: "private-ocr", selectedDocCategory: "Philippine Passport", status: "processing",
    fileKey: "synthetic.jpg", fileHash: crypto.createHash("sha256").update(bytes).digest("hex"), reviewVersion: "synthetic-revision",
    processingLockedAt: oldLock, processingAttempts: 1, queuedAt: new Date(Date.now() - 95000),
    profileSnapshot: { first_name: "Sample", last_name: "Applicant", date_of_birth: "1990-05-12" } };
  t.mock.method(PreKycDocument, "findOneAndUpdate", (filter, update) => ({ select: async () => {
    const cutoff = filter.$or.find((query) => query.status === "processing").processingLockedAt.$lte;
    if (oldLock > cutoff) return null;
    document.processingLockedAt = update.$set.processingLockedAt;
    document.processingAttempts++;
    return document;
  } }));
  t.mock.method(fs, "readFile", async () => bytes);
  t.mock.method(PreKycDocument, "exists", async () => false);
  t.mock.method(auditLog, "info", () => {});
  t.mock.method(globalThis, "fetch", async (url) => { assert.equal(url, "http://127.0.0.1:8020/inspect"); return Response.json(reading()); });
  let saved;
  t.mock.method(PreKycDocument, "updateOne", async (filter, update) => {
    assert.equal(filter.fileHash, document.fileHash);
    assert.equal(filter.reviewVersion, document.reviewVersion);
    assert.equal(filter.processingLockedAt, document.processingLockedAt);
    assert.notEqual(filter.processingLockedAt, oldLock);
    saved = update.$set; return { modifiedCount: 1 };
  });
  assert.equal(await processNextKycDocument(), true);
  assert.equal(saved.status, "pending_review");
  assert.equal(saved.verifiedAt, null);
  assert.equal(saved.detailsMatched, false);
  assert.equal(saved.privateScreening.automatedCheck.outcome, "passed");
  assert.equal(saved.privateScreening.referenceAssessment.mode, "shadow");
  assert.equal(saved.privateScreening.referenceAssessment.fileHash, document.fileHash);
  assert.equal(saved.privateScreening.referenceAssessment.reviewVersion, document.reviewVersion);
  assert.equal(saved.privateScreening.referenceAssessment.issuerAuthentication.status, "not_performed");
  assert.equal(isIdentityReadyForSelfie({ ...document, ...saved }), true);
});
