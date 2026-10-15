export function verificationGuidance(verification) {
  if (!verification) return { title: "Verification status unavailable", instruction: "Refresh your status before booking." };
  if (verification.accountStatus !== "active") return { title: "Account access restricted", instruction: "Contact support about your account status before booking." };
  if (!verification.emailVerified) return { title: "Email verification required", instruction: "Verify your registered email before continuing verification." };
  const documents = verification.documents || [];
  const correction = documents.find(document => ["rejected", "reupload_required"].includes(document.status));
  if (correction) return { title: "Verification needs correction", instruction: correction.docType === "supporting"
    ? "Read the recorded reason below and choose Replace business document. Your unaffected ID and selfie results are preserved."
    : "Read the recorded reason below and choose Replace ID. A replacement ID also needs a new selfie check." };
  if (documents.some(document => document.faceSetupRequired)) return { title: "ID setup interrupted", instruction: "Your ID is saved. Choose Retry saved ID setup, then continue selfie verification when its checks are ready." };
  const missing = documents.find(document => document.status === "not_submitted");
  if (missing) return { title: "Document required", instruction: `Choose ${missing.docType === "supporting" ? "Replace business document" : "Replace ID"} below to submit the required file.` };
  if (verification.bookingEligible) return { title: "Verification Complete", instruction: "Required verification checks are complete. Booking remains subject to availability and existing booking policies." };
  if (!verification.selfieVerified) return { title: "Selfie verification required", instruction: documents.some(document => document.identityReadyForSelfie)
    ? "Choose Continue selfie verification below. Your saved ID does not need another upload."
    : "Your ID must finish its document checks before you can continue selfie verification. Refresh status or follow any correction instructions below." };
  if (documents.some(document => ["queued", "processing", "retry_wait", "pending_review"].includes(document.status))) {
    return { title: "Verification Pending", instruction: "Your account is available. Booking stays restricted until every required document is approved. We will notify you about admin decisions; no repeat upload is needed while review is pending." };
  }
  return { title: "Verification required", instruction: "Booking remains restricted. Refresh status and follow the verification instructions, or contact support if all checks already appear complete." };
}

export function needsIdentityVerification(user, verification, knownBlock = false) {
  if (user?.role === "admin") return false;
  return verification ? verification.bookingEligible !== true : knownBlock || user?.kycStatus !== "approved";
}
