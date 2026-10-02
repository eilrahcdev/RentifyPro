import test from "node:test";
import assert from "node:assert/strict";

import {
  issuePreKycSession,
  renewPreKycSession,
  verifyPreKycSession,
} from "../utils/preKycSession.js";
import { requireKyc } from "../middleware/rbac.middleware.js";
import { requirePreKycSession } from "../middleware/preKycSession.middleware.js";
import KycVerification from "../models/KycVerification.js";
import User from "../models/User.js";

const originalSecret = process.env.PRE_KYC_SESSION_SECRET;
const originalTtl = process.env.PRE_KYC_SESSION_TTL;

test.before(() => {
  process.env.PRE_KYC_SESSION_SECRET = "test-only-pre-kyc-secret-with-enough-entropy";
  process.env.PRE_KYC_SESSION_TTL = "20m";
});

test.after(() => {
  if (originalSecret === undefined) delete process.env.PRE_KYC_SESSION_SECRET;
  else process.env.PRE_KYC_SESSION_SECRET = originalSecret;
  if (originalTtl === undefined) delete process.env.PRE_KYC_SESSION_TTL;
  else process.env.PRE_KYC_SESSION_TTL = originalTtl;
});

test("pre-KYC tokens bind email, role, and one attempt id", () => {
  const issued = issuePreKycSession({ email: " Person@Example.com ", role: "owner" });
  const verified = verifyPreKycSession(issued.token, {
    email: "person@example.com",
    role: "owner",
  });

  assert.equal(verified.email, "person@example.com");
  assert.equal(verified.role, "owner");
  assert.equal(verified.sessionId, issued.sessionId);
  assert.throws(
    () => verifyPreKycSession(issued.token, { email: "other@example.com", role: "owner" }),
    /does not match this email/i
  );
  assert.throws(
    () => verifyPreKycSession(issued.token, { email: "person@example.com", role: "user" }),
    /does not match this account type/i
  );
});

test("renewing a signed attempt retains its attempt id", () => {
  const issued = issuePreKycSession({ email: "person@example.com", role: "user" });
  const renewed = renewPreKycSession(issued.token, {
    email: "person@example.com",
    role: "user",
  });
  assert.equal(renewed.sessionId, issued.sessionId);
  assert.equal(verifyPreKycSession(renewed.token).sessionId, issued.sessionId);
});

test("pre-KYC middleware accepts a bodyless status request", () => {
  const issued = issuePreKycSession({ email: "person@example.com", role: "user" });
  const request = { headers: { "x-pre-kyc-token": issued.token } };
  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  let nextCalls = 0;

  requirePreKycSession(request, response, () => { nextCalls += 1; });

  assert.equal(nextCalls, 1);
  assert.equal(request.preKyc.email, "person@example.com");
  assert.equal(request.preKyc.sessionId, issued.sessionId);
  assert.deepEqual(request.body, { email: "person@example.com", role: "user" });
  assert.equal(response.payload, null);
});

test("pre-KYC middleware does not expose unexpected internal errors", () => {
  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  const request = {
    get body() { throw new Error("internal implementation detail"); },
  };

  requirePreKycSession(request, response, () => {});

  assert.equal(response.statusCode, 500);
  assert.equal(response.payload.success, false);
  assert.equal(response.payload.message, "We couldn't check your verification session right now. Please try again.");
  assert.equal(response.payload.message.includes("internal implementation detail"), false);
});

test("KYC middleware blocks unapproved users and lets approved users and admins through", async () => {
  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  let nextCalls = 0;
  const next = () => { nextCalls += 1; };

  await requireKyc({ user: { role: "user", kycStatus: "not_started" } }, response, next);
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.code, "IDENTITY_VERIFICATION_REQUIRED");
  assert.equal(nextCalls, 0);

  await requireKyc({ user: { role: "user", kycStatus: "approved" } }, response, next);
  await requireKyc({ user: { role: "admin", kycStatus: "not_started" } }, response, next);
  assert.equal(nextCalls, 2);
});

test("KYC middleware repairs a stale owner summary only from an approved KYC case", async (t) => {
  const approvedAt = new Date("2026-09-19T00:00:00.000Z");
  const owner = { _id: "507f1f77bcf86cd799439011", role: "owner", kycStatus: "not_started" };
  const writes = [];
  t.mock.method(KycVerification, "findOne", () => ({ select: async () => ({ updatedAt: approvedAt }) }));
  t.mock.method(User, "updateOne", async (filter, update) => {
    writes.push({ filter, update });
    return { matchedCount: 1 };
  });
  const response = { status() { return this; }, json(payload) { this.payload = payload; return this; } };
  let nextCalls = 0;

  await requireKyc({ user: owner }, response, () => { nextCalls += 1; });

  assert.equal(nextCalls, 1);
  assert.equal(owner.kycStatus, "approved");
  assert.equal(owner.kycStatusUpdatedAt, approvedAt);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].update.$set.kycStatus, "approved");
});
