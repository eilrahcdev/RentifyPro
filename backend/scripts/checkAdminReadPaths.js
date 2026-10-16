import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";
import AdminAuditLog from "../models/AdminAuditLog.js";
import { getMongoConnectionConfig } from "../config/mongoConnection.js";
import { getAdminStoragePaths } from "../config/storage.js";
import { createAdminDataRouter } from "../routes/adminData.routes.js";
import { identifierScreeningCandidateFilter, identifierDuplicateFilter } from "../services/adminIdentifierScreening.service.js";

const backend = fileURLToPath(new URL("../", import.meta.url));
dotenv.config({ path: path.join(backend, ".env"), quiet: true });
dotenv.config({ path: path.join(getAdminStoragePaths().website, ".env"), quiet: true });
let connection, server;
const originalDb = mongoose.connection.db;
const originalCount = AdminAuditLog.countDocuments;
try {
  const { uri, options } = getMongoConnectionConfig();
  connection = await mongoose.createConnection(uri, { ...options, autoIndex: false, autoCreate: false }).asPromise();
  const now = new Date();
  const fixture = { registeredUser: new mongoose.Types.ObjectId(), docType: "id", status: "pending_review", provider: "private-ocr",
    sessionId: "user:507f1f77bcf86cd799439011", selectedDocCategory: "Philippine Passport", email: "synthetic@example.test",
    fileHash: "a".repeat(64), fileKey: "synthetic.jpg", reviewVersion: "synthetic-v1" };
  const finding = { version: 1, fileHash: fixture.fileHash, reviewVersion: fixture.reviewVersion, sessionId: fixture.sessionId,
    selectedDocCategory: fixture.selectedDocCategory, confidence: 99, fingerprint: "f".repeat(64), state: "complete" };
  const queueFixtures = [
    { ...fixture, _id: "fresh" },
    { ...fixture, _id: "locked", adminIdentifierScreening: { ...finding, state: "processing", lockedAt: now } },
    { ...fixture, _id: "expired-lock", adminIdentifierScreening: { ...finding, state: "processing", lockedAt: new Date(now - 360_000) } },
    { ...fixture, _id: "complete", adminIdentifierScreening: finding },
    { ...fixture, _id: "retry-due", adminIdentifierScreening: { ...finding, state: "retry_wait", nextAttemptAt: new Date(now - 1000) } },
    { ...fixture, _id: "retry-future", adminIdentifierScreening: { ...finding, state: "retry_wait", nextAttemptAt: new Date(+now + 100_000) } },
    { ...fixture, _id: "backoff-due", adminIdentifierScreening: { ...finding, state: "unavailable", nextAttemptAt: new Date(now - 1000) } },
    { ...fixture, _id: "backoff-future", adminIdentifierScreening: { ...finding, state: "unavailable", nextAttemptAt: new Date(+now + 100_000) } },
    { ...fixture, _id: "replacement", reviewVersion: "synthetic-v2", adminIdentifierScreening: finding },
    { ...fixture, _id: "verified", status: "verified" },
    { ...fixture, _id: "expired", expiresAt: new Date(now - 1000) },
    { ...fixture, _id: "unregistered", registeredUser: null, sessionId: "unfinished-draft" },
    { ...fixture, _id: "existing-fingerprint", documentNumberFingerprint: "f".repeat(64) },
  ];
  const queryFixtures = async (rows, filter) => {
    const result = await connection.db.command({ aggregate: 1, pipeline: [{ $documents: rows }, { $match: filter }, { $project: { _id: 1 } }], cursor: {}, maxTimeMS: 10_000 });
    return result.cursor.firstBatch.map(row => row._id).sort();
  };
  assert.deepEqual(await queryFixtures(queueFixtures, identifierScreeningCandidateFilter(now)),
    ["backoff-due", "expired-lock", "fresh", "replacement", "retry-due"]);
  const duplicateFixtures = [
    { ...fixture, _id: "root-match", documentNumberFingerprint: "f".repeat(64) },
    { ...fixture, _id: "current-match", adminIdentifierScreening: finding },
    { ...fixture, _id: "old-file", fileHash: "b".repeat(64), adminIdentifierScreening: finding },
    { ...fixture, _id: "old-version", reviewVersion: "synthetic-v2", adminIdentifierScreening: finding },
    { ...fixture, _id: "other-session", sessionId: "user:507f1f77bcf86cd799439012", adminIdentifierScreening: finding },
    { ...fixture, _id: "other-type", selectedDocCategory: "PRC ID", adminIdentifierScreening: finding },
    { ...fixture, _id: "same-email", adminIdentifierScreening: finding, email: "reviewer-fixture@example.test" },
  ];
  assert.deepEqual(await queryFixtures(duplicateFixtures, identifierDuplicateFilter({ _id: "reviewed", email: "reviewer-fixture@example.test" }, "f".repeat(64))),
    ["current-match", "root-match"]);
  mongoose.connection.db = connection.db;
  AdminAuditLog.countDocuments = filter => connection.db.collection("adminauditlogs").countDocuments(filter);
  const session = randomUUID();
  const app = express();
  app.use((req, res, next) => req.method === "GET" ? next() : res.sendStatus(405));
  app.use(createAdminDataRouter({ requireAdminSession: (req, res, next) => {
    if (req.headers["x-read-path-fixture"] !== session) return res.sendStatus(401);
    req.adminAccount = { key: "read-only-fixture" }; return next();
  } }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: "Read-path check failed" }));
  server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { "x-read-path-fixture": session };
  assert.equal((await fetch(`${origin}/data`)).status, 401);
  const totals = { customers: 0, vehicles: 0, documents: 0, bookings: 0 };
  const accountLinks = { registered: 0, registration_incomplete: 0, needs_review: 0 };
  let cursor, pages = 0;
  do {
    const result = await fetch(`${origin}/data?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers });
    assert.equal(result.status, 200); const body = await result.json(); pages++;
    for (const key of Object.keys(totals)) { assert.ok(body[key].length <= 10); totals[key] += body[key].length; }
    for (const document of body.documents) {
      assert.ok(Object.hasOwn(accountLinks, document.accountLink?.status));
      accountLinks[document.accountLink.status]++;
      if (document.accountLink.status === "registered") assert.equal(document.accountLink.customerId, document.customerId);
      else assert.equal(document.accountLink.customerId, "");
    }
    for (const customer of body.customers) {
      assert.ok(Array.isArray(customer.verification.pendingReasons));
      assert.ok(Array.isArray(customer.verification.pendingDocumentIds));
      if (customer.status === "Active") assert.deepEqual(customer.verification.pendingReasons, []);
    }
    cursor = body.page.nextCursor;
  } while (cursor);
  const pending = await connection.db.collection("prekycdocuments").find({ status: "pending_review" }, { projection: { fileHash: 1, provider: 1 } }).toArray();
  let previews = 0, visualContexts = 0;
  for (const document of pending) {
    const url = `${origin}/documents/${document._id}/file`;
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers }); assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Location"), null);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), document.fileHash); previews++;
    if (["private-ocr", "manual"].includes(document.provider)) {
      const contextResponse = await fetch(`${origin}/documents/${document._id}/comparison?mode=visual`, { headers });
      assert.equal(contextResponse.status, 200);
      assert.equal(contextResponse.headers.get("Cache-Control"), "private, no-store");
      const context = await contextResponse.json();
      assert.equal(context.fileHash, document.fileHash); assert.equal(context.reviewMode, "visual");
      assert.equal(Object.hasOwn(context, "fields"), false); visualContexts++;
      const statusResponse = await fetch(`${origin}/documents/${document._id}/comparison?mode=visual&statusOnly=1`, { headers });
      assert.equal(statusResponse.status, 200);
      const status = await statusResponse.json();
      assert.equal(status.fileHash, document.fileHash); assert.equal(Object.hasOwn(status, "profile"), false);
      assert.equal(Object.hasOwn(status.identifierScreening || {}, "fingerprint"), false);
    }
  }
  console.log(JSON.stringify({ readOnly: true, fixtureSession: true, overviewPages: pages, totals, accountLinks,
    pendingOriginalsServed: previews, visualReviewContextsLoaded: visualContexts, unsignedRequestsRejected: true,
    syntheticIdentifierQueryCases: queueFixtures.length + duplicateFixtures.length }));
} catch (error) {
  console.error(`Read-path check failed (${error.name}).`); process.exitCode = 1;
} finally {
  AdminAuditLog.countDocuments = originalCount;
  mongoose.connection.db = originalDb;
  if (server) await new Promise(resolve => server.close(resolve));
  if (connection) await connection.close();
}
