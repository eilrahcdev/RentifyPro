import crypto from "node:crypto";
import PreKycDocument from "../models/PreKycDocument.js";
import RegistrationDraft from "../models/RegistrationDraft.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const scope = req => ({ email: req.preKyc.email, sessionId: req.preKyc.sessionId, role: req.preKyc.role,
  docType: req.params.docType, registeredUser: null });

function checkType(req) {
  if (!req.registrationDraft || !["id", "supporting"].includes(req.params.docType)
    || (req.params.docType === "supporting" && req.preKyc.role !== "owner")) {
    throw fail("This document is not part of your registration.", 403);
  }
}
function sendError(res, error) {
  if (!error.status) auditLog.error("KYC", "Document upload control failed", { errorType: error.name });
  return res.status(error.status || 503).json({ success: false,
    message: error.status ? error.message : "We couldn't confirm this document request. Please retry." });
}

export async function prepareRegistrationDocument(req, res) {
  try {
    checkType(req);
    if (new Date(req.registrationDraft.evidenceUntil || 0) > new Date()) {
      return res.status(409).json({ success: false, code: "REGISTRATION_BUSY",
        message: "Another verification is still running. Wait for it to finish or cancel its document check." });
    }
    const existing = await PreKycDocument.findOne({ email: req.preKyc.email, docType: req.params.docType });
    if (existing?.registeredUser || /^(user:|reverify:)/.test(existing?.sessionId || "")
      || (existing?.expiresAt && new Date(existing.expiresAt) > new Date()
        && (existing.sessionId !== req.preKyc.sessionId || existing.role !== req.preKyc.role))) {
      throw fail("Another registration or account owns this document.");
    }
    const attemptId = crypto.randomUUID();
    const expired = existing && (!existing.expiresAt || new Date(existing.expiresAt) <= new Date());
    const document = await PreKycDocument.findOneAndUpdate({ email: req.preKyc.email, docType: req.params.docType,
      registeredUser: null, ...(existing ? { _id: existing._id, reviewVersion: existing.reviewVersion ?? null,
        uploadAttemptId: existing.uploadAttemptId ?? null } : { sessionId: { $exists: false } }) },
    { $set: { uploadAttemptId: attemptId, uploadCancelledAt: null,
        ...(expired ? { ...scope(req), registrationDraftId: req.registrationDraft._id,
          registrationExpiresAt: req.registrationDraft.expiresAt, expiresAt: req.registrationDraft.expiresAt,
          status: "reupload_required", detailsMatched: false, selfieVerification: null,
          privateScreening: null, manualComparison: null, validationChecks: {}, verifiedAt: null, reviewedAt: null,
          reviewVersion: attemptId, fileKey: "", fileHash: "", fileName: "", filePath: "", fileSize: 0, mimeType: "",
          profileSnapshot: {}, selectedDocCategory: "", manualReviewRequestedAt: null,
          reasonCode: "DOCUMENT_UPLOAD_REQUIRED", reason: "Upload this document to start a new check." } : {}) },
      $setOnInsert: existing ? {} : { ...scope(req), registrationDraftId: req.registrationDraft._id,
        registrationExpiresAt: req.registrationDraft.expiresAt, expiresAt: req.registrationDraft.expiresAt,
        status: "reupload_required", reviewVersion: attemptId, reason: "Choose a document and upload it to start checking." } },
    { upsert: !existing, returnDocument: "after" });
    if (!document) throw fail("Your document changed. Recover its latest saved state before retrying.");
    return res.json({ success: true, uploadAttemptId: attemptId });
  } catch (error) { return sendError(res, error); }
}

export async function cancelRegistrationDocument(req, res) {
  try {
    checkType(req);
    const attemptId = req.body?.uploadAttemptId;
    if (typeof attemptId !== "string" || !uuid.test(attemptId)) throw fail("Refresh this document before cancelling its check.", 400);
    const now = new Date();
    const leaseToken = crypto.randomUUID();
    const previousLease = await RegistrationDraft.findOneAndUpdate({ _id: req.registrationDraft._id,
      role: req.preKyc.role, sessionId: req.preKyc.sessionId, revision: req.registrationDraft.revision,
      cancelledAt: null, registeredUser: null, submissionDocuments: null,
      expiresAt: { $gt: now }, absoluteExpiresAt: { $gt: now },
      $and: [{ $or: [{ submissionUntil: null }, { submissionUntil: { $lte: now } }] }],
      $or: [{ evidenceUntil: null }, { evidenceUntil: { $lte: now } }, { evidenceAttemptId: attemptId }] },
    { $set: { evidenceToken: leaseToken, evidenceAttemptId: attemptId, evidenceUntil: new Date(now.getTime() + 5 * 60000) } },
    { returnDocument: "before" }).select("+evidenceToken +evidenceAttemptId");
    if (!previousLease) throw fail("Your registration changed or another verification is running. Recover its latest status before cancelling.");
    const release = restore => RegistrationDraft.updateOne({ _id: req.registrationDraft._id, role: req.preKyc.role,
      sessionId: req.preKyc.sessionId, evidenceAttemptId: attemptId, evidenceToken: leaseToken },
    restore && previousLease.evidenceToken && new Date(previousLease.evidenceUntil || 0) > new Date()
      ? { $set: { evidenceToken: previousLease.evidenceToken, evidenceAttemptId: previousLease.evidenceAttemptId || "",
        evidenceUntil: previousLease.evidenceUntil } }
      : { $unset: { evidenceToken: "", evidenceUntil: "", evidenceAttemptId: "" } });
    const sameRevision = { $eq: ["$reviewVersion", attemptId] };
    // The reservation and its cancellation live on the document itself. An upload
    // arriving after this update cannot commit, even if it was still sending bytes.
    const changes = { uploadCancelledAt: new Date() };
    changes.reviewVersion = { $cond: [sameRevision, { $literal: crypto.randomUUID() }, "$reviewVersion"] };
    for (const [key, value] of Object.entries({ status: "reupload_required", detailsMatched: false,
      selfieVerification: null, privateScreening: null, manualComparison: null, manualReviewRequestedAt: null,
      processingLockedAt: null, nextAttemptAt: null, verifiedAt: null, validationChecks: {},
      reasonCode: "DOCUMENT_CHECK_CANCELLED", reason: "Document check cancelled. You can upload this document again." })) {
      changes[key] = { $cond: [sameRevision, { $literal: value }, `$${key}`] };
    }
    let document;
    try {
      document = await PreKycDocument.findOneAndUpdate({ ...scope(req),
        $and: [{ $or: [{ reviewVersion: { $ne: attemptId } }, { reviewedAt: null }] }],
        expiresAt: { $gt: new Date() },
        $or: [{ uploadAttemptId: attemptId }, { reviewVersion: attemptId, uploadAttemptId: null }] },
      [{ $set: changes }], { returnDocument: "after", updatePipeline: true });
      if (!document) throw fail("This document changed or its review is complete. Recover its latest status.");
    } catch (error) {
      await release(true);
      throw error;
    }
    await release(false);
    return res.json({ success: true, cancelled: true, uploadAttemptId: attemptId, documentRevision: document.reviewVersion || "" });
  } catch (error) { return sendError(res, error); }
}

export async function assertRegistrationUpload(req, docType) {
  const attemptId = req.body?.upload_attempt_id;
  if (!attemptId) return ""; // Existing signed-in and legacy clients keep their upload contract.
  if (!req.registrationDraft || typeof attemptId !== "string" || !uuid.test(attemptId)) {
    throw fail("Start this upload again from your registration.", 400);
  }
  const document = await PreKycDocument.exists({ email: req.preKyc.email, sessionId: req.preKyc.sessionId,
    role: req.preKyc.role, docType, registeredUser: null, uploadAttemptId: attemptId, uploadCancelledAt: null });
  if (!document) throw fail("This upload was cancelled or replaced. Start a new upload to retry.");
  return attemptId;
}
