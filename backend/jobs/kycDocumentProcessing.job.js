import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import PreKycDocument from "../models/PreKycDocument.js";
import { verifyPhilippinesDocument } from "../services/geminiDocument.service.js";
import { DOCUMENT_REASON_CODES, evaluateDocumentExtraction } from "../services/documentValidation.service.js";
import { reconcileUserKyc } from "../services/kycReview.service.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import { getKycUploadDir } from "../utils/storagePaths.js";
import { GEMINI_MANUAL_REVIEW_REASON } from "../utils/geminiDataPolicy.js";
import { getKycScreeningProvider, assertKycScreeningAvailable } from "../utils/kycScreeningProvider.js";
import { inspectPrivateKycDocument } from "../services/privateKycOcr.service.js";
import { evaluatePrivateDocumentInspection } from "../services/privateDocumentExtraction.service.js";

const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const workerEnabled = () => String(process.env.KYC_DOCUMENT_QUEUE_ENABLED || "true").toLowerCase() !== "false";
const automaticVerificationEnabled = () => {
  const configured = String(process.env.KYC_ALLOW_RULE_BASED_AUTO_VERIFY || "").trim();
  if (configured) return configured.toLowerCase() === "true";
  const legacy = String(process.env.KYC_ALLOW_GEMINI_AUTO_APPROVE || "").trim();
  if (legacy) return legacy.toLowerCase() === "true";
  return false;
};
const automaticVerificationMinimum = () => positiveNumber(
  process.env.KYC_DOCUMENT_AUTO_VERIFY_MIN_CONFIDENCE
    || process.env.KYC_DOCUMENT_AUTO_APPROVE_MIN_CONFIDENCE,
  85,
);
const classificationMinimum = () => positiveNumber(
  process.env.KYC_DOCUMENT_CLASSIFICATION_MIN_CONFIDENCE,
  90,
);
const uploadRoot = getKycUploadDir;
const maxAttempts = () => getKycScreeningProvider() === "private_ocr" ? 2
  : Math.max(1, Math.floor(positiveNumber(process.env.KYC_GEMINI_MAX_ATTEMPTS, 3)));
const requestsPerMinute = () => Math.max(1, Math.floor(positiveNumber(process.env.KYC_GEMINI_REQUESTS_PER_MINUTE, 4)));
const retryDelayMs = (attempt) => getKycScreeningProvider() === "private_ocr" ? 3_000
  : Math.min(30_000 * (2 ** Math.max(attempt - 1, 0)), 5 * 60_000);

let timer = null;
let running = false;
let lastGeminiRequestAt = 0;
let draining = false;

const safeFilePath = (fileKey) => {
  const root = uploadRoot();
  const key = String(fileKey || "").trim();
  if (!key || key !== path.basename(key) || /[\\/]/.test(key)) return "";
  const target = path.resolve(root, key);
  return path.dirname(target) === root ? target : "";
};

const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

const throttleGemini = async () => {
  const minimumGap = Math.ceil(60_000 / requestsPerMinute());
  const remaining = minimumGap - (Date.now() - lastGeminiRequestAt);
  if (remaining > 0) await wait(remaining);
  lastGeminiRequestAt = Date.now();
};

const claimNextDocument = async () => {
  const now = new Date();
  const staleLock = new Date(Date.now() - positiveNumber(process.env.KYC_PROCESSING_LOCK_TIMEOUT_MS, 10 * 60_000));
  return PreKycDocument.findOneAndUpdate(
    {
      $or: [
        { status: "queued" },
        { status: "retry_wait", nextAttemptAt: { $lte: now } },
        { status: "processing", processingLockedAt: { $lte: staleLock } },
      ],
    },
    {
      $set: { status: "processing", processingLockedAt: now, processingError: "" },
      $inc: { processingAttempts: 1 },
    },
    { sort: { createdAt: 1 }, new: true },
  ).select("+profileSnapshot");
};

const processClaimedDocument = async (document) => {
  const provider = getKycScreeningProvider();
  assertKycScreeningAvailable(provider);
  const filePath = safeFilePath(document.fileKey);
  if (!filePath) throw Object.assign(new Error("Private document file is unavailable."), { permanent: true });
  const buffer = await fs.readFile(filePath);
  const actualHash = crypto.createHash("sha256").update(buffer).digest("hex");
  if (document.fileHash && actualHash !== document.fileHash) {
    throw Object.assign(new Error("Private document integrity check failed."), { permanent: true });
  }

  const throttleStartedAt = Date.now();
  if (provider === "gemini") await throttleGemini();
  const providerStartedAt = Date.now();
  let result;
  try {
    result = await (provider === "private_ocr" ? inspectPrivateKycDocument : verifyPhilippinesDocument)({
      base64: buffer.toString("base64"),
      mimeType: document.mimeType || "image/jpeg",
      docType: document.docType,
      selectedDocType: document.selectedDocCategory,
    });
  } catch (error) {
    error.screeningTiming = {
      throttleWaitMs: providerStartedAt - throttleStartedAt,
      providerMs: Date.now() - providerStartedAt,
    };
    throw error;
  }
  const providerFinishedAt = Date.now();

  const preliminary = provider === "private_ocr" ? evaluatePrivateDocumentInspection({
    inspection: result, docType: document.docType, selectedDocType: document.selectedDocCategory,
    profile: document.profileSnapshot || {},
    minimumClassificationConfidence: classificationMinimum(), fileHash: document.fileHash,
    sessionId: document.sessionId, role: document.role,
    requireBirthDate: document.docType === "id" && document.role === "user",
    reviewVersion: document.reviewVersion || document.fileHash,
  }) : evaluateDocumentExtraction({
    extraction: result,
    docType: document.docType,
    selectedDocType: document.selectedDocCategory,
    profile: document.profileSnapshot || {},
    allowAutomaticVerification: automaticVerificationEnabled(),
    minimumConfidence: automaticVerificationMinimum(),
    minimumClassificationConfidence: classificationMinimum(),
    requireBirthDate: document.docType === "id" && document.role === "user",
  });
  const duplicate = preliminary.documentNumberFingerprint
    ? await PreKycDocument.exists({
        _id: { $ne: document._id },
        email: { $ne: document.email },
        documentNumberFingerprint: preliminary.documentNumberFingerprint,
        status: { $in: ["verified", "pending_review", "rejected"] },
      })
    : null;
  const decision = duplicate && provider === "private_ocr"
    ? { ...preliminary, status: "pending_review", reasonCode: DOCUMENT_REASON_CODES.DUPLICATE_DOCUMENT,
      reviewReason: "This document may already be linked to another registration. An administrator must review it.",
      privateScreening: { ...preliminary.privateScreening,
        automatedCheck: { ...preliminary.privateScreening.automatedCheck, outcome: "review_needed" } } }
    : duplicate
    ? evaluateDocumentExtraction({
        extraction: result,
        docType: document.docType,
        selectedDocType: document.selectedDocCategory,
        profile: document.profileSnapshot || {},
        duplicateDetected: true,
        allowAutomaticVerification: automaticVerificationEnabled(),
        minimumConfidence: automaticVerificationMinimum(),
        minimumClassificationConfidence: classificationMinimum(),
        requireBirthDate: document.docType === "id" && document.role === "user",
      })
    : preliminary;
  const uncertainIdentity = document.docType === "id"
    && decision.reasonCode === DOCUMENT_REASON_CODES.EXTRACTION_UNCERTAIN
    && decision.mismatchFields.length > 0;
  const retryUncertainIdentity = uncertainIdentity
    && Number(document.processingAttempts || 1) < maxAttempts();
  const status = retryUncertainIdentity
    ? "retry_wait"
    : uncertainIdentity ? "reupload_required" : decision.status;
  const reason = retryUncertainIdentity
    ? "Some ID details could not be read confidently. We will check the image again automatically."
    : uncertainIdentity
      ? "We could not read your ID details confidently after retrying. Upload a sharper image of the complete ID."
      : decision.reviewReason;
  const now = new Date();
  const updateResult = await PreKycDocument.updateOne(
    { _id: document._id, status: "processing", fileHash: document.fileHash, ...(document.reviewVersion ? { reviewVersion: document.reviewVersion } : {}), processingLockedAt: document.processingLockedAt },
    {
      $set: {
        status,
        country: String(result.issuing_country || result.country || "").trim(),
        docCategory: decision.extractedData.documentType,
        detailsMatched: decision.checks.registrationDataCompared === true
          && decision.mismatchFields.length === 0,
        mismatchFields: decision.mismatchFields,
        suspectedTampering: Boolean(result.suspected_tampering),
        confidence: decision.confidence,
        classificationConfidence: decision.classificationConfidence,
        documentSurface: decision.documentSurface,
        reason,
        reasonCode: decision.reasonCode,
        decisionSource: "backend_rules",
        validationChecks: decision.checks,
        extractedData: decision.extractedData,
        qualityIssues: result.warnings || result.quality_issues || [],
        documentNumberFingerprint: decision.documentNumberFingerprint,
        verifiedAt: status === "verified" ? now : null,
        ...(provider === "private_ocr" ? { provider: "private-ocr", privateScreening: decision.privateScreening } : {}),
        lastProcessedAt: now,
        processingLockedAt: null,
        nextAttemptAt: retryUncertainIdentity ? new Date(Date.now() + retryDelayMs(document.processingAttempts)) : null,
        processingError: "",
      },
    },
  );
  if (updateResult.modifiedCount === 1) auditLog.info("KYC", "Queued document screening completed", {
    reviewId: document._id.toString(),
    docType: document.docType,
    status,
    attempt: document.processingAttempts,
    queueWaitMs: document.queuedAt ? Math.max(0, new Date(document.processingLockedAt) - new Date(document.queuedAt)) : null,
    throttleWaitMs: providerStartedAt - throttleStartedAt,
    providerMs: providerFinishedAt - providerStartedAt,
    totalMs: document.queuedAt ? Math.max(0, Date.now() - new Date(document.queuedAt)) : null,
  });
  const sessionId = String(document.sessionId || "");
  if (updateResult.modifiedCount === 1 && status === "verified" && sessionId.startsWith("user:")) {
    await reconcileUserKyc(sessionId.slice(5));
  }
};

const handleProcessingFailure = async (document, error) => {
  const screeningDisabled = ["GEMINI_DATA_POLICY_UNCONFIRMED", "KYC_SCREENING_DISABLED"].includes(error?.code);
  const privateServiceIncompatible = error?.code === "PRIVATE_KYC_SERVICE_INCOMPATIBLE";
  const attempt = Number(document.processingAttempts || 1);
  const retryable = !error?.permanent && error?.retryable !== false
    && [408, 429, 500, 502, 503, 504].includes(Number(error?.status || 503));
  const privateTimeout = getKycScreeningProvider() === "private_ocr" && Number(error?.status) === 504;
  const shouldRetry = retryable && !privateTimeout && attempt < maxAttempts();
  const status = shouldRetry ? "retry_wait" : error?.permanent ? "reupload_required" : "pending_review";
  const safeMessage = screeningDisabled
    ? GEMINI_MANUAL_REVIEW_REASON
    : privateServiceIncompatible
      ? "Document verification is temporarily unavailable. An administrator can review your uploaded document."
      : shouldRetry
        ? "Automated screening is temporarily unavailable. The request will retry automatically."
        : error?.permanent
          ? "We could not securely read the uploaded file. Please upload the document again."
          : "Automated screening was unavailable. A reviewer will check this document manually.";
  const updateResult = await PreKycDocument.updateOne(
    { _id: document._id, status: "processing", fileHash: document.fileHash, ...(document.reviewVersion ? { reviewVersion: document.reviewVersion } : {}), processingLockedAt: document.processingLockedAt },
    {
      $set: {
        status,
        reason: safeMessage,
        reasonCode: screeningDisabled || privateServiceIncompatible
          ? error.code
          : shouldRetry
            ? "SCREENING_RETRY_PENDING"
            : error?.permanent
              ? "IMAGE_UNREADABLE"
              : "AUTOMATED_SCREENING_UNAVAILABLE",
        processingError: String(error?.message || "Processing failed").slice(0, 240),
        processingLockedAt: null,
        lastProcessedAt: new Date(),
        nextAttemptAt: shouldRetry ? new Date(Date.now() + retryDelayMs(attempt)) : null,
        ...(screeningDisabled ? { provider: "manual", verifiedAt: null }
          : getKycScreeningProvider() === "private_ocr" ? { provider: "private-ocr", verifiedAt: null } : {}),
      },
    },
  );
  if (updateResult.modifiedCount === 1) auditLog.warn("KYC", "Queued document screening deferred", {
    reviewId: document._id.toString(),
    docType: document.docType,
    status,
    attempt,
    httpStatus: Number(error?.status || 0),
    queueWaitMs: document.queuedAt ? Math.max(0, new Date(document.processingLockedAt) - new Date(document.queuedAt)) : null,
    throttleWaitMs: error?.screeningTiming?.throttleWaitMs ?? null,
    providerMs: error?.screeningTiming?.providerMs ?? null,
    totalMs: document.queuedAt ? Math.max(0, Date.now() - new Date(document.queuedAt)) : null,
  });
};

export const processNextKycDocument = async () => {
  if (!workerEnabled() || running) return false;
  running = true;
  try {
    const document = await claimNextDocument();
    if (!document) return false;
    try {
      await processClaimedDocument(document);
    } catch (error) {
      await handleProcessingFailure(document, error);
    }
    return true;
  } finally {
    running = false;
  }
};

export const triggerKycDocumentProcessing = () => {
  if (!workerEnabled() || draining) return;
  draining = true;
  void (async () => {
    try {
      do {
        if (!await processNextKycDocument()) break;
        if (getKycScreeningProvider() !== "private_ocr") break;
      } while (workerEnabled());
    } finally { draining = false; }
  })().catch((error) => {
    auditLog.error("KYC", "Document screening worker could not start", {
      detail: String(error?.message || error || "Unknown worker error"),
    });
  });
};

export const startKycDocumentProcessingJob = () => {
  if (timer || !workerEnabled()) return;
  const intervalMs = positiveNumber(process.env.KYC_DOCUMENT_QUEUE_POLL_MS, 5_000);
  triggerKycDocumentProcessing();
  timer = setInterval(triggerKycDocumentProcessing, intervalMs);
  timer.unref?.();
};

export const stopKycDocumentProcessingJob = () => {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
};
