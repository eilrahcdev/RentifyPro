<<<<<<< HEAD
// Auth routes
=======
<<<<<<< HEAD
=======
// Auth routes
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
import express from "express";
import {
  registerUser,
  loginUser,
<<<<<<< HEAD
  logoutUser,
=======
<<<<<<< HEAD
>>>>>>> 8422a2f (fixed bugs and updates)
  sendOTP,
  verifyOTP,
  forgotPassword,
  verifyPasswordResetOTP,
  resetPassword,
  getMe,
  updateProfile,
} from "../controllers/auth.controller.js";
<<<<<<< HEAD
=======
=======
  logoutUser,
  sendOTP,
  verifyOTP,
  forgotPassword,
  verifyPasswordResetOTP,
  resetPassword,
  getMe,
  updateProfile,
} from "../controllers/auth.controller.js";
>>>>>>> 8422a2f (fixed bugs and updates)
import { protect } from "../middleware/auth.middleware.js";
import { validateRegister, validateLogin } from "../middleware/validate.middleware.js";
import {
  loginLimiter,
  registerLimiter,
  otpLimiter,
} from "../middleware/security.middleware.js";
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)

const router = express.Router();

// Public routes
<<<<<<< HEAD
router.post("/register", registerLimiter, validateRegister, registerUser);
router.post("/login", loginLimiter, validateLogin, loginUser);
router.post("/send-otp", otpLimiter, sendOTP);
router.post("/verify-otp", otpLimiter, verifyOTP);
router.post("/forgot-password", otpLimiter, forgotPassword);
router.post("/forgot-password/verify-otp", otpLimiter, verifyPasswordResetOTP);
router.post("/reset-password", otpLimiter, resetPassword);

=======
<<<<<<< HEAD
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/send-otp", sendOTP);
router.post("/verify-otp", verifyOTP);

export default router;
=======
router.post("/register", registerLimiter, validateRegister, registerUser);
router.post("/login", loginLimiter, validateLogin, loginUser);
router.post("/send-otp", otpLimiter, sendOTP);
router.post("/verify-otp", otpLimiter, verifyOTP);
router.post("/forgot-password", otpLimiter, forgotPassword);
router.post("/forgot-password/verify-otp", otpLimiter, verifyPasswordResetOTP);
router.post("/reset-password", otpLimiter, resetPassword);

>>>>>>> 8422a2f (fixed bugs and updates)
// Protected routes
router.post("/logout", protect, logoutUser);
router.get("/me", protect, getMe);
router.get("/profile", protect, getMe);
router.put("/profile", protect, updateProfile);

export default router;
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
