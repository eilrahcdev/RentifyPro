// OTP records for email verification and owner signup
import mongoose from "mongoose";

const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    // Regular signup uses a plain OTP
    otp: { type: String },

    // Owner signup stores a hashed OTP
    otpHash: { type: String },

    // What this OTP is used for
    purpose: {
      type: String,
      default: "verification",
      enum: ["verification", "owner_register", "password_reset"],
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    // Rate limit fields
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lastSentAt: { type: Date },

    // Save pending owner data until OTP is verified
    pendingPayload: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

// Remove expired records automatically
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index by email
otpSchema.index({ email: 1 });

// Index by email and purpose
otpSchema.index({ email: 1, purpose: 1 });

export default mongoose.model("Otp", otpSchema);
