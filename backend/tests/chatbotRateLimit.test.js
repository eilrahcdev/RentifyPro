import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";

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
    assert.equal(duplicate.status, 429);
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
