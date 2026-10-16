import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import PreKycDocument from "../models/PreKycDocument.js";
import KycVerification from "../models/KycVerification.js";
import User from "../models/User.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import { canInspectRegistrationDocument } from "../utils/registrationReview.js";

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
  t.mock.method(fs, "unlink", async file => files.delete(file));
  t.mock.method(PreKycDocument, "exists", async filter => Boolean(filter.reviewVersion));
  t.mock.method(PreKycDocument, "findOne", () => ({ select: async () => existing }));
  t.mock.method(PreKycDocument, "findOneAndUpdate", async (_filter, update) => { writes.push(update.$set); return update.$set; });
  t.mock.method(KycVerification, "findOneAndUpdate", async (_filter, update) => { cases.push(update); return update; });
  t.mock.method(KycVerification, "findOne", () => ({ select: async () => null, then(resolve) { return Promise.resolve(null).then(resolve); } }));
  t.mock.method(KycVerification, "updateOne", async (_filter, update) => {
    if (update.$set.idRegisteredAt) assert.ok(update.$set.idRegisteredAt instanceof Date);
    else { assert.equal(update.$set.status, "id_uploaded"); assert.equal(update.$set.challengePassedAt, null); }
    return { matchedCount: 1 };
  });
  t.mock.method(User, "updateOne", async (_filter, update) => { assert.equal(update.$set.kycStatus, "id_uploaded"); return { matchedCount: 1 }; });
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
        if (flow === "registerIdFace") {
          assert.equal(document.registeredUser, req.user._id); assert.equal(document.expiresAt, undefined);
        } else assert.ok(document.expiresAt > new Date());
        assert.equal(document.profileSnapshot.full_name, profile.full_name);
        assert.equal(files.size, 1);
        assert.ok([...files.values()][0].equals(buffer));
        assert.equal(provider.mock.callCount(), 0);
        assert.equal(face.mock.callCount(), supporting ? 0 : 1);
        assert.ok(cases.every((entry) => entry.status === "id_uploaded" && entry.verifiedAt === null));
        if (approved === "false") assert.match(res.body.message, /administrator.*review/i);

        let review = document;
        t.mock.method(PreKycDocument, "findById", () => ({ select: async () => review }));
        if (flow !== "registerIdFace") {
          assert.equal(canInspectRegistrationDocument(review), false);
          const unsubmittedResponse = response();
          await controller.getKycReviewFile({ params: { id: "507f1f77bcf86cd799439012" } }, unsubmittedResponse);
          assert.equal(unsubmittedResponse.statusCode, 409);
          assert.equal(unsubmittedResponse.body.success, false);
          assert.equal(unsubmittedResponse.file, undefined);
          review = { ...document, registeredUser: req.user._id, expiresAt: undefined };
        }
        assert.equal(canInspectRegistrationDocument(review), true);
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

test("pre-registration review files require a current manual-assistance ID request", async (t) => {
  const { controller, provider } = await fixture(t, "false");
  const document = {
    sessionId: "registration-fixture", registeredUser: null,
    registrationDraftId: "registration-draft-fixture", manualReviewRequestedAt: new Date(),
    registrationExpiresAt: new Date(Date.now() + 3600000), expiresAt: new Date(Date.now() + 3600000),
    docType: "id", status: "pending_review", fileKey: "fixture-id.png", mimeType: "image/png",
  };
  const cases = [
    ["current ID-assistance request", {}, true],
    ["no request", { manualReviewRequestedAt: null }, false],
    ["no registration draft", { registrationDraftId: null }, false],
    ["supporting document", { docType: "supporting" }, false],
    ["queued ID", { status: "queued" }, false],
    ["expired evidence", { expiresAt: new Date(0) }, false],
    ["missing evidence expiry", { expiresAt: null }, false],
    ["expired registration", { registrationExpiresAt: new Date(0) }, false],
    ["cancelled registration", { registrationCancelledAt: new Date() }, false],
  ];
  for (const [name, overrides, allowed] of cases) {
    await t.test(name, async (t) => {
      const review = { ...document, ...overrides };
      assert.equal(canInspectRegistrationDocument(review), allowed);
      t.mock.method(PreKycDocument, "findById", () => ({ select: async () => review }));
      const res = response();
      await controller.getKycReviewFile({ params: { id: "507f1f77bcf86cd799439012" } }, res);
      assert.equal(res.statusCode, allowed ? 200 : 409);
      if (allowed) {
        assert.equal(res.headers["Cache-Control"], "private, no-store");
        assert.equal(res.mimeType, document.mimeType);
        assert.equal(path.basename(res.file), document.fileKey);
      } else {
        assert.equal(res.body.success, false);
        assert.equal(res.file, undefined);
        assert.equal(res.mimeType, undefined);
      }
    });
  }
  assert.equal(provider.mock.callCount(), 0);
});

test("disabled screening preserves repeated manual uploads and existing approvals", async (t) => {
  for (const status of ["pending_review", "verified"]) {
    await t.test(status, async (t) => {
      const existing = { status, reasonCode: status === "verified" ? "PASSED" : "AUTOMATED_SCREENING_UNAVAILABLE",
        expiresAt: new Date(Date.now() + 3600000),
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
