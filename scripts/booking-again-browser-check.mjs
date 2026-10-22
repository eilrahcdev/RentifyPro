// Isolated browser regression: every API request is intercepted with synthetic data.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = process.env.BOOK_AGAIN_BASE || "http://127.0.0.1:4188";
const cdp = process.env.BOOK_AGAIN_CDP || "http://127.0.0.1:9248";
const user = { _id: "507f1f77bcf86cd799439011", name: "Fixture Renter", role: "user", isVerified: true, kycStatus: "approved" };
const owner = { _id: "507f1f77bcf86cd799439012", name: "Fixture Owner", role: "owner" };
const vehicle = {
  _id: "507f1f77bcf86cd799439014", name: "Repeat rental fixture", owner,
  location: "Dagupan City, Pangasinan", dailyRentalRate: 300, pricingUnit: "hourly",
  availabilityStatus: "available", availabilityHoldReason: "none", driverOptionEnabled: false,
  images: [], reviews: [], specs: { type: "Car", transmission: "Automatic", seats: 5 },
};
const records = ["completed", "cancelled", "rejected", "pending", "confirmed", "extended"].map((status, index) => ({
  _id: `507f1f77bcf86cd79943902${index}`, status, owner, renter: user,
  vehicle: { _id: vehicle._id, name: vehicle.name, location: vehicle.location, owner, dailyRentalRate: 99, images: [], specs: vehicle.specs }, vehicleHourlyRate: 99, driverSelected: true,
  pickupAt: "2025-01-01T10:00:00Z", returnAt: "2025-01-02T10:00:00Z",
  actualReturnAt: status === "completed" ? "2025-01-02T10:00:00Z" : null,
  paymentStatus: "paid", paymentAmountPaid: 2476, paymentAmountDue: 0, totalAmount: 2376,
  transactionFee: 100, reviewRating: status === "completed" ? 5 : null,
  createdAt: "2025-01-01T09:00:00Z", updatedAt: "2025-01-02T10:00:00Z",
}));
records.push({ ...records[0], _id: "507f1f77bcf86cd799439026", vehicle: null });
const originalRecords = JSON.stringify(records);
const submitted = { ...records[3], _id: "507f1f77bcf86cd799439030", vehicle, paymentStatus: "unpaid", paymentAmountPaid: 0 };
let vehicleMode = "available", eligibilityMode = "eligible", createMode = "success", vehicleGate = null;
let vehicleCalls = 0;
const writes = [], errors = [], checks = [], screenshots = [], pending = new Map();
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const fulfill = (requestId, body, status = 200) => send("Fetch.fulfillRequest", {
  requestId, responseCode: status, responseHeaders: [
    { name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,DELETE,OPTIONS" },
  ], body: Buffer.from(JSON.stringify(body)).toString("base64"),
});
const eligibility = () => ({
  eligible: eligibilityMode === "eligible", limits: { open: 3, pending: 2 }, counts: { open: 0, pending: 0 },
  reasons: eligibilityMode === "balance" ? [{ code: "OVERDUE_BOOKING_BALANCE", message: "Pay your remaining balance first.", bookingId: records[0]._id }]
    : eligibilityMode === "verification" ? [{ code: "IDENTITY_VERIFICATION_REQUIRED", message: "Complete identity verification." }] : [],
  ...(eligibilityMode === "verification" ? { verification: { bookingEligible: false, emailVerified: true, selfieVerified: false, documents: [] } } : {}),
});
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) {
    return url.origin === base ? send("Fetch.continueRequest", { requestId }) : send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
  }
  if (request.method === "OPTIONS") return fulfill(requestId, {});
  if (!["GET", "HEAD"].includes(request.method)) writes.push({ path: url.pathname, method: request.method, body: JSON.parse(request.postData || "{}") });
  if (url.pathname === "/api/auth/me") return fulfill(requestId, { user });
  if (url.pathname === "/api/kyc/me") return fulfill(requestId, { verification: {
    accountStatus: "active", emailVerified: true, selfieVerified: true, bookingEligible: true, documents: [],
  } });
  if (url.pathname === `/api/vehicles/${vehicle._id}`) {
    vehicleCalls++;
    const mode = vehicleMode;
    if (vehicleGate) await vehicleGate;
    if (mode === "missing") return fulfill(requestId, { message: "Vehicle not found." }, 404);
    if (mode === "error") return fulfill(requestId, { message: "Fixture unavailable." }, 503);
    if (mode === "malformed") return fulfill(requestId, { vehicle: { _id: vehicle._id, name: vehicle.name } });
    return fulfill(requestId, { vehicle: { ...vehicle,
      availabilityStatus: mode === "available" ? "available" : "unavailable",
      availabilityHoldReason: ["manual", "inspection"].includes(mode) ? mode : "none",
    } });
  }
  if (url.pathname === "/api/vehicles") return fulfill(requestId, { vehicles: [vehicle], page: { hasMore: false } });
  if (url.pathname === "/api/bookings/eligibility") return fulfill(requestId, { eligibility: eligibility() });
  if (url.pathname === "/api/bookings/me") {
    const view = url.searchParams.get("view");
    const bookings = view === "history" ? records.filter(record => ["completed", "cancelled", "rejected"].includes(record.status))
      : view === "all" ? records : records.filter(record => ["confirmed", "extended"].includes(record.status));
    return fulfill(requestId, { bookings, page: { hasMore: false } });
  }
  if (url.pathname === `/api/bookings/${submitted._id}`) return fulfill(requestId, { booking: submitted });
  if (url.pathname === "/api/bookings" && request.method === "POST") {
    if (["conflict", "conflictRefreshFailure"].includes(createMode)) {
      vehicleMode = createMode === "conflict" ? "unavailable" : "error";
      return fulfill(requestId, { message: "Vehicle is currently unavailable." }, 409);
    }
    if (createMode === "busy") return fulfill(requestId, { code: "BOOKING_UPDATE_IN_PROGRESS", message: "Another booking update is in progress. Please wait a moment and try again." }, 409);
    return fulfill(requestId, { success: true, booking: submitted });
  }
  return fulfill(requestId, { bookings: [], notifications: [], conversations: [], unreadCount: 0, total: 0, summary: {} });
}
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  else if (message.method === "Fetch.requestPaused") route(message.params).catch(error => {
    if (!/Invalid InterceptionId|Target closed/.test(error.message)) errors.push(error.message);
  });
};
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function wait(expression) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${expression}`);
}
const card = index => `document.querySelector('#booking-${records[index]._id}')`;
const button = (label, root = "document") => `[...${root}.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(label)})`;
const unavailableAlerts = "[...document.querySelectorAll('.rp-floating-alert')].filter(el => el.textContent.trim() === 'This vehicle is currently unavailable.')";
async function click(label, root) {
  const expression = button(label, root);
  await wait(`${expression} && !${expression}.disabled`);
  await evaluate(`${expression}.click()`);
}
async function history() {
  await send("Page.navigate", { url: `${base}/bookings` });
  await wait(button("All"));
  await click("All");
  await wait(card(6));
}
async function details(index = 0) {
  await history();
  await click("Book again", card(index));
  await wait("location.pathname === '/vehicle-details'");
  await wait(`${button("Book Now")} && !${button("Book Now")}.disabled`);
  await chooseDates();
}
async function chooseDates() {
  await evaluate(`(() => {
    const pickup = new Date(); pickup.setDate(pickup.getDate() + 1); pickup.setHours(10, 0, 0, 0);
    const dropoff = new Date(pickup.getTime() + 14400000);
    const date = value => value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
    const values = [date(pickup), '10:00', date(dropoff), '14:00'];
    [...document.querySelectorAll('input[type=date], input[type=time]')].forEach((input, index) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, values[index]);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  })()`);
  await pause(350);
}
async function responsive(label) {
  for (const width of [1440, 768, 390, 320]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
    await pause(100);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth"), true, `${label}: overflow at ${width}`);
    if (label === "history") assert.equal(await evaluate(`(() => { const bounds = ${button("Book again", card(0))}.getBoundingClientRect(); return bounds.height >= 44 && bounds.width >= 44; })()`), true);
    if ([1440, 390].includes(width)) {
      await evaluate(`${button(label === "history" ? "Book again" : "Book Now", label === "history" ? card(0) : "document")}.scrollIntoView({ block: 'center', behavior: 'instant' })`);
      const screenshotPath = path.join(os.tmpdir(), `rentifypro-book-again-${label}-${width}.png`);
      const screenshot = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
      screenshots.push(screenshotPath);
    }
  }
}
try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await history();
  for (const index of [0, 1]) assert.equal(await evaluate(`!!${button("Book again", card(index))}`), true, `${records[index].status} booking offers Book again`);
  for (const index of [2, 3, 4, 5, 6]) assert.equal(await evaluate(`!!${button("Book again", card(index))}`), false, `${records[index].status} or deleted vehicle has no Book again action`);
  assert.equal(await evaluate(`${card(6)}.innerText.includes('This vehicle is no longer listed')`), true);
  await responsive("history");
  checks.push("Only completed and cancelled bookings offer Book again; a deleted vehicle has a clear message");

  let releaseVehicle;
  vehicleGate = new Promise(resolve => { releaseVehicle = resolve; });
  const before = vehicleCalls;
  await evaluate(`(() => { const action = ${button("Book again", card(0))}; action.click(); action.click(); action.click(); })()`);
  await wait(`${button("Checking availability...", card(0))}?.disabled`);
  await pause(150);
  assert.equal(vehicleCalls, before + 1);
  assert.equal(writes.length, 0, "Checking availability must not create or change a booking");
  vehicleGate = null; releaseVehicle();
  await wait("location.pathname === '/vehicle-details'");
  await wait(`${button("Book Now")} && !${button("Book Now")}.disabled`);
  assert.ok(await evaluate("document.body.innerText.includes('P300')"), "Uses current pricing");
  assert.equal(await evaluate("document.body.innerText.includes('Self-drive only')"), true, "Uses current driver options");
  const dates = await evaluate("[...document.querySelectorAll('input[type=date]')].map(el => el.value)");
  assert.ok(dates.every(value => value && !value.startsWith("2025-")), "Fresh dates replace the historic schedule");
  await responsive("details");
  checks.push("Repeated clicks make one lookup and no writes; current pricing/options and fresh dates open in the existing form");

  await chooseDates();
  await evaluate(`(() => { const action = ${button("Book Now")}; action.click(); action.click(); action.click(); })()`);
  await wait(`location.pathname === '/bookings' && document.querySelector('#booking-${submitted._id}')`);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0].body).sort(), ["driverSelected", "pickupAt", "returnAt", "vehicleId"]);
  assert.equal(writes[0].body.driverSelected, false);
  assert.equal(writes[0].body.vehicleId, vehicle._id);
  assert.equal(writes[0].path, "/api/bookings");
  assert.equal(JSON.stringify(records), originalRecords);
  checks.push("Explicit submission uses the normal create endpoint with a new pending reference and preserves original records");

  for (const mode of ["unavailable", "inspection", "manual"]) {
    vehicleMode = mode;
    await history(); await click("Book again", card(0));
    await wait(`${card(0)}.innerText.includes('currently unavailable')`);
    await wait(`${unavailableAlerts}.length === 1`);
    assert.equal(await evaluate("location.pathname"), "/bookings");
    assert.equal(await evaluate(`!!${button("Browse vehicles", card(0))}`), true);
    if (mode === "unavailable") {
      assert.equal(await evaluate(`${unavailableAlerts}[0].getAttribute('role')`), "status");
      assert.equal(await evaluate(`${unavailableAlerts}[0].getAttribute('aria-live')`), "polite");
      for (const width of [1440, 768, 390, 320]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
        await pause(100);
        assert.equal(await evaluate(`(() => { const bounds = ${unavailableAlerts}[0].getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth; })()`), true, `Floating alert fits at ${width}px`);
        if ([1440, 390].includes(width)) {
          const screenshotPath = path.join(os.tmpdir(), `rentifypro-book-again-unavailable-alert-${width}.png`);
          const screenshot = await send("Page.captureScreenshot", { format: "png" });
          await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
          screenshots.push(screenshotPath);
        }
      }
      const beforeRetry = vehicleCalls;
      await evaluate(`(() => { const action = ${button("Check availability", card(0))}; action.click(); action.click(); action.click(); })()`);
      await wait(`${unavailableAlerts}.length === 1 && ${button("Check availability", card(0))}`);
      assert.equal(vehicleCalls, beforeRetry + 1, "Repeated rechecks use one lookup and one floating alert");
      await wait(`${unavailableAlerts}.length === 0`);
      assert.equal(await evaluate(`${card(0)}.innerText.includes('currently unavailable')`), true, "The inline explanation remains after the brief alert disappears");
      assert.equal(await evaluate(`!!${button("Browse vehicles", card(0))} && !!${button("Check availability", card(0))}`), true);
      checks.push("The unavailable floating alert fits 320-1440px, deduplicates repeated clicks, dismisses automatically and leaves recovery actions available");
    }
    vehicleMode = "available";
    await click("Check availability", card(0));
    await wait("location.pathname === '/vehicle-details'");
  }
  checks.push("Reservations, inspection and manual holds block rebooking and allow an explicit availability recheck");

  vehicleMode = "missing";
  await history(); await click("Book again", card(1));
  await wait(`${card(1)}.innerText.includes('This vehicle is no longer listed')`);
  assert.equal(await evaluate(`!!${button("Book again", card(1))}`), false);
  await click("Browse vehicles", card(1)); await wait("location.pathname === '/vehicles'");
  for (const mode of ["error", "malformed"]) {
    vehicleMode = mode;
    await history(); await click("Book again", card(1));
    await wait(button("Retry availability", card(1)));
    assert.equal(await evaluate("location.pathname"), "/bookings");
    vehicleMode = "available";
    await click("Retry availability", card(1)); await wait("location.pathname === '/vehicle-details'");
  }
  checks.push("Deleted listings offer browsing; failed or incomplete lookups fail closed and can be retried for cancelled bookings");

  for (const mode of ["balance", "verification"]) {
    eligibilityMode = mode;
    await history(); await click("Book again", card(0));
    await wait("location.pathname === '/vehicle-details'");
    await wait(mode === "balance" ? "document.body.innerText.includes('Pay your remaining balance first')" : "document.body.innerText.includes('Verify Identity to Book')");
    assert.equal(await evaluate(`${unavailableAlerts}.length`), 0, "Eligibility failures do not show a vehicle-unavailable alert");
    assert.equal(writes.length, 1);
  }
  eligibilityMode = "eligible";
  createMode = "busy";
  await details(); await click("Book Now");
  await wait("document.body.innerText.includes('Another booking update is in progress')");
  assert.equal(await evaluate(`${unavailableAlerts}.length`), 0, "A renter lock conflict does not show a vehicle-unavailable alert");
  assert.equal(await evaluate(`!!${button("Currently Unavailable")}`), false, "A renter lock conflict must not mark a vehicle unavailable");
  createMode = "conflict";
  await click("Book Now");
  await wait(`${button("Currently Unavailable")}?.disabled`);
  await wait(`${unavailableAlerts}.length === 1`);
  assert.equal(await evaluate("location.pathname"), "/vehicle-details");
  checks.push("Eligibility and verification gates remain; a submission-time vehicle conflict refreshes availability without misclassifying renter-lock conflicts");

  vehicleMode = "available"; createMode = "conflictRefreshFailure";
  await details(); await click("Book Now");
  await wait("document.body.innerText.includes('availability could not be refreshed')");
  assert.equal(await evaluate(`${button("Currently Unavailable")}?.disabled`), true);
  checks.push("A failed availability refresh after a conflict keeps booking disabled and explains how to recover");

  vehicleMode = "available";
  await history();
  vehicleGate = new Promise(resolve => { releaseVehicle = resolve; });
  await click("Book again", card(0));
  await wait(button("Checking availability...", card(0)));
  await click("Browse vehicles", card(6));
  await wait("location.pathname === '/vehicles'");
  vehicleGate = null; releaseVehicle();
  await pause(300);
  assert.equal(await evaluate("location.pathname"), "/vehicles");
  checks.push("Leaving history during a lookup prevents its stale response from navigating back to the booking form");

  vehicleMode = "available"; createMode = "success";
  await history();
  await send("Page.bringToFront");
  await evaluate(`${button("Book again", card(0))}.focus()`);
  assert.equal(await evaluate("document.activeElement?.textContent.trim()"), "Book again");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await wait("location.pathname === '/vehicle-details'");
  checks.push("The new action works with keyboard activation");
  assert.ok(writes.every(write => write.path === "/api/bookings" && write.method === "POST"));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, writes: writes.length, vehicleCalls, runtimeErrors: errors, screenshots }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ completedChecks: checks, runtimeErrors: errors, visibleText: await evaluate("document.body.innerText.slice(-1200)").catch(() => "") }, null, 2));
  throw error;
} finally {
  await send("Page.close").catch(() => {});
  ws.close();
}
