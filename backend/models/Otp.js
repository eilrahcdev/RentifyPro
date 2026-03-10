<<<<<<< HEAD
// OTP records for email verification and owner signup
=======
<<<<<<< HEAD
=======
// OTP records for email verification and owner signup
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
import mongoose from "mongoose";

const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
<<<<<<< HEAD

    // Regular signup uses a plain OTP
    otp: { type: String },

    // Owner signup stores a hashed OTP
    otpHash: { type: String },

    // What this OTP is used for
    purpose: {
=======
<<<<<<< HEAD
    otp: {
>>>>>>> 8422a2f (fixed bugs and updates)
      type: String,
      default: "verification",
      enum: ["verification", "owner_register", "password_reset"],
    },
<<<<<<< HEAD

=======
=======

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

>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    expiresAt: {
      type: Date,
      required: true,
    },
<<<<<<< HEAD

    // Rate limit fields
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lastSentAt: { type: Date },

    // Save pending owner data until OTP is verified
    pendingPayload: { type: mongoose.Schema.Types.Mixed },
=======
<<<<<<< HEAD
>>>>>>> 8422a2f (fixed bugs and updates)
  },
  { timestamps: true }
);

// Remove expired records automatically
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index by email
otpSchema.index({ email: 1 });

// Index by email and purpose
otpSchema.index({ email: 1, purpose: 1 });

<<<<<<< HEAD
export default mongoose.model("Otp", otpSchema);
=======
export default Otp;
=======

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
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
