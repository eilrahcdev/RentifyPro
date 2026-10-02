// KYC routes
import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import {
  faceDetect,
  registerIdFace,
  selfieVerify,
  internalUpdateStatus,
  getMyKyc,
  preRegisterIdFace,
  preSelfieVerify,
  preVerifySupportingDocument,
  createPreKycSession,
  listPendingKycReviews,
  getKycReviewFile,
  decideKycReview,
  getPreKycStatus,
} from "../controllers/kyc.controller.js";
import {
  kycLimiter,
  preKycLimiter,
  preKycUploadIpLimiter,
  preKycAttemptLimiter,
  preKycStatusLimiter,
} from "../middleware/security.middleware.js";
import { requirePreKycSession } from "../middleware/preKycSession.middleware.js";
import { authorize } from "../middleware/rbac.middleware.js";
import { validateObjectIdParam } from "../middleware/validate.middleware.js";

const router = express.Router();
// Identity documents, face scores, and verification status must never enter browser/proxy caches.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Pragma", "no-cache");
  next();
});

// Logged-in KYC routes
router.post("/face/detect", protect, kycLimiter, faceDetect);
router.post("/id-register", protect, kycLimiter, registerIdFace);
router.post("/selfie/verify", protect, kycLimiter, selfieVerify);
router.get("/me", protect, getMyKyc);

// Pre-registration KYC routes
router.post("/pre/session", preKycLimiter, createPreKycSession);
router.post("/pre/id-register", preKycUploadIpLimiter, requirePreKycSession, preKycAttemptLimiter, preRegisterIdFace);
router.post("/pre/selfie/verify", preKycUploadIpLimiter, requirePreKycSession, preKycAttemptLimiter, preSelfieVerify);
router.post("/pre/supporting-doc/verify", preKycUploadIpLimiter, requirePreKycSession, preKycAttemptLimiter, preVerifySupportingDocument);
router.get("/pre/status", preKycStatusLimiter, requirePreKycSession, getPreKycStatus);

// Internal callback from the Python service
router.patch("/internal/update-status", internalUpdateStatus);

// Manual review queue for uncertain automated document results.
router.get("/admin/reviews", protect, authorize("admin"), listPendingKycReviews);
router.get("/admin/reviews/:id/file", protect, authorize("admin"), validateObjectIdParam("id"), getKycReviewFile);
router.patch("/admin/reviews/:id", protect, authorize("admin"), validateObjectIdParam("id"), decideKycReview);

export default router;
