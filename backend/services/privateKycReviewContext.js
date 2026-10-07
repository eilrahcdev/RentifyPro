import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { inspectPrivateKycDocument } from "./privateKycOcr.service.js";
import { extractPrivateDocumentFields, evaluatePrivateDocumentInspection, PRIVATE_DOCUMENT_TYPE_CHECK_VERSION } from "./privateDocumentExtraction.service.js";
import { canManuallyCompareDocument } from "./manualDocumentComparison.js";
import { resolveSupportedDocumentType } from "./documentValidation.service.js";

const fail = (message) => Object.assign(new Error(message), { status: 409 });
const classificationMinimum = () => {
  const value = Number(process.env.KYC_DOCUMENT_CLASSIFICATION_MIN_CONFIDENCE);
  return Number.isFinite(value) && value > 0 ? value : 90;
};

export async function refreshPrivateDocumentTypeEvidence(document, bytes) {
  const check = document.privateScreening?.typeCheck;
  if (document.provider !== "private-ocr" || (check?.version === PRIVATE_DOCUMENT_TYPE_CHECK_VERSION
    && check.fileHash === document.fileHash && check.reviewVersion === (document.reviewVersion || document.fileHash)
    && check.selectedType === resolveSupportedDocumentType(document.selectedDocCategory, document.docType))) return document;
  if (process.env.KYC_DOCUMENT_PROVIDER !== "private_ocr" || !process.env.KYC_PRIVATE_SERVICE_URL) return document;
  try {
    const inspection = await inspectPrivateKycDocument({ base64: bytes.toString("base64"), mimeType: document.mimeType });
    const decision = evaluatePrivateDocumentInspection({ inspection, docType: document.docType,
      selectedDocType: document.selectedDocCategory, profile: document.profileSnapshot || {},
      minimumClassificationConfidence: classificationMinimum(),
      fileHash: document.fileHash, reviewVersion: document.reviewVersion || document.fileHash });
    return { ...(document.toObject?.() || document), privateScreening: decision.privateScreening };
  } catch { return document; }
}

export async function readPrivateKycEvidence(document, directory) {
  const root = path.resolve(directory);
  const key = document.fileKey;
  if (!key || key !== path.basename(key) || /[\\/]/.test(key)) throw fail("Invalid private document file reference.");
  const file = path.resolve(root, key);
  try {
    const actual = await fs.realpath(file);
    const info = await fs.stat(actual);
    if (path.dirname(actual) !== await fs.realpath(root) || !info.isFile() || info.size > 4 * 1024 * 1024) {
      throw fail("The private document file cannot be reviewed securely.");
    }
    const bytes = await fs.readFile(actual);
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== document.fileHash) {
      throw fail("Document integrity check failed. Ask for a new upload.");
    }
    return bytes;
  } catch (error) {
    if (error.status) throw error;
    throw fail("The private document file is unavailable. Ask for a new upload.");
  }
}

export async function getPrivateKycReviewContext(document, directory) {
  if (!canManuallyCompareDocument(document)) throw fail("This document is not awaiting private/manual review.");
  const bytes = await readPrivateKycEvidence(document, directory);
  const profile = {};
  for (const key of ["first_name", "last_name", "full_name", "date_of_birth", "business_name", "permit_number", "tax_identification_number", "branch_code"]) {
    if (typeof document.profileSnapshot?.[key] === "string") profile[key] = document.profileSnapshot[key];
  }
  let fields = {}, extractionNote = "Read the values directly from the original document.";
  let documentTypeCheck = document.privateScreening?.typeCheck || null;
  if (process.env.KYC_DOCUMENT_PROVIDER === "private_ocr" && process.env.KYC_PRIVATE_SERVICE_URL
    && document.detailsMatched !== true) {
    try {
      const inspection = await inspectPrivateKycDocument({ base64: bytes.toString("base64"), mimeType: document.mimeType });
      fields = extractPrivateDocumentFields(inspection, document.docType).data;
      const decision = evaluatePrivateDocumentInspection({ inspection, docType: document.docType,
        selectedDocType: document.selectedDocCategory, profile: document.profileSnapshot || {},
        minimumClassificationConfidence: classificationMinimum(),
        fileHash: document.fileHash, reviewVersion: document.reviewVersion || document.fileHash });
      documentTypeCheck = decision.privateScreening.typeCheck;
      extractionNote = decision.checks.documentTypeMatches
        ? "The detected document type matches. These are OCR suggestions; inspect the original document and correct each value before saving."
        : decision.reviewReason;
    } catch {
      extractionNote = "OCR suggestions are unavailable. Read and enter the values from the original document.";
    }
  }
  return { profile, fields, extractionNote, documentTypeCheck, fileHash: document.fileHash,
    reviewVersion: document.reviewVersion || document.fileHash };
}
