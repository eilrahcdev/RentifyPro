import crypto from "node:crypto";
import RegistrationDraft from "../models/RegistrationDraft.js";

export async function lockRegistrationEvidence(req, res, next) {
  if (!req.registrationDraft) return next();
  const now = new Date();
  const token = crypto.randomUUID();
  try {
    const draft = await RegistrationDraft.findOneAndUpdate({ _id: req.registrationDraft._id, revision: req.registrationDraft.revision,
      role: req.registrationDraft.role, sessionId: req.registrationDraft.sessionId, cancelledAt: null,
      registeredUser: null, submissionDocuments: null, expiresAt: { $gt: now }, absoluteExpiresAt: { $gt: now },
      $or: [{ evidenceUntil: null }, { evidenceUntil: { $lte: now } }] },
    { $set: { evidenceToken: token, evidenceUntil: new Date(now.getTime() + 5 * 60 * 1000) } }, { returnDocument: "after" });
    if (!draft) return res.status(409).json({ success: false, message: "Your registration changed or another verification is running. Recover your progress and retry." });
    const release = () => void RegistrationDraft.updateOne({ _id: draft._id, evidenceToken: token },
      { $unset: { evidenceToken: "", evidenceUntil: "" } }).catch(() => {});
    res.once("finish", release);
    next();
  } catch {
    return res.status(503).json({ success: false, message: "We couldn't secure your verification request. Please retry." });
  }
}
