// node --experimental-websocket scripts/owner-payment-browser-check.mjs
// Vite: 4178. Isolated headless Chrome CDP: 9238. Fixture APIs only.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:4178";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const target = await (await fetch("http://127.0.0.1:9238/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0, mode = "success", patches = 0, revision = 0;
const pending = new Map(), errors = [], checks = [];
const owner = { _id: "507f1f77bcf86cd799439011", name: "Payment Owner", email: "owner@example.test", role: "owner", isVerified: true, kycStatus: "approved" };
let booking = {
  _id: "507f1f77bcf86cd799439013", owner,
  renter: { _id: "507f1f77bcf86cd799439012", name: "Fixture Renter" },
  vehicle: { _id: "507f1f77bcf86cd799439014", name: "Payment fixture vehicle", images: [] },
  status: "confirmed", payment_status: " Partial ", paymentAmountPaid: 342, paymentAmountDue: 798,
  totalAmount: 1000, amountPayable: 1140, transactionFee: 140, vehicleHourlyRate: 250,
  bookingDurationMinutes: 240, pickupAt: "2030-01-01T10:00:00Z", returnAt: "2030-01-01T14:00:00Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
};
const tick = () => new Date(Date.UTC(2030, 0, 1, 0, 0, ++revision)).toISOString();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
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
    if (url.pathname === "/api/auth/me") return fulfill(requestId, { user: owner });
    if (url.pathname === "/api/owner/bookings") return fulfill(requestId, { bookings: [booking], page: { hasMore: false } });
    if (url.pathname.endsWith("/payment-status")) {
      patches++;
      const body = JSON.parse(request.postData);
      assert.ok(body.expectedUpdatedAt);
      await pause(200);
      if (mode === "failure") return fulfill(requestId, { message: "Fixture payment update failed." }, 503);
      if (mode === "stale") {
        booking = { ...booking, paymentStatus: "refunded", paymentAmountPaid: 0, paymentAmountDue: 1140, updatedAt: tick() };
        return fulfill(requestId, { message: "This booking changed. Review its latest payment status and try again.", code: "BOOKING_PAYMENT_CHANGED", booking }, 409);
      }
      const amount = body.paymentStatus === "paid" ? 1140 : body.paymentStatus === "partial" ? body.paymentAmountPaid : 0;
      if (body.paymentStatus === "partial") assert.equal(amount, 400);
      booking = { ...booking, paymentStatus: body.paymentStatus, paymentAmountPaid: amount, paymentAmountDue: 1140 - amount, updatedAt: tick() };
      return fulfill(requestId, { success: true, booking, message: "Payment status updated." });
    }
    return fulfill(requestId, { success: true, bookings: [], vehicles: [], notifications: [], conversations: [], unreadCount: 0, total: 0, stats: {}, summary: {} });
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
async function wait(expression) {
  const start = Date.now();
  while (Date.now() - start < 20000) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${expression}`);
}
const select = `document.querySelector('select[id^="payment-status-"]')`;
const click = async (text) => {
  const element = `[...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)})`;
  await wait(element); await evaluate(`${element}.click()`);
};
const choose = async (status) => evaluate(`(() => { const el = ${select}; el.value = ${JSON.stringify(status)}; el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
const aligned = async (status) => {
  await wait(`${select}?.value === ${JSON.stringify(status)} && !${select}.disabled`);
  assert.ok(await evaluate(`[...document.querySelectorAll('article span')].some(el => el.textContent.trim().toLowerCase() === ${JSON.stringify(status)})`));
};
const open = async () => {
  await send("Page.navigate", { url: base + "/owner-dashboard?tab=Bookings" });
  await click("All"); await wait(select);
};
const socketUpdate = (record) => evaluate(`import('/src/utils/socket.js').then(({getSocket}) => getSocket().emitEvent(['booking:updated', ${JSON.stringify(record)}]))`);
try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await open(); await aligned("partial");
  assert.deepEqual(await evaluate(`[...${select}.options].map(option => option.value)`), ["unpaid", "partial", "paid", "refunded"]);
  checks.push("Saved Partial normalizes aliases/case and all four dropdown options are present");
  await choose("paid"); await aligned("paid");
  assert.equal(booking.paymentAmountDue, 0);
  await open(); await aligned("paid");
  checks.push("Manual Paid matches the badge, clears the balance, and survives reloading");
  mode = "failure";
  await choose("unpaid");
  await wait("document.body.innerText.includes('Fixture payment update failed.')");
  await aligned("paid");
  checks.push("A failed update leaves the dropdown on the saved Paid status");
  mode = "success";
  const before = patches;
  await choose("partial"); await wait("document.querySelector('input[id^=partial-amount-]')");
  await aligned("paid");
  assert.equal(patches, before);
  for (const width of [1440, 1024, 768, 430, 390, 360]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width <= 430 });
    await pause(60);
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"), `Overflow at ${width}px`);
  }
  await evaluate("document.querySelector('input[id^=partial-amount-]').scrollIntoView({block:'center'})");
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  await fs.mkdir(new URL("../frontend/.vite/", import.meta.url), { recursive: true });
  await fs.writeFile(new URL("../frontend/.vite/owner-payment-mobile.png", import.meta.url), Buffer.from(screenshot.data, "base64"));
  await evaluate(`(() => { const el = document.querySelector('input[id^=partial-amount-]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '400'); el.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await click("Save partial payment"); await aligned("partial");
  assert.equal(booking.paymentAmountPaid, 400); assert.equal(booking.paymentAmountDue, 740);
  checks.push("Partial requires the received amount and fits six desktop/mobile widths");
  booking = { ...booking, paymentStatus: "PAID", paymentAmountPaid: 1140, paymentAmountDue: 0, updatedAt: tick() };
  await socketUpdate(booking); await aligned("paid");
  await socketUpdate({ ...booking, paymentStatus: "partial", updatedAt: "2029-01-01T00:00:00Z" });
  await pause(200); await aligned("paid");
  checks.push("Live updates synchronize the dropdown and older socket messages cannot revert it");
  mode = "stale";
  await choose("unpaid");
  await wait("document.body.innerText.includes('This booking changed.')");
  await aligned("refunded");
  checks.push("A stale submission restores the latest status returned by the server");
  for (const scenario of [
    { status: "pending" },
    { status: "confirmed", extensionRequest: { status: "requested" } },
    { status: "confirmed", returnRequest: { status: "requested" } },
    { status: "confirmed", walkInPayment: { status: "approved" } },
    { status: "confirmed", cancellationRequest: { status: "requested" } },
  ]) {
    booking = { ...booking, paymentStatus: "partial", extensionRequest: {}, returnRequest: {}, walkInPayment: {}, cancellationRequest: {}, ...scenario, updatedAt: tick() };
    await socketUpdate(booking);
    await aligned("partial");
    for (const width of [1440, 1024, 768, 430, 390, 360]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width <= 430 });
      await pause(50);
      const metrics = await evaluate(`(() => {
        const rail = document.querySelector('article [role="group"]');
        const buttons = [...rail.querySelectorAll('button')];
        const rects = buttons.map(button => button.getBoundingClientRect());
        return { tops: rects.map(rect => rect.top), heights: rects.map(rect => rect.height), notesInRail: rail.querySelectorAll('p').length, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth };
      })()`);
      assert.ok(metrics.tops.length >= 3);
      assert.ok(metrics.tops.every(top => Math.abs(top - metrics.tops[0]) < 1), `Buttons wrapped at ${width}px`);
      assert.ok(metrics.heights.every(height => height === 44), `Unequal button heights at ${width}px`);
      assert.equal(metrics.notesInRail, 0);
      assert.ok(metrics.pageWidth <= metrics.viewport, `Page overflow at ${width}px`);
    }
    await evaluate(`document.querySelector('article [role="group"]').focus()`);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", modifiers: 0 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", modifiers: 0 });
    const buttonCount = await evaluate(`document.querySelectorAll('article [role="group"] button').length`);
    for (let index = 1; index < buttonCount; index++) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", modifiers: 0 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", modifiers: 0 });
    }
    assert.ok(await evaluate(`document.activeElement === document.querySelector('article [role="group"] button:last-child')`));
    await wait(`(() => { const button = document.activeElement.getBoundingClientRect(); const rail = document.querySelector('article [role="group"]').getBoundingClientRect(); return button.left >= rail.left - 1 && button.right <= rail.right + 1; })()`);
  }
  checks.push("Five booking action states stay on one horizontal row at six widths, with keyboard access to offscreen actions");
  await evaluate("document.querySelector('article [role=group]').scrollIntoView({block:'center'})");
  const actionsScreenshot = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(new URL("../frontend/.vite/owner-booking-actions-mobile.png", import.meta.url), Buffer.from(actionsScreenshot.data, "base64"));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, runtimeErrors: errors }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ checks, runtimeErrors: errors, text: await evaluate("document.body.innerText").catch(() => "") }, null, 2));
  throw error;
} finally {
  await send("Page.close").catch(() => {}); ws.close();
}
