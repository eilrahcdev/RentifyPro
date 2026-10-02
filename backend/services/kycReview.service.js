import mongoose from "mongoose";
import PreKycDocument from "../models/PreKycDocument.js";
import KycVerification from "../models/KycVerification.js";
import User from "../models/User.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";

export const REVIEWABLE_DOCUMENT_STATUSES = ["pending_review"];
const fail = (status, message) => Object.assign(new Error(message), { status });

// Re-running this after an interrupted decision repairs the user summary from
// the durable case. Pre-registration documents never change an existing user.
export async function reconcileUserKyc(userId) {
  const current = await KycVerification.findOne({ user: userId });
  if (!current) return null;
  const document = await PreKycDocument.findOne({ sessionId: `user:${userId}`, docType: "id" });
  const sameDocument = document && (!current.idDocumentHash || current.idDocumentHash === document.fileHash);
  if (document && !sameDocument) return current;
  let status = current.status;
  let remarks = current.remarks;
  if (sameDocument && document.status === "rejected" && current.status !== "approved") {
    status = "rejected";
    remarks = `${document.reason} Upload a corrected ID and complete verification again.`;
  } else if (
    sameDocument
    && document.status === "verified"
    && document.detailsMatched === true
    && current.challengePassedAt
    && current.status === "challenge_passed"
  ) {
    status = "approved";
    remarks = "Your ID and selfie are approved. You can now continue to booking.";
  }

  const changed = status !== current.status || remarks !== current.remarks;
  if (!changed && !current.summarySyncPending) return current;
  const updated = !changed ? current : await KycVerification.findOneAndUpdate(
    { _id: current._id, updatedAt: current.updatedAt, status: current.status },
    { $set: { status, remarks, summarySyncPending: true, ...(status === "approved" ? { verifiedAt: current.verifiedAt || new Date() } : {}) } },
    { new: true },
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

  const updated = current.status === status ? null : await PreKycDocument.findOneAndUpdate(
    { _id: id, status: { $in: REVIEWABLE_DOCUMENT_STATUSES }, ...(reviewVersion ? { [current.reviewVersion ? "reviewVersion" : "fileHash"]: reviewVersion } : {}) },
    { $set: {
      status, reason: reason || "Approved by a RentifyPro administrator.",
      decisionSource: "admin_review",
      reviewedAt: now, reviewedBy: reviewerId, verifiedAt: action === "approve" ? now : null,
      processingLockedAt: null, nextAttemptAt: null,
    } },
    { new: true },
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
  if (sessionId.startsWith("user:") && mongoose.Types.ObjectId.isValid(sessionId.slice(5))) {
    await reconcileUserKyc(sessionId.slice(5));
  }
  return document;
}
