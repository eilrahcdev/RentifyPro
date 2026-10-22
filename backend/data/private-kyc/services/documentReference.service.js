import { DOCUMENT_REFERENCE_CATALOG } from "../data/documentReferences.js";
import { resolveSupportedDocumentType } from "./documentValidation.service.js";

const byType = new Map(DOCUMENT_REFERENCE_CATALOG.documents.map(entry => [entry.documentType, entry]));
const weights = [7, 3, 1];
const digit = value => String([...value].reduce((sum, char, index) => sum
  + (char === "<" ? 0 : /\d/.test(char) ? Number(char) : char.charCodeAt(0) - 55) * weights[index % 3], 0) % 10);
const matchesDigit = (value, actual) => /^\d$/.test(actual) && digit(value) === actual;
const normalizedNumber = value => String(value || "").replace(/[\s<]/g, "").toUpperCase();

export function checkPassportMrz(inspection, fields = {}, expectedCountry = "") {
  const lines = (inspection?.lines || []).slice(0, 1200).map(line => ({ ...line,
    value: typeof line.text === "string" ? line.text.slice(0, 400).replace(/\s/g, "").toUpperCase() : "" }));
  const starts = lines.filter(line => /^P[A-Z<][A-Z<]{38,46}$/.test(line.value));
  if (!starts.length) return { status: "not_observed", checks: {} };
  if (starts.length > 1) return { status: "ambiguous", checks: {} };
  const pairs = [];
  for (const first of starts) {
    for (const second of lines) {
      if (second === first || second.page !== first.page || !/^[A-Z0-9<]{44}$/.test(second.value)
        || !/^\d{6}[\d<][MFX<]\d{6}/.test(second.value.slice(13))) continue;
      if (first.bbox && second.bbox && second.bbox[1] < first.bbox[1]) continue;
      pairs.push([first, second]);
    }
  }
  if (pairs.length > 1) return { status: "ambiguous", checks: {} };
  const pair = pairs[0];
  if (!pair || pair.some(line => !Number.isFinite(line.confidence) || line.confidence < 0.9 || !/^[A-Z0-9<]{44}$/.test(line.value))) {
    return { status: "unreadable", checks: {} };
  }
  const [first, second] = pair.map(line => line.value);
  const optional = second.slice(28, 42);
  const checks = {
    documentNumberDigit: matchesDigit(second.slice(0, 9), second[9]),
    birthDateDigit: matchesDigit(second.slice(13, 19), second[19]),
    expiryDateDigit: matchesDigit(second.slice(21, 27), second[27]),
    optionalDataDigit: second[42] === "<" && /^<+$/.test(optional) || matchesDigit(optional, second[42]),
    compositeDigit: matchesDigit(second.slice(0, 10) + second.slice(13, 20) + second.slice(21, 43), second[43]),
  };
  if (expectedCountry) checks.issuingCountry = first.slice(2, 5) === expectedCountry;
  if (fields.document_number) checks.printedDocumentNumber = normalizedNumber(fields.document_number) === normalizedNumber(second.slice(0, 9));
  for (const [key, start, check] of [["birth_date", 13, "printedBirthDate"], ["expiration_date", 21, "printedExpiryDate"]]) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(fields[key] || "")) checks[check] = fields[key].replaceAll("-", "").slice(2) === second.slice(start, start + 6);
  }
  return { status: Object.values(checks).every(Boolean) ? "consistent" : "inconsistent", checks };
}

export function assessDocumentReference({ inspection, docType, selectedDocType, detectedType,
  classificationConfident = false, fields = {}, fileHash = "", reviewVersion = "", profileBinding = "" }) {
  const started = performance.now();
  const selected = resolveSupportedDocumentType(selectedDocType, docType);
  const entry = byType.get(selected);
  const recognized = Boolean(entry && entry.docType === docType && classificationConfident && detectedType === selected);
  return {
    version: 1, mode: "shadow", catalogRevision: DOCUMENT_REFERENCE_CATALOG.revision,
    fileHash, reviewVersion, profileBinding, selectedType: selected || "",
    recognition: recognized ? "category_recognized" : "unconfirmed",
    coverage: entry?.coverage || "not_catalogued", referenceId: entry?.id || null,
    variant: { status: "unconfirmed", id: null },
    layout: { status: "not_authenticated" },
    issuerAuthentication: { status: "not_performed", attempted: false },
    mrz: selected === "Philippine Passport" && recognized ? checkPassportMrz(inspection, fields, "PHL") : { status: "not_applicable", checks: {} },
    assessmentMs: Math.max(0, Math.round((performance.now() - started) * 1000) / 1000),
  };
}

export function publicDocumentReferenceAssessment(document, binding) {
  const result = document.privateScreening?.referenceAssessment;
  if (!result || result.version !== 1 || result.mode !== "shadow" || result.catalogRevision !== DOCUMENT_REFERENCE_CATALOG.revision
    || !binding || result.profileBinding !== binding || result.fileHash !== document.fileHash
    || result.reviewVersion !== (document.reviewVersion || document.fileHash)
    || result.selectedType !== resolveSupportedDocumentType(document.selectedDocCategory, document.docType)
    || !["pending_review", "verified"].includes(document.status) || document.suspectedTampering
    || document.registrationCancelledAt || document.uploadCancelledAt
    || document.expiresAt && new Date(document.expiresAt) <= new Date()) return null;
  // Never serialize stored objects directly: extracted values or forged issuer flags must not become public evidence.
  return { mode: "shadow", catalogRevision: DOCUMENT_REFERENCE_CATALOG.revision,
    coverage: byType.get(result.selectedType)?.coverage || "not_catalogued",
    recognition: result.recognition === "category_recognized" ? "category_recognized" : "unconfirmed",
    variant: { status: "unconfirmed" }, layout: { status: "not_authenticated" },
    issuerAuthentication: { status: "not_performed", attempted: false },
    mrz: { status: ["consistent", "inconsistent", "unreadable", "ambiguous", "not_observed", "not_applicable"].includes(result.mrz?.status)
      ? result.mrz.status : "unreadable" },
  };
}
