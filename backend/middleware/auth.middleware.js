<<<<<<< HEAD
// JWT auth middleware
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { isTokenBlacklisted } from "../controllers/auth.controller.js";
import { auditLog } from "./auditLogger.middleware.js";
=======
<<<<<<< HEAD
import express from "express";
import {
  registerUser,
  loginUser,
  sendOTP,
  verifyOTP,
  getProfile,
  updateProfile,
} from "../controllers/auth.controller.js";
import { protect } from "../middleware/auth.middleware.js";
>>>>>>> 8422a2f (fixed bugs and updates)

export const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer") ? authHeader.split(" ")[1] : null;
  const cookieToken = String(req.cookies?.token || "").trim();
  const token = bearerToken || cookieToken || null;

  if (!token) {
    return res.status(401).json({ success: false, message: "Please log in." });
  }

  // Block tokens that were logged out
  if (isTokenBlacklisted(token)) {
    return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
  }

<<<<<<< HEAD
=======
export default router;
=======
// JWT auth middleware
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { isTokenBlacklisted } from "../controllers/auth.controller.js";
import { auditLog } from "./auditLogger.middleware.js";

export const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer") ? authHeader.split(" ")[1] : null;
  const cookieToken = String(req.cookies?.token || "").trim();
  const token = bearerToken || cookieToken || null;

  if (!token) {
    return res.status(401).json({ success: false, message: "Please log in." });
  }

  // Block tokens that were logged out
  if (isTokenBlacklisted(token)) {
    return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
  }

>>>>>>> 8422a2f (fixed bugs and updates)
  try {
    // jwt.verify also checks expiry
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      auditLog.security("AUTH", "Valid token but user deleted", { userId: decoded.id });
      return res.status(401).json({ success: false, message: "User no longer exists." });
    }

    if (!user.isVerified) {
      auditLog.security("AUTH", "Blocked unverified user token", {
        userId: user._id.toString(),
        ip: req.ip,
      });
      return res.status(403).json({
        success: false,
        message: "Email verification is required before using this resource.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
    }
    auditLog.security("AUTH", "Bad token", { ip: req.ip });
    return res.status(401).json({ success: false, message: "Invalid token." });
  }
};
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
