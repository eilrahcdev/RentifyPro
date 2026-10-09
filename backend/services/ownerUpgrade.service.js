import PreKycDocument from "../models/PreKycDocument.js";
import { identityProfileMatchesSnapshot, supportingProfileMatchesSnapshot } from "../utils/preKycDocs.js";
import { isBirSupportingDocumentType, resolveSupportedDocumentType } from "./documentValidation.service.js";

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const text = (value) => typeof value === "string" ? value.trim() : "";

export function validateOwnerUpgradeDetails(body = {}) {
  const details = Object.fromEntries(["ownerType", "businessName", "licenseNumber", "permitNumber", "taxIdentificationNumber", "branchCode"]
    .map((field) => [field, text(body[field])]));
  if (!["individual", "business"].includes(details.ownerType)) {
    throw fail(400, "OWNER_DETAILS_REQUIRED", "Select Individual or Business as your owner type.");
  }
  if (!details.businessName || details.businessName.length > 120) {
    throw fail(400, "OWNER_DETAILS_REQUIRED", "Enter the business or trade name shown on your document, using up to 120 characters.");
  }
  if (details.licenseNumber.length > 50 || details.permitNumber.length > 50) {
    throw fail(400, "OWNER_DETAILS_REQUIRED", "Business license and document numbers must use up to 50 characters.");
  }
  return details;
}

export async function validateOwnerUpgradeDocument(user, sessionId, body, details) {
  const revision = text(body.supportingDocRevision);
  if (!revision || revision.length > 128) {
    throw fail(409, "DOCUMENT_STATUS_REQUIRED", "Refresh your supporting document status before upgrading.");
  }
  const document = await PreKycDocument.findOne({ email: user.email, role: "owner", sessionId, docType: "supporting" })
    .select("status selectedDocCategory docCategory reviewVersion expiresAt suspectedTampering +profileSnapshot");
  if (!document) throw fail(400, "SUPPORTING_DOCUMENT_REQUIRED", "Upload and submit your supporting business document before upgrading.");
  if (!document.expiresAt || new Date(document.expiresAt).getTime() <= Date.now()
    || !Number.isFinite(new Date(document.expiresAt).getTime())) {
    throw fail(409, "SUPPORTING_DOCUMENT_EXPIRED", "Your supporting document review has expired. Upload it again before upgrading.");
  }
  if (document.reviewVersion !== revision) {
    throw fail(409, "DOCUMENT_STATUS_REQUIRED", "Your supporting document changed. Refresh its status before upgrading.");
  }
  if (["queued", "processing", "retry_wait", "pending_review"].includes(document.status)) {
    throw fail(409, "SUPPORTING_DOCUMENT_PENDING", "Your supporting document is awaiting review. Wait for approval before upgrading.");
  }
  if (document.status !== "verified" || document.suspectedTampering) {
    throw fail(409, "SUPPORTING_DOCUMENT_CORRECTION_REQUIRED", "Your supporting document needs attention. Upload a corrected file before upgrading.");
  }
  const documentType = resolveSupportedDocumentType(document.selectedDocCategory || document.docCategory, "supporting");
  if (!documentType || documentType !== text(body.supportingDocType)) {
    throw fail(409, "SUPPORTING_DETAILS_CHANGED", "Select the reviewed document type, or submit the replacement document for review.");
  }
  if (isBirSupportingDocumentType(documentType)) {
    if (!/^\d{9}$/.test(details.taxIdentificationNumber) || !/^\d{3,5}$/.test(details.branchCode)) {
      throw fail(400, "OWNER_DETAILS_REQUIRED", "Enter the 9-digit TIN and the 3 to 5 digit branch code shown on your BIR document.");
    }
  } else if (documentType !== "Barangay Business Clearance" && !details.permitNumber) {
    throw fail(400, "OWNER_DETAILS_REQUIRED", "Enter the permit or registration number shown on your supporting document.");
  }
  const profile = { full_name: user.name, business_name: details.businessName, permit_number: details.permitNumber,
    tax_identification_number: details.taxIdentificationNumber, branch_code: details.branchCode };
  if (!identityProfileMatchesSnapshot(document.profileSnapshot, profile, { requireBirthDate: false })
    || !supportingProfileMatchesSnapshot(document.profileSnapshot, profile)) {
    throw fail(409, "SUPPORTING_DETAILS_CHANGED", "Your details changed after document review. Submit the supporting document with your current details for review again.");
  }
  return document;
}
