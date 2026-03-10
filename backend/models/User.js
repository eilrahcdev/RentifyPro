<<<<<<< HEAD
// User model for regular users and owners
=======
<<<<<<< HEAD
=======
// User model for regular users and owners
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
<<<<<<< HEAD
      required: [true, "Name is required"],
=======
<<<<<<< HEAD
      required: [true, "Please provide a name"],
=======
      required: [true, "Name is required"],
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      trim: true,
    },
    email: {
      type: String,
<<<<<<< HEAD
      required: [true, "Email is required"],
=======
<<<<<<< HEAD
      required: [true, "Please provide an email"],
>>>>>>> 8422a2f (fixed bugs and updates)
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
<<<<<<< HEAD
=======
      required: [true, "Please provide a password"],
      minlength: [6, "Password must be at least 6 characters"],
=======
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
>>>>>>> 8422a2f (fixed bugs and updates)
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },
    role: {
      type: String,
      enum: ["user", "owner", "admin"],
      default: "user",
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
<<<<<<< HEAD
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

    // Shared profile fields
    phone: { type: String },
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
=======
<<<<<<< HEAD
>>>>>>> 8422a2f (fixed bugs and updates)
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

<<<<<<< HEAD
export default mongoose.model("User", userSchema);
=======
const User = mongoose.model("User", userSchema);

export default User;
=======
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

    // Shared profile fields
    phone: { type: String },
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
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
