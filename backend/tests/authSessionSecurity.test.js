import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET ||= "auth-session-security-test-secret";
process.env.PASSWORD_RESET_TOKEN_SECRET ||= process.env.JWT_SECRET;

const { logoutUser, verifyPasswordResetOTP, resetPassword, changePassword } = await import("../controllers/auth.controller.js");
const { protect } = await import("../middleware/auth.middleware.js");
const { hashAuthToken } = await import("../utils/authTokenRevocation.js");
const { default: RevokedSession } = await import("../models/RevokedSession.js");
const { default: User } = await import("../models/User.js");
const { default: Otp } = await import("../models/Otp.js");

const userId = "507f1f77bcf86cd799439011";
const response = () => ({
  statusCode: 200,
  body: null,
  cookies: [],
  clearedCookies: [],
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  cookie(name, value, options) { this.cookies.push({ name, value, options }); return this; },
  clearCookie(name, options) { this.clearedCookies.push({ name, options }); return this; },
});

test("logout persists only a token hash and protected routes reject its replay", async () => {
  const originalCreate = RevokedSession.create;
  const originalExists = RevokedSession.exists;
  const saved = [];
  const token = jwt.sign({ id: userId, role: "user", sessionVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

  try {
    RevokedSession.create = async (record) => { saved.push(record); return record; };
    RevokedSession.exists = async ({ tokenHash, expiresAt }) =>
      saved.some((record) => record.tokenHash === tokenHash && record.expiresAt > expiresAt.$gt);

    const logoutResponse = response();
    await logoutUser({ cookies: { token }, user: { _id: userId } }, logoutResponse);
    assert.equal(logoutResponse.statusCode, 200);
    assert.equal(logoutResponse.clearedCookies[0].name, "token");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].tokenHash, hashAuthToken(token));
    assert.equal(JSON.stringify(saved).includes(token), false);

    const protectedResponse = response();
    await protect({ cookies: { token }, ip: "127.0.0.1" }, protectedResponse, () => assert.fail("revoked session passed"));
    assert.equal(protectedResponse.statusCode, 401);
    assert.match(protectedResponse.body.message, /Session expired/);
  } finally {
    RevokedSession.create = originalCreate;
    RevokedSession.exists = originalExists;
  }
});

test("logout does not report success or clear the cookie when revocation cannot be saved", async () => {
  const originalCreate = RevokedSession.create;
  const token = jwt.sign({ id: userId, role: "user", sessionVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

  try {
    RevokedSession.create = async () => { throw new Error("database unavailable"); };
    const logoutResponse = response();
    await logoutUser({ cookies: { token }, user: { _id: userId } }, logoutResponse);
    assert.equal(logoutResponse.statusCode, 500);
    assert.equal(logoutResponse.clearedCookies.length, 0);
  } finally {
    RevokedSession.create = originalCreate;
  }
});

test("a verified reset token works once and revokes older sessions", async () => {
  const originalFindOtp = Otp.findOne;
  const originalConsumeOtp = Otp.findOneAndDelete;
  const originalDeleteOtp = Otp.deleteMany;
  const originalFindOne = User.findOne;
  const originalUpdateOne = User.updateOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalFindById = User.findById;
  const originalExists = RevokedSession.exists;
  const account = {
    _id: userId,
    email: "renter@gmail.com",
    role: "user",
    isVerified: true,
    sessionVersion: 0,
    passwordResetTokenHash: null,
  };
  const oldSession = jwt.sign({ id: userId, role: "user", sessionVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
  let otpDeleted = false;

  try {
    Otp.findOne = async () => otpDeleted ? null : { _id: "reset-otp", expiresAt: new Date(Date.now() + 60_000) };
    Otp.findOneAndDelete = async (filter) => filter._id === "reset-otp" && !otpDeleted ? { _id: "reset-otp" } : null;
    Otp.deleteMany = async () => { otpDeleted = true; return { deletedCount: 1 }; };
    User.findOne = async () => account;
    User.updateOne = async (_filter, update) => {
      account.passwordResetTokenHash = update.$set.passwordResetTokenHash;
      return { matchedCount: 1 };
    };
    User.findOneAndUpdate = async (filter, update) => {
      if (filter.email !== account.email || filter.passwordResetTokenHash !== account.passwordResetTokenHash || !account.passwordResetTokenHash) return null;
      account.password = update.$set.password;
      account.passwordResetTokenHash = null;
      account.sessionVersion += update.$inc.sessionVersion;
      return account;
    };
    User.findById = () => ({ select: async () => account });
    RevokedSession.exists = async () => null;

    const verifyResponse = response();
    await verifyPasswordResetOTP({ body: { email: account.email, otp: "123456" } }, verifyResponse);
    assert.equal(verifyResponse.statusCode, 200);
    const resetToken = verifyResponse.body.resetToken;
    assert.ok(jwt.verify(resetToken, process.env.PASSWORD_RESET_TOKEN_SECRET).jti);
    assert.equal(account.passwordResetTokenHash, hashAuthToken(resetToken));
    assert.equal(otpDeleted, true);

    const resetRequest = { body: { email: account.email, token: resetToken, newPassword: "NewPassword1!" } };
    const resetResponse = response();
    await resetPassword(resetRequest, resetResponse);
    assert.equal(resetResponse.statusCode, 200);
    assert.equal(account.sessionVersion, 1);
    assert.equal(account.passwordResetTokenHash, null);
    assert.equal(await bcrypt.compare("NewPassword1!", account.password), true);

    const replayResponse = response();
    await resetPassword(resetRequest, replayResponse);
    assert.equal(replayResponse.statusCode, 400);
    assert.equal(account.sessionVersion, 1);

    const oldSessionResponse = response();
    await protect({ cookies: { token: oldSession }, ip: "127.0.0.1" }, oldSessionResponse, () => assert.fail("older session passed"));
    assert.equal(oldSessionResponse.statusCode, 401);
    assert.equal(oldSessionResponse.body.code, "SESSION_REVOKED");
  } finally {
    Otp.findOne = originalFindOtp;
    Otp.findOneAndDelete = originalConsumeOtp;
    Otp.deleteMany = originalDeleteOtp;
    User.findOne = originalFindOne;
    User.updateOne = originalUpdateOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    User.findById = originalFindById;
    RevokedSession.exists = originalExists;
  }
});

test("changing a password renews this browser while revoking older sessions", async () => {
  const originalFindById = User.findById;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalExists = RevokedSession.exists;
  const account = {
    _id: userId,
    role: "user",
    isVerified: true,
    sessionVersion: 0,
    password: await bcrypt.hash("OldPassword1!", 4),
    passwordResetTokenHash: "previous-reset-hash",
  };
  const oldSession = jwt.sign({ id: userId, role: "user", sessionVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

  try {
    User.findById = () => ({ select: async () => account });
    User.findOneAndUpdate = async (filter, update) => {
      if (filter.password !== account.password) return null;
      account.password = update.$set.password;
      account.passwordResetTokenHash = null;
      account.sessionVersion += update.$inc.sessionVersion;
      return account;
    };
    RevokedSession.exists = async () => null;

    const changedResponse = response();
    await changePassword({ body: { currentPassword: "OldPassword1!", newPassword: "NewPassword1!" }, user: account }, changedResponse);
    assert.equal(changedResponse.statusCode, 200);
    assert.equal(account.sessionVersion, 1);
    assert.equal(account.passwordResetTokenHash, null);
    assert.equal(changedResponse.cookies[0].name, "token");
    assert.equal(jwt.verify(changedResponse.cookies[0].value, process.env.JWT_SECRET).sessionVersion, 1);

    const oldResponse = response();
    await protect({ cookies: { token: oldSession }, ip: "127.0.0.1" }, oldResponse, () => assert.fail("older session passed"));
    assert.equal(oldResponse.body.code, "SESSION_REVOKED");

    const renewedResponse = response();
    let allowed = false;
    await protect({ cookies: { token: changedResponse.cookies[0].value }, ip: "127.0.0.1" }, renewedResponse, () => { allowed = true; });
    assert.equal(allowed, true);
  } finally {
    User.findById = originalFindById;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    RevokedSession.exists = originalExists;
  }
});
