// Fixture browser check. Run Vite on 4184 and isolated Chrome CDP on 9244.
// API responses and notification events are local fixtures; no account or payment is used.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = "http://127.0.0.1:4184";
const renterId = "507f1f77bcf86cd799439011";
const ownerId = "507f1f77bcf86cd799439012";
const bookingId = "507f1f77bcf86cd799439021";
let role = "user";
const pickupAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const returnAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
let renterBooking = {
  _id: bookingId, status: "confirmed", returnStatus: "none", paymentStatus: "unpaid",
  pickupAt, returnAt,
  vehicle: { _id: "507f1f77bcf86cd799439031", name: "Fixture Sedan", location: "Manila" },
  owner: { _id: ownerId, name: "Fixture Owner" },
  totalAmount: 1800, transactionFee: 100,
};
let ownerBooking = {
  ...renterBooking, status: "pending", returnStatus: "none",
  renter: { _id: renterId, name: "Fixture Renter" },
};
let returnReviewCalls = 0;
let submittedReturnNote = "";

const target = await (await fetch("http://127.0.0.1:9244/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
const pending = new Map();
const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const wait = async (expression, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}`);
};
const click = (text) => evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(text)});
  if (!button) throw new Error('Missing button: ${text}');
  button.click();
})()`);
const toastCount = (message) => evaluate(`[...document.querySelectorAll('.rp-floating-alert')].filter((item) => item.textContent.includes(${JSON.stringify(message)})).length`);
const assertTopToast = async (message) => {
  const result = await evaluate(`(() => {
    const item = [...document.querySelectorAll('.rp-floating-alert')].find((node) => node.textContent.includes(${JSON.stringify(message)}));
    return item && { top: item.getBoundingClientRect().top, iconCount: item.querySelectorAll('svg').length };
  })()`);
  assert.ok(result && result.top >= 0 && result.top < 180, `Expected a top alert: ${message}`);
  assert.equal(result.iconCount, 0);
};
const screenshot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await fs.mkdir(".impeccable/review", { recursive: true });
  await fs.writeFile(`.impeccable/review/${name}.png`, Buffer.from(data, "base64"));
};
const fulfill = (requestId, body, status = 200) => send("Fetch.fulfillRequest", {
  requestId, responseCode: status,
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
  if (!url.pathname.startsWith("/api/")) return send("Fetch.continueRequest", { requestId });
  if (request.method === "OPTIONS") return fulfill(requestId, {});
  if (["/api/auth/me", "/api/auth/profile"].includes(url.pathname)) {
    return fulfill(requestId, { user: {
      _id: role === "owner" ? ownerId : renterId,
      name: role === "owner" ? "Fixture Owner" : "Fixture Renter",
      email: `${role}@example.test`, role, isVerified: true, kycStatus: "approved",
    } });
  }
  if (url.pathname === "/api/bookings/me") {
    return fulfill(requestId, { bookings: [renterBooking], page: { hasMore: false, nextCursor: null } });
  }
  if (url.pathname === `/api/bookings/${bookingId}/return-request` && request.method === "POST") {
    renterBooking = { ...renterBooking, returnStatus: "requested", returnRequest: { status: "requested" } };
    return fulfill(requestId, { success: true, booking: renterBooking });
  }
  if (url.pathname === "/api/owner/bookings") {
    return fulfill(requestId, { bookings: [ownerBooking], page: { hasMore: false, nextCursor: null } });
  }
  if (url.pathname === `/api/owner/bookings/${bookingId}/status` && request.method === "PATCH") {
    const { status } = JSON.parse(request.postData || "{}");
    ownerBooking = { ...ownerBooking, status };
    return fulfill(requestId, { success: true, booking: ownerBooking });
  }
  if (url.pathname === `/api/owner/bookings/${bookingId}/return-request` && request.method === "PATCH") {
    const { action, note } = JSON.parse(request.postData || "{}");
    returnReviewCalls += 1;
    submittedReturnNote = note;
    ownerBooking = { ...ownerBooking, returnStatus: action === "decline" ? "declined" : "confirmed", returnRequest: { status: action === "decline" ? "declined" : "confirmed", reviewNote: note } };
    return fulfill(requestId, { success: true, booking: ownerBooking });
  }
  return fulfill(requestId, { success: true, bookings: [], vehicles: [], notifications: [], page: { hasMore: false } });
}

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry?.reject(new Error(message.error.message));
    else entry?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") {
    void route(message.params).catch((error) => {
      if (!/Invalid InterceptionId/.test(error.message)) errors.push(error.message);
    });
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Page.navigate", { url: `${base}/bookings` });
  await wait("document.body.innerText.includes('Request Vehicle Return')");
  assert.equal(await evaluate("[...document.querySelectorAll('.rp-booking-card button')].find((item) => item.textContent.trim() === 'Cancel Booking')?.disabled"), false);
  assert.equal(await toastCount("Vehicle return request sent"), 0);
  await click("Request Vehicle Return");
  await wait("document.body.innerText.includes('Vehicle return request sent')");
  assert.equal(await toastCount("Vehicle return request sent"), 1);
  await assertTopToast("Vehicle return request sent");
  assert.equal(await evaluate("document.querySelector('.rp-booking-card')?.innerText.includes('Waiting for the vehicle owner to confirm receipt')"), true);
  assert.equal(await evaluate("document.querySelector('.rp-booking-card')?.innerText.includes('Vehicle return requested.')"), false);
  assert.equal(await evaluate("[...document.querySelectorAll('.rp-booking-card button')].find((item) => item.textContent.trim() === 'Cancel Booking')?.disabled"), true);
  assert.equal(await evaluate("[...document.querySelectorAll('.rp-booking-card button')].some((item) => item.textContent.trim() === 'Request Vehicle Return')"), false);

  await send("Page.navigate", { url: base });
  await wait("location.pathname === '/' && document.body.innerText.includes('RentifyPro')");
  const declined = { _id: "507f1f77bcf86cd799439051", event: "vehicle_return.declined", data: { bookingId } };
  const dispatch = async (notification) => evaluate(`(async () => {
    const { getSocket } = await import('/src/utils/socket.js');
    getSocket().listeners('notification:new').forEach((listener) => listener(${JSON.stringify(notification)}));
    return true;
  })()`);
  await dispatch(declined);
  await wait("document.body.innerText.includes('Return request declined. Booking stays active.')");
  assert.equal(await toastCount("Return request declined. Booking stays active."), 1);
  await assertTopToast("Return request declined. Booking stays active.");
  await screenshot("action-toast-renter-mobile");
  await dispatch(declined);
  assert.equal(await toastCount("Return request declined. Booking stays active."), 1);
  await new Promise((resolve) => setTimeout(resolve, 3200));
  assert.equal(await toastCount("Return request declined. Booking stays active."), 0);
  await dispatch({ _id: "507f1f77bcf86cd799439052", event: "vehicle_return.confirmed", data: { bookingId, lateReturnPenaltyFee: 150 } });
  await wait("document.body.innerText.includes('A final late-return balance is ready')");
  assert.equal(await toastCount("A final late-return balance is ready"), 1);

  role = "owner";
  await evaluate("localStorage.setItem('isNewOwner', 'true')");
  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/owner-dashboard?tab=Bookings` });
  await wait("document.body.innerText.includes('Booking Management') && document.body.innerText.includes('Approve')");
  await click("Approve");
  await wait("document.body.innerText.includes('Booking approved.')");
  assert.equal(await toastCount("Booking approved."), 1);
  await assertTopToast("Booking approved.");
  assert.equal(await evaluate("document.querySelectorAll('main p[role=\"status\"]').length"), 0);
  await screenshot("action-toast-owner-desktop");
  ownerBooking = { ...ownerBooking, returnStatus: "declined", returnRequest: { status: "declined", reviewNote: "Please check the handover location." } };
  await click("Upcoming & Active");
  await wait("[...document.querySelectorAll('article')].some((item) => item.innerText.includes('Return Declined'))");
  assert.equal(await evaluate("[...document.querySelectorAll('article')].some((item) => item.innerText.includes('Decline note: Please check the handover location.'))"), true);
  assert.equal(await evaluate("[...document.querySelectorAll('article')].some((item) => item.innerText.includes('Vehicle return request declined. The booking remains active.'))"), false);
  ownerBooking = { ...ownerBooking, returnStatus: "requested", returnRequest: { status: "requested", requestedAt: new Date().toISOString() } };
  await click("Refresh");
  await wait("document.body.innerText.includes('Decline Return Request')");
  await click("Decline Return Request");
  await wait("Boolean(document.querySelector('textarea[placeholder=\"Reason for declining the request\"]'))");
  await click("Cancel");
  assert.equal(returnReviewCalls, 0);
  await send("Page.navigate", { url: `${base}/owner-dashboard?tab=Dashboard` });
  await wait("document.body.innerText.includes('Vehicle Return Request')");
  await evaluate("[...document.querySelectorAll('button')].find((item) => item.textContent.includes('Vehicle Return Request')).click()");
  await wait("document.querySelector('[role=dialog]')?.textContent.includes('Review Vehicle Return Request')");
  await click("Decline Return Request");
  await wait("document.querySelector('[role=dialog] h2')?.textContent.includes('Decline return request')");
  await screenshot("dashboard-return-decline-modal-desktop");
  assert.equal(returnReviewCalls, 0);
  assert.equal(await evaluate("document.querySelectorAll('[role=dialog]').length"), 1);
  assert.equal(await evaluate("Boolean(document.querySelector('textarea[placeholder=\"Reason for declining the request\"]'))"), true);
  await click("Cancel");
  assert.equal(returnReviewCalls, 0);
  await evaluate("[...document.querySelectorAll('button')].find((item) => item.textContent.includes('Vehicle Return Request')).click()");
  await wait("document.querySelector('[role=dialog]')?.textContent.includes('Review Vehicle Return Request')");
  await click("Decline Return Request");
  await wait("Boolean(document.querySelector('textarea[placeholder=\"Reason for declining the request\"]'))");
  await evaluate("document.querySelector('textarea[placeholder=\"Reason for declining the request\"]').focus()");
  await send("Input.insertText", { text: "Vehicle was not handed over at the agreed location." });
  await click("Decline request");
  await wait("document.body.innerText.includes('Return request declined. Booking remains active.')");
  assert.equal(returnReviewCalls, 1);
  assert.equal(submittedReturnNote, "Vehicle was not handed over at the agreed location.");
  assert.deepEqual(errors, []);
  console.log("Action toast browser fixture passed: renter request, owner approval, declined return card, dashboard decline modal and note, mobile and desktop.");
} finally {
  ws.close();
}
