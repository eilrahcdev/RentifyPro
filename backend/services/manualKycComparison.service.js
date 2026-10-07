import mongoose from "mongoose";
import PreKycDocument from "../models/PreKycDocument.js";
import { getKycUploadDir } from "../utils/storagePaths.js";
import { prepareManualDocumentComparison } from "./manualDocumentComparison.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import { readPrivateKycEvidence, refreshPrivateDocumentTypeEvidence } from "./privateKycReviewContext.js";

export async function compareManualKycDocument({ id, input, reviewerId }) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw Object.assign(new Error("Invalid document ID."), { status: 400 });
  const document = await PreKycDocument.findById(id).select("+profileSnapshot");
  if (!document) throw Object.assign(new Error("Document not found."), { status: 404 });
  const bytes = await readPrivateKycEvidence(document, getKycUploadDir());
  const checked = await refreshPrivateDocumentTypeEvidence(document, bytes);
  const fields = prepareManualDocumentComparison(checked, input, reviewerId);
  if (checked !== document) fields.privateScreening = checked.privateScreening;
  if (fields.documentNumberFingerprint && await PreKycDocument.exists({
    _id: { $ne: document._id }, email: { $ne: document.email },
    documentNumberFingerprint: fields.documentNumberFingerprint,
    status: { $in: ["pending_review", "verified", "rejected"] },
  })) throw Object.assign(new Error("This document identifier is already linked to another registration. Investigate before approving."), { status: 409 });
  const updated = await PreKycDocument.findOneAndUpdate({
    _id: id, status: "pending_review", fileHash: document.fileHash,
    ...(document.reviewVersion ? { reviewVersion: document.reviewVersion } : {}),
  }, { $set: fields }, { new: true });
  if (!updated) throw Object.assign(new Error("The document changed. Refresh before reviewing."), { status: 409 });
  auditLog.info("KYC", "Manual registration comparison completed", {
    reviewId: String(id), reviewerId: String(reviewerId), fileHash: document.fileHash,
    reviewVersion: input.reviewVersion, fieldsCompared: fields.manualComparison.fieldsCompared,
  });
  return updated;
}
