import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { once } from "node:events";
import { proxyRequest } from "../netlify/edge-functions/backend.js";
import { proxyClient } from "../../backend/middleware/proxyClient.middleware.js";

const backendRequire = createRequire(new URL("../../backend/package.json", import.meta.url));
const frontendRequire = createRequire(new URL("../package.json", import.meta.url));
const express = backendRequire("express"), cookieParser = backendRequire("cookie-parser"), jwt = backendRequire("jsonwebtoken");
const { io: connect } = frontendRequire("socket.io-client");

test("first-party proxy cookies authenticate profile requests and real Socket.IO polling notifications", { timeout: 15000 }, async t => {
  const previous = { JWT_SECRET: process.env.JWT_SECRET, NETLIFY_PROXY_SECRET: process.env.NETLIFY_PROXY_SECRET, FRONTEND_URL: process.env.FRONTEND_URL };
  Object.assign(process.env, { JWT_SECRET: "synthetic-socket-test-secret", NETLIFY_PROXY_SECRET: "synthetic-edge-proxy-key-at-least-32-characters", FRONTEND_URL: "https://rentifypro.netlify.app" });
  t.after(() => { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  const { initSocket } = await import("../../backend/socket/index.js");
  const { protect } = await import("../../backend/middleware/auth.middleware.js");
  const { default: User } = await import("../../backend/models/User.js");
  const { default: RevokedSession } = await import("../../backend/models/RevokedSession.js");
  const user = { _id: "507f1f77bcf86cd799439011", role: "user", isVerified: true, kycStatus: "challenge_passed", sessionVersion: 0 };
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  t.mock.method(RevokedSession, "exists", async () => false);
  const token = jwt.sign({ id: user._id, role: user.role, sessionVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const app = express();
  app.use(proxyClient, cookieParser());
  app.post("/api/synthetic-login", (_req, res) => {
    res.cookie("token", token, { httpOnly: true, secure: true, sameSite: "none", path: "/" });
    res.json({ success: true });
  });
  app.get("/api/auth/me", protect, (req, res) => res.json({ user: req.user, clientIp: req.ip }));
  const upstream = http.createServer(app);
  const io = initSocket(upstream);
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamBase = `http://127.0.0.1:${upstream.address().port}`;
  const gateway = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = new Request("https://rentifypro.netlify.app" + req.url, { method: req.method, headers: req.headers,
        ...(!["GET", "HEAD"].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
      const response = await proxyRequest(request, { ip: "203.0.113.9", secret: process.env.NETLIFY_PROXY_SECRET,
        fetchUpstream: outgoing => {
          const url = new URL(outgoing.url);
          return fetch(new Request(upstreamBase + url.pathname + url.search, outgoing));
        } });
      res.statusCode = response.status;
      for (const [key, value] of response.headers) if (key !== "set-cookie") res.setHeader(key, value);
      if (response.headers.getSetCookie().length) res.setHeader("Set-Cookie", response.headers.getSetCookie());
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(502); res.end(); }
  });
  await new Promise(resolve => gateway.listen(0, "127.0.0.1", resolve));
  const gatewayBase = `http://127.0.0.1:${gateway.address().port}`;
  let client;
  t.after(async () => {
    client?.disconnect();
    await new Promise(resolve => io.close(resolve));
    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
  });
  assert.equal((await fetch(gatewayBase + "/api/auth/me")).status, 401);
  const login = await fetch(gatewayBase + "/api/synthetic-login", { method: "POST" });
  assert.match(login.headers.get("Set-Cookie"), /HttpOnly/);
  assert.doesNotMatch(login.headers.get("Set-Cookie"), /Domain=/i);
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  const profile = await fetch(gatewayBase + "/api/auth/me", { headers: { Cookie: cookie } });
  assert.equal(profile.status, 200);
  assert.match(profile.headers.get("Cache-Control"), /no-store/);
  const data = await profile.json();
  assert.equal(data.user.kycStatus, "challenge_passed");
  assert.equal(data.clientIp, "203.0.113.9");
  client = connect(gatewayBase, { transports: ["polling"], upgrade: false, autoConnect: false,
    extraHeaders: { Cookie: cookie, Origin: "https://rentifypro.netlify.app" }, reconnection: false });
  const connected = Promise.race([once(client, "connect"), once(client, "connect_error").then(([error]) => { throw error; })]);
  client.connect(); await connected;
  assert.equal(client.io.engine.transport.name, "polling");
  const notification = once(client, "notification:new");
  io.to(`user:${user._id}`).emit("notification:new", { event: "verification.document_approved" });
  assert.equal((await notification)[0].event, "verification.document_approved");
});
