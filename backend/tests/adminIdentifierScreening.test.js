import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { identifierScreeningEnabled, extractIdentifierFinding, currentIdentifierFingerprint, identifierScreeningSummary,
  assertIdentifierScreeningSettled, identifierRevisionFilter, identifierDuplicateFilter,
  withCachedIdentifierTypeEvidence, runAdminIdentifierScreening } from "../services/adminIdentifierScreening.service.js";
import { prepareAdminVisualReview } from "../services/adminVisualReview.service.js";
import { createDocumentFingerprint } from "../data/private-kyc/services/documentValidation.service.js";

const bytes = Buffer.from("Synthetic original for background identifier checks");
const document = () => ({ _id: "507f1f77bcf86cd799439012", registeredUser: "507f1f77bcf86cd799439011",
  sessionId: "user:507f1f77bcf86cd799439011", email: "synthetic@example.test", status: "pending_review", docType: "id", provider: "private-ocr",
  role: "user", selectedDocCategory: "Philippine Passport", fileHash: createHash("sha256").update(bytes).digest("hex"),
  fileKey: "synthetic.jpg", mimeType: "image/jpeg", reviewVersion: "id-v1", detailsMatched: false, reviewHistory: [],
  profileSnapshot: { first_name: "Sample", last_name: "Applicant", date_of_birth: "1990-05-12" } });
const reading = (confidence = 0.99) => ({ layoutVersion: 2, pages: 1, provider: "private-ocr", lines: [
  "REPUBLIC OF THE PHILIPPINES", "PHILIPPINE PASSPORT", "Passport Number: SYNTHETIC12345",
  "Full Name: SAMPLE APPLICANT", "Date of Birth: 1990-05-12", "Date of Expiry: 2099-05-12",
].map((text, index) => ({ text, page: 1, confidence, bbox: [0.1, 0.05 + index * 0.1, 0.9, 0.08 + index * 0.1] })) });
function environment(t) {
  const env = { KYC_DOCUMENT_PROVIDER: "private_ocr", KYC_PRIVATE_SERVICE_URL: "http://127.0.0.1:8020",
    KYC_PRIVATE_INTERNAL_API_KEY: "k".repeat(32), KYC_DOCUMENT_FINGERPRINT_SECRET: "f".repeat(32),
    ADMIN_IDENTIFIER_SCREENING_ENABLED: "true", NODE_ENV: "test" };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  return env;
}
const boundFinding = (doc, fields = {}) => ({ version: 1, state: "complete", fileHash: doc.fileHash,
  reviewVersion: doc.reviewVersion, sessionId: doc.sessionId, selectedDocCategory: doc.selectedDocCategory,
  fingerprint: "a".repeat(64), confidence: 99, maskedIdentifier: "**** 2345", ...fields });

test("background identifiers require an explicitly configured private provider, key, and fingerprint secret", t => {
  const env = environment(t); assert.equal(identifierScreeningEnabled(env), true);
  assert.equal(identifierScreeningEnabled({ ...env, ADMIN_IDENTIFIER_SCREENING_ENABLED: "false" }), false);
  assert.equal(identifierScreeningEnabled({ ...env, KYC_DOCUMENT_PROVIDER: "manual" }), false);
  assert.equal(identifierScreeningEnabled({ ...env, KYC_DOCUMENT_PROVIDER: "gemini" }), false);
  assert.equal(identifierScreeningEnabled({ ...env, KYC_PRIVATE_SERVICE_URL: "http://remote.example.test" }), false);
  assert.equal(identifierScreeningEnabled({ ...env, KYC_DOCUMENT_FINGERPRINT_SECRET: "" }), false);
});

test("only confident positioned identifiers from the selected type produce a masked keyed finding", t => {
  environment(t); const doc = document();
  const found = extractIdentifierFinding(doc, reading());
  assert.equal(found.state, "complete"); assert.equal(found.fingerprint, createDocumentFingerprint("SYNTHETIC12345"));
  assert.equal(found.maskedIdentifier, "**** 2345"); assert.equal(JSON.stringify(found).includes("SYNTHETIC12345"), false);
  assert.equal(extractIdentifierFinding(doc, reading(0.94)).state, "uncertain");
  assert.equal(extractIdentifierFinding({ ...doc, selectedDocCategory: "PRC ID" }, reading()).state, "uncertain");
  assert.equal(extractIdentifierFinding(doc, { ...reading(), layoutVersion: 1 }).state, "uncertain");
});

test("findings are bound to the current upload and public summaries never disclose fingerprints", t => {
  environment(t); const doc = document(); doc.adminIdentifierScreening = boundFinding(doc);
  assert.equal(currentIdentifierFingerprint(doc), "a".repeat(64));
  assert.equal(JSON.stringify(identifierScreeningSummary(doc)).includes("a".repeat(64)), false);
  for (const change of [{ fileHash: "changed" }, { reviewVersion: "changed" }, { sessionId: "changed" }, { selectedDocCategory: "PRC ID" }]) {
    assert.equal(currentIdentifierFingerprint({ ...doc, ...change }), "");
  }
  const filter = identifierDuplicateFilter(doc, "a".repeat(64));
  assert.equal(filter.$or[1].$expr.$and.length, 4);
  doc.adminIdentifierScreening = boundFinding(doc, { state: "processing", lockedAt: new Date() });
  assert.throws(() => assertIdentifierScreeningSettled(doc), /running/);
  doc.adminIdentifierScreening.lockedAt = new Date(Date.now() - 6 * 60_000);
  assert.doesNotThrow(() => assertIdentifierScreeningSettled(doc));
  assert.equal(identifierScreeningSummary(doc).state, "retry_wait");
  assert.deepEqual(identifierRevisionFilter({}), { adminIdentifierScreening: { $exists: false } });
  assert.deepEqual(identifierRevisionFilter({ adminIdentifierScreening: null }), { adminIdentifierScreening: null });
});

test("current cached identifier type evidence avoids another OCR call without replacing known type checks", t => {
  environment(t); const doc = document(); const result = extractIdentifierFinding(doc, reading());
  doc.adminIdentifierScreening = boundFinding(doc, result);
  const cached = withCachedIdentifierTypeEvidence(doc);
  assert.equal(cached.privateScreening.typeCheck.fileHash, doc.fileHash);
  const input = { reviewMode: "visual", fileHash: doc.fileHash, reviewVersion: doc.reviewVersion, documentType: doc.selectedDocCategory,
    identifierScreeningRevision: identifierScreeningSummary(doc).reviewRevision,
    remarks: "Inspected the original including the masked identifier.", confirmations: { documentInspected: true, registrationDetailsMatch: true, currentlyValid: true } };
  assert.equal(prepareAdminVisualReview(cached, input, "synthetic-admin").documentNumberFingerprint, result.fingerprint);
  assert.throws(() => prepareAdminVisualReview(cached, { ...input, identifierScreeningRevision: undefined }, "synthetic-admin"), /screening changed/);
  assert.throws(() => prepareAdminVisualReview(cached, { ...input, identifierScreeningRevision: "old-reading" }, "synthetic-admin"), /screening changed/);
  doc.privateScreening = { candidateType: "PRC ID" };
  assert.equal(withCachedIdentifierTypeEvidence(doc), doc);
  doc.privateScreening = { typeCheck: { selectedType: "PRC ID" } };
  assert.equal(withCachedIdentifierTypeEvidence(doc), doc);
});

async function workerFixture(t, { inspect, previous, stale = false, corrupt = false } = {}) {
  environment(t); const doc = document(); if (previous) doc.adminIdentifierScreening = boundFinding(doc, previous);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "admin-identifier-"));
  t.after(async () => { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); await fs.rm(directory, { recursive: true, force: true }); });
  await fs.writeFile(path.join(directory, doc.fileKey), corrupt ? "tampered bytes" : bytes);
  let scanned = false, inspected = 0;
  const database = { collection: name => {
    assert.equal(name, "prekycdocuments");
    return {
      findOne: async filter => { assert.equal(filter.status, "pending_review"); if (scanned) return null; scanned = true; return structuredClone(doc); },
      findOneAndUpdate: async (filter, update) => {
        assert.deepEqual(filter.adminIdentifierScreening, doc.adminIdentifierScreening === undefined ? { $exists: false } : doc.adminIdentifierScreening);
        Object.assign(doc, update.$set); return structuredClone(doc);
      },
      updateOne: async (filter, update) => {
        assert.equal(filter["adminIdentifierScreening.token"], doc.adminIdentifierScreening.token);
        if (stale) { doc.reviewVersion = "id-v2"; return { modifiedCount: 0 }; }
        assert.equal(filter.reviewVersion, doc.reviewVersion); Object.assign(doc, update.$set); return { modifiedCount: 1 };
      },
    };
  } };
  const result = await runAdminIdentifierScreening(database, { ensure: async () => directory,
    inspect: async input => { inspected++; assert.equal(input.base64, bytes.toString("base64")); return inspect ? inspect(input) : reading(); } });
  return { doc, result, inspected };
}

test("the background worker hashes original bytes and stores findings without approving or changing registration details", async t => {
  const { doc, result, inspected } = await workerFixture(t);
  assert.equal(result.processed, 1); assert.equal(inspected, 1); assert.equal(doc.adminIdentifierScreening.state, "complete");
  assert.equal(doc.documentNumberFingerprint, undefined); assert.equal(doc.detailsMatched, false);
  assert.equal(doc.status, "pending_review"); assert.deepEqual(doc.reviewHistory, []);
  assert.equal(JSON.stringify(doc.adminIdentifierScreening).includes("SYNTHETIC12345"), false);
});

test("OCR failures back off after initial retries, invalid originals never reach OCR, and stale results are discarded", async t => {
  const unavailable = await workerFixture(t, { previous: { attempts: 2, state: "retry_wait" }, inspect: () => { throw new Error("Synthetic outage"); } });
  assert.equal(unavailable.doc.adminIdentifierScreening.state, "unavailable");
  assert.equal(+unavailable.doc.adminIdentifierScreening.nextAttemptAt - +unavailable.doc.adminIdentifierScreening.checkedAt, 15 * 60_000);
  const retry = await workerFixture(t, { inspect: () => { throw new Error("Synthetic outage"); } });
  assert.equal(retry.doc.adminIdentifierScreening.state, "retry_wait");
  assert.ok(retry.doc.adminIdentifierScreening.nextAttemptAt instanceof Date);
  const corrupt = await workerFixture(t, { corrupt: true }); assert.equal(corrupt.inspected, 0);
  const stale = await workerFixture(t, { stale: true });
  assert.equal(stale.doc.reviewVersion, "id-v2"); assert.equal(currentIdentifierFingerprint(stale.doc), "");
  assert.equal(stale.doc.adminIdentifierScreening.fingerprint, undefined);
});
