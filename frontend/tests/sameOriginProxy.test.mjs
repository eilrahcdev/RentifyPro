import test from "node:test";
import assert from "node:assert/strict";
import { proxyRequest } from "../netlify/edge-functions/backend.js";
import { readApiResponse } from "../src/utils/readApiResponse.js";
import { proxyClient } from "../../backend/middleware/proxyClient.middleware.js";

const secret = "synthetic-proxy-test-key-with-32-characters";
const ip = "203.0.113.9";
function validate(request, t) {
  const previous = process.env.NETLIFY_PROXY_SECRET;
  process.env.NETLIFY_PROXY_SECRET = secret;
  t.after(() => previous === undefined ? delete process.env.NETLIFY_PROXY_SECRET : process.env.NETLIFY_PROXY_SECRET = previous);
  const url = new URL(request.url);
  const req = { headers: Object.fromEntries(request.headers), method: request.method, originalUrl: url.pathname + url.search, ip: "proxy-hop" };
  let status, accepted = false;
  proxyClient(req, { status(code) { status = code; return this; }, json() {} }, () => { accepted = true; });
  return { req, accepted, status };
}

test("the edge forwards cookies and body to the fixed backend and signs the real client IP", async t => {
  const response = await proxyRequest(new Request("https://rentifypro.netlify.app/api/auth/login?source=mobile", {
    method: "POST", body: '{"fixture":true}', headers: { Cookie: "draft=fixture", "Content-Type": "application/json",
      "x-rentifypro-proxy-ip": "198.51.100.1", "x-rentifypro-proxy-signature": "forged", "x-forwarded-for": "198.51.100.1" },
  }), { ip, secret, fetchUpstream: async request => {
    assert.equal(new URL(request.url).origin, "https://rentifypro-api.azurewebsites.net");
    assert.equal(await request.text(), '{"fixture":true}');
    assert.equal(request.headers.get("cookie"), "draft=fixture");
    assert.equal(request.headers.get("origin"), "https://rentifypro.netlify.app");
    assert.equal(request.headers.has("x-forwarded-for"), false);
    const checked = validate(request, t);
    assert.equal(checked.accepted, true);
    assert.equal(checked.req.ip, ip);
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", "token=synthetic; Secure; HttpOnly; SameSite=None; Path=/");
    headers.append("Set-Cookie", "draft=synthetic; Secure; HttpOnly; Path=/api");
    return new Response('{"success":true}', { headers });
  } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.match(response.headers.getSetCookie()[0], /HttpOnly/);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.equal(response.headers.get("Netlify-CDN-Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { success: true });
});

test("streamed face checks send headers before upstream finishes and preserve errors and retry information", async () => {
  for (const status of [200, 400, 401, 403, 429, 500]) {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const response = await proxyRequest(new Request("https://rentifypro.netlify.app/api/kyc/selfie/verify", {
      method: "POST", body: "{}",
    }), { ip, secret, fetchUpstream: () => pending });
    assert.equal(response.headers.get("X-RentifyPro-Proxy-Envelope"), "1");
    const reader = response.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /^\s+$/);
    finish(Response.json({ success: status === 200, code: "SYNTHETIC_STATUS", message: "Synthetic outcome" }, { status, headers: { "Retry-After": "60" } }));
    const rest = await reader.read();
    const wrapped = new Response(rest.value, { headers: response.headers });
    const resolved = await readApiResponse(wrapped);
    assert.equal(resolved.response.status, status);
    assert.equal(resolved.response.ok, status === 200);
    assert.equal(resolved.data.code, "SYNTHETIC_STATUS");
    assert.equal(resolved.response.headers.get("Retry-After"), "60");
    assert.equal((await reader.read()).done, true);
  }
});

test("cookie-changing routes and ordinary API errors keep normal HTTP semantics", async () => {
  for (const path of ["/api/auth/login", "/api/auth/logout", "/api/kyc/pre/session", "/api/kyc/pre/draft", "/api/kyc/me", "/socket.io/?EIO=4&transport=polling"]) {
    const result = await proxyRequest(new Request("https://rentifypro.netlify.app" + path, { method: "POST", body: "{}" }), {
      ip, secret, fetchUpstream: async () => Response.json({ message: "No session" }, { status: 401 }),
    });
    assert.equal(result.status, 401);
    assert.equal(result.headers.has("X-RentifyPro-Proxy-Envelope"), false);
  }
});

test("missing proxy configuration and interrupted upstream calls fail without success responses", async () => {
  const request = () => new Request("https://rentifypro.netlify.app/api/auth/me");
  assert.equal((await proxyRequest(request(), { ip, secret: "" })).status, 503);
  assert.equal((await proxyRequest(request(), { ip, secret, fetchUpstream: async () => { throw new Error("Synthetic outage"); } })).status, 502);
  await assert.rejects(readApiResponse(Response.json({ status: 999, body: {} }, { headers: { "X-RentifyPro-Proxy-Envelope": "1" } })), { status: 502 });
});
