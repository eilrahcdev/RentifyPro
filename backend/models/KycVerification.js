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
    remarks: { type: String, default: "" },
    idRegisteredAt: { type: Date },
    challengePassedAt: { type: Date },
    verifiedAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model("KycVerification", kycVerificationSchema);
