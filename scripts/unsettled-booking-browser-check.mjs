// Run with Node 20: node --experimental-websocket scripts/unsettled-booking-browser-check.mjs
// Requires a frontend preview on 4176 and an isolated headless Chrome on CDP 9236.
// All API traffic is intercepted. No real accounts, payments, or records are used.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = "http://127.0.0.1:4176";
const paymentRequests = [];
const target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const activeBooking = {
  _id: "507f1f77bcf86cd799439021",
  status: "confirmed",
  paymentStatus: "partial",
  paymentAmountPaid: 900,
  paymentAmountDue: 2100,
  pickupAt: "2030-09-19T09:00:00.000Z",
  returnAt: "2030-09-19T12:00:00.000Z",
  vehicle: { _id: "507f1f77bcf86cd799439031", name: "Upcoming Sedan", location: "Manila" },
  owner: { _id: "507f1f77bcf86cd799439041", name: "Test Owner" },
  totalAmount: 2900,
  transactionFee: 100,
  vehicleHourlyRate: 966.67,
};

const unsettledBooking = {
  _id: "507f1f77bcf86cd799439022",
  status: "completed",
  paymentStatus: "partial",
  paymentAmountPaid: 900,
  paymentAmountDue: 10598,
  walkInPayment: { status: "rejected" },
  pickupAt: "2026-09-18T09:00:00.000Z",
  returnAt: "2026-09-18T12:00:00.000Z",
  actualReturnAt: "2026-09-18T14:00:00.000Z",
  returnRequest: { status: "confirmed", confirmedAt: "2026-09-18T14:00:00.000Z" },
  lateReturn: { isOverdue: true, action: "return_confirmed", overdueMinutes: 120, penaltyFee: 8498 },
  lateReturnPenaltyFee: 8498,
  vehicle: { _id: "507f1f77bcf86cd799439032", name: "Returned SUV", location: "Quezon City" },
  owner: { _id: "507f1f77bcf86cd799439042", name: "Test Owner" },
  totalAmount: 2900,
  transactionFee: 100,
  vehicleHourlyRate: 966.67,
};

async function fulfill(event, body, status = 200) {
  await send("Fetch.fulfillRequest", {
    requestId: event.requestId,
    responseCode: status,
    responseHeaders: [
      { name: "Content-Type", value: "application/json" },
      { name: "Access-Control-Allow-Origin", value: base },
      { name: "Access-Control-Allow-Credentials", value: "true" },
      { name: "Access-Control-Allow-Headers", value: "content-type" },
      { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,PUT,DELETE,OPTIONS" },
    ],
    body: Buffer.from(JSON.stringify(body)).toString("base64"),
  });
}

async function route(event) {
  const url = new URL(event.request.url);
  if (url.pathname.includes("/api/")) {
    if (event.request.method === "OPTIONS") return fulfill(event, {});
    const endpoint = url.pathname.slice(url.pathname.indexOf("/api/") + 4);
    if (endpoint === "/auth/me") {
      return fulfill(event, { user: { _id: "507f1f77bcf86cd799439011", name: "Test Renter", email: "renter@example.test", role: "user", isVerified: true, kycStatus: "approved" } });
    }
    if (endpoint === "/bookings/me") {
      const view = url.searchParams.get("view");
      const bookings = view === "unsettled" || view === "history"
        ? [unsettledBooking]
        : view === "all"
          ? [activeBooking, unsettledBooking]
          : [activeBooking];
      return fulfill(event, { bookings, page: { hasMore: false, nextCursor: null, limit: 10 } });
    }
    if (endpoint === `/bookings/${unsettledBooking._id}/pay` && event.request.method === "POST") {
      paymentRequests.push(JSON.parse(event.request.postData || "{}"));
      return fulfill(event, { success: false, message: "Fixture checkout stopped before payment." }, 503);
    }
    return fulfill(event, { success: true, notifications: [], reports: [], unreadCount: 0, messages: [], users: [] });
  }
  if (url.origin !== base && ["http:", "https:"].includes(url.protocol)) {
    return send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" });
  }
  return send("Fetch.continueRequest", { requestId: event.requestId });
}

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

await send("Page.enable");
await send("Runtime.enable");
await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
};
const text = () => evaluate("document.body.innerText");
async function waitFor(fragment) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if ((await text()).includes(fragment)) return;
    await sleep(100);
  }
  throw new Error(`Missing UI text: ${fragment}\n${(await text()).slice(-1600)}`);
}
async function click(label) {
  const clicked = await evaluate(`(() => { const button = [...document.querySelectorAll('button,a')].find((item) => item.textContent.trim() === ${JSON.stringify(label)}); if (!button) return false; button.click(); return true; })()`);
  assert.equal(clicked, true, `Control exists: ${label}`);
}

const desktopScreenshot = path.join(os.tmpdir(), "rentifypro-unsettled-desktop.png");
const mobileScreenshot = path.join(os.tmpdir(), "rentifypro-unsettled-mobile.png");
const desktopPaymentScreenshot = path.join(os.tmpdir(), "rentifypro-unsettled-payment-desktop.png");
const mobilePaymentScreenshot = path.join(os.tmpdir(), "rentifypro-unsettled-payment-mobile.png");
try {
  await send("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/bookings` });
  await waitFor("Upcoming Sedan");
  assert.equal((await text()).includes("Returned SUV"), false);
  await click("Unsettled");
  await waitFor("Returned SUV");
  const unsettledText = await text();
  assert.ok(unsettledText.includes("Balance due"));
  assert.ok(unsettledText.includes("₱10,598.00"), unsettledText);
  assert.ok(unsettledText.includes("Pay Remaining"));
  assert.equal(unsettledText.includes("Upcoming Sedan"), false);
  await fs.writeFile(desktopScreenshot, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await click("Pay Remaining");
  assert.deepEqual(await evaluate(`(() => ({
    selected: [...document.querySelectorAll('input[name="booking-payment-method"]')].filter((input) => input.checked).length,
    disabled: [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Proceed to Pay')?.disabled,
    hasAmountSummary: document.body.innerText.includes('Amount to Pay Now'),
  }))()`), { selected: 0, disabled: true, hasAmountSummary: false });
  await fs.writeFile(desktopPaymentScreenshot, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
  assert.equal(await evaluate(`(() => { const bounds = document.querySelector('[role="dialog"] section')?.getBoundingClientRect(); return Boolean(bounds && bounds.left >= 0 && bounds.right <= window.innerWidth && bounds.top >= 0 && bounds.bottom <= window.innerHeight); })()`), true);
  await fs.writeFile(mobilePaymentScreenshot, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  assert.equal(await evaluate(`(() => { const label = [...document.querySelectorAll('label')].find((item) => item.textContent.includes('Request Walk-in Payment')); label?.click(); return Boolean(label); })()`), true);
  await waitFor("Request Walk-in Approval");
  assert.equal(await evaluate(`(() => { const label = [...document.querySelectorAll('label')].find((item) => item.textContent.includes('Credit / Debit Card')); label?.click(); return Boolean(label); })()`), true);
  await waitFor("Amount to Pay Now");
  assert.equal(await evaluate(`(() => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Proceed to Pay')?.disabled)()`), false);
  await click("Proceed to Pay");
  for (let attempt = 0; attempt < 40 && paymentRequests.length === 0; attempt += 1) await sleep(100);
  assert.deepEqual(paymentRequests, [{ paymentScope: "full", paymentChannel: "card" }]);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
  assert.equal(await evaluate("[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Unsettled')"), true);
  await fs.writeFile(mobileScreenshot, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: 15, desktopScreenshot, mobileScreenshot, desktopPaymentScreenshot, mobilePaymentScreenshot }, null, 2));
} finally {
  await send("Page.close");
  ws.close();
}
