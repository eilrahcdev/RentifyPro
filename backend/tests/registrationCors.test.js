import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import express from "express";
import cors from "cors";
import { createOriginChecker } from "../utils/corsOrigins.js";
import { getRegistrationDraft, registrationDraftGuard } from "../controllers/registrationDraft.controller.js";

const frontendOrigin = "http://localhost:5173";
const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const originHandler = serverSource.match(/^const corsOriginHandler = [\s\S]*?^};/m)?.[0];
const corsMiddleware = serverSource.match(/^app\.use\(cors\(\{[\s\S]*?^}\)\);/m)?.[0];
assert.ok(originHandler && corsMiddleware, "The server must declare its CORS middleware and origin handler");

async function startServer(t) {
  const previous = { NODE_ENV: process.env.NODE_ENV, FRONTEND_URL: process.env.FRONTEND_URL,
    ALLOW_VERCEL_PREVIEW_ORIGINS: process.env.ALLOW_VERCEL_PREVIEW_ORIGINS };
  process.env.NODE_ENV = "production";
  process.env.FRONTEND_URL = frontendOrigin;
  process.env.ALLOW_VERCEL_PREVIEW_ORIGINS = "false";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const app = express();
  // Exercise the server's actual CORS declaration without starting jobs or connecting to MongoDB.
  vm.runInNewContext(`${originHandler}\n${corsMiddleware}`, {
    app, cors, isAllowedOrigin: createOriginChecker().isAllowedOrigin,
  });
  app.get("/api/kyc/pre/draft", registrationDraftGuard, getRegistrationDraft);
  app.post("/api/kyc/pre/draft", registrationDraftGuard, (_req, res) => res.sendStatus(204));
  app.delete("/api/kyc/pre/draft", registrationDraftGuard, (_req, res) => res.sendStatus(204));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ success: false }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

const headerSet = (response, name) => new Set((response.headers.get(name) || "").toLowerCase().split(",").map(value => value.trim()));

test("credentialed renter and owner draft/OTP preflights permit the required registration header", async t => {
  const base = await startServer(t);
  for (const role of ["user", "owner"]) {
    for (const [method, action] of [["GET", ""], ["POST", ""], ["DELETE", ""], ["POST", "/otp/send"], ["POST", "/otp/verify"]]) {
      const response = await fetch(`${base}/api/kyc/pre/draft${action}?role=${role}`, {
        method: "OPTIONS", headers: { Origin: frontendOrigin, "Access-Control-Request-Method": method,
          "Access-Control-Request-Headers": "content-type,x-registration-draft" },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get("access-control-allow-origin"), frontendOrigin);
      assert.equal(response.headers.get("access-control-allow-credentials"), "true");
      assert.ok(headerSet(response, "access-control-allow-methods").has(method.toLowerCase()));
      assert.ok(headerSet(response, "access-control-allow-headers").has("content-type"));
      assert.ok(headerSet(response, "access-control-allow-headers").has("x-registration-draft"), `${role} ${method} ${action || "/draft"}: browser would block the required draft header`);
      assert.match(response.headers.get("vary") || "", /Origin/i);
    }
  }
});

test("allowed cross-origin recovery reaches the real controller while the draft guard stays enforced", async t => {
  const base = await startServer(t);
  for (const role of ["user", "owner"]) {
    const response = await fetch(`${base}/api/kyc/pre/draft?role=${role}`, {
      headers: { Origin: frontendOrigin, "x-registration-draft": "1" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, draft: null });
    assert.equal(response.headers.get("access-control-allow-origin"), frontendOrigin);
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  }
  for (const method of ["GET", "POST", "DELETE"]) {
    const response = await fetch(`${base}/api/kyc/pre/draft?role=user`, { method, headers: { Origin: frontendOrigin } });
    assert.equal(response.status, 403, `${method} must still require the anti-CSRF header`);
  }
  const invalidRole = await fetch(`${base}/api/kyc/pre/draft?role=admin`, {
    headers: { Origin: frontendOrigin, "x-registration-draft": "1" },
  });
  assert.equal(invalidRole.status, 400);
});

test("untrusted origins and unrelated headers remain disallowed, with existing credential headers preserved", async t => {
  const base = await startServer(t);
  const denied = await fetch(`${base}/api/kyc/pre/draft?role=user`, {
    method: "OPTIONS", headers: { Origin: "https://attacker.example", "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,x-registration-draft" },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  const allowed = await fetch(`${base}/api/kyc/pre/draft?role=user`, {
    method: "OPTIONS", headers: { Origin: frontendOrigin, "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,x-unrelated-header" },
  });
  const headers = headerSet(allowed, "access-control-allow-headers");
  for (const name of ["content-type", "authorization", "x-internal-key", "x-pre-kyc-token"]) assert.ok(headers.has(name));
  assert.equal(headers.has("x-unrelated-header"), false);
  assert.equal(headers.has("*"), false);
  for (const name of ["retry-after", "ratelimit", "ratelimit-policy"]) assert.ok(headerSet(allowed, "access-control-expose-headers").has(name));
});
