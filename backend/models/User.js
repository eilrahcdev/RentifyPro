// User model for regular users and owners
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },
    role: {
      type: String,
      enum: ["user", "owner", "admin"],
      default: "user",
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    kycStatus: {
      type: String,
      enum: ["not_started", "id_uploaded", "challenge_passed", "approved", "rejected"],
      default: "not_started",
    },
    walletAddress: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
      index: true,
      set: (value) => {
        const normalized = String(value || "").trim().toLowerCase();
        return normalized || undefined;
      },
    },
    avatar: {
      type: String,
      trim: true,
      default: "",
    },
    notificationSettings: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      bookingUpdates: { type: Boolean, default: true },
      promotions: { type: Boolean, default: false },
    },

    // Shared profile fields
    phone: {
      type: String,
      trim: true,
      set: (value) => {
        const normalized = String(value || "").trim();
        return normalized || undefined;
      },
    },
    dateOfBirth: { type: String },
    gender: { type: String, enum: ["Male", "Female", "Prefer not to say", ""] },
    ownerType: { type: String, enum: ["individual", "business"] },
    businessName: { type: String },
    licenseNumber: { type: String },
    permitNumber: { type: String },
    address: { type: String },
    region: { type: String },
    province: { type: String },
    city: { type: String },
    barangay: { type: String },
    emergencyContactName: { type: String },
    emergencyContactPhone: { type: String },
    emergencyContactRelationship: { type: String },
  },
  { timestamps: true }
);

// Hash the password before saving
// Works with Mongoose 6 and 7+
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  // Skip if the password was already hashed earlier
  if (this.password.startsWith("$2a$") || this.password.startsWith("$2b$")) {
    return;
  }

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare the entered password with the saved hash
userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

export default mongoose.model("User", userSchema);
