import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/check-external-services.js", import.meta.url));
const source = new URL("../../chatbot-service/", import.meta.url);
const revision = readFileSync(new URL("app.py", source), "utf8").match(/"routing_revision":\s*"([^"]+)"/)[1];
const dataset = readFileSync(new URL("rentifypro_chatbot_dataset_v6.json", source));
const metadata = {
  status: "ok",
  routing_revision: revision,
  intent_count: JSON.parse(dataset).items.length,
  dataset_sha256: createHash("sha256").update(dataset).digest("hex"),
  config_sha256: createHash("sha256").update(readFileSync(new URL("chatbot_config.json", source))).digest("hex"),
};
const key = "fixture-only-local-configuration-key-32-characters";
const run = (url, extraEnv = {}, args = ["--chatbot-local"]) => new Promise(resolve => {
  execFile(process.execPath, [script, ...args], {
    cwd: tmpdir(), timeout: 15000,
    env: { ...process.env, NODE_ENV: "development", FACE_SERVICE_URL: "", CHATBOT_URL: url,
      INTERNAL_API_KEY: "", CHATBOT_INTERNAL_API_KEY: key, ...extraEnv },
  }, (error, stdout, stderr) => resolve({ code: error?.code || 0, output: stdout + stderr }));
});
const fixture = async (t, value) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const health = req.url === "/health";
    const authorized = req.headers["x-internal-key"] === key;
    res.writeHead(health || authorized ? 200 : 403, { "content-type": "application/json" });
    res.end(JSON.stringify(health ? { status: "ok" } : authorized ? value : { detail: "Forbidden" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
};

test("local check rejects the previously hosted revision and intent count", async t => {
  const server = await fixture(t, { ...metadata, routing_revision: "topic-followups-2026-10-02", intent_count: 59 });
  const result = await run(server.url);
  assert.equal(result.code, 1);
  assert.match(result.output, /routing_revision|intent_count/);
  assert.doesNotMatch(result.output, new RegExp(key));
});

test("local check verifies current source metadata and preserves service authentication", async t => {
  const server = await fixture(t, metadata);
  const result = await run(server.url);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, new RegExp(revision));
  assert.match(result.output, new RegExp(`${metadata.intent_count} intents`));
  assert.deepEqual(server.requests, ["/health", "/", "/"]);
  assert.doesNotMatch(result.output, new RegExp(key));
});

test("local check rejects stale assets even when the revision matches", async t => {
  const server = await fixture(t, { ...metadata, dataset_sha256: "0".repeat(64) });
  const result = await run(server.url);
  assert.equal(result.code, 1);
  assert.match(result.output, /dataset_sha256/);
});

test("local check diagnoses an unreachable service without choosing another URL", async () => {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  await new Promise(resolve => server.close(resolve));
  const result = await run(url);
  assert.equal(result.code, 1);
  assert.match(result.output, /Start.*Python|start.*Python/);
  assert.match(result.output, /no fallback/i);
  assert.doesNotMatch(result.output, new RegExp(key));
});

test("local check refuses hosted URLs and production mode before making requests", async () => {
  const hosted = await run("https://example.invalid");
  assert.equal(hosted.code, 1);
  assert.match(hosted.output, /loopback|local.*URL/i);
  const production = await run("http://127.0.0.1:8001", { NODE_ENV: "production" });
  assert.equal(production.code, 1);
  assert.match(production.output, /production/i);
});

test("general service checks retain their existing production behavior without the local flag", async t => {
  const server = await fixture(t, { ...metadata, routing_revision: "topic-followups-2026-10-02", intent_count: 59 });
  const result = await run(server.url, { NODE_ENV: "production" }, []);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /External service checks passed/);
  assert.doesNotMatch(result.output, /\[LOCAL\]|Local Python/);
  assert.deepEqual(server.requests, ["/health", "/", "/"]);
});
