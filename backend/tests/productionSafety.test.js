import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import jwt from "jsonwebtoken";
import { createRequire } from "node:module";
import mongoose from "mongoose";
import User from "../models/User.js";
import RevokedSession from "../models/RevokedSession.js";
import { initSocket, emitToUser } from "../socket/index.js";
import { getHealth } from "../controllers/health.controller.js";
import { createOriginChecker } from "../utils/corsOrigins.js";
import { assertGeminiSensitiveDataAllowed } from "../utils/geminiDataPolicy.js";
import { assertProductionConfiguration, getProductionConfigurationErrors } from "../utils/productionConfig.js";
import { getPublicUploadsDir, getKycUploadDir, getAvatarUploadDir, getReportEvidenceDir, getVehiclePhotoDir } from "../utils/storagePaths.js";

const socketRequire = createRequire(import.meta.resolve("socket.io"));
const WebSocket = createRequire(socketRequire.resolve("engine.io"))("ws");

function environment(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}
const validConfiguration = () => ({
  NODE_ENV: "production", JWT_SECRET: "a".repeat(48), INTERNAL_API_KEY: "b".repeat(48),
  MONGO_URI: "mongodb://fixture", MONGO_AUTO_INDEX: "false", FRONTEND_URL: "https://rentify.example.test",
  BACKEND_PUBLIC_URL: "https://api.example.test", FACE_SERVICE_URL: "https://face.example.test", CHATBOT_URL: "https://chat.example.test",
  FACE_SERVICE_AUTOSTART: "false", CHATBOT_SERVICE_AUTOSTART: "false",
  PAYMONGO_SECRET_KEY: "sk_live_fixture", PAYMONGO_WEBHOOK_SECRET: "whsec_fixture",
  GEMINI_API_KEY: "fixture", GEMINI_SENSITIVE_DATA_APPROVED: "true",
  STORAGE_ROOT: path.join(os.tmpdir(), "rentify-persistent"), STORAGE_DURABILITY_CONFIRMED: "true",
});

test("health returns 503 for every unavailable database state", (t) => {
  const previous = mongoose.connection.readyState;
  t.after(() => { mongoose.connection.readyState = previous; });
  for (const state of [0, 1, 2, 3]) {
    mongoose.connection.readyState = state;
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    getHealth({}, res);
    assert.equal(res.code, state === 1 ? 200 : 503);
    assert.equal(res.body.success, state === 1);
  }
});

test("production CORS allows only configured origins while development keeps localhost", (t) => {
  environment(t, { NODE_ENV: "production", FRONTEND_URL: "https://rentify.example.test", ALLOW_VERCEL_PREVIEW_ORIGINS: "false" });
  let checker = createOriginChecker();
  assert.equal(checker.isAllowedOrigin("http://localhost:5173"), false);
  assert.equal(checker.isAllowedOrigin("https://unowned.vercel.app"), false);
  assert.equal(checker.isAllowedOrigin("https://rentify.example.test"), true);
  process.env.NODE_ENV = "development";
  checker = createOriginChecker();
  assert.equal(checker.isAllowedOrigin("http://localhost:5173"), true);
});

test("production configuration reports missing requirements without exposing secrets", () => {
  assert.deepEqual(getProductionConfigurationErrors(validConfiguration()), []);
  const env = { ...validConfiguration(), JWT_SECRET: "secret", FRONTEND_URL: "https://*.vercel.app", BACKEND_PUBLIC_URL: "https://127.0.0.1", STORAGE_DURABILITY_CONFIRMED: "false", GEMINI_SENSITIVE_DATA_APPROVED: undefined };
  const errors = getProductionConfigurationErrors(env);
  for (const key of ["JWT_SECRET", "FRONTEND_URL", "BACKEND_PUBLIC_URL", "STORAGE_ROOT", "GEMINI_SENSITIVE_DATA_APPROVED"]) assert.ok(errors.some((error) => error.includes(key)), key);
  assert.equal(errors.some((error) => error.includes(env.PAYMONGO_SECRET_KEY)), false);
  assert.ok(getProductionConfigurationErrors({ ...validConfiguration(), KYC_UPLOAD_DIR: path.join(validConfiguration().STORAGE_ROOT, "uploads", "kyc") }).some((error) => /separate/.test(error)));
});

test("production validates optional dedicated chatbot keys without changing shared-key requirements", () => {
  assert.deepEqual(getProductionConfigurationErrors({ ...validConfiguration(), CHATBOT_INTERNAL_API_KEY: "" }), []);
  assert.deepEqual(getProductionConfigurationErrors({ ...validConfiguration(), CHATBOT_INTERNAL_API_KEY: "random-chatbot-fixture-secret-32-chars" }), []);
  const errors = getProductionConfigurationErrors({ ...validConfiguration(), CHATBOT_INTERNAL_API_KEY: "short" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /CHATBOT_INTERNAL_API_KEY/);
  assert.ok(getProductionConfigurationErrors({ ...validConfiguration(), CHATBOT_INTERNAL_API_KEY: "random-chatbot-fixture-secret-32-chars",
    INTERNAL_API_KEY: "short" }).some((error) => error.includes("INTERNAL_API_KEY must contain")));
});

test("production accepts manual KYC without a Gemini key and still validates explicit opt-in", (t) => {
  const manual = { ...validConfiguration(), GEMINI_SENSITIVE_DATA_APPROVED: "false", GEMINI_API_KEY: undefined };
  assert.deepEqual(getProductionConfigurationErrors(manual), []);
  environment(t, manual);
  assert.doesNotThrow(assertProductionConfiguration);
  assert.deepEqual(getProductionConfigurationErrors(validConfiguration()), []);
  const missingKey = getProductionConfigurationErrors({ ...validConfiguration(), GEMINI_API_KEY: undefined });
  assert.equal(missingKey.length, 1);
  assert.match(missingKey[0], /GEMINI_API_KEY/);
  for (const flag of [undefined, "", "FALSE", "invalid"]) {
    assert.ok(getProductionConfigurationErrors({ ...manual, GEMINI_SENSITIVE_DATA_APPROVED: flag }).some((error) => error.includes("GEMINI_SENSITIVE_DATA_APPROVED")));
  }
});

test("manual KYC leaves every unrelated production validation unchanged", () => {
  for (const overrides of [
    { NODE_ENV: "development" },
    { JWT_SECRET: "short" },
    { INTERNAL_API_KEY: "short" },
    { PASSWORD_RESET_TOKEN_SECRET: "short" },
    { MONGO_URI: undefined, MONGO_URI_DIRECT: undefined },
    { MONGO_AUTO_INDEX: "true" },
    { FRONTEND_URL: "https://*.example.test" },
    { ALLOW_VERCEL_PREVIEW_ORIGINS: "true" },
    { BACKEND_PUBLIC_URL: "http://localhost:5000" },
    { FACE_SERVICE_URL: "http://localhost:8010" },
    { CHATBOT_URL: "http://localhost:8001" },
    { FACE_SERVICE_AUTOSTART: "true" },
    { CHATBOT_SERVICE_AUTOSTART: "true" },
    { PAYMONGO_SECRET_KEY: undefined },
    { PAYMONGO_WEBHOOK_SECRET: undefined },
    { PAYMENT_RECONCILIATION_ENABLED: "false" },
    { STORAGE_ROOT: undefined },
    { STORAGE_DURABILITY_CONFIRMED: "false" },
    { KYC_UPLOAD_DIR: path.join(validConfiguration().STORAGE_ROOT, "uploads", "kyc") },
    { AVATAR_UPLOAD_DIR: path.join(validConfiguration().STORAGE_ROOT, "private_uploads", "avatars") },
  ]) {
    const automated = { ...validConfiguration(), ...overrides };
    const manual = { ...automated, GEMINI_SENSITIVE_DATA_APPROVED: "false", GEMINI_API_KEY: undefined };
    const errors = getProductionConfigurationErrors(automated);
    assert.ok(errors.length > 0, JSON.stringify(Object.keys(overrides)));
    assert.deepEqual(getProductionConfigurationErrors(manual), errors);
  }
});

test("Gemini cannot receive production KYC until data handling is confirmed", (t) => {
  environment(t, { NODE_ENV: "production", GEMINI_SENSITIVE_DATA_APPROVED: undefined });
  assert.throws(assertGeminiSensitiveDataAllowed, { code: "GEMINI_DATA_POLICY_UNCONFIRMED" });
  process.env.GEMINI_SENSITIVE_DATA_APPROVED = "true";
  assert.doesNotThrow(assertGeminiSensitiveDataAllowed);
});

test("all upload classes use the configured storage volume and private evidence stays separate", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rentify-storage-test-"));
  environment(t, { STORAGE_ROOT: root, PUBLIC_UPLOAD_DIR: undefined, AVATAR_UPLOAD_DIR: undefined, KYC_UPLOAD_DIR: undefined, REPORT_EVIDENCE_DIR: undefined });
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("rentify-storage-test-"));
    await fs.rm(root, { recursive: true });
  });
  const publicRoot = getPublicUploadsDir();
  assert.equal(publicRoot, path.join(root, "uploads"));
  assert.equal(getAvatarUploadDir(), path.join(publicRoot, "avatars"));
  for (const directory of [getKycUploadDir(), getReportEvidenceDir(), getVehiclePhotoDir()]) {
    assert.ok(directory.startsWith(path.join(root, "private_uploads")));
    assert.equal(directory.startsWith(publicRoot), false);
  }
  await fs.mkdir(getKycUploadDir(), { recursive: true });
  const filename = path.join(getKycUploadDir(), "synthetic-document.txt");
  await fs.writeFile(filename, "synthetic fixture");
  assert.equal(await fs.readFile(path.join(root, "private_uploads", "kyc", "synthetic-document.txt"), "utf8"), "synthetic fixture");
});

test("malformed Socket.IO chat events cannot crash an authenticated connection", { timeout: 5000 }, async (t) => {
  const userId = "507f1f77bcf86cd799439012";
  environment(t, { JWT_SECRET: "fixture-socket-secret" });
  t.mock.method(User, "findById", () => ({ select: async () => ({ _id: userId, role: "user", sessionVersion: 0, isDisabled: false, isArchived: false }) }));
  t.mock.method(RevokedSession, "exists", async () => false);
  const server = http.createServer();
  const io = initSocket(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const token = jwt.sign({ id: userId, sessionVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "1m" });
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=websocket`, {
    headers: { Cookie: `token=${token}`, Origin: "http://localhost:5173" },
  });
  t.after(async () => { ws.terminate(); await new Promise((resolve) => io.close(resolve)); });
  const received = [];
  const waitFor = (predicate) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off("message", handler); reject(new Error("Socket fixture timed out")); }, 2000);
    const handler = (data) => { const text = data.toString(); received.push(text); if (predicate(text)) { clearTimeout(timer); ws.off("message", handler); resolve(); } };
    ws.on("message", handler);
  });
  await waitFor((text) => text.startsWith("0"));
  const connected = waitFor((text) => text.startsWith("40"));
  ws.send("40");
  await connected;
  for (const event of ["chat:join", "chat:leave"]) {
    ws.send(`42${JSON.stringify([event])}`);
    for (const payload of [null, 1, [], {}, { conversationId: {} }, { conversationId: "x".repeat(1000) }]) ws.send(`42${JSON.stringify([event, payload])}`);
  }
  const delivered = waitFor((text) => text.includes('"fixture:alive"'));
  // The server receives these packets in order, then responds on the authenticated user's room.
  const socket = [...io.sockets.sockets.values()][0];
  socket.on("fixture:check", () => emitToUser(userId, "fixture:alive", { ok: true }));
  ws.send('42["fixture:check"]');
  await delivered;
  assert.equal(ws.readyState, WebSocket.OPEN);
});
