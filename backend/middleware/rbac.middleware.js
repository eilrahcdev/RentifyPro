// Role-based access control
// Example: router.post('/vehicles', protect, authorize('owner', 'admin'), handler)
import { auditLog } from "./auditLogger.middleware.js";
import KycVerification from "../models/KycVerification.js";
import User from "../models/User.js";

const hasDateAtOrAfter = (value, threshold) => {
  const valueTime = new Date(value || 0).getTime();
  const thresholdTime = new Date(threshold || 0).getTime();
  return Number.isFinite(valueTime) && Number.isFinite(thresholdTime) && valueTime >= thresholdTime;
};

const reconcileLegacyOwnerKyc = async (user) => {
  if (!user || user.role !== "owner" || user.kycStatus === "approved") return false;

  const kycCase = await KycVerification.findOne({ user: user._id, status: "approved" })
    .select("updatedAt verifiedAt");
  if (!kycCase) return false;

  const approvedAt = kycCase.updatedAt || kycCase.verifiedAt;
  if (!approvedAt || hasDateAtOrAfter(user.kycStatusUpdatedAt, approvedAt)) return false;

  const result = await User.updateOne(
    {
      _id: user._id,
      $or: [
        { kycStatusUpdatedAt: { $exists: false } },
        { kycStatusUpdatedAt: null },
        { kycStatusUpdatedAt: { $lte: approvedAt } },
      ],
    },
    { $set: { kycStatus: "approved", kycStatusUpdatedAt: approvedAt } }
  );
  if (!result?.matchedCount) return false;

  user.kycStatus = "approved";
  user.kycStatusUpdatedAt = approvedAt;
  auditLog.info("KYC", "Repaired stale approved owner KYC summary", { userId: user._id.toString() });
  return true;
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Please log in." });
    }
    if (!roles.includes(req.user.role)) {
      auditLog.security("RBAC", `Blocked: ${req.user.role} tried ${req.method} ${req.path}`, {
        userId: req.user._id.toString(), ip: req.ip,
      });
      return res.status(403).json({ success: false, message: "You don't have permission for this." });
    }
    next();
  };
};

export const requireKyc = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: "Please log in." });
  if (req.user.role === "admin") return next();
  if (req.user.kycStatus !== "approved") {
    try {
      await reconcileLegacyOwnerKyc(req.user);
    } catch (error) {
      auditLog.error("KYC", "Failed to reconcile owner KYC summary", {
        userId: req.user._id?.toString(),
        detail: error.message,
      });
    }
  }
  if (req.user.kycStatus !== "approved") {
    return res.status(403).json({
      success: false,
      code: "IDENTITY_VERIFICATION_REQUIRED",
      message: "Identity verification is required before using this feature.",
      kycStatus: req.user.kycStatus || "not_started",
    });
  }
  next();
};
