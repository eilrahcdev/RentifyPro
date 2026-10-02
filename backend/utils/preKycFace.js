import PreKycFace from "../models/PreKycFace.js";

export async function isPreKycFaceVerified(email, sessionId = "") {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return false;
  const query = { email: normalizedEmail, status: "approved" };
  if (sessionId) query.sessionId = String(sessionId).trim();
  const record = await PreKycFace.findOne(query).select("status");
  return Boolean(record);
}

export async function clearPreKycFace(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return;
  await PreKycFace.deleteMany({ email: normalizedEmail });
}
