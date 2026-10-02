// Fixture browser check: frontend preview on 4187 and isolated CDP browser on 9247.
// No real account, booking, payment, or review data is used.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = "http://127.0.0.1:4187";
const target = await (await fetch("http://127.0.0.1:9247/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const now = Date.now();
const day = 86400000;
const renterId = "507f1f77bcf86cd799439011";
const ownerId = "507f1f77bcf86cd799439012";
const returned = (id, name, age, paid) => ({
  _id: id, status: "completed", paymentStatus: paid ? "paid" : "partial",
  paymentAmountPaid: paid ? 1140 : 500, paymentAmountDue: paid ? 0 : 640,
  totalAmount: 1000, transactionFee: 140, vehicleHourlyRate: 250,
  pickupAt: new Date(now - (age + 1) * day).toISOString(),
  returnAt: new Date(now - age * day - 3600000).toISOString(),
  actualReturnAt: new Date(now - age * day).toISOString(),
  returnRequest: { status: "confirmed", confirmedAt: new Date(now - age * day).toISOString() },
  vehicle: { _id: `vehicle-${id}`, name, location: "Dagupan City", images: [] },
  owner: { _id: ownerId, name: "Fixture Owner" },
});
const paid = returned("507f1f77bcf86cd799439021", "Returned SUV", 1, true);
const due = returned("507f1f77bcf86cd799439022", "Balance due sedan", 1, false);
const old = returned("507f1f77bcf86cd799439023", "Older rental", 40, true);
let role = "user";
let reviewPayload = null;
let sequence = 0;
const pending = new Map();
const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const fulfill = (requestId, body, responseCode = 200) => send("Fetch.fulfillRequest", {
  requestId, responseCode,
  responseHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" },
    { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,OPTIONS" },
  ],
  body: Buffer.from(JSON.stringify(body)).toString("base64"),
});
const ownerReviews = [
  { _id: "one", rating: 5, comment: "Clean and easy pickup.", createdAt: new Date(now - day).toISOString(), renter: { name: "Renter One", email: "private1@example.test" }, vehicle: { _id: "v1", name: "SUV" } },
  { _id: "two", rating: 4, comment: "Good ride.", createdAt: new Date(now - 2 * day).toISOString(), renter: { name: "Renter Two", email: "private2@example.test" }, vehicle: { _id: "v1", name: "SUV" } },
  { _id: "three", rating: 3, comment: "Pickup took longer than expected.", createdAt: new Date(now - 3 * day).toISOString(), renter: { name: "Renter Three" }, vehicle: { _id: "v2", name: "Sedan" } },
  { _id: "four", rating: 1, comment: "The interior needed cleaning.", createdAt: new Date(now - 4 * day).toISOString(), renter: { name: "Renter Four" }, vehicle: { _id: "v2", name: "Sedan" } },
];
const route = ({ requestId, request }) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    if (url.pathname === "/api/auth/me" || url.pathname === "/api/auth/profile") return fulfill(requestId, { user: {
      _id: role === "owner" ? ownerId : renterId, role, name: role === "owner" ? "Fixture Owner" : "Fixture Renter",
      email: `${role}@example.test`, isVerified: true, kycStatus: "approved",
    } });
    if (url.pathname === "/api/bookings/me") return fulfill(requestId, { success: true,
      bookings: ["history", "all"].includes(url.searchParams.get("view")) ? [paid, due, old] : [],
      page: { hasMore: false, nextCursor: null },
    });
    if (url.pathname === `/api/bookings/${paid._id}/review` && request.method === "PATCH") {
      reviewPayload = JSON.parse(request.postData || "{}");
      Object.assign(paid, { reviewRating: reviewPayload.rating, reviewComment: reviewPayload.comment });
      return fulfill(requestId, { success: true, booking: paid });
    }
    if (url.pathname === `/api/bookings/${paid._id}/pay/verify` && request.method === "POST") {
      return fulfill(requestId, { success: true, paymentCaptured: true, checkoutStatus: "paid", booking: paid });
    }
    if (url.pathname === "/api/owner/reviews") return fulfill(requestId, { success: true, reviews: ownerReviews });
    return fulfill(requestId, { success: true, bookings: [], vehicles: [], notifications: [], unreadCount: 0, stats: {}, summary: {} });
  }
  if (url.origin === base) return send("Fetch.continueRequest", { requestId });
  return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
};
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error.message));
    else call?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") {
    route(message.params).catch((error) => errors.push(error.message));
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
};
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const wait = async (expression) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-1800)")}`);
};
const screenshot = async (name) => {
  const file = path.join(os.tmpdir(), name);
  await fs.writeFile(file, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  return file;
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Storage.clearDataForOrigin", { origin: base, storageTypes: "all" });
  await send("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/bookings` });
  await wait("document.querySelector('dialog[open]') && document.body.innerText.includes('How was Returned SUV?')");
  assert.equal(await evaluate("document.querySelector('dialog[open]')?.contains(document.activeElement)"), true);
  assert.equal(await evaluate("document.body.innerText.includes('How was Balance due sedan?')"), false);
  assert.equal(await evaluate("document.querySelector('dialog').innerText.includes('Completed rental')"), false);
  assert.equal(await evaluate("document.querySelector('dialog').innerText.includes('1 star is poor')"), false);
  assert.equal(await evaluate("document.querySelector('dialog #booking-review-title')?.parentElement?.previousElementSibling?.tagName"), "DIV");
  const renterDesktop = await screenshot("rentifypro-review-renter-desktop.png");
  await evaluate("document.querySelector('dialog form').requestSubmit()");
  await wait("document.querySelector('#booking-rating-error')");
  assert.equal(await evaluate("document.activeElement?.getAttribute('name')"), "booking-rating");
  assert.equal(reviewPayload, null);
  await evaluate("document.querySelector('input[value=\"2\"]').click()");
  await evaluate("document.querySelector('#booking-review-comment').focus()");
  await send("Input.insertText", { text: "   " });
  await wait("document.querySelector('#booking-review-comment').value === ''");
  await send("Input.insertText", { text: "Clean" });
  await send("Input.insertText", { text: "!" });
  await wait("document.querySelector('#booking-review-comment').value === 'Clean'");
  await send("Input.insertText", { text: " " });
  await send("Input.insertText", { text: " " });
  await wait("document.querySelector('#booking-review-comment').value === 'Clean '");
  await send("Input.insertText", { text: "car" });
  await send("Input.insertText", { text: "🚗" });
  await wait("document.querySelector('#booking-review-comment').value === 'Clean car'");
  await send("Input.insertText", { text: "  2026" });
  await wait("document.querySelector('#booking-review-comment').value === 'Clean car 2026'");
  assert.equal(await evaluate("document.activeElement?.id"), "booking-review-comment");
  assert.equal(await evaluate("document.querySelector('#booking-review-comment')?.getAttribute('aria-invalid')"), "false");
  assert.equal(await evaluate("document.querySelector('#booking-review-comment-error')"), null);
  assert.equal(reviewPayload, null);
  await evaluate("document.querySelector('dialog form').requestSubmit()");
  await wait("document.body.innerText.includes('Thanks for your review')");
  assert.deepEqual(reviewPayload, { rating: 2, comment: "Clean car 2026" });
  await evaluate("[...document.querySelectorAll('dialog button')].find(button => button.textContent.trim() === 'Done').click()");
  await wait("!document.querySelector('dialog[open]')");
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'History').click()");
  await wait("document.body.innerText.includes('Balance due sedan')");
  assert.equal(await evaluate("document.body.innerText.includes('Your review: 2/5')"), true);
  assert.equal(await evaluate("document.querySelector('dialog[open]') === null"), true);
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  await evaluate("[...document.querySelectorAll('.rp-booking-card')].find(card => card.textContent.includes('Balance due sedan')).querySelectorAll('button').forEach(button => { if (button.textContent.includes('Rate this rental')) button.click(); })");
  await wait("document.querySelector('dialog[open]')");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  const renterMobile = await screenshot("rentifypro-review-renter-mobile.png");
  await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate("document.querySelector('dialog').scrollWidth <= innerWidth"), true);
  await evaluate("document.querySelector('dialog button[type=submit]').scrollIntoView({ block: 'end' })");
  assert.equal(await evaluate("document.querySelector('dialog button[type=submit]').getBoundingClientRect().bottom <= innerHeight"), true);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait("!document.querySelector('dialog[open]')");

  role = "owner";
  await send("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/owner-dashboard?tab=Reviews` });
  await wait("document.body.innerText.includes('Negative') && document.body.innerText.includes('Renter Four')");
  const ownerDesktop = await screenshot("rentifypro-review-owner-desktop.png");
  assert.equal(await evaluate("document.querySelector('[data-testid=owner-review-donut]')?.getAttribute('aria-label')"), "4 reviews: 2 positive, 1 neutral, 1 negative");
  assert.equal(await evaluate("document.querySelector('[data-testid=owner-review-donut]').getBoundingClientRect().width >= 380"), true);
  assert.equal(await evaluate("document.querySelector('[data-testid=owner-review-donut]').getBoundingClientRect().left < document.querySelector('[data-testid=owner-review-total]').getBoundingClientRect().left"), true);
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Filter reviews by rating\"]').getBoundingClientRect().left > document.querySelector('[data-testid=owner-review-donut]').getBoundingClientRect().right"), true);
  assert.equal(await evaluate("[...document.querySelectorAll('h2')].find(heading => heading.textContent === 'Average rating')?.getBoundingClientRect().bottom < document.querySelector('[aria-label=\"Filter reviews by rating\"]').getBoundingClientRect().top"), true);
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Filter reviews by rating\"]').getBoundingClientRect().top < document.querySelector('[data-testid=owner-review-total]').getBoundingClientRect().top"), true);
  assert.equal(await evaluate("document.querySelector('[data-testid=owner-review-donut] text')"), null);
  assert.equal(await evaluate(`(() => {
    const chart = document.querySelector('[data-testid=owner-review-donut]');
    const slices = [...chart.querySelectorAll('path')];
    const positivePoint = new DOMPoint(170, 100);
    return chart.querySelector('circle')?.getAttribute('fill') === '#16A34A' &&
      slices.some((slice) => slice.getAttribute('fill') === '#EAB308') &&
      slices.some((slice) => slice.getAttribute('fill') === '#DC2626') &&
      slices.every((slice) => !slice.isPointInFill(positivePoint));
  })()`), true);
  assert.equal(await evaluate("document.body.innerText.includes('private1@example.test')"), false);
  assert.equal(await evaluate("document.body.innerText.includes('3.3')"), true);
  await send("Emulation.setDeviceMetricsOverride", { width: 1900, height: 1024, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  const ownerWide = await screenshot("rentifypro-review-owner-wide.png");
  await evaluate("(() => { const select = document.querySelector('#owner-review-vehicle'); select.value = 'v2'; select.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await wait("document.querySelector('[data-testid=owner-review-donut]')?.getAttribute('aria-label') === '2 reviews: 0 positive, 1 neutral, 1 negative'");
  await evaluate("(() => { const select = document.querySelector('#owner-review-vehicle'); select.value = 'all'; select.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await wait("document.querySelector('[data-testid=owner-review-donut]')?.getAttribute('aria-label')?.startsWith('4 reviews')");
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Negative')).click()");
  await wait("document.body.innerText.includes('Showing 1 of 4 reviews')");
  assert.equal(await evaluate("document.body.innerText.includes('The interior needed cleaning.')"), true);
  assert.equal(await evaluate("document.body.innerText.includes('Clean and easy pickup.')"), false);
  assert.equal(await evaluate("document.body.innerText.includes('3.3')"), true);
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  const ownerMobile = await screenshot("rentifypro-review-owner-mobile.png");
  await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  assert.equal(await evaluate(`(() => {
    const million = new Intl.NumberFormat('en-PH').format(1000000);
    const total = document.querySelector('[data-testid=owner-review-total]');
    const legend = document.querySelector('[aria-label="Filter reviews by rating"]');
    total.querySelector('p:last-child').textContent = million;
    legend.querySelectorAll('button').forEach((button) => { button.lastElementChild.textContent = million; });
    return document.documentElement.scrollWidth <= innerWidth && total.scrollWidth <= total.clientWidth &&
      [...legend.querySelectorAll('button')].every((button) => button.scrollWidth <= button.clientWidth);
  })()`), true);

  role = "user";
  delete paid.reviewRating;
  delete paid.reviewComment;
  await send("Storage.clearDataForOrigin", { origin: base, storageTypes: "all" });
  await send("Page.navigate", { url: `${base}/bookings?bookingId=${paid._id}&payment=success&checkoutId=fixture-checkout` });
  await wait("document.body.innerText.includes('Payment successful.')");
  assert.equal(await evaluate("document.querySelector('dialog[open]') === null"), true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, reviewPayload, renterDesktop, renterMobile, ownerDesktop, ownerWide, ownerMobile, runtimeErrors: errors }, null, 2));
} finally {
  await send("Page.close").catch(() => {});
  ws.close();
}
