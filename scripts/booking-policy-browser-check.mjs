// Run against an isolated Vite server and headless Chrome; all API calls use fixtures.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = process.env.BOOKING_BROWSER_BASE || "http://127.0.0.1:4186";
const cdp = process.env.BOOKING_BROWSER_CDP || "http://127.0.0.1:9246";
const fixedNow = Date.UTC(2030, 0, 1, 18);
const iso = (hour, minute = 0) => new Date(Date.UTC(2030, 0, 1, hour, minute)).toISOString();
const owner = { _id: "507f1f77bcf86cd799439011", name: "Fixture Owner", email: "owner@example.test", role: "owner", isVerified: true, kycStatus: "approved" };
const renter = { _id: "507f1f77bcf86cd799439012", name: "Fixture Renter", email: "renter@example.test", role: "user", isVerified: true, kycStatus: "approved" };
const fixture = () => ({
  _id: "507f1f77bcf86cd799439013", owner, renter,
  vehicle: { _id: "507f1f77bcf86cd799439014", name: "Policy fixture vehicle", images: [] },
  status: "confirmed", paymentStatus: "paid", paymentAmountPaid: 900, paymentAmountDue: 0,
  totalAmount: 800, baseAmount: 800, driverAmount: 0, transactionFee: 100, amountPayable: 900,
  vehicleHourlyRate: 100, vehicleDailyRate: 100, driverSelected: false, bookingDurationMinutes: 480,
  pickupAt: iso(8), returnAt: iso(16), updatedAt: iso(18),
  bookingPolicy: { version: 2, originalReturnAt: iso(16), extensionHistory: [] },
  lateReturn: { isOverdue: true, overdueMinutes: 120, accruedOverdueMinutes: 0, penaltyRatePerHour: 50, graceMinutes: 0, estimatedPenaltyFee: 100 },
  extensionRequest: { status: "none" }, returnRequest: { status: "none" },
});
let booking = fixture(), role = renter, revision = 0;
let cancellationConflict = false;
const requests = [], errors = [], checks = [], screenshots = [];
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
const tick = () => new Date(fixedNow + ++revision).toISOString();
const fulfill = (requestId, body, status = 200) => send("Fetch.fulfillRequest", {
  requestId, responseCode: status, responseHeaders: [
    { name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,OPTIONS" },
  ], body: Buffer.from(JSON.stringify(body)).toString("base64"),
});
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    if (url.pathname === "/api/auth/me") return fulfill(requestId, { user: role });
    if (url.pathname === "/api/bookings/me" || url.pathname === "/api/owner/bookings") return fulfill(requestId, { bookings: [booking], page: { hasMore: false } });
    if (url.pathname.endsWith("/status") && request.method === "PATCH") {
      const body = JSON.parse(request.postData); requests.push({ type: "owner-status", body });
      assert.equal(body.status, "cancelled");
      booking = { ...booking, status: "cancelled", updatedAt: tick(), cancellationRequest: { ...booking.cancellationRequest, status: "approved" } };
      return fulfill(requestId, { success: true, booking });
    }
    if (url.pathname.endsWith("/cancellation-request") && request.method === "PATCH") {
      const body = JSON.parse(request.postData); requests.push({ type: "owner-cancellation", body });
      assert.equal(body.expectedRequestedAt, booking.cancellationRequest.requestedAt);
      booking = { ...booking, status: "cancelled", updatedAt: tick(), cancellationRequest: { ...booking.cancellationRequest, status: "approved" } };
      return fulfill(requestId, cancellationConflict
        ? { success: false, message: "This booking can no longer process cancellation requests.", booking }
        : { success: true, booking }, cancellationConflict ? 400 : 200);
    }
    if (url.pathname.endsWith("/extension-request") && request.method === "POST") {
      const body = JSON.parse(request.postData); requests.push({ type: "extension", body });
      booking = { ...booking, updatedAt: tick(), extensionRequest: { status: "requested", requestedAt: tick(), requestedReturnAt: body.newReturnAt, currentReturnAt: booking.returnAt } };
      return fulfill(requestId, { success: true, booking });
    }
    if (url.pathname.endsWith("/extension-request/withdraw")) {
      const body = JSON.parse(request.postData); assert.equal(body.expectedRequestedAt, booking.extensionRequest.requestedAt);
      requests.push({ type: "withdraw", body });
      booking = { ...booking, updatedAt: tick(), extensionRequest: { ...booking.extensionRequest, status: "withdrawn" } };
      return fulfill(requestId, { success: true, booking });
    }
    if (url.pathname.endsWith("/return-request") && request.method === "POST") {
      const body = JSON.parse(request.postData); requests.push({ type: "return", body });
      booking = { ...booking, updatedAt: tick(), extensionRequest: { ...booking.extensionRequest, status: "withdrawn" }, returnRequest: { status: "requested", requestedAt: tick(), reportedHandoverAt: body.reportedHandoverAt } };
      return fulfill(requestId, { success: true, booking });
    }
    if (url.pathname.endsWith("/return-request") && request.method === "PATCH") {
      const body = JSON.parse(request.postData); assert.ok(body.expectedRequestedAt);
      requests.push({ type: "owner-return", body });
      booking = { ...booking, updatedAt: tick(), status: "completed", actualReturnAt: body.actualReturnAt,
        returnRequest: { ...booking.returnRequest, status: "confirmed", confirmedAt: iso(18) },
        lateReturn: { ...booking.lateReturn, action: "return_confirmed", penaltyFee: 95.83, overdueMinutes: 115 },
      };
      return fulfill(requestId, { success: true, booking });
    }
    if (url.pathname === "/api/reports/categories") return fulfill(requestId, { categories: [] });
    return fulfill(requestId, { success: true, bookings: [booking], vehicles: [], notifications: [], conversations: [], reports: [], unreadCount: 0, total: 0, stats: {}, summary: {} });
  }
  if (url.origin !== base) return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
  return send("Fetch.continueRequest", { requestId });
}
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id); pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  else if (message.method === "Fetch.requestPaused") route(message.params).catch((error) => errors.push(error.message));
};
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(expression) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${expression}`);
}
const click = async (label) => {
  const selector = `[...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(label)})`;
  await wait(selector); await evaluate(`${selector}.click()`);
};
const setInput = async (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const localInput = async (date) => evaluate(`(() => { const date = new Date(${JSON.stringify(date)}); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); })()`);
const open = async (ownerTab = "Bookings") => {
  await send("Page.navigate", { url: base + (role.role === "owner" ? `/owner-dashboard?tab=${ownerTab}` : "/bookings") });
  await wait("document.body.innerText.includes('Policy fixture vehicle')");
};
async function inspectModal(name) {
  for (const width of [1440, 768, 390, 320]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 768 });
    await pause(80);
    const bounds = await evaluate(`(() => { const panel = document.querySelector('dialog[open] .rp-modal-panel'); const r = panel.getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth, overflow: panel.scrollWidth > panel.clientWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth }; })()`);
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && !bounds.overflow && !bounds.pageOverflow, `${name} at ${width}: ${JSON.stringify(bounds)}`);
    assert.ok(await evaluate("[...document.querySelectorAll('dialog[open] input:not([type=checkbox])')].every(el => Number.parseFloat(getComputedStyle(el).fontSize) >= 16)"));
    if (!process.env.BOOKING_BROWSER_SKIP_CAPTURE && (width === 1440 || width === 390)) {
      const file = path.join(os.tmpdir(), `rentifypro-policy-${name}-${width}.png`);
      await fs.writeFile(file, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
      screenshots.push(file);
    }
  }
  checks.push(`${name} fits desktop, tablet, and 390/320px phones with readable inputs`);
}
async function inspectCancelledBooking(name) {
  for (const width of [1440, 768, 390, 320]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 768 });
    await pause(80);
    const state = await evaluate(`(() => {
      const card = document.querySelector('.rp-booking-card');
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        text: card.innerText,
        actions: [...card.querySelectorAll('button')].map(el => el.textContent.trim()),
      };
    })()`);
    assert.equal(state.overflow, false, `${name} overflows at ${width}px`);
    assert.ok(!state.actions.includes("Approve Cancellation") && !state.actions.includes("Keep Booking"));
    assert.ok(!state.text.includes("Overdue return notice") && !state.text.includes("Estimated Total Payment") && !state.text.includes("Earlier late time:"));
    assert.ok(state.text.includes("Paid"), "Payment history remains visible");
    if (!process.env.BOOKING_BROWSER_SKIP_CAPTURE && [1440, 390].includes(width)) {
      const file = path.join(os.tmpdir(), `rentifypro-policy-${name}-${width}.png`);
      await fs.writeFile(file, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
      screenshots.push(file);
    }
  }
  checks.push(`${name}: historical booking retains payment and has no stale actions, live fees, or overflow at 320/390/768/1440px`);
}
try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Network.setBlockedURLs", { urls: ["*socket.io*"] });
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setTimezoneOverride", { timezoneId: "Asia/Manila" });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `const RealDate = Date; window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [${fixedNow}])); } static now() { return ${fixedNow}; } };` });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 844, deviceScaleFactor: 1, mobile: false });
  await open(); await click("Extend Rental Time");
  await wait("document.querySelector('dialog[open]')");
  const newReturn = await localInput(iso(18, 30));
  await setInput('dialog[open] input[type=date]', newReturn.slice(0, 10));
  await setInput('dialog[open] input[type=time]', newReturn.slice(11));
  await wait("document.querySelector('dialog[open]').innerText.includes('₱50.00')");
  assert.ok(await evaluate("document.querySelector('dialog[open]').innerText.includes('₱100.00')"));
  await inspectModal("extension");
  for (let index = 0; index < 8; index++) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    assert.ok(await evaluate("document.querySelector('dialog[open]').contains(document.activeElement)"), "Keyboard focus stays inside the native dialog");
  }
  await setInput('dialog[open] input[type=time]', (await localInput(iso(16, 30))).slice(11));
  await click("Send extension request");
  await wait("document.querySelector('dialog[open]').innerText.includes('Choose a return time later than now')");
  assert.equal(requests.length, 0);
  await setInput('dialog[open] input[type=time]', newReturn.slice(11));
  await click("Send extension request");
  await wait("!document.querySelector('dialog[open]')");
  assert.equal(requests[0].body.newReturnAt, iso(18, 30));
  await click("Withdraw extension request");
  await wait("document.body.innerText.includes('Extension request withdrawn')");
  assert.equal(requests[1].type, "withdraw");
  checks.push("Separate extension/late estimates, past-time rejection, submission, and withdrawal work");
  booking.extensionRequest = { status: "requested", requestedAt: iso(17, 45), requestedReturnAt: iso(18, 30) };
  await open(); await click("Request Vehicle Return");
  await wait("document.querySelector('dialog[open]')");
  assert.ok(await evaluate("document.querySelector('dialog[open]').innerText.includes('withdraws your pending extension')"));
  await evaluate("document.querySelector('dialog[open] input[type=checkbox]').click()");
  await setInput('dialog[open] input[type=datetime-local]', await localInput(iso(17, 55)));
  await inspectModal("renter-return");
  await click("Send return request");
  await wait("!document.querySelector('dialog[open]')");
  assert.equal(requests.at(-1).body.reportedHandoverAt, iso(17, 55));
  checks.push("Return is available during pending extension and sends a handover claim");
  role = owner;
  await open(); await click("All"); await click("Confirm Vehicle Received");
  await wait("document.querySelector('dialog[open]')");
  const before = requests.length;
  await click("Confirm vehicle received");
  await wait("document.querySelector('dialog[open]').innerText.includes('confirm physical receipt')");
  assert.equal(requests.length, before);
  await evaluate("document.querySelector('dialog[open] input[type=checkbox]').click()");
  await inspectModal("owner-return");
  await click("Confirm vehicle received");
  await wait("!document.querySelector('dialog[open]')");
  assert.equal(requests.at(-1).body.actualReturnAt, iso(17, 55));
  checks.push("Owner verification requires physical receipt and submits handover separately from app time");
  await evaluate("[...document.querySelectorAll('summary')].find(el => el.textContent.includes('Extension and return details')).click()");
  await wait("document.body.innerText.includes('Verified handover:')");
  await click("Report an incorrect handover time or charge");
  await wait("document.querySelector('dialog[open]')?.innerText.includes('Report a booking issue')");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await wait("!document.querySelector('dialog[open]')");
  checks.push("Handover history expands and the dispute action opens the existing booking report flow");
  booking = fixture(); booking.returnRequest = { status: "requested", requestedAt: iso(17, 50), reportedHandoverAt: iso(17, 55) };
  await open("Dashboard");
  const returnCard = "[...document.querySelectorAll('button')].find(el => el.textContent.includes('Vehicle Return Request'))";
  await wait(returnCard);
  await evaluate(`${returnCard}.click()`);
  await click("Confirm Vehicle Received");
  await wait("document.querySelector('dialog[open]')");
  assert.ok(await evaluate("document.querySelector('dialog[open]').innerText.includes('Actual handover date and time')"));
  await wait("document.querySelector('dialog[open]').contains(document.activeElement)");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await wait("!document.querySelector('dialog[open]')");
  checks.push("Dashboard return review uses the same handover form and Escape closes it");
  for (const version of [1, 2]) {
    booking = { ...fixture(), status: "cancelled", cancellationRequest: { status: "requested", requestedAt: iso(17) }, bookingPolicy: { version }, lateReturn: { ...fixture().lateReturn, accruedOverdueMinutes: 60 } };
    await send("Page.navigate", { url: base + "/owner-dashboard?tab=Bookings" });
    await wait("document.body.innerText.includes('Your queue is clear')");
    await click("History");
    await wait("document.querySelector('.rp-booking-card')");
    await inspectCancelledBooking(`cancelled-v${version}`);
  }
  booking = fixture(); booking.cancellationRequest = { status: "requested", requestedAt: iso(17) };
  await open(); await click("Cancel");
  await wait("document.body.innerText.includes('Your queue is clear')");
  assert.equal(requests.at(-1).type, "owner-status");
  assert.equal(booking.paymentAmountPaid, 900);
  assert.equal(booking.actualReturnAt, undefined);
  checks.push("Regular owner Cancel closes the request and removes the booking from Needs Action without changing the captured payment");
  booking = { ...fixture(), returnAt: iso(20), lateReturn: { ...fixture().lateReturn, isOverdue: false, overdueMinutes: 0 }, cancellationRequest: { status: "requested", requestedAt: iso(17) } };
  await open(); await click("Approve Cancellation");
  await wait("document.body.innerText.includes('Your queue is clear')");
  assert.equal(requests.at(-1).type, "owner-cancellation");
  checks.push("A valid cancellation request is actionable before the deadline and sends the expected request timestamp");
  booking = fixture(); booking.cancellationRequest = { status: "requested", requestedAt: iso(17) };
  cancellationConflict = true;
  await open(); await click("Keep Booking");
  await wait("document.body.innerText.includes('Your queue is clear')");
  checks.push("Bookings reconciles a stale cancellation error using the latest booking returned by the API");
  booking = fixture(); booking.cancellationRequest = { status: "requested", requestedAt: iso(17) };
  await open("Dashboard");
  const cancellationCard = "[...document.querySelectorAll('button')].find(el => el.textContent.includes('Cancellation Request'))";
  await wait(cancellationCard); await evaluate(`${cancellationCard}.click()`);
  await click("Approve Cancellation");
  await wait("!document.querySelector('dialog[open]')");
  await wait(`!${cancellationCard}`);
  assert.equal(booking.status, "cancelled");
  checks.push("Dashboard refreshes a stale cancellation decision and removes the obsolete review without a runtime error");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, screenshots, fixtureApiRequests: requests.length, runtimeErrors: errors }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ checks, errors, text: await evaluate("document.body.innerText").catch(() => "") }, null, 2));
  throw error;
} finally {
  await send("Page.close").catch(() => {}); ws.close();
}
