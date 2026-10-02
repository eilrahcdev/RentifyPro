import PreKycDocument from "../models/PreKycDocument.js";

const SELFIE_READY_DOCUMENT_STATUSES = new Set(["pending_review", "verified"]);

export const isIdentityReadyForSelfie = (document) => document?.docType === "id"
  && document.detailsMatched === true
  && SELFIE_READY_DOCUMENT_STATUSES.has(document.status);

export const isVerifiedPreKycDocument = (document) => document?.status === "verified"
  && (document.docType !== "id" || document.detailsMatched === true);

const normalizeIdentityText = (value) => String(value || "")
  .normalize("NFKC")
  .trim()
  .toLocaleLowerCase("en")
  .replace(/\s+/g, " ");

const SCREENING_PROFILE_FIELDS = ["full_name", "first_name", "last_name", "date_of_birth", "business_name", "permit_number", "tax_identification_number", "branch_code"];

export const screeningProfileMatchesSnapshot = (previous = {}, next = {}) =>
  SCREENING_PROFILE_FIELDS.every((field) => normalizeIdentityText(previous?.[field]) === normalizeIdentityText(next?.[field]));

export const supportingProfileMatchesSnapshot = (snapshot = {}, profile = {}) =>
  ["business_name", "permit_number", "tax_identification_number", "branch_code"].every((field) =>
    normalizeIdentityText(snapshot?.[field]) === normalizeIdentityText(profile?.[field]));

export const identityProfileMatchesSnapshot = (snapshot = {}, profile = {}, { requireBirthDate = true } = {}) => {
  const expectedName = normalizeIdentityText(snapshot.full_name);
  const submittedName = normalizeIdentityText(profile.full_name);
  if (!expectedName || !submittedName || expectedName !== submittedName) return false;
  if (!requireBirthDate) return true;
  const expectedBirthDate = String(snapshot.date_of_birth || "").trim();
  const submittedBirthDate = String(profile.date_of_birth || "").trim();
  return Boolean(expectedBirthDate && submittedBirthDate && expectedBirthDate === submittedBirthDate);
};

export async function preKycIdentityMatchesRegistration(email, sessionId, profile, options = {}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedEmail || !normalizedSessionId) return false;
  const document = await PreKycDocument.findOne({
    email: normalizedEmail,
    sessionId: normalizedSessionId,
    docType: "id",
    status: "verified",
    detailsMatched: true,
  }).select("docType status detailsMatched +profileSnapshot");
  return isVerifiedPreKycDocument(document)
    && identityProfileMatchesSnapshot(document.profileSnapshot, profile, options);
}

export async function preKycSupportingMatchesRegistration(email, sessionId, profile) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedEmail || !normalizedSessionId) return false;
  const document = await PreKycDocument.findOne({
    email: normalizedEmail,
    sessionId: normalizedSessionId,
    docType: "supporting",
    status: "verified",
  }).select("docType status +profileSnapshot");
  return isVerifiedPreKycDocument(document)
    && supportingProfileMatchesSnapshot(document.profileSnapshot, profile);
}

export async function getMissingPreKycDocs(email, requiredDocs = [], sessionId = "") {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || requiredDocs.length === 0) return requiredDocs;

  const query = {
    email: normalizedEmail,
    docType: { $in: requiredDocs },
    status: "verified",
  };
  if (sessionId) query.sessionId = String(sessionId).trim();

  const verifiedDocs = await PreKycDocument.find(query).select("docType status detailsMatched");

  const verifiedSet = new Set(verifiedDocs.filter(isVerifiedPreKycDocument).map((doc) => doc.docType));
  return requiredDocs.filter((docType) => !verifiedSet.has(docType));
}

export async function getPendingPreKycDocs(email, requiredDocs = [], sessionId = "") {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || requiredDocs.length === 0) return [];
  const query = {
    email: normalizedEmail,
    docType: { $in: requiredDocs },
    status: { $in: ["queued", "processing", "retry_wait", "pending_review"] },
  };
  if (sessionId) query.sessionId = String(sessionId).trim();
  const pendingDocs = await PreKycDocument.find(query).select("docType");
  return pendingDocs.map((doc) => doc.docType);
}

export async function getActionRequiredPreKycDocs(email, requiredDocs = [], sessionId = "") {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || requiredDocs.length === 0) return [];
  const query = {
    email: normalizedEmail,
    docType: { $in: requiredDocs },
    status: { $in: ["reupload_required", "rejected"] },
  };
  if (sessionId) query.sessionId = String(sessionId).trim();
  return PreKycDocument.find(query).select("docType status reason");
}

export async function clearPreKycDocs(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return;
  await PreKycDocument.deleteMany({ email: normalizedEmail });
}
