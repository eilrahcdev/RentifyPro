import {
  getPreKycTokenFromRequest,
  verifyPreKycSession,
} from "../utils/preKycSession.js";
import { auditLog } from "./auditLogger.middleware.js";

export const requirePreKycSession = (req, res, next) => {
  try {
    const requestBody = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : {};
    const session = verifyPreKycSession(getPreKycTokenFromRequest(req), {
      email: requestBody.email,
      role: requestBody.role,
    });
    req.preKyc = session;
    req.body = {
      ...requestBody,
      email: session.email,
      role: session.role,
    };
    next();
  } catch (error) {
    const exposedStatus = Number(error?.status);
    const status = exposedStatus >= 400 && exposedStatus < 500 ? exposedStatus : 500;
    if (status >= 500) {
      auditLog.error("KYC", "Pre-KYC session validation failed", {
        detail: String(error?.stack || error?.message || error || "Unknown error"),
      });
    }
    return res.status(status).json({
      success: false,
      message: status < 500
        ? String(error?.message || "Verification session is invalid.")
        : "We couldn't check your verification session right now. Please try again.",
    });
  }
};
