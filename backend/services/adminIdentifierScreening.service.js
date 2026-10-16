import mongoose from "mongoose";
import { createHash, randomUUID } from "node:crypto";
import { createDocumentFingerprint, resolveSupportedDocumentType } from "../data/private-kyc/services/documentValidation.service.js";
import { extractPrivateDocumentFields, evaluatePrivateDocumentInspection } from "../data/private-kyc/services/privateDocumentExtraction.service.js";
import { inspectPrivateKycDocument } from "../data/private-kyc/services/privateKycOcr.service.js";
import { readPrivateKycEvidence } from "../data/private-kyc/services/privateKycReviewContext.js";
import { getPrivateKycInternalKey, isPrivateKycServiceUrl } from "../data/private-kyc/utils/kycScreeningProvider.js";
import { ensureKycEvidence } from "./remoteKycStorage.service.js";
import { documentOwner } from "./adminDomain.service.js";

const VERSION = 1;
let running = false, timer;
export function identifierScreeningEnabled(env = process.env) {
  return env.ADMIN_IDENTIFIER_SCREENING_ENABLED !== "false" && env.KYC_DOCUMENT_PROVIDER === "private_ocr"
    && isPrivateKycServiceUrl(env.KYC_PRIVATE_SERVICE_URL, env.NODE_ENV === "production")
    && getPrivateKycInternalKey(env).length >= 32 && String(env.KYC_DOCUMENT_FINGERPRINT_SECRET || "").trim().length >= 32;
}

function currentFinding(document) {
  const finding = document?.adminIdentifierScreening;
  return finding?.version === VERSION && finding.fileHash === document.fileHash
    && finding.reviewVersion === (document.reviewVersion || document.fileHash) && finding.sessionId === document.sessionId
    && finding.selectedDocCategory === document.selectedDocCategory ? finding : null;
}

function reviewRevision(finding) {
  return createHash("sha256").update(JSON.stringify([finding.token, finding.state, finding.fileHash, finding.reviewVersion,
    finding.sessionId, finding.selectedDocCategory, finding.fingerprint, finding.confidence])).digest("hex");
}

export function currentIdentifierFingerprint(document) {
  if (document?.documentNumberFingerprint) return document.documentNumberFingerprint;
  const finding = currentFinding(document);
  return finding?.state === "complete" && finding.confidence >= 95 && /^[a-f\d]{64}$/.test(finding.fingerprint || "") ? finding.fingerprint : "";
}

export function identifierScreeningSummary(document) {
  if (document?.documentNumberFingerprint) return { state: "complete", identifierAvailable: true };
  if (document?.docType !== "id") return null;
  const finding = currentFinding(document);
  if (!finding) return { state: identifierScreeningEnabled() ? "pending" : "disabled", identifierAvailable: false };
  const state = finding.state === "processing" && !(new Date(finding.lockedAt).getTime() > Date.now() - 5 * 60_000)
    ? "retry_wait" : finding.state;
  return { state, identifierAvailable: Boolean(currentIdentifierFingerprint(document)), reviewRevision: reviewRevision(finding),
    maskedIdentifier: finding.state === "complete" ? finding.maskedIdentifier : undefined,
    checkedAt: finding.checkedAt, nextAttemptAt: finding.nextAttemptAt };
}

export const identifierRevisionFilter = document => ({ adminIdentifierScreening: document.adminIdentifierScreening === undefined
  ? { $exists: false } : document.adminIdentifierScreening });

export function assertIdentifierScreeningSettled(document) {
  const finding = currentFinding(document);
  if (finding?.state === "processing" && new Date(finding.lockedAt).getTime() > Date.now() - 5 * 60_000) {
    throw Object.assign(new Error("Identifier screening is running. Refresh this review shortly before approving."), { status: 409 });
  }
}

export function assertIdentifierInspectionCurrent(document, input) {
  const finding = currentFinding(document);
  if (!document.documentNumberFingerprint && finding?.state === "complete" && currentIdentifierFingerprint(document)
    && input?.identifierScreeningRevision !== reviewRevision(finding)) {
    throw Object.assign(new Error("Identifier screening changed. Refresh the review and compare the masked ID before approving."), { status: 409 });
  }
}

export function identifierDuplicateFilter(document, fingerprint) {
  return { _id: { $ne: document._id }, email: { $ne: document.email }, status: { $in: ["pending_review", "verified", "rejected"] },
    $or: [{ documentNumberFingerprint: fingerprint }, { "adminIdentifierScreening.version": VERSION,
      "adminIdentifierScreening.state": "complete", "adminIdentifierScreening.fingerprint": fingerprint,
      "adminIdentifierScreening.confidence": { $gte: 95 }, $expr: { $and: [
        { $eq: ["$adminIdentifierScreening.fileHash", "$fileHash"] },
        { $eq: ["$adminIdentifierScreening.reviewVersion", { $ifNull: ["$reviewVersion", "$fileHash"] }] },
        { $eq: ["$adminIdentifierScreening.sessionId", "$sessionId"] },
        { $eq: ["$adminIdentifierScreening.selectedDocCategory", "$selectedDocCategory"] },
      ] } }] };
}

export function withCachedIdentifierTypeEvidence(document) {
  const finding = currentFinding(document);
  if (document.provider !== "private-ocr" || !currentIdentifierFingerprint(document) || !finding?.typeCheck
    || document.privateScreening?.typeCheck || (document.privateScreening?.candidateType
      && document.privateScreening.candidateType !== finding.typeCheck.selectedType)) return document;
  return { ...document, privateScreening: { ...document.privateScreening,
    candidateType: finding.typeCheck.selectedType, typeCheck: finding.typeCheck } };
}

export function extractIdentifierFinding(document, inspection) {
  const selected = resolveSupportedDocumentType(document.selectedDocCategory, "id");
  const reading = extractPrivateDocumentFields(inspection, "id");
  const field = reading.fields.document_number;
  const minimumClassification = Math.max(90, Number(process.env.KYC_DOCUMENT_CLASSIFICATION_MIN_CONFIDENCE) || 90);
  const decision = evaluatePrivateDocumentInspection({ inspection, docType: "id", selectedDocType: selected,
    profile: document.profileSnapshot || {}, fileHash: document.fileHash, reviewVersion: document.reviewVersion || document.fileHash,
    sessionId: document.sessionId, role: document.role, minimumClassificationConfidence: minimumClassification });
  const confident = inspection.layoutVersion === 2 && selected && reading.candidateType === selected && reading.typeEvidence.length === 1
    && decision.privateScreening.typeCheck.documentTypeMatches && field?.confidence >= 0.95 && field.bbox
    && !reading.ambiguousFields.includes("document_number");
  const identifier = confident ? String(reading.data.document_number || "").toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  if (identifier.length < 5 || identifier.length > 80) return { state: "uncertain", reason: "identifier_uncertain" };
  return { state: "complete", fingerprint: createDocumentFingerprint(identifier), maskedIdentifier: `**** ${identifier.slice(-4)}`,
    confidence: Math.floor(field.confidence * 100), typeCheck: decision.privateScreening.typeCheck };
}

export function identifierScreeningCandidateFilter(now) {
  return { docType: "id", provider: { $in: ["private-ocr", "manual"] }, status: "pending_review",
    documentNumberFingerprint: { $in: [null, ""] }, fileHash: { $regex: "^[a-f0-9]{64}$" }, fileKey: { $type: "string", $ne: "" },
    $and: [
      { $or: [{ registeredUser: { $type: "objectId" } }, { sessionId: /^user:[a-f\d]{24}$/i },
        { sessionId: /^reverify:[a-f\d]{24}:[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i }] },
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
      { $or: [{ "adminIdentifierScreening.version": { $ne: VERSION } },
        { $expr: { $ne: ["$adminIdentifierScreening.fileHash", "$fileHash"] } },
        { $expr: { $ne: ["$adminIdentifierScreening.reviewVersion", { $ifNull: ["$reviewVersion", "$fileHash"] }] } },
        { $expr: { $ne: ["$adminIdentifierScreening.sessionId", "$sessionId"] } },
        { $expr: { $ne: ["$adminIdentifierScreening.selectedDocCategory", "$selectedDocCategory"] } },
        { "adminIdentifierScreening.state": "retry_wait", "adminIdentifierScreening.nextAttemptAt": { $lte: now } },
        { "adminIdentifierScreening.state": "unavailable", "adminIdentifierScreening.nextAttemptAt": { $lte: now } },
        { "adminIdentifierScreening.state": "processing", "adminIdentifierScreening.lockedAt": { $lte: new Date(now.getTime() - 5 * 60_000) } },
      ] },
    ] };
}

export async function runAdminIdentifierScreening(database = mongoose.connection.db, { now = new Date(), inspect = inspectPrivateKycDocument,
  ensure = ensureKycEvidence } = {}) {
  if (running || !database || !identifierScreeningEnabled()) return { processed: 0 };
  running = true;
  let processed = 0;
  try {
    const collection = database.collection("prekycdocuments");
    for (let count = 0; count < 2; count++) {
      const token = randomUUID();
      const candidate = await collection.findOne(identifierScreeningCandidateFilter(now), { sort: { createdAt: 1, _id: 1 } });
      if (!candidate) break;
      const previous = currentFinding(candidate);
      const attempts = (previous?.attempts || 0) + 1;
      const finding = { version: VERSION, token, fileHash: candidate.fileHash, reviewVersion: candidate.reviewVersion || candidate.fileHash,
        sessionId: candidate.sessionId, selectedDocCategory: candidate.selectedDocCategory, attempts, checkedAt: now };
      const claimed = await collection.findOneAndUpdate({ _id: candidate._id, status: "pending_review", fileHash: candidate.fileHash,
        reviewVersion: candidate.reviewVersion ?? null, ...identifierRevisionFilter(candidate), documentNumberFingerprint: { $in: [null, ""] },
        sessionId: candidate.sessionId, registeredUser: candidate.registeredUser ?? null, selectedDocCategory: candidate.selectedDocCategory,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      }, { $set: { adminIdentifierScreening: { ...finding, state: "processing", lockedAt: now } } }, { returnDocument: "after" });
      const document = claimed?.value ?? claimed;
      if (!document) continue;
      try {
        if (documentOwner(document).conflict) throw new Error("Conflicting owner");
        const directory = await ensure(document);
        const bytes = await readPrivateKycEvidence(document, directory);
        const inspection = await inspect({ base64: bytes.toString("base64"), mimeType: document.mimeType });
        Object.assign(finding, extractIdentifierFinding(document, inspection));
      } catch {
        Object.assign(finding, attempts < 3 ? { state: "retry_wait", reason: "screening_unavailable",
          nextAttemptAt: new Date(now.getTime() + 60_000 * 2 ** (attempts - 1)) }
          : { state: "unavailable", reason: "screening_unavailable", nextAttemptAt: new Date(now.getTime() + 15 * 60_000) });
      }
      await collection.updateOne({ _id: document._id, status: "pending_review", fileHash: document.fileHash,
        reviewVersion: document.reviewVersion ?? null, sessionId: document.sessionId, registeredUser: document.registeredUser ?? null,
        selectedDocCategory: document.selectedDocCategory, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
        "adminIdentifierScreening.token": token }, { $set: { adminIdentifierScreening: finding } });
      processed++;
    }
    return { processed };
  } finally { running = false; }
}

export function startAdminIdentifierScreeningJob() {
  if (timer || !identifierScreeningEnabled()) return;
  const run = () => void runAdminIdentifierScreening().catch(() => console.warn("Background identifier screening will retry after a database interruption."));
  run(); timer = setInterval(run, 30_000); timer.unref?.();
}
