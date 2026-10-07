import test from "node:test";
import assert from "node:assert/strict";
import { ID_DOCUMENT_TYPES, SUPPORTING_DOCUMENT_TYPES } from "../services/documentValidation.service.js";
import { evaluatePrivateDocumentInspection, extractPrivateDocumentFields } from "../services/privateDocumentExtraction.service.js";
import { normalizePrivateOcrResponse } from "../services/privateKycOcr.service.js";
import { publicPrivateScreening, hasCurrentPrivateAutomatedMatch } from "../services/privateDocumentLayout.service.js";
import { isIdentityReadyForSelfie } from "../utils/preKycDocs.js";

const headings = [
  ["PAMBANSANG PAGKAKAKILANLAN"], ["REPUBLIC OF THE PHILIPPINES", "PASAPORTE / PASSPORT"],
  ["LAND TRANSPORTATION OFFICE", "DRIVER'S LICENSE"], ["UNIFIED MULTI-PURPOSE ID", "SOCIAL SECURITY SYSTEM"],
  ["PROFESSIONAL REGULATION COMMISSION", "PROFESSIONAL IDENTIFICATION CARD"],
  ["SOCIAL SECURITY SYSTEM", "SSS IDENTIFICATION CARD"], ["GOVERNMENT SERVICE INSURANCE SYSTEM", "GSIS E-CARD"],
  ["PHILIPPINE HEALTH INSURANCE CORPORATION", "PHILHEALTH IDENTIFICATION CARD"],
  ["PHILIPPINE POSTAL CORPORATION", "POSTAL ID"], ["COMMISSION ON ELECTIONS", "VOTER'S IDENTIFICATION CARD"],
  ["DEPARTMENT OF TRADE AND INDUSTRY", "CERTIFICATE OF BUSINESS NAME REGISTRATION"],
  ["SECURITIES AND EXCHANGE COMMISSION", "CERTIFICATE OF INCORPORATION"],
  ["CITY OF SAMPLE", "BUSINESS PERMIT"], ["BUREAU OF INTERNAL REVENUE", "CERTIFICATE OF REGISTRATION", "BIR FORM 2303"],
  ["BUREAU OF INTERNAL REVENUE", "NOTICE TO ISSUE RECEIPT / INVOICE"],
  ["BARANGAY SAMPLE", "BUSINESS CLEARANCE"], ["COOPERATIVE DEVELOPMENT AUTHORITY", "CERTIFICATE OF REGISTRATION"],
];
const types = [...ID_DOCUMENT_TYPES, ...SUPPORTING_DOCUMENT_TYPES];
const profile = { first_name: "Sample", last_name: "Applicant", date_of_birth: "1990-05-12", business_name: "Sample Rentals",
  permit_number: "TEST123", tax_identification_number: "123456789", branch_code: "00000" };
const line = (text, y, extra = {}) => ({ text, page: 1, confidence: 0.98, bbox: [0.2, y, 0.8, y + 0.025], ...extra });
function fixture(type = "Philippine Passport") {
  return { schema_version: 1, provider: "paddleocr", pages: 1, layout_version: 1,
    page_evidence: [{ page: 1, width: 1000, height: 700, contrast: 60, sharpness: 150, portrait_present: true }],
    lines: [line("REPUBLIC OF THE PHILIPPINES", 0.01), ...headings[types.indexOf(type)].map((text, index) => line(text, 0.04 + index * 0.04)),
      line("Full Name: SAMPLE APPLICANT", 0.22), line("Date of Birth: 1990-05-12", 0.29),
      line("Document Number: SYNTHETIC123", 0.36), line("Expiration Date: 2099-05-12", 0.43),
      line("Business Name: SAMPLE RENTALS", 0.50), line("Permit Number: TEST123", 0.57),
      line("TIN: 123456789", 0.64), line("Branch Code: 00000", 0.71),
      ...(type === "Philippine Passport" ? [line("P<PHLAPPLICANT<<SAMPLE".padEnd(44, "<"), 0.8),
        line("SYNTHETIC0PHL9005120M9905120".padEnd(44, "<"), 0.86)] : []), line("Authorized officer signature", 0.94)] };
}
function assess(type = "Philippine Passport", edits = {}) {
  return evaluatePrivateDocumentInspection({ inspection: normalizePrivateOcrResponse(edits.payload || fixture(type)),
    docType: ID_DOCUMENT_TYPES.includes(type) ? "id" : "supporting", selectedDocType: type, profile,
    fileHash: "fixture-hash", reviewVersion: "fixture-revision", sessionId: "fixture-session", role: "user", now: new Date("2026-10-07T00:00:00Z"), ...edits });
}

test("all 17 types can pass essential matching while final approval remains manual", async (t) => {
  const previous = process.env.KYC_DOCUMENT_FINGERPRINT_SECRET;
  process.env.KYC_DOCUMENT_FINGERPRINT_SECRET = "f".repeat(32);
  t.after(() => { if (previous === undefined) delete process.env.KYC_DOCUMENT_FINGERPRINT_SECRET; else process.env.KYC_DOCUMENT_FINGERPRINT_SECRET = previous; });
  for (const type of types) await t.test(type, () => {
    const decision = assess(type);
    assert.equal(decision.privateScreening.automatedCheck.outcome, "passed");
    assert.equal(decision.checks.registrationDataCompared, false);
    assert.equal(decision.status, "pending_review");
    assert.equal(JSON.stringify(decision).includes("SYNTHETIC123"), false);
    assert.ok(decision.documentNumberFingerprint);
  });
});

test("rigid layout, country banner, OCR portrait and MRZ checks do not block confident type and details matching", () => {
  const wrong = assess("Philippine Passport", { payload: fixture("PRC ID") });
  assert.equal(wrong.privateScreening.automatedCheck.outcome, "correction_needed");
  for (const change of [
    (payload) => { delete payload.layout_version; delete payload.page_evidence; payload.lines.forEach((entry) => delete entry.bbox); },
    (payload) => { payload.page_evidence[0].portrait_present = false; },
    (payload) => { payload.page_evidence[0].sharpness = 2; },
    (payload) => { payload.lines = payload.lines.filter((entry) => !entry.text.startsWith("P<PHL")); },
    (payload) => { payload.lines = payload.lines.map((entry) => ({ ...entry, bbox: [0.1, 0.1, 0.9, 0.15] })); },
    (payload) => { payload.lines = payload.lines.filter((entry) => !entry.text.includes("PHILIPPINES")); payload.lines.unshift(line("REPUBLIC OF ANOTHER COUNTRY", 0.01)); },
  ]) {
    const payload = fixture(); change(payload);
    assert.equal(assess("Philippine Passport", { payload }).privateScreening.automatedCheck.outcome, "passed");
  }
});

test("mismatches require correction only after type, structure, required fields, and confidence pass", () => {
  for (const registration of [{ ...profile, first_name: "Wrong" }, { ...profile, date_of_birth: "1991-05-12" }]) {
    const decision = assess("Philippine Passport", { profile: registration });
    assert.equal(decision.status, "reupload_required");
    assert.equal(decision.reasonCode, "IDENTITY_DATA_MISMATCH");
    assert.equal(decision.privateScreening.automatedCheck.checks.registrationDetails, false);
  }
  for (const registration of [{ ...profile, business_name: "Sample" }, { ...profile, permit_number: "OTHER" }]) {
    const decision = assess("DTI Business Name Registration", { profile: registration });
    assert.equal(decision.status, "pending_review");
    assert.equal(decision.privateScreening.automatedCheck.outcome, "correction_needed");
  }
  const bir = assess("BIR Certificate of Registration (Form 2303)", { profile: { ...profile, branch_code: "00001" } });
  assert.equal(bir.privateScreening.automatedCheck.outcome, "correction_needed");
});

test("uncertain, missing, contradictory fields and invalid dates never produce a successful confirmation", () => {
  for (const change of [
    (payload) => { payload.lines.find((entry) => entry.text.startsWith("Full Name")).confidence = 0.7; },
    (payload) => { payload.lines = payload.lines.filter((entry) => !entry.text.startsWith("Date of Birth")); },
    (payload) => { payload.lines.push(line("Full Name: ANOTHER PERSON", 0.2)); },
    (payload) => { payload.lines.find((entry) => entry.text.startsWith("Date of Birth")).text = "Date of Birth: 1990-02-31"; },
    (payload) => { payload.lines.find((entry) => entry.text.startsWith("Expiration Date")).text = "Expiration Date: 05/12/2099"; },
  ]) {
    const payload = fixture(); change(payload);
    assert.equal(assess("Philippine Passport", { payload, minimumFieldConfidence: 20 }).privateScreening.automatedCheck.outcome, "correction_needed");
  }
  const expired = fixture(); expired.lines.find((entry) => entry.text.startsWith("Expiration Date")).text = "Expiration Date: 2000-05-12";
  assert.equal(assess("Philippine Passport", { payload: expired }).reasonCode, "DOCUMENT_EXPIRED");
  assert.notEqual(assess("Philippine Passport", { profile: { ...profile, date_of_birth: "" } }).privateScreening.automatedCheck.outcome, "passed");
  const nearThreshold = fixture();
  nearThreshold.lines.filter((entry) => entry.text.startsWith("REPUBLIC") || entry.text.startsWith("PASAPORTE"))
    .forEach((entry) => { entry.confidence = 0.899; });
  const uncertainType = assess("Philippine Passport", { payload: nearThreshold, minimumClassificationConfidence: 20 });
  assert.equal(uncertainType.checks.classificationConfident, false);
  assert.equal(uncertainType.privateScreening.automatedCheck.outcome, "review_needed");
});

test("bilingual National ID labels and a unique unlabeled card number match without a layout template", () => {
  const payload = fixture("PhilSys National ID");
  payload.layout_version = 2; delete payload.page_evidence;
  payload.lines = [line("PAMBANSANG PAGKAKAKILANLAN", 0.05), line("1234-5678-9012-3456", 0.1),
    line("Apelyido/Last Name", 0.2), line("APPLICANT", 0.24),
    line("Mga Pangalan/Given Names", 0.3), line("SAMPLE", 0.34),
    line("Gitnang Apelyido/Middle Name", 0.4), line("OTHER", 0.44),
    line("Petsa ng Kapanganakan/Date of Birth", 0.5), line("MAY 12, 1990", 0.54)];
  const decision = assess("PhilSys National ID", { payload });
  assert.equal(decision.privateScreening.automatedCheck.outcome, "passed");
  assert.equal(JSON.stringify(decision).includes("1234-5678-9012-3456"), false);
  payload.lines.push(line("1234-5678-9012-0000", 0.15));
  assert.equal(assess("PhilSys National ID", { payload }).privateScreening.automatedCheck.outcome, "correction_needed");
});

test("owner ID comparison requires only the profile fields supplied by the existing owner flow", () => {
  const payload = fixture(); payload.lines = payload.lines.filter((entry) => !entry.text.startsWith("Date of Birth"));
  const decision = assess("Philippine Passport", { payload, profile: { first_name: "Sample", last_name: "Applicant" }, requireBirthDate: false, role: "owner" });
  assert.equal(decision.privateScreening.automatedCheck.outcome, "passed");
  assert.equal(assess("Philippine Passport", { payload }).privateScreening.automatedCheck.outcome, "correction_needed");
});

test("a bilingual ID ignores low-confidence hologram noise between the label and readable name in OCR order", () => {
  const positioned = (text, bbox, confidence = 0.998) => ({ text, bbox, confidence, page: 1 });
  const payload = { schema_version: 1, provider: "paddleocr", pages: 1, layout_version: 2, lines: [
    positioned("PAMBANSANG PAGKAKAKILANLAN", [0.28, 0.14, 0.74, 0.19]),
    positioned("1234-5678-9012-3456", [0.06, 0.27, 0.40, 0.33]),
    positioned("Apelyido/Last Name", [0.46, 0.33, 0.67, 0.38]),
    positioned("APPLICANT", [0.46, 0.38, 0.64, 0.44]),
    positioned("Mga Pangalan/Given Names", [0.46, 0.44, 0.74, 0.48]),
    positioned("SYNTHETIC NOISE", [0.34, 0.47, 0.38, 0.49], 0.5008),
    positioned("SAMPLE", [0.46, 0.49, 0.61, 0.55]),
    positioned("Gitnang Apelyido/Middle Name", [0.46, 0.59, 0.77, 0.64]),
    positioned("OTHER", [0.46, 0.64, 0.65, 0.70]),
    positioned("Petsa ng Kapanganakan/Date of Birth", [0.46, 0.70, 0.83, 0.75]),
    positioned("MAY 12, 1990", [0.46, 0.75, 0.74, 0.81]),
  ] };
  for (const lines of [payload.lines, [...payload.lines].reverse()]) {
    const inspection = normalizePrivateOcrResponse({ ...payload, lines });
    const extracted = extractPrivateDocumentFields(inspection);
    assert.equal(extracted.data.full_name, "SAMPLE OTHER APPLICANT");
    assert.ok(extracted.fields.full_name.confidence >= 0.9);
    const decision = assess("PhilSys National ID", { payload: { ...payload, lines } });
    assert.equal(decision.privateScreening.automatedCheck.outcome, "passed");
    assert.equal(decision.status, "pending_review");
    assert.equal(decision.checks.registrationDataCompared, false);
    assert.equal(assess("PhilSys National ID", { payload: { ...payload, lines }, profile: { ...profile, first_name: "Wrong" } }).reasonCode, "IDENTITY_DATA_MISMATCH");
  }
  payload.lines.forEach((entry) => delete entry.bbox);
  delete payload.layout_version;
  const missingPositions = extractPrivateDocumentFields(normalizePrivateOcrResponse(payload));
  assert.equal(missingPositions.data.first_name, undefined);
  assert.equal(missingPositions.data.full_name, undefined);
});

test("only a current backend-bound match enables selfies; stale, duplicate, expired, or forged flags cannot", (t) => {
  const previous = process.env.KYC_DOCUMENT_FINGERPRINT_SECRET;
  process.env.KYC_DOCUMENT_FINGERPRINT_SECRET = "f".repeat(32);
  t.after(() => { if (previous === undefined) delete process.env.KYC_DOCUMENT_FINGERPRINT_SECRET; else process.env.KYC_DOCUMENT_FINGERPRINT_SECRET = previous; });
  const decision = assess();
  const document = { provider: "private-ocr", docType: "id", role: "user", sessionId: "fixture-session", status: "pending_review",
    detailsMatched: false, profileSnapshot: profile, selectedDocCategory: "Philippine Passport",
    fileHash: "fixture-hash", reviewVersion: "fixture-revision", privateScreening: decision.privateScreening };
  assert.equal(isIdentityReadyForSelfie(document), true);
  assert.equal(document.status, "pending_review");
  for (const edits of [{ fileHash: "replacement" }, { reviewVersion: "replacement" }, { sessionId: "another-session" },
    { selectedDocCategory: "PRC ID" }, { profileSnapshot: { ...profile, first_name: "Wrong" } }, { provider: "manual" },
    { status: "rejected" }, { status: "processing" }, { expiresAt: new Date(0) }, { suspectedTampering: true }]) {
    assert.equal(isIdentityReadyForSelfie({ ...document, ...edits }), false);
  }
  for (const edits of [{ version: 1 }, { outcome: "review_needed" }, { profileBinding: "forged" },
    { checks: { ...decision.privateScreening.automatedCheck.checks, registrationDetails: false } }]) {
    const changed = { ...document, privateScreening: { ...decision.privateScreening, automatedCheck: { ...decision.privateScreening.automatedCheck, ...edits } } };
    assert.equal(hasCurrentPrivateAutomatedMatch(changed), false);
  }
});

test("field association uses the same page and spatial column instead of the next arbitrary OCR line", () => {
  const payload = fixture();
  payload.lines = [line("Given names", 0.22, { bbox: [0.4, 0.22, 0.55, 0.24] }),
    line("WRONG", 0.25, { bbox: [0.05, 0.25, 0.2, 0.28] }),
    line("SAMPLE", 0.25, { bbox: [0.4, 0.25, 0.6, 0.28] }),
    line("Surname", 0.30, { bbox: [0.4, 0.30, 0.55, 0.32] }),
    line("APPLICANT", 0.30, { bbox: [0.6, 0.30, 0.9, 0.32] })];
  const fields = extractPrivateDocumentFields(normalizePrivateOcrResponse(payload));
  assert.equal(fields.data.full_name, "SAMPLE APPLICANT");
  const split = fixture(); split.pages = 2; split.page_evidence.push({ ...split.page_evidence[0], page: 2 });
  split.lines = [line("Given names", 0.22), line("SAMPLE", 0.23, { page: 2 })];
  assert.equal(extractPrivateDocumentFields(normalizePrivateOcrResponse(split)).data.first_name, undefined);
});

test("public screening exposes only current safe check results, never extracted values, hashes or raw OCR", () => {
  const decision = assess();
  const document = { fileHash: "fixture-hash", reviewVersion: "fixture-revision", privateScreening: decision.privateScreening };
  assert.deepEqual(Object.keys(publicPrivateScreening(document)).sort(), ["checks", "mismatchFields", "outcome"]);
  assert.equal(JSON.stringify(publicPrivateScreening(document)).includes("fixture-hash"), false);
  assert.equal(publicPrivateScreening({ ...document, fileHash: "replacement" }), null);
  assert.equal(publicPrivateScreening({ ...document, reviewVersion: "replacement" }), null);
  assert.equal(publicPrivateScreening({ ...document, privateScreening: null }), null);
});

test("new layout output is strictly bounded and incomplete evidence cannot masquerade as confirmed positions", () => {
  for (const change of [
    (payload) => { payload.lines[0].bbox[0] = -1; },
    (payload) => { payload.lines[0].bbox = [0.5, 0.5, 0.2, 0.2]; },
    (payload) => { delete payload.lines[0].bbox; },
    (payload) => { payload.page_evidence = []; },
    (payload) => { payload.page_evidence[0].contrast = Infinity; },
  ]) { const payload = fixture(); change(payload); assert.throws(() => normalizePrivateOcrResponse(payload)); }
});
