import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { proxyClient } from "../middleware/proxyClient.middleware.js";

test("proxy IPs require a recent signature bound to the IP, method and complete request path", t => {
  const previous = process.env.NETLIFY_PROXY_SECRET;
  const secret = "synthetic-proxy-test-key-with-32-characters";
  process.env.NETLIFY_PROXY_SECRET = secret;
  t.after(() => previous === undefined ? delete process.env.NETLIFY_PROXY_SECRET : process.env.NETLIFY_PROXY_SECRET = previous);
  const timestamp = String(Date.now());
  const ip = "2001:db8::1";
  const signature = createHmac("sha256", secret).update(`${timestamp}\n${ip}\nGET\n/api/auth/me?a=1`).digest("hex");
  const headers = { "x-rentifypro-proxy-ip": ip, "x-rentifypro-proxy-time": timestamp, "x-rentifypro-proxy-signature": signature };
  function check(changes = {}) {
    const req = { method: "GET", originalUrl: "/api/auth/me?a=1", ip: "original-client", headers: { ...headers }, ...changes };
    let accepted = false, status;
    proxyClient(req, { status(code) { status = code; return this; }, json() {} }, () => { accepted = true; });
    return { accepted, status, ip: req.ip };
  }
  assert.deepEqual(check(), { accepted: true, status: undefined, ip });
  assert.deepEqual(check({ headers: {} }), { accepted: true, status: undefined, ip: "original-client" });
  for (const changes of [{ method: "POST" }, { originalUrl: "/api/auth/me?a=2" },
    { headers: { ...headers, "x-rentifypro-proxy-ip": "203.0.113.3" } },
    { headers: { ...headers, "x-rentifypro-proxy-time": String(Date.now() - 120000) } },
    { headers: { ...headers, "x-rentifypro-proxy-signature": "forged" } },
    { headers: { ...headers, "x-rentifypro-proxy-signature": [signature] } },
    { headers: { "x-rentifypro-proxy-ip": ip } }]) {
    assert.deepEqual(check(changes), { accepted: false, status: 403, ip: "original-client" });
  }
});
