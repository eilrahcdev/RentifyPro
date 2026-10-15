import {
  getPreKycTokenFromRequest,
  verifyPreKycSession,
} from "../utils/preKycSession.js";
import { auditLog } from "./auditLogger.middleware.js";
import { assertActiveRegistrationDraft, isDraftEmailVerified } from "../utils/registrationDraft.js";
import User from "../models/User.js";

export const requirePreKycSession = async (req, res, next) => {
  try {
    const requestBody = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : {};
    const session = verifyPreKycSession(getPreKycTokenFromRequest(req), {
      email: requestBody.email,
      role: requestBody.role,
    });
    const draft = session.draftId ? await assertActiveRegistrationDraft(session) : null;
    req.registrationDraft = draft;
    req.preKyc = { ...session, email: draft?.evidenceEmail || session.email };
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

export const requireRegistrationEmail = async (req, res, next) => {
  if (!isDraftEmailVerified(req.registrationDraft)) return res.status(403).json({ success: false,
    code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email in Step 4 before uploading documents or taking your selfie." });
  if (req.registrationDraft.registeredUser || req.registrationDraft.submissionDocuments || new Date(req.registrationDraft.submissionUntil || 0) > new Date())
    return res.status(409).json({ success: false, message: "Account creation is in progress or complete. Recover your registration." });
  try {
    const emails = [req.registrationDraft.verifiedEmail, req.registrationDraft.evidenceEmail].filter(Boolean);
    if (await User.exists({ email: { $in: emails } })) return res.status(409).json({ success: false,
      message: "These registration details belong to an existing account. Sign in to manage its verification." });
  } catch (error) {
    auditLog.error("KYC", "Registration account check failed", { errorType: error.name });
    return res.status(503).json({ success: false, message: "We couldn't check your registration right now. Please retry." });
  }
  next();
};
