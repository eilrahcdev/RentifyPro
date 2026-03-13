// Pre-registration face verification status
import mongoose from "mongoose";

const preKycFaceSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ["user", "owner"],
      default: "user",
    },
    status: {
      type: String,
      enum: ["approved", "rejected"],
      default: "rejected",
    },
    confidence: { type: Number, default: 0 },
    reason: { type: String, default: "" },
    provider: { type: String, default: "face-service" },
    verifiedAt: { type: Date },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

preKycFaceSchema.index({ email: 1 }, { unique: true });
preKycFaceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("PreKycFace", preKycFaceSchema);
