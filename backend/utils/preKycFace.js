import PreKycFace from "../models/PreKycFace.js";
import PreKycDocument from "../models/PreKycDocument.js";
import { isIdentityReadyForSelfie } from "./preKycDocs.js";

export function isBoundPreKycFace(face, document, now = Date.now()) {
  if (document?.selfieVerification) face = { ...document.selfieVerification,
    email: document.email, role: document.role, sessionId: document.sessionId };
  return Boolean(face && document && face.status === "approved" && face.sessionId === document.sessionId
    && face.role === document.role && face.email === document.email
    && face.idDocumentHash && face.idDocumentHash === document.fileHash
    && face.idDocumentRevision && face.idDocumentRevision === document.reviewVersion
    && new Date(face.expiresAt).getTime() > now && new Date(document.expiresAt).getTime() > now
    && isIdentityReadyForSelfie(document));
}

export async function isPreKycFaceVerified(email, sessionId = "") {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return false;
  const query = { email: normalizedEmail, status: "approved" };
  if (sessionId) query.sessionId = String(sessionId).trim();
  const document = await PreKycDocument.findOne({ email: normalizedEmail, sessionId, docType: "id" })
    .select("email role sessionId docType status detailsMatched provider validationChecks manualComparison privateScreening fileHash reviewVersion selfieVerification expiresAt +profileSnapshot").lean();
  if (document?.selfieVerification) return isBoundPreKycFace(null, document);
  const record = await PreKycFace.findOne(query).lean();
  return isBoundPreKycFace(record, document);
}

export async function clearPreKycFace(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return;
  await PreKycFace.deleteMany({ email: normalizedEmail });
}
