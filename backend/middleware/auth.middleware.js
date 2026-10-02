// JWT auth middleware
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { isSessionRevoked } from "../utils/authTokenRevocation.js";
import { auditLog } from "./auditLogger.middleware.js";
import { releaseExpiredModerationSuspension } from "../utils/accountModeration.js";

export const protect = async (req, res, next) => {
  const token = String(req.cookies?.token || "").trim() || null;

  if (!token) {
    return res.status(401).json({ success: false, message: "Please log in." });
  }

  try {
    // jwt.verify also checks expiry
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (await isSessionRevoked(token)) {
      return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
    }
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      auditLog.security("AUTH", "Valid token but user deleted", { userId: decoded.id });
      return res.status(401).json({ success: false, message: "User no longer exists." });
    }

    await releaseExpiredModerationSuspension(user);

    if (Number(decoded.sessionVersion || 0) !== Number(user.sessionVersion || 0)) {
      return res.status(401).json({
        success: false,
        code: "SESSION_REVOKED",
        message: "This session is no longer valid. Please log in again.",
      });
    }

    if (user.isArchived) {
      return res.status(401).json({
        success: false,
        code: "ACCOUNT_ARCHIVED",
        message: "This account has been archived. Contact the RentifyPro administrator.",
      });
    }

    if (user.isDisabled) {
      auditLog.security("AUTH", "Blocked disabled user token", {
        userId: user._id.toString(),
        ip: req.ip,
      });
      return res.status(401).json({
        success: false,
        code: "ACCOUNT_DISABLED",
        message: "This account has been disabled. Contact the RentifyPro administrator.",
      });
    }

    if (!user.isVerified) {
      auditLog.security("AUTH", "Blocked unverified user token", {
        userId: user._id.toString(),
        ip: req.ip,
      });
      return res.status(403).json({
        success: false,
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "Email verification is required before using this resource.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
    }
    if (error.name === "JsonWebTokenError" || error.name === "NotBeforeError") {
      auditLog.security("AUTH", "Bad token", { ip: req.ip });
      return res.status(401).json({ success: false, message: "Invalid token." });
    }
    return next(error);
  }
};
