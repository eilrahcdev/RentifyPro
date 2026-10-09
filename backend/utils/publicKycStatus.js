import { publicReverification } from "../services/kycReverification.service.js";

const messages = {
  not_started: "Complete ID and selfie verification before requesting a rental.",
  id_uploaded: "Your ID was uploaded. Complete your selfie verification next.",
  challenge_passed: "Your selfie matched. Document approval is still pending.",
  approved: "Your identity is verified. You can request a rental.",
  rejected: "Your identity verification needs another attempt. Upload a clear, matching ID and take a new selfie.",
};

export function publicKycStatus(kyc, user) {
  let status = kyc?.status || user?.kycStatus || "not_started";
  if (status === "approved" && user && user.kycStatus !== "approved") status = user.kycStatus || "not_started";
  const correction = status === "rejected" ? String(kyc?.remarks || "").split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/confidence|\d+(?:\.\d+)?\s*%/i.test(sentence)).join(" ").trim() : "";
  return {
    status,
    remarks: correction || messages[status] || messages.not_started,
    verifiedAt: status === "approved" ? kyc?.verifiedAt || null : null,
    lastFaceReverifiedAt: kyc?.lastFaceReverifiedAt || null,
    reverification: publicReverification(kyc),
  };
}
