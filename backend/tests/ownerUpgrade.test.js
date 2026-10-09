import test from "node:test";
import assert from "node:assert/strict";
import User from "../models/User.js";
import KycVerification from "../models/KycVerification.js";
import PreKycDocument from "../models/PreKycDocument.js";
import { issuePreKycSession } from "../utils/preKycSession.js";
import { upgradeToOwner } from "../controllers/auth.controller.js";
import { securityHeaders } from "../middleware/security.middleware.js";

function fixture(t, { userChanges = {}, documentChanges = {}, bodyChanges = {}, documentMissing = false, accountChanged = false } = {}) {
  const previousSecret = process.env.PRE_KYC_SESSION_SECRET;
  process.env.PRE_KYC_SESSION_SECRET = "test-only-pre-kyc-secret-with-enough-entropy";
  t.after(() => { if (previousSecret === undefined) delete process.env.PRE_KYC_SESSION_SECRET; else process.env.PRE_KYC_SESSION_SECRET = previousSecret; });
  const approvedAt = new Date("2026-08-25T16:49:11.832Z");
  const user = { _id: "507f1f77bcf86cd799439011", name: "Fixture Renter", email: "fixture@example.test", role: "user",
    isVerified: true, kycStatus: "approved", kycStatusUpdatedAt: approvedAt, ...userChanges };
  const document = { status: "verified", docType: "supporting", selectedDocCategory: "DTI Business Name Registration", reviewVersion: "fixture-revision",
    expiresAt: new Date(Date.now() + 3600000), profileSnapshot: { full_name: user.name, business_name: "Fixture Motors", permit_number: "DTI-123" }, ...documentChanges };
  const writes = [];
  t.mock.method(User, "findById", async () => user);
  t.mock.method(User, "updateOne", async () => { throw new Error("Unexpected identity summary write"); });
  t.mock.method(User, "findOneAndUpdate", async (filter, update, options) => {
    writes.push({ filter, update, options }); return accountChanged ? null : { ...user, ...update.$set };
  });
  t.mock.method(KycVerification, "findOne", () => ({ select: async () => null }));
  t.mock.method(KycVerification, "findOneAndUpdate", async () => { throw new Error("Upgrade must not overwrite identity history"); });
  const lookups = [];
  t.mock.method(PreKycDocument, "findOne", (query) => { lookups.push(query); return { select: async () => documentMissing ? null : document }; });
  const session = issuePreKycSession({ email: user.email, role: "owner" });
  const body = { preKycToken: session.token, ownerType: "individual", businessName: "Fixture Motors", permitNumber: "DTI-123",
    supportingDocType: document.selectedDocCategory, supportingDocRevision: "fixture-revision", ...bodyChanges };
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  return { user, approvedAt, document, writes, lookups, session, response, run: () => upgradeToOwner({ user: { _id: user._id }, body }, response) };
}

test("owner upgrade changes the role and preserves original identity approval and booking identity", async (t) => {
  const f = fixture(t); await f.run();
  assert.equal(f.response.statusCode, 200); assert.equal(f.response.body.user.role, "owner");
  assert.equal(f.response.body.user._id, f.user._id); assert.equal(f.response.body.user.kycStatus, "approved");
  assert.equal(f.writes.length, 1); assert.equal(f.user.kycStatusUpdatedAt, f.approvedAt);
  assert.deepEqual(Object.keys(f.writes[0].update.$set).sort(), ["businessName", "licenseNumber", "ownerType", "permitNumber", "role"]);
  assert.equal(f.writes[0].filter.kycStatusUpdatedAt, f.approvedAt);
  assert.equal(f.writes[0].filter.isDisabled.$ne, true); assert.equal(f.writes[0].options.runValidators, true);
  assert.deepEqual(f.lookups[0], { email: f.user.email, role: "owner", sessionId: f.session.sessionId, docType: "supporting" });
});

for (const [name, options, status] of [
  ["unverified email", { userChanges: { isVerified: false } }, 403],
  ["identity not started", { userChanges: { kycStatus: "not_started" } }, 403],
  ["rejected identity", { userChanges: { kycStatus: "rejected" } }, 403],
  ["admin role", { userChanges: { role: "admin" } }, 403],
  ["disabled account", { userChanges: { isDisabled: true } }, 403],
  ["archived account", { userChanges: { isArchived: true } }, 403],
  ["missing owner type", { bodyChanges: { ownerType: "" } }, 400],
  ["missing document session without ending the login session", { bodyChanges: { preKycToken: "" } }, 409],
  ["invalid document session without ending the login session", { bodyChanges: { preKycToken: "invalid-session" } }, 409],
  ["invalid owner type", { bodyChanges: { ownerType: "other" } }, 400],
  ["missing business name", { bodyChanges: { businessName: "" } }, 400],
  ["overlong license number", { bodyChanges: { licenseNumber: "X".repeat(51) } }, 400],
  ["missing supporting document", { documentMissing: true }, 400],
  ["pending review", { documentChanges: { status: "pending_review" } }, 409],
  ["queued review", { documentChanges: { status: "queued" } }, 409],
  ["rejected document", { documentChanges: { status: "rejected" } }, 409],
  ["tampered document", { documentChanges: { suspectedTampering: true } }, 409],
  ["expired document before TTL cleanup", { documentChanges: { expiresAt: new Date(0) } }, 409],
  ["document without expiry", { documentChanges: { expiresAt: null } }, 409],
  ["stale document revision", { documentChanges: { reviewVersion: "replacement-revision" } }, 409],
  ["missing document revision", { bodyChanges: { supportingDocRevision: "" } }, 409],
  ["changed business name", { bodyChanges: { businessName: "Unreviewed Business" } }, 409],
  ["changed permit number", { bodyChanges: { permitNumber: "DTI-999" } }, 409],
  ["changed identity name", { documentChanges: { profileSnapshot: { full_name: "Someone Else", business_name: "Fixture Motors", permit_number: "DTI-123" } } }, 409],
  ["changed document type", { bodyChanges: { supportingDocType: "SEC Certificate of Registration" } }, 409],
  ["missing required document number", { bodyChanges: { permitNumber: "" } }, 400],
]) {
  test("owner upgrade blocks " + name + " without changing the account", async (t) => {
    const f = fixture(t, options); await f.run(); assert.equal(f.response.statusCode, status, f.response.body.message);
    assert.equal(f.writes.length, 0); assert.equal(f.user.role, options.userChanges?.role || "user");
  });
}

test("a concurrent account decision prevents the guarded role update", async (t) => {
  const f = fixture(t, { accountChanged: true }); await f.run();
  assert.equal(f.response.statusCode, 409); assert.equal(f.response.body.code, "ACCOUNT_CHANGED");
});

test("already upgraded accounts are idempotent and never repeat KYC writes", async (t) => {
  const f = fixture(t, { userChanges: { role: "owner" } }); await f.run();
  assert.equal(f.response.statusCode, 200); assert.equal(f.writes.length, 0); assert.equal(f.lookups.length, 0);
});

test("BIR upgrades compare TIN and branch code with the reviewed snapshot", async (t) => {
  const snapshot = { full_name: "Fixture Renter", business_name: "Fixture Motors", permit_number: "", tax_identification_number: "123456789", branch_code: "00000" };
  const f = fixture(t, { documentChanges: { selectedDocCategory: "BIR Certificate of Registration (Form 2303)", profileSnapshot: snapshot },
    bodyChanges: { permitNumber: "", taxIdentificationNumber: "123456789", branchCode: "00001" } });
  await f.run(); assert.equal(f.response.statusCode, 409); assert.equal(f.writes.length, 0);
});

test("a matching BIR document accepts its TIN and branch code without storing raw tax identifiers", async (t) => {
  const snapshot = { full_name: "Fixture Renter", business_name: "Fixture Motors", permit_number: "", tax_identification_number: "123456789", branch_code: "00000" };
  const f = fixture(t, { documentChanges: { selectedDocCategory: "BIR Certificate of Registration (Form 2303)", profileSnapshot: snapshot },
    bodyChanges: { permitNumber: "", taxIdentificationNumber: "123456789", branchCode: "00000" } });
  await f.run(); assert.equal(f.response.statusCode, 200);
  assert.equal("taxIdentificationNumber" in f.writes[0].update.$set, false);
});

test("document preview policy allows local PDF frames and keeps object embeds disabled", () => {
  const headers = new Map();
  let continued = false;
  securityHeaders({ headers: {} }, { setHeader: (name, value) => headers.set(name.toLowerCase(), value),
    removeHeader: (name) => headers.delete(name.toLowerCase()) }, () => { continued = true; });
  assert.equal(continued, true);
  const policy = headers.get("content-security-policy");
  assert.match(policy, /frame-src 'self' blob:/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /default-src 'self'/);
});
