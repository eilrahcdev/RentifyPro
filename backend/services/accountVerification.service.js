import User from "../models/User.js";
import KycVerification from "../models/KycVerification.js";
import PreKycDocument from "../models/PreKycDocument.js";
import { evaluateDocumentApprovals } from "../utils/accountVerification.js";
import { isIdentityReadyForSelfie } from "../utils/preKycDocs.js";

export async function currentAccountDocuments(userId, kyc) {
  const identitySession = kyc?.registrationIdentitySessionId || kyc?.registrationSessionId || `user:${userId}`;
  const supportingSession = kyc?.registrationSupportingSessionId || kyc?.registrationSessionId || `user:${userId}`;
  const identity = await PreKycDocument.findOne({ docType: "id", sessionId: identitySession,
    ...(kyc?.registrationSessionId && !identitySession.startsWith("user:") ? { registeredUser: userId } : {}) });
  const supporting = kyc?.registrationDocumentVersions?.supporting ? await PreKycDocument.findOne({
    docType: "supporting", sessionId: supportingSession, registeredUser: userId,
  }) : null;
  return { identity, supporting };
}

export async function getAccountVerification(user, knownCase) {
  const kyc = knownCase === undefined ? await KycVerification.findOne({ user: user._id }) : knownCase;
  const versions = kyc?.registrationDocumentVersions || {};
  const tracked = Boolean(user.registrationDraftId || user.ownerDocumentVerificationRequired || versions.id || versions.supporting || kyc?.identityUploadAttemptId);
  const { identity, supporting } = tracked ? await currentAccountDocuments(user._id, kyc) : {};
  const state = tracked ? evaluateDocumentApprovals(kyc, identity, supporting, undefined, user) : null;
  const active = !user.isDisabled && !user.isArchived;
  const emailVerified = user.isVerified === true;
  const approved = user.kycStatus === "approved" && (!kyc || kyc.status === "approved") && (!tracked || state.complete);
  const eligible = active && emailVerified && approved;
  const publicDocument = (docType, document, version) => ({ docType, required: true,
    reference: document ? String(document._id) : "", documentRevision: document?.reviewVersion || "",
    selectedDocCategory: document?.selectedDocCategory || "", status: !document ? "not_submitted"
      : version && document.reviewVersion !== version ? "reupload_required" : document.status,
    reason: document?.reason || "", canReplace: true,
    faceSetupRequired: docType === "id" && Boolean(document && kyc?.identityUploadAttemptId && !kyc.idRegisteredAt),
    identityReadyForSelfie: docType === "id" && Boolean(document && isIdentityReadyForSelfie(document) && (!kyc?.identityUploadAttemptId || kyc.idRegisteredAt)) });
  const historicalIdentity = { docType: "id", required: true, reference: "", documentRevision: "", status: "legacy_approved",
    selectedDocCategory: "", reason: "Your existing identity approval is retained. Replacing the ID requires a new review and selfie check.", identityReadyForSelfie: false };
  return { accountStatus: user.isArchived ? "archived" : user.isDisabled ? "suspended" : "active", emailVerified,
    bookingEligible: eligible, listingEligible: user.role === "owner" && eligible, ownerAccount: user.role === "owner", documentApprovalComplete: approved,
    selfieVerified: tracked ? state.selfieVerified : approved,
    legacyApproval: !tracked && approved,
    documents: tracked ? [...(kyc?.legacyIdentityApprovedAt && !versions.id ? [historicalIdentity]
      : versions.id || user.registrationDraftId || user.ownerDocumentVerificationRequired ? [publicDocument("id", identity, versions.id)] : []),
      ...(versions.supporting || ((user.registrationDraftId || user.ownerDocumentVerificationRequired) && user.role === "owner") ? [publicDocument("supporting", supporting, versions.supporting)] : [])]
      : approved ? [historicalIdentity] : [] };
}

export async function assertAccountEligibility(userId, action = "booking", { exposeDetails = true } = {}) {
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error("This account is unavailable."), { status: 403, code: "ACCOUNT_UNAVAILABLE" });
  if (user.role === "admin" && user.isVerified === true && !user.isDisabled && !user.isArchived) return { accountStatus: "active", emailVerified: true, bookingEligible: true, listingEligible: true };
  const verification = await getAccountVerification(user);
  if (!(action === "listing" ? verification.listingEligible : verification.bookingEligible)) {
    const message = exposeDetails ? "Email, ID, selfie, and applicable business document approvals are required before this action."
      : action === "listing" ? "The vehicle owner must complete verification before this vehicle can be booked."
        : "The renter must complete verification before this booking can be confirmed.";
    throw Object.assign(new Error(message), { status: 403,
      code: exposeDetails ? "IDENTITY_VERIFICATION_REQUIRED" : action === "listing" ? "OWNER_VERIFICATION_REQUIRED" : "RENTER_VERIFICATION_REQUIRED",
      ...(exposeDetails ? { verification } : {}) });
  }
  return verification;
}
