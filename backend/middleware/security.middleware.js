// Security middleware
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import hpp from "hpp";
import helmet from "helmet";

const isProduction = process.env.NODE_ENV === "production";
const rateLimitingEnabled =
  isProduction || String(process.env.ENABLE_RATE_LIMIT || "").trim().toLowerCase() === "true";
const keyByUserOrIp = (req) => (req.user?._id ? `user:${req.user._id}` : `ip:${ipKeyGenerator(req.ip)}`);

// General API limit
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: "Too many requests. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !rateLimitingEnabled,
});

// Auth limit
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => !rateLimitingEnabled,
});

// Stricter login limit
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many login attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => !rateLimitingEnabled,
});

// Register limit
export const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many registration attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => !rateLimitingEnabled,
});

// OTP limit
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many OTP attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => !rateLimitingEnabled,
});

// Logged-in KYC limit
export const kycLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many KYC attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !rateLimitingEnabled,
});

// Pre-registration KYC limit
export const preKycLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, message: "Too many verification attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !rateLimitingEnabled,
});

// Booking create limit
export const bookingCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many booking requests. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  skip: () => !rateLimitingEnabled,
});

// Payment verify limit
export const paymentVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many payment verification requests. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  skip: () => !rateLimitingEnabled,
});

// Security headers
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "http://localhost:5000", "http://localhost:8000", "https://psgc.gitlab.io"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

// Remove unsafe Mongo-style keys
function stripDollarKeys(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripDollarKeys);

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("$")) continue;
    if (key.includes(".")) continue;
    clean[key] = stripDollarKeys(value);
  }
  return clean;
}

export const noSqlSanitize = (req, _res, next) => {
  if (req.body && typeof req.body === "object") {
    req.body = stripDollarKeys(req.body);
  }
  next();
};

// Basic XSS cleanup
function stripXss(value) {
  if (typeof value === "string") {
    if (value.startsWith("data:image") || value.length > 10000) return value;
    return value
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/javascript:/gi, "")
      .replace(/on\w+\s*=/gi, "");
  }
  if (Array.isArray(value)) return value.map(stripXss);
  if (value !== null && typeof value === "object") {
    const clean = {};
    for (const [k, v] of Object.entries(value)) {
      clean[k] = stripXss(v);
    }
    return clean;
  }
  return value;
}

export const xssProtection = (req, _res, next) => {
  if (req.body && typeof req.body === "object") {
    req.body = stripXss(req.body);
  }
  next();
};

// Block duplicate query params
export const parameterPollution = hpp({
  whitelist: ["tags", "features", "status"],
});
