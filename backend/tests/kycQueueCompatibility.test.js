import test from "node:test";
import assert from "node:assert/strict";

import PreKycDocument from "../models/PreKycDocument.js";
import User from "../models/User.js";

test("document queue supports legacy decisions and the new processing states", () => {
  const allowed = PreKycDocument.schema.path("status").enumValues;
  for (const status of [
    "queued",
    "processing",
    "retry_wait",
    "pending_review",
    "reupload_required",
    "verified",
    "rejected",
  ]) {
    assert.equal(allowed.includes(status), true, `${status} must remain supported`);
  }
});

test("existing approved users remain valid after the queued workflow is introduced", async () => {
  const allowed = User.schema.path("kycStatus").enumValues;
  assert.equal(allowed.includes("approved"), true);

  const existingUser = new User({
    name: "Existing Verified User",
    email: "existing-verified@example.com",
    password: "already-hashed-for-schema-validation",
    role: "user",
    kycStatus: "approved",
  });
  await assert.doesNotReject(existingUser.validate());
  assert.equal(existingUser.kycStatus, "approved");
});
