import test from "node:test";
import assert from "node:assert/strict";
import { ID_DOCUMENT_TYPES, SUPPORTING_DOCUMENT_TYPES } from "../services/documentValidation.service.js";
import { detectPrivateDocumentTypes, evaluatePrivateDocumentInspection } from "../services/privateDocumentExtraction.service.js";
import { prepareManualDocumentComparison, hasCurrentManualDocumentComparison } from "../services/manualDocumentComparison.js";
import { isIdentityReadyForSelfie } from "../utils/preKycDocs.js";

const examples = new Map([
  ["PhilSys National ID", ["PAMBANSANG PAGKAKAKILANLAN"]],
  ["Philippine Passport", ["REPUBLIC OF THE PHILIPPINES", "PASAPORTE / PASSPORT"]],
  ["LTO Driver's License", ["LAND TRANSPORTATION OFFICE", "DRIVER'S LICENSE"]],
  ["UMID", ["UNIFIED MULTI-PURPOSE ID", "SOCIAL SECURITY SYSTEM"]],
  ["PRC ID", ["PROFESSIONAL REGULATION COMMISSION", "PROFESSIONAL IDENTIFICATION CARD"]],
  ["SSS ID", ["SOCIAL SECURITY SYSTEM", "SSS IDENTIFICATION CARD"]],
  ["GSIS ID", ["GOVERNMENT SERVICE INSURANCE SYSTEM", "GSIS E-CARD"]],
  ["PhilHealth ID", ["PHILIPPINE HEALTH INSURANCE CORPORATION", "PHILHEALTH IDENTIFICATION CARD"]],
  ["Postal ID", ["PHILIPPINE POSTAL CORPORATION", "POSTAL ID"]],
  ["Voter's ID", ["COMMISSION ON ELECTIONS", "VOTER'S IDENTIFICATION CARD"]],
  ["DTI Business Name Registration", ["DEPARTMENT OF TRADE AND INDUSTRY", "CERTIFICATE OF BUSINESS NAME REGISTRATION"]],
  ["SEC Certificate of Registration", ["SECURITIES AND EXCHANGE COMMISSION", "CERTIFICATE OF INCORPORATION"]],
  ["Mayor's/Business Permit", ["MAYOR'S / BUSINESS PERMIT"]],
  ["BIR Certificate of Registration (Form 2303)", ["BUREAU OF INTERNAL REVENUE", "CERTIFICATE OF REGISTRATION", "BIR FORM 2303"]],
  ["BIR Notice to Issue Receipt/Invoice", ["BUREAU OF INTERNAL REVENUE", "NOTICE TO ISSUE RECEIPT / INVOICE"]],
  ["Barangay Business Clearance", ["BARANGAY SAMPLE", "BUSINESS CLEARANCE"]],
  ["CDA Certificate of Registration", ["COOPERATIVE DEVELOPMENT AUTHORITY", "CERTIFICATE OF REGISTRATION"]],
]);
const details = ["Full Name: SAMPLE APPLICANT", "Date of Birth: 1990-05-12", "Document Number: SYNTHETIC123",
  "Expiration Date: 2099-05-12", "Business Name: SAMPLE RENTALS", "Permit Number: TEST123", "TIN: 123456789", "Branch Code: 00000"];
const profile = { first_name: "Sample", last_name: "Applicant", date_of_birth: "1990-05-12", business_name: "Sample Rentals",
  permit_number: "TEST123", tax_identification_number: "123456789", branch_code: "00000" };
const inspection = (texts, confidence = 0.98, page = 1) => ({ schema_version: 1, pages: page,
  lines: texts.map((text) => ({ text, confidence, page })) });
const category = (type) => ID_DOCUMENT_TYPES.includes(type) ? "id" : "supporting";
const assess = (texts, selected = "Philippine Passport", extra = {}) => evaluatePrivateDocumentInspection({
  inspection: inspection(texts), docType: category(selected), selectedDocType: selected, profile,
  fileHash: "fixture-hash", reviewVersion: "fixture-version", ...extra,
});

test("all 17 existing document types are recognized independently before matching registration details", async (t) => {
  assert.deepEqual([...examples.keys()], [...ID_DOCUMENT_TYPES, ...SUPPORTING_DOCUMENT_TYPES]);
  for (const [type, headings] of examples) {
    await t.test(type, () => {
      const result = assess([...headings, ...details], type);
      assert.equal(result.checks.documentTypeMatches, true);
      assert.equal(result.extractedData.documentType, type);
      assert.equal(result.privateScreening.preliminaryComparison.nameMatches, true);
      assert.equal(result.privateScreening.preliminaryComparison.permitNumberMatches, true);
      assert.equal(result.status, "pending_review");
      assert.equal(result.checks.registrationDataCompared, false);
      assert.equal(result.privateScreening.typeCheck.fileHash, "fixture-hash");
      assert.equal(result.privateScreening.typeCheck.reviewVersion, "fixture-version");
    });
  }
});

test("matching names and business details cannot override any wrong type across the 17-type matrix", () => {
  for (const [actual, headings] of examples) {
    for (const selected of examples.keys()) {
      if (actual === selected) continue;
      const result = assess([...headings, ...details], selected);
      assert.equal(result.status, "reupload_required", `${actual} selected as ${selected}`);
      assert.equal(result.reasonCode, "DOCUMENT_TYPE_MISMATCH");
      assert.equal(result.checks.documentTypeMatches, false);
      assert.equal(result.privateScreening.preliminaryComparison.nameMatches, null);
      assert.equal(result.privateScreening.preliminaryComparison.birthDateMatches, null);
      assert.equal(result.privateScreening.preliminaryComparison.permitNumberMatches, null);
    }
  }
});

test("personal details, an issuer alone, unsupported IDs and type names inside data fields cannot establish a type", () => {
  for (const texts of [details, ["SOCIAL SECURITY SYSTEM", ...details], ["STUDENT IDENTIFICATION CARD", ...details],
    ["Full Name: PHILIPPINE PASSPORT", ...details], ["Business Name: DTI Business Name Registration", ...details],
    ["This person requests a Philippine Passport", ...details]]) {
    const result = assess(texts);
    assert.equal(result.status, "reupload_required");
    assert.equal(result.reasonCode, "UNRECOGNIZED_DOCUMENT");
    assert.equal(result.checks.documentTypeMatches, false);
    assert.equal(result.privateScreening.preliminaryComparison.nameMatches, null);
  }
});

test("conflicting types across ID/business categories or PDF pages are not hidden by the selected category", () => {
  const passport = examples.get("Philippine Passport");
  const business = examples.get("DTI Business Name Registration");
  const mixed = { schema_version: 1, pages: 2,
    lines: [...inspection([...passport, ...details]).lines, ...inspection(business, 0.98, 2).lines] };
  for (const selected of ["Philippine Passport", "DTI Business Name Registration"]) {
    const result = assess([], selected, { inspection: mixed });
    assert.equal(result.status, "reupload_required");
    assert.equal(result.privateScreening.typeCheck.detectedTypes.length, 2);
    assert.equal(result.privateScreening.preliminaryComparison.nameMatches, null);
  }
});

test("issuer references and a Philippine birthplace cannot turn another document into the selected type", () => {
  const foreign = assess(["UNITED STATES OF AMERICA", "PASSPORT", "Place of birth: PHILIPPINES", ...details]);
  assert.equal(foreign.status, "reupload_required");
  assert.equal(foreign.checks.documentTypeMatches, false);
  const reference = assess(["CERTIFICATE OF REGISTRATION", "Submit this to the Department of Trade and Industry", ...details], "DTI Business Name Registration");
  assert.equal(reference.status, "reupload_required");
  const permit = assess(["BUSINESS PERMIT", "Registered with the Department of Trade and Industry", ...details], "Mayor's/Business Permit");
  assert.equal(permit.checks.documentTypeMatches, true);
});

test("UMID co-issuing agencies do not masquerade as extra ID types, while a separate SSS card is conflicting", () => {
  const umid = ["UNIFIED MULTI-PURPOSE ID", "IDENTIFICATION CARD", "SOCIAL SECURITY SYSTEM",
    "GOVERNMENT SERVICE INSURANCE SYSTEM", "PHILHEALTH"];
  assert.deepEqual(detectPrivateDocumentTypes(inspection(umid)).map((match) => match.type), ["UMID"]);
  const mixed = { schema_version: 1, pages: 2,
    lines: [...inspection(umid).lines, ...inspection(examples.get("SSS ID"), 0.98, 2).lines] };
  assert.equal(assess([], "UMID", { inspection: mixed }).status, "reupload_required");
});

test("low-confidence type evidence requires review and cannot produce a positive personal-data comparison", () => {
  const low = { ...inspection(details), lines: [...inspection(examples.get("Philippine Passport"), 0.6).lines, ...inspection(details).lines] };
  const result = assess([], "Philippine Passport", { inspection: low });
  assert.equal(result.status, "pending_review");
  assert.equal(result.checks.classificationConfident, false);
  assert.equal(result.checks.documentTypeMatches, false);
  assert.equal(result.privateScreening.preliminaryComparison.nameMatches, null);
});

const pending = (extra = {}) => ({ provider: "private-ocr", status: "pending_review", docType: "id", role: "user",
  selectedDocCategory: "Philippine Passport", fileHash: "fixture-hash", reviewVersion: "fixture-version",
  fileKey: "fixture.jpg", profileSnapshot: profile, ...extra });
const manualInput = { fileHash: "fixture-hash", reviewVersion: "fixture-version", documentType: "Philippine Passport",
  issuingCountry: "PH", remarks: "Inspected the original document type and all identity details.",
  fields: { full_name: "SAMPLE APPLICANT", birth_date: "1990-05-12", document_number: "SYNTHETIC123", expiration_date: "2099-05-12" },
  confirmations: { readable: true, original: true, officialLayout: true, officialMarkings: true,
    noVisibleAlteration: true, holderPortrait: true, machineReadableZone: true } };

test("admin selection and matching fields cannot override stored wrong, unknown, ambiguous, or stale OCR type evidence", (t) => {
  const previous = process.env.KYC_DOCUMENT_FINGERPRINT_SECRET;
  process.env.KYC_DOCUMENT_FINGERPRINT_SECRET = "f".repeat(32);
  t.after(() => { if (previous === undefined) delete process.env.KYC_DOCUMENT_FINGERPRINT_SECRET; else process.env.KYC_DOCUMENT_FINGERPRINT_SECRET = previous; });
  for (const texts of [examples.get("PRC ID"), details, [...examples.get("Philippine Passport"), ...examples.get("DTI Business Name Registration")]]) {
    const privateScreening = assess(texts).privateScreening;
    assert.throws(() => prepareManualDocumentComparison(pending({ privateScreening }), manualInput, "fixture-admin"), /document type/);
  }
  const valid = pending({ privateScreening: assess(examples.get("Philippine Passport")).privateScreening });
  const comparison = prepareManualDocumentComparison(valid, manualInput, "fixture-admin");
  assert.equal(comparison.validationChecks.documentTypeMatches, true);
  assert.equal(hasCurrentManualDocumentComparison({ ...valid, ...comparison }), true);
  assert.equal(hasCurrentManualDocumentComparison(null), false);
  assert.equal(hasCurrentManualDocumentComparison({ ...valid, ...comparison, provider: "manual", fileHash: undefined, manualComparison: undefined }), false);
  assert.equal(isIdentityReadyForSelfie({ ...valid, ...comparison }), true);
  assert.throws(() => prepareManualDocumentComparison({ ...valid, fileHash: "replacement" }, { ...manualInput, fileHash: "replacement" }, "fixture-admin"), /stale/);
  assert.equal(hasCurrentManualDocumentComparison({ ...valid, ...comparison, privateScreening: assess(examples.get("PRC ID")).privateScreening }), false);
  assert.equal(isIdentityReadyForSelfie(pending({ detailsMatched: true, manualComparison: { fileHash: "fixture-hash", reviewVersion: "fixture-version" } })), false);
  assert.equal(isIdentityReadyForSelfie(pending({ status: "verified", detailsMatched: true })), true);
});
