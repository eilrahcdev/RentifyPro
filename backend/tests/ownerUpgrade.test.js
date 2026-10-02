import test from "node:test";
import assert from "node:assert/strict";

import User from "../models/User.js";
import KycVerification from "../models/KycVerification.js";
import PreKycDocument from "../models/PreKycDocument.js";
import { issuePreKycSession } from "../utils/preKycSession.js";
import { upgradeToOwner } from "../controllers/auth.controller.js";

test("owner upgrade marks a verified owner as approved for vehicle listing", async (t) => {
  const previousSecret = process.env.PRE_KYC_SESSION_SECRET;
  process.env.PRE_KYC_SESSION_SECRET = "test-only-pre-kyc-secret-with-enough-entropy";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.PRE_KYC_SESSION_SECRET;
    else process.env.PRE_KYC_SESSION_SECRET = previousSecret;
  });

  const user = {
    _id: "507f1f77bcf86cd799439011",
    email: "owner@example.com",
    role: "user",
    isVerified: true,
    kycStatus: "not_started",
    save: async () => {},
  };
  const kycWrites = [];

  t.mock.method(User, "findById", async () => user);
  t.mock.method(PreKycDocument, "find", (query) => ({
    select: async () => (query.status === "verified" ? [{ docType: "supporting", status: "verified" }] : []),
  }));
  t.mock.method(KycVerification, "findOneAndUpdate", async (...args) => {
    kycWrites.push(args);
  });

  const session = issuePreKycSession({ email: user.email, role: "owner" });
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  await upgradeToOwner(
    {
      user: { _id: user._id },
      body: { preKycToken: session.token, ownerType: "individual" },
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(user.role, "owner");
  assert.equal(user.kycStatus, "approved");
  assert.ok(user.kycStatusUpdatedAt instanceof Date);
  assert.equal(response.body.user.kycStatus, "approved");
  assert.equal(kycWrites.length, 1);
  assert.equal(kycWrites[0][1].status, "approved");
});
