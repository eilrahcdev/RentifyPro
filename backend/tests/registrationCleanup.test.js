import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import RegistrationDraft from "../models/RegistrationDraft.js";
import PreKycDocument from "../models/PreKycDocument.js";
import PreKycFace from "../models/PreKycFace.js";
import User from "../models/User.js";
import { purgeAbandonedRegistrations } from "../services/registrationCleanup.service.js";

const query = value => ({ select() { return this; }, limit() { return this; }, lean: async () => value });

test("expired orphan evidence is cleaned even after MongoDB TTL has removed its registration draft", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "registration-orphan-"));
  const previous = process.env.KYC_UPLOAD_DIR; process.env.KYC_UPLOAD_DIR = directory;
  t.after(async () => {
    if (previous === undefined) delete process.env.KYC_UPLOAD_DIR; else process.env.KYC_UPLOAD_DIR = previous;
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  });
  let documents = ["id", "supporting"].map(docType => ({ registrationDraftId: "expired-draft", role: "owner",
    sessionId: "expired-session", email: "fixture@example.test", docType, fileKey: `${docType}.jpg`, registrationExpiresAt: new Date(0) }));
  for (const doc of documents) await fs.writeFile(path.join(directory, doc.fileKey), "synthetic evidence");
  let tombstone;
  t.mock.method(RegistrationDraft, "find", () => query([]));
  t.mock.method(RegistrationDraft, "exists", async () => tombstone || null);
  t.mock.method(User, "exists", async () => null);
  t.mock.method(RegistrationDraft, "findOneAndUpdate", async (filter, update) => {
    tombstone = { _id: filter._id, ...update.$setOnInsert }; return tombstone;
  });
  t.mock.method(RegistrationDraft, "updateOne", async (_filter, update) => {
    Object.assign(tombstone, update.$set);
    for (const field of Object.keys(update.$unset || {})) delete tombstone[field];
    return { matchedCount: 1 };
  });
  t.mock.method(PreKycDocument, "find", filter => {
    if (filter.registrationDraftId) return query([...documents]);
    assert.equal(filter.sessionId, "expired-session"); assert.equal(filter.role, "owner");
    assert.deepEqual(filter.email.$in, ["fixture@example.test"]); assert.equal(filter.registeredUser, null);
    return query([...documents]);
  });
  t.mock.method(PreKycDocument, "updateMany", async (_filter, update) => {
    assert.ok(update.$set.registrationCancelledAt); return {};
  });
  t.mock.method(PreKycDocument, "deleteMany", async () => { documents = []; return {}; });
  t.mock.method(PreKycDocument, "exists", async () => null);
  const faces = t.mock.method(PreKycFace, "deleteMany", async filter => {
    assert.equal(filter.sessionId, "expired-session"); assert.equal(filter.role, "owner"); return {};
  });
  await purgeAbandonedRegistrations();
  assert.equal(documents.length, 0); assert.equal(faces.mock.callCount(), 1);
  assert.deepEqual(await fs.readdir(directory), []); assert.ok(tombstone.cleanupCompletedAt);
  assert.equal(tombstone.cleanupEmails, undefined); assert.deepEqual(tombstone.fields, {});
});

test("orphan cleanup protects an account created from the same draft", async t => {
  t.mock.method(RegistrationDraft, "find", () => query([]));
  t.mock.method(RegistrationDraft, "exists", async () => null);
  t.mock.method(PreKycDocument, "find", () => query([{ registrationDraftId: "submitted" }]));
  t.mock.method(User, "exists", async filter => { assert.equal(filter.registrationDraftId, "submitted"); return { _id: "account" }; });
  const cancel = t.mock.method(RegistrationDraft, "findOneAndUpdate", async () => { throw Error("Submitted evidence must remain"); });
  await purgeAbandonedRegistrations(); assert.equal(cancel.mock.callCount(), 0);
});
