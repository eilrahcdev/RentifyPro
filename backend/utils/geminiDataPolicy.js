export const GEMINI_MANUAL_REVIEW_REASON = "Automated KYC screening is disabled. An administrator must review this document.";

export function isGeminiSensitiveDataAllowed(env = process.env) {
  return env.GEMINI_SENSITIVE_DATA_APPROVED === "true"
    || (env.NODE_ENV !== "production" && env.GEMINI_SENSITIVE_DATA_APPROVED === undefined);
}

export function assertGeminiSensitiveDataAllowed() {
  if (!isGeminiSensitiveDataAllowed()) {
    throw Object.assign(new Error("Sensitive document processing is unavailable until the Gemini billing and data-processing setup is confirmed."),
      { status: 503, code: "GEMINI_DATA_POLICY_UNCONFIRMED", retryable: false });
  }
}
