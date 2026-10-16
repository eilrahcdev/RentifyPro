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
  requestRegistrationReview,
  registerReverificationId,
  verifyReverificationSelfie,
  cancelReverification,
  replaceAccountDocument,
} from "../controllers/kyc.controller.js";
import {
  kycLimiter,
  preKycLimiter,
  preKycUploadIpLimiter,
  preKycAttemptLimiter,
  preKycStatusLimiter,
  preKycStatusIpLimiter,
  otpLimiter,
} from "../middleware/security.middleware.js";
import { requirePreKycSession, requireRegistrationEmail } from "../middleware/preKycSession.middleware.js";
import { lockRegistrationEvidence } from "../middleware/registrationEvidence.middleware.js";
import { authorize, requireKyc } from "../middleware/rbac.middleware.js";
import { validateObjectIdParam } from "../middleware/validate.middleware.js";
import { registrationDraftGuard, registrationDraftLimiter, getRegistrationDraft, saveRegistrationDraft,
  deleteRegistrationDraft, sendRegistrationOtp, verifyRegistrationOtp, registrationOtpSendLimiter } from "../controllers/registrationDraft.controller.js";

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
router.post("/documents/:docType", protect, authorize("user", "owner"), kycLimiter, replaceAccountDocument);
router.post("/reverify/id-register", protect, kycLimiter, requireKyc, registerReverificationId);
router.post("/reverify/selfie/verify", protect, kycLimiter, requireKyc, verifyReverificationSelfie);
router.post("/reverify/cancel", protect, kycLimiter, cancelReverification);

// Pre-registration KYC routes
router.get("/pre/draft", registrationDraftLimiter, registrationDraftGuard, getRegistrationDraft);
router.post("/pre/draft", registrationDraftLimiter, registrationDraftGuard, saveRegistrationDraft);
router.delete("/pre/draft", registrationDraftLimiter, registrationDraftGuard, deleteRegistrationDraft);
router.post("/pre/draft/otp/send", registrationDraftLimiter, registrationDraftGuard, registrationOtpSendLimiter, otpLimiter, sendRegistrationOtp);
router.post("/pre/draft/otp/verify", registrationDraftLimiter, registrationDraftGuard, otpLimiter, verifyRegistrationOtp);
router.post("/pre/session", preKycLimiter, createPreKycSession);
router.post("/pre/id-register", preKycUploadIpLimiter, requirePreKycSession, requireRegistrationEmail, preKycAttemptLimiter, lockRegistrationEvidence, preRegisterIdFace);
router.post("/pre/selfie/verify", preKycUploadIpLimiter, requirePreKycSession, requireRegistrationEmail, preKycAttemptLimiter, lockRegistrationEvidence, preSelfieVerify);
router.post("/pre/manual-review", preKycUploadIpLimiter, requirePreKycSession, requireRegistrationEmail, preKycAttemptLimiter, lockRegistrationEvidence, requestRegistrationReview);
const requireSupportingEmail = (req, res, next) => {
  if (req.registrationDraft || req.preKyc?.role !== "owner" || !req.cookies?.token) return requireRegistrationEmail(req, res, next);
  return protect(req, res, () => {
    if (req.user.role !== "user" || req.user.email !== req.preKyc.email) return res.status(403).json({ success: false, message: "Use your signed-in account's document session." });
    return requireKyc(req, res, next);
  });
};
router.post("/pre/supporting-doc/verify", preKycUploadIpLimiter, requirePreKycSession, requireSupportingEmail, preKycAttemptLimiter, lockRegistrationEvidence, preVerifySupportingDocument);
router.get("/pre/status", preKycStatusIpLimiter, requirePreKycSession, preKycStatusLimiter, getPreKycStatus);

// Internal callback from the Python service
router.patch("/internal/update-status", internalUpdateStatus);

// Manual review queue for uncertain automated document results.
router.get("/admin/reviews", protect, authorize("admin"), listPendingKycReviews);
router.get("/admin/reviews/:id/file", protect, authorize("admin"), validateObjectIdParam("id"), getKycReviewFile);
router.patch("/admin/reviews/:id", protect, authorize("admin"), validateObjectIdParam("id"), decideKycReview);

export default router;
