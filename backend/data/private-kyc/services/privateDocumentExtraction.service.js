import { compareDocumentRegistration, createDocumentFingerprint, isBirSupportingDocumentType, ID_DOCUMENT_TYPES, SUPPORTING_DOCUMENT_TYPES, resolveSupportedDocumentType,
  DOCUMENT_REASON_CODES } from "./documentValidation.service.js";
import { PRIVATE_AUTOMATED_CHECK_VERSION, privateScreeningBinding, strictPrivateBusinessNameMatch, strictPrivateIdentityNameMatch } from "./privateDocumentLayout.service.js";
import { assessDocumentReference } from "./documentReference.service.js";

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
  "DTI Business Name Registration": [/^(?:(?:department of trade and industry|dti)\b|prescribed by (?:the )?department of trade and industry\b)/im, /^(?:dti\s+)?(?:certificate\s+of\s+(?:business\s+name\s+)?registration|business\s+name\s+registration)\b/im],
  "SEC Certificate of Registration": [/^(?:securities and exchange commission|sec)\b/im, /^(?:sec\s+)?certificate\s+of\s+(?:registration|incorporation|recording)\b/im],
  "Mayor's/Business Permit": [/^(?:mayor'?s?\s*(?:\/\s*business)?\s+permit|business\s+permit)\b/im],
  "BIR Certificate of Registration (Form 2303)": [/^(?:bureau of internal revenue|bir)\b/im, /^(?:bir\s+)?certificate\s+of\s+registration\b/im, /\b2303\b/],
  "BIR Notice to Issue Receipt/Invoice": [/^(?:bureau of internal revenue|bir)\b|^(?:[□☐口]\s*)?(?:contact_us|commissioner)@bir\.gov\.ph\b/im,
    /^(?:(?:bir\s+)?(?:notice\s+to\s+issue|authority\s+to\s+print)\s+(?:receipts?|invoices?)\b|this establishment must issue\s+receipts?\s*\/\s*invoices?\b)/im],
  "Barangay Business Clearance": [/^barangay\b/im, /^(?:certificate\s+of\s+)?(?:barangay\s+)?business\s+clearance\b/im],
  "CDA Certificate of Registration": [/^(?:cooperative development authority|cda)\b/im, /^(?:cda\s+)?certificate\s+of\s+registration\b/im],
};

const bilingualLabel = (alternatives) => new RegExp(`^(?:${alternatives})\\b(?:\\s*/\\s*(?:${alternatives})\\b)?\\s*[:\\-]?\\s*`, "i");
const LABELS = {
  full_name: bilingualLabel("full name|name of (?:holder|applicant)|pangalan"),
  first_name: bilingualLabel("first name|given names?|mga pangalan"),
  last_name: bilingualLabel("last name|surname|apelyido"),
  middle_name: bilingualLabel("middle name|gitnang (?:pangalan|apelyido)"),
  birth_date: bilingualLabel("date of birth|birth date|birthday|dob|petsa ng kapanganakan|araw ng kapanganakan"),
  document_number: /^(?:document (?:number|no\.?)|passport (?:number|no\.?)|licen[cs]e (?:number|no\.?)|id (?:number|no\.?)|pcn|psn|crn|common reference number|philsys card number|sss (?:number|no\.?)|gsis (?:number|no\.?))\s*[:\-]?\s*/i,
  issue_date: /^(?:date of issue|issue date|issued on|date issued|registration date|date of registration|valid from)\b\s*[:\-]?\s*/i,
  expiration_date: /^(?:date of expiry|date of expiration|expiry date|expiration date|valid until|validity(?: date| period)?|valid through|valid up to|expiry|expiration)\b\s*[:\-]?\s*/i,
  business_name: /^(?:business name(?!\s*(?:no\.?|number)\b)|registered business name|trade name|company name|name of (?:business|corporation|cooperative))\s*[:\-]?\s*/i,
  permit_number: /^(?:permit (?:number|no\.?)|registration (?:number|no\.?)|certificate (?:number|no\.?))\s*[:\-]?\s*/i,
  tax_identification_number: /^(?:tin(?!\s*(?:and|&)\s*branch)|tax(?:payer)? identification (?:number|no\.?))\b\s*[:\-]?\s*/i,
  branch_code: /^(?:branch code)\s*[:\-]?\s*/i,
};

const COMBINED_NAME_LABEL = /^(?:last name|surname)[.,\s/]+(?:first name|given names?)[.,\s/]+middle name\b\s*[:\-]?\s*/i;
const COMBINED_TIN_LABEL = /^(?:tin|taxpayer identification number)\s*(?:and|&)\s*branch code\b\s*[:\-]?\s*/i;
const OTHER_CAPTIONS = /^(?:nationality|citizenship|sex|gender|weight\b|height\b|address|agency code|blood type|eyes? colou?r|dl codes|conditions|signature|profession|registered name|city\s*\/\s*municipality|for each|in testimony|prescribed by|is valid from|this notice)\b/i;
const NUMBER_ALIASES = {
  "PhilSys National ID": "philsys number", "Philippine Passport": "passport no\\.?",
  "LTO Driver's License": "license no\\.?", "UMID": "crn",
  "PRC ID": "registration (?:number|no\\.?)", "SSS ID": "ss (?:number|no\\.?)|social security number",
  "GSIS ID": "bp (?:number|no\\.?)|business partner (?:number|no\\.?)", "PhilHealth ID": "pin|philhealth (?:identification )?(?:number|no\\.?)",
  "Postal ID": "prn|postal reference number", "Voter's ID": "vin|voter'?s? identification number",
  "DTI Business Name Registration": "business name (?:number|no\\.?)|bn (?:number|no\\.?)",
  "SEC Certificate of Registration": "(?:sec |company )registration (?:number|no\\.?)",
  "Mayor's/Business Permit": "business permit (?:number|no\\.?)|permit (?:number|no\\.?)",
  "BIR Certificate of Registration (Form 2303)": "certificate (?:number|no\\.?)",
  "BIR Notice to Issue Receipt/Invoice": "certificate (?:number|no\\.?)",
  "Barangay Business Clearance": "clearance (?:number|no\\.?)|reference (?:number|no\\.?)",
  "CDA Certificate of Registration": "(?:cooperative |cda )registration (?:number|no\\.?)",
};

export const requiresPrivateDocumentExpiry = (type) => ["Philippine Passport", "LTO Driver's License", "PRC ID", "Postal ID",
  "DTI Business Name Registration", "Mayor's/Business Permit"].includes(type);

const labelsFor = (type, docType) => {
  const labels = { ...LABELS };
  if (docType === "id") labels.full_name = new RegExp(`(?:${labels.full_name.source})|^name(?=\\s*:|\\s*$)\\s*:?\\s*`, "i");
  if (NUMBER_ALIASES[type]) {
    const key = docType === "id" ? "document_number" : "permit_number";
    labels[key] = new RegExp(`(?:${labels[key].source})|^(?:${NUMBER_ALIASES[type]})\\b\\s*[:\\-]?\\s*`, "i");
  }
  if (type === "LTO Driver's License") labels.full_name = new RegExp(`(?:${COMBINED_NAME_LABEL.source})|(?:${LABELS.full_name.source})`, "i");
  if (type === "DTI Business Name Registration") {
    labels.business_name = new RegExp(`(?:${LABELS.business_name.source})|^this certifies that\\b\\s*[:\\-]?\\s*`, "i");
    labels.full_name = new RegExp(`(?:${LABELS.full_name.source})|^this certificate (?:is )?issued to\\b\\s*[:\\-]?\\s*`, "i");
  }
  if (type === "CDA Certificate of Registration") labels.business_name = new RegExp(`(?:${LABELS.business_name.source})|^name of coop\\.?(?=\\s|:|$)\\s*[:\\-]?\\s*`, "i");
  return labels;
};

const DATE_PATTERN = /\b(?:\d{4}[-/][01]?\d[-/][0-3]?\d|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}[-/]\d{1,2}[-/]\d{4})\b/g;

const dateValue = (value) => {
  const iso = value.match(/\b(\d{4})[-/]([01]?\d)[-/]([0-3]?\d)\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const named = value.match(/\b(?:(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})|([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4}))\b/);
  if (!named) {
    const numeric = value.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
    if (!numeric) return "";
    const first = Number(numeric[1]), second = Number(numeric[2]);
    // Never choose between day/month and month/day when both interpretations are possible.
    const month = first > 12 ? second : second > 12 || first === second ? first : 0;
    const day = first > 12 ? first : second;
    return month ? `${numeric[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
  }
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

const isLabel = (text, labels) => Object.values(labels).some((pattern) => pattern.test(text))
  || COMBINED_NAME_LABEL.test(text) || COMBINED_TIN_LABEL.test(text) || OTHER_CAPTIONS.test(text.replace(/^[()]+/, ""))
  || Object.values(TYPE_RULES).some((clauses) => clauses.some((pattern) => pattern.test(text)));
const valueLines = (label, lines, labels, { above = false, wrapped = false } = {}) => {
  if (!label.bbox) return [];
  const [left, top, right, bottom] = label.bbox;
  const height = bottom - top, mid = (top + bottom) / 2;
  const nearby = lines.filter((line) => line !== label && line.page === label.page && line.bbox && !isLabel(line.text, labels));
  const aligned = (line) => Math.abs(line.bbox[0] - left) < 0.08
    || Math.abs((line.bbox[0] + line.bbox[2]) / 2 - (left + right) / 2) < 0.08;
  const alignmentDistance = (line) => Math.min(Math.abs(line.bbox[0] - left),
    Math.abs((line.bbox[0] + line.bbox[2]) / 2 - (left + right) / 2));
  const blocked = (first, last) => lines.some((line) => line !== label && line.page === label.page && line.bbox && isLabel(line.text, labels)
    && line.bbox[1] >= first && line.bbox[1] < last && aligned(line));
  const row = nearby.filter((line) => line.bbox[0] >= right - 0.005 && line.bbox[0] - right < 0.35
    && Math.abs((line.bbox[1] + line.bbox[3]) / 2 - mid) < Math.max(height, line.bbox[3] - line.bbox[1]) * 0.6
    && !lines.some((other) => other !== label && other.page === label.page && other.bbox && isLabel(other.text, labels)
      && other.bbox[0] >= right && other.bbox[0] < line.bbox[0] && Math.abs(other.bbox[1] - top) < height))
    .sort((a, b) => a.bbox[0] - b.bbox[0]);
  if (row.length) return row;
  // OCR rectangles include padding and can overlap adjacent text; compare their centers as well as their edges.
  const below = nearby.filter((line) => (line.bbox[1] + line.bbox[3]) / 2 > mid + height * 0.35
    && line.bbox[1] >= bottom - height * 0.6 && line.bbox[1] - bottom < 0.065
    && (aligned(line) || (line.bbox[0] <= left && line.bbox[2] >= right)))
    .sort((a, b) => Math.abs(a.bbox[1] - b.bbox[1]) < 0.015 ? alignmentDistance(a) - alignmentDistance(b) : a.bbox[1] - b.bbox[1]);
  const preceding = above ? nearby.filter((line) => (line.bbox[1] + line.bbox[3]) / 2 < mid - height * 0.35
    && line.bbox[3] <= top + height * 0.6 && top - line.bbox[3] < 0.065 && aligned(line))
    .sort((a, b) => b.bbox[3] - a.bbox[3]) : [];
  const useAbove = preceding.length && (!below.length || top - preceding[0].bbox[3] < below[0].bbox[1] - bottom);
  const first = useAbove ? preceding[0] : below[0];
  if (!first || blocked(useAbove ? first.bbox[3] : bottom, useAbove ? top : first.bbox[1])) return [];
  const values = [first];
  if (wrapped) {
    const candidates = useAbove ? preceding : below;
    for (const next of candidates.slice(1)) {
      const prior = values.at(-1);
      const gap = useAbove ? prior.bbox[1] - next.bbox[3] : next.bbox[1] - prior.bbox[3];
      if (gap < -0.005 || gap > 0.025 || values.length >= 3
        || blocked(useAbove ? next.bbox[3] : prior.bbox[3], useAbove ? prior.bbox[1] : next.bbox[1])) break;
      values.push(next);
    }
  }
  return useAbove ? values.reverse() : values;
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
    const found = Object.entries(TYPE_RULES).map(([type, clauses]) => ({ type, confidence: Math.min(...clauses.map((pattern) =>
      clauseConfidence(lines, new RegExp(pattern.source.replaceAll(" ", "\\s+"), pattern.flags)))) }))
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
  const category = ID_DOCUMENT_TYPES.includes(candidateType) ? "id" : SUPPORTING_DOCUMENT_TYPES.includes(candidateType) ? "supporting" : docType;
  const labels = labelsFor(candidateType, category);
  const captionAbove = isBirSupportingDocumentType(candidateType) || candidateType === "CDA Certificate of Registration";
  const candidatesByField = new Map();
  const invalidFields = new Set();
  const fieldValue = (key, value) => {
    if (key.endsWith("date")) {
      const dates = [...value.matchAll(DATE_PATTERN)].map((match) => validDate(match[0]));
      return dates.length === 1 ? dates[0] : "";
    }
    if (key === "tax_identification_number") {
      const digits = value.replace(/[\s-]/g, "");
      return /^\d{9}$/.test(digits) ? digits : "";
    }
    if (key === "branch_code") return /^\d{3,5}$/.test(value) ? value : "";
    if (["document_number", "permit_number"].includes(key)) {
      if (candidateType === "LTO Driver's License" && key === "document_number") {
        const numbers = value.match(/\b[A-Z]\d{2}-\d{2}-\d{6}\b/gi) || [];
        if (numbers.length === 1) return numbers[0];
      }
      return value.length <= 80 && /\d/.test(value) && /^[\p{L}\p{N}][\p{L}\p{N}\s./-]*$/u.test(value)
        && !/X{2,}|masked/i.test(value) && ![...value.matchAll(DATE_PATTERN)].length ? value : "";
    }
    if (value.length > 200 || isLabel(value, labels) || !/\p{L}/u.test(value)) return "";
    if (key.endsWith("name") && key !== "business_name" && /\d/.test(value)) return "";
    return value;
  };
  const add = (key, value, label, values, inline = false) => {
    const parsed = fieldValue(key, value);
    if (!parsed) { if (value) invalidFields.add(key); return; }
    const candidates = candidatesByField.get(key) || [];
    candidates.push({ value: parsed, page: label.page, confidence: Math.min(label.confidence, ...values.map((part) => part.confidence)),
      bbox: values[0]?.bbox, labelBox: label.bbox, inline });
    candidatesByField.set(key, candidates);
  };
  for (const [key, pattern] of Object.entries(labels)) {
    for (const line of lines) {
      const text = line.text.replace(/^\d{1,2}[.)]\s*/, "");
      if (!pattern.test(text) || (key !== "full_name" && COMBINED_NAME_LABEL.test(text))) continue;
      const inline = text.replace(pattern, "").replace(/^[.:\s-]+/, "").trim();
      const values = inline ? [line] : valueLines(line, lines, labels, { above: captionAbove, wrapped: key === "business_name" });
      if (key.endsWith("date")) data[key] = "";
      add(key, inline || values.map((part) => part.text).join(" "), line, values, Boolean(inline));
    }
  }
  if (isBirSupportingDocumentType(candidateType)) {
    for (const label of lines.filter((line) => COMBINED_TIN_LABEL.test(line.text))) {
      const inline = label.text.replace(COMBINED_TIN_LABEL, "").trim();
      const values = inline ? [label] : valueLines(label, lines, labels, { above: true });
      const combined = (inline || values.map((part) => part.text).join(" ")).replace(/[\s-]/g, "");
      if (!/^\d{12,14}$/.test(combined)) continue;
      add("tax_identification_number", combined.slice(0, 9), label, values, Boolean(inline));
      add("branch_code", combined.slice(9), label, values, Boolean(inline));
    }
  }
  if (candidateType === "DTI Business Name Registration") {
    for (const label of lines.filter((line) => /^is valid from\b/i.test(line.text))) {
      const range = label.text.match(/^is valid from\s+(.+?)\s+to\s+(.+?)(?:\s+subject\b|$)/i);
      if (!range) continue;
      add("issue_date", range[1], label, [label], true);
      add("expiration_date", range[2], label, [label], true);
    }
  }
  for (const [key, candidates] of candidatesByField) {
    if (invalidFields.has(key) || new Set(candidates.map((candidate) => candidate.value.toUpperCase())).size > 1) {
      ambiguousFields.push(key);
      continue;
    }
    const field = candidates.sort((a, b) => b.confidence - a.confidence)[0];
    data[key] = field.value;
    fields[key] = field;
  }
  if (!data.full_name && data.first_name && data.last_name) {
    data.full_name = [data.first_name, data.middle_name, data.last_name].filter(Boolean).join(" ");
    fields.full_name = { ...fields.first_name,
      confidence: Math.min(fields.first_name.confidence, fields.last_name.confidence, fields.middle_name?.confidence ?? 1),
      associated: [fields.first_name, fields.last_name, fields.middle_name].filter(Boolean)
        .every((field) => field.inline || field.bbox) };
  }
  if (candidateType === "PhilSys National ID" && !data.document_number && !invalidFields.has("document_number") && !ambiguousFields.includes("document_number")) {
    const numbers = lines.filter((line) => /^\d{4}-\d{4}-\d{4}-\d{4}$/.test(line.text));
    if (new Set(numbers.map((line) => line.text)).size > 1) ambiguousFields.push("document_number");
    else if (numbers.length) {
      const number = numbers.sort((a, b) => b.confidence - a.confidence)[0];
      data.document_number = number.text;
      fields.document_number = { value: number.text, confidence: number.confidence, page: number.page, bbox: number.bbox, inline: true };
    }
  }
  const scores = Object.values(fields).map((field) => field.confidence);
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
    comparison.nameMatches = comparison.nameMatches && strictPrivateIdentityNameMatch(profile, data.full_name, data);
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
  if (docType === "id") {
    for (const key of ["first_name", "last_name"]) {
      if (inspection.lines.some((line) => !COMBINED_NAME_LABEL.test(normalizedLine(line)) && LABELS[key].test(normalizedLine(line)))) required.push(key);
    }
  }
  if (requiresPrivateDocumentExpiry(candidateType)) required.push("expiration_date");
  if (!required.includes("expiration_date") && inspection.lines.some((line) => LABELS.expiration_date.test(line.text))) required.push("expiration_date");
  if (Object.hasOwn(data, "issue_date") || inspection.lines.some((line) => LABELS.issue_date.test(line.text))) required.push("issue_date");
  if (docType === "supporting") {
    if (isBirSupportingDocumentType(candidateType)) required.push("tax_identification_number", "branch_code");
    else if (candidateType !== "Barangay Business Clearance" || profile.permit_number) required.push(data.permit_number ? "permit_number" : "document_number");
  }
  const fieldsPresent = required.every((key) => Boolean(data[key])) && !required.some((key) => ambiguousFields.includes(key));
  const fieldsConfident = fieldsPresent && required.every((key) => fields[key]?.confidence * 100 >= Math.max(90, minimumFieldConfidence)
    && (fields[key].associated ?? Boolean(fields[key].inline || fields[key].bbox)));
  const expired = data.expiration_date ? new Date(`${data.expiration_date}T23:59:59.999Z`) < now : false;
  const inconsistentDates = Boolean(data.issue_date && (data.issue_date > now.toISOString().slice(0, 10)
    || (data.expiration_date && data.issue_date > data.expiration_date)));
  const profileComplete = docType !== "id" || (!requireBirthDate && !profileBirthDate) || Boolean(validDate(profileBirthDate || ""));
  let outcome = "review_needed";
  const screeningChecks = { documentType: documentTypeMatches,
    requiredFields: fieldsPresent && fieldsConfident, validity: fieldsConfident ? !expired && !inconsistentDates : null, registrationDetails: null };
  if (status === "reupload_required") outcome = "correction_needed";
  else if (documentTypeMatches && fieldsConfident && profileComplete) {
    screeningChecks.registrationDetails = comparison.mismatchFields.length === 0;
    if (expired) {
      status = "reupload_required"; reasonCode = DOCUMENT_REASON_CODES.DOCUMENT_EXPIRED;
      reviewReason = "This document has expired. Upload a current document of the selected type."; outcome = "correction_needed";
    } else if (inconsistentDates) {
      reasonCode = DOCUMENT_REASON_CODES.EXTRACTION_UNCERTAIN;
      reviewReason = "The document dates could not be confirmed as currently valid. An administrator must inspect the issue and expiry dates before you can continue.";
      outcome = "review_needed";
      screeningChecks.registrationDetails = null;
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
    const labels = { full_name: "name", first_name: "first name", last_name: "surname", document_number: "document number", birth_date: "birth date", expiration_date: "expiry date",
      business_name: "registered business name", permit_number: "permit or registration number", tax_identification_number: "TIN", branch_code: "branch code" };
    reviewReason = unreadable ? unreadable === "birth_date" && !inspection.lines.some((line) => LABELS.birth_date.test(line.text))
      ? "We could not locate a birth date on this ID. If it does not show your birth date, upload another accepted ID that does. An administrator can inspect this upload."
      : `We could not confirm the ${labels[unreadable] || "issue date"} automatically. An administrator must compare the document before you can continue. You can also upload a clearer complete document.`
      : "Your registration details are incomplete. Correct them before checking this document again.";
    status = unreadable ? "pending_review" : "reupload_required";
    reasonCode = unreadable ? DOCUMENT_REASON_CODES.EXTRACTION_UNCERTAIN : DOCUMENT_REASON_CODES.REGISTRATION_DATA_INCOMPLETE;
    outcome = unreadable ? "review_needed" : "correction_needed";
  }
  const profileBinding = privateScreeningBinding({ profile, sessionId, role, docType, selectedDocType: selected });
  const referenceAssessment = assessDocumentReference({ inspection, docType, selectedDocType: selected,
    detectedType: candidateType, classificationConfident, fields: data, fileHash, reviewVersion, profileBinding });
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
      ? `${data.tax_identification_number}-${data.branch_code}` : docType === "supporting"
        ? data.permit_number || data.document_number : data.document_number) : "",
    privateScreening: {
      referenceAssessment,
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
        profileBinding,
        mismatchFields: outcome === "correction_needed" ? comparison?.mismatchFields || [] : [],
        fieldConfidence: Object.fromEntries(required.map((key) => [key, Math.round((fields[key]?.confidence || 0) * 100)])) },
    },
  };
}
