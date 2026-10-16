import test from "node:test";
import assert from "node:assert/strict";
import { assertCurrentDocument, validateAdminKycDecision } from "../services/privateKycReview.service.js";
import { isSubmittedDocument, canInspectRegistrationDocument } from "../data/private-kyc/utils/registrationReview.js";

const draftDocument = () => ({ docType: "id", role: "user", status: "pending_review", sessionId: "private-draft-session",
  registrationDraftId: "draft", expiresAt: new Date(Date.now() + 60000), reviewVersion: "revision", fileHash: "hash" });

test("unsubmitted applicants are invisible until they explicitly request current ID assistance", () => {
  const doc = draftDocument();
  assert.equal(canInspectRegistrationDocument(doc), false);
  assert.throws(() => assertCurrentDocument(doc), /requested manual verification/);
  doc.manualReviewRequestedAt = new Date();
  assert.doesNotThrow(() => assertCurrentDocument(doc));
  assert.equal(isSubmittedDocument(doc), false);
  for (const decision of ["Approved", "Rejected"]) assert.throws(() => validateAdminKycDecision(doc, decision, doc.reviewVersion), /submitted registration/);
});

test("cancelled, expired, replaced, and business drafts cannot use ID assistance", () => {
  const doc = { ...draftDocument(), manualReviewRequestedAt: new Date() };
  for (const change of [{ registrationCancelledAt: new Date() }, { registrationExpiresAt: new Date(0) },
    { expiresAt: new Date(0) }, { manualReviewRequestedAt: null }, { docType: "supporting" }, { status: "queued" }]) {
    assert.equal(canInspectRegistrationDocument({ ...doc, ...change }), false);
    assert.throws(() => assertCurrentDocument({ ...doc, ...change }));
  }
});

test("submitted ownership remains consistent and permits final rejection with a current revision", () => {
  const id = "507f1f77bcf86cd799439011";
  const doc = { ...draftDocument(), registeredUser: id, sessionId: "user:" + id };
  assert.equal(isSubmittedDocument(doc), true);
  assert.doesNotThrow(() => validateAdminKycDecision(doc, "Rejected", doc.reviewVersion));
  assert.equal(isSubmittedDocument({ ...doc, registeredUser: "507f1f77bcf86cd799439012" }), false);
  assert.throws(() => assertCurrentDocument({ ...doc, sessionId: doc.sessionId + ":invalid" }));
});
