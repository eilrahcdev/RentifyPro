import mongoose from "mongoose";
import PreKycDocument from "../models/PreKycDocument.js";
import KycVerification from "../models/KycVerification.js";
import User from "../models/User.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import { hasCurrentManualDocumentComparison } from "./manualDocumentComparison.js";
import { repairLegacyKycSummary } from "./kycSummary.service.js";
import { reconcileFaceReverification } from "./kycReverification.service.js";
import { currentAccountDocuments } from "./accountVerification.service.js";
import { evaluateDocumentApprovals } from "../utils/accountVerification.js";
import { isSubmittedDocument } from "../utils/registrationReview.js";

export const REVIEWABLE_DOCUMENT_STATUSES = ["pending_review"];
const fail = (status, message) => Object.assign(new Error(message), { status });

// Re-running this after an interrupted decision repairs the user summary from
// the durable case. Pre-registration documents never change an existing user.
export async function reconcileUserKyc(userId) {
  const current = await KycVerification.findOne({ user: userId });
  if (!current) return null;
  const { identity: document, supporting } = await currentAccountDocuments(userId, current);
  const versions = current.registrationDocumentVersions;
  const managed = Boolean(versions?.id || versions?.supporting || current.identityUploadAttemptId);
  const account = managed ? await User.findById(userId).select("kycStatus role registrationDraftId ownerDocumentVerificationRequired") : null;
  if (account?.kycStatus === "not_started") return current;
  const supportingApproved = !versions?.supporting || (supporting?.status === "verified" && supporting.reviewVersion === versions.supporting);
  const registrationVersionMatches = !versions?.id || document?.reviewVersion === versions.id;
  const sameDocument = document && (!current.idDocumentHash || current.idDocumentHash === document.fileHash);
  if (!managed && document && (!sameDocument || !registrationVersionMatches)) return current;
  let status = current.status;
  let remarks = current.remarks;
  if (managed) {
    const state = evaluateDocumentApprovals(current, document, supporting, undefined, account || {});
    status = state.rejected ? "rejected" : state.complete ? "approved" : state.selfieVerified ? "challenge_passed" : "id_uploaded";
    remarks = state.rejected ? String(supporting?.status === "rejected" ? supporting.reason : document?.reason || "Replace the document that needs correction.")
      : status === "approved" ? "All required documents and your selfie are approved. Restricted actions are available."
        : state.selfieVerified ? "Your selfie is verified. Required document approval is pending." : "Complete verification for the current ID document.";
  } else if (((sameDocument && document.status === "rejected") || supporting?.status === "rejected") && current.status !== "approved") {
    status = "rejected";
    remarks = `${supporting?.status === "rejected" ? supporting.reason : document.reason} Upload a corrected document and complete verification again.`;
  } else if (
    sameDocument
    && document.status === "verified"
    && document.detailsMatched === true
    && supportingApproved
    && current.challengePassedAt
    && current.status === "challenge_passed"
  ) {
    status = "approved";
    remarks = "Your ID and selfie are approved. You can now continue to booking.";
  }

  const changed = status !== current.status || remarks !== current.remarks;
  if (!changed && !current.summarySyncPending) {
    if (current.status === "approved") {
      const user = await User.findById(userId).select("role kycStatus kycStatusUpdatedAt");
      await repairLegacyKycSummary(user, current);
    }
    return current;
  }
  const updated = !changed ? current : await KycVerification.findOneAndUpdate(
    { _id: current._id, updatedAt: current.updatedAt, status: current.status },
    { $set: { status, remarks, summarySyncPending: true, ...(status === "approved" ? { verifiedAt: current.verifiedAt || new Date() } : {}) } },
    { returnDocument: "after" },
  );
  // A newer verification attempt won the race; it must not be overwritten.
  if (!updated) return KycVerification.findOne({ user: userId });
  await User.updateOne(
    { _id: userId, $or: [{ kycStatusUpdatedAt: { $exists: false } }, { kycStatusUpdatedAt: { $lte: updated.updatedAt } }] },
    { $set: { kycStatus: updated.status, kycStatusUpdatedAt: updated.updatedAt } },
  );
  await KycVerification.updateOne({ _id: updated._id, updatedAt: updated.updatedAt }, { $set: { summarySyncPending: false } }, { timestamps: false });
  return updated;
}

export async function reviewKycDocument({ id, action, remarks = "", reviewerId, reviewVersion }) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw fail(400, "Invalid document ID. Refresh the document list and try again.");
  if (!["approve", "reject"].includes(action)) throw fail(400, "Choose Approve or Reject for this document.");
  const reason = String(remarks || "").trim();
  if (reason.length > 500 || (action === "reject" && reason.length < 10)) {
    throw fail(400, "Explain why the document was rejected and what to correct, using 10 to 500 characters.");
  }
  const status = action === "approve" ? "verified" : "rejected";
  const now = new Date();
  const current = await PreKycDocument.findById(id);
  if (!current) throw fail(404, "This document is no longer available. Refresh the document list.");
  if (!isSubmittedDocument(current) || (current.expiresAt && new Date(current.expiresAt) <= new Date())) {
    throw fail(409, "Final approval requires a submitted registration. Use manual comparison to help an unfinished applicant.");
  }
  if ((current.reviewVersion || ["private-ocr", "manual"].includes(current.provider)) && !reviewVersion) {
    throw fail(409, "Refresh the document and include its current review version before deciding.");
  }
  if (reviewVersion && (current.reviewVersion || current.fileHash) !== reviewVersion) {
    throw fail(409, "The applicant uploaded a replacement document. Refresh and review the new file before deciding.");
  }
  if (current.status !== status && !REVIEWABLE_DOCUMENT_STATUSES.includes(current.status)) {
    const processing = ["queued", "processing", "retry_wait"].includes(current.status);
    throw fail(409, processing
      ? "Automated screening is not finished. Wait for the document to reach manual review before deciding."
      : "This document already has another decision. Refresh the document list before reviewing it.");
  }
  if (current.status !== status && action === "approve" && current.docType === "id" && current.detailsMatched !== true) {
    throw fail(409, "This ID cannot be approved because its identity details did not pass comparison. Ask the applicant to correct their registration details or upload the matching ID.");
  }
  if (current.status !== status && action === "approve" && ["private-ocr", "manual"].includes(current.provider)
    && !hasCurrentManualDocumentComparison(current)) {
    throw fail(409, "Inspect and save the manual document comparison, including its document type, before approving this document.");
  }

  const updated = current.status === status ? null : await PreKycDocument.findOneAndUpdate(
    { _id: id, status: { $in: REVIEWABLE_DOCUMENT_STATUSES },
      registrationCancelledAt: null, reviewVersion: current.reviewVersion ?? null,
      ...(current.registeredUser ? { registeredUser: current.registeredUser } : { sessionId: current.sessionId }),
      ...(current.fileHash ? { fileHash: current.fileHash } : {}) },
    { $set: {
      status, reason: reason || "Approved by a RentifyPro administrator.",
      decisionSource: "admin_review",
      reviewedAt: now, reviewedBy: reviewerId, verifiedAt: action === "approve" ? now : null,
      processingLockedAt: null, nextAttemptAt: null,
    }, $push: { reviewHistory: { reviewVersion: current.reviewVersion || current.fileHash,
      fileHash: current.fileHash, action, reason: reason || "Approved by a RentifyPro administrator.",
      reviewedAt: now, reviewedBy: String(reviewerId), sessionId: current.sessionId, notificationPending: true } } },
    { returnDocument: "after" },
  );
  const document = updated || await PreKycDocument.findById(id);
  if (!document) throw fail(404, "This document is no longer available. Refresh the document list.");
  if (reviewVersion && (document.reviewVersion || document.fileHash) !== reviewVersion) throw fail(409, "The applicant uploaded a replacement document. Refresh and review the new file before deciding.");
  if (document.status !== status) throw fail(409, "This document already has another decision. Refresh the document list before reviewing it.");

  if (updated) auditLog.info("KYC", "Manual document review completed", {
    reviewId: String(document._id), userId: String(reviewerId), action,
    reviewWaitMs: document.lastProcessedAt ? Math.max(0, now - new Date(document.lastProcessedAt)) : null,
    totalMs: document.queuedAt ? Math.max(0, now - new Date(document.queuedAt)) : null,
  });
  const sessionId = String(document.sessionId || "");
  if (document.registeredUser) {
    await reconcileUserKyc(document.registeredUser);
  } else if (sessionId.startsWith("user:") && mongoose.Types.ObjectId.isValid(sessionId.slice(5))) {
    await reconcileUserKyc(sessionId.slice(5));
  } else if (sessionId.startsWith("reverify:") && mongoose.Types.ObjectId.isValid(sessionId.split(":")[1])) {
    await reconcileFaceReverification(sessionId.split(":")[1]);
  }
  return document;
}
