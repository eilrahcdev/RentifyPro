import test from "node:test";
import assert from "node:assert/strict";
import { DOCUMENT_REFERENCE_CATALOG, DOCUMENT_REFERENCE_SOURCES } from "../data/documentReferences.js";
import { ID_DOCUMENT_TYPES, SUPPORTING_DOCUMENT_TYPES } from "../services/documentValidation.service.js";
import { assessDocumentReference, checkPassportMrz } from "../services/documentReference.service.js";
import { evaluatePrivateDocumentInspection } from "../services/privateDocumentExtraction.service.js";
import { normalizePrivateOcrResponse } from "../services/privateKycOcr.service.js";
import { publicPrivateScreening, hasCurrentPrivateAutomatedMatch } from "../services/privateDocumentLayout.service.js";
import { syntheticReferenceCases } from "./fixtures/documentReferenceCases.js";

const line = (text, y = 0.8, confidence = 0.99) => ({ text, confidence, page: 1, bbox: [0.1, y, 0.9, y + 0.03] });
// ICAO Doc 9303 Part 3 published TD3 check-digit example; fictional specimen data.
const specimen = ["P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UTO7408122F1204159ZE184226B<<<<<10"];

test("the reference catalog covers exactly the existing 17 categories without declaring issuer authentication or evaluation", () => {
  assert.deepEqual(DOCUMENT_REFERENCE_CATALOG.documents.map(entry => entry.documentType), [...ID_DOCUMENT_TYPES, ...SUPPORTING_DOCUMENT_TYPES]);
  for (const entry of DOCUMENT_REFERENCE_CATALOG.documents) {
    assert.equal(entry.coverage, "partial");
    assert.equal(entry.evaluation.genuineSamples, 0);
    assert.ok(entry.variants.length);
    for (const variant of entry.variants) {
      assert.equal(variant.evaluationStatus, "not_evaluated");
      for (const id of variant.sources) assert.ok(DOCUMENT_REFERENCE_SOURCES[id], id);
    }
  }
  assert.equal(Object.isFrozen(DOCUMENT_REFERENCE_CATALOG.documents[0].variants), true);
});

test("MRZ checksum consistency is separate from authenticity, and damaged/ambiguous readings remain advisory", () => {
  const valid = specimen.map((text, index) => line(text, 0.8 + index * 0.06));
  assert.equal(checkPassportMrz({ lines: valid }).status, "consistent");
  const damaged = valid.map(entry => ({ ...entry }));
  damaged[1].text = damaged[1].text.replace("L898902C3", "L898902C4");
  assert.equal(checkPassportMrz({ lines: damaged }).status, "inconsistent");
  assert.equal(checkPassportMrz({ lines: valid.map(entry => ({ ...entry, confidence: 0.7 })) }).status, "unreadable");
  assert.equal(checkPassportMrz({ lines: [valid[0], { ...valid[1], page: 2 }] }).status, "unreadable");
  assert.equal(checkPassportMrz({ lines: [...valid, ...valid] }).status, "ambiguous");
  assert.equal(checkPassportMrz({ lines: [] }).status, "not_observed");
  assert.equal(checkPassportMrz({ lines: [line("PHILIPPINE PASSPORT")] }).status, "not_observed");
});

test("reference assessment does not infer an exact version, retains unknown coverage and never exposes OCR values", () => {
  const assessment = assessDocumentReference({ inspection: { lines: specimen.map(text => line(text)) },
    docType: "id", selectedDocType: "Philippine Passport", detectedType: "Philippine Passport",
    classificationConfident: true, fileHash: "fixture-hash", reviewVersion: "fixture-revision", profileBinding: "fixture-binding" });
  assert.equal(assessment.mode, "shadow");
  assert.equal(assessment.variant.status, "unconfirmed");
  assert.equal(assessment.layout.status, "not_authenticated");
  assert.equal(assessment.issuerAuthentication.status, "not_performed");
  assert.equal(assessment.issuerAuthentication.attempted, false);
  assert.equal(assessment.mrz.status, "inconsistent", "ICAO's fictional UTO specimen must not establish a Philippine issuer");
  assert.equal(assessment.mrz.checks.issuingCountry, false);
  assert.equal(JSON.stringify(assessment).includes("ERIKSSON"), false);
  assert.equal(JSON.stringify(assessment).includes("L898902C3"), false);
  const unknown = assessDocumentReference({ inspection: { lines: [] }, docType: "id", selectedDocType: "Invented ID" });
  assert.equal(unknown.coverage, "not_catalogued");
  assert.equal(unknown.recognition, "unconfirmed");
});

test("public advisory evidence is bound to the current file, revision, category and profile and cannot claim issuer success", t => {
  const prior = process.env.KYC_DOCUMENT_FINGERPRINT_SECRET;
  process.env.KYC_DOCUMENT_FINGERPRINT_SECRET = "f".repeat(32);
  t.after(() => { if (prior === undefined) delete process.env.KYC_DOCUMENT_FINGERPRINT_SECRET; else process.env.KYC_DOCUMENT_FINGERPRINT_SECRET = prior; });
  const item = syntheticReferenceCases().cases[1];
  const decision = evaluatePrivateDocumentInspection({ inspection: normalizePrivateOcrResponse(item.inspection),
    selectedDocType: item.selectedDocType, docType: "id", role: "user", profile: item.profile,
    fileHash: "current-hash", reviewVersion: "current-version", sessionId: "current-session" });
  const document = { ...decision, provider: "private-ocr", role: "user", docType: "id", selectedDocCategory: item.selectedDocType,
    fileHash: "current-hash", reviewVersion: "current-version", sessionId: "current-session", profileSnapshot: item.profile };
  assert.equal(publicPrivateScreening(document).referenceAssessment.issuerAuthentication.status, "not_performed");
  for (const changes of [{ sessionId: "foreign-session" }, { profileSnapshot: { ...item.profile, first_name: "Different" } },
    { selectedDocCategory: "PRC ID" }, { uploadCancelledAt: new Date() }, { registrationCancelledAt: new Date() },
    { expiresAt: new Date(0) }, { status: "processing" }, { status: "reupload_required" }]) {
    assert.equal(publicPrivateScreening({ ...document, ...changes })?.referenceAssessment, undefined);
  }
  for (const changes of [{ fileHash: "replacement" }, { reviewVersion: "replacement" }]) assert.equal(publicPrivateScreening({ ...document, ...changes }), null);
  document.privateScreening.referenceAssessment.issuerAuthentication = { status: "verified", secret: "must-not-leak" };
  document.privateScreening.referenceAssessment.rawOcr = "must-not-leak";
  const published = publicPrivateScreening(document).referenceAssessment;
  assert.equal(published.issuerAuthentication.status, "not_performed");
  assert.equal(JSON.stringify(published).includes("must-not-leak"), false);
  document.privateScreening.automatedCheck.outcome = "review_needed";
  document.privateScreening.referenceAssessment.mrz = { status: "consistent" };
  assert.equal(hasCurrentPrivateAutomatedMatch(document), false, "An advisory result never substitutes for the existing authorization gate");
});
