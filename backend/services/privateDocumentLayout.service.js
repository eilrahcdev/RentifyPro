import crypto from "node:crypto";
import { resolveSupportedDocumentType } from "./documentValidation.service.js";

export const PRIVATE_AUTOMATED_CHECK_VERSION = 2;
const PROFILE_FIELDS = ["full_name", "first_name", "last_name", "date_of_birth", "birth_date", "business_name", "permit_number", "tax_identification_number", "branch_code"];

export function privateScreeningBinding({ profile = {}, sessionId = "", role = "", docType, selectedDocType }) {
  const secret = String(process.env.KYC_DOCUMENT_FINGERPRINT_SECRET || "").trim();
  if (secret.length < 32 || !sessionId) return "";
  const values = PROFILE_FIELDS.map((key) => String(profile[key] || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "));
  return crypto.createHmac("sha256", secret).update(JSON.stringify([PRIVATE_AUTOMATED_CHECK_VERSION,
    sessionId, role, docType, resolveSupportedDocumentType(selectedDocType, docType), values])).digest("hex");
}

export function hasCurrentPrivateAutomatedMatch(document) {
  const result = document?.privateScreening?.automatedCheck;
  const type = document?.privateScreening?.typeCheck;
  const selected = resolveSupportedDocumentType(document?.selectedDocCategory, document?.docType);
  const configuredMinimum = Number(process.env.KYC_DOCUMENT_CLASSIFICATION_MIN_CONFIDENCE);
  const minimum = Number.isFinite(configuredMinimum) ? Math.max(90, configuredMinimum) : 90;
  const binding = privateScreeningBinding({ profile: document?.profileSnapshot, sessionId: document?.sessionId,
    role: document?.role, docType: document?.docType, selectedDocType: selected });
  return Boolean(document?.provider === "private-ocr" && document.status === "pending_review"
    && (!document.expiresAt || new Date(document.expiresAt) > new Date())
    && !document.suspectedTampering && document.fileHash && document.reviewVersion && binding
    && result?.version === PRIVATE_AUTOMATED_CHECK_VERSION && result.outcome === "passed"
    && result.fileHash === document.fileHash && result.reviewVersion === document.reviewVersion && result.profileBinding === binding
    && selected && type?.fileHash === document.fileHash && type.reviewVersion === document.reviewVersion
    && type.selectedType === selected && type.documentTypeMatches === true && type.classificationConfident === true
    && type.classificationConfidence >= minimum && type.detectedTypes?.length === 1 && type.detectedTypes[0] === selected
    && ["documentType", "requiredFields", "validity", "registrationDetails"].every((key) => result.checks?.[key] === true)
    && Object.values(result.fieldConfidence || {}).length > 0
    && Object.values(result.fieldConfidence).every((value) => Number.isFinite(value) && value >= 90));
}

export function strictPrivateBusinessNameMatch(expected, actual) {
  const normalize = (value) => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  const left = normalize(expected), right = normalize(actual);
  return Boolean(left && right && left === right);
}

export function strictPrivateIdentityNameMatch(profile, actual) {
  const tokens = (value) => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}]+/gu, " ").trim().split(/\s+/).filter((token) => token && !["jr", "sr", "ii", "iii", "iv"].includes(token));
  const first = tokens(profile.first_name || profile.firstName).join("");
  const last = tokens(profile.last_name || profile.lastName).join("");
  const name = tokens(actual).join("");
  return Boolean(first.length >= 2 && last.length >= 2 && name.length >= first.length + last.length
    && ((name.startsWith(first) && name.endsWith(last)) || (name.startsWith(last) && name.endsWith(first))));
}

export function publicPrivateScreening(document) {
  const screening = document.privateScreening?.automatedCheck;
  if (!screening || ![1, PRIVATE_AUTOMATED_CHECK_VERSION].includes(screening.version) || screening.fileHash !== document.fileHash
    || screening.reviewVersion !== (document.reviewVersion || document.fileHash)
    || !["passed", "correction_needed", "review_needed"].includes(screening.outcome)) return null;
  const checks = {};
  for (const name of ["documentType", "issuingCountry", "layout", "requiredFields", "validity", "registrationDetails"])
    checks[name] = typeof screening.checks?.[name] === "boolean" ? screening.checks[name] : null;
  return { outcome: screening.outcome, checks,
    mismatchFields: (Array.isArray(screening.mismatchFields) ? screening.mismatchFields : [])
      .filter((field) => ["Name", "Date of birth", "Registered name", "Permit or registration number", "TIN or branch code"].includes(field)),
  };
}
