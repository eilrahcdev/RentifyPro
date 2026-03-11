// KYC routes
import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import {
  faceDetect,
  registerIdFace,
  selfieChallenge,
  selfieVerify,
  internalUpdateStatus,
  getMyKyc,
  preRegisterIdFace,
  preSelfieChallenge,
  preSelfieVerify,
} from "../controllers/kyc.controller.js";
import {
  kycLimiter,
  preKycLimiter,
} from "../middleware/security.middleware.js";

const router = express.Router();

// Logged-in KYC routes
router.post("/face/detect", protect, kycLimiter, faceDetect);
router.post("/id-register", protect, kycLimiter, registerIdFace);
router.post("/selfie/challenge", protect, kycLimiter, selfieChallenge);
router.post("/selfie/verify", protect, kycLimiter, selfieVerify);
router.get("/me", protect, getMyKyc);

// Pre-registration KYC routes
router.post("/pre/id-register", preKycLimiter, preRegisterIdFace);
router.post("/pre/selfie/challenge", preKycLimiter, preSelfieChallenge);
router.post("/pre/selfie/verify", preKycLimiter, preSelfieVerify);

// Internal callback from the Python service
router.patch("/internal/update-status", internalUpdateStatus);

export default router;
