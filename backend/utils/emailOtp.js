import crypto from "node:crypto";

export const OTP_EXPIRY_MS = 5 * 60 * 1000;
export const createOtpCode = () => String(crypto.randomInt(100000, 1000000));
export const otpCooldownSeconds = () => {
  const configured = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 45);
  return Number.isFinite(configured) ? Math.max(45, configured) : 45;
};
export function registrationOtpHash(draft, code) {
  const secret = process.env.PRE_KYC_SESSION_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("Verification configuration is unavailable.");
  return crypto.createHmac("sha256", secret).update(JSON.stringify([draft._id, draft.sessionId,
    draft.fields[draft.role === "owner" ? "businessEmail" : "email"].trim().toLowerCase(), code])).digest("hex");
}
