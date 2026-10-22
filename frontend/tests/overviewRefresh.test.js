import test from "node:test";
import assert from "node:assert/strict";
import { startOverviewRefresh } from "../src/admin/overviewRefresh.js";
import { isOutstandingBooking, transactionFilterQuery } from "../../shared/adminApiContract.js";

function setup(t, refresh) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const browserWindow = new EventTarget();
  const browserDocument = new EventTarget();
  browserDocument.visibilityState = "visible";
  let paused = false, busy = false;
  const stop = startOverviewRefresh({ refresh, browserWindow, browserDocument, isPaused: () => paused, isBusy: () => busy });
  t.after(stop);
  return { browserWindow, browserDocument, pause: value => { paused = value; }, busy: value => { busy = value; } };
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test("overview polling refreshes time-based counters and stops cleanly", async t => {
  let calls = 0;
  const env = setup(t, async () => { calls++; return {}; });
  t.mock.timers.tick(60000); await settle(); assert.equal(calls, 1);
  env.browserDocument.visibilityState = "hidden";
  t.mock.timers.tick(60000); await settle(); assert.equal(calls, 1);
  env.browserDocument.visibilityState = "visible";
  env.browserDocument.dispatchEvent(new Event("visibilitychange")); await settle(); assert.equal(calls, 2);
  env.browserWindow.dispatchEvent(new Event("focus")); await settle(); assert.equal(calls, 2);
});

test("reviews and manual requests pause automatic refresh; focus events cannot overlap requests", async t => {
  let calls = 0, finish;
  const env = setup(t, () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  env.pause(true); t.mock.timers.tick(60000); await settle(); assert.equal(calls, 0);
  env.pause(false); env.busy(true); t.mock.timers.tick(60000); await settle(); assert.equal(calls, 0);
  env.busy(false); env.browserWindow.dispatchEvent(new Event("focus")); await settle(); assert.equal(calls, 1);
  t.mock.timers.tick(60000); env.browserWindow.dispatchEvent(new Event("focus")); await settle(); assert.equal(calls, 1);
  finish({}); await settle(); t.mock.timers.tick(60000); await settle(); assert.equal(calls, 2);
  finish({}); await settle();
});

test("automatic failures back off and focus cannot bypass the retry delay", async t => {
  let calls = 0;
  const env = setup(t, async () => { calls++; return undefined; });
  t.mock.timers.tick(60000); await settle(); assert.equal(calls, 1);
  t.mock.timers.tick(60000); env.browserWindow.dispatchEvent(new Event("focus")); await settle(); assert.equal(calls, 1);
  t.mock.timers.tick(60000); await settle(); assert.equal(calls, 2);
});

test("actionable balance filters retain partial and completed unpaid records but exclude closed and refunded history", () => {
  const original = { status: "confirmed", paymentStatus: "partial", paymentAmountDue: 70 };
  assert.equal(isOutstandingBooking(original), true);
  assert.equal(isOutstandingBooking({ ...original, status: "Completed" }), true);
  for (const status of ["Cancelled", "rejected"]) assert.equal(isOutstandingBooking({ ...original, status }), false);
  assert.equal(isOutstandingBooking({ ...original, paymentStatus: "refunded" }), false);
  for (const paymentAmountDue of [0, -1, undefined, "invalid", Infinity]) assert.equal(isOutstandingBooking({ ...original, paymentAmountDue }), false);
  assert.deepEqual(original, { status: "confirmed", paymentStatus: "partial", paymentAmountDue: 70 });
  assert.deepEqual(transactionFilterQuery("outstanding"), { paymentStatus: "all", outstandingOnly: "true" });
  assert.deepEqual(transactionFilterQuery("partial"), { paymentStatus: "partial" });
});
