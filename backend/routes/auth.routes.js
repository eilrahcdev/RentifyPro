// Auth routes
import express from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  sendOTP,
  verifyOTP,
  forgotPassword,
  verifyPasswordResetOTP,
  resetPassword,
  getMe,
  updateProfile,
  getLoginChallenge,
  changePassword,
  getNotificationSettings,
  updateNotificationSettings,
  getLoginActivity,
  upgradeToOwner,
} from "../controllers/auth.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { validateRegister, validateLogin } from "../middleware/validate.middleware.js";
import {
  loginLimiter,
  registerLimiter,
  otpLimiter,
} from "../middleware/security.middleware.js";

const router = express.Router();

// Public routes
  router.post("/register", registerLimiter, validateRegister, registerUser);
  router.get("/login-challenge", loginLimiter, getLoginChallenge);
  router.post("/login", loginLimiter, validateLogin, loginUser);
router.post("/send-otp", otpLimiter, sendOTP);
router.post("/verify-otp", otpLimiter, verifyOTP);
router.post("/forgot-password", otpLimiter, forgotPassword);
router.post("/forgot-password/verify-otp", otpLimiter, verifyPasswordResetOTP);
router.post("/reset-password", otpLimiter, resetPassword);

// Protected routes
router.post("/logout", protect, logoutUser);
router.get("/me", protect, getMe);
router.get("/profile", protect, getMe);
router.put("/profile", protect, updateProfile);
router.patch("/change-password", protect, changePassword);
router.get("/notification-settings", protect, getNotificationSettings);
router.put("/notification-settings", protect, updateNotificationSettings);
router.get("/login-activity", protect, getLoginActivity);
router.post("/upgrade-to-owner", protect, upgradeToOwner);

export default router;
