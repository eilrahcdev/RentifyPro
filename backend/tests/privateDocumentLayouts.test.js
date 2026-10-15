import test from "node:test";
import assert from "node:assert/strict";
import { ID_DOCUMENT_TYPES, SUPPORTING_DOCUMENT_TYPES } from "../services/documentValidation.service.js";
import { evaluatePrivateDocumentInspection, extractPrivateDocumentFields } from "../services/privateDocumentExtraction.service.js";
import { strictPrivateIdentityNameMatch, PRIVATE_AUTOMATED_CHECK_VERSION } from "../services/privateDocumentLayout.service.js";
import { prepareManualDocumentComparison } from "../services/manualDocumentComparison.js";

const profile = { first_name: "Sample", last_name: "Applicant", date_of_birth: "1990-05-12",
  business_name: "Sample Rentals", permit_number: "REG12345", tax_identification_number: "123456789", branch_code: "00000" };
const line = (text, bbox = [0.1, 0.1, 0.9, 0.13], confidence = 0.999) => ({ text, bbox, confidence, page: 1 });
const inspection = (lines) => ({ schema_version: 1, layout_version: 2, pages: 1, lines });
const headings = [
  ["PAMBANSANG PAGKAKAKILANLAN"], ["REPUBLIC OF THE PHILIPPINES", "PASSPORT"],
  ["LAND TRANSPORTATION OFFICE", "DRIVER'S LICENSE"], ["UNIFIED MULTI-PURPOSE ID"],
  ["PROFESSIONAL REGULATION COMMISSION", "PROFESSIONAL IDENTIFICATION CARD"],
  ["SOCIAL SECURITY SYSTEM", "SSS IDENTIFICATION CARD"], ["GOVERNMENT SERVICE INSURANCE SYSTEM", "GSIS E-CARD"],
  ["PHILIPPINE HEALTH INSURANCE CORPORATION", "PHILHEALTH IDENTIFICATION CARD"],
  ["PHILIPPINE POSTAL CORPORATION", "POSTAL ID"], ["COMMISSION ON ELECTIONS", "VOTER'S IDENTIFICATION CARD"],
  ["DEPARTMENT OF TRADE AND INDUSTRY", "CERTIFICATE OF BUSINESS NAME REGISTRATION"],
  ["SECURITIES AND EXCHANGE COMMISSION", "CERTIFICATE OF INCORPORATION"], ["BUSINESS PERMIT"],
  ["BUREAU OF INTERNAL REVENUE", "CERTIFICATE OF REGISTRATION", "BIR FORM 2303"],
  ["BUREAU OF INTERNAL REVENUE", "NOTICE TO ISSUE RECEIPT / INVOICE"],
  ["BARANGAY SAMPLE", "BUSINESS CLEARANCE"], ["COOPERATIVE DEVELOPMENT AUTHORITY", "CERTIFICATE OF REGISTRATION"],
];
const types = [...ID_DOCUMENT_TYPES, ...SUPPORTING_DOCUMENT_TYPES];
const assess = (type, lines, options = {}) => evaluatePrivateDocumentInspection({ inspection: inspection(lines),
  docType: ID_DOCUMENT_TYPES.includes(type) ? "id" : "supporting", selectedDocType: type, profile,
  fileHash: "synthetic-hash", reviewVersion: "synthetic-revision", now: new Date("2026-10-14T00:00:00Z"), ...options });

test("LTO combined name heading and merged value rows extract each field from its own column", () => {
  const lines = [line("LAND TRANSPORTATION OFFICE"), line("DRIVER'S LICENSE"),
    line("Last Name. First Name. Middle Name", [0.45, 0.3, 0.8, 0.32]),
    line("APPLICANT, SAMPLE OTHER", [0.45, 0.315, 0.9, 0.345]),
    line("Nationality", [0.45, 0.4, 0.53, 0.42]), line("Sex", [0.56, 0.4, 0.6, 0.42]),
    line("Date of Birth", [0.62, 0.4, 0.75, 0.42]), line("Weight (kg)", [0.77, 0.4, 0.86, 0.42]),
    line("PHL", [0.45, 0.43, 0.51, 0.46]), line("M", [0.56, 0.43, 0.59, 0.46]),
    line("1990/05/12", [0.62, 0.43, 0.75, 0.46]),
    line("License No.", [0.45, 0.6, 0.57, 0.62]), line("Expiration Date", [0.65, 0.6, 0.79, 0.62]),
    line("Agency Code", [0.81, 0.6, 0.93, 0.62]),
    line("A01-23-004567 2099/05/12 A01", [0.45, 0.615, 0.94, 0.645])];
  const fields = extractPrivateDocumentFields(inspection(lines));
  assert.equal(fields.data.full_name, "APPLICANT, SAMPLE OTHER");
  assert.equal(fields.data.document_number, "A01-23-004567");
  assert.equal(fields.data.birth_date, "1990-05-12");
  assert.equal(fields.data.expiration_date, "2099-05-12");
  assert.equal(assess("LTO Driver's License", lines).privateScreening.automatedCheck.outcome, "passed");
  assert.equal(assess("LTO Driver's License", lines, { profile: { ...profile, last_name: "Different" } }).reasonCode, "IDENTITY_DATA_MISMATCH");
});

test("name matching respects complete name boundaries and compound surnames in both orders", () => {
  for (const name of ["APPLICANT, SAMPLE OTHER", "SAMPLE OTHER APPLICANT", "APPLICANT SAMPLE OTHER"])
    assert.equal(strictPrivateIdentityNameMatch(profile, name), true, name);
  for (const name of ["APPLICANTSON SAMPLE", "APPLICANT SAMPLER", "WRONG APPLICANT SAMPLE"])
    assert.equal(strictPrivateIdentityNameMatch(profile, name), false, name);
  assert.equal(strictPrivateIdentityNameMatch({ first_name: "Sample", last_name: "Dela Cruz" }, "DE LA CRUZ, SAMPLE OTHER"), true);
  assert.equal(strictPrivateIdentityNameMatch({ first_name: "Sample", last_name: "Dela Cruz" }, "SAMPLE OTHER DE LA CRUZ"), true);
  assert.equal(strictPrivateIdentityNameMatch({ first_name: "Sample", last_name: "Cruz" }, "DE LA CRUZ, SAMPLE OTHER"), false);
});

test("DTI narrative issuer, unlabeled business name, validity period and Business Name No. are distinct", () => {
  const lines = [line("This certifies that", [0.4, 0.12, 0.6, 0.14]),
    line("SAMPLE RENTALS", [0.3, 0.16, 0.7, 0.2]),
    line("(CITY/MUNICIPALITY)", [0.3, 0.22, 0.7, 0.24]),
    line("prescribed by the Department of Trade and Industry.", [0.15, 0.3, 0.85, 0.32]),
    line("This certificate issued to", [0.3, 0.35, 0.7, 0.37]),
    line("SAMPLE OTHER APPLICANT", [0.2, 0.4, 0.8, 0.43]),
    line("is valid from May 12, 2020 to May 12, 2099 subject to continuing compliance", [0.1, 0.5, 0.9, 0.53]),
    line("Certificate of Business Name Registration", [0.15, 0.65, 0.85, 0.68]),
    line("Business Name No.1234567", [0.3, 0.8, 0.7, 0.83])];
  const fields = extractPrivateDocumentFields(inspection(lines), "supporting");
  assert.equal(fields.candidateType, "DTI Business Name Registration");
  assert.equal(fields.data.business_name, "SAMPLE RENTALS");
  assert.equal(fields.data.permit_number, "1234567");
  assert.equal(fields.data.full_name, "SAMPLE OTHER APPLICANT");
  assert.equal(fields.data.expiration_date, "2099-05-12");
  assert.equal(assess("DTI Business Name Registration", lines, { profile: { ...profile, permit_number: "1234567" } }).privateScreening.automatedCheck.outcome, "passed");
});

test("all 17 categories recognize their field aliases without moving registration or expiry gates", async (t) => {
  const numberLabels = ["PCN", "Passport No.", "License No.", "CRN", "Registration No.", "SS Number", "BP Number", "PIN", "PRN", "VIN",
    "Business Name No.", "Company Registration No.", "Business Permit No.", "Certificate No.", "Certificate No.", "Clearance No.", "Cooperative Registration No."];
  for (const [index, type] of types.entries()) await t.test(type, () => {
    const lines = [...headings[index].map((text) => line(text)), line("Full Name: SAMPLE OTHER APPLICANT"),
      line("Araw ng Kapanganakan: May 12, 1990"), line(`${numberLabels[index]}: REG12345`), line("Valid Until: May 12, 2099"),
      line(`${type === "CDA Certificate of Registration" ? "Name of Coop." : "Trade Name"}: SAMPLE RENTALS`),
      line("Taxpayer Identification Number: 123-456-789"), line("Branch Code: 00000")];
    const decision = assess(type, lines);
    assert.equal(decision.privateScreening.automatedCheck.outcome, "passed");
    assert.equal(decision.status, "pending_review");
    assert.equal(decision.checks.registrationDataCompared, false);
    assert.equal(decision.privateScreening.automatedCheck.version, PRIVATE_AUTOMATED_CHECK_VERSION);
  });
});

test("BIR captions below values, combined TIN and branch code and wrapped entity names retain evidence", () => {
  const lines = [line("BUREAU OF INTERNAL", [0.1, 0.01, 0.9, 0.03]), line("REVENUE", [0.1, 0.035, 0.9, 0.055]),
    line("NOTICE TO ISSUE", [0.1, 0.07, 0.9, 0.09]), line("RECEIPT / INVOICE", [0.1, 0.095, 0.9, 0.115]),
    line("SAMPLE RENTALS", [0.25, 0.2, 0.75, 0.23]), line("Business Name", [0.35, 0.24, 0.65, 0.26]),
    line("123-456-789-00000", [0.3, 0.35, 0.7, 0.38]), line("TIN and Branch Code", [0.3, 0.39, 0.7, 0.41])];
  const extracted = extractPrivateDocumentFields(inspection(lines), "supporting");
  assert.equal(extracted.data.business_name, "SAMPLE RENTALS");
  assert.equal(extracted.data.tax_identification_number, "123456789");
  assert.equal(extracted.data.branch_code, "00000");
  assert.equal(assess("BIR Notice to Issue Receipt/Invoice", lines).privateScreening.automatedCheck.outcome, "passed");
  lines[6].text = "123-XXX-789-00000";
  const masked = assess("BIR Notice to Issue Receipt/Invoice", lines);
  assert.equal(masked.status, "pending_review");
  assert.equal(masked.privateScreening.automatedCheck.outcome, "review_needed");
  const wrapped = [...headings[11].map((text) => line(text)), line("Company Name", [0.1, 0.2, 0.3, 0.22]),
    line("SAMPLE RENTALS", [0.1, 0.23, 0.5, 0.26]), line("INCORPORATED", [0.1, 0.27, 0.5, 0.3]),
    line("Company Registration No.: REG12345", [0.1, 0.32, 0.6, 0.35])];
  assert.equal(extractPrivateDocumentFields(inspection(wrapped), "supporting").data.business_name, "SAMPLE RENTALS INCORPORATED");
});

test("BIR posted receipt notice uses its actual title and official contact evidence without inferring a masked TIN", () => {
  const lines = [line("This establishment MUST issue", [0.1, 0.01, 0.9, 0.1]),
    line("RECEIPT/INVOICE", [0.15, 0.12, 0.85, 0.21]),
    line("for each service rendered/ sale of goods.", [0.02, 0.22, 0.98, 0.31]),
    line("SAMPLE RENTALS", [0.27, 0.32, 0.67, 0.4]), line("Business Name", [0.42, 0.39, 0.58, 0.43]),
    line("OTHER PERSON", [0.25, 0.44, 0.6, 0.52]), line("Registered Name", [0.4, 0.51, 0.58, 0.56]),
    line("TIN and Branch Code", [0.38, 0.64, 0.6, 0.68]), line("口 contact_us@bir.gov.ph", [0.4, 0.8, 0.8, 0.84])];
  const extracted = extractPrivateDocumentFields(inspection(lines), "supporting");
  assert.equal(extracted.candidateType, "BIR Notice to Issue Receipt/Invoice");
  assert.equal(extracted.data.business_name, "SAMPLE RENTALS");
  assert.equal(extracted.data.tax_identification_number, undefined);
  assert.equal(assess("BIR Notice to Issue Receipt/Invoice", lines).privateScreening.automatedCheck.outcome, "review_needed");
  const unrelated = lines.filter((entry) => !entry.text.includes("@bir.gov.ph"));
  assert.equal(assess("BIR Notice to Issue Receipt/Invoice", unrelated).reasonCode, "UNRECOGNIZED_DOCUMENT");
});

test("validity aliases cannot hide an expired document and absent required expiry stays unknown", () => {
  for (const type of ["PRC ID", "Postal ID", "DTI Business Name Registration", "Mayor's/Business Permit"]) {
    const lines = [...headings[types.indexOf(type)].map((text) => line(text)), line("Full Name: SAMPLE APPLICANT"),
      line("Birth Date: 1990-05-12"), line("Document Number: REG12345"), line("Business Name: SAMPLE RENTALS"), line("Permit No.: REG12345")];
    const missing = assess(type, lines);
    assert.equal(missing.privateScreening.automatedCheck.outcome, "review_needed", type);
    assert.equal(missing.privateScreening.automatedCheck.checks.validity, null, type);
    assert.equal(assess(type, [...lines, line("Validity: 2000-05-12")]).reasonCode, "DOCUMENT_EXPIRED", type);
  }
  const noExpiry = assess("UMID", [...headings[3].map((text) => line(text)), line("Full Name: SAMPLE APPLICANT"),
    line("Birth Date: 1990-05-12"), line("CRN: REG12345")]);
  assert.equal(noExpiry.privateScreening.automatedCheck.outcome, "passed");
});

test("ambiguous dates and low confidence remain reviewable without claiming the image has glare", () => {
  const lines = [...headings[4].map((text) => line(text)), line("Full Name: SAMPLE APPLICANT"),
    line("Registration No.: REG12345"), line("Valid Until: 11/25/2099")];
  const missingBirthDate = assess("PRC ID", lines);
  assert.equal(missingBirthDate.status, "pending_review");
  assert.equal(missingBirthDate.privateScreening.automatedCheck.outcome, "review_needed");
  assert.match(missingBirthDate.reviewReason, /birth date.*another accepted ID/i);
  assert.equal(assess("PRC ID", lines, { profile: { first_name: "Sample", last_name: "Applicant" }, requireBirthDate: false }).privateScreening.automatedCheck.outcome, "passed");
  lines.push(line("Birth Date: 1990-05-12", undefined, 0.7));
  const low = assess("PRC ID", lines);
  assert.equal(low.privateScreening.automatedCheck.outcome, "review_needed");
  assert.equal(low.privateScreening.automatedCheck.checks.registrationDetails, null);
  assert.match(low.reviewReason, /administrator/);
  lines.find((entry) => entry.text.startsWith("Valid Until")).text = "Valid Until: 05/12/2099";
  const ambiguous = extractPrivateDocumentFields(inspection(lines));
  assert.equal(ambiguous.data.expiration_date, "");
});

test("manual comparison must also include expiry for a category that requires it", (t) => {
  const previous = process.env.KYC_DOCUMENT_FINGERPRINT_SECRET;
  process.env.KYC_DOCUMENT_FINGERPRINT_SECRET = "f".repeat(32);
  t.after(() => { if (previous === undefined) delete process.env.KYC_DOCUMENT_FINGERPRINT_SECRET; else process.env.KYC_DOCUMENT_FINGERPRINT_SECRET = previous; });
  const document = { provider: "private-ocr", status: "pending_review", docType: "supporting", role: "owner",
    selectedDocCategory: "DTI Business Name Registration", fileHash: "synthetic-hash", reviewVersion: "synthetic-revision",
    fileKey: "synthetic.jpg", profileSnapshot: profile };
  const input = { documentType: document.selectedDocCategory, fileHash: document.fileHash, reviewVersion: document.reviewVersion,
    issuingCountry: "PH", remarks: "Inspected the original certificate and its registration details.",
    fields: { business_name: "SAMPLE RENTALS", permit_number: "REG12345" },
    confirmations: { readable: true, original: true, officialLayout: true, officialMarkings: true, noVisibleAlteration: true } };
  assert.throws(() => prepareManualDocumentComparison(document, input, "synthetic-admin"), /expiry/i);
  assert.equal(prepareManualDocumentComparison(document, { ...input, fields: { ...input.fields, expiration_date: "2099-05-12" } }, "synthetic-admin").detailsMatched, true);
  assert.throws(() => prepareManualDocumentComparison(document, { ...input, fields: { ...input.fields, expiration_date: "2000-05-12" } }, "synthetic-admin"), /expired/i);
  assert.throws(() => prepareManualDocumentComparison(document, { ...input, fields: { ...input.fields, business_name: "SAMPLE", expiration_date: "2099-05-12" } }, "synthetic-admin"), /complete name/i);
  assert.throws(() => prepareManualDocumentComparison(document, { ...input, fields: { ...input.fields, issue_date: "2098-05-12", expiration_date: "2099-05-12" } }, "synthetic-admin"), /currently valid/i);
});

test("invalid repeated dates and future issue dates cannot establish current validity", () => {
  const lines = [...headings[11].map((text) => line(text)), line("Business Name: SAMPLE RENTALS"),
    line("Company Registration No.: REG12345"), line("Valid Until: 2099-05-12")];
  const repeated = assess("SEC Certificate of Registration", [...lines, line("Validity: 2099-02-31")]);
  assert.equal(repeated.privateScreening.automatedCheck.outcome, "review_needed");
  assert.equal(repeated.privateScreening.automatedCheck.checks.validity, null);
  const future = assess("SEC Certificate of Registration", [...lines, line("Registration Date: 2098-05-12")]);
  assert.equal(future.privateScreening.automatedCheck.outcome, "review_needed");
  assert.equal(future.privateScreening.automatedCheck.checks.validity, false);
  assert.equal(future.privateScreening.automatedCheck.checks.registrationDetails, null);
});

test("adjacent columns and contradictory labelled names never substitute another person's identity", () => {
  const lines = [...headings[4].map((text) => line(text)), line("Name: SAMPLE OTHER APPLICANT"),
    line("Given Names: SAMPLE"), line("Surname: WRONG"), line("Birth Date: 1990-05-12"),
    line("Registration No.: REG12345"), line("Valid Until: 2099-05-12")];
  assert.equal(assess("PRC ID", lines).reasonCode, "IDENTITY_DATA_MISMATCH");
  lines.find((entry) => entry.text.startsWith("Surname")).confidence = 0.7;
  const uncertainComponent = assess("PRC ID", lines);
  assert.equal(uncertainComponent.privateScreening.automatedCheck.outcome, "review_needed");
  assert.equal(uncertainComponent.privateScreening.automatedCheck.checks.registrationDetails, null);
  const samePage = [...headings[4].map((text) => line(text)), line("Surname", [0.4, 0.2, 0.55, 0.22]),
    line("APPLICANT", [0.4, 0.23, 0.6, 0.26]), line("Given Names", [0.4, 0.3, 0.55, 0.32]),
    line("SAMPLE", [0.4, 0.33, 0.6, 0.36]), line("Birth Date", [0.4, 0.4, 0.55, 0.42]),
    line("1990-05-12", [0.75, 0.43, 0.9, 0.46])];
  assert.equal(extractPrivateDocumentFields(inspection(samePage)).data.birth_date, "");
});
