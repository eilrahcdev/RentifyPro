const accountSession = /^(?:user:[a-f\d]{24}|reverify:[a-f\d]{24}:[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i;
const accountId = /^[a-f\d]{24}$/i;

export function isSubmittedDocument(document) {
  if (!document || document.registrationCancelledAt) return false;
  const linked = String(document.registeredUser || "");
  const session = String(document.sessionId || "");
  const scoped = accountSession.test(session);
  if (/^(?:user:|reverify:)/i.test(session) && !scoped) return false;
  if (linked && (!accountId.test(linked) || (scoped && session.split(":")[1].toLowerCase() !== linked.toLowerCase()))) return false;
  return Boolean(linked || scoped);
}

export function isRequestedRegistrationReview(document, now = new Date()) {
  return Boolean(document?.registrationDraftId && document.manualReviewRequestedAt && !document.registrationCancelledAt
    && !document.registeredUser && !/^(?:user:|reverify:)/i.test(String(document.sessionId || ""))
    && document.docType === "id" && document.status === "pending_review"
    && (!document.registrationExpiresAt || new Date(document.registrationExpiresAt) > now)
    && document.expiresAt && new Date(document.expiresAt) > now);
}

export function canInspectRegistrationDocument(document, now = new Date()) {
  return Boolean(document && !document.registrationCancelledAt
    && (!document.expiresAt || new Date(document.expiresAt) > now)
    && (isSubmittedDocument(document) || isRequestedRegistrationReview(document, now)));
}

export function registrationReviewFilter(now = new Date()) {
  return { registrationCancelledAt: null, $and: [
    { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
    { $or: [{ registrationExpiresAt: null }, { registrationExpiresAt: { $gt: now } }] },
    { $or: [{ registeredUser: { $ne: null } }, { sessionId: accountSession },
      { registrationDraftId: { $type: "string" }, manualReviewRequestedAt: { $ne: null }, docType: "id", status: "pending_review" }] },
  ] };
}

export function supportingDocumentCanContinue(document) {
  return Boolean(document && ["pending_review", "verified"].includes(document.status)
    && (!document.expiresAt || new Date(document.expiresAt) > new Date())
    && document.automatedScreening?.outcome !== "correction_needed");
}
