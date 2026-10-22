// Run against isolated Vite and Chrome instances. All APIs use synthetic fixtures.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = process.env.BOOKING_VISIBILITY_BASE || "http://127.0.0.1:4187";
const cdp = process.env.BOOKING_VISIBILITY_CDP || "http://127.0.0.1:9247";
const renter = { _id: "507f1f77bcf86cd799439011", name: "Fixture Renter", role: "user", isVerified: true, kycStatus: "approved" };
const owner = { _id: "507f1f77bcf86cd799439012", name: "Fixture Owner", role: "owner", isVerified: true, kycStatus: "approved" };
const vehicle = {
  _id: "507f1f77bcf86cd799439014", name: "New request vehicle", owner,
  location: "Dagupan City, Pangasinan", hourlyRentalRate: 250, dailyRentalRate: 250,
  pricingUnit: "hourly", availabilityStatus: "available", images: [], reviews: [],
  specs: { type: "Car", transmission: "Automatic", seats: 5 },
};
const booking = (id, status, name, pickupDays = 2) => ({
  _id: id, owner, renter, vehicle: { ...vehicle, name }, status,
  paymentStatus: "unpaid", paymentAmountPaid: 0, paymentAmountDue: 1100,
  totalAmount: 1000, amountPayable: 1100, transactionFee: 100, vehicleHourlyRate: 250,
  bookingDurationMinutes: 240, pickupAt: new Date(Date.now() + pickupDays * 86400000).toISOString(),
  returnAt: new Date(Date.now() + pickupDays * 86400000 + 14400000).toISOString(),
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});
const submitted = booking("507f1f77bcf86cd799439021", "pending", vehicle.name);
const existing = booking("507f1f77bcf86cd799439022", "pending", "Earlier unanswered request");
const active = booking("507f1f77bcf86cd799439023", "confirmed", "Nearest pickup", 1);
const later = booking("507f1f77bcf86cd799439024", "confirmed", "Later pickup", 5);
const live = booking("507f1f77bcf86cd799439025", "pending", "Live booking request");
let user = renter, submittedOnce = false, liveReceived = false, detailFailure = false, createFailure = false;
let liveStatus = "pending", postCalls = 0, detailCalls = 0;
const listCalls = [], errors = [], checks = [], screenshots = [];
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0, activeRoutes = 0;
const pending = new Map();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
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
  if (!url.pathname.startsWith("/api/")) {
    if (url.origin !== base) return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
    return send("Fetch.continueRequest", { requestId });
  }
  if (request.method === "OPTIONS") return fulfill(requestId, {});
  if (url.pathname === "/api/auth/me") return fulfill(requestId, { user });
  if (url.pathname === "/api/kyc/me") return fulfill(requestId, { verification: {
    accountStatus: "active", emailVerified: true, selfieVerified: true, bookingEligible: true, documents: [],
  } });
  if (url.pathname === `/api/vehicles/${vehicle._id}`) return fulfill(requestId, { vehicle });
  if (url.pathname === "/api/bookings/eligibility") return fulfill(requestId, {
    eligibility: { eligible: true, limits: { open: 3, pending: 2 }, counts: { open: 0, pending: 0 }, reasons: [] },
  });
  if (url.pathname === "/api/bookings" && request.method === "POST") {
    postCalls++;
    if (createFailure) return fulfill(requestId, { success: false, message: "Fixture booking could not be submitted." }, 409);
    submittedOnce = true;
    return fulfill(requestId, { success: true, booking: submitted });
  }
  if (url.pathname === `/api/bookings/${submitted._id}`) {
    detailCalls++;
    return detailFailure
      ? fulfill(requestId, { message: "Fixture request is temporarily unavailable." }, 503)
      : fulfill(requestId, { success: true, booking: submitted });
  }
  if (["/api/bookings/me", "/api/owner/bookings"].includes(url.pathname)) {
    const view = url.searchParams.get("view"), cursor = url.searchParams.get("cursor");
    listCalls.push({ role: user.role, view, cursor });
    let records = [];
    if (view === "active") records = [active, later];
    if (view === "all") records = cursor ? [submitted, active] : [existing, active];
    if (view === "action") records = liveReceived && liveStatus === "pending" ? [live, existing] : [existing];
    return fulfill(requestId, { success: true, bookings: records, page: {
      hasMore: view === "all" && !cursor, nextCursor: view === "all" && !cursor ? "fixture-next-page" : null,
    } });
  }
  return fulfill(requestId, { success: true, bookings: [], vehicles: [], notifications: [], conversations: [], unreadCount: 0, total: 0, stats: {}, summary: {} });
}
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  } else if (message.method === "Fetch.requestPaused") {
    activeRoutes++;
    route(message.params).catch((error) => errors.push(`${error.message}: ${message.params.request.url}`))
      .finally(() => { activeRoutes--; });
  }
};
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function wait(expression) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${expression}`);
}
const button = (label) => `[...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(label)})`;
const click = async (label) => { await wait(button(label)); await evaluate(`${button(label)}.click()`); };
async function enter(label) {
  await wait(button(label));
  await evaluate(`${button(label)}.focus()`);
  assert.equal(await evaluate("document.activeElement?.textContent.trim()"), label);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}
async function navigate(url) {
  for (let attempt = 0; activeRoutes && attempt < 100; attempt++) await pause(25);
  assert.equal(activeRoutes, 0);
  await send("Page.navigate", { url });
}
async function openDetails() {
  await navigate(`${base}/vehicle-details?vehicleId=${vehicle._id}`);
  await wait("[...document.querySelectorAll('button')].some(el => el.textContent.trim() === 'Book Now' && !el.disabled)");
  await evaluate(`(() => {
    const pickup = new Date(Date.now() + 86400000), dropoff = new Date(Date.now() + 100800000);
    const date = value => value.getFullYear() + '-' + String(value.getMonth()+1).padStart(2,'0') + '-' + String(value.getDate()).padStart(2,'0');
    const time = value => String(value.getHours()).padStart(2,'0') + ':' + String(value.getMinutes()).padStart(2,'0');
    [...document.querySelectorAll('input[type=date], input[type=time]')].forEach((field, index) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, [date(pickup),time(pickup),date(dropoff),time(dropoff)][index]);
      field.dispatchEvent(new Event('input', {bubbles:true}));
    });
  })()`);
  await pause(400);
}
async function responsive(label) {
  for (const width of [1440, 768, 390, 320]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
    await pause(100);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth"), true, `${label} overflow at ${width}`);
    if (label === "owner" && width < 500) {
      assert.equal(await evaluate("[...document.querySelectorAll('[role=status]')].find(el => el.textContent.includes('New booking request received'))?.getBoundingClientRect().width >= 200"), true, "Owner notice remains readable on narrow screens");
    }
    if (width === 1440 || width === 390) {
      const screenshotPath = path.join(os.tmpdir(), `rentifypro-booking-visibility-${label}-${width}.png`);
      const screenshot = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
      screenshots.push(screenshotPath);
    }
  }
}
async function socketUpdate(record) {
  await evaluate(`(async () => {
    const {getSocket} = await import('/src/utils/socket.js');
    getSocket().listeners('booking:updated').forEach(listener => listener(${JSON.stringify(record)}));
  })()`);
}

try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await openDetails(); await click("Book Now");
  await wait("location.pathname === '/bookings' && document.querySelector('[aria-label=\"Booking views\"]')");
  assert.equal(submittedOnce, true);
  assert.equal(await evaluate(`${button("All")}?.getAttribute('aria-pressed')`), "true", "Submission must open a view containing pending requests");
  await wait(`document.querySelector('#booking-${submitted._id}')?.getAttribute('data-highlighted') === 'true'`);
  assert.equal(await evaluate("document.querySelector('article.rp-booking-card')?.id"), `booking-${submitted._id}`);
  assert.equal(await evaluate("document.activeElement?.id"), `booking-${submitted._id}`);
  assert.ok(detailCalls > 0, "Request outside the first page is fetched through the authorized detail endpoint");
  assert.equal(postCalls, 1);
  checks.push("Submission opens All, fetches the missing request, pins it once and focuses its highlighted card");
  await responsive("renter");
  await click("Load more");
  await wait(`document.querySelectorAll('#booking-${submitted._id}').length === 1 && !${button("Load more")}`);
  assert.ok(listCalls.some(call => call.cursor === "fixture-next-page"));
  assert.equal(await evaluate("document.querySelectorAll('article.rp-booking-card').length"), 3);
  checks.push("Load more preserves the server cursor and does not duplicate the highlighted request");
  await click("Active");
  await wait("document.querySelectorAll('article.rp-booking-card').length === 2");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.rp-booking-vehicle-title')].map(el => el.textContent)"), [active.vehicle.name, later.vehicle.name]);
  assert.equal(await evaluate(`!!document.querySelector('#booking-${submitted._id}')`), false);
  await click("All"); await wait(`document.querySelector('#booking-${submitted._id}')`);
  await enter("Dismiss highlight");
  await wait("!document.querySelector('[data-highlighted=true]')");
  assert.equal(await evaluate("document.activeElement?.id"), `booking-${submitted._id}`);
  checks.push("Active keeps pickup order and excludes pending requests; highlighting is dismissible");

  await openDetails(); createFailure = true; await click("Book Now");
  await wait("document.body.innerText.includes('Fixture booking could not be submitted.')");
  assert.equal(await evaluate("location.pathname"), "/vehicle-details");
  createFailure = false; detailFailure = true;
  await click("Book Now"); await wait("location.pathname === '/bookings'");
  await wait("document.body.innerText.includes('Your booking request could not be opened')");
  assert.ok(await evaluate("document.body.innerText.includes('Earlier unanswered request')"));
  detailFailure = false; await click("Retry");
  await wait(`document.querySelector('#booking-${submitted._id}')?.getAttribute('data-highlighted') === 'true'`);
  checks.push("Failed submission stays on the form; a failed request lookup preserves the list and can be retried");
  await navigate(`${base}/bookings`);
  await wait(`${button("Active")}?.getAttribute('aria-pressed') === 'true'`);
  assert.equal(await evaluate("!!document.querySelector('[data-highlighted=true]')"), false);
  checks.push("Ordinary visits keep the existing Active default without retaining submitted booking data");

  user = owner;
  await navigate(`${base}/owner-dashboard?tab=Bookings`);
  await wait("document.body.innerText.includes('Earlier unanswered request')");
  assert.equal(await evaluate(`${button("Needs Action")}?.getAttribute('aria-pressed')`), "true");
  assert.ok(await evaluate("document.body.innerText.includes('Awaiting your review')"));
  assert.equal(await evaluate("document.body.innerText.includes('New booking request received')"), false);
  await click("Upcoming & Active");
  await wait("document.querySelectorAll('article.rp-booking-card').length === 2");
  liveReceived = true;
  await socketUpdate(live); await socketUpdate(live);
  await wait("document.body.innerText.includes('New booking request received')");
  assert.equal(await evaluate(`!!document.querySelector('#booking-${live._id}')`), false);
  await enter("View requests");
  await wait(`document.querySelector('#booking-${live._id}')`);
  assert.ok(await evaluate(`document.querySelector('#booking-${live._id}').innerText.includes('New booking request')`));
  assert.equal(await evaluate(`document.querySelectorAll('#booking-${live._id}').length`), 1);
  await responsive("owner");
  checks.push("Owners see accurate pending labels and a deduplicated live notice from Active that opens Needs Action");
  liveStatus = "confirmed";
  await socketUpdate({ ...live, status: liveStatus, updatedAt: new Date(Date.now() + 1000).toISOString() });
  await wait("!document.body.innerText.includes('New booking request received')");
  assert.equal(await evaluate(`!!document.querySelector('#booking-${live._id}')`), false);
  await socketUpdate({ ...live, _id: "507f1f77bcf86cd799439026", status: "cancelled", cancellationStatus: "requested" });
  assert.equal(await evaluate("document.querySelectorAll('article.rp-booking-card').length"), 1);
  checks.push("Reviewed requests clear their new indicator; terminal bookings stay out of Needs Action");
  await socketUpdate({ ...live, _id: "507f1f77bcf86cd799439027" });
  await wait("document.body.innerText.includes('New booking request received')");
  await enter("Dismiss notice");
  await wait("!document.body.innerText.includes('New booking request received')");
  assert.equal(await evaluate("document.activeElement?.textContent.trim()"), "Needs Action");
  checks.push("Owner notice is dismissible without changing any booking");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, postCalls, detailCalls, runtimeErrors: errors, screenshots }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ completedChecks: checks, runtimeErrors: errors, visibleText: await evaluate("document.body.innerText").catch(() => "") }, null, 2));
  throw error;
} finally {
  await send("Page.close").catch(() => {});
  ws.close();
}
