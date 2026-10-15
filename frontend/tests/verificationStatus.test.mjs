import test from "node:test";
import assert from "node:assert/strict";
import { needsIdentityVerification, verificationGuidance } from "../src/utils/verificationStatus.js";

const state = () => ({ accountStatus: "active", emailVerified: true, selfieVerified: true, bookingEligible: false,
  documents: [{ docType: "id", reference: "saved-id", status: "pending_review" }] });
test("fresh backend eligibility overrides both stale pending and stale approved account caches", () => {
  assert.equal(needsIdentityVerification({ role: "user", kycStatus: "rejected" }, { bookingEligible: true }, true), false);
  assert.equal(needsIdentityVerification({ role: "owner", kycStatus: "approved" }, { bookingEligible: false }), true);
  assert.equal(needsIdentityVerification({ role: "user", kycStatus: "challenge_passed" }), true);
});
for (const docType of ["id", "supporting"]) test(`${docType} rejection shows a replacement action while pending review asks for no repeat upload`, () => {
  const verification = state(); verification.documents[0].docType = docType;
  assert.equal(verificationGuidance(verification).title, "Verification Pending");
  assert.match(verificationGuidance(verification).instruction, /no repeat upload/);
  verification.documents[0].status = "rejected";
  assert.equal(verificationGuidance(verification).title, "Verification needs correction");
  assert.match(verificationGuidance(verification).instruction, docType === "id" ? /Replace ID/ : /Replace business document/);
});
test("saved-ID setup, selfie, account, email and completed states have distinct instructions", () => {
  const verification = state(); verification.selfieVerified = false; verification.documents[0].faceSetupRequired = true;
  assert.equal(verificationGuidance(verification).title, "ID setup interrupted");
  verification.documents[0].faceSetupRequired = false; verification.documents[0].identityReadyForSelfie = true;
  assert.match(verificationGuidance(verification).instruction, /Continue selfie verification/);
  verification.selfieVerified = true; verification.bookingEligible = true;
  assert.equal(verificationGuidance(verification).title, "Verification Complete");
  verification.emailVerified = false; assert.equal(verificationGuidance(verification).title, "Email verification required");
  verification.accountStatus = "suspended"; assert.equal(verificationGuidance(verification).title, "Account access restricted");
});
