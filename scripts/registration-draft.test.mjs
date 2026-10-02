import assert from "node:assert/strict";
import test from "node:test";
import {
  clearAllRegistrationDrafts, clearRegistrationDraft, DRAFT_IDLE_MS, draftStorageKey,
  readRegistrationDraft, selectDraftFields, writeRegistrationDraft,
} from "../frontend/src/utils/registrationDraft.js";

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const now = 1_000_000;

test("only allowlisted ordinary fields survive serialization and restoration", () => {
  for (const role of ["user", "owner"]) {
    const store = storage();
    const form = { firstName: "Alice", email: "alice@example.test", businessEmail: "owner@example.test",
      password: "secret", confirmPassword: "secret", agree: true, idCardFile: "image", selfieDataUrl: "image",
      selfieVerified: true, idRegistered: true, preKycToken: "token", step: 4, unknown: "private" };
    assert.equal(writeRegistrationDraft(store, role, form, now + DRAFT_IDLE_MS), true);
    const restored = readRegistrationDraft(store, role, now);
    assert.deepEqual(restored.fields, role === "user"
      ? { firstName: "Alice", email: "alice@example.test" }
      : { firstName: "Alice", businessEmail: "owner@example.test" });
    assert.equal(restored.status, "restored");
    assert.ok(!store.getItem(draftStorageKey(role)).includes("secret"));
  }
});

test("expiry is enforced at exactly 60 minutes and reads do not extend it", () => {
  const store = storage();
  writeRegistrationDraft(store, "user", { firstName: "Alice" }, now + DRAFT_IDLE_MS);
  assert.equal(readRegistrationDraft(store, "user", now + DRAFT_IDLE_MS - 1).expiresAt, now + DRAFT_IDLE_MS);
  assert.equal(readRegistrationDraft(store, "user", now + DRAFT_IDLE_MS).status, "expired");
  assert.equal(store.getItem(draftStorageKey("user")), null);
});

test("renter and owner drafts remain separate and clearing removes only the selected draft", () => {
  const store = storage();
  writeRegistrationDraft(store, "user", { firstName: "Renter" }, now + DRAFT_IDLE_MS);
  writeRegistrationDraft(store, "owner", { firstName: "Owner" }, now + DRAFT_IDLE_MS);
  store.setItem("unrelated", "keep");
  clearRegistrationDraft(store, "user");
  assert.equal(readRegistrationDraft(store, "user", now).status, "new");
  assert.equal(readRegistrationDraft(store, "owner", now).fields.firstName, "Owner");
  assert.equal(store.getItem("unrelated"), "keep");
});

test("successful authentication cleanup removes every registration draft and nothing else", () => {
  const store = storage();
  writeRegistrationDraft(store, "user", { firstName: "Renter" }, now + DRAFT_IDLE_MS);
  writeRegistrationDraft(store, "owner", { firstName: "Owner" }, now + DRAFT_IDLE_MS);
  store.setItem("unrelated", "keep");

  clearAllRegistrationDrafts(store);

  assert.equal(store.getItem(draftStorageKey("user")), null);
  assert.equal(store.getItem(draftStorageKey("owner")), null);
  assert.equal(store.getItem("unrelated"), "keep");
});

test("malformed, outdated, future-dated and tampered drafts cannot restore unsafe fields", () => {
  const store = storage();
  for (const raw of ["{broken", "null", JSON.stringify({ version: 2, fields: {}, expiresAt: now + 1 }),
    JSON.stringify({ version: 1, fields: {}, expiresAt: now + DRAFT_IDLE_MS + 1 })]) {
    store.setItem(draftStorageKey("user"), raw);
    assert.deepEqual(readRegistrationDraft(store, "user", now).fields, {});
    assert.equal(store.getItem(draftStorageKey("user")), null);
  }
  assert.deepEqual(selectDraftFields("user", { firstName: {}, email: ["x"], phone: "9".repeat(1000), agree: true }), { phone: "9".repeat(500) });
});

test("blocked storage never prevents registration and blank forms are not saved", () => {
  const blocked = { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } };
  assert.equal(readRegistrationDraft(blocked, "user", now).status, "unavailable");
  assert.equal(writeRegistrationDraft(blocked, "user", { firstName: "Alice" }, now + DRAFT_IDLE_MS), false);
  assert.doesNotThrow(() => clearRegistrationDraft(blocked, "user"));
  assert.doesNotThrow(() => clearAllRegistrationDrafts(blocked));
  const store = storage();
  writeRegistrationDraft(store, "owner", { ownerType: "individual", password: "secret" }, now + DRAFT_IDLE_MS);
  assert.equal(store.getItem(draftStorageKey("owner")), null);
});
