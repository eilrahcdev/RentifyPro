import path from "node:path";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import hpp from "hpp";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { getMongoConnectionConfig } from "./config/mongoConnection.js";
import { checkAdminStorage } from "./config/storage.js";
import { startAdminRecoveryJob, recoveryStatus } from "./services/adminRecovery.service.js";
import { startAdminIdentifierScreeningJob } from "./services/adminIdentifierScreening.service.js";
import { getAdminSecurityConfiguration, requireCrossSiteAdminOrigin } from "./config/adminSecurity.js";
import AdminCredential from "./models/AdminCredential.js";
import AdminMfaChallenge from "./models/AdminMfaChallenge.js";
import AdminPasswordReset from "./models/AdminPasswordReset.js";
import AdminSession from "./models/AdminSession.js";
import { createAdminDataRouter } from "./routes/adminData.routes.js";
import { recordAdminAudit } from "./services/adminAudit.service.js";
import { sendAdminMfaCodeEmail, sendAdminPasswordResetEmail } from "./services/adminEmail.service.js";

const backendDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(backendDirectory, ".env"), quiet: true });
const websiteBackendDirectory = path.resolve(
  process.env.WEBSITE_BACKEND_DIR || path.join(backendDirectory, "..", "..", "rentifypro", "backend"),
);
dotenv.config({ path: path.join(websiteBackendDirectory, ".env"), quiet: true });

const app = express();
const adminSecurity = getAdminSecurityConfiguration();
const port = Number(process.env.PORT) || 5000;
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5174";
const isProduction = process.env.NODE_ENV === "production";
const configuredClientOrigins = new Set(
  clientOrigin.split(",").map((origin) => origin.trim()).filter(Boolean),
);
const bootstrapAdminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const bootstrapAdminName = String(process.env.ADMIN_NAME || "System Admin").trim();
const configuredPasswordHash = String(process.env.ADMIN_PASSWORD_HASH || "").trim();
const bootstrapAdminPassword = String(process.env.ADMIN_PASSWORD || "");
const jwtSecret = String(process.env.JWT_SECRET || "").trim();
const sessionCookieName = "rentifypro_admin_session";
const shortSessionSeconds = 8 * 60 * 60;
const rememberedSessionSeconds = 30 * 24 * 60 * 60;
const resetCodeLifetimeMs = 5 * 60 * 1000;
const resetCodeCooldownMs = 60 * 1000;
const resetTokenLifetime = "15m";
const developmentResetCodeEnabled = !isProduction && String(process.env.ADMIN_PASSWORD_RESET_DEV_MODE || "").toLowerCase() === "true";
const mfaCodeLifetimeMs = 5 * 60 * 1000;
const mfaChallengeLifetimeMs = 10 * 60 * 1000;
const mfaEmailCooldownMs = 60 * 1000;
const allowedEmailDomains = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com"]);
const emailPattern = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{2028}\u{2029}]/u;
let databaseConnectionAttempt = null;

const isDevelopmentLoopbackOrigin = (origin) => {
  if (isProduction) return false;
  try {
    const { protocol, hostname } = new URL(origin);
    return ["http:", "https:"].includes(protocol)
      && ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
};

const validateCorsOrigin = (origin, callback) => {
  if (!origin || configuredClientOrigins.has(origin) || isDevelopmentLoopbackOrigin(origin)) {
    return callback(null, true);
  }
  const error = new Error(`Origin ${origin} is not allowed by CORS`);
  error.status = 403;
  return callback(error);
};

app.use(helmet());
if (adminSecurity.proxyHops) app.set("trust proxy", adminSecurity.proxyHops);
app.use(cors({
  origin: validateCorsOrigin,
  credentials: true,
  exposedHeaders: ["X-RentifyPro-Admin-Contract"],
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(requireCrossSiteAdminOrigin({ sameSite: adminSecurity.sameSite, allowedOrigins: configuredClientOrigins, cookieName: sessionCookieName }));
app.use(hpp());

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
});

const passwordRecoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many password recovery attempts. Please wait 15 minutes and try again." },
});

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const isLoopbackRequest = (request) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(String(request.ip || ""));
const maskEmail = (value) => {
  const [local, domain] = normalizeEmail(value).split("@");
  if (!local || !domain) return "your administrator email";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 3))}@${domain}`;
};

const validateEmail = (value) => {
  const email = normalizeEmail(value);
  if (!email) return "Email is required.";
  if (emojiPattern.test(email)) return "Email must not contain emoji.";
  if (/\s/.test(email)) return "Email must not contain spaces.";
  if (email.length > 254) return "Email is too long (max 254 characters).";
  if (!emailPattern.test(email)) return "Enter a valid email format.";
  if (!allowedEmailDomains.has(email.split("@")[1])) return "Please use Gmail, Yahoo, Outlook, or Hotmail.";
  return "";
};

const validatePassword = (value) => {
  const password = typeof value === "string" ? value : "";
  if (!password) return "Password is required.";
  if (/\s/.test(password)) return "Password must not contain spaces.";
  if (emojiPattern.test(password)) return "Password must not contain emoji.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 128) return "Password is too long (max 128 characters).";
  if (!/[A-Z]/.test(password)) return "Password needs an uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password needs a lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password needs a number.";
  if (!/[!@#$%^&*()_+\-=[\]{}|;':\",.<>?/`~]/.test(password)) return "Password needs a special character.";
  return "";
};

const validatePasskey = (value) => {
  const passkey = typeof value === "string" ? value : "";
  if (!passkey) return "Secret passkey is required.";
  if (/\s/.test(passkey)) return "Secret passkey must not contain spaces.";
  if (emojiPattern.test(passkey)) return "Secret passkey must not contain emoji.";
  if (passkey.length < 12) return "Secret passkey must be at least 12 characters.";
  if (passkey.length > 128) return "Secret passkey is too long (max 128 characters).";
  if (!/[A-Z]/.test(passkey)) return "Secret passkey needs an uppercase letter.";
  if (!/[a-z]/.test(passkey)) return "Secret passkey needs a lowercase letter.";
  if (!/[0-9]/.test(passkey)) return "Secret passkey needs a number.";
  if (!/[!@#$%^&*()_+\-=[\]{}|;':\",.<>?/`~]/.test(passkey)) return "Secret passkey needs a special character.";
  return "";
};

const normalizePasskeyForHash = (value) => createHash("sha256").update(String(value || ""), "utf8").digest("base64");
const hashPasskey = (value) => bcrypt.hash(normalizePasskeyForHash(value), 12);
const comparePasskey = (value, hash) => bcrypt.compare(normalizePasskeyForHash(value), hash);

const publicAdmin = (account) => ({
  id: account.key,
  name: account.name,
  email: account.email,
  role: "admin",
  isVerified: true,
});

const cookieOptions = (rememberMe = false) => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: adminSecurity.sameSite,
  path: "/",
  ...(rememberMe ? { maxAge: rememberedSessionSeconds * 1000 } : {}),
});

const clearSessionCookie = (response) => response.clearCookie(sessionCookieName, cookieOptions(false));

const createAdminSession = async (request, response, account, rememberMe) => {
  const sessionId = randomUUID();
  const lifetimeSeconds = rememberMe ? rememberedSessionSeconds : shortSessionSeconds;
  await AdminSession.create({
    sessionId,
    adminKey: account.key,
    adminEmail: account.email,
    ip: String(request.ip || "").slice(0, 100),
    userAgent: String(request.get?.("user-agent") || "").slice(0, 500),
    rememberMe,
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + lifetimeSeconds * 1000),
  });
  const token = jwt.sign(
    { role: "admin", email: account.email, name: account.name, sessionVersion: account.sessionVersion, mfa: true, sid: sessionId },
    jwtSecret,
    {
      algorithm: "HS256",
      subject: "system-admin",
      issuer: "rentifypro-admin-api",
      audience: "rentifypro-admin",
      expiresIn: lifetimeSeconds,
    },
  );
  response.cookie(sessionCookieName, token, cookieOptions(rememberMe));
  return sessionId;
};

const readAdminSession = (request) => {
  const token = request.cookies?.[sessionCookieName];
  if (!token || !jwtSecret) return null;
  try {
    const payload = jwt.verify(token, jwtSecret, {
      algorithms: ["HS256"],
      issuer: "rentifypro-admin-api",
      audience: "rentifypro-admin",
    });
    return payload?.role === "admin" && payload?.sub === "system-admin" && payload?.mfa === true ? payload : null;
  } catch {
    return null;
  }
};

const connectDatabase = async () => {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  const { uri, options } = getMongoConnectionConfig();
  if (!uri) throw new Error("MONGODB_URI, MONGO_URI, or MONGO_URI_DIRECT must be configured.");
  if (!databaseConnectionAttempt) {
    databaseConnectionAttempt = mongoose.connect(uri, options)
      .then(connection => { startAdminRecoveryJob(); startAdminIdentifierScreeningJob(); return connection; })
      .finally(() => { databaseConnectionAttempt = null; });
  }
  return databaseConnectionAttempt;
};

const getAdminAccount = (includePassword = false) => {
  const query = AdminCredential.findOne({ key: "system-admin" });
  return includePassword ? query.select("+passwordHash") : query;
};

const ensureAdminAccount = async () => {
  let account = await getAdminAccount(true);
  if (!account) {
    if (!bootstrapAdminEmail || (!configuredPasswordHash && !bootstrapAdminPassword)) {
      throw new Error("Admin bootstrap credentials are not configured.");
    }
    const passwordHash = configuredPasswordHash || await bcrypt.hash(bootstrapAdminPassword, 12);
    account = await AdminCredential.create({
      key: "system-admin",
      name: bootstrapAdminName,
      email: bootstrapAdminEmail,
      passwordHash,
    });
    return getAdminAccount(true);
  }

  let changed = false;
  if (bootstrapAdminEmail && account.email !== bootstrapAdminEmail) {
    account.email = bootstrapAdminEmail;
    changed = true;
  }
  if (bootstrapAdminName && account.name !== bootstrapAdminName) {
    account.name = bootstrapAdminName;
    changed = true;
  }
  if (changed) await account.save();
  return account;
};

const getAuthenticatedAccount = async (session) => {
  if (!session?.sid) return null;
  const account = await getAdminAccount();
  if (!account || Number(session.sessionVersion) !== Number(account.sessionVersion)) return null;
  const storedSession = await AdminSession.findOne({
    sessionId: session.sid,
    adminKey: account.key,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!storedSession) return null;
  if (!storedSession.lastSeenAt || Date.now() - storedSession.lastSeenAt.getTime() > 60_000) {
    storedSession.lastSeenAt = new Date();
    await storedSession.save();
  }
  return { account, storedSession };
};

const confirmAdminPassword = async (password) => {
  const account = await AdminCredential.findOne({ key: "system-admin" }).select("+passwordHash");
  return account && await bcrypt.compare(String(password || ""), account.passwordHash) ? account : null;
};

const deliverAdminEmailMfaCode = async (request, challenge, account) => {
  const otp = String(randomInt(100000, 1000000));
  const now = new Date();
  challenge.otpHash = await bcrypt.hash(otp, 10);
  challenge.emailCodeSentAt = now;
  challenge.emailCodeExpiresAt = new Date(now.getTime() + mfaCodeLifetimeMs);
  if (challenge.expiresAt.getTime() < challenge.emailCodeExpiresAt.getTime()) {
    challenge.expiresAt = challenge.emailCodeExpiresAt;
  }
  await challenge.save();
  try {
    await sendAdminMfaCodeEmail(account.email, otp, {
      requestedAt: now.toISOString(),
      location: String(request.ip || "unknown source"),
    });
  } catch (error) {
    challenge.otpHash = "";
    challenge.emailCodeSentAt = null;
    challenge.emailCodeExpiresAt = null;
    await challenge.save().catch(() => {});
    throw error;
  }
};

const requireAdminSession = async (request, response, next) => {
  const session = readAdminSession(request);
  if (!session) return response.status(401).json({ message: "Your admin session has expired. Please log in again." });
  try {
    await connectDatabase();
    const authenticated = await getAuthenticatedAccount(session);
    if (!authenticated) {
      clearSessionCookie(response);
      return response.status(401).json({ message: "Your admin session has expired. Please log in again." });
    }
    request.adminAccount = authenticated.account;
    request.adminSession = authenticated.storedSession;
    return next();
  } catch {
    return response.status(503).json({
      message: "The RentifyPro database is unavailable. Verify the MongoDB URI, database name, and network access in backend/.env.",
      code: "DATABASE_UNAVAILABLE",
    });
  }
};

app.post("/api/admin/auth/login", adminLoginLimiter, async (request, response) => {
  if (!jwtSecret) return response.status(503).json({ message: "Admin login is not configured on the server." });

  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password || "");
  const errors = { email: validateEmail(email), password: validatePassword(password) };
  if (errors.email || errors.password) {
    return response.status(400).json({ message: "Check the highlighted login fields.", errors });
  }

  try {
    await connectDatabase();
    const account = await ensureAdminAccount();
    const passwordMatches = email === account.email && await bcrypt.compare(password, account.passwordHash);
    if (!passwordMatches) {
      await recordAdminAudit({
        request,
        admin: { email: email || "unknown@rentifypro.invalid" },
        action: "admin.login.failed",
        outcome: "failure",
        targetType: "admin_session",
        summary: "Super Admin password sign-in failed.",
      });
      return response.status(401).json({ message: "Invalid email or password." });
    }

    const rememberMe = request.body?.rememberMe === true;
    const challengeId = randomUUID();
    await AdminMfaChallenge.deleteMany({ email: account.email });
    const challenge = await AdminMfaChallenge.create({
      challengeId,
      email: account.email,
      rememberMe,
      attempts: 0,
      maxAttempts: 5,
      requestedIp: String(request.ip || ""),
      expiresAt: new Date(Date.now() + mfaChallengeLifetimeMs),
    });

    const passkeyAvailable = Boolean(account.passkeyEnabledAt);
    let emailCodeSent = false;
    if (!passkeyAvailable) {
      try {
        await deliverAdminEmailMfaCode(request, challenge, account);
        emailCodeSent = true;
      } catch (error) {
        console.error("Admin MFA email failed:", error.message);
        await AdminMfaChallenge.deleteOne({ challengeId });
        return response.status(503).json({ message: "The sign-in code could not be delivered. Check the administrator SMTP configuration." });
      }
    }

    const defaultMethod = passkeyAvailable ? "passkey" : "email";

    await recordAdminAudit({
      request,
      admin: account,
      action: "admin.mfa.requested",
      targetType: "admin_session",
      summary: "Super Admin password accepted; MFA verification requested.",
      metadata: { defaultMethod, emailCodeSent },
    });
    return response.status(202).json({
      message: defaultMethod === "passkey"
        ? "Enter your secret admin passkey to continue."
        : "Enter the six-digit code sent to your administrator email.",
      requiresMfa: true,
      challengeId,
      maskedEmail: maskEmail(account.email),
      defaultMethod,
      passkeyAvailable,
      emailCodeSent,
    });
  } catch (error) {
    console.error("Admin login failed:", error.message);
    return response.status(503).json({ message: "Admin authentication is temporarily unavailable." });
  }
});

app.post("/api/admin/auth/mfa/email/send", adminLoginLimiter, async (request, response) => {
  const challengeId = String(request.body?.challengeId || "").trim();
  if (!challengeId) return response.status(400).json({ message: "The sign-in challenge is required." });

  try {
    await connectDatabase();
    const challenge = await AdminMfaChallenge.findOne({ challengeId }).select("+otpHash");
    if (!challenge || challenge.expiresAt.getTime() <= Date.now()) {
      if (challenge) await AdminMfaChallenge.deleteOne({ _id: challenge._id });
      return response.status(400).json({ message: "The sign-in challenge is invalid or expired. Return to login." });
    }
    const elapsed = challenge.emailCodeSentAt ? Date.now() - challenge.emailCodeSentAt.getTime() : mfaEmailCooldownMs;
    if (elapsed < mfaEmailCooldownMs) {
      const retryAfterSeconds = Math.ceil((mfaEmailCooldownMs - elapsed) / 1000);
      response.setHeader("Retry-After", String(retryAfterSeconds));
      return response.status(429).json({ message: `Please wait ${retryAfterSeconds} seconds before requesting another email code.`, retryAfterSeconds });
    }
    const account = await AdminCredential.findOne({ key: "system-admin", email: challenge.email });
    if (!account) return response.status(400).json({ message: "The sign-in challenge is invalid or expired. Return to login." });
    await deliverAdminEmailMfaCode(request, challenge, account);
    await recordAdminAudit({ request, admin: account, action: "admin.mfa.email_requested", targetType: "admin_session", summary: "Super Admin requested email verification as an alternate sign-in method." });
    return response.json({ message: "A six-digit verification code was sent to your administrator email.", emailCodeSent: true, maskedEmail: maskEmail(account.email) });
  } catch (error) {
    console.error("Admin MFA email failed:", error.message);
    return response.status(503).json({ message: "The sign-in code could not be delivered. Check the administrator SMTP configuration." });
  }
});

app.post("/api/admin/auth/mfa/verify", adminLoginLimiter, async (request, response) => {
  const challengeId = String(request.body?.challengeId || "").trim();
  const otp = String(request.body?.otp || "").trim();
  if (!challengeId || !/^\d{6}$/.test(otp)) {
    return response.status(400).json({ message: "Enter the complete six-digit sign-in code." });
  }

  try {
    await connectDatabase();
    const record = await AdminMfaChallenge.findOne({ challengeId }).select("+otpHash");
    if (!record || record.expiresAt.getTime() <= Date.now()) {
      if (record) await AdminMfaChallenge.deleteOne({ _id: record._id });
      return response.status(400).json({ message: "The sign-in code is invalid or expired. Return to login and request a new code." });
    }
    if (record.attempts >= record.maxAttempts) {
      await AdminMfaChallenge.deleteOne({ _id: record._id });
      return response.status(429).json({ message: "Too many incorrect codes. Return to login and request a new code." });
    }
    if (!record.otpHash || !record.emailCodeSentAt || !record.emailCodeExpiresAt) {
      return response.status(400).json({ message: "Request an email verification code before using this option." });
    }
    if (record.emailCodeExpiresAt.getTime() <= Date.now()) {
      return response.status(400).json({ message: "The emailed sign-in code has expired. Request a new code." });
    }

    const account = await getAdminAccount();
    const matches = account?.email === record.email && await bcrypt.compare(otp, record.otpHash);
    if (!matches) {
      record.attempts += 1;
      await record.save();
      await recordAdminAudit({
        request,
        admin: account || { email: record.email },
        action: "admin.mfa.failed",
        outcome: "failure",
        targetType: "admin_session",
        summary: "Super Admin MFA verification failed.",
        metadata: { remainingAttempts: Math.max(record.maxAttempts - record.attempts, 0) },
      });
      return response.status(400).json({ message: "The sign-in code is invalid or expired." });
    }

    await AdminMfaChallenge.deleteMany({ email: record.email });
    await createAdminSession(request, response, account, record.rememberMe);
    await recordAdminAudit({
      request,
      admin: account,
      action: "admin.login.succeeded",
      targetType: "admin_session",
      summary: "Super Admin completed password and email-code verification.",
      metadata: { mfaMethod: "email" },
    });
    return response.json({ message: "Login successful.", user: publicAdmin(account) });
  } catch (error) {
    console.error("Admin MFA verification failed:", error.message);
    return response.status(503).json({ message: "MFA verification is temporarily unavailable." });
  }
});

app.post("/api/admin/auth/mfa/passkey/verify", adminLoginLimiter, async (request, response) => {
  const challengeId = String(request.body?.challengeId || "").trim();
  const passkey = String(request.body?.passkey || "");
  if (!challengeId || !passkey) {
    return response.status(400).json({ message: "Enter your secret admin passkey." });
  }

  try {
    await connectDatabase();
    const challenge = await AdminMfaChallenge.findOne({ challengeId });
    if (!challenge || challenge.expiresAt.getTime() <= Date.now()) {
      if (challenge) await AdminMfaChallenge.deleteOne({ _id: challenge._id });
      return response.status(400).json({ message: "The sign-in challenge is invalid or expired. Return to login." });
    }
    if (challenge.attempts >= challenge.maxAttempts) {
      await AdminMfaChallenge.deleteOne({ _id: challenge._id });
      return response.status(429).json({ message: "Too many incorrect attempts. Return to login and try again." });
    }
    const account = await AdminCredential.findOne({ key: "system-admin", email: challenge.email }).select("+passkeyHash");
    const matches = Boolean(account?.passkeyEnabledAt && account.passkeyHash)
      && await comparePasskey(passkey, account.passkeyHash);
    if (!matches) {
      challenge.attempts += 1;
      await challenge.save();
      await recordAdminAudit({ request, admin: account || { email: challenge.email }, action: "admin.passkey.failed", outcome: "failure", targetType: "admin_session", summary: "Super Admin secret-passkey verification failed.", metadata: { remainingAttempts: Math.max(challenge.maxAttempts - challenge.attempts, 0) } });
      return response.status(400).json({ message: "The secret passkey is incorrect." });
    }

    await AdminMfaChallenge.deleteMany({ email: challenge.email });
    await createAdminSession(request, response, account, challenge.rememberMe);
    await recordAdminAudit({ request, admin: account, action: "admin.login.succeeded", targetType: "admin_session", summary: "Super Admin completed password and secret-passkey verification.", metadata: { mfaMethod: "passkey" } });
    return response.json({ message: "Secret passkey accepted.", user: publicAdmin(account) });
  } catch (error) {
    console.error("Admin secret-passkey verification failed:", error.message);
    return response.status(503).json({ message: "Secret-passkey verification is temporarily unavailable." });
  }
});

app.get("/api/admin/auth/session", async (request, response) => {
  const session = readAdminSession(request);
  try {
    await connectDatabase();
    const authenticated = await getAuthenticatedAccount(session);
    if (!authenticated) {
      clearSessionCookie(response);
      return response.status(401).json({ message: "No active admin session." });
    }
    return response.json({ user: publicAdmin(authenticated.account) });
  } catch {
    return response.status(503).json({ message: "Admin authentication is temporarily unavailable." });
  }
});

app.post("/api/admin/auth/logout", async (request, response) => {
  const session = readAdminSession(request);
  clearSessionCookie(response);
  if (session) {
    try {
      await connectDatabase();
      const authenticated = await getAuthenticatedAccount(session);
      if (authenticated) {
        await AdminSession.updateOne({ sessionId: session.sid }, { $set: { revokedAt: new Date() } });
        await recordAdminAudit({
          request,
          admin: authenticated.account,
          action: "admin.logout",
          targetType: "admin_session",
          summary: "Super Admin signed out.",
        });
      }
    } catch {
      // Logout must still succeed when audit storage is unavailable.
    }
  }
  return response.json({ message: "Logged out successfully." });
});

app.get("/api/admin/auth/sessions", requireAdminSession, async (request, response) => {
  const sessions = await AdminSession.find({
    adminKey: request.adminAccount.key,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ lastSeenAt: -1 }).lean();
  return response.json({
    sessions: sessions.map((session) => ({
      id: session.sessionId,
      ip: session.ip,
      userAgent: session.userAgent,
      rememberMe: session.rememberMe,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      current: session.sessionId === request.adminSession.sessionId,
    })),
  });
});

app.delete("/api/admin/auth/sessions/:sessionId", requireAdminSession, async (request, response) => {
  const sessionId = String(request.params.sessionId || "").trim();
  const result = await AdminSession.updateOne(
    { sessionId, adminKey: request.adminAccount.key, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  if (!result.modifiedCount) return response.status(404).json({ message: "Active session not found." });
  const current = sessionId === request.adminSession.sessionId;
  if (current) clearSessionCookie(response);
  await recordAdminAudit({ request, admin: request.adminAccount, action: "admin.session.revoked", targetType: "admin_session", targetId: sessionId, summary: current ? "Super Admin revoked the current session." : "Super Admin revoked an active session." });
  return response.json({ message: current ? "Current session revoked." : "Session revoked.", current });
});

app.post("/api/admin/auth/sessions/revoke-others", requireAdminSession, async (request, response) => {
  const result = await AdminSession.updateMany(
    { adminKey: request.adminAccount.key, sessionId: { $ne: request.adminSession.sessionId }, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  await recordAdminAudit({ request, admin: request.adminAccount, action: "admin.sessions.revoked_others", targetType: "admin_session", summary: `Super Admin revoked ${result.modifiedCount || 0} other session(s).` });
  return response.json({ message: `${result.modifiedCount || 0} other session(s) revoked.`, revokedCount: result.modifiedCount || 0 });
});

app.get("/api/admin/auth/passkey/status", requireAdminSession, async (request, response) => {
  const account = await AdminCredential.findOne({ key: request.adminAccount.key }).select("passkeyEnabledAt");
  return response.json({ enabled: Boolean(account?.passkeyEnabledAt), enabledAt: account?.passkeyEnabledAt || null });
});

app.put("/api/admin/auth/passkey", adminLoginLimiter, requireAdminSession, async (request, response) => {
  const adminPassword = String(request.body?.adminPassword || "");
  const newPasskey = String(request.body?.newPasskey || "");
  const currentPasskey = String(request.body?.currentPasskey || "");
  const passkeyError = validatePasskey(newPasskey);
  if (passkeyError) return response.status(400).json({ message: passkeyError, errors: { passkey: passkeyError } });
  if (newPasskey === adminPassword) {
    return response.status(400).json({ message: "The secret passkey must be different from the Super Admin password." });
  }

  const confirmedAccount = await confirmAdminPassword(adminPassword);
  if (!confirmedAccount) {
    await recordAdminAudit({ request, admin: request.adminAccount, action: "admin.passkey.change_failed", outcome: "failure", targetType: "admin_account", summary: "Secret-passkey configuration was blocked by failed password confirmation." });
    return response.status(403).json({ message: "The Super Admin password is incorrect." });
  }
  const account = await AdminCredential.findOne({ key: confirmedAccount.key }).select("+passkeyHash");
  const replacing = Boolean(account.passkeyEnabledAt && account.passkeyHash);
  if (replacing && !await comparePasskey(currentPasskey, account.passkeyHash)) {
    return response.status(403).json({ message: "The current secret passkey is incorrect." });
  }

  account.passkeyHash = await hashPasskey(newPasskey);
  account.passkeyEnabledAt = new Date();
  await account.save();
  await recordAdminAudit({ request, admin: account, action: replacing ? "admin.passkey.changed" : "admin.passkey.enabled", targetType: "admin_account", summary: replacing ? "Super Admin changed the secret login passkey." : "Super Admin enabled secret-passkey verification." });
  return response.json({ message: replacing ? "Secret passkey changed successfully." : "Secret passkey enabled successfully.", enabled: true, enabledAt: account.passkeyEnabledAt });
});

app.delete("/api/admin/auth/passkey", adminLoginLimiter, requireAdminSession, async (request, response) => {
  const adminPassword = String(request.body?.adminPassword || "");
  const passkey = String(request.body?.passkey || "");
  const confirmedAccount = await confirmAdminPassword(adminPassword);
  if (!confirmedAccount) return response.status(403).json({ message: "The Super Admin password is incorrect." });
  const account = await AdminCredential.findOne({ key: confirmedAccount.key }).select("+passkeyHash");
  if (!account.passkeyEnabledAt || !account.passkeyHash) {
    return response.status(400).json({ message: "Secret-passkey verification is not enabled." });
  }
  if (!await comparePasskey(passkey, account.passkeyHash)) {
    await recordAdminAudit({ request, admin: account, action: "admin.passkey.disable_failed", outcome: "failure", targetType: "admin_account", summary: "Secret-passkey disablement failed verification." });
    return response.status(403).json({ message: "The secret passkey is incorrect." });
  }
  account.passkeyHash = "";
  account.passkeyEnabledAt = null;
  await account.save();
  await recordAdminAudit({ request, admin: account, action: "admin.passkey.disabled", targetType: "admin_account", summary: "Super Admin disabled secret-passkey verification." });
  return response.json({ message: "Secret passkey disabled. Email verification is now the default.", enabled: false });
});

app.post("/api/admin/auth/forgot-password", passwordRecoveryLimiter, async (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const emailError = validateEmail(email);
  if (emailError) return response.status(400).json({ message: emailError, errors: { email: emailError } });

  try {
    await connectDatabase();
    const account = await getAdminAccount();
    const genericMessage = "If this email is registered, a password reset code has been sent.";
    if (!account || email !== account.email) return response.json({ message: genericMessage });

    const existing = await AdminPasswordReset.findOne({ email }).select("lastSentAt");
    const elapsed = existing?.lastSentAt ? Date.now() - new Date(existing.lastSentAt).getTime() : resetCodeCooldownMs;
    if (elapsed < resetCodeCooldownMs) {
      const retryAfterSeconds = Math.ceil((resetCodeCooldownMs - elapsed) / 1000);
      response.setHeader("Retry-After", String(retryAfterSeconds));
      return response.status(429).json({ message: `Please wait ${retryAfterSeconds} seconds before requesting another code.`, retryAfterSeconds });
    }

    const otp = String(randomInt(100000, 1000000));
    const otpHash = await bcrypt.hash(otp, 10);
    await AdminPasswordReset.findOneAndUpdate(
      { email },
      { email, otpHash, expiresAt: new Date(Date.now() + resetCodeLifetimeMs), attempts: 0, maxAttempts: 5, lastSentAt: new Date() },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
    try {
      await sendAdminPasswordResetEmail(email, otp);
    } catch (error) {
      console.error("Admin reset email failed:", error.message);
      if (developmentResetCodeEnabled && isLoopbackRequest(request)) {
        return response.json({
          message: "Email delivery is unavailable locally. Use the development verification code shown on screen.",
          delivery: "development",
          developmentCode: otp,
        });
      }
      await AdminPasswordReset.deleteOne({ email });
      return response.status(503).json({ message: "The reset email could not be sent. Check the SMTP configuration and try again." });
    }
    return response.json({ message: genericMessage });
  } catch (error) {
    console.error("Admin forgot password failed:", error.message);
    return response.status(503).json({ message: "Password recovery is temporarily unavailable." });
  }
});

app.post("/api/admin/auth/forgot-password/verify-otp", passwordRecoveryLimiter, async (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const otp = String(request.body?.otp || "").trim();
  const emailError = validateEmail(email);
  if (emailError) return response.status(400).json({ message: emailError });
  if (!/^\d{6}$/.test(otp)) return response.status(400).json({ message: "Enter the complete 6-digit verification code." });

  try {
    await connectDatabase();
    const [account, record] = await Promise.all([
      getAdminAccount(),
      AdminPasswordReset.findOne({ email }),
    ]);
    if (!account || account.email !== email || !record || record.expiresAt.getTime() <= Date.now()) {
      if (record) await AdminPasswordReset.deleteOne({ _id: record._id });
      return response.status(400).json({ message: "Invalid or expired code." });
    }
    if (record.attempts >= record.maxAttempts) {
      await AdminPasswordReset.deleteOne({ _id: record._id });
      return response.status(429).json({ message: "Too many incorrect codes. Request a new verification code." });
    }

    const matches = await bcrypt.compare(otp, record.otpHash);
    if (!matches) {
      record.attempts += 1;
      await record.save();
      return response.status(400).json({ message: "Invalid or expired code." });
    }

    await AdminPasswordReset.deleteOne({ _id: record._id });
    const resetToken = jwt.sign(
      { email, purpose: "admin_password_reset", sessionVersion: account.sessionVersion },
      jwtSecret,
      {
        algorithm: "HS256",
        subject: "system-admin",
        issuer: "rentifypro-admin-api",
        audience: "rentifypro-admin-password-reset",
        expiresIn: resetTokenLifetime,
      },
    );
    return response.json({ message: "Password reset code verified.", resetToken });
  } catch (error) {
    console.error("Admin reset verification failed:", error.message);
    return response.status(503).json({ message: "Password recovery is temporarily unavailable." });
  }
});

app.post("/api/admin/auth/reset-password", passwordRecoveryLimiter, async (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const resetToken = String(request.body?.token || "").trim();
  const newPassword = String(request.body?.newPassword || "");
  const emailError = validateEmail(email);
  const passwordError = validatePassword(newPassword);
  if (emailError || passwordError) {
    return response.status(400).json({ message: emailError || passwordError, errors: { email: emailError, password: passwordError } });
  }
  if (!resetToken) return response.status(400).json({ message: "Your password reset session has expired. Request a new code." });

  let payload;
  try {
    payload = jwt.verify(resetToken, jwtSecret, {
      algorithms: ["HS256"],
      subject: "system-admin",
      issuer: "rentifypro-admin-api",
      audience: "rentifypro-admin-password-reset",
    });
  } catch {
    return response.status(400).json({ message: "Your password reset session is invalid or expired." });
  }

  try {
    await connectDatabase();
    const account = await getAdminAccount(true);
    if (
      !account || payload?.purpose !== "admin_password_reset" || payload?.email !== email ||
      Number(payload?.sessionVersion) !== Number(account.sessionVersion)
    ) {
      return response.status(400).json({ message: "Your password reset session is invalid or expired." });
    }

    account.passwordHash = await bcrypt.hash(newPassword, 12);
    account.sessionVersion += 1;
    await account.save();
    await AdminSession.updateMany({ adminKey: account.key, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await AdminPasswordReset.deleteMany({ email });
    clearSessionCookie(response);
    await AdminMfaChallenge.deleteMany({ email });
    await recordAdminAudit({
      request,
      admin: account,
      action: "admin.password.changed",
      targetType: "admin_account",
      targetId: account.key,
      targetLabel: account.email,
      summary: "Super Admin password was reset and all prior sessions were revoked.",
    });
    return response.json({ message: "Password reset successful. You can now log in with your new password." });
  } catch (error) {
    console.error("Admin password reset failed:", error.message);
    return response.status(503).json({ message: "Password recovery is temporarily unavailable." });
  }
});

app.use("/api/admin", createAdminDataRouter({ requireAdminSession }));

app.get("/api/health", (_request, response) => {
  const databaseStates = ["disconnected", "connected", "connecting", "disconnecting"];
  response.json({
    status: "ok",
    database: databaseStates[mongoose.connection.readyState] ?? "unknown",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/ready", rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false }), async (_request, response) => {
  const storage = await checkAdminStorage();
  let database = false;
  if (mongoose.connection.readyState === 1) {
    try { await mongoose.connection.db.command({ ping: 1 }, { maxTimeMS: 2000 }); database = true; } catch { /* Readiness is false until MongoDB responds. */ }
  }
  const ready = database && storage.ready && !recoveryStatus.failed;
  response.status(ready ? 200 : 503).json({ status: ready ? "ready" : "unavailable", database, storage,
    recovery: recoveryStatus, timestamp: new Date().toISOString() });
});

app.use((_request, response) => response.status(404).json({ message: "Route not found" }));

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(error.status || 500).json({
    message: process.env.NODE_ENV === "production" && !error.expose ? "Internal server error" : error.message,
    ...(error.expose ? { code: error.code } : {}),
  });
});

async function startServer() {
  if (!bootstrapAdminEmail || (!configuredPasswordHash && !bootstrapAdminPassword) || !jwtSecret) {
    console.warn("Admin authentication is not fully configured in backend/.env.");
  }

  app.listen(port, () => console.log(`RentifyPro API listening on http://localhost:${port}`));

  if (getMongoConnectionConfig().uri) {
    connectDatabase()
      .then(async () => {
        await ensureAdminAccount();
        startAdminRecoveryJob();
        console.log(`Connected to the shared RentifyPro MongoDB database: ${mongoose.connection.name}`);
      })
      .catch((error) => console.error("MongoDB connection failed:", error.message));
  } else {
    console.warn("No MongoDB URI is set; starting without a database connection");
  }
}

startServer().catch((error) => {
  console.error("Unable to start the API:", error);
  process.exitCode = 1;
});
