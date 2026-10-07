import crypto from "node:crypto";

export const ID_DOCUMENT_TYPES = [
  "PhilSys National ID",
  "Philippine Passport",
  "LTO Driver's License",
  "UMID",
  "PRC ID",
  "SSS ID",
  "GSIS ID",
  "PhilHealth ID",
  "Postal ID",
  "Voter's ID",
];

export const SUPPORTING_DOCUMENT_TYPES = [
  "DTI Business Name Registration",
  "SEC Certificate of Registration",
  "Mayor's/Business Permit",
  "BIR Certificate of Registration (Form 2303)",
  "BIR Notice to Issue Receipt/Invoice",
  "Barangay Business Clearance",
  "CDA Certificate of Registration",
];

const BIR_SUPPORTING_TYPES = new Set([
  "BIR Certificate of Registration (Form 2303)",
  "BIR Notice to Issue Receipt/Invoice",
]);
const OPTIONAL_REFERENCE_TYPES = new Set(["Barangay Business Clearance"]);
export const isBirSupportingDocumentType = (value) => BIR_SUPPORTING_TYPES.has(value);

export const UNKNOWN_DOCUMENT_TYPE = "Unknown";

export const DOCUMENT_REASON_CODES = Object.freeze({
  PASSED: "PASSED",
  IMAGE_UNREADABLE: "IMAGE_UNREADABLE",
  UNRECOGNIZED_DOCUMENT: "UNRECOGNIZED_DOCUMENT",
  UNSUPPORTED_DOCUMENT: "UNSUPPORTED_DOCUMENT",
  DOCUMENT_TYPE_MISMATCH: "DOCUMENT_TYPE_MISMATCH",
  AUTHENTICITY_UNCERTAIN: "AUTHENTICITY_UNCERTAIN",
  REQUIRED_DOCUMENT_FEATURES_MISSING: "REQUIRED_DOCUMENT_FEATURES_MISSING",
  REQUIRED_FIELDS_MISSING: "REQUIRED_FIELDS_MISSING",
  DOCUMENT_EXPIRED: "DOCUMENT_EXPIRED",
  REGISTRATION_DATA_INCOMPLETE: "REGISTRATION_DATA_INCOMPLETE",
  IDENTITY_DATA_MISMATCH: "IDENTITY_DATA_MISMATCH",
  DUPLICATE_DOCUMENT: "DUPLICATE_DOCUMENT",
  EXTRACTION_UNCERTAIN: "EXTRACTION_UNCERTAIN",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
});

const clean = (value, max = 200) => String(value || "").trim().slice(0, max);
const normalize = (value) => clean(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const normalizeIdentifier = (value) => clean(value, 120).toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalizeDate = (value) => {
  const raw = clean(value, 40);
  if (!raw) return "";
  const match = raw.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day)
    ? `${year}-${month}-${day}`
    : "";
};

const allowedTypes = (docType) => docType === "supporting"
  ? SUPPORTING_DOCUMENT_TYPES
  : ID_DOCUMENT_TYPES;

const DOCUMENT_TYPE_ALIASES = new Map([
  ["philsys id", "PhilSys National ID"],
  ["philid", "PhilSys National ID"],
  ["philippine national id", "PhilSys National ID"],
  ["national id", "PhilSys National ID"],
  ["passport", "Philippine Passport"],
  ["philippine passport", "Philippine Passport"],
  ["drivers license", "LTO Driver's License"],
  ["philippine drivers license", "LTO Driver's License"],
  ["lto drivers license", "LTO Driver's License"],
  ["lto license", "LTO Driver's License"],
  ["unified multi purpose id", "UMID"],
  ["professional regulation commission id", "PRC ID"],
  ["social security system id", "SSS ID"],
  ["government service insurance system id", "GSIS ID"],
  ["philippine health insurance corporation id", "PhilHealth ID"],
  ["philpost postal id", "Postal ID"],
  ["comelec voters id", "Voter's ID"],
  ["dti registration", "DTI Business Name Registration"],
  ["dti business registration", "DTI Business Name Registration"],
  ["sec registration", "SEC Certificate of Registration"],
  ["sec certificate", "SEC Certificate of Registration"],
  ["business permit", "Mayor's/Business Permit"],
  ["mayors permit", "Mayor's/Business Permit"],
  ["bir form 2303", "BIR Certificate of Registration (Form 2303)"],
  ["bir certificate of registration", "BIR Certificate of Registration (Form 2303)"],
  ["bir authority to print", "BIR Notice to Issue Receipt/Invoice"],
  ["bir notice to issue receipt invoice", "BIR Notice to Issue Receipt/Invoice"],
  ["barangay clearance", "Barangay Business Clearance"],
  ["cda registration", "CDA Certificate of Registration"],
  ["cda certificate", "CDA Certificate of Registration"],
]);

export const resolveSupportedDocumentType = (value, docType = "id") => {
  const candidate = normalize(value);
  if (!candidate || candidate === "unknown") return "";
  const allowed = allowedTypes(docType);
  const exact = allowed.find((item) => normalize(item) === candidate);
  if (exact) return exact;
  const alias = DOCUMENT_TYPE_ALIASES.get(candidate) || "";
  return allowed.includes(alias) ? alias : "";
};

const IGNORED_NAME_TOKENS = new Set(["jr", "sr", "ii", "iii", "iv"]);
const nameTokens = (value) => normalize(value)
  .split(" ")
  .filter((token) => token && !IGNORED_NAME_TOKENS.has(token));

const namesMatch = (profile = {}, extractedName = "") => {
  const documentTokens = nameTokens(extractedName);
  if (documentTokens.length < 2) return false;
  const firstName = clean(profile.first_name || profile.firstName);
  const lastName = clean(profile.last_name || profile.lastName);
  const firstNameTokens = nameTokens(firstName);
  const lastNameTokens = nameTokens(lastName);
  if (!firstNameTokens.length || !lastNameTokens.length) return false;
  if ([...firstNameTokens, ...lastNameTokens].some((token) => token.length < 2)) return false;
  const matchingSpans = (expectedTokens) => {
    const expected = expectedTokens.join("");
    const spans = [];
    documentTokens.forEach((_, start) => {
      let actual = "";
      for (let end = start; end < documentTokens.length; end += 1) {
        actual += documentTokens[end];
        if (!expected.startsWith(actual)) break;
        if (actual === expected) spans.push({ start, end });
      }
    });
    return spans;
  };
  const firstSpans = matchingSpans(firstNameTokens);
  const lastSpans = matchingSpans(lastNameTokens);
  return firstSpans.some((first) => lastSpans.some((last) =>
    first.end < last.start || last.end < first.start));
};

const textMatches = (expected, actual) => {
  const left = normalize(expected);
  const right = normalize(actual);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const expectedTokens = left.split(" ").filter((token) => token.length > 2);
  const actualTokens = new Set(right.split(" "));
  return expectedTokens.length > 0 && expectedTokens.every((token) => actualTokens.has(token));
};

export const compareDocumentRegistration = ({ docType = "id", profile = {}, data = {}, documentType = "" } = {}) => {
  const isBirSupporting = docType === "supporting" && isBirSupportingDocumentType(documentType);
  const optionalReference = docType === "supporting" && OPTIONAL_REFERENCE_TYPES.has(documentType);
  const expectedBirthDate = normalizeDate(profile.date_of_birth || profile.birth_date);
  const nameMatches = docType === "id"
    ? namesMatch(profile, data.full_name)
    : clean(profile.business_name)
      ? textMatches(profile.business_name, data.business_name)
      : namesMatch(profile, data.full_name);
  const birthDateMatches = docType !== "id" || !expectedBirthDate
    ? null : Boolean(normalizeDate(data.birth_date) && expectedBirthDate === normalizeDate(data.birth_date));
  const expectedPermit = normalizeIdentifier(profile.permit_number);
  const extractedPermit = normalizeIdentifier(data.permit_number || data.document_number);
  const expectedTin = normalizeIdentifier(profile.tax_identification_number);
  const expectedBranch = normalizeIdentifier(profile.branch_code);
  const permitNumberMatches = docType !== "supporting"
    || (isBirSupporting
      ? Boolean(expectedTin && expectedBranch
        && normalizeIdentifier(data.tax_identification_number) === expectedTin
        && normalizeIdentifier(data.branch_code) === expectedBranch)
      : optionalReference && !expectedPermit ? true
        : Boolean(expectedPermit && extractedPermit && expectedPermit === extractedPermit));
  const mismatchFields = [];
  if (!nameMatches) mismatchFields.push(docType === "id" ? "Name" : "Registered name");
  if (birthDateMatches === false) mismatchFields.push("Date of birth");
  if (!permitNumberMatches) mismatchFields.push(isBirSupporting ? "TIN or branch code" : "Permit or registration number");
  return { nameMatches, birthDateMatches, permitNumberMatches, mismatchFields };
};

const isExpired = (value, now = new Date()) => {
  const normalized = normalizeDate(value);
  if (!normalized) return false;
  return new Date(`${normalized}T23:59:59.999Z`).getTime() < now.getTime();
};

const maskIdentifier = (value) => {
  const normalized = normalizeIdentifier(value);
  return normalized ? `**** ${normalized.slice(-4)}` : "";
};

export const createDocumentFingerprint = (value) => {
  const identifier = normalizeIdentifier(value);
  const secret = String(
    process.env.KYC_DOCUMENT_FINGERPRINT_SECRET || process.env.JWT_SECRET || ""
  ).trim();
  if (!identifier || !secret) return "";
  return crypto.createHmac("sha256", secret).update(identifier).digest("hex");
};

const detectedFields = (data) => Object.entries({
  fullName: data.full_name,
  birthDate: data.birth_date,
  documentNumber: data.document_number,
  expirationDate: data.expiration_date,
  businessName: data.business_name,
  permitNumber: data.permit_number,
  taxIdentificationNumber: data.tax_identification_number,
  branchCode: data.branch_code,
}).filter(([, value]) => Boolean(clean(value))).map(([key]) => key);

const clampPercentage = (value) => Math.max(0, Math.min(100, Number(value) || 0));
const isPhilippineCountry = (country) => ["ph", "phl", "philippines", "republic of the philippines"]
  .includes(normalize(country));
const safeDetectedType = (canonical) => canonical || UNKNOWN_DOCUMENT_TYPE;
const allowedSurface = (surface, docType) => docType === "supporting"
  ? ["PHYSICAL_DOCUMENT", "OFFICIAL_DIGITAL_DOCUMENT"].includes(surface)
  : surface === "PHYSICAL_DOCUMENT";

const getStructuralChecks = (extraction, canonicalType, docType) => {
  const features = extraction.structural_features && typeof extraction.structural_features === "object"
    ? extraction.structural_features
    : {};
  const officialMarkingsPresent = features.official_markings_present === true;
  const layoutConsistent = features.layout_consistent === true;
  const hasFace = features.holder_portrait_present === true || extraction.has_face === true;
  const documentNumberRegionPresent = features.document_number_region_present === true;
  const birIdentifierVisible = isBirSupportingDocumentType(canonicalType)
    && Boolean(normalizeIdentifier(extraction.extracted_data?.tax_identification_number)
      && normalizeIdentifier(extraction.extracted_data?.branch_code));
  const birthDateRegionPresent = features.birth_date_region_present === true;
  const expirationDateRegionPresent = features.expiration_date_region_present === true;
  const machineReadableZonePresent = features.machine_readable_zone_present === true;
  const businessRegistrationFeaturesPresent = features.business_registration_features_present === true;

  const numberRegionRequired = docType !== "supporting"
    || !OPTIONAL_REFERENCE_TYPES.has(canonicalType);
  let structuralFeaturesPresent = officialMarkingsPresent && layoutConsistent
    && (!numberRegionRequired || documentNumberRegionPresent || birIdentifierVisible);
  if (docType === "supporting") {
    structuralFeaturesPresent = structuralFeaturesPresent && businessRegistrationFeaturesPresent;
  } else {
    structuralFeaturesPresent = structuralFeaturesPresent && hasFace && birthDateRegionPresent;
    if (canonicalType === "Philippine Passport") {
      structuralFeaturesPresent = structuralFeaturesPresent
        && expirationDateRegionPresent
        && machineReadableZonePresent;
    } else if (canonicalType === "LTO Driver's License") {
      structuralFeaturesPresent = structuralFeaturesPresent && expirationDateRegionPresent;
    }
  }

  return {
    officialMarkingsPresent,
    layoutConsistent,
    hasFace,
    machineReadableZonePresent,
    structuralFeaturesPresent,
  };
};

const decisionMessage = (reasonCode, context = {}) => {
  switch (reasonCode) {
    case DOCUMENT_REASON_CODES.IMAGE_UNREADABLE:
      return "We could not read the document clearly. Upload a sharp image showing the complete document without blur, glare, or cropped edges.";
    case DOCUMENT_REASON_CODES.UNRECOGNIZED_DOCUMENT:
      return "We could not recognize this upload as a supported government-issued document. Upload a clear image of the requested document.";
    case DOCUMENT_REASON_CODES.UNSUPPORTED_DOCUMENT:
      return "This upload is not one of the supported Philippine documents. Choose a supported document type and upload that document.";
    case DOCUMENT_REASON_CODES.DOCUMENT_TYPE_MISMATCH:
      return `Please upload a ${context.expectedType}. The uploaded document appears to be a ${context.detectedType}, which does not match the required document type.`;
    case DOCUMENT_REASON_CODES.AUTHENTICITY_UNCERTAIN:
      return "We could not confidently confirm the document's type or security features. A reviewer will inspect it securely.";
    case DOCUMENT_REASON_CODES.REQUIRED_DOCUMENT_FEATURES_MISSING:
      return "The upload does not show the expected layout and security features for this document type. Upload the complete original document.";
    case DOCUMENT_REASON_CODES.REQUIRED_FIELDS_MISSING:
      return "Some required document details are missing or unreadable. Upload the complete document with clear text and no cropped edges.";
    case DOCUMENT_REASON_CODES.DOCUMENT_EXPIRED:
      return "This document appears to be expired. Upload a current, valid document.";
    case DOCUMENT_REASON_CODES.REGISTRATION_DATA_INCOMPLETE:
      return "We could not compare the ID because your registration birth date is missing or invalid. Correct that detail, then upload the ID again.";
    case DOCUMENT_REASON_CODES.IDENTITY_DATA_MISMATCH:
      return `The ${context.mismatchFields.join(" and ").toLowerCase()} on this ID does not match your registration details. Correct your details or upload the matching ID.`;
    case DOCUMENT_REASON_CODES.DUPLICATE_DOCUMENT:
      return "This document may already be linked to another registration. A reviewer will check it securely.";
    case DOCUMENT_REASON_CODES.EXTRACTION_UNCERTAIN:
      return "The document passed the format checks, but some details could not be read confidently. A reviewer will verify it manually.";
    case DOCUMENT_REASON_CODES.REVIEW_REQUIRED:
      return "Automated checks are complete. A reviewer will make the final approval decision.";
    default:
      return "Document checks completed successfully.";
  }
};

export const evaluateDocumentExtraction = ({
  extraction = {},
  docType = "id",
  selectedDocType = "",
  profile = {},
  duplicateDetected = false,
  allowAutomaticVerification = true,
  minimumConfidence = 85,
  minimumClassificationConfidence = 90,
  requireBirthDate = docType === "id",
  now = new Date(),
} = {}) => {
  const data = extraction.extracted_data && typeof extraction.extracted_data === "object"
    ? extraction.extracted_data
    : {};
  const confidence = clampPercentage(extraction.extraction_confidence ?? extraction.confidence);
  const classificationConfidence = clampPercentage(extraction.classification_confidence);
  const selectedCanonical = resolveSupportedDocumentType(selectedDocType, docType);
  const rawDetectedType = clean(extraction.document_type || extraction.doc_type, 140);
  const detectedCanonical = resolveSupportedDocumentType(rawDetectedType, docType);
  const detectedType = safeDetectedType(detectedCanonical);
  const country = clean(extraction.issuing_country || extraction.country, 40);
  const documentSurface = clean(extraction.document_surface, 40).toUpperCase();
  const imageReadable = extraction.image_readable === true;
  const recognizedDocument = extraction.recognized_document === true;
  const classificationConfident = classificationConfidence >= minimumClassificationConfidence;
  const supportedDocumentType = Boolean(detectedCanonical) && isPhilippineCountry(country);
  const documentTypeMatches = Boolean(selectedCanonical && detectedCanonical)
    && selectedCanonical === detectedCanonical;
  const structural = getStructuralChecks(extraction, detectedCanonical, docType);
  const authenticityUncertain = extraction.authenticity_uncertain === true;
  const suspectedTampering = extraction.suspected_tampering === true;
  const isBirSupporting = docType === "supporting" && isBirSupportingDocumentType(detectedCanonical);
  const optionalReference = docType === "supporting" && OPTIONAL_REFERENCE_TYPES.has(detectedCanonical);
  const extractedTin = normalizeIdentifier(data.tax_identification_number);
  const extractedBranch = normalizeIdentifier(data.branch_code);
  const documentNumber = isBirSupporting
    ? clean(extractedTin && extractedBranch ? `${extractedTin}-${extractedBranch}` : "", 120)
    : clean(data.document_number || data.permit_number, 120);
  const extractedBirthDate = normalizeDate(data.birth_date);
  const expired = isExpired(data.expiration_date, now);
  const requiredFieldsPresent = docType === "id"
    ? Boolean(clean(data.full_name) && extractedBirthDate && documentNumber)
      && (detectedCanonical !== "Philippine Passport" || Boolean(normalizeDate(data.expiration_date)))
      && (detectedCanonical !== "LTO Driver's License" || Boolean(normalizeDate(data.expiration_date)))
    : Boolean((clean(data.business_name) || clean(data.full_name))
      && (optionalReference || (isBirSupporting ? extractedTin && extractedBranch : documentNumber)));

  const checks = {
    imageReadable,
    recognizedDocument: null,
    classificationConfident: null,
    allowedDocumentSurface: null,
    supportedDocumentType: null,
    documentTypeMatches: null,
    officialMarkingsPresent: null,
    layoutConsistent: null,
    structuralFeaturesPresent: null,
    hasFace: null,
    machineReadableZonePresent: null,
    requiredFieldsPresent: null,
    registrationDataCompared: false,
    nameMatches: null,
    birthDateMatches: null,
    permitNumberMatches: null,
    documentNotExpired: null,
    duplicateDetected: null,
    suspectedTampering: null,
  };

  const buildResult = ({ status, reasonCode, mismatchFields = [], compareData = false }) => ({
    status,
    reasonCode,
    confidence,
    classificationConfidence,
    documentSurface,
    checks: { ...checks, registrationDataCompared: compareData },
    mismatchFields,
    reviewReason: decisionMessage(reasonCode, {
      expectedType: selectedCanonical || "selected document",
      detectedType,
      mismatchFields,
    }),
    documentNumberFingerprint: compareData ? createDocumentFingerprint(documentNumber) : "",
    extractedData: {
      documentType: detectedType,
      documentNumberMasked: compareData ? maskIdentifier(documentNumber) : "",
      birthDateDetected: compareData && Boolean(extractedBirthDate),
      fieldsDetected: compareData ? detectedFields(data) : [],
    },
  });

  // Stage 1: image quality. No recognition or personal-data comparison is trusted yet.
  if (!imageReadable) {
    return buildResult({ status: "reupload_required", reasonCode: DOCUMENT_REASON_CODES.IMAGE_UNREADABLE });
  }

  // Stage 2: independent recognition. Text containing matching profile data is not a document.
  checks.recognizedDocument = recognizedDocument;
  checks.classificationConfident = classificationConfident;
  checks.allowedDocumentSurface = allowedSurface(documentSurface, docType);
  checks.supportedDocumentType = supportedDocumentType;
  if (!recognizedDocument || !checks.allowedDocumentSurface) {
    return buildResult({ status: "reupload_required", reasonCode: DOCUMENT_REASON_CODES.UNRECOGNIZED_DOCUMENT });
  }
  if (!detectedCanonical) {
    const unsupported = rawDetectedType && normalize(rawDetectedType) !== "unknown";
    return buildResult({
      status: "reupload_required",
      reasonCode: unsupported
        ? DOCUMENT_REASON_CODES.UNSUPPORTED_DOCUMENT
        : DOCUMENT_REASON_CODES.UNRECOGNIZED_DOCUMENT,
    });
  }
  if (country && !isPhilippineCountry(country)) {
    return buildResult({ status: "reupload_required", reasonCode: DOCUMENT_REASON_CODES.UNSUPPORTED_DOCUMENT });
  }
  if (!classificationConfident || !country) {
    return buildResult({ status: "pending_review", reasonCode: DOCUMENT_REASON_CODES.AUTHENTICITY_UNCERTAIN });
  }

  // Stage 3: the independently detected type must exactly match the selected type.
  checks.documentTypeMatches = documentTypeMatches;
  if (!documentTypeMatches) {
    return buildResult({ status: "reupload_required", reasonCode: DOCUMENT_REASON_CODES.DOCUMENT_TYPE_MISMATCH });
  }

  // Stage 4: validate type-specific structure before reading identity fields.
  checks.officialMarkingsPresent = structural.officialMarkingsPresent;
  checks.layoutConsistent = structural.layoutConsistent;
  checks.structuralFeaturesPresent = structural.structuralFeaturesPresent;
  checks.hasFace = structural.hasFace;
  checks.machineReadableZonePresent = detectedCanonical === "Philippine Passport"
    ? structural.machineReadableZonePresent
    : null;
  checks.suspectedTampering = suspectedTampering;
  if (authenticityUncertain || suspectedTampering) {
    return buildResult({ status: "pending_review", reasonCode: DOCUMENT_REASON_CODES.AUTHENTICITY_UNCERTAIN });
  }
  if (!structural.structuralFeaturesPresent) {
    return buildResult({
      status: "reupload_required",
      reasonCode: DOCUMENT_REASON_CODES.REQUIRED_DOCUMENT_FEATURES_MISSING,
    });
  }

  // Stage 5: required OCR fields and validity. Only then may registration data be compared.
  checks.requiredFieldsPresent = requiredFieldsPresent;
  checks.documentNotExpired = !expired;
  if (!requiredFieldsPresent) {
    return buildResult({ status: "reupload_required", reasonCode: DOCUMENT_REASON_CODES.REQUIRED_FIELDS_MISSING });
  }
  if (expired) {
    return buildResult({ status: "reupload_required", reasonCode: DOCUMENT_REASON_CODES.DOCUMENT_EXPIRED });
  }

  // Stage 6: registration-data comparison cannot override any earlier document gate.
  const expectedBirthDate = normalizeDate(profile.date_of_birth || profile.birth_date);
  if (docType === "id" && requireBirthDate && !expectedBirthDate) {
    return buildResult({
      status: "reupload_required",
      reasonCode: DOCUMENT_REASON_CODES.REGISTRATION_DATA_INCOMPLETE,
    });
  }
  const { nameMatches, birthDateMatches, permitNumberMatches, mismatchFields } = compareDocumentRegistration({
    docType, profile, data, documentType: detectedCanonical,
  });
  checks.nameMatches = nameMatches;
  checks.birthDateMatches = birthDateMatches;
  checks.permitNumberMatches = permitNumberMatches;
  checks.duplicateDetected = Boolean(duplicateDetected);

  if (docType === "id" && mismatchFields.length && confidence < minimumConfidence) {
    return buildResult({
      status: "pending_review",
      reasonCode: DOCUMENT_REASON_CODES.EXTRACTION_UNCERTAIN,
      mismatchFields,
      compareData: true,
    });
  }
  if (mismatchFields.length) {
    return buildResult({
      status: docType === "id" ? "reupload_required" : "pending_review",
      reasonCode: DOCUMENT_REASON_CODES.IDENTITY_DATA_MISMATCH,
      mismatchFields,
      compareData: true,
    });
  }
  if (duplicateDetected) {
    return buildResult({
      status: "pending_review",
      reasonCode: DOCUMENT_REASON_CODES.DUPLICATE_DOCUMENT,
      compareData: true,
    });
  }
  if (optionalReference && !documentNumber) {
    return buildResult({
      status: "pending_review",
      reasonCode: DOCUMENT_REASON_CODES.REVIEW_REQUIRED,
      compareData: true,
    });
  }
  if (confidence < minimumConfidence) {
    return buildResult({
      status: "pending_review",
      reasonCode: DOCUMENT_REASON_CODES.EXTRACTION_UNCERTAIN,
      compareData: true,
    });
  }
  if (!allowAutomaticVerification) {
    return buildResult({
      status: "pending_review",
      reasonCode: DOCUMENT_REASON_CODES.REVIEW_REQUIRED,
      compareData: true,
    });
  }
  return buildResult({ status: "verified", reasonCode: DOCUMENT_REASON_CODES.PASSED, compareData: true });
};
