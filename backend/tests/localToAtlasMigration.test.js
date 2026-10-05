import test from "node:test";
import assert from "node:assert/strict";
import { buildMergePlan, canonical, mergeShared, prepareLocalDocument, validateUniqueIndexes, validateReferences } from "../scripts/migrate-local-to-atlas.js";

const earlier = new Date("2026-09-01T00:00:00Z");
const later = new Date("2026-10-01T00:00:00Z");
const snapshot = (name, docs) => new Map([[name, { docs }]]);

test("newer Atlas payment data and a local review both survive the merge", () => {
  const local = { _id: "booking", updatedAt: earlier, paymentStatus: "pending", paymongoReference: "old", reviewRating: 5, reviewCreatedAt: earlier, reviewComment: "Good" };
  const atlas = { _id: "booking", updatedAt: later, paymentStatus: "paid", paymongoReference: "current", reviewCreatedAt: null };
  const merged = mergeShared("bookings", local, atlas);
  assert.equal(merged.paymentStatus, "paid");
  assert.equal(merged.paymongoReference, "current");
  assert.equal(merged.reviewRating, 5);
  assert.equal(merged.reviewComment, "Good");
});

test("a newer local profile cannot lower the session version or reuse old password sessions", () => {
  const local = { _id: "user", updatedAt: later, password: "local-hash", sessionVersion: 0 };
  const atlas = { _id: "user", updatedAt: earlier, password: "atlas-hash", sessionVersion: 4 };
  assert.equal(mergeShared("users", local, atlas).sessionVersion, 5);
});

test("Atlas-only users remain alongside additional local records", () => {
  const plan = buildMergePlan(snapshot("users", [{ _id: "local" }]), snapshot("users", [{ _id: "atlas" }]));
  assert.deepEqual(plan.get("users").docs.map((doc) => doc._id).sort(), ["atlas", "local"]);
});

test("a local admin identity does not replace current Atlas credentials", () => {
  const plan = buildMergePlan(snapshot("admincredentials", [{ _id: "local", key: "system-admin", passwordHash: "old" }]), snapshot("admincredentials", [{ _id: "atlas", key: "system-admin", passwordHash: "current" }]));
  assert.equal(plan.get("admincredentials").docs.length, 1);
  assert.equal(plan.get("admincredentials").docs[0].passwordHash, "current");
  assert.equal(plan.get("admincredentials").operations.length, 0);
});

test("duplicate notification identities retain Atlas IDs and remap local delivery references", () => {
  const source = new Map([
    ["notifications", { docs: [{ _id: "local-note", user: "user", dedupeKey: "event", updatedAt: later }] }],
    ["notificationdeliveries", { docs: [{ _id: "delivery", notification: "local-note", status: "sent" }] }],
  ]);
  const target = snapshot("notifications", [{ _id: "atlas-note", user: "user", dedupeKey: "event", updatedAt: earlier }]);
  const plan = buildMergePlan(source, target);
  assert.equal(plan.get("notifications").docs.length, 1);
  assert.equal(plan.get("notifications").docs[0]._id, "atlas-note");
  assert.equal(plan.get("notificationdeliveries").docs[0].notification, "atlas-note");
});

test("local active admin sessions are imported revoked without changing the source", () => {
  const now = new Date("2026-10-03T00:00:00Z");
  const local = { _id: "session", revokedAt: null, expiresAt: new Date("2026-10-04T00:00:00Z") };
  assert.equal(prepareLocalDocument("adminsessions", local, now).revokedAt, now);
  assert.equal(local.revokedAt, null);
});

test("historical outbox records cannot replay email after migration", () => {
  const failed = prepareLocalDocument("notificationdeliveries", { _id: "failed", status: "failed", attempts: 1 }, later);
  assert.equal(failed.status, "failed");
  assert.equal(failed.attempts, 5);
  assert.equal(prepareLocalDocument("notificationdeliveries", { status: "pending" }, later).status, "skipped");
});

test("duplicate unique values abort while partial and sparse indexes exclude ineligible records", () => {
  assert.throws(() => validateUniqueIndexes("users", [{ email: "same" }, { email: "same" }], [{ name: "email_1", key: { email: 1 }, unique: true }]), /Duplicate unique identity/);
  assert.doesNotThrow(() => validateUniqueIndexes("users", [{}, {}], [{ name: "phone_1", key: { phone: 1 }, unique: true, sparse: true }]));
  assert.doesNotThrow(() => validateUniqueIndexes("notifications", [{ user: "user", dedupeKey: "" }, { user: "user", dedupeKey: "" }], [{ name: "dedupe", key: { user: 1, dedupeKey: 1 }, unique: true, partialFilterExpression: { dedupeKey: { $exists: true, $gt: "" } } }]));
});

test("legacy references to removed accounts are preserved but new broken references abort", () => {
  const source = snapshot("bookings", [{ _id: "booking", renter: "removed-user" }]);
  const target = new Map();
  const plan = buildMergePlan(source, target);
  assert.deepEqual(validateReferences(plan, source, target), [{ reference: "bookings.renter", records: 1 }]);
  plan.get("bookings").docs[0] = { _id: "booking", renter: "unexpected-user" };
  assert.throws(() => validateReferences(plan, source, target), /New missing users reference/);
});

test("identical legacy documents keep omitted fields and need no writes", () => {
  for (const name of ["bookings", "users", "notifications"]) {
    const original = { _id: name, updatedAt: earlier };
    const plan = buildMergePlan(snapshot(name, [original]), snapshot(name, [original]));
    assert.equal(plan.get(name).operations.length, 0);
    assert.equal(canonical(plan.get(name).docs[0]), canonical(original));
  }
});

test("repeated migration preserves previously revoked Atlas sessions", () => {
  const now = new Date("2026-10-03T00:00:00Z");
  const source = { _id: "session", revokedAt: null, expiresAt: new Date("2026-10-04T00:00:00Z") };
  const atlas = { ...source, revokedAt: later, updatedAt: later };
  const plan = buildMergePlan(snapshot("adminsessions", [source]), snapshot("adminsessions", [atlas]), now);
  assert.equal(plan.get("adminsessions").operations.length, 0);
  assert.equal(plan.get("adminsessions").docs[0].revokedAt, later);
});
