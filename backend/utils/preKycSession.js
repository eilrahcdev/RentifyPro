import crypto from "crypto";
import jwt from "jsonwebtoken";

const PRE_KYC_PURPOSE = "pre-kyc";
const DEFAULT_TTL = "20m";

const normalizeEmail = (value = "") => String(value || "").trim().toLowerCase();
const normalizeRole = (value = "") => (String(value || "").trim().toLowerCase() === "owner" ? "owner" : "user");

const getSecret = () => {
  const secret = String(process.env.PRE_KYC_SESSION_SECRET || process.env.JWT_SECRET || "").trim();
  if (!secret) throw new Error("PRE_KYC_SESSION_SECRET or JWT_SECRET must be configured.");
  return secret;
};

export const issuePreKycSession = ({
  email,
  role,
  sessionId: existingSessionId = "",
  originIat: existingOriginIat = 0,
}) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("Email is required.");

  const sessionId = String(existingSessionId || "").trim() || crypto.randomUUID();
  const originIat = Number(existingOriginIat) || Math.floor(Date.now() / 1000);
  const normalizedRole = normalizeRole(role);
  const token = jwt.sign(
    {
      purpose: PRE_KYC_PURPOSE,
      email: normalizedEmail,
      role: normalizedRole,
      sessionId,
      originIat,
    },
    getSecret(),
    {
      expiresIn: process.env.PRE_KYC_SESSION_TTL || DEFAULT_TTL,
      jwtid: sessionId,
    }
  );

  return { token, email: normalizedEmail, role: normalizedRole, sessionId };
};

export const renewPreKycSession = (token, { email, role } = {}) => {
  const rawToken = String(token || "").trim();
  let decoded;
  try {
    decoded = jwt.verify(rawToken, getSecret(), { ignoreExpiration: true });
  } catch (cause) {
    const error = new Error("Verification session is invalid. Please restart document verification.");
    error.status = 401;
    error.cause = cause;
    throw error;
  }

  const configuredMaxRenewalHours = Number(process.env.PRE_KYC_SESSION_MAX_RENEWAL_HOURS || 72);
  const maxRenewalHours = Number.isFinite(configuredMaxRenewalHours)
    ? Math.max(1, configuredMaxRenewalHours)
    : 72;
  const issuedAtMs = Number(decoded?.originIat || decoded?.iat || 0) * 1000;
  if (!issuedAtMs || Date.now() - issuedAtMs > maxRenewalHours * 60 * 60 * 1000) {
    const error = new Error("Verification session is too old. Please restart document verification.");
    error.status = 401;
    throw error;
  }

  const session = verifyPreKycSessionClaims(decoded, { email, role });
  return issuePreKycSession(session);
};

const verifyPreKycSessionClaims = (decoded, { email, role } = {}) => {
  const normalizedEmail = normalizeEmail(decoded?.email);
  const normalizedRole = normalizeRole(decoded?.role);
  const sessionId = String(decoded?.sessionId || decoded?.jti || "").trim();
  if (decoded?.purpose !== PRE_KYC_PURPOSE || !normalizedEmail || !sessionId) {
    const error = new Error("Verification session is invalid. Please restart document verification.");
    error.status = 401;
    throw error;
  }

  if (email && normalizeEmail(email) !== normalizedEmail) {
    const error = new Error("Verification session does not match this email address.");
    error.status = 403;
    throw error;
  }
  if (role && normalizeRole(role) !== normalizedRole) {
    const error = new Error("Verification session does not match this account type.");
    error.status = 403;
    throw error;
  }
  return {
    email: normalizedEmail,
    role: normalizedRole,
    sessionId,
    originIat: Number(decoded?.originIat || decoded?.iat || 0),
  };
};

export const verifyPreKycSession = (token, { email, role } = {}) => {
  const rawToken = String(token || "").trim();
  if (!rawToken) {
    const error = new Error("Verification session is missing. Please restart document verification.");
    error.status = 401;
    throw error;
  }

  let decoded;
  try {
    decoded = jwt.verify(rawToken, getSecret());
  } catch (cause) {
    const error = new Error("Verification session expired or is invalid. Please restart document verification.");
    error.status = 401;
    error.cause = cause;
    throw error;
  }

  return { ...verifyPreKycSessionClaims(decoded, { email, role }), token: rawToken };
};

export const getPreKycTokenFromRequest = (req) =>
  String(req.headers?.["x-pre-kyc-token"] || req.body?.preKycToken || "").trim();
