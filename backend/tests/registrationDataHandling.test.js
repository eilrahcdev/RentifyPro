import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import AdminCredential from "../models/AdminCredential.js";
import AdminAuditLog from "../models/AdminAuditLog.js";
import { createAdminDataRouter } from "../routes/adminData.routes.js";
import { accountVerification, ownedDocumentFilter, ownedFaceFilter } from "../services/adminDomain.service.js";

const same = (left, right) => left == null && right == null || String(left) === String(right);
const matches = (row, query) => Object.entries(query).every(([key, value]) => {
  if (key === "$or") return value.some(item => matches(row, item));
  if (key === "$and") return value.every(item => matches(row, item));
  const actual = row[key];
  if (value instanceof RegExp) return value.test(String(actual || ""));
  if (value && typeof value === "object" && !(value instanceof Date) && !(value instanceof mongoose.Types.ObjectId)) {
    return Object.entries(value).every(([operator, expected]) => {
      if (operator === "$in") return expected.some(item => same(actual, item));
      if (operator === "$ne") return !same(actual, expected);
      if (operator === "$gt") return actual != null && actual > expected;
      if (operator === "$not") return !expected.test(String(actual || ""));
      if (operator === "$type") return typeof actual === expected;
      throw new Error(`Unhandled fixture operator ${operator}`);
    });
  }
  return same(actual, value);
});

function fixture() {
  const user = { _id: new mongoose.Types.ObjectId(), name: "Synthetic Customer", email: "customer@example.test",
    role: "user", registrationDraftId: "submitted-draft", isVerified: true, kycStatus: "approved" };
  const kyc = { _id: new mongoose.Types.ObjectId(), user: user._id, status: "approved", registrationSessionId: "submitted-session",
    registrationDocumentVersions: { id: "current-id" }, idDocumentHash: "current-hash", challengePassedAt: new Date() };
  const identity = { _id: new mongoose.Types.ObjectId(), registeredUser: user._id, email: user.email, sessionId: kyc.registrationSessionId,
    docType: "id", status: "verified", reviewVersion: "current-id", fileHash: "current-hash", detailsMatched: true };
  return { users: [user], kyc_cases: [kyc], prekycdocuments: [identity], vehicles: [], bookings: [], reports: [] };
}

function databaseFor(rows) {
  return { collection: name => ({
    find(query = {}, { projection } = {}) {
      let result = (rows[name] || []).filter(row => matches(row, query));
      const cursor = {
        sort() { return cursor; },
        skip(count) { result = result.slice(count); return cursor; },
        limit(count) { result = result.slice(0, count); return cursor; },
        async toArray() { return result.map(row => projection
          ? Object.fromEntries(Object.entries(row).filter(([field]) => field === "_id" || projection[field])) : { ...row }); },
      };
      return cursor;
    },
    async findOne(query) { return (rows[name] || []).find(row => matches(row, query)) || null; },
    async countDocuments() { return 0; },
    async findOneAndUpdate(query, update) {
      const row = (rows[name] || []).find(item => matches(item, query));
      if (!row) return null;
      Object.assign(row, update.$set);
      for (const field of Object.keys(update.$unset || {})) delete row[field];
      return { ...row };
    },
    async updateOne(query, update) {
      const row = (rows[name] || []).find(item => matches(item, query));
      if (!row) return { modifiedCount: 0 };
      Object.assign(row, update.$set);
      for (const field of Object.keys(update.$unset || {})) delete row[field];
      return { modifiedCount: 1 };
    },
    async deleteMany(query) { rows[name] = (rows[name] || []).filter(row => !matches(row, query)); },
    async updateMany() {},
  }) };
}

async function invoke(t, rows, path, method = "get", request = {}, expectedStatus = 200) {
  const previous = mongoose.connection.db;
  mongoose.connection.db = databaseFor(rows);
  t.after(() => { mongoose.connection.db = previous; });
  t.mock.method(AdminAuditLog, "countDocuments", async () => 0);
  t.mock.method(AdminAuditLog, "create", async () => ({}));
  const router = createAdminDataRouter({ requireAdminSession: (_request, _response, next) => next() });
  const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]);
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, setHeader() {} };
  await route.route.stack[0].handle({ query: {}, ...request }, response, error => { throw error; });
  assert.equal(response.statusCode, expectedStatus, JSON.stringify(response.body));
  return response.body;
}

test("registration assistance never becomes a customer attachment through an email match", async t => {
  const rows = fixture();
  const assistance = { _id: new mongoose.Types.ObjectId(), registrationDraftId: "other-draft", sessionId: "other-session",
    email: rows.users[0].email, docType: "id", status: "pending_review", manualReviewRequestedAt: new Date(), expiresAt: new Date(Date.now() + 60000) };
  rows.prekycdocuments.push(assistance);
  const result = await invoke(t, rows, "/data");
  const mapped = result.documents.find(document => document.id === String(assistance._id));
  assert.equal(result.customers.length, 1);
  assert.equal(mapped.reviewPurpose, "Registration assistance");
  assert.equal(mapped.customerId, "");
  assert.equal(mapped.customerName, "");
  assert.equal(mapped.accountLink.status, "registration_incomplete");
  assert.equal(mapped.canApprove, false);
  assert.equal(result.documents[0].accountLink.customerId, String(rows.users[0]._id));
});

test("unrequested, cancelled, expired and incomplete assistance stays out of admin data", async t => {
  const rows = fixture();
  const base = { email: "applicant@example.test", registrationDraftId: "draft", sessionId: "draft-session",
    docType: "id", status: "pending_review", manualReviewRequestedAt: new Date(), expiresAt: new Date(Date.now() + 60000) };
  for (const change of [{ manualReviewRequestedAt: null }, { registrationCancelledAt: new Date() },
    { registrationExpiresAt: new Date(0) }, { expiresAt: new Date(0) }, { expiresAt: undefined }, { registeredUser: "invalid" }]) {
    rows.prekycdocuments.push({ ...base, ...change, _id: new mongoose.Types.ObjectId() });
  }
  const result = await invoke(t, rows, "/data");
  assert.deepEqual(result.documents.map(document => document.id), [String(rows.prekycdocuments[0]._id)]);
});

test("pending final decisions and requested assistance have separate actionable alerts", async t => {
  const rows = fixture();
  rows.prekycdocuments[0].status = "pending_review";
  rows.prekycdocuments.push({ _id: new mongoose.Types.ObjectId(), registrationDraftId: "draft", sessionId: "draft-session",
    email: "applicant@example.test", docType: "id", status: "pending_review", manualReviewRequestedAt: new Date(), expiresAt: new Date(Date.now() + 60000) });
  const { operationalAlerts } = await invoke(t, rows, "/data");
  assert.equal(operationalAlerts.find(alert => alert.id === "pending-documents").count, 1);
  const assistance = operationalAlerts.find(alert => alert.id === "registration-assistance");
  assert.equal(assistance.count, 1);
  assert.equal(assistance.context.purpose, "Registration assistance");
});

test("current customer verification is independent of historical documents and overview page size", async t => {
  const rows = fixture();
  const identity = rows.prekycdocuments[0];
  rows.prekycdocuments = Array.from({ length: 6 }, (_, index) => ({ ...identity,
    _id: new mongoose.Types.ObjectId(), sessionId: `old-${index}`, reviewVersion: `old-${index}`, status: "rejected" })).concat(identity);
  const result = await invoke(t, rows, "/data", "get", { query: { limit: "1" } });
  assert.equal(result.customers[0].status, "Active");
  assert.deepEqual(result.customers[0].verification.pendingReasons, []);
});

test("enabling a submitted customer retains current document and selfie verification", async t => {
  const rows = fixture();
  rows.users[0].isDisabled = true;
  const passwordHash = await bcrypt.hash("SyntheticAdmin1!", 4);
  t.mock.method(AdminCredential, "findOne", () => ({ select: async () => ({ passwordHash }) }));
  const result = await invoke(t, rows, "/customers/:id/status", "patch", {
    params: { id: String(rows.users[0]._id) }, adminAccount: { key: "synthetic-admin", email: "admin@example.test" },
    body: { disabled: false, adminPassword: "SyntheticAdmin1!", reason: "Synthetic account restoration check." },
  });
  assert.equal(result.customer.status, "Active");
  assert.equal(result.customer.verification.selfieVerified, true);
  assert.deepEqual(result.customer.verification.pendingReasons, []);
});

test("customer ownership filters preserve another unfinished registration with the same email", () => {
  const rows = fixture(), user = rows.users[0];
  const query = ownedDocumentFilter(user._id, user.email);
  assert.equal(matches({ email: user.email, sessionId: "different-draft", registrationDraftId: "different-draft" }, query), false);
  assert.equal(matches({ email: user.email, sessionId: "legacy-session" }, query), true);
  assert.equal(matches(rows.prekycdocuments[0], query), true);
  assert.equal(matches({ ...rows.prekycdocuments[0], registrationDraftId: "submitted-draft" }, query), true);
});

test("customer requirements use the pinned version and ignore cancelled evidence", () => {
  const rows = fixture(), user = rows.users[0], kyc = rows.kyc_cases[0], identity = rows.prekycdocuments[0];
  const replaced = { ...identity, reviewVersion: "old-version", status: "rejected" };
  assert.equal(accountVerification(user, kyc, [replaced, identity]).bookingEligible, true);
  assert.equal(accountVerification(user, kyc, [{ ...identity, registrationCancelledAt: new Date() }]).bookingEligible, false);
});

for (const state of ["missing", "archived", "administrator"]) test(`final decisions reject a ${state} customer link`, async t => {
  const rows = fixture();
  const document = rows.prekycdocuments[0];
  document.status = "pending_review";
  if (state === "missing") rows.users = [];
  else if (state === "archived") rows.users[0].isArchived = true;
  else rows.users[0].role = "admin";
  const passwordHash = await bcrypt.hash("SyntheticAdmin1!", 4);
  t.mock.method(AdminCredential, "findOne", () => ({ select: async () => ({ passwordHash }) }));
  const result = await invoke(t, rows, "/documents/:id", "patch", {
    params: { id: String(document._id) }, adminAccount: { key: "synthetic-admin", email: "admin@example.test" },
    body: { approval: "Rejected", reviewVersion: document.reviewVersion, adminPassword: "SyntheticAdmin1!",
      reason: "Synthetic account link protection check." },
  }, 409);
  assert.match(result.message, /account link/);
  assert.equal(document.status, "pending_review");
});

test("archiving a customer preserves an unrelated unfinished registration's documents and selfie", async t => {
  const rows = fixture();
  const email = rows.users[0].email;
  rows.prekycfaces = [{ _id: new mongoose.Types.ObjectId(), email, sessionId: "separate-draft-session" }];
  const draft = { _id: new mongoose.Types.ObjectId(), email, sessionId: "separate-draft-session", registrationDraftId: "separate-draft", docType: "id" };
  rows.prekycdocuments.push(draft);
  const passwordHash = await bcrypt.hash("SyntheticAdmin1!", 4);
  t.mock.method(AdminCredential, "findOne", () => ({ select: async () => ({ passwordHash }) }));
  await invoke(t, rows, "/customers/:id/archive", "patch", {
    params: { id: String(rows.users[0]._id) }, adminAccount: { key: "synthetic-admin", email: "admin@example.test" },
    body: { adminPassword: "SyntheticAdmin1!", reason: "Synthetic customer archive isolation check." },
  });
  assert.equal(rows.users[0].isArchived, true);
  assert.deepEqual(rows.prekycdocuments.map(document => document._id), [draft._id]);
  assert.equal(rows.prekycfaces.length, 1);
  assert.equal(rows.prekycfaces[0].sessionId, "separate-draft-session");
});

test("selfie ownership includes the submitted session and authenticated sessions without adopting other drafts", async () => {
  const rows = fixture(), user = rows.users[0], kyc = rows.kyc_cases[0];
  const query = await ownedFaceFilter(databaseFor(rows), user._id, user.email);
  for (const sessionId of [kyc.registrationSessionId, `user:${user._id}`, `reverify:${user._id}:12345678-abcd-abcd-abcd-123456789abc`]) {
    assert.equal(matches({ email: user.email, sessionId }, query), true);
  }
  assert.equal(matches({ email: user.email, sessionId: "separate-draft-session" }, query), false);
  assert.equal(matches({ email: user.email, sessionId: `user:${new mongoose.Types.ObjectId()}` }, query), false);
});
