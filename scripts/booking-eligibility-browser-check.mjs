// node --experimental-websocket scripts/booking-eligibility-browser-check.mjs
// Requires Vite on 4178 and isolated headless Chrome with CDP on 9238.
// All APIs are intercepted; no real bookings, accounts, or payments are used.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = "http://127.0.0.1:4178";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const target = await (await fetch("http://127.0.0.1:9238/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map(), errors = [], checks = [];
let sequence = 0, mode = "allowed", postMode = "deny", eligibilityCalls = 0, postCalls = 0;
let delayNext = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const vehicle = {
  _id: "507f1f77bcf86cd799439014", name: "Policy fixture vehicle", location: "Manila",
  dailyRentalRate: 250, hourlyRentalRate: 250, pricingUnit: "hourly", availabilityStatus: "available",
  driverOptionEnabled: true, driverDailyRate: 50, images: [], reviews: [],
  specs: { type: "Car", transmission: "Automatic", seats: 5, fuelType: "Gasoline" },
  owner: { _id: "507f1f77bcf86cd799439013", name: "Fixture Owner" },
};
const reason = (code, message, details = {}) => ({ code, message, ...details });
const payload = (state) => ({
  eligible: state === "allowed",
  limits: { open: 3, pending: 2, simultaneous: 1 },
  counts: { open: state === "limit" ? 3 : 1, pending: state === "pending" ? 2 : 0 },
  reasons: state === "allowed" ? [] : [state === "limit"
    ? reason("OPEN_BOOKING_LIMIT", "You have reached the limit of 3 open bookings.")
    : state === "pending" ? reason("PENDING_BOOKING_LIMIT", "You already have 2 pending booking requests.")
    : state === "overlap" ? reason("RENTER_SCHEDULE_CONFLICT", "These dates overlap one of your open bookings.")
    : reason(
      "UNPAID_LATE_RETURN_PENALTY",
      "Booking #123456 has an unpaid balance including a late-return penalty of PHP 350.00. Settle it before making another booking.",
      { bookingId: "507f1f77bcf86cd7123456", amountDue: 350 },
    )],
});
const fulfill = (requestId, body, status = 200) => send("Fetch.fulfillRequest", {
  requestId, responseCode: status, responseHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" },
    { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
  ], body: Buffer.from(JSON.stringify(body)).toString("base64"),
});
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    if (url.pathname === "/api/auth/me") return fulfill(requestId, { user: {
      _id: "507f1f77bcf86cd799439011", name: "Policy Renter", email: "fixture@example.test",
      role: "user", isVerified: true, kycStatus: "approved",
    } });
    if (url.pathname === `/api/vehicles/${vehicle._id}`) return fulfill(requestId, { vehicle });
    if (url.pathname === "/api/bookings/eligibility") {
      eligibilityCalls++;
      const snapshot = mode, delay = delayNext;
      delayNext = 0;
      if (delay) await pause(delay);
      return fulfill(requestId, snapshot === "error" ? { message: "Fixture service failure" } : { eligibility: payload(snapshot) }, snapshot === "error" ? 503 : 200);
    }
    if (url.pathname === "/api/bookings" && request.method === "POST") {
      postCalls++;
      if (postMode === "allow") return fulfill(requestId, { success: true }, 201);
      const eligibility = payload("penalty");
      return fulfill(requestId, { success: false, ...eligibility.reasons[0], eligibility }, 409);
    }
    return fulfill(requestId, { success: true, vehicles: [], bookings: [], notifications: [], conversations: [], reviews: [], reports: [], unreadCount: 0, total: 0, page: { hasMore: false } });
  }
  if (url.origin !== base) return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
  return send("Fetch.continueRequest", { requestId });
}
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id); pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  } else if (message.method === "Fetch.requestPaused") {
    route(message.params).catch((error) => {
      if (!/Invalid InterceptionId|Invalid parameters|Target closed/.test(error.message)) errors.push(error.message);
    });
  }
};
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function wait(expression, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${expression}`);
}
const hasText = (value) => `document.body.innerText.includes(${JSON.stringify(value)})`;
const click = async (value) => {
  const button = `[...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(value)})`;
  await wait(button);
  await evaluate(`${button}.click()`);
};
const openDetails = async () => {
  await send("Page.navigate", { url: `${base}/vehicle-details?vehicleId=${vehicle._id}` });
  await wait(hasText("Booking limits"));
};
const refresh = async () => evaluate("window.dispatchEvent(new Event('focus'))");

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await openDetails();
  await wait(hasText("1/3 open · 0/2 pending"));
  assert.equal(await evaluate(hasText("Partial payments are allowed until due")), false);
  assert.equal(await evaluate(hasText("The 30% downpayment is part of the estimated total.")), true);
  checks.push("Allowed state shows only the renter's compact booking counts");

  await click("Book Now");
  await wait(hasText("Pay your remaining balance first."));
  await wait(hasText("P350.00 due, including a late fee"));
  assert.equal(postCalls, 1);
  assert.ok(await evaluate("location.pathname === '/vehicle-details'"));
  checks.push("Fresh server denial overrides allowed preflight without logging the renter out");
  await refresh();
  await wait(`!${hasText("P350.00 due")} && ${hasText("1/3 open · 0/2 pending")}`);
  checks.push("Refreshing eligibility clears a resolved submission error");
  mode = "penalty";
  await refresh();
  await wait(hasText("P350.00 due"));
  await click("View bookings");
  await wait("location.pathname === '/bookings'");
  checks.push("Restriction action opens existing booking management");

  mode = "limit";
  await openDetails();
  await wait(hasText("3/3 open · 0/2 pending"));
  await wait(hasText("View bookings to resolve"));
  assert.equal(await evaluate("[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Book Now')"), false);
  for (const width of [1440, 1024, 768, 430, 390, 360]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width <= 430 });
    await pause(80);
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"), `Horizontal overflow at ${width}px`);
  }
  await evaluate("[...document.querySelectorAll('p')].find(el => el.textContent === 'Booking limits').scrollIntoView({block:'start'})");
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  await fs.mkdir(new URL("../frontend/.vite/", import.meta.url), { recursive: true });
  await fs.writeFile(new URL("../frontend/.vite/booking-policy-mobile.png", import.meta.url), Buffer.from(screenshot.data, "base64"));
  checks.push("Limit warning fits 1440, 1024, 768, 430, 390, and 360px");
  await click("View bookings to resolve");
  await wait("location.pathname === '/bookings'");
  checks.push("Known booking limit sends the renter to booking management");

  mode = "pending";
  await openDetails();
  await wait(hasText("2 pending requests reached"));
  checks.push("Pending request cap has its own explanation");

  mode = "error";
  await refresh();
  await wait(hasText("Unable to check your booking limits"));
  mode = "allowed";
  await click("Retry check");
  await wait(hasText("1/3 open · 0/2 pending"));
  assert.equal(await evaluate(hasText("2 pending requests reached")), false);
  checks.push("Eligibility failure is recoverable and clears stale restrictions");

  // Hold a stale denied response, change the selected schedule, and make sure
  // the old response cannot overwrite the newer allowed result.
  mode = "overlap"; delayNext = 1500;
  const before = eligibilityCalls;
  await refresh();
  while (eligibilityCalls === before) await pause(30);
  mode = "allowed";
  await evaluate(`(() => {
    const input = document.querySelectorAll('input[type="date"]')[1];
    const next = new Date(input.value + 'T12:00:00'); next.setDate(next.getDate() + 1);
    const value = next.getFullYear() + '-' + String(next.getMonth()+1).padStart(2,'0') + '-' + String(next.getDate()).padStart(2,'0');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(hasText("1/3 open · 0/2 pending"));
  await pause(1700);
  assert.equal(await evaluate(hasText("These dates overlap")), false);
  checks.push("Date changes refresh eligibility and ignore stale responses");

  mode = "penalty";
  await refresh();
  await wait(hasText("P350.00 due"));
  mode = "allowed";
  await refresh();
  await wait(`${hasText("1/3 open · 0/2 pending")} && !${hasText("P350.00 due")}`);
  assert.equal(await evaluate(hasText("P350.00 due")), false);
  postMode = "allow";
  await click("Book Now");
  await wait("location.pathname === '/bookings'");
  checks.push("Verified settlement refresh permits submission and preserves success navigation");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, runtimeErrors: errors }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ completedChecks: checks, runtimeErrors: errors, visibleText: await evaluate("document.body.innerText").catch(() => "") }, null, 2));
  throw error;
} finally {
  await send("Page.close").catch(() => {});
  ws.close();
}
