// KYC controller
// Handles logged-in and pre-registration flows
import axios from "axios";
import crypto from "crypto";
import mongoose from "mongoose";
import fs from "fs/promises";
import path from "path";
import KycVerification from "../models/KycVerification.js";
import PreKycDocument from "../models/PreKycDocument.js";
import PreKycFace from "../models/PreKycFace.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import { ensureFaceServiceReady, isFaceServiceConnectionError } from "../utils/faceServiceManager.js";
import { issuePreKycSession, renewPreKycSession } from "../utils/preKycSession.js";
import { reconcileUserKyc, reviewKycDocument } from "../services/kycReview.service.js";
import { isBirSupportingDocumentType, resolveSupportedDocumentType } from "../services/documentValidation.service.js";
import { triggerKycDocumentProcessing } from "../jobs/kycDocumentProcessing.job.js";
import { isIdentityReadyForSelfie, screeningProfileMatchesSnapshot } from "../utils/preKycDocs.js";
import { getKycUploadDir } from "../utils/storagePaths.js";

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
}) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedEmail || !normalizedSessionId || !docType || !fileMeta?.fileHash) return null;

  const existing = await PreKycDocument.findOne({ email: normalizedEmail, docType })
    .select("status reasonCode fileHash sessionId selectedDocCategory +profileSnapshot");
  const screeningFailed = existing?.status === "pending_review"
    && existing.reasonCode === "AUTOMATED_SCREENING_UNAVAILABLE";
  if (
    existing?.fileHash === fileMeta.fileHash &&
    existing.sessionId === normalizedSessionId &&
    existing.selectedDocCategory === String(selectedDocCategory || "").trim() &&
    screeningProfileMatchesSnapshot(existing.profileSnapshot, profileSnapshot) &&
    ["queued", "processing", "retry_wait", "pending_review", "verified"].includes(existing.status)
    && !screeningFailed
  ) {
    return existing;
  }

  const requestedRetentionHours = Number(process.env.KYC_PENDING_REVIEW_RETENTION_HOURS || 72);
  const retentionHours = Number.isFinite(requestedRetentionHours) && requestedRetentionHours > 0
    ? requestedRetentionHours
    : 72;
  const now = new Date();
  return PreKycDocument.findOneAndUpdate(
    { email: normalizedEmail, docType },
    {
      $set: {
        email: normalizedEmail,
        sessionId: normalizedSessionId,
        role: role || "user",
        docType,
        status: "queued",
        queuedAt: now,
        reviewVersion: crypto.randomUUID(),
        selectedDocCategory: String(selectedDocCategory || "").trim(),
        provider: "gemini-queued",
        profileSnapshot: profileSnapshot || {},
        ...fileMeta,
        filePath: "",
        processingAttempts: 0,
        nextAttemptAt: now,
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
        reason: "Your document was uploaded securely and is waiting for automated checks.",
        reasonCode: "QUEUED",
        decisionSource: "",
        validationChecks: {},
        extractedData: {},
        qualityIssues: [],
        documentNumberFingerprint: "",
        verifiedAt: null,
        reviewedAt: null,
        reviewedBy: null,
        expiresAt: new Date(Date.now() + retentionHours * 60 * 60 * 1000),
      },
    },
    { upsert: true, new: true },
  );
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

const recordPreKycFace = async ({ email, role, sessionId, result }) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedEmail || !normalizedSessionId) return;

  const expiresAt = new Date(Date.now() + PRE_KYC_FACE_TTL_HOURS * 60 * 60 * 1000);
  const verified = Boolean(result?.verified);

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
      },
      $setOnInsert: {
        provider: "face-service",
      },
    },
    { upsert: true, new: true }
  );
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
export const registerIdFace = async (req, res) => {
  try {
    const { id_image_base64, id_image_mime, id_type, user_profile } = req.body;
    if (!id_image_base64) return res.status(400).json({ message: "Please choose an ID image before continuing." });
    validateKycImage(id_image_base64);
    if (!id_type) return res.status(400).json({ message: "Please select the ID type before verifying." });
    const selectedIdType = resolveSupportedDocumentType(id_type, "id");
    if (!selectedIdType) return res.status(400).json({ message: "That ID type is not supported. Please select one from the list." });

    const sessionId = `user:${req.user._id.toString()}`;
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

    const fileMeta = await saveKycBase64File({
      base64: id_image_base64,
      mimeType: id_image_mime || "image/jpeg",
      prefix: "review-queued-user-id",
    });
    await queuePreKycDocument({
      email: req.user.email,
      role: req.user.role,
      sessionId,
      docType: "id",
      selectedDocCategory: selectedIdType,
      profileSnapshot: profileContext,
      fileMeta: { ...fileMeta, fileHash: imageHash },
    });
    triggerKycDocumentProcessing();

    const payload = {
      user_id: req.user._id.toString(),
      role: req.user.role,
      full_name: req.user.name,
      id_image_base64,
    };

    const result = await proxyToFaceService("/api/kyc/id/register", payload);
    if (result.success) {
      await KycVerification.findOneAndUpdate(
        { user: req.user._id },
        {
          user: req.user._id,
          status: "id_uploaded",
          idDocumentHash: imageHash,
          challengePassedAt: null,
          verifiedAt: null,
          faceMatchScore: 0,
          remarks: "ID face registered. Awaiting selfie verification.",
          idRegisteredAt: new Date(),
        },
        { upsert: true, new: true }
      );
    }

    res.json({
      ...result,
      verificationQueued: true,
      reviewRequired: true,
      message: result.success
        ? "ID uploaded securely. Document screening has started; this is not an approval yet."
        : result.message,
    });
  } catch (err) {
    return sendKycError(res, err, {
      logMessage: "ID registration failed",
      fallbackMessage: "We couldn't verify your ID right now. Please try again.",
    });
  }
};

// Step 3: match one captured selfie with the registered ID
// POST /api/kyc/selfie/verify
export const selfieVerify = async (req, res) => {
  try {
    const { selfie_image_base64 } = req.body;
    if (!selfie_image_base64)
      return res.status(400).json({ message: "selfie_image_base64 is required" });
    validateKycImage(selfie_image_base64);

    const payload = {
      user_id: req.user._id.toString(),
      selfie_image_base64,
    };

    const result = await proxyToFaceService("/api/kyc/selfie/verify", payload);
    const kyc = await reconcileUserKyc(req.user._id);
    res.json({ ...result, kycStatus: kyc?.status || req.user.kycStatus, reviewRequired: Boolean(result.verified && kyc?.status !== "approved") });
  } catch (err) {
    return sendKycError(res, err, {
      logMessage: "Selfie verify failed",
      fallbackMessage: "We couldn't verify your selfie right now. Please try again.",
    });
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
          effectiveStatus === "approved"
            ? `Face and document verified with ${confidence}% face confidence.`
            : status === "approved"
            ? `Face verified with ${confidence}% confidence; document review is pending.`
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
    const kyc = await reconcileUserKyc(req.user._id);
    // During the collection-split rollout, User.kycStatus preserves the existing status
    // until the explicit migration has copied legacy kycverifications records.
    res.json(kyc || { status: req.user.kycStatus || "not_started" });
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
    const { full_name, id_image_base64, id_image_mime, id_type, user_profile } = req.body;
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
      fileMeta = await saveKycBase64File({
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
    await queuePreKycDocument({
      email,
      role,
      sessionId,
      docType: "id",
      selectedDocCategory: selectedIdType,
      profileSnapshot: profileContext,
      fileMeta,
    });
    triggerKycDocumentProcessing();
    auditLog.info("KYC", "Pre-registration ID register requested");
    const result = await proxyToFaceService("/api/kyc/id/register", payload);
    res.json({
      ...result,
      verificationQueued: true,
      reviewRequired: true,
      message: result?.success
        ? "ID uploaded securely. We are checking its personal details before the selfie step unlocks."
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
      .select("docType status detailsMatched")
      .lean();
    if (!isIdentityReadyForSelfie(idDocument)) {
      return res.status(409).json({
        success: false,
        code: "ID_DETAILS_NOT_MATCHED",
        message: identitySelfieGateMessage(idDocument),
      });
    }

    const payload = {
      user_id: `pre:${sessionId}`,
      selfie_image_base64,
    };

    auditLog.info("KYC", "Pre-registration selfie verify requested");
    const result = await proxyToFaceService("/api/kyc/selfie/verify", payload);
    await recordPreKycFace({ email, role, sessionId, result });
    res.json(result);
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
    const { doc_image_base64, doc_image_mime, supporting_doc_type, user_profile } = req.body;
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

    const fileMeta = await saveKycBase64File({
      base64: doc_image_base64,
      mimeType: doc_image_mime || "image/jpeg",
      prefix: "review-queued-pre-supporting",
    });
    await queuePreKycDocument({
      email,
      role,
      sessionId,
      docType: "supporting",
      selectedDocCategory: selectedSupportingType,
      profileSnapshot: profileContext,
      fileMeta,
    });
    triggerKycDocumentProcessing();
    return res.json({
      success: true,
      verificationQueued: true,
      reviewRequired: true,
      message: "Supporting document uploaded securely. Automated checks have started.",
      selectedDocType: selectedSupportingType,
    });
  } catch (err) {
    return sendKycError(res, err, {
      logMessage: "Pre-reg supporting doc verify failed",
      fallbackMessage: "We couldn't verify your document right now. Please try again.",
    });
  }
};

export const getPreKycStatus = async (req, res) => {
  try {
    const { email, sessionId } = req.preKyc;
    const documents = await PreKycDocument.find({ email, sessionId })
      .select("docType status docCategory selectedDocCategory detailsMatched reason reasonCode processingAttempts createdAt updatedAt")
      .sort({ createdAt: 1 })
      .lean();
    return res.json({
      success: true,
      documents: documents.map((document) => ({
        ...document,
        identityReadyForSelfie: isIdentityReadyForSelfie(document),
      })),
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
    const reviews = await PreKycDocument.find({ status: { $in: ["queued", "processing", "retry_wait", "pending_review"] } })
      .select("email role sessionId docType status docCategory selectedDocCategory detailsMatched mismatchFields suspectedTampering reason reasonCode documentSurface validationChecks extractedData qualityIssues decisionSource processingAttempts nextAttemptAt fileName mimeType fileSize fileHash reviewVersion createdAt expiresAt")
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
    const review = await PreKycDocument.findById(req.params.id).select("fileKey mimeType fileName");
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
