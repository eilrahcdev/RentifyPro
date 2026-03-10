import mongoose from "mongoose";

const KycVerificationSchema = new mongoose.Schema(
  {
    // use email (or any unique string) during pre-registration
    userKey: { type: String, required: true, unique: true, index: true },

    email: { type: String, required: true, index: true },
    role: { type: String, enum: ["renter", "owner"], default: "renter" },

    status: {
      type: String,
      enum: ["PENDING", "ID_REGISTERED", "CHALLENGE_PASSED", "VERIFIED", "REJECTED"],
      default: "PENDING",
    },

    challengeId: { type: String },
    lastDistance: { type: Number },
    lastConfidence: { type: Number },

    idRegisteredAt: { type: Date },
    challengePassedAt: { type: Date },
    verifiedAt: { type: Date },

    lastError: { type: String },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("KycVerification", KycVerificationSchema);
