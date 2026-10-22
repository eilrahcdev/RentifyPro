import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DOCUMENT_REFERENCE_CATALOG, DOCUMENT_REFERENCE_SOURCES } from "../data/documentReferences.js";
import { evaluatePrivateDocumentInspection, extractPrivateDocumentFields } from "../services/privateDocumentExtraction.service.js";
import { normalizePrivateOcrResponse } from "../services/privateKycOcr.service.js";

const types = new Set(DOCUMENT_REFERENCE_CATALOG.documents.map(entry => entry.documentType));
const outcomes = ["passed", "review_needed", "correction_needed"];
const fieldKeys = ["full_name", "first_name", "last_name", "birth_date", "document_number", "business_name", "permit_number", "tax_identification_number", "branch_code", "issue_date", "expiration_date"];
const profileKeys = ["full_name", "first_name", "last_name", "date_of_birth", "birth_date", "business_name", "permit_number", "tax_identification_number", "branch_code"];
const bucket = () => ({ cases: 0, correctTypes: 0, correctOutcomes: 0, falseScreeningPasses: 0,
  missedExpectedPasses: 0, reviewCases: 0, passesWithReferenceConcerns: 0,
  comparedFields: 0, correctFields: 0, durationsMs: [] });
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? null;
const finish = value => {
  const { durationsMs, ...counts } = value;
  return { ...counts, typeAccuracy: value.cases ? value.correctTypes / value.cases : null,
    outcomeAccuracy: value.cases ? value.correctOutcomes / value.cases : null,
    fieldAccuracy: value.comparedFields ? value.correctFields / value.comparedFields : null,
    p50OfflineMs: percentile(durationsMs, 0.5), p95OfflineMs: percentile(durationsMs, 0.95) };
};

export function evaluateDocumentReferenceCases(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.cases) || !manifest.cases.length || manifest.cases.length > 1000) {
    throw Error("Expected schemaVersion 1 with between 1 and 1000 evaluation cases.");
  }
  if (manifest.evaluationDate && (typeof manifest.evaluationDate !== "string"
    || !/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(manifest.evaluationDate)
    || !Number.isFinite(new Date(manifest.evaluationDate).getTime())
    || new Date(manifest.evaluationDate).toISOString().slice(0, 10) !== manifest.evaluationDate.slice(0, 10))) {
    throw Error("evaluationDate must be a valid UTC date such as 2026-10-20T00:00:00Z.");
  }
  const total = bucket(), byType = {}, byVariant = {}, bySampleKind = {};
  for (const [index, item] of manifest.cases.entries()) {
    const entry = DOCUMENT_REFERENCE_CATALOG.documents.find(entry => entry.documentType === item?.selectedDocType);
    if (!entry || item.docType !== entry.docType || !["user", "owner"].includes(item.role) || item.docType === "supporting" && item.role !== "owner"
      || !["synthetic", "consented"].includes(item.sampleKind)
      || !(item.split === "holdout" || item.sampleKind === "synthetic" && item.split === "regression")
      || item.sampleKind === "consented" && item.consentConfirmed !== true
      || ![...types, "Unknown"].includes(item.expected?.documentType) || !outcomes.includes(item.expected?.outcome)
      || item.variantId && !entry.variants.some(variant => variant.id === item.variantId)) {
      throw Error(`Invalid evaluation metadata at case ${index + 1}.`);
    }
    const profile = {};
    for (const key of profileKeys) if (item.profile?.[key] !== undefined) {
      if (typeof item.profile[key] !== "string" || item.profile[key].length > 512) throw Error(`Invalid profile data at case ${index + 1}.`);
      profile[key] = item.profile[key];
    }
    const expectedFields = item.expected.fields || {};
    if (typeof expectedFields !== "object" || Array.isArray(expectedFields)
      || Object.entries(expectedFields).some(([key, value]) => !fieldKeys.includes(key) || typeof value !== "string" || value.length > 512)) {
      throw Error(`Invalid expected fields at case ${index + 1}.`);
    }
    const started = performance.now();
    let inspection;
    try { inspection = normalizePrivateOcrResponse(item.inspection); }
    catch { throw Error(`Invalid bounded OCR data at case ${index + 1}.`); }
    const extracted = extractPrivateDocumentFields(inspection, item.docType);
    const decision = evaluatePrivateDocumentInspection({ inspection, docType: item.docType, selectedDocType: item.selectedDocType,
      profile, role: item.role, requireBirthDate: item.docType === "id" && item.role === "user",
      sessionId: "offline-evaluation", fileHash: "offline-fixture", reviewVersion: "offline-evaluation",
      ...(manifest.evaluationDate ? { now: new Date(manifest.evaluationDate) } : {}) });
    const outcome = decision.privateScreening.automatedCheck.outcome;
    const referenceConcern = ["inconsistent", "unreadable", "ambiguous"].includes(decision.privateScreening.referenceAssessment.mrz.status);
    const duration = Math.round((performance.now() - started) * 1000) / 1000;
    for (const value of [total, byType[item.selectedDocType] ||= bucket(),
      byVariant[item.variantId || "unconfirmed"] ||= bucket(), bySampleKind[item.sampleKind] ||= bucket()]) {
      value.cases++;
      value.correctTypes += decision.extractedData.documentType === item.expected.documentType ? 1 : 0;
      value.correctOutcomes += outcome === item.expected.outcome ? 1 : 0;
      value.falseScreeningPasses += outcome === "passed" && item.expected.outcome !== "passed" ? 1 : 0;
      value.missedExpectedPasses += outcome !== "passed" && item.expected.outcome === "passed" ? 1 : 0;
      value.reviewCases += outcome === "review_needed" ? 1 : 0;
      value.passesWithReferenceConcerns += outcome === "passed" && referenceConcern ? 1 : 0;
      value.comparedFields += Object.keys(expectedFields).length;
      value.correctFields += Object.entries(expectedFields).filter(([key, expected]) => extracted.data[key] === expected).length;
      value.durationsMs.push(duration);
    }
  }
  return { schemaVersion: 1, catalogRevision: DOCUMENT_REFERENCE_CATALOG.revision, mode: "shadow", networkRequests: 0,
    authenticityAccuracy: null, genuineVariantCoverageEstablished: false,
    scope: "Offline normalized OCR screening only; excludes image OCR, uploads, queue wait and issuer authentication. Sample/holdout labels are operator attestations; synthetic regression scores are not independent document-accuracy evidence.",
    summary: finish(total),
    byType: Object.fromEntries(Object.entries(byType).map(([key, value]) => [key, finish(value)])),
    byVariant: Object.fromEntries(Object.entries(byVariant).map(([key, value]) => [key, finish(value)])),
    bySampleKind: Object.fromEntries(Object.entries(bySampleKind).map(([key, value]) => [key, finish(value)])),
    uncoveredTypes: DOCUMENT_REFERENCE_CATALOG.documents.filter(entry => !byType[entry.documentType]).map(entry => entry.documentType),
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.includes("--catalog")) {
      console.log(JSON.stringify({ ...DOCUMENT_REFERENCE_CATALOG, sources: DOCUMENT_REFERENCE_SOURCES }, null, 2));
    } else {
      const manifestPath = process.argv.find(arg => arg.startsWith("--manifest="))?.slice(11);
      if (!manifestPath) throw Error("Use --catalog, or --manifest=<path to a private held-out OCR evaluation JSON file>.");
      const info = await fs.stat(manifestPath);
      if (!info.isFile() || info.size > 8 * 1024 * 1024) throw Error("Evaluation manifest must be a JSON file no larger than 8 MiB.");
      let manifest;
      try { manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")); }
      catch { throw Error("Evaluation manifest must contain valid JSON."); }
      if (manifest.evaluationDate && !/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(manifest.evaluationDate)) throw Error("Use an explicit UTC evaluationDate such as 2026-10-20T00:00:00Z.");
      console.log(JSON.stringify(evaluateDocumentReferenceCases(manifest), null, 2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
