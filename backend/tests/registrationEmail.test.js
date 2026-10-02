import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import User from "../models/User.js";
import { issuePreKycSession } from "../utils/preKycSession.js";

// Enable the actual limiter before importing the route's middleware.
process.env.ENABLE_RATE_LIMIT = "true";
const { checkRegistrationEmail, registerUser } = await import("../controllers/auth.controller.js");
const { validateRegister, validateRegistrationEmail } = await import("../middleware/validate.middleware.js");
const { authLimiter } = await import("../middleware/security.middleware.js");
const { default: authRoutes } = await import("../routes/auth.routes.js");

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("early email validation matches final registration and rejects non-string query inputs", () => {
  for (const email of [undefined, null, 42, [], { $ne: "" }, "", "a b@gmail.com", "invalid", "a@unsupported.test", "a".repeat(255) + "@gmail.com", "🙂@gmail.com"]) {
    const early = response();
    let next = false;
    validateRegistrationEmail({ body: { email } }, early, () => { next = true; });
    assert.equal(next, false);
    assert.equal(early.statusCode, 400);
    const final = response();
    validateRegister({ body: { name: "Test User", email, password: "Example123!" } }, final, () => {});
    assert.equal(early.body.errors.email, final.body.errors.email);
  }
});

test("availability normalizes case/whitespace and queries only email", async (t) => {
  const req = { body: { email: "  New.User@GMAIL.COM  ", role: "owner", isVerified: true } };
  validateRegistrationEmail(req, response(), () => {});
  assert.equal(req.body.email, "new.user@gmail.com");
  t.mock.method(User, "exists", async query => {
    assert.deepEqual(query, { email: "new.user@gmail.com" });
    return null;
  });
  const res = response();
  await checkRegistrationEmail(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, available: true });
});

test("all existing accounts block registration without disclosing their role or verification status", async (t) => {
  for (const role of ["user", "owner", "admin"]) {
    for (const isVerified of [false, true]) {
      const account = { _id: "fixture", role, isVerified, email: "used@gmail.com" };
      const exists = t.mock.method(User, "exists", async query => account.email === query.email ? { _id: account._id } : null);
      const res = response();
      await checkRegistrationEmail({ body: { email: account.email } }, res);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, "EMAIL_ALREADY_REGISTERED");
      assert.deepEqual(Object.keys(res.body).sort(), ["code", "errors", "message", "success"]);
      assert.ok(res.body.errors.email.includes("already registered"));
      exists.mock.restore();
    }
  }
});

test("database failure cannot claim availability or expose database errors", async (t) => {
  t.mock.method(User, "exists", async () => { throw new Error("fixture database unavailable"); });
  const res = response();
  await checkRegistrationEmail({ body: { email: "new@gmail.com" } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.available, undefined);
  assert.ok(!res.body.message.includes("database"));
});

test("final registration still rejects an email claimed after the early check", async (t) => {
  t.mock.method(User, "exists", async () => null);
  const early = response();
  await checkRegistrationEmail({ body: { email: "racing@gmail.com" } }, early);
  assert.equal(early.body.available, true);
  t.mock.method(User, "findOne", async query => {
    assert.deepEqual(query, { email: "racing@gmail.com" });
    return { _id: "another-account", isVerified: true };
  });
  const oldSecret = process.env.PRE_KYC_SESSION_SECRET;
  process.env.PRE_KYC_SESSION_SECRET = "registration-email-test-secret";
  try {
    const { token } = issuePreKycSession({ email: "racing@gmail.com", role: "user" });
    const final = response();
    await registerUser({ body: { name: "Test User", email: "racing@gmail.com", password: "Example123!", preKycToken: token }, ip: "127.0.0.1" }, final);
    assert.equal(final.statusCode, 409);
    assert.equal(final.body.errors.email, "This email is already registered.");
    assert.equal(User.schema.path("email").options.unique, true);
  } finally {
    if (oldSecret === undefined) delete process.env.PRE_KYC_SESSION_SECRET;
    else process.env.PRE_KYC_SESSION_SECRET = oldSecret;
  }
});

test("HTTP endpoint has no-cache errors and an independent IP budget counting every result", async (t) => {
  let queries = 0;
  t.mock.method(User, "exists", async ({ email }) => {
    queries++;
    return email === "used@gmail.com" ? { _id: "fixture" } : null;
  });
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authLimiter, authRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/auth/check-registration-email`;
    const post = email => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const invalid = await post({ $ne: "" });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get("cache-control"), "no-store");
    assert.equal(queries, 0);
    // More than ten duplicate checks must not exhaust the shared email auth budget.
    for (let i = 0; i < 12; i++) assert.equal((await post("used@gmail.com")).status, 409);
    for (let i = 0; i < 7; i++) assert.equal((await post(`new${i}@gmail.com`)).status, 200);
    const limited = await post("another@gmail.com");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("cache-control"), "no-store");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal(queries, 19);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
