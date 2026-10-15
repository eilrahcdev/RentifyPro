import RegistrationDraft from "../models/RegistrationDraft.js";
import PreKycDocument from "../models/PreKycDocument.js";
import KycVerification from "../models/KycVerification.js";
import { reconcileUserKyc } from "./kycReview.service.js";

export async function finalizeRegistrationAccount(user, draft) {
  const documents = draft.submissionDocuments || [];
  const id = documents.find(doc => doc.docType === "id");
  if (!id) throw Object.assign(new Error("Recover your registration before submitting again."), { status: 409 });
  await KycVerification.findOneAndUpdate({ user: user._id }, { $setOnInsert: {
    user: user._id, status: "challenge_passed", idDocumentHash: id.fileHash,
    registrationSessionId: draft.sessionId,
    registrationDocumentVersions: Object.fromEntries(documents.map(doc => [doc.docType, doc.documentRevision])),
    challengePassedAt: new Date(), remarks: "Pending Review: email and selfie verified; document approval is pending.",
  } }, { upsert: true, returnDocument: "after" });
  for (const document of documents) {
    const linked = await PreKycDocument.updateOne({ _id: document.reference, role: draft.role, sessionId: draft.sessionId,
      reviewVersion: document.documentRevision, fileHash: document.fileHash, status: { $in: ["pending_review", "verified"] },
      $or: [{ expiresAt: { $gt: new Date() } }, { registeredUser: user._id, expiresAt: { $exists: false } }] },
    { $set: { registeredUser: user._id, email: user.email }, $unset: { expiresAt: "" } });
    if (!linked.matchedCount) throw Object.assign(new Error("Your account was created with review pending, but a document changed. Sign in to check your verification status."), { status: 409 });
  }
  const kyc = await reconcileUserKyc(user._id);
  user.kycStatus = kyc?.status || "challenge_passed";
  await RegistrationDraft.updateOne({ _id: draft._id, sessionId: draft.sessionId }, {
    $set: { registeredUser: user._id, evidenceEmail: user.email }, $unset: { submissionUntil: "", emailOtp: "" },
  });
  return user;
}
