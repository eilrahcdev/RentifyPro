// node --experimental-websocket scripts/owner-analytics-browser-check.mjs
// Requires Vite on 4178 and isolated headless Chrome with CDP on 9238.
// All APIs are intercepted; no real owners, vehicles, bookings, or earnings are used.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = "http://127.0.0.1:4178";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const target = await (await fetch("http://127.0.0.1:9238/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

const owner = {
  _id: "507f1f77bcf86cd799439011",
  name: "Analytics Owner",
  email: "owner@example.test",
  role: "owner",
  isVerified: true,
  kycStatus: "approved",
};
const periodTotals = { "30d": 8, "90d": 17, "365d": 49 };
const analyticsPayload = (period = "90d") => ({
  success: true,
  period: { key: period, label: period === "30d" ? "Last 30 days" : period === "365d" ? "Last 12 months" : "Last 90 days" },
  summary: {
    totalVehicles: 5,
    totalBookingRequests: periodTotals[period] || 17,
    fleetAverageBookingRate: period === "30d" ? 2.1 : 1.7,
    frequentlyBookedVehicles: 1,
    vehiclesWithoutBookings: 2,
    newListings: 2,
  },
  vehiclePerformance: [
    { vehicleId: "delta", vehicleName: "Delta City Car", availabilityStatus: "available", rank: 1, frequency: "new", bookings: period === "30d" ? 1 : period === "365d" ? 4 : 2, completedBookings: period === "30d" ? 0 : period === "365d" ? 3 : 1, bookingRate: 8.6, bookingShare: period === "30d" ? 12.5 : period === "365d" ? 8.2 : 11.8, trend: { direction: "new", percent: null } },
    { vehicleId: "alpha", vehicleName: "Alpha Family Van", availabilityStatus: "available", rank: 2, frequency: "frequent", bookings: period === "30d" ? 6 : period === "365d" ? 35 : 12, completedBookings: period === "30d" ? 3 : period === "365d" ? 21 : 5, bookingRate: 4, bookingShare: period === "30d" ? 75 : period === "365d" ? 71.4 : 70.6, trend: { direction: "up", percent: 100 } },
    { vehicleId: "bravo", vehicleName: "Bravo Compact", availabilityStatus: "available", rank: 3, frequency: "infrequent", bookings: period === "30d" ? 1 : period === "365d" ? 10 : 3, completedBookings: period === "30d" ? 0 : period === "365d" ? 6 : 1, bookingRate: 1, bookingShare: period === "30d" ? 12.5 : period === "365d" ? 20.4 : 17.6, trend: { direction: "flat", percent: 0 } },
    { vehicleId: "charlie", vehicleName: "Charlie Pickup", availabilityStatus: "unavailable", rank: 4, frequency: "none", bookings: 0, completedBookings: 0, bookingRate: 0, bookingShare: 0, trend: { direction: "down", percent: -100 } },
    { vehicleId: "echo", vehicleName: "Echo New Motorcycle", availabilityStatus: "available", rank: 5, frequency: "new", bookings: 0, completedBookings: 0, bookingRate: 0, bookingShare: 0, trend: { direction: "flat", percent: null } },
  ],
  bookingTrend: [
    { _id: { year: 2026, month: 4 }, totalBookings: 5 },
    { _id: { year: 2026, month: 5 }, totalBookings: 7 },
    { _id: { year: 2026, month: 6 }, totalBookings: 9 },
  ],
  monthlyEarningsTrend: [
    { _id: { year: 2026, month: 4 }, totalEarnings: 9400 },
    { _id: { year: 2026, month: 5 }, totalEarnings: 12600 },
    { _id: { year: 2026, month: 6 }, totalEarnings: 18100 },
  ],
});

let sequence = 0;
let analyticsCalls = 0;
let failNextAnalytics = false;
const pending = new Map();
const errors = [];
const checks = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const fulfill = (requestId, body, status = 200) => send("Fetch.fulfillRequest", {
  requestId,
  responseCode: status,
  responseHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" },
    { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,OPTIONS" },
  ],
  body: Buffer.from(JSON.stringify(body)).toString("base64"),
});

async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    if (url.pathname === "/api/auth/me" || url.pathname === "/api/auth/profile") {
      return fulfill(requestId, { user: owner });
    }
    if (url.pathname === "/api/owner/analytics") {
      analyticsCalls += 1;
      if (failNextAnalytics) {
        failNextAnalytics = false;
        return fulfill(requestId, { message: "Fixture analytics service unavailable." }, 503);
      }
      return fulfill(requestId, analyticsPayload(url.searchParams.get("period") || "90d"));
    }
    return fulfill(requestId, {
      success: true,
      bookings: [],
      vehicles: [],
      notifications: [],
      renters: [],
      conversations: [],
      unreadCount: 0,
      total: 0,
      stats: {},
      summary: {},
    });
  }
  if (url.origin !== base) return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
  return send("Fetch.continueRequest", { requestId });
}

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error.message));
    else call?.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  } else if (message.method === "Fetch.requestPaused") {
    route(message.params).catch((error) => errors.push(error.message));
  }
};

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function wait(expression, timeout = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${expression}`);
}
const hasText = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`;
const click = async (text) => {
  const button = `[...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)})`;
  await wait(button);
  await evaluate(`${button}.click()`);
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/owner-dashboard?tab=Analytics` });
  await wait(`${hasText("Vehicle performance")} && ${hasText("Alpha Family Van")}`);

  assert.ok(await evaluate("Boolean(document.querySelector('[data-testid=vehicle-demand-chart]'))"));
  assert.equal(await evaluate("document.querySelector('section[aria-label$=summary]') === null"), true);
  assert.ok(await evaluate(hasText("Booking requests vs completed")));
  assert.ok(await evaluate(hasText("Frequent")));
  assert.ok(await evaluate(hasText("Infrequent")));
  assert.ok(await evaluate(hasText("No bookings")));
  assert.ok(await evaluate(hasText("New listing")));
  assert.ok(await evaluate(hasText("Echo New Motorcycle")));
  assert.ok(await evaluate(hasText("Past days when a vehicle was manually unavailable are not recorded")));
  checks.push("Counter cards are removed and the grouped booking-demand graph includes every vehicle");

  for (const width of [1440, 1024, 768, 430, 390, 360]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width <= 430 });
    await pause(80);
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"), `Horizontal overflow at ${width}px`);
  }
  assert.ok(await evaluate("document.querySelector('select').getBoundingClientRect().height >= 44"));
  const mobileScreenshot = await send("Page.captureScreenshot", { format: "png" });
  await fs.mkdir(new URL("../frontend/.vite/", import.meta.url), { recursive: true });
  await fs.writeFile(new URL("../frontend/.vite/owner-analytics-mobile.png", import.meta.url), Buffer.from(mobileScreenshot.data, "base64"));
  checks.push("Analytics fits six desktop/mobile widths and keeps the period control touch-sized");

  const beforePeriodChange = analyticsCalls;
  await evaluate(`(() => {
    const select = document.querySelector('select');
    select.value = '30d';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait("document.querySelector('[data-chart-vehicle=alpha]')?.dataset.requests === '6'");
  assert.ok(analyticsCalls > beforePeriodChange);
  assert.equal(await evaluate("document.querySelector('select').value"), "30d");
  checks.push("Changing the comparison period requests and renders the selected analytics window");

  failNextAnalytics = true;
  await click("Refresh");
  await wait(hasText("Fixture analytics service unavailable."));
  assert.ok(await evaluate(hasText("Alpha Family Van")));
  await click("Try again");
  await wait(`!${hasText("Fixture analytics service unavailable.")} && ${hasText("Alpha Family Van")}`);
  checks.push("A failed refresh preserves the last valid comparison and offers a working retry");

  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const desktopScreenshot = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(new URL("../frontend/.vite/owner-analytics-desktop.png", import.meta.url), Buffer.from(desktopScreenshot.data, "base64"));

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, analyticsCalls, runtimeErrors: errors }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    completedChecks: checks,
    analyticsCalls,
    runtimeErrors: errors,
    visibleText: await evaluate("document.body.innerText").catch(() => ""),
  }, null, 2));
  throw error;
} finally {
  await send("Page.close").catch(() => {});
  ws.close();
}
