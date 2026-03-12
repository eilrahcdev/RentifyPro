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
      enum: ["verified", "rejected"],
      default: "rejected",
    },
    country: { type: String, default: "" },
    docCategory: { type: String, default: "" },
    confidence: { type: Number, default: 0 },
    reason: { type: String, default: "" },
    provider: { type: String, default: "gemini" },
    fileName: { type: String, default: "" },
    filePath: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    fileHash: { type: String, default: "" },
    verifiedAt: { type: Date },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

preKycDocumentSchema.index({ email: 1, docType: 1 }, { unique: true });
preKycDocumentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("PreKycDocument", preKycDocumentSchema);
