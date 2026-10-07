import { evaluateDocumentExtraction, isBirSupportingDocumentType, resolveSupportedDocumentType } from "./documentValidation.service.js";
import { PRIVATE_DOCUMENT_TYPE_CHECK_VERSION } from "./privateDocumentExtraction.service.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
export const canManuallyCompareDocument = (document) => document?.status === "pending_review"
  && ["private-ocr", "manual"].includes(document.provider);

export function assertStoredPrivateDocumentType(document) {
  if (document.provider !== "private-ocr") return;
  const selected = resolveSupportedDocumentType(document.selectedDocCategory, document.docType);
  const check = document.privateScreening?.typeCheck;
  const candidate = document.privateScreening?.candidateType;
  if (candidate && candidate !== selected) throw fail(409, "The detected document type does not match the selected type. Ask for the correct document.");
  if (!check) return;
  if (check.version !== PRIVATE_DOCUMENT_TYPE_CHECK_VERSION || check.fileHash !== document.fileHash
    || check.reviewVersion !== (document.reviewVersion || document.fileHash) || check.selectedType !== selected) {
    throw fail(409, "The document type check is stale. Refresh and inspect the current document.");
  }
  if (check.detectedTypes?.length !== 1 || check.detectedTypes[0] !== selected) {
    throw fail(409, "The document type could not be confirmed as the selected type. Ask for a clear upload of the correct document.");
  }
}

export function hasCurrentManualDocumentComparison(document) {
  if (!document) return false;
  const type = resolveSupportedDocumentType(document.selectedDocCategory, document.docType);
  const comparison = document.manualComparison;
  try { assertStoredPrivateDocumentType(document); } catch { return false; }
  return Boolean(type && document.fileHash && comparison && document.detailsMatched === true && document.validationChecks?.documentTypeMatches === true
    && comparison?.fileHash === document.fileHash && comparison.reviewVersion === (document.reviewVersion || document.fileHash)
    && comparison.documentType === type && comparison.documentTypeCheckVersion === PRIVATE_DOCUMENT_TYPE_CHECK_VERSION);
}

export function prepareManualDocumentComparison(document, input, reviewerId, now = new Date()) {
  if (!canManuallyCompareDocument(document)) throw fail(409, "This document is not awaiting a private/manual comparison.");
  if (!document.fileHash || input?.fileHash !== document.fileHash
    || !input?.reviewVersion || input.reviewVersion !== (document.reviewVersion || document.fileHash)) {
    throw fail(409, "The document changed. Refresh and inspect the current file before comparing it.");
  }
  if (!document.fileKey || (document.expiresAt && new Date(document.expiresAt) <= now)) {
    throw fail(409, "This document has expired or its private file is unavailable. Ask for a new upload.");
  }
  if (!document.profileSnapshot || !Object.keys(document.profileSnapshot).length) {
    throw fail(409, "Registration details are unavailable. Ask the applicant to resubmit this document.");
  }
  if (String(process.env.KYC_DOCUMENT_FINGERPRINT_SECRET || "").length < 32) {
    throw fail(503, "The shared document-fingerprint secret must be configured before manual comparison.");
  }
  const remarks = String(input.remarks || "").trim();
  if (remarks.length < 10 || remarks.length > 500) throw fail(400, "Record your comparison findings using 10 to 500 characters.");
  const type = resolveSupportedDocumentType(input.documentType, document.docType);
  const selected = resolveSupportedDocumentType(document.selectedDocCategory, document.docType);
  if (!type || type !== selected) throw fail(409, "The document type must match the applicant's selected type. Ask for the correct document.");
  assertStoredPrivateDocumentType(document);
  const surface = input.documentSurface || "PHYSICAL_DOCUMENT";
  if (!(document.docType === "id" ? ["PHYSICAL_DOCUMENT"] : ["PHYSICAL_DOCUMENT", "OFFICIAL_DIGITAL_DOCUMENT"]).includes(surface)) {
    throw fail(400, "Confirm whether this is an original physical or official digital document.");
  }
  const required = ["readable", "original", "officialLayout", "officialMarkings", "noVisibleAlteration"];
  if (document.docType === "id") required.push("holderPortrait");
  if (type === "Philippine Passport") required.push("machineReadableZone");
  if (required.some((key) => input.confirmations?.[key] !== true)) {
    throw fail(400, "Inspect the original document and confirm every required check before saving the comparison.");
  }
  const data = {};
  for (const key of ["full_name", "birth_date", "document_number", "issue_date", "expiration_date",
    "business_name", "permit_number", "tax_identification_number", "branch_code"]) {
    if (typeof input.fields?.[key] !== "string" && input.fields?.[key] !== undefined) throw fail(400, "Document fields must be text.");
    const value = String(input.fields?.[key] || "").trim();
    if (value.length > 200) throw fail(400, "A document field is too long.");
    data[key] = value;
  }
  for (const key of ["birth_date", "issue_date", "expiration_date"]) {
    if (!data[key]) continue;
    const parsed = new Date(`${data[key]}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data[key]) || !Number.isFinite(parsed.getTime())
      || parsed.toISOString().slice(0, 10) !== data[key]) {
      throw fail(400, "Enter valid document dates using year-month-day.");
    }
  }
  const decision = evaluateDocumentExtraction({
    docType: document.docType, selectedDocType: document.selectedDocCategory,
    profile: document.profileSnapshot, requireBirthDate: document.docType === "id" && document.role === "user",
    allowAutomaticVerification: false, minimumConfidence: 0, minimumClassificationConfidence: 0, now,
    extraction: {
      image_readable: true, recognized_document: true, document_type: type, issuing_country: input.issuingCountry,
      classification_confidence: 0, extraction_confidence: 0, document_surface: surface,
      authenticity_uncertain: false, suspected_tampering: false,
      structural_features: {
        official_markings_present: input.confirmations.officialMarkings,
        layout_consistent: input.confirmations.officialLayout,
        holder_portrait_present: input.confirmations.holderPortrait === true,
        document_number_region_present: Boolean(data.document_number || data.permit_number
          || (isBirSupportingDocumentType(type) && data.tax_identification_number && data.branch_code)),
        birth_date_region_present: Boolean(data.birth_date), expiration_date_region_present: Boolean(data.expiration_date),
        machine_readable_zone_present: input.confirmations.machineReadableZone === true,
        business_registration_features_present: document.docType === "supporting",
      },
      extracted_data: data,
    },
  });
  if (decision.checks.registrationDataCompared !== true || decision.mismatchFields.length
    || !["REVIEW_REQUIRED", "EXTRACTION_UNCERTAIN"].includes(decision.reasonCode)) {
    throw fail(409, decision.reviewReason);
  }
  return {
    detailsMatched: true, mismatchFields: [], reasonCode: "REVIEW_REQUIRED",
    reason: "An administrator inspected the document and confirmed its registration details. Final document approval is still required.",
    docCategory: type, country: "PH", documentSurface: surface,
    validationChecks: decision.checks, extractedData: decision.extractedData,
    documentNumberFingerprint: decision.documentNumberFingerprint, decisionSource: "admin_comparison",
    suspectedTampering: false,
    manualComparison: { reviewedBy: reviewerId, reviewedAt: now, reviewVersion: input.reviewVersion,
      documentType: type, documentTypeCheckVersion: PRIVATE_DOCUMENT_TYPE_CHECK_VERSION,
      fileHash: input.fileHash, confirmations: required, fieldsCompared: decision.extractedData.fieldsDetected, remarks },
  };
}
