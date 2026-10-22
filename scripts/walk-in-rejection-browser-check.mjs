// Isolated Vite and headless Chrome only; API requests are intercepted with fixtures.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = process.env.WALK_IN_BROWSER_BASE || "http://127.0.0.1:4186";
const cdp = process.env.WALK_IN_BROWSER_CDP || "http://127.0.0.1:9246";
const owner = { _id: "507f1f77bcf86cd799439011", name: "Fixture Owner", role: "owner", isVerified: true, kycStatus: "approved" };
const renter = { _id: "507f1f77bcf86cd799439012", name: "Fixture Renter", role: "user", isVerified: true, kycStatus: "approved" };
const fixture = () => ({
  _id: "507f1f77bcf86cd799439013", owner, renter,
  vehicle: { _id: "507f1f77bcf86cd799439014", name: "Walk-in fixture vehicle", images: [] },
  status: "confirmed", paymentStatus: "partial", paymentAmountPaid: 330, paymentAmountDue: 770,
  totalAmount: 1000, amountPayable: 1100, transactionFee: 100, vehicleHourlyRate: 250,
  bookingDurationMinutes: 240, pickupAt: "2030-01-01T10:00:00Z", returnAt: "2030-01-01T14:00:00Z",
  updatedAt: "2026-10-21T01:00:00Z", walkInPayment: { status: "requested", requestedAt: "2026-10-21T01:00:00Z" },
});
let booking = fixture(), user = owner, mode = "success", heldRequest;
const patches = [], errors = [], checks = [], screenshots = [];
const cancelledRequests = new Set();
let cancelledFixtureResponses = 0;
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0, activeRoutes = 0, lastRequestAt = Date.now();
const pending = new Map();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const notification = () => ({
  _id: "507f1f77bcf86cd799439015", event: "walkin_payment.rejected", type: "booking_payment", category: "payment",
  title: "Walk-in payment rejected", message: `Your walk-in payment request was rejected by the owner.\nReason: ${booking.walkInPayment.reviewNote}`,
  createdAt: "2026-10-21T02:00:00Z", data: { bookingId: booking._id, walkInPaymentStatus: "rejected" },
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
    if (url.pathname === "/api/auth/me") return fulfill(requestId, { user });
    if (url.pathname === "/api/owner/bookings") return fulfill(requestId, { bookings: [booking], page: { hasMore: false } });
    if (url.pathname.endsWith("/walk-in-request") && request.method === "PATCH") {
      const body = JSON.parse(request.postData);
      patches.push(body);
      if (mode === "failure") return fulfill(requestId, { success: false, message: "Fixture rejection could not be saved. Try again." }, 503);
      booking = { ...booking, walkInPayment: { ...booking.walkInPayment, status: body.action === "reject" ? "rejected" : "approved", reviewNote: body.note || "" } };
      if (mode === "held") { heldRequest = requestId; return; }
      return fulfill(requestId, { success: true, booking });
    }
    if (url.pathname === "/api/notifications") return fulfill(requestId, { notifications: [notification()], unreadCount: 1, page: { hasMore: false } });
    return fulfill(requestId, { success: true, bookings: [], vehicles: [], notifications: [], conversations: [], reports: [], unreadCount: 0, total: 0, stats: {}, summary: {} });
  }
  if (url.origin !== base) return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
  return send("Fetch.continueRequest", { requestId });
}
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  } else if (message.method === "Network.loadingFailed" && message.params.canceled) {
    cancelledRequests.add(message.params.requestId);
  } else if (message.method === "Fetch.requestPaused") {
    activeRoutes++;
    lastRequestAt = Date.now();
    route(message.params).catch(async (error) => {
      // React can abort an in-flight fetch when a page unmounts or an effect restarts.
      if (error.message === "Invalid InterceptionId.") {
        await pause(50);
        if (cancelledRequests.has(message.params.networkId)) {
          cancelledFixtureResponses++;
          return;
        }
      }
      errors.push(`${error.message} (${message.params.request.url})`);
    }).finally(() => { activeRoutes--; });
  }
};
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function wait(expression) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${expression}`);
}
const button = (label) => `[...(document.querySelector('dialog[open]') || document).querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(label)})`;
const click = async (label) => { await wait(button(label)); await evaluate(`${button(label)}.click()`); };
const field = "document.querySelector('#walk-in-rejection-reason')";
const setReason = (value) => evaluate(`(() => { const el = ${field}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', {bubbles:true})); })()`);
const key = async (key, modifiers = 0) => {
  const windowsVirtualKeyCode = { Escape: 27, Tab: 9 }[key];
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, modifiers, windowsVirtualKeyCode });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, modifiers, windowsVirtualKeyCode });
};
async function navigate(url) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (!activeRoutes && Date.now() - lastRequestAt >= 250) break;
    await pause(25);
  }
  assert.equal(activeRoutes, 0, "Fixture responses finished before navigating");
  await send("Page.navigate", { url });
}
async function open(tab) {
  booking = fixture(); mode = "success";
  await navigate(`${base}/owner-dashboard?tab=${tab}`);
  if (tab === "Bookings") {
    await wait(button("Reject Walk-in"));
    await evaluate(`${button("Reject Walk-in")}.focus()`);
    await click("Reject Walk-in");
  } else {
    await wait("[...document.querySelectorAll('button')].some(el => el.textContent.includes('Walk-in Payment Request'))");
    await evaluate("[...document.querySelectorAll('button')].find(el => el.textContent.includes('Walk-in Payment Request')).click()");
    await click("Decline Walk-in");
  }
  await wait("document.querySelector('dialog[open]')");
}

try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Page.bringToFront");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (const tab of ["Bookings", "Dashboard"]) {
    const before = patches.length;
    await open(tab);
    await click("Reject walk-in payment");
    await wait("document.body.innerText.includes('Enter a reason for rejecting')");
    assert.equal(patches.length, before);
    await setReason(" \n\t "); await click("Reject walk-in payment");
    await wait("document.body.innerText.includes('Enter a reason for rejecting')");
    assert.equal(patches.length, before);
    await click("Cancel"); await wait("!document.querySelector('dialog[open]')");
    assert.equal(patches.length, before);
    if (tab === "Bookings") assert.equal(await evaluate("document.activeElement?.textContent.trim()"), "Reject Walk-in");
    checks.push(`${tab}: opening, blank/whitespace validation and Cancel send no rejection`);

    await open(tab);
    assert.equal(await evaluate(`${field}.maxLength`), 500);
    await setReason("x".repeat(500));
    assert.ok(await evaluate("document.body.innerText.includes('500/500')"));
    await evaluate("document.querySelector('dialog button[aria-label^=Close]').click()");
    await wait("!document.querySelector('dialog[open]')");
    assert.equal(patches.length, before);
    await open(tab);
    await setReason("A reason to discard"); await key("Escape");
    await wait("!document.querySelector('dialog[open]')");
    assert.equal(patches.length, before);
    await open(tab);
    assert.equal(await evaluate(`${field}.value`), "");
    for (let count = 0; count < 7; count++) {
      await key("Tab");
      assert.equal(await evaluate("!!document.activeElement.closest('dialog') || document.activeElement === document.body"), true);
    }
    for (const width of [1440, 768, 390, 320]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 500 });
      await pause(80);
      assert.equal(await evaluate("(() => { const panel = document.querySelector('dialog .rp-modal-panel').getBoundingClientRect(); return panel.left >= 0 && panel.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; })()"), true, `${tab} modal overflow at ${width}`);
      if (width === 1440 || width === 390) {
        const screenshotPath = path.join(os.tmpdir(), `rentifypro-walk-in-${tab.toLowerCase()}-${width}.png`);
        const screenshot = await send("Page.captureScreenshot", { format: "png" });
        await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
        screenshots.push(screenshotPath);
      }
    }
    checks.push(`${tab}: Escape, fresh input, keyboard focus and four responsive widths`);

    const reason = "  In-person collection is unavailable.\nPlease pay online.  ";
    await setReason(reason); mode = "failure"; await click("Reject walk-in payment");
    await wait("document.body.innerText.includes('Fixture rejection could not be saved.')");
    assert.equal(await evaluate(`${field}.value`), reason);
    assert.equal(booking.walkInPayment.status, "requested");
    assert.equal(patches.length, before + 1);

    mode = "held";
    await evaluate(`${button("Reject walk-in payment")}.click(); ${button("Reject walk-in payment")}.click()`);
    await wait("document.querySelector('dialog')?.getAttribute('aria-busy') === 'true'");
    for (let attempt = 0; !heldRequest && attempt < 100; attempt++) await pause(20);
    assert.ok(heldRequest);
    await key("Escape"); await click("Cancel");
    assert.equal(await evaluate("!!document.querySelector('dialog[open]')"), true);
    assert.equal(await evaluate(`${field}.disabled`), true);
    assert.equal(patches.length, before + 2);
    await fulfill(heldRequest, { success: true, booking }); heldRequest = null;
    await wait("!document.querySelector('dialog[open]')");
    assert.deepEqual(patches.at(-1), { action: "reject", note: reason.trim() });
    assert.equal(booking.status, "confirmed");
    assert.equal(booking.paymentAmountPaid, 330);
    assert.equal(booking.paymentAmountDue, 770);
    checks.push(`${tab}: failure preserves the reason; retry submits once and holds the modal until saved`);
  }

  user = renter;
  await navigate(base + "/notifications");
  await wait("document.body.innerText.includes('Reason: In-person collection is unavailable.')");
  assert.ok(await evaluate("document.body.innerText.includes('Please pay online.')"));
  checks.push("Renter notifications show the full multiline rejection reason");
  booking.walkInPayment.reviewNote = "w".repeat(500);
  await navigate(base + "/notifications");
  await wait("document.body.innerText.includes('w'.repeat(500))");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "Long rejection reasons fit the renter notification page");
  checks.push("A 500-character reason fits the renter notification page");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, screenshots, cancelledFixtureResponses, runtimeErrors: errors }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ checks, errors, text: await evaluate("document.body.innerText").catch(() => "") }, null, 2));
  throw error;
} finally {
  await send("Page.close").catch(() => {});
  ws.close();
}
