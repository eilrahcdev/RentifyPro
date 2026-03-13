import PreKycFace from "../models/PreKycFace.js";

export async function isPreKycFaceVerified(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return false;
  const record = await PreKycFace.findOne({ email: normalizedEmail, status: "approved" }).select("status");
  return Boolean(record);
}

export async function clearPreKycFace(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return;
  await PreKycFace.deleteMany({ email: normalizedEmail });
}
