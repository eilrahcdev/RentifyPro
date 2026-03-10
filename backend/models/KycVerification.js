<<<<<<< HEAD
// KYC status for each user
=======
<<<<<<< HEAD
>>>>>>> 8422a2f (fixed bugs and updates)
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
<<<<<<< HEAD
=======

    lastError: { type: String },
    attempts: { type: Number, default: 0 },
=======
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
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  },
  { timestamps: true }
);

<<<<<<< HEAD
export default mongoose.model("KycVerification", kycVerificationSchema);
=======
<<<<<<< HEAD
export default mongoose.model("KycVerification", KycVerificationSchema);
=======
export default mongoose.model("KycVerification", kycVerificationSchema);
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
