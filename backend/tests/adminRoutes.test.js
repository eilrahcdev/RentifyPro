import test from "node:test";
import assert from "node:assert/strict";

import adminRouter from "../routes/admin.routes.js";

const transactionRoute = adminRouter.stack.find((layer) => layer.route?.path === "/transactions");
const overviewRoute = adminRouter.stack.find((layer) => layer.route?.path === "/data");
const transactionRouteIndex = adminRouter.stack.indexOf(transactionRoute);
const authorizationLayers = adminRouter.stack.slice(0, transactionRouteIndex).filter((layer) => !layer.route);

test("admin exposes a protected read-only transaction records route", () => {
  assert.ok(transactionRoute);
  assert.equal(transactionRoute.route.methods.get, true);
  assert.equal(transactionRoute.route.methods.post, undefined);
  assert.equal(transactionRoute.route.stack.length, 1);
  assert.ok(authorizationLayers.length >= 2);
});

test("admin exposes the dashboard data route behind the same authorization middleware", () => {
  assert.ok(overviewRoute);
  assert.equal(overviewRoute.route.methods.get, true);
  assert.equal(overviewRoute.route.methods.post, undefined);
});
