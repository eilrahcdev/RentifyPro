import assert from "node:assert/strict";
import test from "node:test";
import { createOriginChecker } from "../utils/corsOrigins.js";

test("allows documented localhost, IPv4 loopback, and IPv6 loopback frontend origins", () => {
  const { isAllowedOrigin } = createOriginChecker();

  assert.equal(isAllowedOrigin("http://localhost:5173"), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:5173"), true);
  assert.equal(isAllowedOrigin("http://[::1]:5173"), true);
});

test("rejects unconfigured cross-origin callers", () => {
  const { isAllowedOrigin } = createOriginChecker();

  assert.equal(isAllowedOrigin("https://evil.example"), false);
});
