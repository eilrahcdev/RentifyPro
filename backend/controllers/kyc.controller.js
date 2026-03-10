<<<<<<< HEAD
// KYC controller
// Handles logged-in and pre-registration flows
import axios from "axios";
import crypto from "crypto";
import User from "../models/User.js";
import KycVerification from "../models/KycVerification.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import { ensureFaceServiceReady, isFaceServiceConnectionError } from "../utils/faceServiceManager.js";

const FACE_SERVICE = process.env.FACE_SERVICE_URL || "http://localhost:8000";
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "";

const safeKeyMatch = (provided, expected) => {
  const providedBuffer = Buffer.from(String(provided || ""), "utf8");
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");
  if (!providedBuffer.length || !expectedBuffer.length) return false;
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

// Send a request to the face service
const proxyToFaceService = async (endpoint, body) => {
  const url = `${FACE_SERVICE}${endpoint}`;
  auditLog.info("KYC", `Proxying to Python: ${url}`);
  const doRequest = () =>
    axios.post(url, body, {
      headers: { "Content-Type": "application/json" },
      timeout: 60000, // Face checks can take a while
    });
=======
<<<<<<< HEAD
import { verifyFaceMatchWithGemini } from "../services/geminiKyc.service.js";
>>>>>>> 8422a2f (fixed bugs and updates)

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
      throw new Error(`Python face service is not running at ${FACE_SERVICE}. Start it with: python face-service/main.py`);
    }
    if (err.code === "ETIMEDOUT" || err.code === "ECONNABORTED") {
      throw new Error("Face service timed out. The image may be too large or the service is overloaded.");
    }
    throw new Error(detail || "Face service error.");
  }
<<<<<<< HEAD
=======
}
=======
// KYC controller
// Handles logged-in and pre-registration flows
import axios from "axios";
import crypto from "crypto";
import User from "../models/User.js";
import KycVerification from "../models/KycVerification.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import { ensureFaceServiceReady, isFaceServiceConnectionError } from "../utils/faceServiceManager.js";

const FACE_SERVICE = process.env.FACE_SERVICE_URL || "http://localhost:8000";
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "";

const safeKeyMatch = (provided, expected) => {
  const providedBuffer = Buffer.from(String(provided || ""), "utf8");
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");
  if (!providedBuffer.length || !expectedBuffer.length) return false;
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

// Send a request to the face service
const proxyToFaceService = async (endpoint, body) => {
  const url = `${FACE_SERVICE}${endpoint}`;
  auditLog.info("KYC", `Proxying to Python: ${url}`);
  const doRequest = () =>
    axios.post(url, body, {
      headers: { "Content-Type": "application/json" },
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
      throw new Error(`Python face service is not running at ${FACE_SERVICE}. Start it with: python face-service/main.py`);
    }
    if (err.code === "ETIMEDOUT" || err.code === "ECONNABORTED") {
      throw new Error("Face service timed out. The image may be too large or the service is overloaded.");
    }
    throw new Error(detail || "Face service error.");
  }
>>>>>>> 8422a2f (fixed bugs and updates)
};

// Step 1: face quality check
// POST /api/kyc/face/detect
export const faceDetect = async (req, res) => {
  try {
    const { image_base64 } = req.body;
    if (!image_base64) return res.status(400).json({ message: "image_base64 is required" });

    const result = await proxyToFaceService("/api/kyc/face/detect", { image_base64 });
    res.json(result);
  } catch (err) {
    auditLog.error("KYC", "Face detect failed", { detail: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// Step 2: save ID face data
// POST /api/kyc/id-register
export const registerIdFace = async (req, res) => {
  try {
    const { id_image_base64 } = req.body;
    if (!id_image_base64) return res.status(400).json({ message: "id_image_base64 is required" });

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
          remarks: "ID face registered. Awaiting selfie verification.",
          idRegisteredAt: new Date(),
        },
        { upsert: true, new: true }
      );
    }

    res.json(result);
  } catch (err) {
    auditLog.error("KYC", "ID registration failed", { detail: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// Step 3: run the selfie challenge
// POST /api/kyc/selfie/challenge
export const selfieChallenge = async (req, res) => {
  try {
    const { frames_base64 } = req.body;
    if (!frames_base64 || !Array.isArray(frames_base64))
      return res.status(400).json({ message: "frames_base64 array is required" });

    const payload = {
      user_id: req.user._id.toString(),
      frames_base64,
    };

    const result = await proxyToFaceService("/api/kyc/selfie/challenge", payload);

    if (result.passed) {
      await KycVerification.findOneAndUpdate(
        { user: req.user._id },
        { status: "challenge_passed", challengePassedAt: new Date() }
      );
    }

    res.json(result);
  } catch (err) {
    auditLog.error("KYC", "Selfie challenge failed", { detail: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// Step 4: match selfie with ID
// POST /api/kyc/selfie/verify
export const selfieVerify = async (req, res) => {
  try {
    const { challenge_id, selfie_image_base64 } = req.body;
    if (!challenge_id || !selfie_image_base64)
      return res.status(400).json({ message: "challenge_id and selfie_image_base64 are required" });

    const payload = {
      user_id: req.user._id.toString(),
      challenge_id,
      selfie_image_base64,
    };

    const result = await proxyToFaceService("/api/kyc/selfie/verify", payload);
    res.json(result);
  } catch (err) {
    auditLog.error("KYC", "Selfie verify failed", { detail: err.message });
    res.status(500).json({ success: false, message: err.message });
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

    await User.findByIdAndUpdate(user_id, { kycStatus: status });

    await KycVerification.findOneAndUpdate(
      { user: user_id },
      {
        status,
        faceMatchScore: confidence || 0,
        verifiedAt: status === "approved" ? new Date() : undefined,
        remarks:
          status === "approved"
            ? `Face verified with ${confidence}% confidence.`
            : "Face did not match ID photo.",
      }
    );

    res.json({ message: `KYC status updated to ${status} for user ${user_id}` });
  } catch (err) {
    auditLog.error("KYC", "Internal update failed", { detail: err.message });
    res.status(500).json({ message: err.message });
  }
};

// Get the current user's KYC status
// GET /api/kyc/me
export const getMyKyc = async (req, res) => {
  try {
    const kyc = await KycVerification.findOne({ user: req.user._id });
    res.json(kyc || { status: "not_started" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Pre-registration KYC
// Uses email as user_id before the account exists

// Pre-registration ID upload
export const preRegisterIdFace = async (req, res) => {
  try {
    const { email, full_name, role, id_image_base64 } = req.body;

    if (!email || !id_image_base64) {
      return res.status(400).json({ success: false, message: "email and id_image_base64 are required" });
    }

    const payload = {
      user_id: email.toLowerCase().trim(),
      role: role || "user",
      full_name: full_name || "",
      id_image_base64,
    };

    auditLog.info("KYC", `Pre-registration ID register for: ${email}`);
    const result = await proxyToFaceService("/api/kyc/id/register", payload);
    res.json(result);
  } catch (err) {
    auditLog.error("KYC", "Pre-reg ID registration failed", { detail: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// Pre-registration selfie challenge
export const preSelfieChallenge = async (req, res) => {
  try {
    const { email, frames_base64 } = req.body;

    if (!email || !frames_base64 || !Array.isArray(frames_base64)) {
      return res.status(400).json({ success: false, message: "email and frames_base64 array are required" });
    }

    const payload = {
      user_id: email.toLowerCase().trim(),
      frames_base64,
    };

    auditLog.info("KYC", `Pre-registration selfie challenge for: ${email}`);
    const result = await proxyToFaceService("/api/kyc/selfie/challenge", payload);
    res.json(result);
  } catch (err) {
    auditLog.error("KYC", "Pre-reg selfie challenge failed", { detail: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// Pre-registration selfie check
export const preSelfieVerify = async (req, res) => {
  try {
    const { email, challenge_id, selfie_image_base64 } = req.body;

    if (!email || !challenge_id || !selfie_image_base64) {
      return res.status(400).json({ success: false, message: "email, challenge_id, and selfie_image_base64 are required" });
    }

    const payload = {
      user_id: email.toLowerCase().trim(),
      challenge_id,
      selfie_image_base64,
    };

    auditLog.info("KYC", `Pre-registration selfie verify for: ${email}`);
    const result = await proxyToFaceService("/api/kyc/selfie/verify", payload);
    res.json(result);
  } catch (err) {
    auditLog.error("KYC", "Pre-reg selfie verify failed", { detail: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
