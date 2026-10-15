import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { createChatbotProtection, chatbotProtectionConfig } from "../middleware/chatbotProtection.js";

process.env.ENABLE_RATE_LIMIT = "true";
process.env.JWT_SECRET = process.env.JWT_SECRET || "chatbot-rate-limit-test-secret";

const { chatbotConcurrencyGuard, chatbotLimiter } = await import(
  "../middleware/security.middleware.js"
);

const sessionCookie = (id) =>
  `token=${jwt.sign({ id, role: "user", sessionVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "5m" })}`;

const listen = async (app) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
};

const close = async (server) => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
};

const post = (url, cookie, body = {}) =>
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });

test("chatbot limiter counts successful signed-in requests and isolates user budgets", async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.post("/api/chat", chatbotLimiter, (_req, res) => res.json({ success: true }));
  const server = await listen(app);

  try {
    const url = `http://127.0.0.1:${server.address().port}/api/chat`;
    const firstUser = sessionCookie("chatbot-limit-user-a");
    const secondUser = sessionCookie("chatbot-limit-user-b");

    for (let count = 0; count < 20; count += 1) {
      assert.equal((await post(url, firstUser)).status, 200);
    }

    const limited = await post(url, firstUser);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.match(limited.headers.get("cache-control") || "", /no-store/i);
    assert.match((await limited.json()).message, /too many chatbot requests/i);

    assert.equal((await post(url, secondUser)).status, 200);

    for (let count = 0; count < 20; count += 1) {
      assert.equal((await post(url, "")).status, 200);
    }
    const anonymousLimited = await post(url, "");
    assert.equal(anonymousLimited.status, 429);
    assert.ok(Number(anonymousLimited.headers.get("retry-after")) > 0);
  } finally {
    await close(server);
  }
});

test("chatbot concurrency guard permits one in-flight request per user and releases it", async () => {
  let releaseHeldRequest;
  let markHeldRequestStarted;
  const heldRequestStarted = new Promise((resolve) => {
    markHeldRequestStarted = resolve;
  });
  const heldRequest = new Promise((resolve) => {
    releaseHeldRequest = resolve;
  });

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.post("/api/chat", chatbotLimiter, chatbotConcurrencyGuard, async (req, res) => {
    if (req.body?.hold) {
      markHeldRequestStarted();
      await heldRequest;
    }
    res.json({ success: true });
  });
  const server = await listen(app);

  try {
    const url = `http://127.0.0.1:${server.address().port}/api/chat`;
    const firstUser = sessionCookie("chatbot-concurrency-user-a");
    const secondUser = sessionCookie("chatbot-concurrency-user-b");
    const firstResponsePromise = post(url, firstUser, { hold: true });
    await heldRequestStarted;

    const duplicate = await post(url, firstUser);
    assert.equal(duplicate.status, 503);
    assert.ok(Number(duplicate.headers.get("retry-after")) > 0);
    assert.equal((await duplicate.json()).reason, "chatbot_request_in_progress");

    assert.equal((await post(url, secondUser)).status, 200);

    releaseHeldRequest();
    assert.equal((await firstResponsePromise).status, 200);
    assert.equal((await post(url, firstUser)).status, 200);
  } finally {
    releaseHeldRequest?.();
    await close(server);
  }
});

test("configured burst quota rejects retries and resumes the saved context at the exact boundary", async () => {
  const limits = chatbotProtectionConfig({});
  let clock = Date.now();
  const protection = createChatbotProtection({ config: limits, enabled: true,
    secret: process.env.JWT_SECRET, now: () => clock });
  const context = { intent: "how_to_book", entities: { brand: null, model: null },
    assistant_action: "instructions", requested_answer_type: "instructions", topic: "booking", choices: [] };
  const saved = structuredClone(context);
  let admitted = 0;
  const app = express(); app.use(express.json()); app.use(cookieParser());
  app.post("/api/chat", protection.concurrencyGuard, protection.limiter, (req, res) => {
    admitted += 1;
    res.json({ conversation_context: req.body.conversationContext });
  });
  const server = await listen(app);
  const url = `http://127.0.0.1:${server.address().port}/api/chat`;
  const identity = sessionCookie("configured-quota-context");
  try {
    for (let count = 0; count < limits.burstMax; count += 1) {
      const response = await post(url, identity, { conversationContext: context });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).conversation_context, saved);
    }
    const quota = () => structuredClone([...protection.store.records].filter(([key]) => key !== "concurrency"));
    const before = quota();
    for (let retry = 0; retry < 3; retry += 1) {
      const response = await post(url, identity, { conversationContext: context });
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("retry-after"), String(Math.ceil(limits.burstWindowMs / 1000)));
      const body = await response.json();
      assert.equal(body.code, "CHAT_RATE_LIMITED");
      assert.equal(body.layer, "burst");
      assert.equal(body.retryAfterMs, limits.burstWindowMs);
      assert.equal(body.conversation_context, undefined);
      assert.deepEqual(quota(), before);
      assert.deepEqual(context, saved);
    }
    assert.equal(admitted, limits.burstMax);
    clock += limits.burstWindowMs;
    const resumed = await post(url, identity, { conversationContext: context });
    assert.equal(resumed.status, 200);
    assert.deepEqual((await resumed.json()).conversation_context, saved);
    assert.equal(admitted, limits.burstMax + 1);
  } finally { await close(server); }
});

test("the real chatbot route applies both guards and stops classification at the configured quota", { timeout: 10000 }, async () => {
  const names = ["INTERNAL_API_KEY", "CHATBOT_INTERNAL_API_KEY", "CHATBOT_URL", "CHATBOT_SERVICE_AUTOSTART"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const serviceKey = "route-quota-test-service-secret-32-characters";
  const limits = chatbotProtectionConfig({});
  let classified = 0;
  const context = { intent: "how_to_book", entities: { brand: null, model: null },
    clarification: { required: false, type: null, field: null }, requested_answer_type: "instructions",
    assistant_action: "instructions", topic: "booking", choices: [] };
  const saved = structuredClone(context);
  const classifier = express(); classifier.use(express.json());
  classifier.get("/health", (_req, res) => res.json({ status: "ok" }));
  classifier.post("/chat", (req, res) => {
    assert.equal(req.get("x-internal-key"), serviceKey);
    assert.deepEqual(req.body.previous_context, saved);
    classified += 1;
    res.json({ intent: "how_to_book", confidence: 0.99, language: "en", topic: "booking",
      requested_answer_type: "instructions", entities: {}, conditions: {} });
  });
  let classifierServer, apiServer;
  try {
    classifierServer = await listen(classifier);
    process.env.INTERNAL_API_KEY = serviceKey; process.env.CHATBOT_INTERNAL_API_KEY = serviceKey;
    process.env.CHATBOT_URL = `http://127.0.0.1:${classifierServer.address().port}`;
    process.env.CHATBOT_SERVICE_AUTOSTART = "false";
    const { default: chatRoutes } = await import("../routes/chat.routes.js");
    const handlers = chatRoutes.stack.find(layer => layer.route?.path === "/" && layer.route.methods.post).route.stack.map(layer => layer.handle);
    assert.ok(handlers.includes(chatbotConcurrencyGuard));
    assert.ok(handlers.includes(chatbotLimiter));
    const app = express(); app.use(express.json()); app.use(cookieParser()); app.use("/api/chat", chatRoutes);
    apiServer = await listen(app);
    const url = `http://127.0.0.1:${apiServer.address().port}/api/chat`;
    const identity = sessionCookie("actual-route-quota");
    for (let count = 0; count < limits.burstMax; count += 1) {
      const response = await post(url, identity, { message: "How do I book?", conversationContext: context });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.intent, "how_to_book");
      assert.equal(body.conversation_context.intent, saved.intent);
      assert.equal(body.conversation_context.assistant_action, saved.assistant_action);
    }
    const rejected = await post(url, identity, { message: "How do I book?", conversationContext: context });
    assert.equal(rejected.status, 429);
    assert.equal((await rejected.json()).code, "CHAT_RATE_LIMITED");
    assert.equal(classified, limits.burstMax);
    assert.deepEqual(context, saved);
  } finally {
    if (apiServer) await close(apiServer);
    if (classifierServer) await close(classifierServer);
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
