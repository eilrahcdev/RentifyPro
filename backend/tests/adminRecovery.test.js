import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import express from "express";
import AdminAuditLog from "../models/AdminAuditLog.js";
import { finishAdminKycDecision } from "../services/privateKycReview.service.js";
import { recordAdminAudit } from "../services/adminAudit.service.js";
import { createAdminDataRouter } from "../routes/adminData.routes.js";

test("an interrupted decision retains durable work, repairs the account on retry, and does not repeat its audit", async t => {
  const userId = new mongoose.Types.ObjectId();
  const user = { _id: userId, kycStatus: "challenge_passed" };
  const kyc = { _id: new mongoose.Types.ObjectId(), status: "challenge_passed", challengePassedAt: new Date(), idDocumentHash: "synthetic-hash", updatedAt: new Date() };
  const pending = { auditId: new mongoose.Types.ObjectId(), fileHash: "synthetic-hash", reviewVersion: "v1",
    audit: { admin: { key: "synthetic", email: "synthetic@example.test" }, action: "document.approved", targetType: "document", summary: "Synthetic document approved" } };
  const document = { _id: new mongoose.Types.ObjectId(), sessionId: `user:${userId}`, docType: "id", status: "verified",
    detailsMatched: true, fileHash: "synthetic-hash", reviewVersion: "v1", adminDecisionPending: pending };
  let outage = true;
  const database = { collection: name => ({
    findOne: async () => { if (outage) throw new Error("Simulated database interruption"); return name === "users" ? user : kyc; },
    updateOne: async (_filter, update) => {
      const object = name === "users" ? user : name === "kyc_cases" ? kyc : document;
      Object.assign(object, update.$set); for (const field of Object.keys(update.$unset || {})) delete object[field];
      return { modifiedCount: 1 };
    },
  }) };
  const audits = new Set();
  t.mock.method(AdminAuditLog, "create", async record => {
    const key = String(record._id); if (audits.has(key)) throw Object.assign(new Error("Duplicate event"), { code: 11000 });
    audits.add(key); return record;
  });
  await assert.rejects(finishAdminKycDecision(database, document), /interruption/);
  assert.equal(document.adminDecisionPending, pending); assert.equal(document.status, "verified");
  outage = false;
  await finishAdminKycDecision(database, document);
  assert.equal(user.kycStatus, "approved"); assert.equal(document.adminDecisionPending, undefined); assert.equal(audits.size, 1);
  await finishAdminKycDecision(database, { ...document, adminDecisionPending: pending });
  assert.equal(audits.size, 1); assert.equal(document.status, "verified");
});

test("failed critical audit delivery is queued durably with credentials removed", async t => {
  const previous = mongoose.connection.db;
  let queued;
  mongoose.connection.db = { collection: name => ({ updateOne: async (_filter, update) => {
    assert.equal(name, "adminauditoutbox"); queued = update.$setOnInsert.record;
  } }) };
  t.after(() => { mongoose.connection.db = previous; });
  t.mock.method(AdminAuditLog, "create", async () => { throw new Error("Simulated audit interruption"); });
  const result = await recordAdminAudit({ admin: { key: "synthetic", email: "synthetic@example.test" }, targetType: "customer",
    action: "customer.updated", summary: "Synthetic account correction", metadata: { password: "must not persist", safe: "kept", nested: { token: "must not persist" } } });
  assert.equal(result, false); assert.equal(queued.metadata.safe, "kept");
  assert.equal(JSON.stringify(queued).includes("must not persist"), false);
});

test("critical-action password attempts are limited after session authentication", async t => {
  const app = express(); app.use(express.json());
  app.use(createAdminDataRouter({ requireAdminSession: (req, res, next) => {
    if (!req.headers["x-fixture-session"]) return res.status(401).json({ message: "Fixture signed out" });
    req.adminAccount = { key: "synthetic" }; return next();
  } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/customers/${new mongoose.Types.ObjectId()}`;
  const send = session => fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json", ...(session ? { "x-fixture-session": "yes" } : {}) }, body: "{}" });
  assert.equal((await send(false)).status, 401);
  for (let i = 0; i < 10; i++) assert.equal((await send(true)).status, 400);
  const limited = await send(true); assert.equal(limited.status, 429); assert.ok(limited.headers.get("RateLimit"));
});
