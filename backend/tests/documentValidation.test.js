import test from "node:test";
import assert from "node:assert/strict";

import {
  createDocumentFingerprint,
  DOCUMENT_REASON_CODES,
  evaluateDocumentExtraction,
  resolveSupportedDocumentType,
} from "../services/documentValidation.service.js";
import {
  buildDocumentExtractionInstruction,
  normalizeDocumentInspection,
} from "../services/geminiDocument.service.js";
import { isIdentityReadyForSelfie } from "../utils/preKycDocs.js";

const passportStructure = {
  official_markings_present: true,
  layout_consistent: true,
  holder_portrait_present: true,
  document_number_region_present: true,
  birth_date_region_present: true,
  expiration_date_region_present: true,
  machine_readable_zone_present: true,
  business_registration_features_present: false,
};

const validIdExtraction = {
  image_readable: true,
  recognized_document: true,
  document_type: "Philippine Passport",
  issuing_country: "PH",
  classification_confidence: 98,
  document_surface: "PHYSICAL_DOCUMENT",
  structural_features: passportStructure,
  authenticity_uncertain: false,
  suspected_tampering: false,
  warnings: [],
  extraction_confidence: 96,
  extracted_data: {
    full_name: "DELA CRUZ, JUAN SANTOS",
    birth_date: "1990-05-12",
    document_number: "P1234567A",
    expiration_date: "2030-05-12",
  },
};

const profile = {
  first_name: "Juan",
  last_name: "Dela Cruz",
  date_of_birth: "1990-05-12",
};

const evaluatePassport = (overrides = {}) => evaluateDocumentExtraction({
  extraction: validIdExtraction,
  docType: "id",
  selectedDocType: "Philippine Passport",
  profile,
  now: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

test("all ordered gates verify a matching, structurally valid document", () => {
  const result = evaluatePassport();

  assert.equal(result.status, "verified");
  assert.equal(result.reasonCode, DOCUMENT_REASON_CODES.PASSED);
  assert.equal(result.checks.recognizedDocument, true);
  assert.equal(result.checks.documentTypeMatches, true);
  assert.equal(result.checks.structuralFeaturesPresent, true);
  assert.equal(result.checks.registrationDataCompared, true);
  assert.equal(result.checks.nameMatches, true);
  assert.equal(result.checks.birthDateMatches, true);
});

test("a wrong government document cannot pass even when all personal data matches", () => {
  const extraction = {
    ...validIdExtraction,
    document_type: "LTO Driver's License",
    structural_features: {
      ...passportStructure,
      machine_readable_zone_present: false,
    },
  };
  const result = evaluatePassport({ extraction });

  assert.equal(result.status, "reupload_required");
  assert.equal(result.reasonCode, DOCUMENT_REASON_CODES.DOCUMENT_TYPE_MISMATCH);
  assert.equal(result.extractedData.documentType, "LTO Driver's License");
  assert.equal(result.checks.registrationDataCompared, false);
  assert.equal(result.checks.nameMatches, null);
  assert.equal(result.documentNumberFingerprint, "");
});

test("plain paper with matching identity text is never treated as a document", () => {
  const extraction = {
    ...validIdExtraction,
    recognized_document: false,
    document_type: "UNKNOWN",
    classification_confidence: 99,
    document_surface: "PLAIN_PAPER",
    structural_features: Object.fromEntries(Object.keys(passportStructure).map((key) => [key, false])),
  };
  const result = evaluatePassport({ extraction });

  assert.equal(result.status, "reupload_required");
  assert.equal(result.reasonCode, DOCUMENT_REASON_CODES.UNRECOGNIZED_DOCUMENT);
  assert.equal(result.extractedData.documentType, "Unknown");
  assert.equal(result.checks.registrationDataCompared, false);
  assert.deepEqual(result.extractedData.fieldsDetected, []);
});

test("random images, typed screenshots, and unknown document types fail recognition", () => {
  const scenarios = [
    { surface: "UNRELATED_IMAGE", recognized: false, type: "UNKNOWN", reason: DOCUMENT_REASON_CODES.UNRECOGNIZED_DOCUMENT },
    { surface: "SCREENSHOT", recognized: false, type: "UNKNOWN", reason: DOCUMENT_REASON_CODES.UNRECOGNIZED_DOCUMENT },
    { surface: "PHYSICAL_DOCUMENT", recognized: true, type: "Foreign National ID", reason: DOCUMENT_REASON_CODES.UNSUPPORTED_DOCUMENT },
  ];

  for (const scenario of scenarios) {
    const result = evaluatePassport({
      extraction: {
        ...validIdExtraction,
        recognized_document: scenario.recognized,
        document_type: scenario.type,
        document_surface: scenario.surface,
      },
    });
    assert.equal(result.status, "reupload_required");
    assert.equal(result.reasonCode, scenario.reason);
    assert.equal(result.checks.registrationDataCompared, false);
  }
});

test("image quality, required structure, and expiration are hard gates before comparison", () => {
  const unreadable = evaluatePassport({
    extraction: { ...validIdExtraction, image_readable: false },
  });
  assert.equal(unreadable.reasonCode, DOCUMENT_REASON_CODES.IMAGE_UNREADABLE);
  assert.equal(unreadable.checks.registrationDataCompared, false);

  const cropped = evaluatePassport({
    extraction: {
      ...validIdExtraction,
      structural_features: { ...passportStructure, machine_readable_zone_present: false },
    },
  });
  assert.equal(cropped.reasonCode, DOCUMENT_REASON_CODES.REQUIRED_DOCUMENT_FEATURES_MISSING);
  assert.equal(cropped.checks.registrationDataCompared, false);

  const expired = evaluatePassport({
    extraction: {
      ...validIdExtraction,
      extracted_data: { ...validIdExtraction.extracted_data, expiration_date: "2020-01-01" },
    },
  });
  assert.equal(expired.reasonCode, DOCUMENT_REASON_CODES.DOCUMENT_EXPIRED);
  assert.equal(expired.checks.registrationDataCompared, false);
});

test("ambiguous classification and authenticity concerns go to manual review", () => {
  const uncertainClassification = evaluatePassport({
    extraction: { ...validIdExtraction, classification_confidence: 60 },
  });
  assert.equal(uncertainClassification.status, "pending_review");
  assert.equal(uncertainClassification.reasonCode, DOCUMENT_REASON_CODES.AUTHENTICITY_UNCERTAIN);
  assert.equal(uncertainClassification.checks.registrationDataCompared, false);

  const authenticityConcern = evaluatePassport({
    extraction: { ...validIdExtraction, authenticity_uncertain: true },
  });
  assert.equal(authenticityConcern.status, "pending_review");
  assert.equal(authenticityConcern.reasonCode, DOCUMENT_REASON_CODES.AUTHENTICITY_UNCERTAIN);
  assert.equal(authenticityConcern.checks.registrationDataCompared, false);
});

test("identity mismatches require correction while duplicate documents require review", () => {
  const mismatch = evaluatePassport({
    extraction: {
      ...validIdExtraction,
      extracted_data: { ...validIdExtraction.extracted_data, birth_date: "1991-05-12" },
    },
  });
  assert.equal(mismatch.status, "reupload_required");
  assert.equal(mismatch.reasonCode, DOCUMENT_REASON_CODES.IDENTITY_DATA_MISMATCH);
  assert.deepEqual(mismatch.mismatchFields, ["Date of birth"]);
  assert.equal(mismatch.checks.registrationDataCompared, true);

  const duplicate = evaluatePassport({ duplicateDetected: true });
  assert.equal(duplicate.status, "pending_review");
  assert.equal(duplicate.reasonCode, DOCUMENT_REASON_CODES.DUPLICATE_DOCUMENT);
});

test("name matching uses complete tokens and rejects substring collisions", () => {
  const result = evaluatePassport({
    extraction: {
      ...validIdExtraction,
      extracted_data: {
        ...validIdExtraction.extracted_data,
        full_name: "JOANNE LIM",
      },
    },
    profile: {
      first_name: "Ann",
      last_name: "Li",
      date_of_birth: "1990-05-12",
    },
  });

  assert.equal(result.status, "reupload_required");
  assert.equal(result.reasonCode, DOCUMENT_REASON_CODES.IDENTITY_DATA_MISMATCH);
  assert.deepEqual(result.mismatchFields, ["Name"]);
});

test("name matching accepts spacing differences without accepting partial or reused names", () => {
  const sameLetters = evaluatePassport({
    profile: { ...profile, last_name: "De La Cruz" },
    extraction: {
      ...validIdExtraction,
      extracted_data: { ...validIdExtraction.extracted_data, full_name: "DELACRUZ, JUAN SANTOS" },
    },
  });
  assert.equal(sameLetters.status, "verified");
  assert.equal(sameLetters.checks.nameMatches, true);

  const reusedToken = evaluatePassport({
    profile: { ...profile, first_name: "Juan", last_name: "Juan" },
    extraction: {
      ...validIdExtraction,
      extracted_data: { ...validIdExtraction.extracted_data, full_name: "JUAN SANTOS" },
    },
  });
  assert.equal(reusedToken.reasonCode, DOCUMENT_REASON_CODES.IDENTITY_DATA_MISMATCH);
  assert.equal(reusedToken.checks.nameMatches, false);
});

test("uncertain ID text cannot become a definite name mismatch or unlock a selfie", () => {
  const uncertainName = evaluatePassport({
    extraction: {
      ...validIdExtraction,
      extraction_confidence: 60,
      extracted_data: { ...validIdExtraction.extracted_data, full_name: "JOANNE LIM" },
    },
  });
  assert.equal(uncertainName.status, "pending_review");
  assert.equal(uncertainName.reasonCode, DOCUMENT_REASON_CODES.EXTRACTION_UNCERTAIN);
  assert.deepEqual(uncertainName.mismatchFields, ["Name"]);
  assert.equal(uncertainName.checks.registrationDataCompared, true);
  assert.equal(uncertainName.checks.nameMatches, false);
  assert.equal(isIdentityReadyForSelfie({
    docType: "id",
    status: uncertainName.status,
    detailsMatched: uncertainName.checks.registrationDataCompared === true
      && uncertainName.mismatchFields.length === 0,
  }), false);
});

test("a renter ID cannot pass when the registration birth date is missing", () => {
  const result = evaluatePassport({
    profile: { first_name: "Juan", last_name: "Dela Cruz" },
  });

  assert.equal(result.status, "reupload_required");
  assert.equal(result.reasonCode, DOCUMENT_REASON_CODES.REGISTRATION_DATA_INCOMPLETE);
  assert.equal(result.checks.registrationDataCompared, false);
});

test("owner ID comparison can retain the existing name-only policy when no birth date is collected", () => {
  const result = evaluatePassport({
    profile: { first_name: "Juan", last_name: "Dela Cruz" },
    requireBirthDate: false,
  });

  assert.equal(result.status, "verified");
  assert.equal(result.checks.nameMatches, true);
  assert.equal(result.checks.birthDateMatches, null);
});

test("document type aliases are explicit and never fuzzy closest-type matches", () => {
  assert.equal(resolveSupportedDocumentType("Passport", "id"), "Philippine Passport");
  assert.equal(resolveSupportedDocumentType("Passport photo", "id"), "");
  assert.equal(resolveSupportedDocumentType("UNKNOWN", "id"), "");
});

test("the Gemini instruction requires UNKNOWN and does not reveal the selected type", () => {
  const instruction = buildDocumentExtractionInstruction({ docType: "id" });
  assert.match(instruction, /document_type="UNKNOWN"/);
  assert.match(instruction, /plain sheet of paper/i);
  assert.match(instruction, /Do not choose the closest allowed type/i);
  assert.doesNotMatch(instruction, /The applicant selected:/i);
});

test("incomplete AI responses are provider failures and cannot become verification decisions", () => {
  assert.throws(
    () => normalizeDocumentInspection({ image_readable: true }),
    (error) => error?.status === 503 && /incomplete response/i.test(error.message),
  );
  const normalized = normalizeDocumentInspection(validIdExtraction);
  assert.equal(normalized.recognized_document, true);
  assert.equal(normalized.document_type, "Philippine Passport");
});

test("document numbers are masked and fingerprinted only after hard gates pass", () => {
  const originalSecret = process.env.KYC_DOCUMENT_FINGERPRINT_SECRET;
  process.env.KYC_DOCUMENT_FINGERPRINT_SECRET = "test-only-document-secret";
  try {
    const result = evaluatePassport();
    assert.equal(result.extractedData.documentNumberMasked, "**** 567A");
    assert.equal(JSON.stringify(result).includes("P1234567A"), false);
    assert.equal(result.documentNumberFingerprint, createDocumentFingerprint("P-1234 567A"));
  } finally {
    if (originalSecret === undefined) delete process.env.KYC_DOCUMENT_FINGERPRINT_SECRET;
    else process.env.KYC_DOCUMENT_FINGERPRINT_SECRET = originalSecret;
  }
});

const supportingExtraction = {
  ...validIdExtraction,
  document_type: "BIR Notice to Issue Receipt/Invoice",
  document_surface: "OFFICIAL_DIGITAL_DOCUMENT",
  structural_features: {
    ...passportStructure,
    holder_portrait_present: false,
    document_number_region_present: false,
    birth_date_region_present: false,
    expiration_date_region_present: false,
    machine_readable_zone_present: false,
    business_registration_features_present: true,
  },
  extracted_data: {
    business_name: "Maria's Motors",
    full_name: "Maria Cruz",
    tax_identification_number: "123456789",
    branch_code: "00000",
    document_number: "",
    permit_number: "",
  },
};

const evaluateSupporting = (selectedDocType, extraction, suppliedProfile) => evaluateDocumentExtraction({
  extraction,
  docType: "supporting",
  selectedDocType,
  profile: suppliedProfile,
  allowAutomaticVerification: true,
  now: new Date("2026-01-01T00:00:00.000Z"),
});

test("BIR notice uses visible TIN and branch code without inventing a permit number", () => {
  const inspection = normalizeDocumentInspection(supportingExtraction);
  assert.equal(inspection.extracted_data.tax_identification_number, "123456789");
  assert.equal(inspection.extracted_data.branch_code, "00000");
  assert.match(buildDocumentExtractionInstruction({ docType: "supporting" }), /Do not treat a TIN as a permit number/);
  const result = evaluateSupporting("BIR Notice to Issue Receipt/Invoice", supportingExtraction, {
    business_name: "Maria's Motors",
    tax_identification_number: "123456789",
    branch_code: "00000",
  });
  assert.equal(result.status, "verified");
  assert.equal(result.checks.structuralFeaturesPresent, true);
  assert.equal(result.checks.permitNumberMatches, true);
  assert.equal(result.extractedData.documentNumberMasked, "**** 0000");
  assert.equal(JSON.stringify(result).includes("123456789"), false);

  const mismatch = evaluateSupporting("BIR Notice to Issue Receipt/Invoice", supportingExtraction, {
    business_name: "Maria's Motors",
    tax_identification_number: "123456789",
    branch_code: "00001",
  });
  assert.equal(mismatch.status, "pending_review");
  assert.deepEqual(mismatch.mismatchFields, ["TIN or branch code"]);
});

test("BIR certificate requires both visible TIN and branch code", () => {
  const extraction = { ...supportingExtraction, document_type: "BIR Certificate of Registration (Form 2303)" };
  const result = evaluateSupporting(extraction.document_type, extraction, {
    business_name: "Maria's Motors", tax_identification_number: "123456789", branch_code: "00000",
  });
  assert.equal(result.status, "verified");
  const missingBranch = evaluateSupporting(extraction.document_type, {
    ...extraction,
    structural_features: { ...extraction.structural_features, document_number_region_present: true },
    extracted_data: { ...extraction.extracted_data, branch_code: "" },
  }, {
    business_name: "Maria's Motors", tax_identification_number: "123456789", branch_code: "00000",
  });
  assert.equal(missingBranch.status, "reupload_required");
  assert.equal(missingBranch.reasonCode, DOCUMENT_REASON_CODES.REQUIRED_FIELDS_MISSING);
});

test("permit documents still compare their permit number, while numberless clearance needs review", () => {
  const permit = evaluateSupporting("Mayor's/Business Permit", {
    ...supportingExtraction,
    document_type: "Mayor's/Business Permit",
    structural_features: { ...supportingExtraction.structural_features, document_number_region_present: true },
    extracted_data: { business_name: "Maria's Motors", permit_number: "MP-123", document_number: "MP-123" },
  }, { business_name: "Maria's Motors", permit_number: "MP-123" });
  assert.equal(permit.status, "verified");

  const clearance = evaluateSupporting("Barangay Business Clearance", {
    ...supportingExtraction,
    document_type: "Barangay Business Clearance",
    extracted_data: { business_name: "Maria's Motors", document_number: "", permit_number: "" },
  }, { business_name: "Maria's Motors", permit_number: "" });
  assert.equal(clearance.status, "pending_review");
  assert.equal(clearance.reasonCode, DOCUMENT_REASON_CODES.REVIEW_REQUIRED);
  assert.equal(clearance.checks.requiredFieldsPresent, true);
});
