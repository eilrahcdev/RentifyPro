import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import PreKycDocument from "../models/PreKycDocument.js";
import KycVerification from "../models/KycVerification.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";

function environment(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

const buffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXeoAAAAASUVORK5CYII=", "base64");
const profile = { full_name: "Sample Applicant", first_name: "Sample", last_name: "Applicant", date_of_birth: "1990-05-12", business_name: "Synthetic Shop", permit_number: "FIXTURE-ONLY" };
const response = () => ({
  statusCode: 200, headers: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  setHeader(name, value) { this.headers[name] = value; },
  type(value) { this.mimeType = value; return this; },
  sendFile(value) { this.file = value; return this; },
});

async function fixture(t, approved, existing = null) {
  environment(t, {
    NODE_ENV: "production", GEMINI_SENSITIVE_DATA_APPROVED: approved,
    GEMINI_API_KEY: approved === "true" ? "fixture-only" : undefined,
    KYC_DOCUMENT_QUEUE_ENABLED: "false", INTERNAL_API_KEY: "fixture-internal-key",
    FACE_SERVICE_URL: "https://face.example.test",
  });
  const controller = await import(`../controllers/kyc.controller.js?manual-review-${approved}`);
  const writes = [], files = new Map(), cases = [];
  t.mock.method(fs, "mkdir", async () => {});
  t.mock.method(fs, "writeFile", async (file, contents) => files.set(file, contents));
  t.mock.method(PreKycDocument, "findOne", () => ({ select: async () => existing }));
  t.mock.method(PreKycDocument, "findOneAndUpdate", async (_filter, update) => { writes.push(update.$set); return update.$set; });
  t.mock.method(KycVerification, "findOneAndUpdate", async (_filter, update) => { cases.push(update); return update; });
  t.mock.method(auditLog, "info", () => {});
  t.mock.method(auditLog, "error", () => {});
  const face = t.mock.method(axios, "post", async () => ({ data: { success: true }, status: 200 }));
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("An upload must not directly call Gemini."); });
  return { controller, writes, files, cases, face, provider };
}

test("production document uploads retain private evidence for review with automation disabled", async (t) => {
  for (const approved of ["false", "true"]) {
    for (const flow of ["registerIdFace", "preRegisterIdFace", "preVerifySupportingDocument"]) {
      await t.test(`${approved}: ${flow}`, async (t) => {
        const { controller, writes, files, cases, face, provider } = await fixture(t, approved);
        const supporting = flow === "preVerifySupportingDocument";
        const req = {
          user: { _id: "507f1f77bcf86cd799439011", email: "applicant@example.test", role: "user", name: profile.full_name },
          preKyc: { email: "applicant@example.test", role: "owner", sessionId: "registration-fixture" },
          body: { full_name: profile.full_name, user_profile: profile,
            id_image_base64: buffer.toString("base64"), id_image_mime: "image/png", id_type: "Philippine Passport",
            doc_image_base64: buffer.toString("base64"), doc_image_mime: "image/png", supporting_doc_type: "DTI Business Name Registration" },
        };
        const res = response();
        await controller[flow](req, res);
        assert.equal(res.statusCode, 200);
        assert.equal(writes.length, 1);
        const document = writes[0];
        assert.equal(document.status, approved === "true" ? "queued" : "pending_review");
        assert.equal(document.provider, approved === "true" ? "gemini-queued" : "manual");
        assert.equal(document.reasonCode, approved === "true" ? "QUEUED" : "GEMINI_DATA_POLICY_UNCONFIRMED");
        assert.equal(document.detailsMatched, false);
        assert.equal(document.verifiedAt, null);
        assert.equal(document.reviewedAt, null);
        assert.equal(document.processingAttempts, 0);
        assert.equal(document.nextAttemptAt instanceof Date, approved === "true");
        assert.equal(document.fileHash, crypto.createHash("sha256").update(buffer).digest("hex"));
        assert.equal(document.fileSize, buffer.length);
        assert.equal(document.filePath, "");
        assert.ok(document.expiresAt > new Date());
        assert.equal(document.profileSnapshot.full_name, profile.full_name);
        assert.equal(files.size, 1);
        assert.ok([...files.values()][0].equals(buffer));
        assert.equal(provider.mock.callCount(), 0);
        assert.equal(face.mock.callCount(), supporting ? 0 : 1);
        assert.ok(cases.every((entry) => entry.status === "id_uploaded" && entry.verifiedAt === null));
        if (approved === "false") assert.match(res.body.message, /administrator.*review/i);

        t.mock.method(PreKycDocument, "findById", () => ({ select: async () => document }));
        const fileResponse = response();
        await controller.getKycReviewFile({ params: { id: "507f1f77bcf86cd799439012" } }, fileResponse);
        assert.equal(fileResponse.statusCode, 200);
        assert.equal(fileResponse.headers["Cache-Control"], "private, no-store");
        assert.equal(path.basename(fileResponse.file), document.fileKey);
        assert.ok(files.get(fileResponse.file).equals(buffer));
      });
    }
  }
});

test("disabled screening preserves repeated manual uploads and existing approvals", async (t) => {
  for (const status of ["pending_review", "verified"]) {
    await t.test(status, async (t) => {
      const existing = { status, reasonCode: status === "verified" ? "PASSED" : "AUTOMATED_SCREENING_UNAVAILABLE",
        fileHash: crypto.createHash("sha256").update(buffer).digest("hex"), sessionId: "registration-fixture",
        selectedDocCategory: "DTI Business Name Registration", profileSnapshot: { ...profile, date_of_birth: undefined } };
      const { controller, writes, provider } = await fixture(t, "false", existing);
      const res = response();
      await controller.preVerifySupportingDocument({
        preKyc: { email: "applicant@example.test", role: "owner", sessionId: existing.sessionId },
        body: { doc_image_base64: buffer.toString("base64"), doc_image_mime: "image/png", supporting_doc_type: existing.selectedDocCategory, user_profile: profile },
      }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(writes.length, 0);
      assert.equal(existing.status, status);
      assert.equal(provider.mock.callCount(), 0);
    });
  }
});
