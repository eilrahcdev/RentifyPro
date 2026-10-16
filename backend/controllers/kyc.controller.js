// KYC controller
// Handles logged-in and pre-registration flows
import axios from "axios";
import crypto from "crypto";
import mongoose from "mongoose";
import fs from "fs/promises";
import path from "path";
import KycVerification from "../models/KycVerification.js";
import User from "../models/User.js";
import PreKycDocument from "../models/PreKycDocument.js";
import PreKycFace from "../models/PreKycFace.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import { ensureFaceServiceReady, isFaceServiceConnectionError } from "../utils/faceServiceManager.js";
import { issuePreKycSession, renewPreKycSession } from "../utils/preKycSession.js";
import { reconcileUserKyc, reviewKycDocument } from "../services/kycReview.service.js";
import { isBirSupportingDocumentType, resolveSupportedDocumentType } from "../services/documentValidation.service.js";
import { triggerKycDocumentProcessing } from "../jobs/kycDocumentProcessing.job.js";
import { isIdentityReadyForSelfie, screeningProfileMatchesSnapshot, supportingProfileMatchesSnapshot } from "../utils/preKycDocs.js";
import { getKycUploadDir } from "../utils/storagePaths.js";
import { GEMINI_MANUAL_REVIEW_REASON } from "../utils/geminiDataPolicy.js";
import { isKycScreeningEnabled, getKycScreeningProvider } from "../utils/kycScreeningProvider.js";
import { publicPrivateScreening, PRIVATE_AUTOMATED_CHECK_VERSION, privateScreeningBinding } from "../services/privateDocumentLayout.service.js";
import { hasCurrentManualDocumentComparison } from "../services/manualDocumentComparison.js";
import { repairLegacyKycSummary } from "../services/kycSummary.service.js";
import { publicKycStatus } from "../utils/publicKycStatus.js";
import { getAccountVerification } from "../services/accountVerification.service.js";
import { readPrivateKycEvidence } from "../services/privateKycReviewContext.js";
import { isBoundPreKycFace } from "../utils/preKycFace.js";
import { assertActiveRegistrationDraft } from "../utils/registrationDraft.js";
import { discardUnusedPreKycFile } from "../jobs/kycFileCleanup.job.js";
import { canInspectRegistrationDocument, registrationReviewFilter, supportingDocumentCanContinue } from "../utils/registrationReview.js";
import { startFaceReverification, getFaceReverificationAttempt, recordFaceReverification,
  cancelFaceReverification, reconcileFaceReverification, reverificationFaceKey } from "../services/kycReverification.service.js";

const isProduction = process.env.NODE_ENV === "production";
const getFaceServiceUrl = () => {
  const configured = String(process.env.FACE_SERVICE_URL || "").trim();
  if (configured) return configured;
  return isProduction ? "" : "http://localhost:8010";
};
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "";
const PRE_KYC_DOC_TTL_HOURS = Number(process.env.PREKYC_DOC_TTL_HOURS || 3);
const PRE_KYC_FACE_TTL_HOURS = Number(process.env.PREKYC_FACE_TTL_HOURS || PRE_KYC_DOC_TTL_HOURS || 3);
const MAX_KYC_IMAGE_BYTES = Number(process.env.KYC_IMAGE_MAX_BYTES || 4 * 1024 * 1024);
const KYC_UPLOAD_DIR = getKycUploadDir();
const DEFAULT_KYC_ERROR_MESSAGE = "We couldn't complete verification right now. Please try again.";

const identitySelfieGateMessage = (document) => {
  if (!document) return "Upload your government ID and wait for its details to be checked before taking a selfie.";
  if (["reupload_required", "rejected"].includes(document.status)) {
    return "Your ID needs a correction before selfie verification. Upload an ID that matches your registration details.";
  }
  if (["queued", "processing", "retry_wait"].includes(document.status)) {
    return "Your ID details are still being checked. Selfie verification will unlock automatically after they match.";
  }
  return "We could not confirm that this ID matches your registration details yet. Check the document status before continuing.";
};

const toErrorDetail = (err) => String(err?.stack || err?.message || err || "Unknown error");

const toClientMessage = (err, fallbackMessage = DEFAULT_KYC_ERROR_MESSAGE) => {
  const status = Number(err?.status) || 500;

  if (status < 500) {
    if (err?.expose === false) return "Request failed.";
    return String(err?.message || fallbackMessage);
  }

  return String(err?.publicMessage || fallbackMessage);
};

const sendKycError = (
  res,
  err,
  {
    logMessage = "KYC request failed",
    fallbackMessage = DEFAULT_KYC_ERROR_MESSAGE,
    includeSuccess = true,
  } = {}
) => {
  auditLog.error("KYC", logMessage, { detail: toErrorDetail(err) });
  const status = Number(err?.status) || 500;
  const message = toClientMessage(err, fallbackMessage);
  if (includeSuccess) return res.status(status).json({ success: false, message });
  return res.status(status).json({ message });
};

const safeKeyMatch = (provided, expected) => {
  const providedBuffer = Buffer.from(String(provided || ""), "utf8");
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");
  if (!providedBuffer.length || !expectedBuffer.length) return false;
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

const splitFirstLastName = (fullName = "") => {
  const tokens = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    first_name: tokens[0] || "",
    last_name: tokens.length > 1 ? tokens[tokens.length - 1] : "",
  };
};

const ensureUploadDir = async () => {
  await fs.mkdir(KYC_UPLOAD_DIR, { recursive: true });
};

const decodeKycBase64 = (base64, { maxBytes = MAX_KYC_IMAGE_BYTES } = {}) => {
  const raw = String(base64 || "").trim();
  const cleanBase64 = raw.includes("base64,") ? raw.slice(raw.indexOf("base64,") + 7) : raw;
  if (!cleanBase64 || !/^[A-Za-z0-9+/=\s]+$/.test(cleanBase64)) {
    const error = new Error("Document must be a valid base64 image.");
    error.status = 400;
    throw error;
  }
  const buffer = Buffer.from(cleanBase64.replace(/\s/g, ""), "base64");
  if (!buffer.length || buffer.length > maxBytes) {
    const error = new Error(`Image must be no larger than ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
    error.status = 413;
    throw error;
  }
  return buffer;
};

const queuePreKycDocument = async ({
  email,
  role,
  sessionId,
  docType,
  selectedDocCategory,
  profileSnapshot,
  fileMeta,
  expectedRevision = "",
  accountUserId = null,
  registrationDraftId,
  registrationExpiresAt,
}) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedEmail || !normalizedSessionId || !docType || !fileMeta?.fileHash) return null;

  const existing = await PreKycDocument.findOne({ email: normalizedEmail, docType })
    .select("status reasonCode fileKey fileHash reviewVersion sessionId selectedDocCategory provider privateScreening manualComparison detailsMatched validationChecks docType role expiresAt registeredUser +profileSnapshot");
  const registrationUpload = !/^(user:|reverify:)/.test(normalizedSessionId);
  if (registrationUpload && existing?.sessionId && existing.sessionId !== normalizedSessionId
    && existing.expiresAt && new Date(existing.expiresAt) > new Date()) {
    await discardUnusedPreKycFile(fileMeta.fileKey);
    throw Object.assign(new Error("Another registration owns these uploads. Resume it in its original browser or wait for its expiry."), { status: 409 });
  }
  if (registrationUpload && (existing?.registeredUser || /^(user:|reverify:)/.test(existing?.sessionId || ""))) {
    await discardUnusedPreKycFile(fileMeta.fileKey);
    throw Object.assign(new Error("This document belongs to a created account. Sign in to update it."), { status: 409 });
  }
  if (expectedRevision && existing?.reviewVersion !== expectedRevision) {
    await discardUnusedPreKycFile(fileMeta.fileKey);
    throw Object.assign(new Error("This saved document was replaced. Refresh its status before retrying."), { status: 409 });
  }
  const automatedScreening = isKycScreeningEnabled();
  const screeningFailed = automatedScreening && existing?.status === "pending_review"
    && (["AUTOMATED_SCREENING_UNAVAILABLE", "GEMINI_DATA_POLICY_UNCONFIRMED", "KYC_SCREENING_DISABLED"].includes(existing.reasonCode)
      || (existing.reasonCode === "PRIVATE_KYC_SERVICE_INCOMPATIBLE" && !hasCurrentManualDocumentComparison(existing)));
  const existingCheck = existing?.privateScreening?.automatedCheck;
  const screeningOutdated = automatedScreening && getKycScreeningProvider() === "private_ocr"
    && existing?.status === "pending_review" && !hasCurrentManualDocumentComparison(existing)
    && (existingCheck?.version !== PRIVATE_AUTOMATED_CHECK_VERSION
      || existingCheck.profileBinding !== privateScreeningBinding({ profile: profileSnapshot, sessionId: normalizedSessionId,
        role: role || "user", docType, selectedDocType: selectedDocCategory }));
  if (
    existing?.fileHash === fileMeta.fileHash &&
    existing.sessionId === normalizedSessionId &&
    existing.selectedDocCategory === String(selectedDocCategory || "").trim() &&
    screeningProfileMatchesSnapshot(existing.profileSnapshot, profileSnapshot) &&
    ["queued", "processing", "retry_wait", "pending_review", "verified"].includes(existing.status)
    && ((accountUserId && String(existing.registeredUser) === String(accountUserId) && !existing.expiresAt)
      || (existing.expiresAt && new Date(existing.expiresAt).getTime() > Date.now()))
    && !screeningFailed
    && !screeningOutdated
    && (automatedScreening || !["queued", "processing", "retry_wait"].includes(existing.status))
  ) {
    if (fileMeta.fileKey !== existing.fileKey) await discardUnusedPreKycFile(fileMeta.fileKey);
    return existing;
  }

  const requestedRetentionHours = Number(process.env.KYC_PENDING_REVIEW_RETENTION_HOURS || 72);
  const retentionHours = Number.isFinite(requestedRetentionHours) && requestedRetentionHours > 0
    ? requestedRetentionHours
    : 72;
  const now = new Date();
  let updated;
  try {
  updated = await PreKycDocument.findOneAndUpdate(
    { email: normalizedEmail, docType, ...(registrationUpload ? { registeredUser: null } : {}), ...(existing ? { _id: existing._id, reviewVersion: { $eq: existing.reviewVersion ?? null } }
      : { reviewVersion: { $exists: false } }) },
    {
      $set: {
        email: normalizedEmail,
        sessionId: normalizedSessionId,
        registeredUser: accountUserId,
        ...(registrationDraftId ? { registrationDraftId, registrationExpiresAt } : {}),
        manualReviewRequestedAt: null,
        registrationCancelledAt: null,
        role: role || "user",
        docType,
        status: automatedScreening ? "queued" : "pending_review",
        queuedAt: now,
        reviewVersion: crypto.randomUUID(),
        selfieVerification: null,
        selectedDocCategory: String(selectedDocCategory || "").trim(),
        provider: automatedScreening ? getKycScreeningProvider() === "private_ocr" ? "private-ocr" : "gemini-queued" : "manual",
        privateScreening: null,
        manualComparison: null,
        profileSnapshot: profileSnapshot || {},
        ...fileMeta,
        filePath: "",
        processingAttempts: 0,
        nextAttemptAt: automatedScreening ? now : null,
        processingLockedAt: null,
        lastProcessedAt: null,
        processingError: "",
        country: "",
        docCategory: "",
        detailsMatched: false,
        mismatchFields: [],
        suspectedTampering: false,
        confidence: 0,
        classificationConfidence: 0,
        documentSurface: "",
        reason: automatedScreening ? "Your document was uploaded securely and is waiting for automated checks." : GEMINI_MANUAL_REVIEW_REASON,
        reasonCode: automatedScreening ? "QUEUED" : "GEMINI_DATA_POLICY_UNCONFIRMED",
        decisionSource: "",
        validationChecks: {},
        extractedData: {},
        qualityIssues: [],
        documentNumberFingerprint: "",
        verifiedAt: null,
        reviewedAt: null,
        reviewedBy: null,
        ...(!accountUserId ? { expiresAt: new Date(Date.now() + retentionHours * 60 * 60 * 1000) } : {}),
      },
      ...(accountUserId ? { $unset: { expiresAt: "" } } : {}),
    },
    { upsert: !existing, returnDocument: "after" },
  );
  if (!updated) throw Object.assign(new Error("Your document changed during upload. Refresh its status and retry."), { status: 409 });
  } catch (error) {
    await discardUnusedPreKycFile(fileMeta.fileKey);
    throw error;
  }
  if (existing?.fileKey && existing.fileKey !== updated.fileKey) await discardUnusedPreKycFile(existing.fileKey);
  return updated;
};

const savedPreKycUpload = async (req, docType) => {
  const revision = String(req.body?.document_revision || "");
  if (!revision) return null;
  const document = await PreKycDocument.findOne({ email: req.preKyc.email, sessionId: req.preKyc.sessionId, role: req.preKyc.role,
    docType, reviewVersion: revision, expiresAt: { $gt: new Date() } })
    .select("fileName fileKey fileHash mimeType fileSize").lean();
  if (!document) throw Object.assign(new Error("This saved upload is no longer current. Refresh the document status."), { status: 409 });
  const bytes = await readPrivateKycEvidence(document, KYC_UPLOAD_DIR);
  const metadata = Object.fromEntries(["fileName", "fileKey", "fileHash", "mimeType", "fileSize"].map(key => [key, document[key]]));
  return { document: metadata, base64: bytes.toString("base64") };
};

const getKycFileType = (buffer, suppliedMime = "") => {
  const mimeType = String(suppliedMime || "").toLowerCase().split(";")[0].trim();
  const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isPdf = buffer.length > 4 && buffer.subarray(0, 4).toString("ascii") === "%PDF";
  if (isJpeg && ["", "image/jpeg", "image/jpg"].includes(mimeType)) return { mimeType: "image/jpeg", ext: "jpg" };
  if (isPng && ["", "image/png"].includes(mimeType)) return { mimeType: "image/png", ext: "png" };
  if (isPdf && mimeType === "application/pdf") return { mimeType: "application/pdf", ext: "pdf" };
  const error = new Error("Unsupported or invalid document format.");
  error.status = 400;
  throw error;
};

const validateKycDocument = (base64, mimeType = "") => {
  const buffer = decodeKycBase64(base64);
  return getKycFileType(buffer, mimeType);
};

const validateKycImage = (base64) => validateKycDocument(base64, "");

const saveKycBase64File = async ({ base64, mimeType = "image/jpeg", prefix = "doc" }) => {
  const buffer = decodeKycBase64(base64);
  const fileType = getKycFileType(buffer, mimeType);
  const safePrefix = String(prefix || "doc").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const fileName = `${safePrefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${fileType.ext}`;
  await ensureUploadDir();
  const filePath = path.join(KYC_UPLOAD_DIR, fileName);
  await fs.writeFile(filePath, buffer);
  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
  return {
    fileName,
    fileKey: fileName,
    mimeType: fileType.mimeType,
    fileSize: buffer.length,
    fileHash,
  };
};

const recordPreKycFace = async ({ email, role, sessionId, result, document }) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedEmail || !normalizedSessionId) return;

  const expiresAt = new Date(Date.now() + PRE_KYC_FACE_TTL_HOURS * 60 * 60 * 1000);
  const verified = result?.verified === true;

  const verification = { status: verified ? "approved" : "rejected", idDocumentHash: document.fileHash,
    idDocumentRevision: document.reviewVersion, verifiedAt: verified ? new Date() : null, expiresAt };
  const recorded = await PreKycDocument.updateOne({ _id: document._id, email: normalizedEmail, role, sessionId: normalizedSessionId,
    reviewVersion: document.reviewVersion, fileHash: document.fileHash, status: { $in: ["pending_review", "verified"] },
    expiresAt: { $gt: new Date() } }, { $set: { selfieVerification: verification } });
  if (!recorded.modifiedCount) throw Object.assign(new Error("Your ID changed during selfie verification. Check the current ID before continuing."), { status: 409 });

  // The document update is authoritative; this legacy summary can be repaired independently.
  await PreKycFace.findOneAndUpdate(
    { email: normalizedEmail },
    {
      $set: {
        email: normalizedEmail,
        sessionId: normalizedSessionId,
        role: role || "user",
        status: verified ? "approved" : "rejected",
        confidence: Number(result?.confidence || 0),
        reason: result?.message || "",
        verifiedAt: verified ? new Date() : undefined,
        expiresAt,
        idDocumentHash: document.fileHash,
        idDocumentRevision: document.reviewVersion,
      },
      $setOnInsert: {
        provider: "face-service",
      },
    },
    { upsert: true, returnDocument: "after" }
  ).catch(() => auditLog.warn("KYC", "Selfie result saved on the document; legacy face summary could not be updated"));
};

export const createPreKycSession = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const role = req.body?.role === "owner" ? "owner" : "user";
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }
    const previousToken = String(req.body?.previousToken || "").trim();
    const session = previousToken
      ? renewPreKycSession(previousToken, { email, role })
      : issuePreKycSession({ email, role });
    if (session.draftId) await assertActiveRegistrationDraft(session);
    return res.status(201).json({
      success: true,
      preKycToken: session.token,
      email: session.email,
      role: session.role,
    });
  } catch (error) {
    return sendKycError(res, error, {
      logMessage: "Pre-KYC session creation failed",
      fallbackMessage: "We couldn't start document verification right now.",
    });
  }
};

// Send a request to the face service
const proxyToFaceService = async (endpoint, body) => {
  const faceServiceUrl = getFaceServiceUrl();
  if (!faceServiceUrl) {
    throw new Error("FACE_SERVICE_URL is not configured in production.");
  }
  if (!INTERNAL_KEY) {
    throw new Error("INTERNAL_API_KEY is required to communicate with the face service.");
  }
  const url = `${faceServiceUrl}${endpoint}`;
  auditLog.info("KYC", `Proxying to Python: ${url}`);
  const doRequest = () =>
    axios.post(url, body, {
      headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY },
      timeout: 60000, // Face checks can take a while
    });

  try {
    const response = await doRequest();
    return response.data;
  } catch (err) {
    if (isFaceServiceConnectionError(err)) {
      try {
        const started = await ensureFaceServiceReady();
        if (started) {
          auditLog.warn("KYC", `Face service unreachable, retrying once: ${url}`);
          const retryResponse = await doRequest();
          return retryResponse.data;
        }
      } catch (bootErr) {
        auditLog.error("KYC", "Face service startup/retry failed", { detail: bootErr.message, url });
      }
    }

    // Log the face service error for debugging
    const status = err.response?.status || "no response";
    const detail = err.response?.data?.detail || err.response?.data?.message || err.message;
    auditLog.error("KYC", `Python service error: status=${status}`, { detail, url });

    if (isFaceServiceConnectionError(err)) {
      throw new Error(`Python face service is not running at ${faceServiceUrl}. Start it with: python face-service/main.py`);
    }
    if (err.code === "ETIMEDOUT" || err.code === "ECONNABORTED") {
      throw new Error("Face service timed out. The image may be too large or the service is overloaded.");
    }
    throw new Error(detail || "Face service error.");
  }
};

// Step 1: face quality check
// POST /api/kyc/face/detect
export const faceDetect = async (req, res) => {
  try {
    const { image_base64 } = req.body;
    if (!image_base64) return res.status(400).json({ message: "image_base64 is required" });
    validateKycImage(image_base64);

    const result = await proxyToFaceService("/api/kyc/face/detect", { image_base64 });
    res.json(result);
  } catch (err) {
    return sendKycError(res, err, {
      logMessage: "Face detect failed",
      fallbackMessage: "We couldn't check your face right now. Please try again.",
    });
  }
};

// Step 2: save ID face data
// POST /api/kyc/id-register
const registerIdentityDocument = async (req, res, reverification = false, replacement = false) => {
  try {
    await repairLegacyKycSummary(req.user);
    if (!reverification && !replacement && req.user.kycStatus === "approved") {
      throw Object.assign(new Error("Your identity is already verified. Use Reverify face to check a new selfie."), { status: 409 });
    }
    let { id_image_base64, id_image_mime, id_type } = req.body;
    const { user_profile } = req.body;
    let saved;
    if (!id_image_base64 && typeof req.body.document_revision === "string") {
      saved = await PreKycDocument.findOne({ registeredUser: req.user._id, docType: "id", reviewVersion: req.body.document_revision }).select("+profileSnapshot");
      if (!saved) throw Object.assign(new Error("This saved ID was replaced. Refresh its current status."), { status: 409 });
      const bytes = await readPrivateKycEvidence(saved, getKycUploadDir());
      id_image_base64 = bytes.toString("base64"); id_image_mime = saved.mimeType; id_type ||= saved.selectedDocCategory;
    }
    if (!id_image_base64) return res.status(400).json({ message: "Please choose an ID image before continuing." });
    validateKycImage(id_image_base64);
    if (!id_type) return res.status(400).json({ message: "Please select the ID type before verifying." });
    const selectedIdType = resolveSupportedDocumentType(id_type, "id");
    if (!selectedIdType) return res.status(400).json({ message: "That ID type is not supported. Please select one from the list." });

    const imageBuffer = decodeKycBase64(id_image_base64);
    const imageHash = crypto.createHash("sha256").update(imageBuffer).digest("hex");

    const fallbackName = splitFirstLastName(req.user?.name || user_profile?.full_name);
    const profileContext = {
      full_name: req.user?.name || user_profile?.full_name,
      first_name: req.user?.firstName || user_profile?.first_name || fallbackName.first_name,
      last_name: req.user?.lastName || user_profile?.last_name || fallbackName.last_name,
      date_of_birth: req.user?.dateOfBirth || user_profile?.date_of_birth,
      business_name: req.user?.businessName || user_profile?.business_name,
      permit_number: req.user?.permitNumber || user_profile?.permit_number,
    };

    if (!reverification) {
      const previous = saved || await PreKycDocument.findOne({ email: req.user.email, docType: "id" }).select("+profileSnapshot");
      const current = await KycVerification.findOne({ user: req.user._id });
      if (previous?.fileHash === imageHash && previous.selectedDocCategory === selectedIdType
        && ["queued", "processing", "retry_wait", "pending_review", "verified"].includes(previous.status)
        && screeningProfileMatchesSnapshot(previous.profileSnapshot, profileContext)
        && current?.idDocumentHash === imageHash && current.registrationDocumentVersions?.id === previous.reviewVersion
        && (current.challengePassedAt || (!saved && current.idRegisteredAt && current.registrationIdentitySessionId === previous.sessionId))) {
        return res.json({ success: true, message: "This ID is already saved. Its current verification results are unchanged.", documentRevision: previous.reviewVersion });
      }
    }

    const attempt = reverification ? await startFaceReverification(req.user, imageHash, profileContext) : null;
    const sessionId = attempt?.sessionId || `user:${req.user._id.toString()}`;

    const fileMeta = await saveKycBase64File({
      base64: id_image_base64,
      mimeType: id_image_mime || "image/jpeg",
      prefix: "review-queued-user-id",
    });
    const uploadAttemptId = attempt ? null : crypto.randomUUID();
    if (!attempt) {
      await KycVerification.updateOne({ user: req.user._id }, { $set: { status: "id_uploaded", challengePassedAt: null, verifiedAt: null,
        idRegisteredAt: null, identityUploadAttemptId: uploadAttemptId, summarySyncPending: true } }, { upsert: true });
      await User.updateOne({ _id: req.user._id }, { $set: { kycStatus: "id_uploaded", kycStatusUpdatedAt: new Date() } });
    }
    const queuedIdentity = await queuePreKycDocument({
      email: attempt ? `reverify:${attempt.attemptId}:${req.user.email}` : req.user.email,
      role: req.user.role,
      sessionId,
      docType: "id",
      selectedDocCategory: selectedIdType,
      profileSnapshot: profileContext,
      fileMeta: { ...fileMeta, fileHash: imageHash },
      accountUserId: attempt ? null : req.user._id,
      expectedRevision: saved?.reviewVersion || "",
    });
    triggerKycDocumentProcessing();

    const payload = {
      user_id: attempt ? reverificationFaceKey(attempt.attemptId) : `pre:account:${req.user._id}:${queuedIdentity.reviewVersion}`,
      role: req.user.role,
      full_name: req.user.name,
      id_image_base64,
    };

    if (!attempt) {
      const pinned = await KycVerification.findOneAndUpdate(
        { user: req.user._id, identityUploadAttemptId: uploadAttemptId },
        {
          user: req.user._id,
          status: "id_uploaded",
          idDocumentHash: imageHash,
          challengePassedAt: null,
          verifiedAt: null,
          faceMatchScore: 0,
          remarks: "ID saved. Face setup must finish before selfie verification.",
          idRegisteredAt: null,
          registrationIdentitySessionId: sessionId,
          "registrationDocumentVersions.id": queuedIdentity.reviewVersion,
        },
        { returnDocument: "after" }
      );
      if (!pinned) throw Object.assign(new Error("Another ID upload started. Refresh the latest saved ID."), { status: 409 });
    }
    const result = await proxyToFaceService("/api/kyc/id/register", payload);
    if (result.success && !attempt) {
      if (!await PreKycDocument.exists({ _id: queuedIdentity._id, reviewVersion: queuedIdentity.reviewVersion, fileHash: imageHash })) {
        throw Object.assign(new Error("Your ID changed during face setup. Refresh its status."), { status: 409 });
      }
      const recorded = await KycVerification.updateOne({ user: req.user._id, identityUploadAttemptId: uploadAttemptId,
        "registrationDocumentVersions.id": queuedIdentity.reviewVersion, idDocumentHash: imageHash },
      { $set: { idRegisteredAt: new Date(), remarks: "ID face registered. Awaiting selfie verification.", summarySyncPending: true } });
      if (!recorded.matchedCount) throw Object.assign(new Error("Another ID upload started. Refresh the latest saved ID."), { status: 409 });
    }

    res.json({
      ...result,
      ...(attempt ? { attemptId: attempt.attemptId } : {}),
      verificationQueued: true,
      reviewRequired: true,
      message: result.success
        ? isKycScreeningEnabled()
          ? "ID uploaded securely. Document screening has started; this is not an approval yet."
          : "ID uploaded securely. An administrator must review your document."
        : result.message,
    });
  } catch (err) {
    return sendKycError(res, err, {
      logMessage: "ID registration failed",
      fallbackMessage: "We couldn't verify your ID right now. Please try again.",
    });
  }
};

export const registerIdFace = (req, res) => registerIdentityDocument(req, res);
export const registerReverificationId = (req, res) => registerIdentityDocument(req, res, true);

export const replaceAccountDocument = async (req, res) => {
  if (req.params.docType === "id") return registerIdentityDocument(req, res, false, true);
  try {
    if (req.user.role !== "owner" || req.params.docType !== "supporting") throw Object.assign(new Error("This document is not required for your account."), { status: 403 });
    const selected = resolveSupportedDocumentType(req.body.supporting_doc_type, "supporting");
    if (!selected) throw Object.assign(new Error("Choose a supported business document type."), { status: 400 });
    validateKycDocument(req.body.doc_image_base64, req.body.doc_image_mime || "");
    const previousDocument = await PreKycDocument.findOne({ email: req.user.email, role: "owner", docType: "supporting" }).select("+profileSnapshot");
    const profileSnapshot = { full_name: req.user.name, date_of_birth: req.user.dateOfBirth,
      business_name: req.user.businessName, permit_number: req.user.permitNumber, license_number: req.user.licenseNumber,
      tax_identification_number: previousDocument?.profileSnapshot?.tax_identification_number,
      branch_code: previousDocument?.profileSnapshot?.branch_code };
    if (isBirSupportingDocumentType(selected) && (!/^\d{9}$/.test(String(profileSnapshot.tax_identification_number || ""))
      || !/^\d{3,5}$/.test(String(profileSnapshot.branch_code || "")))) {
      throw Object.assign(new Error("This document requires your registered BIR details. Contact support to correct those details."), { status: 400 });
    }
    const sessionId = `user:${req.user._id}`;
    const kyc = await KycVerification.findOne({ user: req.user._id });
    if (!kyc) throw Object.assign(new Error("Complete your identity verification before replacing a business document."), { status: 409 });
    const hash = crypto.createHash("sha256").update(decodeKycBase64(req.body.doc_image_base64)).digest("hex");
    if (previousDocument?.fileHash === hash && previousDocument.selectedDocCategory === selected
      && String(previousDocument.registeredUser) === String(req.user._id)
      && ["queued", "processing", "retry_wait", "pending_review", "verified"].includes(previousDocument.status)
      && kyc.registrationDocumentVersions?.supporting === previousDocument.reviewVersion
      && previousDocument.profileSnapshot?.full_name === req.user.name
      && supportingProfileMatchesSnapshot(previousDocument.profileSnapshot, profileSnapshot)) {
      return res.json({ success: true, message: "This business document is already saved. Its current verification results are unchanged." });
    }
    const fileMeta = await saveKycBase64File({ base64: req.body.doc_image_base64,
      mimeType: req.body.doc_image_mime || "image/jpeg", prefix: "review-account-supporting" });
    await KycVerification.updateOne({ user: req.user._id }, { $set: { status: kyc.challengePassedAt ? "challenge_passed" : "id_uploaded",
      verifiedAt: null, summarySyncPending: true,
      ...(!kyc.registrationDocumentVersions?.id && kyc.status === "approved" && req.user.kycStatus === "approved"
        ? { legacyIdentityApprovedAt: kyc.verifiedAt || new Date() } : {}) } });
    await User.updateOne({ _id: req.user._id }, { $set: { kycStatus: kyc.challengePassedAt ? "challenge_passed" : "id_uploaded", kycStatusUpdatedAt: new Date() } });
    const document = await queuePreKycDocument({ email: req.user.email, role: "owner", sessionId, docType: "supporting",
      selectedDocCategory: selected, profileSnapshot, fileMeta, accountUserId: req.user._id });
    await KycVerification.updateOne({ user: req.user._id }, { $set: { registrationSupportingSessionId: sessionId,
      "registrationDocumentVersions.supporting": document.reviewVersion } });
    triggerKycDocumentProcessing();
    await reconcileUserKyc(req.user._id);
    return res.json({ success: true, message: "Business document saved. Its approval is pending; your ID and selfie results are preserved." });
  } catch (error) { return sendKycError(res, error, { logMessage: "Account document replacement failed" }); }
};

// Step 3: match one captured selfie with the registered ID
// POST /api/kyc/selfie/verify
export const selfieVerify = async (req, res) => {
  try {
    if (req.user.kycStatus === "approved") {
      throw Object.assign(new Error("Your identity is already verified. Use Reverify face for a new selfie."), { status: 409 });
    }
    const { selfie_image_base64 } = req.body;
    if (!selfie_image_base64)
      return res.status(400).json({ message: "selfie_image_base64 is required" });
    validateKycImage(selfie_image_base64);

    const current = await KycVerification.findOne({ user: req.user._id });
    if (current?.identityUploadAttemptId && !current.idRegisteredAt) throw Object.assign(new Error("Your ID is saved, but its face setup is incomplete. Retry saved ID setup before taking a selfie."), { status: 409 });
    const document = await PreKycDocument.findOne({ sessionId: current?.registrationIdentitySessionId || current?.registrationSessionId || `user:${req.user._id}`, docType: "id" });
    if (!document || !isIdentityReadyForSelfie(document) || (current?.registrationDocumentVersions?.id && document.reviewVersion !== current.registrationDocumentVersions.id)) {
      throw Object.assign(new Error(identitySelfieGateMessage(document)), { status: 409 });
    }

    const payload = {
      user_id: current?.registrationDocumentVersions?.id ? `pre:account:${req.user._id}:${document.reviewVersion}` : req.user._id.toString(),
      selfie_image_base64,
    };

    const result = await proxyToFaceService("/api/kyc/selfie/verify", payload);
    if (result.verified !== true && /upload.*\bid\b.*first/i.test(String(result.message || ""))) {
      throw Object.assign(new Error("The saved ID face setup is no longer available. Retry saved ID setup before taking a selfie."), { status: 409 });
    }
    if (current?.registrationDocumentVersions?.id) {
      if (!await PreKycDocument.exists({ _id: document._id, reviewVersion: document.reviewVersion, fileHash: document.fileHash })) {
        throw Object.assign(new Error("Your ID changed during face verification. Refresh its status."), { status: 409 });
      }
      const recorded = await KycVerification.updateOne({ user: req.user._id, idDocumentHash: document.fileHash,
        "registrationDocumentVersions.id": document.reviewVersion,
        ...(current.identityUploadAttemptId ? { identityUploadAttemptId: current.identityUploadAttemptId } : {}) }, { $set: { status: result.verified === true ? "challenge_passed" : "rejected",
        challengePassedAt: result.verified === true ? new Date() : null, summarySyncPending: true } });
      if (!recorded.matchedCount) throw Object.assign(new Error("Your ID changed during face verification. Refresh its status."), { status: 409 });
    }
    const kyc = await reconcileUserKyc(req.user._id);
    res.json({ verified: result.verified === true, message: result.verified
      ? "Your selfie matched your ID photo." : "We couldn't match this selfie. Keep your face visible and try again.",
    kycStatus: kyc?.status || req.user.kycStatus, reviewRequired: Boolean(result.verified && kyc?.status !== "approved") });
  } catch (err) {
    return sendKycError(res, err, {
      logMessage: "Selfie verify failed",
      fallbackMessage: "We couldn't verify your selfie right now. Please try again.",
    });
  }
};

export const verifyReverificationSelfie = async (req, res) => {
  try {
    const { attemptId, selfie_image_base64 } = req.body;
    if (!selfie_image_base64) throw Object.assign(new Error("Take a selfie before continuing."), { status: 400 });
    validateKycImage(selfie_image_base64);
    await getFaceReverificationAttempt(req.user._id, attemptId);
    const result = await proxyToFaceService("/api/kyc/selfie/verify", {
      user_id: reverificationFaceKey(attemptId), selfie_image_base64,
    });
    const kyc = await recordFaceReverification(req.user._id, attemptId, result);
    const completed = kyc?.faceReverification?.status === "approved";
    res.json({ verified: result.verified === true, kycStatus: completed ? "approved" : "challenge_passed",
      reverificationStatus: kyc?.faceReverification?.status, reviewRequired: Boolean(result.verified && !completed),
      message: result.verified ? "Your selfie matched your ID photo." : "We couldn't match this selfie. Try again in even lighting." });
  } catch (error) {
    return sendKycError(res, error, { logMessage: "Face reverification failed", fallbackMessage: "We couldn't reverify your face right now. Your existing approval is unchanged. Try again." });
  }
};

export const cancelReverification = async (req, res) => {
  try {
    await cancelFaceReverification(req.user._id, req.body.attemptId);
    res.json({ success: true });
  } catch (error) {
    return sendKycError(res, error, { logMessage: "Cancel reverification failed" });
  }
};

// Internal callback from the Python service
// PATCH /api/kyc/internal/update-status
export const internalUpdateStatus = async (req, res) => {
  try {
    const internalKey = req.headers["x-internal-key"];
    if (!safeKeyMatch(internalKey, INTERNAL_KEY))
      return res.status(403).json({ message: "Forbidden" });

    const { user_id, status, confidence } = req.body;
    if (!user_id || !status) return res.status(400).json({ message: "user_id and status required" });

    const normalizedId = String(user_id).trim();
    const looksLikeEmail = normalizedId.includes("@");
    const isObjectId = mongoose.Types.ObjectId.isValid(normalizedId);

    if (!looksLikeEmail && !isObjectId) {
      return res.status(400).json({ message: "user_id must be an email or a valid ObjectId." });
    }

    if (looksLikeEmail && !isObjectId) {
      // Pre-registration status is written by the originating Node request with its
      // signed session id. An email-only callback cannot safely identify that attempt.
      return res.status(202).json({ message: "Pre-KYC callback acknowledged." });
    }

    if (!["approved", "rejected"].includes(status)) return res.status(400).json({ message: "Invalid face verification result." });
    const effectiveStatus = status === "approved" ? "challenge_passed" : "rejected";
    const current = await KycVerification.findOne({ user: normalizedId });
    if (current?.registrationDocumentVersions?.id || current?.identityUploadAttemptId) return res.status(202).json({ message: "Document-bound results are saved by their originating request." });

    // kyc_cases is the durable record; User.kycStatus is its denormalized summary for authorization/UI.
    await KycVerification.findOneAndUpdate(
      { user: normalizedId },
      {
        user: normalizedId,
        status: effectiveStatus,
        summarySyncPending: true,
        faceMatchScore: confidence || 0,
        challengePassedAt: status === "approved" ? new Date() : null,
        verifiedAt: null,
        remarks:
          status === "approved"
            ? "Your selfie matched. Document approval is still pending."
            : "Face did not match ID photo.",
      },
      { upsert: true }
    );
    const kyc = await reconcileUserKyc(normalizedId);
    res.json({ message: "Verification status updated.", status: kyc?.status || effectiveStatus });
  } catch (err) {
    return sendKycError(res, err, {
      logMessage: "Internal update failed",
      fallbackMessage: "Internal KYC update failed.",
      includeSuccess: false,
    });
  }
};

// Get the current user's KYC status
// GET /api/kyc/me
export const getMyKyc = async (req, res) => {
  try {
    await repairLegacyKycSummary(req.user);
    const kyc = await reconcileUserKyc(req.user._id);
    const latest = kyc?.faceReverification ? await reconcileFaceReverification(req.user._id) : kyc;
    const user = await User.findById(req.user._id).select("kycStatus kycStatusUpdatedAt role isVerified isDisabled isArchived registrationDraftId ownerDocumentVerificationRequired");
    // During the collection-split rollout, User.kycStatus preserves the existing status
    // until the explicit migration has copied legacy kycverifications records.
    const verification = await getAccountVerification(user || req.user, latest);
    const status = publicKycStatus(latest, user || req.user);
    if (status.status === "approved" && !verification.documentApprovalComplete) {
      status.status = verification.selfieVerified ? "challenge_passed" : "id_uploaded";
      status.remarks = "Required document verification is incomplete. Review the individual document statuses below.";
      status.verifiedAt = null;
    }
    res.json({ ...status, verification });
  } catch (err) {
    return sendKycError(res, err, {
      logMessage: "Get KYC status failed",
      fallbackMessage: "Could not fetch verification status. Please try again.",
      includeSuccess: false,
    });
  }
};

// Pre-registration KYC
// Uses email as user_id before the account exists

// Pre-registration ID upload
export const preRegisterIdFace = async (req, res) => {
  try {
    const { full_name, id_type, user_profile } = req.body;
    const saved = !req.body.id_image_base64 ? await savedPreKycUpload(req, "id") : null;
    const id_image_base64 = req.body.id_image_base64 || saved?.base64;
    const id_image_mime = req.body.id_image_mime || saved?.document.mimeType;
    const { email, role, sessionId } = req.preKyc;

    if (!email || !id_image_base64) {
      return res.status(400).json({ success: false, message: "Please enter your email and choose an ID image before continuing." });
    }
    validateKycImage(id_image_base64);
    if (!id_type) {
      return res.status(400).json({ success: false, message: "Please select the ID type before verifying." });
    }
    const selectedIdType = resolveSupportedDocumentType(id_type, "id");
    if (!selectedIdType) {
      return res.status(400).json({ success: false, message: "That ID type is not supported. Please select one from the list." });
    }

    const fallbackName = splitFirstLastName(full_name || user_profile?.full_name);
    const profileContext = {
      full_name: full_name || user_profile?.full_name,
      first_name: user_profile?.first_name || fallbackName.first_name,
      last_name: user_profile?.last_name || fallbackName.last_name,
      date_of_birth: user_profile?.date_of_birth,
      business_name: user_profile?.business_name,
      permit_number: user_profile?.permit_number,
    };

    const payload = {
      user_id: `pre:${sessionId}`,
      role,
      full_name: full_name || "",
      id_image_base64,
    };

    let fileMeta = {};
    try {
      fileMeta = saved?.document || await saveKycBase64File({
        base64: id_image_base64,
        mimeType: id_image_mime || "image/jpeg",
        prefix: "review-queued-pre-id",
      });
    } catch (saveErr) {
      return sendKycError(res, saveErr, {
        logMessage: "Pre-reg ID private storage rejected",
        fallbackMessage: "Please upload a valid ID image.",
      });
    }
    const queuedDocument = await queuePreKycDocument({
      email,
      role,
      sessionId,
      docType: "id",
      selectedDocCategory: selectedIdType,
      profileSnapshot: profileContext,
      fileMeta,
      expectedRevision: saved ? req.body.document_revision : "",
      registrationDraftId: req.registrationDraft?._id,
      registrationExpiresAt: req.registrationDraft?.expiresAt,
    });
    // Each document revision gets an isolated biometric template, including concurrent uploads.
    payload.user_id = `pre:${sessionId}:${queuedDocument.reviewVersion}`;
    triggerKycDocumentProcessing();
    auditLog.info("KYC", "Pre-registration ID register requested");
    const result = await proxyToFaceService("/api/kyc/id/register", payload);
    let latestDocument = null;
    if (queuedDocument?._id) {
      try {
        latestDocument = await PreKycDocument.findOne({
          _id: queuedDocument._id, email, sessionId, reviewVersion: queuedDocument.reviewVersion,
        }).select("status privateScreening fileHash reviewVersion");
      } catch {
        auditLog.warn("KYC", "Upload completed; latest screening status will be obtained by polling");
      }
    }
    res.json({
      ...result,
      documentStatus: latestDocument?.status || queuedDocument?.status || "queued",
      documentRevision: queuedDocument?.reviewVersion || "",
      automatedScreening: latestDocument ? publicPrivateScreening(latestDocument) : null,
      verificationQueued: true,
      reviewRequired: true,
      message: result?.success
        ? isKycScreeningEnabled()
          ? "ID uploaded securely. Its document type and registration details are being checked."
          : "ID uploaded securely. An administrator must review your document."
        : result?.message,
    });
  } catch (err) {
    return sendKycError(res, err, {
      logMessage: "Pre-reg ID registration failed",
      fallbackMessage: "We couldn't verify your ID right now. Please try again.",
    });
  }
};

// Pre-registration selfie check
export const preSelfieVerify = async (req, res) => {
  try {
    const { selfie_image_base64 } = req.body;
    const { email, role, sessionId } = req.preKyc;

    if (!email || !selfie_image_base64) {
      return res.status(400).json({ success: false, message: "email and selfie_image_base64 are required" });
    }
    validateKycImage(selfie_image_base64);

    const idDocument = await PreKycDocument.findOne({ email, sessionId, docType: "id" })
      .select("email docType status detailsMatched provider selectedDocCategory validationChecks manualComparison privateScreening fileKey mimeType fileHash reviewVersion sessionId role suspectedTampering expiresAt +profileSnapshot")
      .lean();
    if (!isIdentityReadyForSelfie(idDocument) || new Date(idDocument.expiresAt).getTime() <= Date.now()) {
      return res.status(409).json({
        success: false,
        code: "ID_DETAILS_NOT_MATCHED",
        message: identitySelfieGateMessage(idDocument),
      });
    }

    const payload = {
      user_id: `pre:${sessionId}:${idDocument.reviewVersion}`,
      selfie_image_base64,
    };

    // Recover an interrupted ID registration or an expired face-service template from private evidence.
    const idBytes = await readPrivateKycEvidence(idDocument, KYC_UPLOAD_DIR);
    const registered = await proxyToFaceService("/api/kyc/id/register", { user_id: payload.user_id, role,
      full_name: idDocument.profileSnapshot?.full_name || "", id_image_base64: idBytes.toString("base64") });
    if (!registered?.success) return res.status(409).json({ success: false, message: registered?.message || "The saved ID could not be prepared for face matching." });

    auditLog.info("KYC", "Pre-registration selfie verify requested");
    const result = await proxyToFaceService("/api/kyc/selfie/verify", payload);
    const current = await PreKycDocument.findOne({ email, sessionId, role, docType: "id", fileHash: idDocument.fileHash,
      reviewVersion: idDocument.reviewVersion, expiresAt: { $gt: new Date() } }).select("+profileSnapshot").lean();
    if (!isIdentityReadyForSelfie(current)) return res.status(409).json({ success: false, verified: false,
      message: "Your ID changed while the selfie was being checked. Verify against the current ID." });
    await recordPreKycFace({ email, role, sessionId, result, document: idDocument });
    res.json({ ...result, verified: result?.verified === true });
  } catch (err) {
    return sendKycError(res, err, {
      logMessage: "Pre-reg selfie verify failed",
      fallbackMessage: "We couldn't verify your selfie right now. Please try again.",
    });
  }
};

// Pre-registration supporting document verification (owner)
export const preVerifySupportingDocument = async (req, res) => {
  try {
    const { supporting_doc_type, user_profile } = req.body;
    const saved = !req.body.doc_image_base64 ? await savedPreKycUpload(req, "supporting") : null;
    const doc_image_base64 = req.body.doc_image_base64 || saved?.base64;
    const doc_image_mime = req.body.doc_image_mime || saved?.document.mimeType;
    const { email, role, sessionId } = req.preKyc;

    if (!email || !doc_image_base64) {
      return res.status(400).json({
        success: false,
        message: "Please enter your email and choose a supporting document before continuing.",
      });
    }
    validateKycDocument(doc_image_base64, doc_image_mime || "");
    if (!supporting_doc_type) {
      return res.status(400).json({
        success: false,
        message: "Please select the supporting document type before verifying.",
      });
    }
    const selectedSupportingType = resolveSupportedDocumentType(supporting_doc_type, "supporting");
    if (!selectedSupportingType) {
      return res.status(400).json({
        success: false,
        message: "That supporting document type is not supported. Please select one from the list.",
      });
    }

    if (isBirSupportingDocumentType(selectedSupportingType)) {
      if (!String(user_profile?.business_name || "").trim()) {
        return res.status(400).json({ success: false, message: "Enter the business name shown on your BIR document." });
      }
      if (!/^\d{9}$/.test(String(user_profile?.tax_identification_number || ""))) {
        return res.status(400).json({ success: false, message: "Enter the 9-digit TIN shown on your BIR document." });
      }
      if (!/^\d{3,5}$/.test(String(user_profile?.branch_code || ""))) {
        return res.status(400).json({ success: false, message: "Enter the branch code shown on your BIR document." });
      }
    }

    const fallbackName = splitFirstLastName(user_profile?.full_name);
    const profileContext = {
      full_name: user_profile?.full_name,
      first_name: user_profile?.first_name || fallbackName.first_name,
      last_name: user_profile?.last_name || fallbackName.last_name,
      business_name: user_profile?.business_name,
      permit_number: user_profile?.permit_number,
      tax_identification_number: user_profile?.tax_identification_number,
      branch_code: user_profile?.branch_code,
    };

    const fileMeta = saved?.document || await saveKycBase64File({
      base64: doc_image_base64,
      mimeType: doc_image_mime || "image/jpeg",
      prefix: "review-queued-pre-supporting",
    });
    const queuedDocument = await queuePreKycDocument({
      email,
      role,
      sessionId,
      docType: "supporting",
      selectedDocCategory: selectedSupportingType,
      profileSnapshot: profileContext,
      fileMeta,
      expectedRevision: saved ? req.body.document_revision : "",
      registrationDraftId: req.registrationDraft?._id,
      registrationExpiresAt: req.registrationDraft?.expiresAt,
    });
    triggerKycDocumentProcessing();
    return res.json({
      success: true,
      documentStatus: queuedDocument?.status || "queued",
      documentRevision: queuedDocument?.reviewVersion || "",
      verificationQueued: true,
      reviewRequired: true,
      message: isKycScreeningEnabled()
        ? "Supporting document uploaded securely. Automated checks have started."
        : "Supporting document uploaded securely. An administrator must review your document.",
      selectedDocType: selectedSupportingType,
    });
  } catch (err) {
    return sendKycError(res, err, {
      logMessage: "Pre-reg supporting doc verify failed",
      fallbackMessage: "We couldn't verify your document right now. Please try again.",
    });
  }
};

export const requestRegistrationReview = async (req, res) => {
  try {
    const { email, sessionId, role, draftId } = req.preKyc;
    if (!draftId) return res.status(403).json({ success: false, message: "Recover your registration before requesting manual verification." });
    const current = await PreKycDocument.findOne({ email, sessionId, role, docType: "id", registeredUser: null }).select("+profileSnapshot");
    if (!current || current.status !== "pending_review" || isIdentityReadyForSelfie(current)
      || publicPrivateScreening(current)?.outcome === "correction_needed"
      || !current.expiresAt || new Date(current.expiresAt) <= new Date()
      || !req.body?.documentRevision || current.reviewVersion !== req.body.documentRevision) {
      return res.status(409).json({ success: false, message: "Refresh the current ID result before requesting manual verification." });
    }
    const updated = await PreKycDocument.findOneAndUpdate({ _id: current._id, sessionId, role, registeredUser: null,
      reviewVersion: current.reviewVersion, status: "pending_review", expiresAt: { $gt: new Date() }, registrationCancelledAt: null },
    { $set: { registrationDraftId: draftId, manualReviewRequestedAt: current.manualReviewRequestedAt || new Date() } }, { returnDocument: "after" });
    if (!updated) return res.status(409).json({ success: false, message: "Your ID changed. Refresh its status and retry." });
    return res.json({ success: true, message: "Manual verification requested. We will update this ID status after comparison." });
  } catch (error) {
    return sendKycError(res, error, { logMessage: "Manual verification request failed", fallbackMessage: "We couldn't request manual verification. Please retry." });
  }
};

export const getPreKycStatus = async (req, res) => {
  try {
    const { email, sessionId } = req.preKyc;
    const documents = await PreKycDocument.find({ email, sessionId })
      .select("docType status docCategory selectedDocCategory detailsMatched reason reasonCode processingAttempts createdAt updatedAt provider validationChecks manualComparison privateScreening fileHash reviewVersion selfieVerification sessionId role suspectedTampering expiresAt manualReviewRequestedAt +profileSnapshot")
      .sort({ createdAt: 1 })
      .lean();
    const idDocument = documents.find(document => document.docType === "id");
    const face = idDocument && !idDocument.selfieVerification ? await PreKycFace.findOne({ email, sessionId }).lean() : null;
    const selfieVerified = isBoundPreKycFace(face, { ...idDocument, email });
    return res.json({
      success: true,
      selfieVerified,
      documents: documents.map((document) => {
        const { provider, validationChecks, manualComparison, privateScreening, fileHash, reviewVersion, selfieVerification, profileSnapshot, sessionId, role, suspectedTampering, expiresAt, manualReviewRequestedAt, ...publicDocument } = document;
        return { ...publicDocument, expiresAt: expiresAt || null, identityReadyForSelfie: isIdentityReadyForSelfie(document),
          documentRevision: reviewVersion || "",
          manualReviewRequested: Boolean(manualReviewRequestedAt),
          automatedScreening: publicPrivateScreening(document),
          canContinue: document.docType === "supporting" ? supportingDocumentCanContinue({ ...document, automatedScreening: publicPrivateScreening(document) }) : isIdentityReadyForSelfie(document) };
      }),
    });
  } catch (error) {
    return sendKycError(res, error, {
      logMessage: "Get pre-registration KYC status failed",
      fallbackMessage: "Could not load the document verification status.",
    });
  }
};

export const listPendingKycReviews = async (_req, res) => {
  try {
    const reviews = await PreKycDocument.find({ ...registrationReviewFilter(), status: { $in: ["queued", "processing", "retry_wait", "pending_review"] } })
      .select("email role sessionId registeredUser registrationDraftId manualReviewRequestedAt docType status docCategory selectedDocCategory detailsMatched mismatchFields suspectedTampering reason reasonCode documentSurface validationChecks extractedData qualityIssues decisionSource processingAttempts nextAttemptAt fileName mimeType fileSize fileHash reviewVersion createdAt expiresAt")
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();
    return res.json({ success: true, reviews });
  } catch (error) {
    return sendKycError(res, error, {
      logMessage: "List pending KYC reviews failed",
      fallbackMessage: "Could not load pending KYC reviews.",
    });
  }
};

export const getKycReviewFile = async (req, res) => {
  try {
    const review = await PreKycDocument.findById(req.params.id).select("fileKey mimeType fileName registeredUser registrationDraftId registrationExpiresAt sessionId docType status manualReviewRequestedAt registrationCancelledAt expiresAt");
    if (!canInspectRegistrationDocument(review)) return res.status(409).json({ success: false, message: "This registration has not been submitted or requested manual verification." });
    if (!review?.fileKey) return res.status(404).json({ success: false, message: "Review file not found." });

    const root = path.resolve(KYC_UPLOAD_DIR);
    const filePath = path.resolve(root, review.fileKey);
    if (path.dirname(filePath) !== root) {
      return res.status(400).json({ success: false, message: "Invalid review file." });
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.type(review.mimeType || "application/octet-stream");
    return res.sendFile(filePath);
  } catch (error) {
    return sendKycError(res, error, {
      logMessage: "Get KYC review file failed",
      fallbackMessage: "Could not load the review file.",
    });
  }
};

export const decideKycReview = async (req, res) => {
  try {
    const action = String(req.body?.action || "").trim().toLowerCase();
    const review = await reviewKycDocument({ id: req.params.id, action, remarks: req.body?.remarks, reviewerId: req.user._id, reviewVersion: req.body?.reviewVersion });
    return res.json({ success: true, review });
  } catch (error) {
    return sendKycError(res, error, {
      logMessage: "KYC review decision failed",
      fallbackMessage: "Could not save the KYC review decision.",
    });
  }
};
