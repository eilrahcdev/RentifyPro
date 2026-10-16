export function evaluateDocumentApprovals(kyc, identity, supporting, now = new Date(), user = {}) {
  const versions = kyc?.registrationDocumentVersions || {};
  const current = (document, version) => Boolean(document && (!version || document.reviewVersion === version)
    && (!document.expiresAt || new Date(document.expiresAt) > now));
  const idCurrent = current(identity, versions.id) && (!kyc?.idDocumentHash || identity.fileHash === kyc.idDocumentHash);
  const supportingCurrent = !versions.supporting || current(supporting, versions.supporting);
  const approved = document => document?.status === "verified" && document.detailsMatched === true && !document.suspectedTampering;
  const legacyIdentity = Boolean(kyc?.legacyIdentityApprovedAt && !versions.id);
  const identityApproved = legacyIdentity || (idCurrent && approved(identity));
  const supportingApproved = !versions.supporting || (supportingCurrent && approved(supporting));
  const setupReady = !kyc?.identityUploadAttemptId || Boolean(kyc.idRegisteredAt);
  const selfieVerified = setupReady && (legacyIdentity || Boolean(idCurrent && kyc?.challengePassedAt));
  const rejected = Boolean((idCurrent && ["rejected", "reupload_required"].includes(identity.status))
    || (versions.supporting && supportingCurrent && ["rejected", "reupload_required"].includes(supporting.status)));
  const requiredBindings = (!user.registrationDraftId || Boolean(versions.id && (user.role !== "owner" || versions.supporting)))
    && (!user.ownerDocumentVerificationRequired || Boolean(versions.supporting && (versions.id || kyc?.legacyIdentityApprovedAt)))
    && (!kyc?.identityUploadAttemptId || Boolean(versions.id && kyc.idRegisteredAt));
  return { identityApproved, supportingApproved, selfieVerified, rejected, requiredBindings,
    complete: Boolean(requiredBindings && identityApproved && supportingApproved && selfieVerified) };
}
