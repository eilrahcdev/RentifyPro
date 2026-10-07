import path from "node:path";
import { isPrivateKycServiceUrl, KYC_SCREENING_PROVIDERS } from "./kycScreeningProvider.js";

const publicHttpsUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      !/^(localhost(?:\.|$)|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i.test(url.hostname) && !/\.localhost$/i.test(url.hostname);
  } catch { return false; }
};
const within = (root, directory) => {
  const relative = path.relative(path.resolve(root), path.resolve(directory));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
export function getProductionConfigurationErrors(env = process.env) {
  const errors = [];
  if (env.NODE_ENV !== "production") errors.push("NODE_ENV must be production.");
  for (const key of ["JWT_SECRET", "INTERNAL_API_KEY"]) {
    if (String(env[key] || "").length < 32 || /changeme|example|<|>/i.test(env[key])) errors.push(`${key} must contain a private, random secret of at least 32 characters.`);
  }
  if (env.PASSWORD_RESET_TOKEN_SECRET && String(env.PASSWORD_RESET_TOKEN_SECRET).length < 32) errors.push("PASSWORD_RESET_TOKEN_SECRET must be at least 32 characters.");
  if (!env.MONGO_URI && !env.MONGO_URI_DIRECT) errors.push("A MongoDB connection URI is required.");
  if (env.MONGO_AUTO_INDEX !== "false") errors.push("MONGO_AUTO_INDEX must be false; use the explicit migrations.");
  for (const key of ["BACKEND_PUBLIC_URL", "FACE_SERVICE_URL", "CHATBOT_URL"]) {
    if (!publicHttpsUrl(env[key])) errors.push(`${key} must be an HTTPS service URL outside localhost.`);
  }
  const origins = String(env.FRONTEND_URL || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!origins.length || origins.some((origin) => {
    try { return origin.includes("*") || !publicHttpsUrl(origin) || new URL(origin).origin !== origin.replace(/\/$/, ""); }
    catch { return true; }
  })) errors.push("FRONTEND_URL must list exact, owned HTTPS origins.");
  if (String(env.ALLOW_VERCEL_PREVIEW_ORIGINS).toLowerCase() === "true") errors.push("Use exact preview origins instead of ALLOW_VERCEL_PREVIEW_ORIGINS in production.");
  for (const key of ["FACE_SERVICE_AUTOSTART", "CHATBOT_SERVICE_AUTOSTART"]) {
    if (env[key] !== "false") errors.push(`${key} must be false for externally hosted services.`);
  }
  if (!/^sk_live_/.test(env.PAYMONGO_SECRET_KEY || "") &&
      !(env.PAYMONGO_ALLOW_TEST_MODE === "true" && /^sk_test_/.test(env.PAYMONGO_SECRET_KEY || ""))) errors.push("Configure a live PayMongo secret key (or explicitly allow test mode on staging).");
  if (!env.PAYMONGO_WEBHOOK_SECRET) errors.push("PAYMONGO_WEBHOOK_SECRET is required for the registered webhook endpoint.");
  if (env.PAYMENT_RECONCILIATION_ENABLED === "false") errors.push("Payment reconciliation must be enabled.");
  if (!["true", "false"].includes(env.GEMINI_SENSITIVE_DATA_APPROVED)) errors.push("Set GEMINI_SENSITIVE_DATA_APPROVED=false for manual KYC review, or true only after confirming the sensitive-data setup.");
  if (env.GEMINI_SENSITIVE_DATA_APPROVED === "true" && !env.GEMINI_API_KEY) errors.push("GEMINI_API_KEY is required when GEMINI_SENSITIVE_DATA_APPROVED=true.");
  if (env.KYC_DOCUMENT_PROVIDER && !KYC_SCREENING_PROVIDERS.includes(env.KYC_DOCUMENT_PROVIDER)) errors.push("KYC_DOCUMENT_PROVIDER must be gemini, private_ocr, or manual.");
  if (env.KYC_DOCUMENT_PROVIDER === "private_ocr") {
    if (!isPrivateKycServiceUrl(env.KYC_PRIVATE_SERVICE_URL, true)) errors.push("KYC_PRIVATE_SERVICE_URL must be an HTTPS URL for your private checker.");
    if (env.KYC_PRIVATE_INTERNAL_API_KEY && (String(env.KYC_PRIVATE_INTERNAL_API_KEY).length < 32
      || /changeme|example|<|>/i.test(env.KYC_PRIVATE_INTERNAL_API_KEY))) errors.push("KYC_PRIVATE_INTERNAL_API_KEY must be a private random secret of at least 32 characters when supplied.");
    if (String(env.KYC_DOCUMENT_FINGERPRINT_SECRET || "").length < 32) errors.push("Private KYC review requires a shared KYC_DOCUMENT_FINGERPRINT_SECRET of at least 32 characters.");
  }
  const root = env.STORAGE_ROOT;
  if (!root || !path.isAbsolute(root) || env.STORAGE_DURABILITY_CONFIRMED !== "true") {
    errors.push("STORAGE_ROOT must point to a mounted persistent volume; confirm it with STORAGE_DURABILITY_CONFIRMED=true.");
  } else {
    const publicDir = env.PUBLIC_UPLOAD_DIR || path.join(root, "uploads");
    const privateDirs = [env.KYC_UPLOAD_DIR || path.join(root, "private_uploads", "kyc"),
      env.REPORT_EVIDENCE_DIR || path.join(root, "private_uploads", "reports"), path.join(root, "private_uploads", "vehicle-images")];
    if (!within(root, publicDir) || privateDirs.some((directory) => !within(root, directory) || within(publicDir, directory) || within(directory, publicDir) || path.resolve(directory) === path.resolve(publicDir))) errors.push("Public and private upload directories must stay separate inside STORAGE_ROOT.");
    if (env.AVATAR_UPLOAD_DIR && !within(publicDir, env.AVATAR_UPLOAD_DIR)) errors.push("AVATAR_UPLOAD_DIR must be inside the public upload directory.");
  }
  return errors;
}
export function assertProductionConfiguration() {
  if (process.env.NODE_ENV !== "production") return;
  const errors = getProductionConfigurationErrors();
  if (errors.length) throw new Error(`Production configuration needs attention:\n${errors.join("\n")}`);
}
