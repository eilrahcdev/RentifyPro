import fs from "node:fs/promises";
import path from "node:path";
import RegistrationDraft from "../models/RegistrationDraft.js";
import PreKycDocument from "../models/PreKycDocument.js";
import PreKycFace from "../models/PreKycFace.js";
import User from "../models/User.js";
import { getKycUploadDir } from "../utils/storagePaths.js";

const failure = message => Object.assign(new Error(message), { status: 409, code: "REGISTRATION_BUSY" });
const idleEvidence = now => ({ $or: [{ evidenceUntil: null }, { evidenceUntil: { $lte: now } }] });

export async function cleanupCancelledRegistration(draft) {
  if (!draft?.cancelledAt || draft.registeredUser || draft.submissionDocuments
    || await User.exists({ registrationDraftId: draft._id })) return false;
  const scope = { sessionId: draft.sessionId, role: draft.role, registeredUser: null, email: { $in: draft.cleanupEmails || [] } };
  await PreKycDocument.updateMany(scope, { $set: { registrationCancelledAt: draft.cancelledAt } });
  const documents = await PreKycDocument.find(scope).select("fileKey").lean();
  const keys = [...new Set([...(draft.cleanupFileKeys || []), ...documents.map(doc => doc.fileKey)].filter(Boolean))];
  // Persist file references before removing metadata so a partial failure is retryable.
  await RegistrationDraft.updateOne({ _id: draft._id, cancelledAt: draft.cancelledAt }, { $set: { cleanupFileKeys: keys } });
  await PreKycDocument.deleteMany(scope);
  await PreKycFace.deleteMany({ sessionId: draft.sessionId, role: draft.role, email: scope.email });
  const remaining = [];
  for (const key of keys) {
    if (key !== path.basename(key) || /[\\/]/.test(key)) continue;
    try {
      if (await PreKycDocument.exists({ fileKey: key })) continue;
      await fs.unlink(path.join(getKycUploadDir(), key)).catch(error => { if (error.code !== "ENOENT") throw error; });
    } catch { remaining.push(key); }
  }
  await RegistrationDraft.updateOne({ _id: draft._id, cancelledAt: draft.cancelledAt }, {
    $set: { cleanupFileKeys: remaining, ...(remaining.length ? { expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000) } : { cleanupCompletedAt: new Date() }) },
    ...(!remaining.length ? { $unset: { cleanupEmails: "" } } : {}),
  });
  return remaining.length === 0;
}

export async function cancelOwnedRegistration(id, role) {
  const current = await RegistrationDraft.findOne({ _id: id, role }).select("+cleanupFileKeys");
  if (!current) return { success: true };
  if (current.registeredUser || await User.exists({ registrationDraftId: id })) {
    return { success: true, registrationComplete: true };
  }
  if (current.submissionDocuments || new Date(current.submissionUntil || 0) > new Date()) {
    throw failure("Account creation may already be in progress. Recover your registration before cancelling.");
  }
  const now = new Date();
  const cleanupEmails = [...new Set([current.evidenceEmail, current.verifiedEmail,
    current.fields?.[role === "owner" ? "businessEmail" : "email"]].filter(Boolean))];
  const draft = current.cancelledAt ? current : await RegistrationDraft.findOneAndUpdate({
    _id: id, role, cancelledAt: null, registeredUser: null, submissionDocuments: null,
    $and: [idleEvidence(now), { $or: [{ submissionUntil: null }, { submissionUntil: { $lte: now } }] }],
  }, { $set: { cancelledAt: now, cleanupEmails, fields: {}, verifiedEmail: "", evidenceEmail: "", emailOtp: null,
    expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000) }, $unset: { emailVerifiedAt: "" } }, { returnDocument: "after" });
  if (!draft) throw failure("Verification or account creation is in progress. Wait for it to finish, then retry cancelling.");
  const cleaned = await cleanupCancelledRegistration(draft);
  return { success: true, cancelled: true, cleanupPending: !cleaned };
}

export async function purgeAbandonedRegistrations() {
  const now = new Date();
  const drafts = await RegistrationDraft.find({ registeredUser: null, submissionDocuments: null, cleanupCompletedAt: null,
    $or: [{ cancelledAt: { $ne: null } }, { expiresAt: { $lte: now } }, { absoluteExpiresAt: { $lte: now } }] })
    .select("+cleanupFileKeys").limit(100).lean();
  for (const draft of drafts) {
    try { await cancelOwnedRegistration(draft._id, draft.role); }
    catch (error) { if (error.code !== "REGISTRATION_BUSY") throw error; }
  }
  // MongoDB TTL may remove a draft before this job sees it. The evidence retains its session binding.
  const orphans = await PreKycDocument.find({ registeredUser: null, registrationDraftId: { $type: "string" },
    $or: [{ registrationExpiresAt: { $lte: now } }, { expiresAt: { $lte: now } }] })
    .select("registrationDraftId role sessionId email").limit(200).lean();
  for (const doc of orphans) {
    if (await RegistrationDraft.exists({ _id: doc.registrationDraftId }) || await User.exists({ registrationDraftId: doc.registrationDraftId })) continue;
    const tombstone = await RegistrationDraft.findOneAndUpdate({ _id: doc.registrationDraftId }, { $setOnInsert: {
      role: doc.role, sessionId: doc.sessionId, fields: {}, cancelledAt: now, cleanupEmails: [doc.email],
      expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000), absoluteExpiresAt: now,
    } }, { upsert: true, returnDocument: "after" });
    await cleanupCancelledRegistration(tombstone);
  }
}
