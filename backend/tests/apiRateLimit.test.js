import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { issuePreKycSession } from "../utils/preKycSession.js";

process.env.ENABLE_RATE_LIMIT = "true";
process.env.JWT_SECRET = "api-rate-limit-fixture-secret-32-characters";
process.env.PRE_KYC_SESSION_SECRET = process.env.JWT_SECRET;
for (const name of ["RATE_LIMIT_GUEST_MAX", "RATE_LIMIT_USER_MAX", "RATE_LIMIT_IP_MAX",
  "RATE_LIMIT_KYC_STATUS_IP_MAX", "RATE_LIMIT_KYC_STATUS_MAX", "RATE_LIMIT_PAYMENT_CREATE_MAX",
  "RATE_LIMIT_MESSAGE_MAX", "RATE_LIMIT_VEHICLE_WRITE_MAX"]) delete process.env[name];

const limits = await import("../middleware/security.middleware.js");
const { default: kycRoutes } = await import("../routes/kyc.routes.js");
const { default: ownerRoutes } = await import("../routes/owner.routes.js");
const { default: bookingRoutes } = await import("../routes/booking.routes.js");
const { default: chatRoutes } = await import("../routes/chat.routes.js");
const { protect } = await import("../middleware/auth.middleware.js");
const { requireKyc } = await import("../middleware/rbac.middleware.js");
const { parseVehicleListing } = await import("../middleware/vehiclePhoto.middleware.js");

const cookie = (id, options = {}) => `token=${jwt.sign({ id }, process.env.JWT_SECRET,
  { expiresIn: "5m", ...options })}`;
const start = async (t, app) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
};
const proxyApp = () => {
  const app = express();
  app.set("trust proxy", "loopback");
  return app;
};
const request = (base, path, ip, session = "", options = {}) => fetch(`${base}${path}`, {
  ...options, headers: { "x-forwarded-for": ip, Cookie: session, ...options.headers },
});
const routeHandlers = (router, path, method) => router.stack.find(
  (layer) => layer.route?.path === path && layer.route.methods[method]
).route.stack.map((layer) => layer.handle);

test("general requests have bounded independent account and guest budgets", async (t) => {
  const app = proxyApp();
  app.use(cookieParser());
  app.use("/api", limits.generalLimiter);
  app.get("/api/items", (_req, res) => res.json({ success: true }));
  const base = await start(t, app);
  for (let n = 0; n < 600; n++) assert.equal((await request(base, "/api/items", "192.0.2.1", cookie("account-a"))).status, 200);
  const denied = await request(base, "/api/items", "192.0.2.1", cookie("account-a"));
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get("retry-after")) > 0);
  assert.equal((await denied.json()).success, false);
  assert.equal((await request(base, "/api/items", "192.0.2.1", cookie("account-b"))).status, 200);
  for (let n = 0; n < 100; n++) assert.equal((await request(base, "/api/items", "192.0.2.1")).status, 200);
  assert.equal((await request(base, "/api/items", "192.0.2.1")).status, 429);
  assert.equal((await request(base, "/api/items", "192.0.2.2")).status, 200);
  for (const session of ["token=forged", cookie("expired", { expiresIn: -1 })]) {
    assert.equal((await request(base, "/api/items", "192.0.2.1", session)).status, 429);
  }
});

test("the early network gate counts signed requests and rejects before body parsing", async (t) => {
  let parsed = 0;
  const app = proxyApp();
  app.use("/api", limits.earlyIpLimiter, limits.healthReadLimiter);
  app.use((_req, _res, next) => { parsed++; next(); });
  app.use(express.json());
  app.post("/api/items", (_req, res) => res.json({ success: true }));
  app.get("/api/health", (_req, res) => res.json({ success: true }));
  app.use((_error, _req, res, _next) => res.status(400).json({ success: false }));
  const base = await start(t, app);
  for (let n = 0; n < 1000; n++) {
    const response = await request(base, "/api/items", "192.0.2.3", cookie(`rotated-${n}`), {
      method: "POST", headers: { "content-type": "application/json" }, body: "{invalid",
    });
    assert.equal(response.status, 400);
  }
  assert.equal(parsed, 1000);
  const denied = await request(base, "/api/items", "192.0.2.3", cookie("new-account"), {
    method: "POST", headers: { "content-type": "application/json" }, body: "{invalid",
  });
  assert.equal(denied.status, 429);
  assert.equal(parsed, 1000, "a rejected request must not reach the parser");
  assert.equal((await request(base, "/api/health", "192.0.2.3")).status, 200);
  for (let n = 1; n < 120; n++) assert.equal((await request(base, "/api/health", "192.0.2.3")).status, 200);
  assert.equal((await request(base, "/api/health", "192.0.2.3")).status, 429);
});

test("verified document polling has a separate bounded budget without consuming registration requests", async (t) => {
  const app = proxyApp();
  app.use("/api", limits.earlyIpLimiter);
  app.use(cookieParser());
  app.use("/api", limits.generalLimiter);
  const statusHandlers = routeHandlers(kycRoutes, "/pre/status", "get").slice(0, -1);
  app.get("/api/kyc/pre/status", ...statusHandlers, (req, res) => res.json({ session: req.preKyc.sessionId }));
  app.get("/api/registration-step", (_req, res) => res.json({ success: true }));
  const base = await start(t, app);
  const session = issuePreKycSession({ email: "polling@example.test", role: "owner" });
  const poll = (token = session.token) => request(base, "/api/kyc/pre/status", "192.0.2.4", "", {
    headers: { "x-pre-kyc-token": token },
  });
  assert.equal((await poll("invalid")).status, 401);
  for (let n = 0; n < 600; n++) assert.equal((await poll()).status, 200);
  assert.equal((await poll()).status, 429);
  assert.equal((await request(base, "/api/registration-step", "192.0.2.4")).status, 200);
  const otherSession = issuePreKycSession({ email: "other-polling@example.test", role: "user" });
  assert.equal((await poll(otherSession.token)).status, 200);
});

test("invalid verification sessions remain bounded by the status IP gate", async (t) => {
  const app = proxyApp();
  app.get("/status", ...routeHandlers(kycRoutes, "/pre/status", "get").slice(0, -1),
    (_req, res) => res.json({ success: true }));
  const base = await start(t, app);
  for (let n = 0; n < 1200; n++) assert.equal((await request(base, "/status", "192.0.2.5")).status, 401);
  assert.equal((await request(base, "/status", "192.0.2.5")).status, 429);
});

test("IPv6 addresses share a subnet budget and untrusted forwarding headers cannot rotate an IP", async (t) => {
  const app = proxyApp();
  app.use("/api", limits.generalLimiter);
  app.get("/api/items", (_req, res) => res.json({ success: true }));
  const base = await start(t, app);
  for (let n = 0; n < 100; n++) assert.equal((await request(base, "/api/items", "2001:db8:abcd:1200::1")).status, 200);
  assert.equal((await request(base, "/api/items", "2001:db8:abcd:1200::2")).status, 429);
  const direct = express();
  direct.set("trust proxy", false);
  direct.use("/api", limits.generalLimiter);
  direct.get("/api/items", (_req, res) => res.json({ success: true }));
  const directBase = await start(t, direct);
  for (let n = 0; n < 100; n++) assert.equal((await request(directBase, "/api/items", `198.51.100.${n + 1}`)).status, 200);
  assert.equal((await request(directBase, "/api/items", "203.0.113.1")).status, 429);
});

test("expensive route budgets run after authorization and before uploads or provider work", async (t) => {
  const cases = [
    { router: bookingRoutes, path: "/:id/pay", method: "post", limiter: limits.paymentCreateLimiter, max: 10 },
    { router: chatRoutes, path: "/messages/:userId", method: "post", limiter: limits.messageSendLimiter, max: 30 },
    { router: ownerRoutes, path: "/vehicles", method: "post", limiter: limits.vehicleWriteLimiter, max: 30 },
    { router: ownerRoutes, path: "/vehicles/:id", method: "put", limiter: limits.vehicleWriteLimiter, max: 30 },
  ];
  for (const [index, item] of cases.entries()) {
    const handlers = routeHandlers(item.router, item.path, item.method);
    const limitIndex = handlers.indexOf(item.limiter);
    assert.ok(limitIndex > handlers.indexOf(protect) && handlers.indexOf(protect) >= 0);
    assert.ok(limitIndex < handlers.length - 1);
    if (item.router === ownerRoutes) {
      assert.ok(limitIndex < handlers.indexOf(parseVehicleListing));
      if (item.method === "post") assert.ok(handlers.indexOf(requireKyc) < limitIndex);
    }
    let actions = 0;
    const app = express();
    app.post("/action", (req, _res, next) => { req.user = { _id: `action-user-${index}` }; next(); },
      item.limiter, (_req, res) => { actions++; res.json({ success: true }); });
    const base = await start(t, app);
    for (let n = 0; n < item.max; n++) assert.equal((await fetch(`${base}/action`, { method: "POST" })).status, 200);
    assert.equal((await fetch(`${base}/action`, { method: "POST" })).status, 429);
    assert.equal(actions, item.max, "blocked requests must not perform the expensive action");
  }
});
