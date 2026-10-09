import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import PreKycDocument from "../models/PreKycDocument.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import { processNextKycDocument, startKycDocumentProcessingJob, stopKycDocumentProcessingJob, triggerKycDocumentProcessing } from "../jobs/kycDocumentProcessing.job.js";
import { screenVehiclePhoto } from "../services/vehiclePhoto.service.js";
import { preVerifySupportingDocument } from "../controllers/kyc.controller.js";

const extraction = {
  image_readable: true,
  recognized_document: true,
  document_type: "Philippine Passport",
  issuing_country: "PH",
  classification_confidence: 98,
  document_surface: "PHYSICAL_DOCUMENT",
  structural_features: {
    official_markings_present: true,
    layout_consistent: true,
    holder_portrait_present: true,
    document_number_region_present: true,
    birth_date_region_present: true,
    expiration_date_region_present: true,
    machine_readable_zone_present: true,
    business_registration_features_present: false,
  },
  authenticity_uncertain: false,
  suspected_tampering: false,
  warnings: [],
  extraction_confidence: 96,
  extracted_data: {
    full_name: "SAMPLE APPLICANT",
    birth_date: "1990-05-12",
    document_number: "SYNTHETIC123",
    expiration_date: "2099-05-12",
  },
};

const providerResponse = (data = extraction) => new Response(JSON.stringify({
  candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(data) }] }, finishReason: "STOP" }],
}), { status: 200, headers: { "Content-Type": "application/json" } });

function environment(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    });
  }
}

let clock = Date.now();
function fixture(t, { attempt = 1, fetch = async () => providerResponse(), env = {} } = {}) {
  environment(t, {
    NODE_ENV: "test",
    GEMINI_API_KEY: "fixture-only",
    GEMINI_VISION_MODEL: undefined,
    GEMINI_VEHICLE_PHOTO_MODEL: undefined,
    GEMINI_SENSITIVE_DATA_APPROVED: undefined,
    KYC_DOCUMENT_QUEUE_ENABLED: "true",
    KYC_GEMINI_REQUESTS_PER_MINUTE: "4",
    KYC_GEMINI_MAX_ATTEMPTS: "3",
    KYC_GEMINI_REQUEST_TIMEOUT_MS: undefined,
    KYC_ALLOW_RULE_BASED_AUTO_VERIFY: "false",
    KYC_ALLOW_GEMINI_AUTO_APPROVE: "false",
    KYC_DOCUMENT_FINGERPRINT_SECRET: "synthetic-fingerprint-secret",
    ...env,
  });
  // Advance the clock between cases without waiting through the real request throttle.
  clock += 60_000;
  t.mock.method(Date, "now", () => clock);
  const buffer = Buffer.from("synthetic document bytes; no personal information");
  const document = {
    _id: "document-fixture",
    email: "applicant@example.test",
    sessionId: "registration-fixture",
    role: "user",
    docType: "id",
    selectedDocCategory: "Philippine Passport",
    fileKey: "synthetic-document.jpg",
    fileHash: crypto.createHash("sha256").update(buffer).digest("hex"),
    reviewVersion: "current-screening-fixture",
    mimeType: "image/jpeg",
    processingAttempts: attempt,
    processingLockedAt: new Date(),
    queuedAt: new Date(),
    profileSnapshot: { first_name: "Sample", last_name: "Applicant", date_of_birth: "1990-05-12" },
  };
  const writes = [], alerts = [];
  t.mock.method(fs, "readFile", async () => buffer);
  t.mock.method(PreKycDocument, "findOneAndUpdate", () => ({ select: async () => document }));
  t.mock.method(PreKycDocument, "exists", async () => false);
  t.mock.method(PreKycDocument, "updateOne", async (filter, update) => {
    assert.equal(filter.status, "processing");
    assert.equal(filter.fileHash, document.fileHash);
    assert.equal(filter.reviewVersion, document.reviewVersion);
    assert.equal(filter.processingLockedAt, document.processingLockedAt);
    writes.push(update.$set);
    return { modifiedCount: 1 };
  });
  t.mock.method(auditLog, "info", () => {});
  t.mock.method(auditLog, "warn", (_category, _message, metadata) => alerts.push(metadata));
  t.mock.method(auditLog, "error", (_category, _message, metadata) => alerts.push(metadata));
  const provider = t.mock.method(globalThis, "fetch", fetch);
  return { writes, alerts, provider };
}

test("production opt-in still screens documents without automatically approving them", async (t) => {
  const { writes, provider } = fixture(t, { env: { NODE_ENV: "production", GEMINI_SENSITIVE_DATA_APPROVED: "true" } });
  assert.equal(await processNextKycDocument(), true);
  assert.equal(provider.mock.callCount(), 1);
  assert.equal(writes[0].status, "pending_review");
  assert.equal(writes[0].detailsMatched, true);
  assert.equal(writes[0].verifiedAt, null);
});

test("disabled KYC screening routes queued documents to review without reading or uploading images", async (t) => {
  for (const mode of ["production", "development", "test"]) {
    await t.test(mode, async (t) => {
      const { writes, provider } = fixture(t, { env: {
        NODE_ENV: mode, GEMINI_SENSITIVE_DATA_APPROVED: "false", GEMINI_API_KEY: undefined,
        KYC_ALLOW_RULE_BASED_AUTO_VERIFY: "true", KYC_ALLOW_GEMINI_AUTO_APPROVE: "true",
      } });
      const fileReads = t.mock.method(fs, "readFile", async () => { throw new Error("The disabled worker must not read private images."); });
      assert.equal(await processNextKycDocument(), true);
      assert.equal(fileReads.mock.callCount(), 0);
      assert.equal(provider.mock.callCount(), 0);
      assert.equal(writes[0].status, "pending_review");
      assert.equal(writes[0].reasonCode, "GEMINI_DATA_POLICY_UNCONFIRMED");
      assert.equal(writes[0].provider, "manual");
      assert.equal(writes[0].verifiedAt, null);
      assert.equal(writes[0].nextAttemptAt, null);
      assert.equal(writes[0].processingLockedAt, null);
      for (const field of ["fileKey", "fileHash", "fileName", "profileSnapshot", "expiresAt", "detailsMatched"]) assert.equal(field in writes[0], false);
    });
  }
});

test("starting and triggering the disabled-screening queue cannot call Gemini", async (t) => {
  const { writes, provider } = fixture(t, { env: { NODE_ENV: "production", GEMINI_SENSITIVE_DATA_APPROVED: "false" } });
  t.after(stopKycDocumentProcessingJob);
  startKycDocumentProcessingJob();
  for (let attempt = 0; attempt < 20 && writes.length < 1; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 1);
  stopKycDocumentProcessingJob();
  triggerKycDocumentProcessing();
  for (let attempt = 0; attempt < 20 && writes.length < 2; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 2);
  assert.ok(writes.every((write) => write.status === "pending_review" && write.verifiedAt === null));
  assert.equal(provider.mock.callCount(), 0);
});

test("the provider gate rechecks approval after an asynchronous private-file read", async (t) => {
  const { writes, provider } = fixture(t, { env: { NODE_ENV: "production", GEMINI_SENSITIVE_DATA_APPROVED: "true" } });
  t.mock.method(fs, "readFile", async () => {
    process.env.GEMINI_SENSITIVE_DATA_APPROVED = "false";
    return Buffer.from("synthetic document bytes; no personal information");
  });
  assert.equal(await processNextKycDocument(), true);
  assert.equal(provider.mock.callCount(), 0);
  assert.equal(writes[0].status, "pending_review");
  assert.equal(writes[0].verifiedAt, null);
  assert.equal(writes[0].nextAttemptAt, null);
});

test("the working default model extracts a matching ID while retaining admin approval", async (t) => {
  const { writes } = fixture(t, { fetch: async (url, options) => {
    assert.match(url, /models\/gemini-3\.5-flash-lite:generateContent/);
    assert.equal(options.headers.get("x-goog-api-key"), "fixture-only");
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.contents[0].parts[1].inlineData.mimeType, "image/jpeg");
    return providerResponse();
  } });
  assert.equal(await processNextKycDocument(), true);
  assert.equal(writes[0].status, "pending_review");
  assert.equal(writes[0].detailsMatched, true);
  assert.equal(writes[0].verifiedAt, null);
  assert.equal(writes[0].processingLockedAt, null);
});

test("provider errors preserve permanent failures and retry only temporary ones", async (t) => {
  for (const status of [400, 401, 402, 403, 404, 408, 429, 500, 502, 503, 504]) {
    await t.test(`HTTP ${status}`, async (t) => {
      const { writes, alerts, provider } = fixture(t, { fetch: async () => new Response(JSON.stringify({
        error: { message: "Synthetic provider error that must stay out of applicant messages" },
      }), { status }) });
      await processNextKycDocument();
      const retryable = [408, 429, 500, 502, 503, 504].includes(status);
      assert.equal(provider.mock.callCount(), 1);
      assert.equal(writes[0].status, retryable ? "retry_wait" : "pending_review");
      assert.equal(writes[0].nextAttemptAt instanceof Date, retryable);
      assert.equal(writes[0].reasonCode, retryable ? "SCREENING_RETRY_PENDING" : "AUTOMATED_SCREENING_UNAVAILABLE");
      assert.equal(writes[0].reason.includes("Synthetic provider error"), false);
      assert.equal(writes[0].processingError.includes("Synthetic provider error"), false);
      assert.equal(alerts[0].httpStatus, status);
      assert.equal(alerts[0].retryable, retryable);
    });
  }
});

test("missing credentials and the production data gate skip retries without uploading documents", async (t) => {
  for (const env of [
    { GEMINI_API_KEY: undefined },
    { NODE_ENV: "production", GEMINI_SENSITIVE_DATA_APPROVED: "false" },
  ]) {
    await t.test(env.NODE_ENV ? "unconfirmed data handling" : "missing key", async (t) => {
      const { writes, provider } = fixture(t, { env });
      await processNextKycDocument();
      assert.equal(provider.mock.callCount(), 0);
      assert.equal(writes[0].status, "pending_review");
      assert.equal(writes[0].nextAttemptAt, null);
    });
  }
});

test("a stalled Gemini request is aborted and releases the worker for the next document", async (t) => {
  let aborted = false;
  const { writes, alerts, provider } = fixture(t, {
    env: { KYC_GEMINI_REQUEST_TIMEOUT_MS: "25" },
    fetch: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Synthetic timeout", "AbortError"));
      }, { once: true });
    }),
  });
  await processNextKycDocument();
  assert.equal(aborted, true);
  assert.equal(writes[0].status, "retry_wait");
  assert.equal(writes[0].processingLockedAt, null);
  assert.equal(alerts[0].httpStatus, 504);
  clock += 60_000;
  provider.mock.mockImplementation(async () => providerResponse());
  assert.equal(await processNextKycDocument(), true);
  assert.equal(writes[1].status, "pending_review");
  assert.equal(writes[1].detailsMatched, true);
});

test("the final temporary failure goes to manual review instead of rejecting the document", async (t) => {
  const { writes } = fixture(t, { attempt: 3, fetch: async () => new Response(JSON.stringify({
    error: { message: "Synthetic outage" },
  }), { status: 503 }) });
  await processNextKycDocument();
  assert.equal(writes[0].status, "pending_review");
  assert.equal(writes[0].nextAttemptAt, null);
});

test("a bad timeout setting retains the 30-second default and successful requests clear it", async (t) => {
  fixture(t, { env: { KYC_GEMINI_REQUEST_TIMEOUT_MS: "0" } });
  const scheduled = [], cleared = [];
  const schedule = globalThis.setTimeout, clear = globalThis.clearTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
    const handle = schedule(callback, delay, ...args);
    scheduled.push({ handle, delay });
    return handle;
  });
  t.mock.method(globalThis, "clearTimeout", (handle) => { cleared.push(handle); return clear(handle); });
  await processNextKycDocument();
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 30_000);
  assert.ok(cleared.includes(scheduled[0].handle));
});

test("explicit document model configuration still overrides the default", async (t) => {
  fixture(t, { env: { GEMINI_VISION_MODEL: "custom-model-fixture" }, fetch: async (url) => {
    assert.match(url, /models\/custom-model-fixture:generateContent/);
    return providerResponse();
  } });
  await processNextKycDocument();
});

test("vehicle photo screening uses the working default and retains its model override", async (t) => {
  for (const override of [undefined, "vehicle-model-fixture"]) {
    await t.test(override || "default", async (t) => {
      const timers = [], schedule = globalThis.setTimeout;
      t.mock.method(globalThis, "setTimeout", (...args) => {
        const timer = schedule(...args);
        timers.push(timer);
        return timer;
      });
      t.after(() => timers.forEach((timer) => clearTimeout(timer)));
      fixture(t, { env: { GEMINI_VEHICLE_PHOTO_MODEL: override }, fetch: async (url) => {
        assert.ok(url.includes(`/models/${override || "gemini-3.5-flash-lite"}:generateContent`));
        return providerResponse({ kind: "interior", matchesType: true, confidence: 0.95 });
      } });
      assert.deepEqual(await screenVehiclePhoto(Buffer.from("synthetic photo"), "car"), {
        status: "approved", exterior: false, reason: "Vehicle photo screening passed.",
      });
    });
  }
});

test("explicitly retrying the same upload requeues only an unavailable screening result", async (t) => {
  const profile = { full_name: "Sample Applicant", first_name: "Sample", last_name: "Applicant", business_name: "Synthetic Shop", permit_number: "FIXTURE-ONLY" };
  const buffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXeoAAAAASUVORK5CYII=", "base64");
  for (const [status, reasonCode, requeue] of [
    ["pending_review", "AUTOMATED_SCREENING_UNAVAILABLE", true],
    ["pending_review", "GEMINI_DATA_POLICY_UNCONFIRMED", true],
    ["pending_review", "REVIEW_REQUIRED", false],
    ["verified", "PASSED", false],
    ["queued", "QUEUED", false],
    ["processing", "QUEUED", false],
    ["retry_wait", "SCREENING_RETRY_PENDING", false],
  ]) {
    await t.test(`${status}: ${reasonCode}`, async (t) => {
      environment(t, { KYC_DOCUMENT_QUEUE_ENABLED: "false" });
      const existing = { status, reasonCode, fileHash: crypto.createHash("sha256").update(buffer).digest("hex"), sessionId: "registration-fixture", selectedDocCategory: "DTI Business Name Registration", profileSnapshot: profile, expiresAt: new Date(Date.now() + 3600000) };
      const writes = [];
      t.mock.method(fs, "mkdir", async () => {});
      t.mock.method(fs, "writeFile", async () => {});
      t.mock.method(PreKycDocument, "findOne", () => ({ select: async () => existing }));
      t.mock.method(PreKycDocument, "findOneAndUpdate", async (_filter, update) => {
        writes.push(update.$set);
        return update.$set;
      });
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await preVerifySupportingDocument({
        preKyc: { email: "applicant@example.test", role: "owner", sessionId: existing.sessionId },
        body: { doc_image_base64: buffer.toString("base64"), doc_image_mime: "image/png", supporting_doc_type: existing.selectedDocCategory, user_profile: profile },
      }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(writes.length, requeue ? 1 : 0);
      if (requeue) {
        assert.equal(writes[0].status, "queued");
        assert.equal(writes[0].processingAttempts, 0);
        assert.equal(writes[0].detailsMatched, false);
        assert.ok(writes[0].reviewVersion);
      }
    });
  }
});
