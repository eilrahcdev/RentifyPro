import test from "node:test";
import assert from "node:assert/strict";
import { getAdminSecurityConfiguration, requireCrossSiteAdminOrigin } from "../config/adminSecurity.js";

test("production cookie and ingress configuration fail closed without weakening local defaults", () => {
  assert.equal(getAdminSecurityConfiguration({}).sameSite, "lax");
  assert.throws(() => getAdminSecurityConfiguration({ ADMIN_COOKIE_SAME_SITE: "none" }), /HTTPS/);
  assert.throws(() => getAdminSecurityConfiguration({ TRUST_PROXY_HOPS: "true" }), /integer/);
  assert.throws(() => getAdminSecurityConfiguration({ NODE_ENV: "production" }), /JWT_SECRET/);
  const env = { NODE_ENV: "production", JWT_SECRET: "a".repeat(40), ADMIN_PASSWORD_HASH: "$2b$12$" + "a".repeat(53), CLIENT_ORIGIN: "https://admin.example.test" };
  assert.equal(getAdminSecurityConfiguration({ ...env, ADMIN_COOKIE_SAME_SITE: "none" }).sameSite, "none");
  assert.throws(() => getAdminSecurityConfiguration({ ...env, CLIENT_ORIGIN: "http://admin.example.test" }), /HTTPS/);
});
test("cross-site session mutations require the exact configured origin", () => {
  const guard = requireCrossSiteAdminOrigin({ sameSite: "none", allowedOrigins: new Set(["https://admin.example.test"]), cookieName: "admin" });
  for (const origin of [undefined, "https://untrusted.example.test"]) {
    let status;
    guard({ method: "POST", cookies: { admin: "synthetic" }, get: () => origin }, { status(value) { status = value; return this; }, json() {} }, () => assert.fail("Origin rejected"));
    assert.equal(status, 403);
  }
  let next = false;
  guard({ method: "POST", cookies: { admin: "synthetic" }, get: () => "https://admin.example.test" }, {}, () => { next = true; });
  assert.equal(next, true);
});
