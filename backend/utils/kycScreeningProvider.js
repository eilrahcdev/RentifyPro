import { assertGeminiSensitiveDataAllowed, isGeminiSensitiveDataAllowed } from "./geminiDataPolicy.js";

export const KYC_SCREENING_PROVIDERS = ["gemini", "private_ocr", "manual"];

export const getKycScreeningProvider = (env = process.env) =>
  String(env.KYC_DOCUMENT_PROVIDER || "gemini").trim();

export const getPrivateKycInternalKey = (env = process.env) =>
  String(env.KYC_PRIVATE_INTERNAL_API_KEY || env.INTERNAL_API_KEY || "");

export const isKycScreeningEnabled = (env = process.env) => {
  const provider = getKycScreeningProvider(env);
  return provider === "private_ocr" || (provider === "gemini" && isGeminiSensitiveDataAllowed(env));
};

export const isPrivateKycServiceUrl = (value, production = false) => {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === "https:") return true;
    return !production && url.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
};

export function assertKycScreeningAvailable(provider = getKycScreeningProvider()) {
  if (provider !== getKycScreeningProvider()) {
    throw Object.assign(new Error("Document screening configuration changed. An administrator must review this document."),
      { code: "KYC_SCREENING_DISABLED", retryable: false });
  }
  if (provider === "gemini") return assertGeminiSensitiveDataAllowed();
  if (provider === "private_ocr"
    && isPrivateKycServiceUrl(process.env.KYC_PRIVATE_SERVICE_URL, process.env.NODE_ENV === "production")
    && getPrivateKycInternalKey().length >= 32) return;
  throw Object.assign(new Error("Private document screening is unavailable. An administrator must review this document."),
    { code: "KYC_SCREENING_DISABLED", retryable: false });
}
