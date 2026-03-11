// Auth controller
import User from "../models/User.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Otp from "../models/Otp.js";
import sendEmail from "../utils/sendEmail.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import { isValidWalletAddress, normalizeAddress } from "../utils/blockchainBooking.js";

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const PASSWORD_RESET_TOKEN_EXPIRE = process.env.PASSWORD_RESET_TOKEN_EXPIRE || "15m";
const PASSWORD_RESET_TOKEN_SECRET = process.env.PASSWORD_RESET_TOKEN_SECRET || process.env.JWT_SECRET;
const tokenBlacklist = new Set();
const MIN_RENTER_AGE = 18;
const PHONE_REGEX = /^[0-9]{11}$/;

export const isTokenBlacklisted = (token) => tokenBlacklist.has(token);

function signToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || "7d" }
  );
}

const authCookieOptions = () => {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
};

const setAuthCookie = (res, token) => {
  if (!token) return;
  res.cookie("token", token, authCookieOptions());
};

const clearAuthCookie = (res) => {
  res.clearCookie("token", {
    ...authCookieOptions(),
    maxAge: 0,
  });
};

const toText = (value) => (typeof value === "string" ? value.trim() : "");
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const createOtpCode = () => Math.floor(100000 + Math.random() * 900000).toString();
const parseDateOfBirth = (value) => {
  const clean = toText(value);
  if (!clean) return null;

  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day);
    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    ) {
      parsed.setHours(0, 0, 0, 0);
      return parsed;
    }
    return null;
  }

  const parsed = new Date(clean);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const getAgeFromDate = (birthDate, today) => {
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  const dayDiff = today.getDate() - birthDate.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return age;
};

const buildSafeUserResponse = (user) => {
  if (!user) return undefined;

  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar || "",
    role: user.role,
    isVerified: user.isVerified || false,
    kycStatus: user.kycStatus,
    walletAddress: user.walletAddress || null,
    phone: user.phone || "",
    dateOfBirth: user.dateOfBirth || "",
    gender: user.gender || "",
    ownerType: user.ownerType || "",
    businessName: user.businessName || "",
    licenseNumber: user.licenseNumber || "",
    permitNumber: user.permitNumber || "",
    address: user.address || "",
    region: user.region || "",
    province: user.province || "",
    city: user.city || "",
    barangay: user.barangay || "",
    emergencyContactName: user.emergencyContactName || "",
    emergencyContactPhone: user.emergencyContactPhone || "",
    emergencyContactRelationship: user.emergencyContactRelationship || "",
  };
};

const validatePasswordStrength = (password) => {
  if (!password) return "Password is required.";
  if (typeof password !== "string") return "Password is invalid.";
  if (/\s/.test(password)) return "Password must not contain spaces.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 128) return "Password is too long (max 128 characters).";
  if (!/[A-Z]/.test(password)) return "Password needs an uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password needs a lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password needs a number.";
  if (!/[!@#$%^&*()_+\-=[\]{}|;':\",.<>?/`~]/.test(password)) {
    return "Password needs a special character.";
  }
  return "";
};

const buildDuplicateKeyMessage = (error) => {
  const duplicateField = Object.keys(error?.keyPattern || error?.keyValue || {})[0];

  if (duplicateField === "email") {
    return "This email is already registered.";
  }

  if (duplicateField === "walletAddress") {
    return "This wallet address is already linked to another account.";
  }

  return "A unique field already exists.";
};

const createOtpRecord = async ({ email, otp, purpose }) => {
  await Otp.deleteMany({ email, purpose });
  await Otp.create({
    email,
    otp,
    purpose,
    expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
    lastSentAt: new Date(),
  });
};

const findOtpRecord = async ({ email, otp, purpose }) =>
  Otp.findOne({
    email,
    otp: String(otp || "").trim(),
    purpose,
  });

export const registerUser = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      walletAddress,
      phone,
      dateOfBirth,
      gender,
      ownerType,
      businessName,
      licenseNumber,
      permitNumber,
      address,
      region,
      province,
      city,
      barangay,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelationship,
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide name, email, and password.",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      auditLog.warn("AUTH", `Register with existing email: ${normalizedEmail}`, { ip: req.ip });
      return res.status(400).json({
        success: false,
        message: "This email is already registered.",
      });
    }

    const passwordMessage = validatePasswordStrength(password);
    if (passwordMessage) {
      return res.status(400).json({ success: false, message: passwordMessage });
    }

    let normalizedWalletAddress;
    const walletAddressText = toText(walletAddress);
    if (walletAddressText) {
      if (!isValidWalletAddress(walletAddressText)) {
        return res.status(400).json({
          success: false,
          message: "Wallet address is invalid.",
        });
      }
      normalizedWalletAddress = normalizeAddress(walletAddressText);
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);
    const requestedRole = role === "owner" ? "owner" : "user";

    const user = await User.create({
      name: toText(name),
      email: normalizedEmail,
      password: hashedPassword,
      role: requestedRole,
      walletAddress: normalizedWalletAddress,
      phone: toText(phone) || undefined,
      dateOfBirth: toText(dateOfBirth) || undefined,
      gender: toText(gender) || undefined,
      ownerType: toText(ownerType) || undefined,
      businessName: toText(businessName) || undefined,
      licenseNumber: toText(licenseNumber) || undefined,
      permitNumber: toText(permitNumber) || undefined,
      address: toText(address) || undefined,
      region: toText(region) || undefined,
      province: toText(province) || undefined,
      city: toText(city) || undefined,
      barangay: toText(barangay) || undefined,
      emergencyContactName: toText(emergencyContactName) || undefined,
      emergencyContactPhone: toText(emergencyContactPhone) || undefined,
      emergencyContactRelationship: toText(emergencyContactRelationship) || undefined,
    });

    clearAuthCookie(res);

    auditLog.info("AUTH", `Registered: ${normalizedEmail}`, { userId: user._id.toString() });

    res.status(201).json({
      success: true,
      message: "Registration successful. Please verify your email to continue.",
      user: buildSafeUserResponse(user),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: buildDuplicateKeyMessage(error),
      });
    }

    if (error?.name === "ValidationError") {
      const messages = Object.values(error.errors).map((entry) => entry.message);
      return res.status(400).json({ success: false, message: messages.join(", ") });
    }

    auditLog.error("AUTH", "Register error", { detail: error.message });
    res.status(500).json({
      success: false,
      message: "Registration failed. Please try again.",
    });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password.",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const user = await User.findOne({ email: normalizedEmail }).select("+password");

    if (!user) {
      auditLog.security("AUTH", "Login failed: unknown email", { email: normalizedEmail, ip: req.ip });
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    let isMatch = false;
    if (typeof user.matchPassword === "function") {
      isMatch = await user.matchPassword(password);
    } else {
      isMatch = await bcrypt.compare(password, user.password);
    }

    if (!isMatch) {
      auditLog.security("AUTH", "Login failed: wrong password", { email: normalizedEmail, ip: req.ip });
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (!user.isVerified) {
      clearAuthCookie(res);
      return res.status(403).json({
        success: false,
        message: "Please verify your email before logging in.",
      });
    }

    const token = signToken(user);
    setAuthCookie(res, token);

    auditLog.info("AUTH", `Logged in: ${normalizedEmail}`, { userId: user._id.toString() });

    res.json({
      success: true,
      message: "Login successful.",
      token,
      user: buildSafeUserResponse(user),
    });
  } catch (error) {
    auditLog.error("AUTH", "Login error", { detail: error.message });
    res.status(500).json({
      success: false,
      message: "Login failed. Please try again.",
    });
  }
};

export const logoutUser = async (req, res) => {
  try {
    const headerToken = req.headers.authorization?.split(" ")[1];
    const cookieToken = String(req.cookies?.token || "").trim();
    const token = headerToken || cookieToken;
    if (token) {
      tokenBlacklist.add(String(token));
      auditLog.info("AUTH", "Logged out", { userId: req.user?._id?.toString() });
    }
    clearAuthCookie(res);
    res.json({ success: true, message: "Logged out." });
  } catch {
    res.status(500).json({ success: false, message: "Logout failed." });
  }
};

export const sendOTP = async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);

    if (!normalizedEmail) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      auditLog.warn("AUTH", `Verification OTP requested for unknown email: ${normalizedEmail}`, { ip: req.ip });
      return res.json({
        success: true,
        message: "If this email is registered, an OTP has been sent.",
      });
    }

    const otp = createOtpCode();
    await createOtpRecord({ email: normalizedEmail, otp, purpose: "verification" });
    await sendEmail(normalizedEmail, otp);

    auditLog.info("AUTH", `Verification OTP sent to: ${normalizedEmail}`);

    res.json({
      success: true,
      message: "If this email is registered, an OTP has been sent.",
    });
  } catch (error) {
    auditLog.error("AUTH", "Send OTP error", { detail: error.message });
    res.status(500).json({
      success: false,
      message: "Failed to send OTP. Try again.",
    });
  }
};

export const verifyOTP = async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();

    if (!normalizedEmail || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required.",
      });
    }

    const record = await findOtpRecord({
      email: normalizedEmail,
      otp,
      purpose: "verification",
    });

    if (!record) {
      auditLog.warn("AUTH", `Invalid verification OTP attempt for: ${normalizedEmail}`, { ip: req.ip });
      return res.status(400).json({
        success: false,
        message: "Invalid or expired code.",
      });
    }

    if (record.expiresAt < Date.now()) {
      await Otp.deleteMany({ email: normalizedEmail, purpose: "verification" });
      return res.status(400).json({
        success: false,
        message: "Code has expired. Please request a new one.",
      });
    }

    const user = await User.findOneAndUpdate(
      { email: normalizedEmail },
      { isVerified: true },
      { new: true }
    );

    if (!user) {
      await Otp.deleteMany({ email: normalizedEmail, purpose: "verification" });
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    await Otp.deleteMany({ email: normalizedEmail, purpose: "verification" });

    auditLog.info("AUTH", `OTP verified for: ${normalizedEmail}`);

    const token = signToken(user);
    setAuthCookie(res, token);

    res.json({
      success: true,
      message: "Verified successfully.",
      token,
      user: buildSafeUserResponse(user),
    });
  } catch (error) {
    auditLog.error("AUTH", "Verify OTP error", { detail: error.message });
    res.status(500).json({
      success: false,
      message: "Verification failed. Try again.",
    });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);

    if (!normalizedEmail) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      auditLog.warn("AUTH", `Password reset requested for unknown email: ${normalizedEmail}`, { ip: req.ip });
      return res.json({
        success: true,
        message: "If this email is registered, a password reset code has been sent.",
      });
    }

    const otp = createOtpCode();
    await createOtpRecord({ email: normalizedEmail, otp, purpose: "password_reset" });
    await sendEmail(normalizedEmail, otp);

    auditLog.info("AUTH", `Password reset OTP sent to: ${normalizedEmail}`);

    res.json({
      success: true,
      message: "If this email is registered, a password reset code has been sent.",
    });
  } catch (error) {
    auditLog.error("AUTH", "Forgot password error", { detail: error.message });
    res.status(500).json({
      success: false,
      message: "Failed to send password reset code. Try again.",
    });
  }
};

export const verifyPasswordResetOTP = async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();

    if (!normalizedEmail || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required.",
      });
    }

    const record = await findOtpRecord({
      email: normalizedEmail,
      otp,
      purpose: "password_reset",
    });

    if (!record) {
      auditLog.warn("AUTH", `Invalid password reset OTP attempt for: ${normalizedEmail}`, { ip: req.ip });
      return res.status(400).json({
        success: false,
        message: "Invalid or expired code.",
      });
    }

    if (record.expiresAt < Date.now()) {
      await Otp.deleteMany({ email: normalizedEmail, purpose: "password_reset" });
      return res.status(400).json({
        success: false,
        message: "Code has expired. Please request a new one.",
      });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      await Otp.deleteMany({ email: normalizedEmail, purpose: "password_reset" });
      return res.status(400).json({
        success: false,
        message: "Invalid or expired code.",
      });
    }

    await Otp.deleteMany({ email: normalizedEmail, purpose: "password_reset" });

    const resetToken = jwt.sign(
      { email: normalizedEmail, purpose: "password_reset" },
      PASSWORD_RESET_TOKEN_SECRET,
      { expiresIn: PASSWORD_RESET_TOKEN_EXPIRE }
    );

    res.json({
      success: true,
      message: "Password reset code verified.",
      resetToken,
    });
  } catch (error) {
    auditLog.error("AUTH", "Verify password reset OTP error", { detail: error.message });
    res.status(500).json({
      success: false,
      message: "Verification failed. Try again.",
    });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    const token = String(req.body.token || "").trim();
    const newPassword = String(req.body.newPassword || "");

    if (!normalizedEmail || !token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email, reset token, and new password are required.",
      });
    }

    const passwordMessage = validatePasswordStrength(newPassword);
    if (passwordMessage) {
      return res.status(400).json({ success: false, message: passwordMessage });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, PASSWORD_RESET_TOKEN_SECRET);
    } catch {
      return res.status(400).json({
        success: false,
        message: "Reset session is invalid or expired.",
      });
    }

    if (decoded?.purpose !== "password_reset" || normalizeEmail(decoded?.email) !== normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: "Reset session is invalid or expired.",
      });
    }

    const user = await User.findOne({ email: normalizedEmail }).select("+password");
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Reset session is invalid or expired.",
      });
    }

    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();
    await Otp.deleteMany({ email: normalizedEmail, purpose: "password_reset" });

    clearAuthCookie(res);
    auditLog.info("AUTH", `Password reset completed: ${normalizedEmail}`, { userId: user._id.toString() });

    res.json({
      success: true,
      message: "Password reset successful. Please log in again.",
    });
  } catch (error) {
    auditLog.error("AUTH", "Reset password error", { detail: error.message });
    res.status(500).json({
      success: false,
      message: "Failed to reset password. Try again.",
    });
  }
};

export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    res.json({ success: true, user: buildSafeUserResponse(user) });
  } catch {
    res.status(500).json({ success: false, message: "Could not fetch profile." });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("+password");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const firstName = toText(req.body.firstName);
    const lastName = toText(req.body.lastName);
    const explicitName = toText(req.body.name);
    const computedName = toText(`${firstName} ${lastName}`);

    const nextName = explicitName || computedName;
    if (nextName) {
      user.name = nextName;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "dateOfBirth")) {
      const dateOfBirth = toText(req.body.dateOfBirth);
      if (user.role === "user" && !dateOfBirth) {
        return res.status(400).json({
          success: false,
          message: "Date of birth is required for renter profiles.",
        });
      }

      if (dateOfBirth) {
        const parsedDate = parseDateOfBirth(dateOfBirth);
        if (!parsedDate) {
          return res.status(400).json({
            success: false,
            message: "Date of birth is invalid.",
          });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (parsedDate > today) {
          return res.status(400).json({
            success: false,
            message: "Date of birth cannot be in the future.",
          });
        }

        if (user.role === "user") {
          const age = getAgeFromDate(parsedDate, today);
          if (age < MIN_RENTER_AGE) {
            return res.status(400).json({
              success: false,
              message: "Looks like you're under 18. RentifyPro accounts are for ages 18+.",
            });
          }
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "phone")) {
      const phone = toText(req.body.phone);
      if (phone && !PHONE_REGEX.test(phone)) {
        return res.status(400).json({
          success: false,
          message: "Phone number must be exactly 11 digits.",
        });
      }
    }

    const profileFields = [
      "avatar",
      "phone",
      "dateOfBirth",
      "gender",
      "ownerType",
      "businessName",
      "licenseNumber",
      "permitNumber",
      "address",
      "region",
      "province",
      "city",
      "barangay",
      "emergencyContactName",
      "emergencyContactPhone",
      "emergencyContactRelationship",
    ];

    profileFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        user[field] = toText(req.body[field]) || undefined;
      }
    });

    if (Object.prototype.hasOwnProperty.call(req.body, "walletAddress")) {
      const walletAddress = toText(req.body.walletAddress);
      if (!walletAddress) {
        user.set("walletAddress", undefined);
      } else if (!isValidWalletAddress(walletAddress)) {
        return res.status(400).json({
          success: false,
          message: "Wallet address is invalid.",
        });
      } else {
        user.walletAddress = normalizeAddress(walletAddress);
      }
    }

    await user.save();

    const safeUser = await User.findById(user._id).select("-password");
    return res.json({
      success: true,
      message: "Profile updated successfully.",
      user: buildSafeUserResponse(safeUser),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: buildDuplicateKeyMessage(error),
      });
    }

    return res.status(500).json({
      success: false,
      message: "Could not update profile.",
    });
  }
};
