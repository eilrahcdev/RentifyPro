import test from "node:test";
import assert from "node:assert/strict";
import { confirmSignIn } from "../src/utils/confirmSignIn.js";

for (const role of ["user", "owner", "admin"]) {
  for (const kycStatus of ["approved", "challenge_passed", "rejected"]) {
    test(`${role} sign-in confirms its cookie session independently of ${kycStatus} identity status`, async () => {
      const user = { _id: "fixture", role, kycStatus, isVerified: true };
      const confirmed = await confirmSignIn(user, async ({ signal }) => {
        assert.ok(signal instanceof AbortSignal);
        return { user: { ...user, name: "Current profile" } };
      });
      assert.equal(confirmed.name, "Current profile");
      assert.equal(confirmed.kycStatus, kycStatus);
    });
  }
}

test("a successful login response cannot confirm a session when the cookie is missing", async () => {
  await assert.rejects(confirmSignIn({ _id: "fixture", role: "user" }, async () => {
    throw Object.assign(new Error("Please log in."), { status: 401 });
  }), error => error.code === "SESSION_CONFIRMATION_FAILED" && /browser could not keep/.test(error.message));
});

test("profile failures never become a successful sign-in", async () => {
  const user = { _id: "fixture", role: "user", isVerified: true };
  for (const profile of [null, {}, { ...user, _id: "another-user" }, { ...user, role: "owner" },
    { ...user, isVerified: false }, { ...user, isDisabled: true }, { ...user, isArchived: true }]) {
    await assert.rejects(confirmSignIn(user, async () => ({ user: profile })), { code: "SESSION_CONFIRMATION_FAILED" });
  }
  for (const status of [0, 500]) await assert.rejects(confirmSignIn(user, async () => {
    throw Object.assign(new Error("Unavailable"), { status });
  }), { code: "SESSION_CONFIRMATION_FAILED" });
});

test("session confirmation preserves the existing rate-limit response", async () => {
  const limited = Object.assign(new Error("Too many requests"), { status: 429, retryAfterSeconds: 60 });
  await assert.rejects(confirmSignIn({ _id: "fixture", role: "user" }, async () => { throw limited; }), error => error === limited);
});
