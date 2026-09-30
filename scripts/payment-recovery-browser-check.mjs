// Fixture check: run the frontend on 4186 and isolated Chrome CDP on 9246.
// All payment responses are intercepted; no real checkout or account is used.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = "http://127.0.0.1:4186";
const bookingId = "507f1f77bcf86cd799439021";
const checkoutId = "fixture-checkout-1";
const userId = "507f1f77bcf86cd799439011";
const bookingBase = {
  _id: bookingId,
  status: "confirmed",
  paymentStatus: "unpaid",
  paymongoCheckoutId: checkoutId,
  paymentAmountPaid: 0,
  paymentAmountDue: 1800,
  pickupAt: "2030-09-19T09:00:00.000Z",
  returnAt: "2030-09-19T12:00:00.000Z",
  vehicle: { _id: "507f1f77bcf86cd799439031", name: "Fixture Sedan", location: "Manila" },
  owner: { _id: "507f1f77bcf86cd799439041", name: "Fixture Owner" },
  totalAmount: 1700,
  transactionFee: 100,
};
let booking = { ...bookingBase };
let verifyCount = 0;
let scenario = "retry";
const errors = [];

const target = await (await fetch("http://127.0.0.1:9246/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
const pending = new Map();
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
  throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(0, 2000)")}\n${errors.join("\n")}`);
};
const fulfill = (requestId, body, status = 200) => send("Fetch.fulfillRequest", {
  requestId,
  responseCode: status,
  responseHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" },
    { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
  ],
  body: Buffer.from(JSON.stringify(body)).toString("base64"),
});

async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return send("Fetch.continueRequest", { requestId });
  if (request.method === "OPTIONS") return fulfill(requestId, {});
  if (url.pathname === "/api/auth/me") {
    return fulfill(requestId, { user: {
      _id: userId, name: "Fixture Renter", email: "renter@example.test",
      role: "user", isVerified: true, kycStatus: "approved",
    } });
  }
  if (url.pathname === "/api/bookings/me") {
    return fulfill(requestId, { bookings: [booking], page: { hasMore: false, nextCursor: null } });
  }
  if (url.pathname === `/api/bookings/${bookingId}/pay/verify`) {
    verifyCount += 1;
    if (verifyCount === 1 || scenario === "stale") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return fulfill(requestId, { success: false, message: "Verification temporarily unavailable." }, 503);
    }
    booking = { ...booking, paymentStatus: "paid", paymentAmountPaid: 1800, paymentAmountDue: 0 };
    return fulfill(requestId, {
      success: true, paymentCaptured: true, paymentStatus: "paid", checkoutId,
      booking,
    });
  }
  return fulfill(requestId, { success: true, notifications: [], unreadCount: 0 });
}

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry?.reject(new Error(message.error.message));
    else entry?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") {
    void route(message.params).catch((error) => errors.push(error.message));
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Page.navigate", { url: `${base}/bookings?payment=success&bookingId=${bookingId}&checkoutId=${checkoutId}` });
  await wait("document.body.innerText.includes('Processing payment, please wait...')");
  assert.equal(await evaluate("[...document.querySelectorAll('.rp-floating-alert')].some((item) => item.textContent.includes('Processing payment, please wait...') && item.getBoundingClientRect().top < 180 && item.querySelectorAll('svg').length === 0)"), true);
  await wait("[...document.querySelectorAll('.rp-page-shell button')].some((button) => button.textContent.trim() === 'Retry verification')");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
  assert.equal(await evaluate(`(() => {
    const retry = [...document.querySelectorAll('.rp-floating-alert')].find((item) => item.textContent.includes('Retry verification'));
    return Boolean(retry && retry.getBoundingClientRect().top >= 0 && retry.getBoundingClientRect().top < 180 && retry.querySelectorAll('svg').length === 0);
  })()`), true);
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Pay Now')?.disabled"), true);
  const mobileScreenshot = path.join(os.tmpdir(), "rentifypro-payment-retry-mobile.png");
  await fs.writeFile(mobileScreenshot, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await new Promise((resolve) => setTimeout(resolve, 3200));
  assert.equal(await evaluate("[...document.querySelectorAll('.rp-floating-alert')].some((item) => item.textContent.includes('Retry verification'))"), false);
  assert.equal(await evaluate("[...document.querySelectorAll('.rp-page-shell button')].some((button) => button.textContent.trim() === 'Retry verification')"), true);
  await evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Retry verification').click()");
  await wait("document.body.innerText.includes('Payment successful.')");
  assert.equal(await evaluate("location.search"), "");
  assert.equal(verifyCount, 2);

  scenario = "stale";
  verifyCount = 0;
  booking = { ...bookingBase };
  await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/bookings?payment=success&bookingId=${bookingId}&checkoutId=${checkoutId}` });
  await wait("[...document.querySelectorAll('.rp-page-shell button')].some((button) => button.textContent.trim() === 'Retry verification')", 30000);
  booking = { ...booking, paymentStatus: "paid", paymentAmountPaid: 1800, paymentAmountDue: 0 };
  await evaluate("[...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Refresh bookings').click()");
  await wait("document.body.innerText.includes('Confirmed · Paid') && !document.body.innerText.includes('Retry verification')");
  assert.equal(await evaluate("location.search"), "");
  const desktopScreenshot = path.join(os.tmpdir(), "rentifypro-payment-paid-desktop.png");
  await fs.writeFile(desktopScreenshot, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "payment recovery fixture passed", mobileScreenshot, desktopScreenshot }, null, 2));
} finally {
  await send("Page.close");
  ws.close();
}
