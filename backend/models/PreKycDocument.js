// Pre-registration document verification (ID / supporting docs)
import mongoose from "mongoose";

const preKycDocumentSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    sessionId: { type: String, required: true, index: true },
    role: {
      type: String,
      enum: ["user", "owner"],
      default: "user",
    },
    docType: {
      type: String,
      enum: ["id", "supporting"],
      required: true,
    },
    status: {
      type: String,
      enum: ["queued", "processing", "retry_wait", "verified", "pending_review", "reupload_required", "rejected"],
      default: "rejected",
      index: true,
    },
    country: { type: String, default: "" },
    docCategory: { type: String, default: "" },
    selectedDocCategory: { type: String, default: "" },
    detailsMatched: { type: Boolean, default: false },
    mismatchFields: { type: [String], default: [] },
    suspectedTampering: { type: Boolean, default: false },
    confidence: { type: Number, default: 0 },
    classificationConfidence: { type: Number, default: 0 },
    documentSurface: { type: String, default: "" },
    reason: { type: String, default: "" },
    reasonCode: { type: String, default: "" },
    decisionSource: { type: String, default: "" },
    validationChecks: {
      imageReadable: { type: Boolean, default: null },
      recognizedDocument: { type: Boolean, default: null },
      classificationConfident: { type: Boolean, default: null },
      allowedDocumentSurface: { type: Boolean, default: null },
      requiredFieldsPresent: { type: Boolean, default: null },
      supportedDocumentType: { type: Boolean, default: null },
      documentTypeMatches: { type: Boolean, default: null },
      officialMarkingsPresent: { type: Boolean, default: null },
      layoutConsistent: { type: Boolean, default: null },
      structuralFeaturesPresent: { type: Boolean, default: null },
      hasFace: { type: Boolean, default: null },
      machineReadableZonePresent: { type: Boolean, default: null },
      registrationDataCompared: { type: Boolean, default: null },
      nameMatches: { type: Boolean, default: null },
      birthDateMatches: { type: Boolean, default: null },
      permitNumberMatches: { type: Boolean, default: null },
      documentNotExpired: { type: Boolean, default: null },
      duplicateDetected: { type: Boolean, default: null },
      suspectedTampering: { type: Boolean, default: null },
    },
    extractedData: {
      documentType: { type: String, default: "" },
      documentNumberMasked: { type: String, default: "" },
      birthDateDetected: { type: Boolean, default: false },
      fieldsDetected: { type: [String], default: [] },
    },
    qualityIssues: { type: [String], default: [] },
    // Keyed fingerprint for duplicate checks. The original number is never persisted.
    documentNumberFingerprint: { type: String, default: "", select: false, index: true },
    provider: { type: String, default: "gemini" },
    processingAttempts: { type: Number, default: 0 },
    queuedAt: { type: Date, default: null },
    // Changes for every screening request, including a corrected profile with the same file.
    reviewVersion: { type: String, default: "" },
    nextAttemptAt: { type: Date, default: null, index: true },
    processingLockedAt: { type: Date, default: null },
    lastProcessedAt: { type: Date, default: null },
    processingError: { type: String, default: "" },
    // Minimum fields required to compare the document. Hidden from ordinary queries.
    profileSnapshot: { type: mongoose.Schema.Types.Mixed, default: {}, select: false },
    fileName: { type: String, default: "" },
    // Object key only. Do not retain host paths or a public URL for KYC evidence.
    fileKey: { type: String, default: "" },
    filePath: { type: String, default: "" }, // Legacy data only; new writes leave this blank.
    mimeType: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    fileHash: { type: String, default: "" },
    verifiedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

preKycDocumentSchema.index({ email: 1, docType: 1 }, { unique: true });
preKycDocumentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
preKycDocumentSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

export default mongoose.model("PreKycDocument", preKycDocumentSchema);
