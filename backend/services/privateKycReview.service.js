import { prepareManualDocumentComparison, hasCurrentManualDocumentComparison } from "../data/private-kyc/services/manualDocumentComparison.js";
import { readPrivateKycEvidence, refreshPrivateDocumentTypeEvidence } from "../data/private-kyc/services/privateKycReviewContext.js";
import { evaluateDocumentApprovals } from "../data/private-kyc/utils/accountVerification.js";
import mongoose from "mongoose";
import { isSubmittedDocument, canInspectRegistrationDocument, registrationReviewFilter } from "../data/private-kyc/utils/registrationReview.js";
import { documentOwner } from "./adminDomain.service.js";
import { recordAdminAudit } from "./adminAudit.service.js";
import { prepareAdminVisualReview } from "./adminVisualReview.service.js";
import { assertIdentifierScreeningSettled, identifierDuplicateFilter, identifierRevisionFilter,
  withCachedIdentifierTypeEvidence } from "./adminIdentifierScreening.service.js";

const fail = (message, status = 409) => Object.assign(new Error(message), { status });

export async function compareAdminKycDocument({ collection, document, input, reviewerId, directory, auditRecord }) {
  assertCurrentDocument(document);
  assertIdentifierScreeningSettled(document);
  const bytes = await readPrivateKycEvidence(document, directory);
  const checked = await refreshPrivateDocumentTypeEvidence(withCachedIdentifierTypeEvidence(document), bytes);
  const fields = input?.reviewMode === "visual" ? prepareAdminVisualReview(checked, input, reviewerId)
    : prepareManualDocumentComparison(checked, input, reviewerId);
  if (auditRecord) auditRecord.metadata.fieldsCompared = fields.manualComparison.fieldsCompared;
  if (checked !== document) fields.privateScreening = checked.privateScreening;
  if (fields.documentNumberFingerprint && await collection.findOne(identifierDuplicateFilter(document, fields.documentNumberFingerprint),
    { projection: { _id: 1 } })) throw fail("This document identifier is linked to another registration. Investigate before approving.");
  if (input?.reviewMode === "visual" && await collection.findOne({
    _id: { $ne: document._id }, email: { $ne: document.email }, fileHash: document.fileHash,
    status: { $in: ["pending_review", "verified", "rejected"] },
  }, { projection: { _id: 1 } })) throw fail("This original file is linked to another registration. Investigate before approving.");
  const result = await collection.findOneAndUpdate({
    ...registrationReviewFilter(), _id: document._id, status: "pending_review", fileHash: document.fileHash,
    ...identifierRevisionFilter(document),
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    ...(document.reviewVersion ? { reviewVersion: document.reviewVersion } : {}),
  }, { $set: fields, ...(auditRecord ? { $push: { adminAuditOutbox: auditRecord } } : {}) }, { returnDocument: "after" });
  const updated = result?.value ?? result;
  if (!updated) throw fail("The document changed. Refresh and inspect the current file.");
  return updated;
}

export function validateAdminKycDecision(document, approval, reviewVersion) {
  if (!document) throw fail("This document is no longer available.");
  assertCurrentDocument(document);
  if (!isSubmittedDocument(document)) throw fail("Final approval requires a submitted registration. Save a manual comparison to help this applicant continue.");
  if (document.status !== "pending_review") throw fail("Wait for screening to finish and refresh before deciding.");
  if (!reviewVersion || reviewVersion !== (document.reviewVersion || document.fileHash)) {
    throw fail("The document changed. Refresh and inspect the current file.");
  }
  if (approval === "Approved") {
    assertIdentifierScreeningSettled(document);
    if (document.docType === "id" && document.detailsMatched !== true) throw fail("Identity details have not passed comparison.");
    if (["private-ocr", "manual"].includes(document.provider) && !hasCurrentManualDocumentComparison(document)) {
      throw fail("Inspect and save the manual comparison, including its document type, before approving this document.");
    }
  }
}

export function assertCurrentDocument(document) {
  if (!document || (document.expiresAt && !(new Date(document.expiresAt) > new Date()))) {
    throw fail("This document expired. Ask for a replacement upload.");
  }
  if (!canInspectRegistrationDocument(document)) throw fail("This registration has not requested manual verification or submitted an account.");
  if (documentOwner(document).conflict) throw fail("Document ownership is inconsistent. Investigate before reviewing.");
}

export function isRepeatedAdminDecision(document, approval, version) {
  const action = approval === "Approved" ? "approve" : "reject";
  const status = approval === "Approved" ? "verified" : "rejected";
  return Boolean(document && version && version === (document.reviewVersion || document.fileHash) && document.status === status
    && document.reviewHistory?.some(entry => entry.action === action && entry.reviewVersion === version
      && entry.fileHash === document.fileHash && entry.sessionId === document.sessionId));
}

export async function finishAdminKycDecision(database, document) {
  const pending = document.adminDecisionPending;
  if (!pending) return;
  if (pending.fileHash === document.fileHash && pending.reviewVersion === (document.reviewVersion || document.fileHash)) {
    await reconcileAdminAccountDocuments(database, document);
  }
  await recordAdminAudit({ ...pending.audit, eventId: pending.auditId, required: true });
  await database.collection("prekycdocuments").updateOne({ _id: document._id, "adminDecisionPending.auditId": pending.auditId },
    { $unset: { adminDecisionPending: "" } });
}

export function canReconcileApprovedIdentity(document, kycCase) {
  return document.docType === "id" && document.detailsMatched === true && document.status === "verified"
    && kycCase?.status === "challenge_passed" && Boolean(kycCase.challengePassedAt)
    && (!kycCase.idDocumentHash || kycCase.idDocumentHash === document.fileHash);
}

export async function reconcileAdminAccountDocuments(database, document) {
  const session = String(document.sessionId || "");
  if (session.startsWith("reverify:")) return;
  const reference = documentOwner(document).userId;
  if (!reference || !mongoose.Types.ObjectId.isValid(reference)) return;
  const id = new mongoose.Types.ObjectId(reference);
  const users = database.collection("users"), cases = database.collection("kyc_cases"), documents = database.collection("prekycdocuments");
  const user = await users.findOne({ _id: id });
  if (!user) return;
  const kyc = await cases.findOne({ user: user._id });
  if (!kyc) return;
  const versions = kyc.registrationDocumentVersions || {};
  const tracked = Boolean(versions.id || versions.supporting || kyc.identityUploadAttemptId || user.registrationDraftId || user.ownerDocumentVerificationRequired);
  if (user.kycStatus === "not_started") return;
  let status = kyc.status;
  if (tracked) {
    const identitySession = kyc.registrationIdentitySessionId || kyc.registrationSessionId || `user:${user._id}`;
    const supportingSession = kyc.registrationSupportingSessionId || kyc.registrationSessionId || `user:${user._id}`;
    const identity = await documents.findOne({ sessionId: identitySession, docType: "id",
      ...(kyc.registrationSessionId && !identitySession.startsWith("user:") ? { registeredUser: user._id } : {}) });
    const supporting = versions.supporting ? await documents.findOne({ sessionId: supportingSession, registeredUser: user._id, docType: "supporting" }) : null;
    const state = evaluateDocumentApprovals(kyc, identity, supporting, undefined, user);
    status = state.rejected ? "rejected" : state.complete ? "approved" : state.selfieVerified ? "challenge_passed" : "id_uploaded";
  } else if (canReconcileApprovedIdentity(document, kyc)) status = "approved";
  else if (document.docType === "id" && document.status === "rejected" && kyc.status !== "approved") status = "rejected";
  const now = new Date();
  const changed = status !== kyc.status;
  if (changed) {
    const result = await cases.updateOne({ _id: kyc._id, status: kyc.status, updatedAt: kyc.updatedAt }, { $set: { status, summarySyncPending: true,
      remarks: status === "approved" ? "All required documents and selfie checks are approved." : document.reason || "Document approval is pending.",
      ...(status === "approved" ? { verifiedAt: now } : {}), updatedAt: now } });
    if (!result.modifiedCount) return;
  }
  const updatedAt = changed ? now : kyc.updatedAt;
  await users.updateOne({ _id: user._id, $or: [{ kycStatusUpdatedAt: { $exists: false } }, { kycStatusUpdatedAt: { $lte: updatedAt } }] },
    { $set: { kycStatus: status, kycStatusUpdatedAt: updatedAt } });
  await cases.updateOne({ _id: kyc._id, status, updatedAt }, { $set: { summarySyncPending: false } });
}
