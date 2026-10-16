import test from "node:test";
import assert from "node:assert/strict";
import { canInspectRegistrationDocument, isSubmittedDocument, registrationReviewFilter, supportingDocumentCanContinue } from "../utils/registrationReview.js";
import User from "../models/User.js";
import { auditRegistrationUsers } from "../utils/registrationIndexAudit.js";

test("unsubmitted uploads require an explicit current ID-assistance request and never become submitted", () => {
  const document = { docType: "id", status: "pending_review", registrationDraftId: "draft", expiresAt: new Date(Date.now() + 60000) };
  assert.equal(canInspectRegistrationDocument(document), false);
  document.manualReviewRequestedAt = new Date(); assert.equal(canInspectRegistrationDocument(document), true);
  assert.equal(isSubmittedDocument(document), false);
  for (const edits of [{ docType: "supporting" }, { registrationCancelledAt: new Date() }, { registrationExpiresAt: new Date(0) }, { expiresAt: new Date(0) }]) {
    assert.equal(canInspectRegistrationDocument({ ...document, ...edits }), false);
  }
  assert.equal(isSubmittedDocument({ sessionId: "user:507f1f77bcf86cd799439011" }), true);
  assert.equal(isSubmittedDocument({ sessionId: "user:507f1f77bcf86cd799439011:invalid" }), false);
  assert.equal(isSubmittedDocument({ registeredUser: "507f1f77bcf86cd799439012", sessionId: "user:507f1f77bcf86cd799439011" }), false);
  assert.equal(canInspectRegistrationDocument({ ...document, registeredUser: "invalid" }), false);
  assert.equal(registrationReviewFilter().registrationCancelledAt, null);
});

test("business pending review permits uncertainty but never confirmed corrections", () => {
  assert.equal(supportingDocumentCanContinue({ status: "pending_review", automatedScreening: { outcome: "review_needed" } }), true);
  assert.equal(supportingDocumentCanContinue({ status: "pending_review", automatedScreening: { outcome: "correction_needed" } }), false);
  for (const status of ["queued", "processing", "retry_wait", "rejected", "reupload_required"]) assert.equal(supportingDocumentCanContinue({ status }), false);
});

test("account phone and registration-draft uniqueness include only present string values", () => {
  const indexes = User.schema.indexes();
  for (const field of ["phone", "registrationDraftId"]) {
    const index = indexes.find(([keys]) => keys[field] === 1);
    assert.equal(index[1].unique, true); assert.deepEqual(index[1].partialFilterExpression, { [field]: { $type: "string" } });
  }
});

test("index preflight detects normalized duplicates and noncanonical legacy values without exposing identities", () => {
  const report = auditRegistrationUsers([{ email: "Sample@GMAIL.COM", phone: "+639123456789", registrationDraftId: "same" },
    { email: "sample@gmail.com", phone: "9123456789", registrationDraftId: "same" }]);
  assert.equal(report.ready, false); assert.equal(report.duplicateEmails, 1); assert.equal(report.duplicatePhones, 1);
  assert.equal(report.duplicateDrafts, 1); assert.equal(report.nonCanonicalEmails, 1); assert.equal(report.nonCanonicalPhones, 1);
  assert.equal(JSON.stringify(report).includes("gmail"), false);
  assert.equal(auditRegistrationUsers([{ email: "sample@gmail.com" }]).ready, true);
});
