// KYC status for each user
import mongoose from "mongoose";

const kycVerificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["not_started", "id_uploaded", "challenge_passed", "approved", "rejected"],
      default: "not_started",
    },
    faceMatchScore: { type: Number, default: 0 },
    idDocumentHash: { type: String, default: "" },
    summarySyncPending: { type: Boolean, default: false },
    remarks: { type: String, default: "" },
    idRegisteredAt: { type: Date },
    challengePassedAt: { type: Date },
    verifiedAt: { type: Date },
    lastFaceReverifiedAt: { type: Date },
    faceReverification: {
      type: new mongoose.Schema({
        attemptId: { type: String, required: true },
        status: { type: String, enum: ["id_uploaded", "selfie_matched", "approved", "rejected", "cancelled"], required: true },
        documentHash: { type: String, required: true },
        profileSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
        createdAt: { type: Date, required: true },
        expiresAt: { type: Date, required: true },
        faceMatchedAt: { type: Date },
        faceMatchScore: { type: Number },
        completedAt: { type: Date },
      }, { _id: false }),
      default: undefined,
    },
  },
  { timestamps: true, collection: "kyc_cases" }
);

export default mongoose.model("KycVerification", kycVerificationSchema);
