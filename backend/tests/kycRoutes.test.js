import test from "node:test";
import assert from "node:assert/strict";

import kycRouter from "../routes/kyc.routes.js";

const routePaths = kycRouter.stack
  .map((layer) => layer.route?.path)
  .filter(Boolean);

const findRoute = (path, method) => kycRouter.stack.find(
  (layer) => layer.route?.path === path && layer.route.methods?.[method]
);

test("KYC exposes direct selfie verification without blink challenge routes", () => {
  assert.equal(routePaths.includes("/selfie/verify"), true);
  assert.equal(routePaths.includes("/pre/selfie/verify"), true);
  assert.equal(routePaths.includes("/selfie/challenge"), false);
  assert.equal(routePaths.includes("/pre/selfie/challenge"), false);
});

test("pre-registration KYC exposes a protected queue status endpoint", () => {
  const route = findRoute("/pre/status", "get");
  assert.ok(route);
  assert.ok(route.route.stack.length >= 3);
});
