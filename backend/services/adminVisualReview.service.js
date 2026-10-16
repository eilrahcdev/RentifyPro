import { assertStoredPrivateDocumentType, canManuallyCompareDocument } from "../data/private-kyc/services/manualDocumentComparison.js";
import { createDocumentFingerprint, isBirSupportingDocumentType, resolveSupportedDocumentType } from "../data/private-kyc/services/documentValidation.service.js";
import { PRIVATE_DOCUMENT_TYPE_CHECK_VERSION } from "../data/private-kyc/services/privateDocumentExtraction.service.js";
import { readPrivateKycEvidence } from "../data/private-kyc/services/privateKycReviewContext.js";
import { currentIdentifierFingerprint, identifierScreeningSummary, assertIdentifierScreeningSettled,
  assertIdentifierInspectionCurrent } from "./adminIdentifierScreening.service.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
const requiredConfirmations = ["documentInspected", "registrationDetailsMatch", "currentlyValid"];

function registrationProfile(document) {
  const profile = {};
  for (const key of ["first_name", "last_name", "full_name", "date_of_birth", "business_name", "permit_number", "tax_identification_number", "branch_code"]) {
    const value = document.profileSnapshot?.[key];
    if (typeof value === "string" && value.trim()) profile[key] = value.trim().slice(0, 200);
  }
  const namePresent = Boolean(profile.full_name || (profile.first_name && profile.last_name));
  const type = resolveSupportedDocumentType(document.selectedDocCategory, document.docType);
  const birthDate = profile.date_of_birth;
  const validBirthDate = birthDate && /^\d{4}-\d{2}-\d{2}$/.test(birthDate)
    && Number.isFinite(new Date(`${birthDate}T00:00:00Z`).getTime())
    && new Date(`${birthDate}T00:00:00Z`).toISOString().slice(0, 10) === birthDate;
  const complete = document.docType === "id" ? namePresent && Boolean(validBirthDate)
    : Boolean((profile.business_name || namePresent) && (isBirSupportingDocumentType(type)
      ? profile.tax_identification_number && profile.branch_code : type === "Barangay Business Clearance" || profile.permit_number));
  if (!type || !complete) throw fail(409, "Required registration details are missing. Ask the applicant to correct their registration before approving.");
  return profile;
}

export async function getAdminVisualReviewContext(document, directory) {
  if (!canManuallyCompareDocument(document)) throw fail(409, "This document is not awaiting manual review.");
  await readPrivateKycEvidence(document, directory);
  const profile = registrationProfile(document);
  const identifierAvailable = Boolean(currentIdentifierFingerprint(document) || (document.docType === "supporting"
    && (profile.permit_number || (profile.tax_identification_number && profile.branch_code))));
  return { profile, fileHash: document.fileHash, reviewVersion: document.reviewVersion || document.fileHash,
    reviewMode: "visual", identifierDuplicateCheck: identifierAvailable ? "available" : "file_hash_only",
    identifierScreening: identifierScreeningSummary(document) };
}

export function prepareAdminVisualReview(document, input, reviewerId, now = new Date()) {
  if (!canManuallyCompareDocument(document)) throw fail(409, "This document is not awaiting manual review.");
  assertIdentifierScreeningSettled(document);
  assertIdentifierInspectionCurrent(document, input);
  if (!document.fileHash || input?.fileHash !== document.fileHash || !input.reviewVersion
    || input.reviewVersion !== (document.reviewVersion || document.fileHash)) throw fail(409, "The document changed. Refresh and inspect the current original.");
  if (requiredConfirmations.some(key => input.confirmations?.[key] !== true)) {
    throw fail(400, "Inspect the original, compare the registration details, and confirm its validity before approving.");
  }
  const remarks = String(input.remarks || "").trim();
  if (remarks.length < 10 || remarks.length > 500) throw fail(400, "Record your inspection findings using 10 to 500 characters.");
  const type = resolveSupportedDocumentType(document.selectedDocCategory, document.docType);
  if (!type || type !== resolveSupportedDocumentType(input.documentType, document.docType)) throw fail(409, "The document type must match the selected type.");
  assertStoredPrivateDocumentType(document);
  if (document.suspectedTampering || document.validationChecks?.suspectedTampering === true) {
    throw fail(409, "This document is flagged for possible alteration. Investigate or request a replacement before approving.");
  }
  const automated = document.privateScreening?.automatedCheck;
  if (document.validationChecks?.documentNotExpired === false || document.reasonCode === "DOCUMENT_EXPIRED"
    || (automated?.fileHash === document.fileHash && automated.reviewVersion === (document.reviewVersion || document.fileHash)
      && automated.checks?.validity === false)) throw fail(409, "The stored validity check failed. Ask for a current, valid replacement document.");
  const profile = registrationProfile(document);
  if (String(process.env.KYC_DOCUMENT_FINGERPRINT_SECRET || "").trim().length < 32) throw fail(503, "The shared document-fingerprint secret must be configured before review.");
  // Supporting identifiers come from the saved registration only after the reviewer confirms an exact visual match.
  const identifier = document.docType === "supporting" ? isBirSupportingDocumentType(type)
    ? `${profile.tax_identification_number}-${profile.branch_code}` : profile.permit_number : "";
  const fingerprint = identifier ? createDocumentFingerprint(identifier) : currentIdentifierFingerprint(document);
  return {
    detailsMatched: true, mismatchFields: [], reasonCode: "REVIEW_REQUIRED",
    reason: "An administrator visually inspected the original and confirmed the registration details. Final approval is still required.",
    docCategory: type, country: "PH", decisionSource: "admin_comparison", suspectedTampering: false,
    ...(fingerprint ? { documentNumberFingerprint: fingerprint } : {}),
    validationChecks: { ...document.validationChecks, documentTypeMatches: true, registrationDataCompared: true,
      nameMatches: true, birthDateMatches: document.docType === "id" ? true : null,
      permitNumberMatches: document.docType === "supporting" ? true : null, documentNotExpired: true },
    manualComparison: { reviewedBy: reviewerId, reviewedAt: now, reviewVersion: input.reviewVersion, fileHash: input.fileHash,
      documentType: type, documentTypeCheckVersion: PRIVATE_DOCUMENT_TYPE_CHECK_VERSION, reviewMethod: "visual",
      confirmations: [...requiredConfirmations], fieldsCompared: Object.keys(profile), remarks,
      identifierDuplicateCheck: fingerprint ? "available" : "file_hash_only" },
  };
}
