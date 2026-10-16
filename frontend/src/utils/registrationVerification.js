export function supportingDocumentCanContinue(document) {
  return Boolean(document && ["pending_review", "verified"].includes(document.status)
    && (!document.expiresAt || new Date(document.expiresAt) > new Date())
    && document.automatedScreening?.outcome !== "correction_needed");
}

export function needsManualIdReview(document) {
  return Boolean(document?.docType === "id" && document.status === "pending_review"
    && !document.identityReadyForSelfie && document.automatedScreening?.outcome !== "correction_needed");
}

export function registrationDocumentGuidance(document, label, selfieComplete = false) {
  const status = document?.status || "not_uploaded";
  if (["queued", "processing"].includes(status)) return document?.docType === "id"
    ? "Checking your ID type and registration details..." : "Checking your business document and registration details...";
  if (status === "retry_wait") return "Screening is taking longer than expected. We will retry automatically.";
  if (status === "verified") return `${label} approved.${document.docType === "id" && !selfieComplete ? " Continue to selfie verification." : " You can continue."}`;
  if (["rejected", "reupload_required"].includes(status) || document?.automatedScreening?.outcome === "correction_needed") {
    return document?.reason || `${label} needs correction. Check your details or upload another document.`;
  }
  if (document?.docType === "id" && document.identityReadyForSelfie) return `ID details checked.${selfieComplete ? "" : " Continue to selfie verification."} Final document approval is pending.`;
  if (needsManualIdReview(document)) return document.manualReviewRequested
    ? "Manual ID verification requested. Wait for the comparison result before continuing to selfie verification. Final approval remains pending. You can also upload a clearer ID."
    : "We couldn't confirm your ID details automatically. Request manual verification or upload a clearer ID before continuing to selfie verification.";
  if (document?.docType === "supporting" && supportingDocumentCanContinue(document)) return document.automatedScreening?.outcome === "passed"
    ? "Business document details checked. You can continue registration. Final approval is pending."
    : "Your business document needs admin review. You can continue registration; final approval is pending.";
  return document?.reason || `Upload ${label.toLowerCase()} to start its checks.`;
}
