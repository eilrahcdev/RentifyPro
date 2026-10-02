import { GoogleGenerativeAI } from "@google/generative-ai";
import { assertGeminiSensitiveDataAllowed } from "../utils/geminiDataPolicy.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import {
  ID_DOCUMENT_TYPES,
  SUPPORTING_DOCUMENT_TYPES,
  resolveSupportedDocumentType,
} from "./documentValidation.service.js";

const clean = (value, max = 200) => String(value || "").trim().slice(0, max);
const toStringArray = (value) => Array.isArray(value)
  ? value.map((entry) => clean(entry, 100)).filter(Boolean).slice(0, 8)
  : [];
const toStrictBoolean = (value) => value === true;
const STRUCTURAL_BOOLEAN_FIELDS = [
  "official_markings_present",
  "layout_consistent",
  "holder_portrait_present",
  "document_number_region_present",
  "birth_date_region_present",
  "expiration_date_region_present",
  "machine_readable_zone_present",
  "business_registration_features_present",
];
const ALLOWED_DOCUMENT_SURFACES = new Set([
  "PHYSICAL_DOCUMENT",
  "OFFICIAL_DIGITAL_DOCUMENT",
  "SCREENSHOT",
  "PLAIN_PAPER",
  "HANDWRITTEN_NOTE",
  "PRINTED_TEXT",
  "UNRELATED_IMAGE",
  "UNKNOWN",
]);

export const normalizeDocumentConfidence = (value) => {
  const raw = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.max(0, Math.min(100, raw > 0 && raw <= 1 ? raw * 100 : raw));
};

export const requiresManualDocumentReview = (confidence, minimum = 70) =>
  normalizeDocumentConfidence(confidence) < Math.max(0, Math.min(100, Number(minimum) || 0));

const safeJsonParse = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};

const summarizeGeminiError = (error) => [
  String(error?.message || ""),
  error?.status ? `status=${error.status}` : "",
  error?.code ? `code=${error.code}` : "",
].filter(Boolean).join(" | ");

const toSafeGeminiError = (error, { timedOut = false } = {}) => {
  const detail = summarizeGeminiError(error);
  const isLimitError = /\b429\b|quota|rate[\s-]*limit|resource[\s-]*exhausted|too many requests/i.test(detail);
  const providerStatus = Number(error?.status);
  const status = timedOut ? 504
    : Number.isInteger(providerStatus) && providerStatus >= 400 && providerStatus <= 599
      ? providerStatus : isLimitError ? 429 : 503;
  const retryable = [408, 429, 500, 502, 503, 504].includes(status);
  auditLog.error("KYC", "Gemini document extraction failed", { detail, httpStatus: status, retryable });
  const safe = new Error(status === 429
    ? "Document screening is temporarily busy. We will retry automatically."
    : retryable
      ? "Document screening is temporarily unavailable. We will send the document for manual review if retries do not succeed."
      : "Automated screening is unavailable. A reviewer will check this document manually.");
  safe.status = status;
  safe.retryable = retryable;
  if (timedOut) safe.code = "GEMINI_REQUEST_TIMEOUT";
  safe.publicMessage = safe.message;
  return safe;
};

const documentRequestTimeoutMs = () => {
  const configured = Number(process.env.KYC_GEMINI_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1 && configured <= 2_147_483_647
    ? Math.floor(configured) : 30_000;
};

export const buildDocumentExtractionInstruction = ({ docType = "id" } = {}) => {
  const isId = docType === "id";
  const allowedTypes = isId ? ID_DOCUMENT_TYPES : SUPPORTING_DOCUMENT_TYPES;
  const fieldInstructions = isId
    ? "Extract the holder's full name, birth date, document number, issue date, and expiration date when visibly present."
    : "Extract the registered person name, business name, document reference, permit or registration number, issue date, and expiration date when visibly present. For a BIR Certificate of Registration or Notice to Issue Receipt/Invoice, extract the 9-digit TIN and its branch code into separate fields. Do not treat a TIN as a permit number. Do not invent a permit or document number if none is visible.";

  return `Independently inspect one uploaded Philippine ${isId ? "identity" : "business registration"} document for RentifyPro.
Do not approve, reject, or compare the upload with any registration data. No user-selected document type is provided to you.
Follow this order exactly: image quality, document recognition, independent document classification, document structure, then visible-field extraction.

Recognition rules:
- Matching names, dates, numbers, or field labels do not prove that an upload is a document.
- A plain sheet of paper, handwritten note, typed or printed personal information, screenshot of text, unrelated image, unsupported document, or ambiguous image must have recognized_document=false and document_type="UNKNOWN".
- Do not choose the closest allowed type. Use "UNKNOWN" whenever the visible layout and official features do not confidently establish one exact type.
- recognized_document may be true only when the upload visibly has the expected official layout and structural characteristics of the classified type.
- Do not infer, invent, or complete values that are not clearly visible.

Allowed exact document_type values:
${allowedTypes.map((item) => `- ${item}`).join("\n")}
- UNKNOWN

document_surface must be exactly one of: PHYSICAL_DOCUMENT, OFFICIAL_DIGITAL_DOCUMENT, SCREENSHOT, PLAIN_PAPER, HANDWRITTEN_NOTE, PRINTED_TEXT, UNRELATED_IMAGE, UNKNOWN.
For a Philippine Passport, confirm the passport layout, holder portrait, document-number area, biographic-data area, expiration-date area, and machine-readable zone.
For an LTO Driver's License, confirm the license-card layout, official markings, holder portrait, license-number area, birth-date area, and expiration-date area.
For a PhilSys National ID or another supported ID, confirm the expected card layout, official markings, holder portrait, document-number area, and birth-date area.
For a supporting business document, confirm the official layout, issuing-body markings, and business-registration features. The identifier area may show a permit or registration number, a TIN and branch code on a BIR document, or no reference number on a Barangay Business Clearance.
Set authenticity_uncertain=true when the document is recognized but its official structure or visible security characteristics cannot be confidently assessed. Set suspected_tampering=true only for visible signs of alteration; do not claim issuer or database authentication.
${fieldInstructions}

Return JSON only with this exact structure:
{
  "image_readable": boolean,
  "recognized_document": boolean,
  "document_type": string,
  "issuing_country": string,
  "classification_confidence": number,
  "document_surface": string,
  "structural_features": {
    "official_markings_present": boolean,
    "layout_consistent": boolean,
    "holder_portrait_present": boolean,
    "document_number_region_present": boolean,
    "birth_date_region_present": boolean,
    "expiration_date_region_present": boolean,
    "machine_readable_zone_present": boolean,
    "business_registration_features_present": boolean
  },
  "authenticity_uncertain": boolean,
  "suspected_tampering": boolean,
  "warnings": string[],
  "extraction_confidence": number,
  "extracted_data": {
    "full_name": string,
    "birth_date": "YYYY-MM-DD" | "",
    "document_number": string,
    "issue_date": "YYYY-MM-DD" | "",
    "expiration_date": "YYYY-MM-DD" | "",
    "business_name": string,
    "permit_number": string,
    "tax_identification_number": string,
    "branch_code": string
  }
}`;
};

export const normalizeDocumentInspection = (parsed) => {
  const features = parsed?.structural_features;
  const data = parsed?.extracted_data;
  const rawType = parsed?.document_type ?? parsed?.doc_type;
  const rawCountry = parsed?.issuing_country ?? parsed?.country;
  const rawClassificationConfidence = Number(parsed?.classification_confidence);
  const rawExtractionConfidence = Number(parsed?.extraction_confidence ?? parsed?.confidence);
  const surface = clean(parsed?.document_surface, 40).toUpperCase();
  const completeResponse = parsed
    && typeof parsed === "object"
    && !Array.isArray(parsed)
    && typeof parsed.image_readable === "boolean"
    && typeof parsed.recognized_document === "boolean"
    && typeof rawType === "string"
    && typeof rawCountry === "string"
    && Number.isFinite(rawClassificationConfidence)
    && ALLOWED_DOCUMENT_SURFACES.has(surface)
    && features
    && typeof features === "object"
    && !Array.isArray(features)
    && STRUCTURAL_BOOLEAN_FIELDS.every((field) => typeof features[field] === "boolean")
    && typeof parsed.authenticity_uncertain === "boolean"
    && typeof parsed.suspected_tampering === "boolean"
    && Number.isFinite(rawExtractionConfidence)
    && data
    && typeof data === "object"
    && !Array.isArray(data);

  if (!completeResponse) {
    const error = new Error("The document extraction service returned an incomplete response.");
    error.status = 503;
    throw error;
  }

  return {
    image_readable: toStrictBoolean(parsed.image_readable),
    recognized_document: toStrictBoolean(parsed.recognized_document),
    document_type: clean(rawType, 140) || "UNKNOWN",
    issuing_country: clean(rawCountry, 40),
    classification_confidence: normalizeDocumentConfidence(rawClassificationConfidence),
    document_surface: surface,
    structural_features: Object.fromEntries(
      STRUCTURAL_BOOLEAN_FIELDS.map((field) => [field, toStrictBoolean(features[field])])
    ),
    authenticity_uncertain: toStrictBoolean(parsed.authenticity_uncertain),
    suspected_tampering: toStrictBoolean(parsed.suspected_tampering),
    warnings: toStringArray(parsed.warnings || parsed.quality_issues),
    extraction_confidence: normalizeDocumentConfidence(rawExtractionConfidence),
    extracted_data: {
      full_name: clean(data.full_name, 160),
      birth_date: clean(data.birth_date, 40),
      document_number: clean(data.document_number, 120),
      issue_date: clean(data.issue_date, 40),
      expiration_date: clean(data.expiration_date, 40),
      business_name: clean(data.business_name, 180),
      permit_number: clean(data.permit_number, 120),
      tax_identification_number: clean(data.tax_identification_number, 40),
      branch_code: clean(data.branch_code, 20),
    },
  };
};

export async function verifyPhilippinesDocument({
  base64,
  mimeType = "image/jpeg",
  docType = "id",
  selectedDocType = "",
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const error = new Error("Gemini document extraction is not configured.");
    error.status = 503;
    error.retryable = false;
    throw error;
  }
  try {
    assertGeminiSensitiveDataAllowed();
  } catch (error) {
    error.retryable = false;
    throw error;
  }
  if (!base64) {
    const error = new Error("The uploaded document file is missing.");
    error.status = 400;
    error.permanent = true;
    throw error;
  }

  const cleanBase64 = String(base64).includes("base64,")
    ? String(base64).split("base64,")[1]
    : String(base64);
  const approxBytes = Math.floor(cleanBase64.length * 0.75);
  const maxBytes = Number(process.env.KYC_DOC_MAX_BYTES || 4 * 1024 * 1024);
  if (approxBytes > maxBytes) {
    const error = new Error("The document is too large to process.");
    error.status = 413;
    error.permanent = true;
    throw error;
  }

  const selectedCanonical = resolveSupportedDocumentType(selectedDocType, docType);
  if (!selectedCanonical) {
    const error = new Error("The selected document type is not supported.");
    error.status = 400;
    error.permanent = true;
    throw error;
  }

  // The selected type is intentionally validated here but never included in the model prompt.
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_VISION_MODEL || "gemini-3.5-flash-lite",
    systemInstruction: buildDocumentExtractionInstruction({ docType }),
  });

  let result;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), documentRequestTimeoutMs());
  try {
    result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [
          { text: "Inspect this upload independently and return the required JSON only." },
          { inlineData: { data: cleanBase64, mimeType } },
        ],
      }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }, { signal: controller.signal });
  } catch (error) {
    throw toSafeGeminiError(error, { timedOut: controller.signal.aborted });
  } finally {
    clearTimeout(timeout);
  }

  const parsed = safeJsonParse(result?.response?.text?.() || "");
  return normalizeDocumentInspection(parsed);
}
