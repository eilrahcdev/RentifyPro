export function assertGeminiSensitiveDataAllowed() {
  if (process.env.NODE_ENV === "production" && process.env.GEMINI_SENSITIVE_DATA_APPROVED !== "true") {
    throw Object.assign(new Error("Sensitive document processing is unavailable until the Gemini billing and data-processing setup is confirmed."),
      { status: 503, code: "GEMINI_DATA_POLICY_UNCONFIRMED" });
  }
}
