import test from "node:test";
import assert from "node:assert/strict";
import { supportingDocumentCanContinue, registrationDocumentGuidance, needsManualIdReview } from "../src/utils/registrationVerification.js";

test("messages distinguish preliminary matching, manual assistance, final approval, and corrections", () => {
  const id = { docType: "id", status: "pending_review", identityReadyForSelfie: true };
  assert.match(registrationDocumentGuidance(id, "Government ID"), /Final document approval is pending/);
  assert.doesNotMatch(registrationDocumentGuidance(id, "Government ID"), /successfully|approved/);
  assert.match(registrationDocumentGuidance({ ...id, status: "verified" }, "Government ID"), /approved/);
  const unresolved = { ...id, identityReadyForSelfie: false };
  assert.equal(needsManualIdReview(unresolved), true);
  assert.match(registrationDocumentGuidance(unresolved, "Government ID"), /Request manual verification/);
  assert.match(registrationDocumentGuidance({ ...unresolved, manualReviewRequested: true }, "Government ID"), /requested/);
  const business = { docType: "supporting", status: "pending_review", automatedScreening: { outcome: "review_needed" } };
  assert.equal(supportingDocumentCanContinue(business), true);
  assert.match(registrationDocumentGuidance(business, "Business document"), /can continue registration/);
  business.automatedScreening.outcome = "correction_needed"; business.reason = "Business name does not match.";
  assert.equal(supportingDocumentCanContinue(business), false);
  assert.equal(registrationDocumentGuidance(business, "Business document"), business.reason);
});
