import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import axios from "axios";
import { getChatbotServiceHeaders } from "../utils/chatbotServiceAuth.js";
import { isChatbotServiceHealthy } from "../utils/chatbotServiceManager.js";

const key = "chatbot-security-fixture-key-32-characters";
const configuration = (t, values) => {
  for (const [name, value] of Object.entries(values)) {
    const previous = process.env[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
};

test("service headers prefer a dedicated key, fall back to the shared key, and reject missing or weak keys", (t) => {
  configuration(t, { INTERNAL_API_KEY: key, CHATBOT_INTERNAL_API_KEY: undefined });
  assert.deepEqual(getChatbotServiceHeaders(), { "x-internal-key": key });
  process.env.CHATBOT_INTERNAL_API_KEY = `dedicated-${key}`;
  assert.deepEqual(getChatbotServiceHeaders(), { "x-internal-key": `dedicated-${key}` });
  process.env.CHATBOT_INTERNAL_API_KEY = "  ";
  assert.deepEqual(getChatbotServiceHeaders(), { "x-internal-key": key });
  for (const weak of [undefined, "", "short-key"]) {
    delete process.env.CHATBOT_INTERNAL_API_KEY;
    if (weak === undefined) delete process.env.INTERNAL_API_KEY; else process.env.INTERNAL_API_KEY = weak;
    assert.throws(getChatbotServiceHeaders, { code: "CHATBOT_SERVICE_KEY_MISSING" });
  }
  process.env.INTERNAL_API_KEY = key;
  process.env.CHATBOT_INTERNAL_API_KEY = "short-dedicated-key";
  assert.throws(getChatbotServiceHeaders, { code: "CHATBOT_SERVICE_KEY_MISSING" });
});

test("readiness requires a real successful health response and never follows redirects", async (t) => {
  for (const status of [401, 403, 404, 503]) {
    t.mock.method(axios, "get", async (url, options) => {
      assert.equal(url, "https://chat.example.test/service/health");
      assert.equal(options.maxRedirects, 0);
      return { status, data: { status: "ok" } };
    });
    assert.equal(await isChatbotServiceHealthy("https://chat.example.test/service/"), false);
    t.mock.restoreAll();
  }
  for (const [data, expected] of [[{ status: "ok" }, true], [{ status: "error" }, false], ["OK", false]]) {
    t.mock.method(axios, "get", async () => ({ status: 200, data }));
    assert.equal(await isChatbotServiceHealthy("https://chat.example.test"), expected);
    t.mock.restoreAll();
  }
});

test("guest chat authenticates its service call and service key failures never become browser login failures", async (t) => {
  configuration(t, { INTERNAL_API_KEY: key, CHATBOT_INTERNAL_API_KEY: key, CHATBOT_URL: "https://chat.example.test",
    CHATBOT_SERVICE_AUTOSTART: "false", ENABLE_RATE_LIMIT: "false" });
  const { default: chatRoutes } = await import("../routes/chat.routes.js");
  t.mock.method(axios, "get", async () => ({ status: 200, data: { status: "ok" } }));
  let calls = 0;
  let upstreamStatus = 403;
  t.mock.method(axios, "post", async (_url, _payload, options) => {
    calls++;
    assert.equal(options.headers["x-internal-key"], key);
    assert.equal(options.maxRedirects, 0);
    const error = new Error("fixture denial");
    error.isAxiosError = true;
    error.response = { status: upstreamStatus, data: { detail: `private fixture ${key}` } };
    throw error;
  });
  const app = express();
  app.use(express.json());
  app.use("/api/chat", chatRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const post = () => fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "payment methods" }),
  });
  for (const status of [401, 403, 503]) {
    upstreamStatus = status;
    const response = await post();
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private fixture|sign in|login|chatbot-security-fixture/i);
  }
  assert.equal(calls, 3);
  delete process.env.INTERNAL_API_KEY;
  delete process.env.CHATBOT_INTERNAL_API_KEY;
  assert.equal((await post()).status, 503);
  assert.equal(calls, 3, "missing keys must fail before any classifier request");
});
