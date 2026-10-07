import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createPrivateOcrServiceManager, getPrivateOcrLaunchOptions } from "../utils/privateOcrServiceManager.js";

const configuration = (overrides = {}) => ({ NODE_ENV: "development", KYC_DOCUMENT_PROVIDER: "private_ocr",
  KYC_PRIVATE_SERVICE_AUTOSTART: "true", KYC_PRIVATE_SERVICE_URL: "http://127.0.0.1:8020",
  INTERNAL_API_KEY: "shared-fixture-key".repeat(3), KYC_PRIVATE_INTERNAL_API_KEY: "private-fixture-key".repeat(3), ...overrides });
const quietLogger = { info() {}, warn() {} };
class Child extends EventEmitter {
  exitCode = null;
  signalCode = null;
  kills = 0;
  kill() { this.kills++; this.signalCode = "SIGTERM"; this.emit("exit", null, "SIGTERM"); return true; }
}

test("OCR autostart cannot probe or spawn for production, remote URLs, other providers, or disabled settings", async () => {
  for (const overrides of [
    { NODE_ENV: "production" }, { KYC_DOCUMENT_PROVIDER: "gemini" }, { KYC_DOCUMENT_PROVIDER: "manual" },
    { KYC_PRIVATE_SERVICE_AUTOSTART: undefined }, { KYC_PRIVATE_SERVICE_AUTOSTART: "false" },
    { KYC_PRIVATE_SERVICE_AUTOSTART: "invalid" }, { KYC_PRIVATE_SERVICE_URL: undefined },
    { KYC_PRIVATE_SERVICE_URL: "https://checker.example.test" }, { KYC_PRIVATE_SERVICE_URL: "http://checker.example.test" },
    { KYC_PRIVATE_SERVICE_URL: "http://localhost.example.test:8020" },
    { KYC_PRIVATE_SERVICE_URL: "http://127.0.0.1:8020/inspect" },
    { KYC_PRIVATE_SERVICE_URL: "http://user:password@127.0.0.1:8020" },
    { KYC_PRIVATE_SERVICE_URL: "http://127.0.0.1:8020?key=fixture" },
  ]) {
    const forbidden = () => { assert.fail("Disabled autostart must not probe, read assets, or spawn Python"); };
    const manager = createPrivateOcrServiceManager({ env: configuration(overrides), checkHealth: forbidden,
      isListening: forbidden, launchOptions: forbidden, spawnProcess: forbidden, logger: quietLogger });
    assert.equal(await manager.ensureReady(), false, JSON.stringify(Object.keys(overrides)));
    manager.stop();
  }
});

test("a healthy existing OCR service is reused and never terminated by the backend", async () => {
  const forbidden = () => { assert.fail("The existing service must not be replaced or owned"); };
  const manager = createPrivateOcrServiceManager({ env: configuration(), checkHealth: async () => true,
    isListening: forbidden, launchOptions: forbidden, spawnProcess: forbidden, logger: quietLogger });
  assert.equal(await manager.ensureReady(), true);
  manager.stop();
  assert.equal(await manager.ensureReady(), false);
});

test("a ready older OCR worker cannot be reused, replaced, or mistaken for a current reader", async (t) => {
  for (const health of [{ ready: true, schema_version: 1 },
    { ready: true, schema_version: 1, provider: "paddleocr", layout_version: 1 },
    { ready: true, schema_version: 1, provider: "another-reader", layout_version: 2 },
    { ready: true, schema_version: 2, provider: "paddleocr", layout_version: 2 }]) {
    t.mock.method(globalThis, "fetch", async (url, options) => {
      assert.equal(String(url), "http://127.0.0.1:8020/health");
      assert.equal(options.redirect, "error");
      return Response.json(health);
    });
    const forbidden = () => assert.fail("An occupied incompatible service must not be replaced or duplicated");
    const warnings = [];
    const manager = createPrivateOcrServiceManager({ env: configuration(), isListening: async () => true,
      launchOptions: forbidden, spawnProcess: forbidden, logger: { info() {}, warn(message) { warnings.push(message); } } });
    assert.equal(await manager.warmup(), false);
    assert.match(warnings[0], /incompatible.*Restart.*layout_version=2/);
    manager.stop();
  }
});

test("current health capabilities allow reuse without launching or owning the existing process", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ ready: true, schema_version: 1,
    provider: "paddleocr", layout_version: 2 }));
  const forbidden = () => assert.fail("The compatible existing OCR service must not be replaced or terminated");
  const manager = createPrivateOcrServiceManager({ env: configuration(), isListening: forbidden,
    launchOptions: forbidden, spawnProcess: forbidden, logger: quietLogger });
  assert.equal(await manager.ensureReady(), true);
  manager.stop();
});

test("an occupied unhealthy port cannot spawn a duplicate OCR worker", async () => {
  const forbidden = () => { assert.fail("An occupied port must not spawn another worker"); };
  const warnings = [];
  const manager = createPrivateOcrServiceManager({ env: configuration(), checkHealth: async () => false,
    isListening: async () => true, launchOptions: forbidden, spawnProcess: forbidden,
    logger: { info() {}, warn(message) { warnings.push(message); } } });
  assert.equal(await manager.warmup(), false);
  assert.match(warnings[0], /occupied/);
  manager.stop();
});

test("concurrent startup requests start one worker and shutdown stops only that worker", async () => {
  const child = new Child();
  let checks = 0;
  let launches = 0;
  const manager = createPrivateOcrServiceManager({ env: configuration(), checkHealth: async () => ++checks > 1,
    isListening: async () => false, launchOptions: async () => ({ command: "fixture", args: [], options: {} }),
    spawnProcess: () => { launches++; return child; }, logger: quietLogger });
  assert.deepEqual(await Promise.all([manager.ensureReady(), manager.ensureReady(), manager.ensureReady()]), [true, true, true]);
  assert.equal(launches, 1);
  manager.stop();
  manager.stop();
  assert.equal(child.kills, 1);
});

test("OCR startup timeout kills its worker and reports failure without failing API warmup", async () => {
  const child = new Child();
  const manager = createPrivateOcrServiceManager({ env: configuration(), checkHealth: async () => false,
    isListening: async () => false, launchOptions: async () => ({ command: "fixture", args: [], options: {} }),
    spawnProcess: () => child, logger: quietLogger, startupTimeoutMs: 20, pollIntervalMs: 1 });
  assert.equal(await manager.warmup(), false);
  assert.equal(child.kills, 1);
  manager.stop();
});

test("an early Python process failure returns promptly without an unhandled error", async () => {
  const child = new Child();
  let checks = 0;
  const manager = createPrivateOcrServiceManager({ env: configuration(),
    checkHealth: async () => { if (++checks > 1) child.emit("error", new Error("fixture spawn failure")); return false; },
    isListening: async () => false, launchOptions: async () => ({ command: "fixture", args: [], options: {} }),
    spawnProcess: () => child, logger: quietLogger, startupTimeoutMs: 1000, pollIntervalMs: 1 });
  assert.equal(await manager.warmup(), false);
  assert.equal(checks, 2);
  assert.equal(child.kills, 1);
});

test("shutdown during interpreter lookup prevents a late worker spawn", async () => {
  let readyToStop;
  let finishLookup;
  const lookupStarted = new Promise((resolve) => { readyToStop = resolve; });
  const lookup = new Promise((resolve) => { finishLookup = resolve; });
  const manager = createPrivateOcrServiceManager({ env: configuration(), checkHealth: async () => false,
    isListening: async () => false, launchOptions: () => { readyToStop(); return lookup; },
    spawnProcess: () => assert.fail("Shutdown must prevent a late spawn"), logger: quietLogger });
  const startup = manager.ensureReady();
  await lookupStarted;
  manager.stop();
  finishLookup({ command: "fixture", args: [], options: {} });
  assert.equal(await startup, false);
});

test("local launch options keep OCR credentials in the child environment and preserve shared credentials", async () => {
  const env = configuration({ KYC_PRIVATE_SERVICE_URL: "http://127.0.0.1:8027" });
  const launch = await getPrivateOcrLaunchOptions(env, process.execPath);
  assert.equal(launch.command, process.execPath);
  assert.equal(launch.args[launch.args.indexOf("--port") + 1], "8027");
  assert.equal(launch.args[launch.args.indexOf("--workers") + 1], "1");
  assert.ok(launch.args.includes("--no-access-log"));
  assert.equal(launch.options.windowsHide, true);
  assert.equal(launch.options.env.INTERNAL_API_KEY, env.KYC_PRIVATE_INTERNAL_API_KEY);
  assert.notEqual(env.INTERNAL_API_KEY, env.KYC_PRIVATE_INTERNAL_API_KEY);
  assert.ok(launch.args.every((argument) => !argument.includes(env.KYC_PRIVATE_INTERNAL_API_KEY)));
  const fallback = await getPrivateOcrLaunchOptions(configuration({ KYC_PRIVATE_INTERNAL_API_KEY: undefined }), process.execPath);
  assert.equal(fallback.options.env.INTERNAL_API_KEY, configuration().INTERNAL_API_KEY);
  await assert.rejects(getPrivateOcrLaunchOptions(configuration({ NODE_ENV: "production" }), process.execPath), /separately in production/);
  await assert.rejects(getPrivateOcrLaunchOptions(configuration({ KYC_PRIVATE_INTERNAL_API_KEY: "short" }), process.execPath), /at least 32/);
});
