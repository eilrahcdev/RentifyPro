import bcrypt from "bcryptjs";
import Otp from "../models/Otp.js";
import User from "../models/User.js";
import sendEmail from "../utils/sendEmail.js";
import { getMissingPreKycDocs, clearPreKycDocs } from "../utils/preKycDocs.js";
import { isPreKycFaceVerified, clearPreKycFace } from "../utils/preKycFace.js";

const OTP_TTL_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 45;
const ALLOWED_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
]);
const ALLOWED_OWNER_TYPES = new Set(["individual", "business"]);
const MAX_NAME_LENGTH = 50;
const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_LENGTH = 11;
const MAX_ADDRESS_LENGTH = 255;
const MAX_REGION_LENGTH = 50;
const MAX_BUSINESS_NAME = 120;
const MAX_PERMIT_NUMBER = 50;
const MAX_LICENSE_NUMBER = 50;

const normalizeEmail = (email = "") => email.toLowerCase().trim();
const normalizePhone = (phone = "") => String(phone || "").trim();

const buildDuplicateKeyMessage = (error) => {
  const duplicateField = Object.keys(error?.keyPattern || error?.keyValue || {})[0];
  if (duplicateField === "email") return "Email is already registered.";
  if (duplicateField === "phone") return "This phone number is already registered.";
  return "A unique field already exists.";
};

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000)); // 6-digit OTP

export const requestOwnerOtp = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      phone,
      address,
      region,
      province,
      city,
      barangay,
      businessName,
      businessEmail,
      password,
      ownerType,
      licenseNumber,
      permitNumber,
    } = req.body;

    const email = normalizeEmail(businessEmail);

    if (!email || !password || !firstName || !lastName || !phone) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    if (firstName.trim().length > MAX_NAME_LENGTH || lastName.trim().length > MAX_NAME_LENGTH) {
      return res.status(400).json({ message: `Name is too long (max ${MAX_NAME_LENGTH} characters).` });
    }
    if (email.length > MAX_EMAIL_LENGTH) {
      return res.status(400).json({ message: `Email is too long (max ${MAX_EMAIL_LENGTH} characters).` });
    }
    const normalizedPhone = normalizePhone(phone);

    if (normalizedPhone.length > MAX_PHONE_LENGTH) {
      return res.status(400).json({ message: `Phone number is too long (max ${MAX_PHONE_LENGTH} digits).` });
    }
    if (!/^[0-9]{11}$/.test(normalizedPhone)) {
      return res.status(400).json({ message: "Phone number must be exactly 11 digits." });
    }
    if (address && address.length > MAX_ADDRESS_LENGTH) {
      return res.status(400).json({ message: `Address is too long (max ${MAX_ADDRESS_LENGTH} characters).` });
    }
    if ((region && region.length > MAX_REGION_LENGTH) || (province && province.length > MAX_REGION_LENGTH) || (city && city.length > MAX_REGION_LENGTH) || (barangay && barangay.length > MAX_REGION_LENGTH)) {
      return res.status(400).json({ message: `Address selection is too long (max ${MAX_REGION_LENGTH} characters).` });
    }
    if (businessName && businessName.length > MAX_BUSINESS_NAME) {
      return res.status(400).json({ message: `Business name is too long (max ${MAX_BUSINESS_NAME} characters).` });
    }
    if (permitNumber && permitNumber.length > MAX_PERMIT_NUMBER) {
      return res.status(400).json({ message: `Permit number is too long (max ${MAX_PERMIT_NUMBER} characters).` });
    }
    if (licenseNumber && licenseNumber.length > MAX_LICENSE_NUMBER) {
      return res.status(400).json({ message: `License number is too long (max ${MAX_LICENSE_NUMBER} characters).` });
    }
    if (!ownerType || !ALLOWED_OWNER_TYPES.has(ownerType)) {
      return res.status(400).json({ message: "Owner type is invalid." });
    }
    if (ownerType === "business") {
      if (!businessName) {
        return res.status(400).json({ message: "Business name is required." });
      }
      if (!permitNumber) {
        return res.status(400).json({ message: "Permit number is required." });
      }
    }

    // Stop if the email is already used
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "Email is already registered." });
    }
    const existingPhone = await User.findOne({ phone: normalizedPhone }).select("_id");
    if (existingPhone) {
      return res.status(409).json({ message: "This phone number is already registered." });
    }

    // Basic validation
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ message: "Invalid email format." });
    }
    const emailDomain = email.split("@")[1]?.toLowerCase() || "";
    if (!ALLOWED_EMAIL_DOMAINS.has(emailDomain)) {
      return res.status(400).json({
        message: "Please use a valid email address from a supported provider.",
      });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters." });
    }

    const missingDocs = await getMissingPreKycDocs(email, ["id", "supporting"]);
    if (missingDocs.length) {
      const needsId = missingDocs.includes("id");
      const needsSupporting = missingDocs.includes("supporting");
      let message = "Please verify your ID before registering.";
      if (needsId && needsSupporting) {
        message = "Please verify your ID and supporting document before registering.";
      } else if (needsSupporting) {
        message = "Please verify your supporting document before registering.";
      }
      return res.status(400).json({ message });
    }

    const faceVerified = await isPreKycFaceVerified(email);
    if (!faceVerified) {
      return res.status(400).json({
        message: "Please verify your selfie matches your ID before registering.",
      });
    }

    // Limit resend requests
    const existingOtp = await Otp.findOne({ email, purpose: "owner_register" });
    if (existingOtp?.lastSentAt) {
      const secondsSince = (Date.now() - new Date(existingOtp.lastSentAt).getTime()) / 1000;
      if (secondsSince < RESEND_COOLDOWN_SECONDS) {
        return res.status(429).json({
          message: `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSince)}s before requesting another OTP.`,
        });
      }
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);

    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    // Save the pending owner data here for OTP verification
    const pendingPayload = {
      firstName,
      lastName,
      phone: normalizedPhone,
      address,
      region,
      province,
      city,
      barangay,
      businessName: ownerType === "business" ? businessName : "",
      ownerType,
      licenseNumber,
      permitNumber: ownerType === "business" ? permitNumber : "",
      // Save the hashed password in the OTP record
      passwordHash: await bcrypt.hash(password, 10),
      role: "owner",
    };

    // Keep one OTP record per email and purpose
    await Otp.findOneAndUpdate(
      { email, purpose: "owner_register" },
      {
        $set: {
          otpHash,
          expiresAt,
          pendingPayload,
          attempts: 0,
          lastSentAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    await sendEmail(email, otp);

    return res.status(200).json({
      message: "OTP sent to email.",
      email,
      expiresInMinutes: OTP_TTL_MINUTES,
    });
  } catch (err) {
    console.error("requestOwnerOtp error:", err);
    return res.status(500).json({ message: "Failed to send OTP." });
  }
};

export const resendOwnerOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!email) return res.status(400).json({ message: "Email is required." });

    const otpDoc = await Otp.findOne({ email, purpose: "owner_register" });
    if (!otpDoc) {
      return res.status(404).json({ message: "No pending registration found. Please register again." });
    }

    const secondsSince = (Date.now() - new Date(otpDoc.lastSentAt).getTime()) / 1000;
    if (secondsSince < RESEND_COOLDOWN_SECONDS) {
      return res.status(429).json({
        message: `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSince)}s before resending OTP.`,
      });
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    otpDoc.otpHash = otpHash;
    otpDoc.expiresAt = expiresAt;
    otpDoc.attempts = 0;
    otpDoc.lastSentAt = new Date();
    await otpDoc.save();

    await sendEmail(email, otp);

    return res.status(200).json({
      message: "OTP resent.",
      email,
      expiresInMinutes: OTP_TTL_MINUTES,
    });
  } catch (err) {
    console.error("resendOwnerOtp error:", err);
    return res.status(500).json({ message: "Failed to resend OTP." });
  }
};

export const verifyOwnerOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required." });
    }

    const otpDoc = await Otp.findOne({ email, purpose: "owner_register" });
    if (!otpDoc) {
      return res.status(404).json({ message: "OTP not found or expired. Please request again." });
    }

    if (new Date() > new Date(otpDoc.expiresAt)) {
      await Otp.deleteOne({ _id: otpDoc._id });
      return res.status(410).json({ message: "OTP expired. Please request a new one." });
    }

    if (otpDoc.attempts >= otpDoc.maxAttempts) {
      await Otp.deleteOne({ _id: otpDoc._id });
      return res.status(429).json({ message: "Too many attempts. Please request a new OTP." });
    }

    const ok = await bcrypt.compare(otp, otpDoc.otpHash);
    if (!ok) {
      otpDoc.attempts += 1;
      await otpDoc.save();
      return res.status(401).json({ message: "Invalid OTP." });
    }

    // Create the owner account
    const payload = otpDoc.pendingPayload;
    if (!payload) {
      await Otp.deleteOne({ _id: otpDoc._id });
      return res.status(400).json({ message: "Registration payload missing. Please register again." });
    }

    // Check again in case the account was created already
    const existing = await User.findOne({ email });
    if (existing) {
      await Otp.deleteOne({ _id: otpDoc._id });
      return res.status(409).json({ message: "Email is already registered." });
    }

    const normalizedPhone = normalizePhone(payload.phone);
    if (normalizedPhone) {
      const existingPhone = await User.findOne({ phone: normalizedPhone }).select("_id");
      if (existingPhone) {
        await Otp.deleteOne({ _id: otpDoc._id });
        return res.status(409).json({ message: "This phone number is already registered." });
      }
    }

    const owner = await User.create({
      email,
      password: payload.passwordHash, // Already hashed
      role: "owner",
      firstName: payload.firstName,
      lastName: payload.lastName,
      phone: normalizedPhone || undefined,

      // Optional owner fields
      ownerType: payload.ownerType,
      businessName: payload.businessName,
      licenseNumber: payload.licenseNumber,
      permitNumber: payload.permitNumber,
      address: payload.address,
      region: payload.region,
      province: payload.province,
      city: payload.city,
      barangay: payload.barangay,
      isEmailVerified: true,
    });

    // Clean up the OTP record
    await Otp.deleteOne({ _id: otpDoc._id });
    await clearPreKycDocs(email);
    await clearPreKycFace(email);

    return res.status(201).json({
      message: "Owner registration verified and account created.",
      owner: {
        id: owner._id,
        email: owner.email,
        role: owner.role,
        name: `${owner.firstName || ""} ${owner.lastName || ""}`.trim(),
      },
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: buildDuplicateKeyMessage(err) });
    }
    console.error("verifyOwnerOtp error:", err);
    return res.status(500).json({ message: "Failed to verify OTP." });
  }
};
