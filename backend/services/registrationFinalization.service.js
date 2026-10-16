import RegistrationDraft from "../models/RegistrationDraft.js";
import PreKycDocument from "../models/PreKycDocument.js";
import KycVerification from "../models/KycVerification.js";
import { reconcileUserKyc } from "./kycReview.service.js";
import mongoose from "mongoose";
import User from "../models/User.js";

export async function finalizeRegistrationAccount(user, draft, { session } = {}) {
  const options = session ? { session } : {};
  const documents = draft.submissionDocuments || [];
  const id = documents.find(doc => doc.docType === "id");
  if (!id) throw Object.assign(new Error("Recover your registration before submitting again."), { status: 409 });
  await KycVerification.findOneAndUpdate({ user: user._id }, { $setOnInsert: {
    user: user._id, status: "challenge_passed", idDocumentHash: id.fileHash,
    registrationSessionId: draft.sessionId,
    registrationDocumentVersions: Object.fromEntries(documents.map(doc => [doc.docType, doc.documentRevision])),
    challengePassedAt: new Date(), remarks: "Pending Review: email and selfie verified; document approval is pending.",
  } }, { upsert: true, returnDocument: "after", ...options });
  for (const document of documents) {
    const linked = await PreKycDocument.updateOne({ _id: document.reference, role: draft.role, sessionId: draft.sessionId,
      reviewVersion: document.documentRevision, fileHash: document.fileHash, status: { $in: ["pending_review", "verified"] },
      $or: [{ expiresAt: { $gt: new Date() } }, { registeredUser: user._id, expiresAt: { $exists: false } }] },
    { $set: { registeredUser: user._id, email: user.email }, $unset: { expiresAt: "", registrationExpiresAt: "", manualReviewRequestedAt: "" } }, options);
    if (!linked.matchedCount) throw Object.assign(new Error("Your account was created with review pending, but a document changed. Sign in to check your verification status."), { status: 409 });
  }
  const kyc = session ? null : await reconcileUserKyc(user._id);
  user.kycStatus = kyc?.status || "challenge_passed";
  await RegistrationDraft.updateOne({ _id: draft._id, sessionId: draft.sessionId, cancelledAt: null }, {
    $set: { registeredUser: user._id, evidenceEmail: user.email }, $unset: { submissionUntil: "", emailOtp: "" },
  }, options);
  return user;
}

export function supportsRegistrationTransactions(connection) {
  if (connection.readyState !== 1) return false;
  const topology = connection.getClient().topology?.description;
  return ["ReplicaSetWithPrimary", "ReplicaSetNoPrimary", "Sharded"].includes(topology?.type)
    || [...(topology?.servers?.values() || [])].some(server => ["RSPrimary", "RSSecondary", "Mongos"].includes(server.type));
}

export async function createRegistrationAccount(payload, draft, connection = mongoose.connection) {
  if (!supportsRegistrationTransactions(connection)) {
    const user = await User.create(payload);
    return finalizeRegistrationAccount(user, draft);
  }
  const session = await connection.startSession();
  let user;
  let committed = false;
  try {
    await session.withTransaction(async () => {
      const current = await RegistrationDraft.findOneAndUpdate({ _id: draft._id, cancelledAt: null, registeredUser: null,
        submissionUntil: { $gt: new Date() } }, { $set: { submissionUntil: new Date(Date.now() + 120000) } }, { session, returnDocument: "after" });
      if (!current) throw Object.assign(new Error("Your registration changed. Recover your progress before submitting."), { status: 409 });
      [user] = await User.create([payload], { session });
      await finalizeRegistrationAccount(user, current, { session });
    });
    committed = true;
  } catch (error) {
    // An unknown commit result must retain its recovery claim; retry must find the same account.
    if (!error.hasErrorLabel?.("UnknownTransactionCommitResult")) error.registrationRolledBack = true;
    throw error;
  } finally {
    await session.endSession();
  }
  if (committed) {
    const kyc = await reconcileUserKyc(user._id);
    user.kycStatus = kyc?.status || "challenge_passed";
  }
  return user;
}
