import mongoose from "mongoose";

const schema = new mongoose.Schema({
  // A SHA-256 digest of a random HttpOnly cookie, never an email-based lookup.
  _id: { type: String },
  role: { type: String, enum: ["user", "owner"], required: true },
  sessionId: { type: String, required: true },
  sessionOriginIat: { type: Number },
  evidenceEmail: { type: String },
  verifiedEmail: { type: String, default: "" },
  emailVerifiedAt: { type: Date },
  emailOtp: { type: new mongoose.Schema({ email: String, hash: String, expiresAt: Date, attempts: Number }, { _id: false }), default: null },
  otpLastSentAt: { type: Date },
  otpAttemptsTotal: { type: Number, default: 0 },
  submissionUntil: { type: Date },
  evidenceUntil: { type: Date },
  evidenceToken: { type: String, select: false },
  evidenceAttemptId: { type: String, select: false },
  cancelledAt: { type: Date },
  cleanupFileKeys: { type: [String], default: undefined, select: false },
  cleanupEmails: { type: [String], default: undefined },
  cleanupCompletedAt: { type: Date },
  submissionDocuments: { type: mongoose.Schema.Types.Mixed },
  registeredUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  fields: { type: mongoose.Schema.Types.Mixed, default: {} },
  step: { type: Number, default: 1 },
  verificationPhase: { type: String, enum: ["email", "documents", "face"], default: "email" },
  revision: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
  absoluteExpiresAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ sessionId: 1 });

export default mongoose.model("RegistrationDraft", schema);
