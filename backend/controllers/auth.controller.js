// Auth controller
import User from "../models/User.js";
import KycVerification from "../models/KycVerification.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import Otp from "../models/Otp.js";
import LoginChallenge from "../models/LoginChallenge.js";
import LoginActivity from "../models/LoginActivity.js";
import sendEmail from "../utils/sendEmail.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import {
  getMissingPreKycDocs,
  getPendingPreKycDocs,
  getActionRequiredPreKycDocs,
  clearPreKycDocs,
  preKycIdentityMatchesRegistration,
  preKycSupportingMatchesRegistration,
} from "../utils/preKycDocs.js";
import { isPreKycFaceVerified, clearPreKycFace } from "../utils/preKycFace.js";
import { isValidPhilippineMobile, normalizePhilippineMobile } from "../utils/phone.js";
import { verifyPreKycSession } from "../utils/preKycSession.js";
import { releaseExpiredModerationSuspension } from "../utils/accountModeration.js";
import { hashAuthToken, revokeSessionToken } from "../utils/authTokenRevocation.js";
import { disconnectSessionSockets } from "../socket/index.js";
import { getAvatarUploadDir } from "../utils/storagePaths.js";

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 45);
const PASSWORD_RESET_TOKEN_EXPIRE = process.env.PASSWORD_RESET_TOKEN_EXPIRE || "15m";
const PASSWORD_RESET_TOKEN_SECRET = process.env.PASSWORD_RESET_TOKEN_SECRET || process.env.JWT_SECRET;
const MIN_RENTER_AGE = 18;
const MAX_RENTER_AGE = 100;
const EMERGENCY_CONTACT_NAME_REGEX = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const MAX_EMERGENCY_CONTACT_NAME_LENGTH = 50;
const LOGIN_CHALLENGE_TTL_MINUTES = Number(process.env.LOGIN_CHALLENGE_TTL_MINUTES || 180);
const LOGIN_CHALLENGE_MAX_ATTEMPTS = Number(process.env.LOGIN_CHALLENGE_MAX_ATTEMPTS || 5);
const CLEAR_PREKYC_ON_REGISTER =
  String(process.env.PREKYC_CLEAR_ON_REGISTER || "").trim().toLowerCase() === "true";
const AVATAR_UPLOAD_DIR = getAvatarUploadDir();
const AVATAR_MAX_BYTES = Number(process.env.AVATAR_MAX_BYTES || 2 * 1024 * 1024);
const AVATAR_MEDIA_PREFIX = "uploads/avatars/";

function signToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role, sessionVersion: Number(user.sessionVersion || 0) },
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
const toBool = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
};
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

  return null;
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
    isDisabled: Boolean(user.isDisabled),
    isArchived: Boolean(user.isArchived),
    kycStatus: user.kycStatus,
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

const sendFieldError = (res, status, field, message, details = {}) =>
  res.status(status).json({
    success: false,
    message,
    errors: { [field]: message },
    ...details,
  });

const getDuplicateKeyDetails = (error) => {
  const duplicateField = Object.keys(error?.keyPattern || error?.keyValue || {})[0];

  if (duplicateField === "email") {
    return { field: "email", message: "This email is already registered." };
  }

  if (duplicateField === "phone") {
    return { field: "phone", message: "This phone number is already registered." };
  }

  return { field: "account", message: "A unique field already exists." };
};

const buildDuplicateKeyMessage = (error) => getDuplicateKeyDetails(error).message;

const getPublicBaseUrl = (req) => {
  const configured = String(process.env.BACKEND_PUBLIC_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (!req) return "";
  return `${req.protocol}://${req.get("host")}`;
};

const normalizeAvatarKey = (value = "") => {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) {
    const uploadsIndex = raw.toLowerCase().lastIndexOf(`/${AVATAR_MEDIA_PREFIX}`);
    if (uploadsIndex >= 0) return raw.slice(uploadsIndex + 1);
    return "";
  }
  const prefixIndex = raw.toLowerCase().lastIndexOf(AVATAR_MEDIA_PREFIX);
  const key = prefixIndex >= 0 ? raw.slice(prefixIndex) : raw;
  if (!key.toLowerCase().startsWith(AVATAR_MEDIA_PREFIX)) return "";
  const fileName = key.slice(AVATAR_MEDIA_PREFIX.length);
  if (!fileName || fileName !== path.basename(fileName) || !/^avatar-[a-z0-9-]+\.(jpg|jpeg|png|webp)$/i.test(fileName)) return "";
  return `${AVATAR_MEDIA_PREFIX}${fileName}`;
};

const removeLocalAvatarIfExists = async (avatarValue = "") => {
  const normalized = normalizeAvatarKey(avatarValue);
  if (!normalized) return;
  const fileName = normalized.slice(AVATAR_MEDIA_PREFIX.length);
  const absolutePath = path.resolve(AVATAR_UPLOAD_DIR, fileName);
  const relative = path.relative(AVATAR_UPLOAD_DIR, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return;
  try {
    await fs.unlink(absolutePath);
  } catch {
    // Ignore missing files or unlink errors.
  }
};

const extractAvatarPayload = (rawValue) => {
  const value = String(rawValue || "").trim();
  if (!value) return null;

  if (value.startsWith("data:")) {
    const match = value.match(/^data:(.*?);base64,(.*)$/);
    if (!match) return null;
    return { base64: match[2], mimeType: match[1] || "image/jpeg" };
  }

  const isLong = value.length > 10000;
  const isBase64 = /^[A-Za-z0-9+/=]+$/.test(value);
  if (isLong && isBase64) {
    return { base64: value, mimeType: "image/jpeg" };
  }

  return null;
};

const saveAvatarBase64 = async ({ base64, mimeType = "image/jpeg", req }) => {
  const clean = String(base64 || "");
  if (!clean || !/^[A-Za-z0-9+/=\s]+$/.test(clean)) throw new Error("Avatar image is invalid.");

  const approxBytes = Math.floor(clean.length * 0.75);
  if (approxBytes > AVATAR_MAX_BYTES) {
    throw new Error("Avatar image is too large.");
  }

  const buffer = Buffer.from(clean, "base64");
  const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isWebp = buffer.length > 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (!buffer.length || (!isJpeg && !isPng && !isWebp)) {
    throw new Error("Avatar image is invalid.");
  }

  const safeExt = isPng ? "png" : isWebp ? "webp" : "jpg";
  const fileName = `avatar-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${safeExt}`;

  await fs.mkdir(AVATAR_UPLOAD_DIR, { recursive: true });
  const filePath = path.join(AVATAR_UPLOAD_DIR, fileName);
  await fs.writeFile(filePath, buffer);

  const baseUrl = getPublicBaseUrl(req);
  const publicUrl = baseUrl ? `${baseUrl}/uploads/avatars/${fileName}` : `uploads/avatars/${fileName}`;

  return { fileName, filePath, publicUrl };
};

const generateLoginChallenge = () => {
  const oneDigit = crypto.randomInt(1, 10);
  const twoDigit = crypto.randomInt(10, 100);
  const useAddition = crypto.randomInt(0, 2) === 0;
  const oneDigitFirst = crypto.randomInt(0, 2) === 0;

  let left = oneDigitFirst ? oneDigit : twoDigit;
  let right = oneDigitFirst ? twoDigit : oneDigit;
  const operator = useAddition ? "+" : "-";

  // Keep subtraction answers non-negative for numeric-only input UX.
  if (!useAddition && left < right) {
    [left, right] = [right, left];
  }

  const answer = operator === "+" ? left + right : left - right;
  const question = `What is ${left} ${operator} ${right}?`;
  return { question, answer: String(answer) };
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

const getOtpCooldownRemainingSeconds = (lastSentAt) => {
  if (!lastSentAt) return 0;
  const sentAtMs = new Date(lastSentAt).getTime();
  if (!Number.isFinite(sentAtMs)) return 0;
  const remaining = Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - (Date.now() - sentAtMs) / 1000);
  return remaining > 0 ? remaining : 0;
};

const findOtpRecord = async ({ email, otp, purpose }) =>
  Otp.findOne({
    email,
    otp: String(otp || "").trim(),
    purpose,
  });

export const getLoginChallenge = async (_req, res) => {
  try {
    const { question, answer } = generateLoginChallenge();
    const answerHash = await bcrypt.hash(answer, 10);
    const challengeId = crypto.randomBytes(18).toString("hex");
    const expiresAt = new Date(Date.now() + LOGIN_CHALLENGE_TTL_MINUTES * 60 * 1000);

    await LoginChallenge.create({
      challengeId,
      question,
      answerHash,
      maxAttempts: LOGIN_CHALLENGE_MAX_ATTEMPTS,
      expiresAt,
    });

    res.json({
      challengeId,
      question,
      expiresInMinutes: LOGIN_CHALLENGE_TTL_MINUTES,
    });
  } catch (error) {
    auditLog.error("AUTH", "Login challenge error", { detail: error.message });
    res.status(500).json({ message: "Failed to create login challenge." });
  }
};

export const checkRegistrationEmail = async (req, res) => {
  try {
    // Match final registration: any account with this email reserves it, regardless of role/status.
    const existing = await User.exists({ email: normalizeEmail(req.body.email) });
    if (existing) {
      return sendFieldError(res, 409, "email", "This email is already registered. Please sign in or use another email.", {
        code: "EMAIL_ALREADY_REGISTERED",
      });
    }
    return res.json({ success: true, available: true });
  } catch (error) {
    auditLog.error("AUTH", "Registration email check failed", { detail: error.message });
    return res.status(503).json({
      success: false,
      message: "We couldn't check your email right now. Please try again.",
    });
  }
};

export const registerUser = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
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
      const errors = {};
      if (!name) errors.name = "Name is required.";
      if (!email) errors.email = "Email is required.";
      if (!password) errors.password = "Password is required.";
      return res.status(400).json({ success: false, message: "Validation failed.", errors });
    }

    const normalizedEmail = normalizeEmail(email);
    const hasPhone = Object.prototype.hasOwnProperty.call(req.body, "phone");
    const normalizedPhone = normalizePhilippineMobile(phone);
    const requestedRole = role === "owner" ? "owner" : "user";
    let preKycSession;
    try {
      preKycSession = verifyPreKycSession(req.body.preKycToken, {
        email: normalizedEmail,
        role: requestedRole,
      });
    } catch (error) {
      return res.status(Number(error?.status) || 401).json({ success: false, message: error.message });
    }
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      auditLog.warn("AUTH", `Register with existing email: ${normalizedEmail}`, { ip: req.ip });
      return sendFieldError(res, 409, "email", "This email is already registered.");
    }

    if (hasPhone && !normalizedPhone) {
      return sendFieldError(
        res,
        400,
        "phone",
        "Phone number must be exactly 10 digits and start with 9."
      );
    }

    if (normalizedPhone) {
      const existingPhone = await User.findOne({ phone: normalizedPhone }).select("_id");
      if (existingPhone) {
        auditLog.warn("AUTH", `Register with existing phone: ${normalizedPhone}`, { ip: req.ip });
        return sendFieldError(res, 409, "phone", "This phone number is already registered.");
      }
    }

    const requiredDocs = requestedRole === "owner" ? ["id", "supporting"] : ["id"];
    const pendingDocs = await getPendingPreKycDocs(
      normalizedEmail,
      requiredDocs,
      preKycSession.sessionId
    );
    if (pendingDocs.length) {
      return res.status(409).json({
        success: false,
        message: "Your document is awaiting manual review. Please try registration again after it is approved.",
        reviewRequired: true,
        pendingDocuments: pendingDocs,
      });
    }
    const actionRequiredDocs = await getActionRequiredPreKycDocs(
      normalizedEmail,
      requiredDocs,
      preKycSession.sessionId
    );
    if (actionRequiredDocs.length) {
      return res.status(409).json({
        success: false,
        message: "One or more documents need your attention. Review the document status and upload a corrected file before registering.",
        reuploadRequired: true,
        documents: actionRequiredDocs,
      });
    }
    const missingDocs = await getMissingPreKycDocs(
      normalizedEmail,
      requiredDocs,
      preKycSession.sessionId
    );
    if (missingDocs.length) {
      const needsId = missingDocs.includes("id");
      const needsSupporting = missingDocs.includes("supporting");
      let message = "Please verify your ID before registering.";
      if (needsId && needsSupporting) {
        message = "Please verify your ID and supporting document before registering.";
      } else if (needsSupporting) {
        message = "Please verify your supporting document before registering.";
      }
      return res.status(400).json({ success: false, message });
    }

    const registrationIdentityMatches = await preKycIdentityMatchesRegistration(
      normalizedEmail,
      preKycSession.sessionId,
      { full_name: name, date_of_birth: dateOfBirth },
      { requireBirthDate: requestedRole === "user" }
    );
    if (!registrationIdentityMatches) {
      return res.status(409).json({
        success: false,
        message: "Your personal details changed after ID verification. Return to Identity and upload the matching ID again.",
        identityDetailsChanged: true,
      });
    }

    if (requestedRole === "owner" && !await preKycSupportingMatchesRegistration(
      normalizedEmail,
      preKycSession.sessionId,
      {
        business_name: businessName,
        permit_number: permitNumber,
        tax_identification_number: req.body.taxIdentificationNumber,
        branch_code: req.body.branchCode,
      }
    )) {
      return res.status(409).json({
        success: false,
        message: "Your business details changed after document review. Return to the supporting document step and submit it for review again.",
        supportingDetailsChanged: true,
      });
    }

    const faceVerified = await isPreKycFaceVerified(normalizedEmail, preKycSession.sessionId);
    if (!faceVerified) {
      return res.status(400).json({
        success: false,
        message: "Please verify your selfie matches your ID before registering.",
      });
    }

    const passwordMessage = validatePasswordStrength(password);
    if (passwordMessage) {
      return sendFieldError(res, 400, "password", passwordMessage);
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);
    const user = await User.create({
      name: toText(name),
      email: normalizedEmail,
      password: hashedPassword,
      role: requestedRole,
      kycStatus: "approved",
      phone: normalizedPhone || undefined,
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
      emergencyContactPhone: normalizePhilippineMobile(emergencyContactPhone) || undefined,
      emergencyContactRelationship: toText(emergencyContactRelationship) || undefined,
    });

    try {
      await KycVerification.findOneAndUpdate(
        { user: user._id },
        {
          user: user._id,
          status: "approved",
          verifiedAt: new Date(),
          remarks: "Identity approved during signed pre-registration KYC.",
        },
        { upsert: true, new: true }
      );
    } catch (kycCaseError) {
      // User.kycStatus remains the authorization source and /kyc/me fallback.
      // Do not strand a fully created account if the secondary audit write fails.
      auditLog.error("KYC", "Failed to create registration KYC case", {
        userId: user._id.toString(),
        detail: kycCaseError.message,
      });
    }

    clearAuthCookie(res);

    auditLog.info("AUTH", `Registered: ${normalizedEmail}`, { userId: user._id.toString() });
    if (CLEAR_PREKYC_ON_REGISTER) {
      await clearPreKycDocs(normalizedEmail);
      await clearPreKycFace(normalizedEmail);
    }

    res.status(201).json({
      success: true,
      message: "Registration successful. Please verify your email to continue.",
      user: buildSafeUserResponse(user),
    });
  } catch (error) {
    if (error?.code === 11000) {
      const duplicate = getDuplicateKeyDetails(error);
      return sendFieldError(res, 409, duplicate.field, duplicate.message);
    }

    if (error?.name === "ValidationError") {
      const errors = Object.fromEntries(
        Object.entries(error.errors || {}).map(([field, entry]) => [field, entry.message])
      );
      return res.status(400).json({ success: false, message: "Validation failed.", errors });
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
    const captchaId = String(req.body.captchaId || "").trim();
    const captchaAnswer = String(req.body.captchaAnswer || "").trim();

    if (!email || !password) {
      const errors = {};
      if (!email) errors.email = "Email is required.";
      if (!password) errors.password = "Password is required.";
      return res.status(400).json({ success: false, message: "Validation failed.", errors });
    }

    if (!captchaId || !captchaAnswer) {
      return sendFieldError(res, 400, "captchaAnswer", "Security check answer is required.");
    }
    if (!/^[0-9]+$/.test(captchaAnswer)) {
      return sendFieldError(res, 400, "captchaAnswer", "Security check answer must be a number.");
    }
    if (captchaAnswer.length > 3) {
      return sendFieldError(res, 400, "captchaAnswer", "Security check answer must be at most 3 digits.");
    }

    const challenge = await LoginChallenge.findOne({ challengeId: captchaId }).select("+answerHash");
    if (!challenge) {
      return sendFieldError(
        res,
        400,
        "captchaAnswer",
        "Security check expired. Please refresh and try again."
      );
    }
    if (challenge.usedAt) {
      return sendFieldError(
        res,
        400,
        "captchaAnswer",
        "Security check expired. Please refresh and try again."
      );
    }
    if (challenge.attempts >= challenge.maxAttempts) {
      if (!challenge.usedAt) {
        challenge.usedAt = new Date();
        await challenge.save();
      }
      return res.status(429).json({
        success: false,
        message: "Too many captcha attempts. Please refresh and try again.",
      });
    }

    const captchaOk = await bcrypt.compare(captchaAnswer, challenge.answerHash);
    challenge.attempts += 1;
    if (!captchaOk) {
      await challenge.save();
      return sendFieldError(res, 400, "captchaAnswer", "Security check answer is incorrect.");
    }
    challenge.usedAt = new Date();
    await challenge.save();

    const normalizedEmail = normalizeEmail(email);
    const user = await User.findOne({ email: normalizedEmail }).select("+password");

    if (!user) {
      auditLog.security("AUTH", "Login failed: unknown email", { email: normalizedEmail, ip: req.ip });
      return sendFieldError(res, 401, "email", "Invalid email.", { code: "INVALID_EMAIL" });
    }

    let isMatch = false;
    if (typeof user.matchPassword === "function") {
      isMatch = await user.matchPassword(password);
    } else {
      isMatch = await bcrypt.compare(password, user.password);
    }

    if (!isMatch) {
      auditLog.security("AUTH", "Login failed: wrong password", { email: normalizedEmail, ip: req.ip });
      return sendFieldError(res, 401, "password", "Invalid password.", {
        code: "INVALID_PASSWORD",
      });
    }

    await releaseExpiredModerationSuspension(user);

    if (user.isArchived) {
      clearAuthCookie(res);
      auditLog.security("AUTH", "Archived account attempted login", { userId: user._id.toString(), ip: req.ip });
      return sendFieldError(res, 403, "email", "This account has been archived. Contact the RentifyPro administrator.", {
        code: "ACCOUNT_ARCHIVED",
      });
    }

    if (user.isDisabled) {
      clearAuthCookie(res);
      auditLog.security("AUTH", "Disabled account attempted login", {
        userId: user._id.toString(),
        email: normalizedEmail,
        ip: req.ip,
      });
      return sendFieldError(res, 403, "email", "This account has been disabled. Contact the RentifyPro administrator.", {
        code: "ACCOUNT_DISABLED",
      });
    }

    if (!user.isVerified) {
      clearAuthCookie(res);
      return sendFieldError(
        res,
        403,
        "email",
        "Please verify your email before logging in."
      );
    }

    const token = signToken(user);
    setAuthCookie(res, token);

    auditLog.info("AUTH", `Logged in: ${normalizedEmail}`, { userId: user._id.toString() });
    LoginActivity.create({
      user: user._id,
      ip: req.ip || "",
      userAgent: req.get("user-agent") || "",
    }).catch((err) => {
      auditLog.warn("AUTH", "Login activity write failed", { detail: err.message });
    });

    res.json({
      success: true,
      message: "Login successful.",
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
    const cookieToken = String(req.cookies?.token || "").trim();
    if (cookieToken) {
      await revokeSessionToken(cookieToken);
      disconnectSessionSockets(cookieToken);
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

    const recipientEmail = normalizeEmail(user.email);
    const existingOtp = await Otp.findOne({
      email: recipientEmail,
      purpose: "verification",
    }).select("lastSentAt");
    const retryAfterSeconds = getOtpCooldownRemainingSeconds(existingOtp?.lastSentAt);
    if (retryAfterSeconds > 0) {
      const retryAfterMs = retryAfterSeconds * 1000;
      const retryAfterAt = new Date(Date.now() + retryAfterMs).toISOString();
      const countdown = `${String(Math.floor(retryAfterSeconds / 60)).padStart(2, "0")}:${String(
        retryAfterSeconds % 60
      ).padStart(2, "0")}`;
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        message: `Too many OTP attempts. Try again in ${countdown}.`,
        retryAfterSeconds,
        retryAfterMs,
        retryAfterAt,
        countdown,
        serverTime: new Date().toISOString(),
      });
    }

    const otp = createOtpCode();
    await createOtpRecord({ email: recipientEmail, otp, purpose: "verification" });
    await sendEmail(recipientEmail, otp, "verification");

    auditLog.info("AUTH", `Verification OTP sent to: ${recipientEmail}`);

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

    const recipientEmail = normalizeEmail(user.email);
    const existingOtp = await Otp.findOne({
      email: recipientEmail,
      purpose: "password_reset",
    }).select("lastSentAt");
    const retryAfterSeconds = getOtpCooldownRemainingSeconds(existingOtp?.lastSentAt);
    if (retryAfterSeconds > 0) {
      const retryAfterMs = retryAfterSeconds * 1000;
      const retryAfterAt = new Date(Date.now() + retryAfterMs).toISOString();
      const countdown = `${String(Math.floor(retryAfterSeconds / 60)).padStart(2, "0")}:${String(
        retryAfterSeconds % 60
      ).padStart(2, "0")}`;
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        message: `Too many OTP attempts. Try again in ${countdown}.`,
        retryAfterSeconds,
        retryAfterMs,
        retryAfterAt,
        countdown,
        serverTime: new Date().toISOString(),
      });
    }

    const otp = createOtpCode();
    await createOtpRecord({ email: recipientEmail, otp, purpose: "password_reset" });
    await sendEmail(recipientEmail, otp, "password_reset");

    auditLog.info("AUTH", `Password reset OTP sent to: ${recipientEmail}`);

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

    const consumedCode = await Otp.findOneAndDelete({
      _id: record._id,
      email: normalizedEmail,
      purpose: "password_reset",
      expiresAt: { $gt: new Date() },
    });
    if (!consumedCode) {
      return res.status(400).json({ success: false, message: "Invalid or expired code." });
    }

    const resetToken = jwt.sign(
      { email: normalizedEmail, purpose: "password_reset", jti: crypto.randomUUID() },
      PASSWORD_RESET_TOKEN_SECRET,
      { expiresIn: PASSWORD_RESET_TOKEN_EXPIRE }
    );

    const resetSession = await User.updateOne(
      { _id: user._id },
      { $set: { passwordResetTokenHash: hashAuthToken(resetToken) } }
    );
    if (resetSession.matchedCount !== 1) {
      return res.status(400).json({ success: false, message: "Invalid or expired code." });
    }
    await Otp.deleteMany({ email: normalizedEmail, purpose: "password_reset" });

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

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    const user = await User.findOneAndUpdate(
      { email: normalizedEmail, passwordResetTokenHash: hashAuthToken(token) },
      {
        $set: { password: passwordHash },
        $unset: { passwordResetTokenHash: "" },
        $inc: { sessionVersion: 1 },
      },
      { new: true }
    );
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Reset session is invalid or expired.",
      });
    }
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

export const changePassword = async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required.",
      });
    }

    const user = await User.findById(req.user._id).select("+password");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }

    const passwordMessage = validatePasswordStrength(newPassword);
    if (passwordMessage) {
      return res.status(400).json({ success: false, message: passwordMessage });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    const updatedUser = await User.findOneAndUpdate(
      { _id: user._id, password: user.password },
      {
        $set: { password: passwordHash },
        $unset: { passwordResetTokenHash: "" },
        $inc: { sessionVersion: 1 },
      },
      { new: true }
    );
    if (!updatedUser) {
      return res.status(409).json({ success: false, message: "Password changed in another session. Please sign in again." });
    }
    setAuthCookie(res, signToken(updatedUser));

    auditLog.info("AUTH", "Password changed", { userId: user._id.toString() });

    res.json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    auditLog.error("AUTH", "Change password error", { detail: error.message });
    res.status(500).json({ success: false, message: "Failed to change password." });
  }
};

const DEFAULT_NOTIFICATION_SETTINGS = {
  email: true,
  sms: false,
  bookingUpdates: true,
  promotions: false,
};

export const getNotificationSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("notificationSettings");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    res.json({
      success: true,
      settings: {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        ...(user.notificationSettings || {}),
      },
    });
  } catch (error) {
    auditLog.error("AUTH", "Get notification settings error", { detail: error.message });
    res.status(500).json({ success: false, message: "Failed to load notification settings." });
  }
};

export const updateNotificationSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("notificationSettings");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const current = { ...DEFAULT_NOTIFICATION_SETTINGS, ...(user.notificationSettings || {}) };
    const nextSettings = {
      email: toBool(req.body.email, current.email),
      sms: toBool(req.body.sms, current.sms),
      bookingUpdates: toBool(req.body.bookingUpdates, current.bookingUpdates),
      promotions: toBool(req.body.promotions, current.promotions),
    };

    user.notificationSettings = nextSettings;
    await user.save();

    res.json({ success: true, settings: nextSettings });
  } catch (error) {
    auditLog.error("AUTH", "Update notification settings error", { detail: error.message });
    res.status(500).json({ success: false, message: "Failed to update notification settings." });
  }
};

export const getLoginActivity = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 10), 50);
    const activity = await LoginActivity.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, activity });
  } catch (error) {
    auditLog.error("AUTH", "Get login activity error", { detail: error.message });
    res.status(500).json({ success: false, message: "Failed to load login activity." });
  }
};

export const upgradeToOwner = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (user.role === "owner") {
      return res.json({ success: true, message: "You are already a vehicle owner.", user: buildSafeUserResponse(user) });
    }
    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email before upgrading to a vehicle owner.",
      });
    }

    let preKycSession;
    try {
      preKycSession = verifyPreKycSession(req.body.preKycToken, {
        email: user.email,
        role: "owner",
      });
    } catch (error) {
      return res.status(Number(error?.status) || 401).json({ success: false, message: error.message });
    }

    const pendingDocs = await getPendingPreKycDocs(
      user.email,
      ["supporting"],
      preKycSession.sessionId
    );
    if (pendingDocs.length) {
      return res.status(409).json({
        success: false,
        message: "Your supporting document is awaiting manual review.",
        reviewRequired: true,
      });
    }

    const actionRequiredDocs = await getActionRequiredPreKycDocs(
      user.email,
      ["supporting"],
      preKycSession.sessionId
    );
    if (actionRequiredDocs.length) {
      return res.status(409).json({
        success: false,
        message: "Your supporting document needs attention. Review its status and upload a corrected file before continuing.",
        reuploadRequired: true,
        documents: actionRequiredDocs,
      });
    }

    const missingDocs = await getMissingPreKycDocs(
      user.email,
      ["supporting"],
      preKycSession.sessionId
    );
    if (missingDocs.length) {
      return res.status(400).json({
        success: false,
        message: "Please verify your supporting business document before upgrading to a vehicle owner.",
      });
    }

    const ownerType = toText(req.body.ownerType);
    const businessName = toText(req.body.businessName);
    const licenseNumber = toText(req.body.licenseNumber);
    const permitNumber = toText(req.body.permitNumber);

    if (ownerType) user.ownerType = ownerType;
    if (businessName) user.businessName = businessName;
    if (licenseNumber) user.licenseNumber = licenseNumber;
    if (permitNumber) user.permitNumber = permitNumber;

    const verifiedAt = new Date();
    user.role = "owner";
    user.kycStatus = "approved";
    user.kycStatusUpdatedAt = verifiedAt;
    await user.save();

    try {
      await KycVerification.findOneAndUpdate(
        { user: user._id },
        {
          user: user._id,
          status: "approved",
          verifiedAt,
          remarks: "Identity approved during owner upgrade verification.",
        },
        { upsert: true, new: true }
      );
    } catch (kycCaseError) {
      // The user summary is the authorization source. Keep the verified owner
      // from being stranded if the secondary KYC audit write is unavailable.
      auditLog.error("KYC", "Failed to create owner upgrade KYC case", {
        userId: user._id.toString(),
        detail: kycCaseError.message,
      });
    }

    auditLog.info("AUTH", "Upgraded to owner", { userId: user._id.toString() });

    res.json({
      success: true,
      message: "You are now registered as a vehicle owner.",
      user: buildSafeUserResponse(user),
    });
  } catch (error) {
    auditLog.error("AUTH", "Upgrade to owner error", { detail: error.message });
    res.status(500).json({ success: false, message: "Failed to upgrade account." });
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
          if (age > MAX_RENTER_AGE) {
            return res.status(400).json({
              success: false,
              message: "Date of birth must correspond to an age of 18 to 100.",
            });
          }
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "phone")) {
      const phone = normalizePhilippineMobile(req.body.phone);
      if (!phone) {
        return res.status(400).json({
          success: false,
          message: "Phone number must be exactly 10 digits and start with 9.",
        });
      }

      const existingPhone = await User.findOne({
        phone,
        _id: { $ne: user._id },
      }).select("_id");

      if (existingPhone) {
        return res.status(409).json({
          success: false,
          message: "This phone number is already registered.",
        });
      }

      req.body.phone = phone;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "emergencyContactName")) {
      const emergencyContactName = toText(req.body.emergencyContactName);
      if (emergencyContactName) {
        if (!EMERGENCY_CONTACT_NAME_REGEX.test(emergencyContactName)) {
          return res.status(400).json({
            success: false,
            message:
              "Emergency contact name can only contain letters and single spaces between names.",
          });
        }
        if (emergencyContactName.length > MAX_EMERGENCY_CONTACT_NAME_LENGTH) {
          return res.status(400).json({
            success: false,
            message: `Emergency contact name is too long (max ${MAX_EMERGENCY_CONTACT_NAME_LENGTH} characters).`,
          });
        }
        req.body.emergencyContactName = emergencyContactName;
      } else {
        req.body.emergencyContactName = "";
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "emergencyContactPhone")) {
      const emergencyContactPhone = toText(req.body.emergencyContactPhone);
      if (emergencyContactPhone) {
        const normalizedEmergencyContactPhone = normalizePhilippineMobile(emergencyContactPhone);
        if (!isValidPhilippineMobile(normalizedEmergencyContactPhone)) {
          return res.status(400).json({
            success: false,
            message: "Emergency contact phone must be exactly 10 digits and start with 9.",
          });
        }
        req.body.emergencyContactPhone = normalizedEmergencyContactPhone;
      } else {
        req.body.emergencyContactPhone = "";
      }
    }

    const profileFields = [
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

    if (Object.prototype.hasOwnProperty.call(req.body, "avatar")) {
      try {
        const avatarInput = toText(req.body.avatar);
        if (!avatarInput) {
          await removeLocalAvatarIfExists(user.avatar);
          user.avatar = "";
        } else {
          const avatarPayload = extractAvatarPayload(avatarInput);
          if (avatarPayload) {
            await removeLocalAvatarIfExists(user.avatar);
            const stored = await saveAvatarBase64({
              base64: avatarPayload.base64,
              mimeType: avatarPayload.mimeType,
              req,
            });
            user.avatar = stored.publicUrl;
          } else {
            const localAvatarKey = normalizeAvatarKey(avatarInput);
            if (localAvatarKey) {
              const baseUrl = getPublicBaseUrl(req);
              user.avatar = baseUrl ? `${baseUrl}/${localAvatarKey}` : localAvatarKey;
            } else {
              const externalUrl = new URL(avatarInput);
              if (externalUrl.protocol !== "https:" || externalUrl.username || externalUrl.password || avatarInput.length > 2048) {
                throw new Error("Avatar must be a valid HTTPS image URL.");
              }
              user.avatar = externalUrl.toString();
            }
          }
        }
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error?.message || "Avatar image is invalid.",
        });
      }
    }

    profileFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        user[field] = toText(req.body[field]) || undefined;
      }
    });

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
