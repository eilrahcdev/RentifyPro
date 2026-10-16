import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";

process.env.JWT_SECRET ||= "email-verification-recovery-test-secret";
process.env.SMTP_USER = "smtp-fixture@example.com";
process.env.SMTP_PASS = "fixture-only";

const { loginUser, sendOTP, verifyOTP } = await import("../controllers/auth.controller.js");
const { default: User } = await import("../models/User.js");
const { default: Otp } = await import("../models/Otp.js");
const { default: LoginChallenge } = await import("../models/LoginChallenge.js");

const response = () => ({
  statusCode: 200, body: null, cookies: [], headers: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  cookie(...args) { this.cookies.push(args); return this; },
  clearCookie() {},
  setHeader(name, value) { this.headers[name] = value; },
});
const email = "legacy@example.com";
const account = () => ({ _id: "507f1f77bcf86cd799439011", email, role: "user", isVerified: false, kycStatus: "pending_review" });

for (const role of ["user", "owner"]) test(`legacy ${role} recovery verifies only the email, consumes its code, and issues no session`, async () => {
  const originals = [Otp.findOne, Otp.deleteMany, User.findOneAndUpdate];
  const user = { ...account(), role };
  let consumed = false;
  try {
    Otp.findOne = async filter => {
      assert.equal(filter.purpose, "verification");
      assert.equal(filter.email, email);
      return !consumed && filter.otp === "123456" ? { expiresAt: new Date(Date.now() + 60000) } : null;
    };
    Otp.deleteMany = async filter => { assert.equal(filter.purpose, "verification"); consumed = true; };
    User.findOneAndUpdate = async (filter, update) => {
      assert.deepEqual(filter, { email });
      assert.deepEqual(update, { isVerified: true });
      Object.assign(user, update);
      return user;
    };
    const res = response();
    await verifyOTP({ body: { email: " LEGACY@EXAMPLE.COM ", otp: "123456", signIn: false } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.isVerified, true);
    assert.equal(user.kycStatus, "pending_review");
    assert.equal(user.role, role);
    assert.equal(res.cookies.length, 0);
    assert.equal(consumed, true);
    const replay = response();
    await verifyOTP({ body: { email, otp: "123456", signIn: false } }, replay);
    assert.equal(replay.statusCode, 400);
  } finally { [Otp.findOne, Otp.deleteMany, User.findOneAndUpdate] = originals; }
});

test("existing account-settings verification still issues its session", async () => {
  const originals = [Otp.findOne, Otp.deleteMany, User.findOneAndUpdate];
  try {
    Otp.findOne = async () => ({ expiresAt: new Date(Date.now() + 60000) });
    Otp.deleteMany = async () => {};
    User.findOneAndUpdate = async () => ({ ...account(), isVerified: true });
    const res = response();
    await verifyOTP({ body: { email, otp: "123456" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.cookies.length, 1);
    assert.equal(res.cookies[0][0], "token");
  } finally { [Otp.findOne, Otp.deleteMany, User.findOneAndUpdate] = originals; }
});

test("invalid, expired, missing, and wrong-purpose codes cannot verify an account", async () => {
  const originals = [Otp.findOne, Otp.deleteMany, User.findOneAndUpdate];
  try {
    User.findOneAndUpdate = async () => assert.fail("invalid code updated the account");
    Otp.deleteMany = async () => {};
    for (const record of [null, { expiresAt: new Date(Date.now() - 1000) }]) {
      Otp.findOne = async filter => { assert.equal(filter.purpose, "verification"); return record; };
      const res = response();
      await verifyOTP({ body: { email, otp: "123456", signIn: false } }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.cookies.length, 0);
    }
    const res = response();
    await verifyOTP({ body: { email, signIn: false } }, res);
    assert.equal(res.statusCode, 400);
  } finally { [Otp.findOne, Otp.deleteMany, User.findOneAndUpdate] = originals; }
});

test("unverified login remains blocked after a valid password and captcha", async () => {
  const originals = [User.findOne, LoginChallenge.findOne];
  const answerHash = await bcrypt.hash("5", 4);
  try {
    LoginChallenge.findOne = () => ({ select: async () => ({ answerHash, attempts: 0, maxAttempts: 5, save: async () => {} }) });
    User.findOne = () => ({ select: async () => ({ ...account(), matchPassword: async () => true }) });
    const res = response();
    await loginUser({ body: { email, password: "ValidPass1!", captchaId: "fixture", captchaAnswer: "5" }, ip: "127.0.0.1" }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "EMAIL_VERIFICATION_REQUIRED");
    assert.match(res.body.errors.email, /verify your email/);
    assert.equal(res.cookies.length, 0);
  } finally { [User.findOne, LoginChallenge.findOne] = originals; }
});

test("send and resend preserve cooldowns and report SMTP failure truthfully", async () => {
  const originals = [User.findOne, Otp.findOne, Otp.create, Otp.deleteMany, nodemailer.createTransport];
  let sent = 0, failSend = false, existing = null;
  try {
    User.findOne = async () => account();
    Otp.findOne = () => ({ select: async () => existing });
    Otp.deleteMany = async () => {};
    Otp.create = async record => { assert.equal(record.purpose, "verification"); assert.match(record.otp, /^\d{6}$/); };
    nodemailer.createTransport = () => ({ sendMail: async () => { sent += 1; if (failSend) throw new Error("fixture SMTP unavailable"); } });
    const success = response();
    await sendOTP({ body: { email } }, success);
    assert.equal(success.body.success, true);
    assert.equal(sent, 1);
    existing = { lastSentAt: new Date() };
    const limited = response();
    await sendOTP({ body: { email } }, limited);
    assert.equal(limited.statusCode, 429);
    assert.ok(limited.body.retryAfterSeconds > 0);
    assert.equal(sent, 1);
    existing = null; failSend = true;
    const failed = response();
    await sendOTP({ body: { email } }, failed);
    assert.equal(failed.statusCode, 500);
    assert.equal(failed.body.success, false);
  } finally { [User.findOne, Otp.findOne, Otp.create, Otp.deleteMany, nodemailer.createTransport] = originals; }
});
