import { GoogleGenerativeAI } from "@google/generative-ai";
import { auditLog } from "../middleware/auditLogger.middleware.js";

const ID_DOC_TYPES = [
  "PhilSys National ID",
  "Philippine Passport",
  "LTO Driver's License",
  "UMID",
  "PRC ID",
  "SSS ID",
  "GSIS ID",
  "PhilHealth ID",
  "Postal ID",
  "Voter's ID",
];

const SUPPORTING_DOC_TYPES = [
  "DTI Business Name Registration",
  "SEC Certificate of Registration",
  "Mayor's/Business Permit",
  "BIR Certificate of Registration (Form 2303)",
  "Barangay Business Clearance",
  "CDA Certificate of Registration",
];

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeCountry = (value) => {
  const cleaned = normalizeText(value);
  if (cleaned.includes("philippines") || cleaned === "ph" || cleaned === "phl") return "PH";
  return cleaned ? cleaned.toUpperCase() : "";
};

const pickAllowedDocTypes = (docType) =>
  docType === "supporting" ? SUPPORTING_DOC_TYPES : ID_DOC_TYPES;

const isAllowedDocType = (docType, allowed) => {
  const normalized = normalizeText(docType);
  if (!normalized) return false;
  return allowed.some((entry) => {
    const normEntry = normalizeText(entry);
    return normEntry === normalized || normEntry.includes(normalized) || normalized.includes(normEntry);
  });
};

const safeJsonParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const safeStringify = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
};

const GEMINI_LIMIT_MESSAGE =
  "Document verification is temporarily busy due to high demand. Please try again in a few minutes.";
const GEMINI_UNAVAILABLE_MESSAGE =
  "Document verification is temporarily unavailable right now. Please try again later.";

const summarizeGeminiError = (error) => {
  const message = String(error?.message || "");
  const parts = [message];
  if (error?.status) parts.push(`status=${error.status}`);
  if (error?.code) parts.push(`code=${error.code}`);
  if (error?.response?.status) parts.push(`responseStatus=${error.response.status}`);
  if (error?.response?.data) parts.push(`responseData=${safeStringify(error.response.data)}`);
  if (error?.stack) parts.push(`stack=${String(error.stack)}`);
  return parts.filter(Boolean).join(" | ");
};

const toSafeGeminiError = (error) => {
  const raw = summarizeGeminiError(error);
  const isLimitError =
    /\b429\b/i.test(raw) ||
    /quota/i.test(raw) ||
    /rate[\s-]*limit/i.test(raw) ||
    /resource[\s-]*exhausted/i.test(raw) ||
    /too many requests/i.test(raw);

  auditLog.error("KYC", "Gemini document verification failed", { detail: raw });

  const safe = new Error(isLimitError ? GEMINI_LIMIT_MESSAGE : GEMINI_UNAVAILABLE_MESSAGE);
  safe.status = isLimitError ? 429 : 503;
  return safe;
};

export async function verifyPhilippinesDocument({ base64, mimeType = "image/jpeg", docType = "id" }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing in backend .env");

  if (!base64) throw new Error("Document image missing");

  const cleanBase64 = String(base64).includes("base64,")
    ? String(base64).split("base64,")[1]
    : String(base64);
  const approxBytes = Math.floor(cleanBase64.length * 0.75);
  const maxBytes = Number(process.env.KYC_DOC_MAX_BYTES || 4 * 1024 * 1024);
  if (approxBytes > maxBytes) {
    return {
      passed: false,
      confidence: 0,
      country: "",
      doc_type: "Unknown",
      reason: "Document file is too large. Please upload a smaller image.",
    };
  }

  const allowedDocTypes = pickAllowedDocTypes(docType);
  const docLabel = docType === "supporting" ? "supporting business document" : "government ID";
  const allowedList = allowedDocTypes.map((entry) => `- ${entry}`).join("\n");

  const instruction = `
You are a strict document verification system for RentifyPro.

You will receive a single document image (photo or scan).

Task:
1) Decide if the document is a REAL ${docLabel} issued in the Philippines.
2) Identify the document type ONLY from the allowed list below.
3) If it is NOT from the Philippines or the type is unclear, fail.

Allowed document types:
${allowedList}

Return ONLY JSON:
{
  "passed": boolean,
  "confidence": number,
  "country": "PH" | "Unknown",
  "doc_type": "one of the allowed list" | "Unknown",
  "reason": string
}
`.trim();

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash-lite";
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: instruction,
  });

  let result;
  try {
    result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: "Document image:" },
            { inlineData: { data: cleanBase64, mimeType } },
            { text: "Analyze and return JSON only." },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });
  } catch (error) {
    throw toSafeGeminiError(error);
  }

  const text = result?.response?.text?.() ?? "";
  const parsed = safeJsonParse(text.trim());

  if (!parsed || typeof parsed.passed !== "boolean") {
    return {
      passed: false,
      confidence: 0,
      country: "",
      doc_type: "Unknown",
      reason: "AI returned an invalid response. Please upload a clearer document image.",
    };
  }

  const country = normalizeCountry(parsed.country);
  const docTypeValue = String(parsed.doc_type || "Unknown").trim();
  const allowed = isAllowedDocType(docTypeValue, allowedDocTypes);
  const confidence = Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0;

  if (!parsed.passed || country !== "PH" || !allowed) {
    return {
      passed: false,
      confidence,
      country: country || "Unknown",
      doc_type: allowed ? docTypeValue : "Unknown",
      reason:
        parsed.reason ||
        "Only valid Philippine documents are accepted. Please upload a supported Philippine document.",
    };
  }

  return {
    passed: true,
    confidence,
    country: "PH",
    doc_type: docTypeValue,
    reason: parsed.reason || "Document verified.",
  };
}
