import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import AdminCredential from "../models/AdminCredential.js";
import AdminAuditLog from "../models/AdminAuditLog.js";
import { createAdminDataRouter } from "../routes/adminData.routes.js";

for (const approval of ["Approved", "Rejected"]) test(`Super Admin ${approval} retains password confirmation, audit context and one durable session-bound notice`, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "admin-decision-"));
  const oldDirectory = process.env.KYC_UPLOAD_DIR;
  process.env.KYC_UPLOAD_DIR = directory;
  t.after(async () => {
    if (oldDirectory === undefined) delete process.env.KYC_UPLOAD_DIR; else process.env.KYC_UPLOAD_DIR = oldDirectory;
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const bytes = Buffer.from("Synthetic document evidence");
  await fs.writeFile(path.join(directory, "fixture.jpg"), bytes);
  const userId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
  const document = { _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439012"), registeredUser: userId,
    sessionId: `user:${userId}`, role: "user", email: "synthetic@example.test", docType: "id", status: "pending_review",
    detailsMatched: true, reviewVersion: "id-v1", fileKey: "fixture.jpg", fileHash: createHash("sha256").update(bytes).digest("hex"), provider: "gemini", reviewHistory: [] };
  const user = { _id: userId, role: "user", name: "Synthetic Applicant", email: document.email, isVerified: true, kycStatus: "challenge_passed" };
  const kyc = { _id: "case", user: userId, status: "challenge_passed", updatedAt: new Date(), challengePassedAt: new Date(),
    registrationDocumentVersions: { id: "id-v1" }, idDocumentHash: document.fileHash };
  const previous = mongoose.connection.db;
  mongoose.connection.db = { collection: name => ({
    findOne: async () => name === "prekycdocuments" ? document : name === "users" ? user : kyc,
    findOneAndUpdate: async (filter, update) => {
      if (filter.status !== document.status || filter.reviewVersion !== document.reviewVersion) return null;
      Object.assign(document, update.$set); document.reviewHistory.push(update.$push.reviewHistory); return { ...document };
    },
    updateOne: async (_filter, update) => { Object.assign(name === "users" ? user : kyc, update.$set); return { modifiedCount: 1 }; },
  }) };
  t.after(() => { mongoose.connection.db = previous; });
  const passwordHash = await bcrypt.hash("SyntheticAdmin1!", 4);
  t.mock.method(AdminCredential, "findOne", () => ({ select: async () => ({ passwordHash }) }));
  t.mock.method(AdminAuditLog, "create", async () => ({}));
  const app = express(); app.use(express.json());
  app.use(createAdminDataRouter({ requireAdminSession: (req, res, next) => {
    if (req.headers["x-synthetic-admin"] !== "yes") return res.status(401).json({ message: "Synthetic signed-out admin" });
    req.adminAccount = { key: "synthetic-admin", email: "admin@example.test" }; next();
  } }));
  const server = await new Promise(resolve => { const result = app.listen(0, "127.0.0.1", () => resolve(result)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/documents/${document._id}`;
  const send = (body, loggedIn = true) => fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json", ...(loggedIn ? { "x-synthetic-admin": "yes" } : {}) }, body: JSON.stringify(body) });
  const body = { approval, reviewVersion: "id-v1", adminPassword: "SyntheticAdmin1!",
    ...(approval === "Rejected" ? { reason: "Upload a clearer photo of the registered ID." } : {}) };
  assert.equal((await send(body, false)).status, 401);
  assert.equal((await send({ ...body, adminPassword: "" })).status, 400);
  assert.equal((await send({ ...body, adminPassword: "wrong" })).status, 403);
  if (approval === "Rejected") {
    assert.equal((await send({ ...body, reason: undefined })).status, 400);
    assert.equal((await send({ ...body, reason: "short" })).status, 400);
  }
  assert.equal(document.reviewHistory.length, 0);
  const result = await send(body); assert.equal(result.status, 200, await result.text());
  assert.equal(document.reviewHistory.length, 1); assert.equal(document.reviewHistory[0].notificationPending, true);
  assert.equal(document.reviewHistory[0].sessionId, document.sessionId);
  const expectedReason = approval === "Approved" ? "Document approved by the Super Admin." : body.reason;
  assert.equal(document.reviewHistory[0].reason, expectedReason); assert.equal(document.reason, expectedReason);
  assert.equal((await send(body)).status, 200); assert.equal(document.reviewHistory.length, 1);
  assert.equal((await send({ ...body, reviewVersion: "stale-version" })).status, 409);
});
