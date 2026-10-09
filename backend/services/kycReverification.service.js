import crypto from "node:crypto";
import KycVerification from "../models/KycVerification.js";
import PreKycDocument from "../models/PreKycDocument.js";
import User from "../models/User.js";
import { identityProfileMatchesSnapshot } from "../utils/preKycDocs.js";

const fail = (message) => Object.assign(new Error(message), { status: 409 });
const validAttemptId = (attemptId) => typeof attemptId === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(attemptId);
export const reverificationSessionId = (userId, attemptId) => `reverify:${userId}:${attemptId}`;
export const reverificationFaceKey = (attemptId) => `pre:reverify:${attemptId}`;

export function publicReverification(kyc, now = new Date()) {
  const attempt = kyc?.faceReverification;
  if (!attempt) return null;
  return {
    attemptId: attempt.attemptId,
    status: !["approved", "cancelled"].includes(attempt.status) && new Date(attempt.expiresAt) <= now ? "expired" : attempt.status,
    completedAt: attempt.completedAt || null,
  };
}

export async function startFaceReverification(user, documentHash, profileSnapshot) {
  if (user.kycStatus !== "approved") throw fail("Complete identity verification before starting face reverification.");
  const attemptId = crypto.randomUUID();
  const now = new Date();
  const configuredHours = Number(process.env.KYC_PENDING_REVIEW_RETENTION_HOURS || 72);
  const hours = Number.isFinite(configuredHours) && configuredHours > 0 ? configuredHours : 72;
  const result = await KycVerification.updateOne({ user: user._id, status: "approved" }, { $set: { faceReverification: {
    attemptId, status: "id_uploaded", documentHash,
    profileSnapshot: { full_name: profileSnapshot.full_name, date_of_birth: profileSnapshot.date_of_birth }, createdAt: now,
    expiresAt: new Date(now.getTime() + hours * 60 * 60 * 1000),
  } } }, { timestamps: false });
  if (!result.matchedCount) throw fail("Your identity approval record needs review before you can reverify. Contact support.");
  return { attemptId, sessionId: reverificationSessionId(user._id, attemptId) };
}

export async function getFaceReverificationAttempt(userId, attemptId) {
  if (!validAttemptId(attemptId)) throw fail("Start Reverify face before submitting a selfie.");
  const kyc = await KycVerification.findOne({ user: userId, status: "approved", "faceReverification.attemptId": attemptId });
  const attempt = kyc?.faceReverification;
  if (!attempt || ["approved", "cancelled"].includes(attempt.status) || new Date(attempt.expiresAt) <= new Date()) {
    throw fail("This reverification attempt ended or expired. Start Reverify face again.");
  }
  return attempt;
}

export async function recordFaceReverification(userId, attemptId, result) {
  await getFaceReverificationAttempt(userId, attemptId);
  const score = Number(result.confidence);
  const update = await KycVerification.updateOne({
    user: userId, status: "approved", "faceReverification.attemptId": attemptId,
    "faceReverification.status": { $in: ["id_uploaded", "selfie_matched", "rejected"] },
    "faceReverification.expiresAt": { $gt: new Date() },
  }, { $set: {
    "faceReverification.status": result.verified === true ? "selfie_matched" : "rejected",
    "faceReverification.faceMatchedAt": result.verified === true ? new Date() : null,
    "faceReverification.faceMatchScore": Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
  } }, { timestamps: false });
  if (!update.matchedCount) throw fail("This attempt was replaced or cancelled. Start Reverify face again.");
  return reconcileFaceReverification(userId);
}

export async function cancelFaceReverification(userId, attemptId) {
  if (!validAttemptId(attemptId)) throw fail("This reverification attempt is invalid. Refresh your status.");
  await KycVerification.updateOne({
    user: userId, "faceReverification.attemptId": attemptId,
    "faceReverification.status": { $in: ["id_uploaded", "selfie_matched", "rejected"] },
  }, { $set: { "faceReverification.status": "cancelled" } }, { timestamps: false });
}

export async function reconcileFaceReverification(userId) {
  const kyc = await KycVerification.findOne({ user: userId });
  const attempt = kyc?.faceReverification;
  if (kyc?.status !== "approved" || attempt?.status !== "selfie_matched" || !attempt.faceMatchedAt
    || new Date(attempt.expiresAt) <= new Date()) return kyc;
  const document = await PreKycDocument.findOne({
    sessionId: reverificationSessionId(userId, attempt.attemptId), docType: "id", fileHash: attempt.documentHash,
  });
  if (!document) return kyc;
  const user = await User.findById(userId).select("name dateOfBirth role kycStatus isDisabled isArchived");
  const unchangedIdentity = user && identityProfileMatchesSnapshot(attempt.profileSnapshot, {
    full_name: user.name, date_of_birth: user.dateOfBirth,
  }, { requireBirthDate: user.role !== "owner" || Boolean(attempt.profileSnapshot.date_of_birth) });
  const rejected = ["rejected", "reupload_required"].includes(document.status) || !unchangedIdentity;
  const approved = !rejected && document.status === "verified" && document.detailsMatched === true
    && !document.suspectedTampering && (!document.expiresAt || new Date(document.expiresAt) > new Date())
    && user.kycStatus === "approved" && !user.isDisabled && !user.isArchived;
  if (!rejected && !approved) return kyc;
  const now = new Date();
  return await KycVerification.findOneAndUpdate({
    _id: kyc._id, status: "approved", "faceReverification.attemptId": attempt.attemptId,
    "faceReverification.status": "selfie_matched", "faceReverification.expiresAt": { $gt: now },
  }, { $set: approved ? {
    "faceReverification.status": "approved", "faceReverification.completedAt": now, lastFaceReverifiedAt: now,
  } : { "faceReverification.status": "rejected" } }, { new: true, timestamps: false }) || kyc;
}
