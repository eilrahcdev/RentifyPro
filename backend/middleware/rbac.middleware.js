// Role-based access control
// Example: router.post('/vehicles', protect, authorize('owner', 'admin'), handler)
import { auditLog } from "./auditLogger.middleware.js";

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

export const requireKyc = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: "Please log in." });
  if (req.user.kycStatus !== "approved") {
    return res.status(403).json({ success: false, message: "KYC verification required." });
  }
  next();
};
