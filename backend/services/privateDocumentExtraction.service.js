import { compareDocumentRegistration, createDocumentFingerprint, isBirSupportingDocumentType, ID_DOCUMENT_TYPES, SUPPORTING_DOCUMENT_TYPES, resolveSupportedDocumentType,
  DOCUMENT_REASON_CODES } from "./documentValidation.service.js";
import { PRIVATE_AUTOMATED_CHECK_VERSION, privateScreeningBinding, strictPrivateBusinessNameMatch, strictPrivateIdentityNameMatch } from "./privateDocumentLayout.service.js";

export const PRIVATE_DOCUMENT_TYPE_CHECK_VERSION = 1;
const TYPE_RULES = {
  "PhilSys National ID": [/^(?:philippine identification(?: system| card)?|philid|philsys(?: national)? id|philippine national id|pambansang pagkakakilanlan)\b/im],
  "Philippine Passport": [/^(?:philippine\s+)?(?:passport|pasaporte)\b/im, /^(?:(?:philippine\s+passport|republic of (?:the )?philippines|republika ng pilipinas|pilipinas\s*[/|]\s*philippines)\b|p<phl(?=[a-z<]))/im],
  "LTO Driver's License": [/^(?:land transportation office|lto)\b/im, /^(?:lto\s+)?(?:driver'?s?|driving)\s+licen[cs]e\b/im],
  "UMID": [/^(?:unified\s+multi[\s-]*purpose|umid)\b/im],
  "PRC ID": [/^(?:professional regulation commission|prc)\b/im, /^(?:prc\s+id|professional\s+(?:identification|registration)\s+card)\b/im],
  "SSS ID": [/^(?:social security system|sss)\b/im, /^(?:(?:sss|social security system)\s+(?:id|identification card)|identification card|identity card)\b/im],
  "GSIS ID": [/^(?:government service insurance system|gsis)\b/im, /^(?:gsis\s+(?:id|e[\s-]*card)|e[\s-]*card(?:plus)?|identification card|identity card)\b/im],
  "PhilHealth ID": [/^(?:philhealth|philippine health insurance)\b/im, /^(?:philhealth\s+(?:id|identification)|identification card|identity card)\b/im],
  "Postal ID": [/^(?:philippine postal|philpost|phlpost)\b/im, /^(?:philippine\s+)?postal\s+(?:id|identity|identification)\b/im],
  "Voter's ID": [/^(?:commission on elections|comelec)\b/im, /^(?:comelec\s+id|voter'?s?\s+(?:id|identification)|identification card)\b/im],
  "DTI Business Name Registration": [/^(?:department of trade and industry|dti)\b/im, /^(?:dti\s+)?(?:certificate\s+of\s+(?:business\s+name\s+)?registration|business\s+name\s+registration)\b/im],
  "SEC Certificate of Registration": [/^(?:securities and exchange commission|sec)\b/im, /^(?:sec\s+)?certificate\s+of\s+(?:registration|incorporation|recording)\b/im],
  "Mayor's/Business Permit": [/^(?:mayor'?s?\s*(?:\/\s*business)?\s+permit|business\s+permit)\b/im],
  "BIR Certificate of Registration (Form 2303)": [/^(?:bureau of internal revenue|bir)\b/im, /^(?:bir\s+)?certificate\s+of\s+registration\b/im, /\b2303\b/],
  "BIR Notice to Issue Receipt/Invoice": [/^(?:bureau of internal revenue|bir)\b/im, /^(?:bir\s+)?(?:notice\s+to\s+issue|authority\s+to\s+print)\s+(?:receipts?|invoices?)\b/im],
  "Barangay Business Clearance": [/^barangay\b/im, /^(?:certificate\s+of\s+)?(?:barangay\s+)?business\s+clearance\b/im],
  "CDA Certificate of Registration": [/^(?:cooperative development authority|cda)\b/im, /^(?:cda\s+)?certificate\s+of\s+registration\b/im],
};

const bilingualLabel = (alternatives) => new RegExp(`^(?:${alternatives})\\b(?:\\s*/\\s*(?:${alternatives})\\b)?\\s*[:\\-]?\\s*`, "i");
const LABELS = {
  full_name: bilingualLabel("full name|name of (?:holder|applicant)|pangalan"),
  first_name: bilingualLabel("first name|given names?|mga pangalan"),
  last_name: bilingualLabel("last name|surname|apelyido"),
  middle_name: bilingualLabel("middle name|gitnang (?:pangalan|apelyido)"),
  birth_date: bilingualLabel("date of birth|birth date|dob|petsa ng kapanganakan"),
  document_number: /^(?:document (?:number|no\.?)|passport (?:number|no\.?)|licen[cs]e (?:number|no\.?)|id (?:number|no\.?)|pcn|psn|crn|common reference number|philsys card number|sss (?:number|no\.?)|gsis (?:number|no\.?))\s*[:\-]?\s*/i,
  issue_date: /^(?:date of issue|issue date|issued on)\s*[:\-]?\s*/i,
  expiration_date: /^(?:date of expiry|date of expiration|expiry date|expiration date|valid until)\s*[:\-]?\s*/i,
  business_name: /^(?:business name|registered business name|trade name|name of (?:business|corporation|cooperative))\s*[:\-]?\s*/i,
  permit_number: /^(?:permit (?:number|no\.?)|registration (?:number|no\.?)|certificate (?:number|no\.?))\s*[:\-]?\s*/i,
  tax_identification_number: /^(?:tin|tax identification (?:number|no\.?))\s*[:\-]?\s*/i,
  branch_code: /^(?:branch code)\s*[:\-]?\s*/i,
};

const dateValue = (value) => {
  const iso = value.match(/\b(\d{4})[-/]([01]?\d)[-/]([0-3]?\d)\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const named = value.match(/\b(?:(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})|([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4}))\b/);
  if (!named) return "";
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    .indexOf((named[2] || named[4]).slice(0, 3).toLowerCase()) + 1;
  return month ? `${named[3] || named[6]}-${String(month).padStart(2, "0")}-${(named[1] || named[5]).padStart(2, "0")}` : "";
};

const validDate = (value) => {
  if (typeof value !== "string") return "";
  const normalized = dateValue(value);
  if (!normalized) return "";
  const date = new Date(`${normalized}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === normalized ? normalized : "";
};

const isLabel = (text) => Object.values(LABELS).some((pattern) => pattern.test(text));
const valueLines = (label, lines) => {
  if (!label.bbox) return [];
  const [left, top, right, bottom] = label.bbox;
  const height = bottom - top, mid = (top + bottom) / 2;
  const nearby = lines.filter((line) => line !== label && line.page === label.page && line.bbox && !isLabel(line.text));
  const row = nearby.filter((line) => line.bbox[0] >= right - 0.005 && line.bbox[0] - right < 0.35
    && Math.abs((line.bbox[1] + line.bbox[3]) / 2 - mid) < Math.max(height, line.bbox[3] - line.bbox[1]) * 0.6)
    .sort((a, b) => a.bbox[0] - b.bbox[0]);
  if (row.length) return row;
  const below = nearby.filter((line) => line.bbox[1] >= bottom - 0.005 && line.bbox[1] - bottom < 0.065
    && Math.abs(line.bbox[0] - left) < 0.12).sort((a, b) => a.bbox[1] - b.bbox[1]);
  const first = below[0];
  if (!first) return [];
  const intervening = lines.some((line) => line !== label && line.page === label.page && line.bbox && isLabel(line.text)
    && line.bbox[1] >= bottom && line.bbox[1] <= first.bbox[1] && Math.abs(line.bbox[0] - left) < 0.15);
  return intervening ? [] : [first];
};

const normalizedLine = (line) => line.text.normalize("NFKC").replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u2010-\u2015]/g, "-").replace(/[\t ]+/g, " ").trim();

const clauseConfidence = (lines, pattern) => {
  const text = lines.map((line) => line.text).join("\n");
  let best = 0;
  for (const match of text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
    let offset = 0;
    const scores = [];
    for (const line of lines) {
      if (offset < match.index + match[0].length && offset + line.text.length > match.index) scores.push(line.confidence);
      offset += line.text.length + 1;
    }
    if (scores.length) best = Math.max(best, Math.min(...scores));
  }
  return best;
};

export function detectPrivateDocumentTypes(inspection) {
  const pages = new Map();
  for (const line of inspection.lines) {
    if (line.confidence < 0.5 || Object.values(LABELS).some((label) => label.test(line.text))) continue;
    const lines = pages.get(line.page) || [];
    lines.push({ ...line, text: normalizedLine(line) });
    pages.set(line.page, lines);
  }
  const evidence = new Map();
  for (const lines of pages.values()) {
    const found = Object.entries(TYPE_RULES).map(([type, clauses]) => ({ type, confidence: Math.min(...clauses.map((pattern) => clauseConfidence(lines, pattern))) }))
      .filter((match) => match.confidence > 0);
    const hasUmid = found.some((match) => match.type === "UMID");
    const text = lines.map((line) => line.text).join("\n");
    for (const match of found) {
      // UMID may name its issuing agencies without being a second SSS, GSIS, or PhilHealth card.
      if (hasUmid && ["SSS ID", "GSIS ID", "PhilHealth ID"].includes(match.type)
        && !/^(?:sss|gsis|philhealth)\s+(?:id|identification|e[\s-]*card)\b/im.test(text)) continue;
      evidence.set(match.type, Math.max(evidence.get(match.type) || 0, match.confidence));
    }
  }
  return [...evidence].map(([type, confidence]) => ({ type, confidence: Math.floor(confidence * 100) }));
}

export function extractPrivateDocumentFields(inspection, docType = "id") {
  const lines = inspection.lines.filter((line) => line.confidence >= 0.5).map((line) => ({ ...line, text: normalizedLine(line) }));
  const typeEvidence = detectPrivateDocumentTypes(inspection);
  const candidateType = typeEvidence.length === 1 ? typeEvidence[0].type : "";
  const data = {};
  const fields = {};
  const ambiguousFields = [];
  const scores = [];
  for (const [key, pattern] of Object.entries(LABELS)) {
    const candidates = lines.filter((line) => pattern.test(line.text)).map((line) => {
      const inline = line.text.replace(pattern, "").trim();
      const values = inline ? [line] : valueLines(line, lines);
      const value = inline || values.map((part) => part.text).join(" ");
      return { value: key.endsWith("date") ? validDate(value) : value.slice(0, 200), page: line.page,
        confidence: Math.min(line.confidence, ...values.map((part) => part.confidence)),
        bbox: values[0]?.bbox, labelBox: line.bbox, inline: Boolean(inline) };
    }).filter((candidate) => candidate.value);
    if (!candidates.length) {
      if (key.endsWith("date") && lines.some((line) => pattern.test(line.text))) data[key] = "";
      continue;
    }
    if (new Set(candidates.map((candidate) => candidate.value.toUpperCase())).size > 1) {
      ambiguousFields.push(key);
      continue;
    }
    const field = candidates.sort((a, b) => b.confidence - a.confidence)[0];
    data[key] = field.value;
    fields[key] = field;
    scores.push(field.confidence);
  }
  if (!data.full_name && data.first_name && data.last_name) {
    data.full_name = [data.first_name, data.middle_name, data.last_name].filter(Boolean).join(" ");
    fields.full_name = { ...fields.first_name,
      confidence: Math.min(fields.first_name.confidence, fields.last_name.confidence, fields.middle_name?.confidence ?? 1),
      associated: [fields.first_name, fields.last_name, fields.middle_name].filter(Boolean)
        .every((field) => field.inline || field.bbox) };
  }
  if (candidateType === "PhilSys National ID" && !data.document_number && !ambiguousFields.includes("document_number")) {
    const numbers = lines.filter((line) => /^\d{4}-\d{4}-\d{4}-\d{4}$/.test(line.text));
    if (new Set(numbers.map((line) => line.text)).size > 1) ambiguousFields.push("document_number");
    else if (numbers.length) {
      const number = numbers.sort((a, b) => b.confidence - a.confidence)[0];
      data.document_number = number.text;
      fields.document_number = { value: number.text, confidence: number.confidence, page: number.page, bbox: number.bbox, inline: true };
    }
  }
  return { data, fields, ambiguousFields, candidateType, typeEvidence, confidence: scores.length ? Math.round(Math.min(...scores) * 100) : 0 };
}

export function evaluatePrivateDocumentInspection({ inspection, docType, selectedDocType, profile,
  minimumClassificationConfidence = 90, minimumFieldConfidence = 90, requireBirthDate = docType === "id",
  fileHash = "", reviewVersion = "", sessionId = "", role = "", now = new Date() }) {
  const { data, fields, ambiguousFields, candidateType, typeEvidence, confidence } = extractPrivateDocumentFields(inspection, docType);
  const selected = resolveSupportedDocumentType(selectedDocType, docType);
  const classificationConfidence = typeEvidence.length === 1 ? typeEvidence[0].confidence : 0;
  const classificationConfident = Boolean(candidateType) && classificationConfidence >= Math.max(90, minimumClassificationConfidence);
  const supportedDocumentType = Boolean(candidateType) && (docType === "supporting" ? SUPPORTING_DOCUMENT_TYPES : ID_DOCUMENT_TYPES).includes(candidateType);
  const documentTypeMatches = Boolean(selected && candidateType === selected && classificationConfident && supportedDocumentType);
  let status = "pending_review", reasonCode = "PRIVATE_OCR_REVIEW_REQUIRED";
  let reviewReason = "The document type matches the selected type. An administrator must inspect its structure and registration details before approval.";
  if (!selected || !typeEvidence.length || typeEvidence.length > 1) {
    status = "reupload_required";
    reasonCode = DOCUMENT_REASON_CODES.UNRECOGNIZED_DOCUMENT;
    reviewReason = typeEvidence.length > 1
      ? "More than one document type was detected. Upload only the complete document matching your selected type."
      : "We could not identify a supported document type. Upload a clear image of the complete selected document, including its title and issuing authority.";
  } else if (!classificationConfident) {
    reasonCode = DOCUMENT_REASON_CODES.AUTHENTICITY_UNCERTAIN;
    reviewReason = "We couldn't read the document type confidently. Upload a clearer image or wait for admin review.";
  } else if (!documentTypeMatches) {
    status = "reupload_required";
    reasonCode = DOCUMENT_REASON_CODES.DOCUMENT_TYPE_MISMATCH;
    reviewReason = `The detected document type (${candidateType}) does not match the selected type (${selected}). Upload the correct document or select its actual type.`;
  }
  const comparison = documentTypeMatches ? compareDocumentRegistration({ docType, profile, data, documentType: candidateType }) : null;
  if (comparison && docType === "id") {
    comparison.nameMatches = comparison.nameMatches && strictPrivateIdentityNameMatch(profile, data.full_name);
    comparison.mismatchFields = comparison.mismatchFields.filter((field) => field !== "Name");
    if (!comparison.nameMatches) comparison.mismatchFields.unshift("Name");
  }
  if (comparison && docType === "supporting" && profile.business_name) {
    comparison.nameMatches = strictPrivateBusinessNameMatch(profile.business_name, data.business_name);
    comparison.mismatchFields = comparison.mismatchFields.filter((field) => field !== "Registered name");
    if (!comparison.nameMatches) comparison.mismatchFields.unshift("Registered name");
  }
  const profileBirthDate = profile.date_of_birth || profile.birth_date;
  const required = docType === "id" ? ["full_name", "document_number", ...(requireBirthDate || profileBirthDate ? ["birth_date"] : [])]
    : [profile.business_name ? "business_name" : "full_name"];
  if (["Philippine Passport", "LTO Driver's License"].includes(candidateType)) required.push("expiration_date");
  if (!required.includes("expiration_date") && inspection.lines.some((line) => LABELS.expiration_date.test(line.text))) required.push("expiration_date");
  if (docType === "supporting") {
    if (isBirSupportingDocumentType(candidateType)) required.push("tax_identification_number", "branch_code");
    else if (candidateType !== "Barangay Business Clearance" || profile.permit_number) required.push(data.permit_number ? "permit_number" : "document_number");
  }
  const fieldsPresent = required.every((key) => Boolean(data[key])) && !required.some((key) => ambiguousFields.includes(key));
  const fieldsConfident = fieldsPresent && required.every((key) => fields[key]?.confidence * 100 >= Math.max(90, minimumFieldConfidence)
    && (fields[key].associated ?? Boolean(fields[key].inline || fields[key].bbox)));
  const expired = data.expiration_date ? new Date(`${data.expiration_date}T23:59:59.999Z`) < now : false;
  const profileComplete = docType !== "id" || (!requireBirthDate && !profileBirthDate) || Boolean(validDate(profileBirthDate || ""));
  let outcome = "review_needed";
  const screeningChecks = { documentType: documentTypeMatches,
    requiredFields: fieldsPresent && fieldsConfident, validity: fieldsConfident ? !expired : null, registrationDetails: null };
  if (status === "reupload_required") outcome = "correction_needed";
  else if (documentTypeMatches && fieldsConfident && profileComplete) {
    screeningChecks.registrationDetails = comparison.mismatchFields.length === 0;
    if (expired) {
      status = "reupload_required"; reasonCode = DOCUMENT_REASON_CODES.DOCUMENT_EXPIRED;
      reviewReason = "This document has expired. Upload a current document of the selected type."; outcome = "correction_needed";
    } else if (comparison.mismatchFields.length) {
      status = docType === "id" ? "reupload_required" : "pending_review";
      reasonCode = DOCUMENT_REASON_CODES.IDENTITY_DATA_MISMATCH;
      reviewReason = `The ${comparison.mismatchFields[0].toLowerCase()} on your ${docType === "id" ? "ID" : "business document"} does not match your registration details.`;
      outcome = "correction_needed";
    } else {
      outcome = "passed";
      reviewReason = docType === "id" ? "ID check passed. You can now proceed to selfie verification."
        : "Business document check passed. You can continue.";
    }
  } else if (documentTypeMatches) {
    const unreadable = required.find((key) => !data[key] || ambiguousFields.includes(key) || fields[key]?.confidence * 100 < Math.max(90, minimumFieldConfidence)
      || !(fields[key]?.associated ?? Boolean(fields[key]?.inline || fields[key]?.bbox)));
    const labels = { full_name: "name", document_number: "document number", birth_date: "birth date", expiration_date: "expiry date",
      business_name: "registered business name", permit_number: "permit or registration number", tax_identification_number: "TIN", branch_code: "branch code" };
    reviewReason = unreadable ? `We couldn't read your ${labels[unreadable]} confidently. Upload a clearer image.`
      : "Your registration details are incomplete. Correct them before checking this document again.";
    status = "reupload_required";
    reasonCode = unreadable ? DOCUMENT_REASON_CODES.EXTRACTION_UNCERTAIN : DOCUMENT_REASON_CODES.REGISTRATION_DATA_INCOMPLETE;
    outcome = "correction_needed";
  }
  return {
    status, reasonCode, reviewReason,
    confidence,
    classificationConfidence,
    documentSurface: "UNKNOWN",
    checks: { recognizedDocument: typeEvidence.length === 1, classificationConfident, supportedDocumentType,
      documentTypeMatches, registrationDataCompared: false },
    mismatchFields: [],
    extractedData: { documentType: candidateType || "Unknown", fieldsDetected: Object.keys(data).filter((key) => data[key]) },
    documentNumberFingerprint: outcome === "passed" ? createDocumentFingerprint(isBirSupportingDocumentType(candidateType)
      ? `${data.tax_identification_number}-${data.branch_code}` : data.document_number || data.permit_number) : "",
    privateScreening: {
      candidateType, confidence, fieldsDetected: Object.keys(data).filter((key) => data[key]),
      typeCheck: { version: PRIVATE_DOCUMENT_TYPE_CHECK_VERSION, selectedType: selected,
        detectedTypes: typeEvidence.map((match) => match.type), classificationConfidence, classificationConfident,
        documentTypeMatches, fileHash, reviewVersion, reasonCode },
      preliminaryComparison: {
        nameMatches: comparison?.nameMatches ?? null,
        birthDateMatches: comparison?.birthDateMatches ?? null,
        permitNumberMatches: comparison?.permitNumberMatches ?? null,
      },
      automatedCheck: { version: PRIVATE_AUTOMATED_CHECK_VERSION, fileHash, reviewVersion, outcome, checks: screeningChecks,
        profileBinding: privateScreeningBinding({ profile, sessionId, role, docType, selectedDocType: selected }),
        mismatchFields: outcome === "correction_needed" ? comparison?.mismatchFields || [] : [],
        fieldConfidence: Object.fromEntries(required.map((key) => [key, Math.round((fields[key]?.confidence || 0) * 100)])) },
    },
  };
}
