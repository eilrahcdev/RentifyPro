// Run Vite on 4176 and isolated Chrome with CDP on 9236. API calls use fixtures.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = "http://127.0.0.1:4176";
const target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const invitationKey = "rentifypro:ai-launcher-seen:v1";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pending = new Map();
const cancelledNetworkIds = new Set();
const errors = [];
const screenshots = [];
let sequence = 0;
let authenticated = true;
let chatRequests = 0;
let cancelledInterceptions = 0;
const user = { _id: "507f1f77bcf86cd799439011", role: "user", name: "Fixture Renter",
  email: "renter@example.test", isVerified: true, kycStatus: "approved" };
const vehicle = { _id: "507f1f77bcf86cd799439012", name: "Toyota Vios", brand: "Toyota", model: "Vios",
  category: "car", vehicleType: "car", transmission: "Automatic", location: "Dagupan City",
  pricePerHour: 250, hourlyRate: 250, availabilityStatus: "available", seats: 5, images: ["/hero-car1-optimized.jpg"],
  owner: { _id: "507f1f77bcf86cd799439013", name: "Fixture Owner" } };
const booking = { _id: "507f1f77bcf86cd799439014", status: "confirmed", paymentStatus: "partial",
  paymentAmountPaid: 342, paymentAmountDue: 798, totalAmount: 1000, transactionFee: 140,
  vehicleHourlyRate: 250, pickupAt: new Date(Date.now() + 86400000).toISOString(),
  returnAt: new Date(Date.now() + 100800000).toISOString(), vehicle, owner: vehicle.owner };
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
    { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
  ],
  body: Buffer.from(JSON.stringify(body)).toString("base64"),
});
const route = ({ requestId, request }) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    if (["/api/auth/me", "/api/auth/profile"].includes(url.pathname)) {
      return authenticated ? fulfill(requestId, { user }) : fulfill(requestId, { message: "No session" }, 401);
    }
    if (url.pathname === "/api/bookings/me") return fulfill(requestId, {
      success: true, bookings: [booking], page: { hasMore: false, nextCursor: null },
    });
    if (url.pathname === "/api/chat") {
      chatRequests += 1;
      return fulfill(requestId, { reply: "Fixture reply", recommendations: [] });
    }
    return fulfill(requestId, { success: true, vehicles: [vehicle], total: 1,
      notifications: [], unreadCount: 0, stats: {}, summary: {} });
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
    route(message.params).catch(async (error) => {
      if (error.message === "Invalid InterceptionId." && message.params.networkId) {
        await pause(100);
        if (cancelledNetworkIds.has(message.params.networkId)) {
          cancelledInterceptions += 1;
          return;
        }
      }
      errors.push(`${message.params.request.url}: ${error.message}`);
    });
  } else if (message.method === "Network.loadingFailed" && message.params.canceled) {
    cancelledNetworkIds.add(message.params.requestId);
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
};
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const wait = async (expression, timeout = 15000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await pause(60);
  }
  throw new Error(`Timed out: ${expression}`);
};
const click = async (selector) => {
  await wait(`document.querySelector(${JSON.stringify(selector)})`);
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.scrollIntoView({ block: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
};
const screenshot = async (name) => {
  const file = path.join(os.tmpdir(), `rentify-launcher-${name}.png`);
  await fs.writeFile(file, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  screenshots.push(file);
};
const viewport = (width, height, mobile = false) => send("Emulation.setDeviceMetricsOverride", {
  width, height, deviceScaleFactor: 1, mobile,
});
const navigate = async (page) => {
  await send("Page.navigate", { url: `${base}${page}` });
  await wait("document.querySelector('.rp-ai-launcher-button')");
  await send("Page.bringToFront");
};
const assertLauncher = async (name) => {
  assert.equal(await evaluate("document.querySelectorAll('.rp-ai-launcher-button').length"), 1);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  const documentNode = await send("DOM.getDocument");
  const { nodeId } = await send("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: ".rp-ai-launcher-button" });
  const { nodes } = await send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
  assert.equal(nodes.find((node) => node.role?.value === "button")?.name?.value, name);
  assert.equal(await evaluate(`(() => {
    const rect = document.querySelector('.rp-ai-launcher-button').getBoundingClientRect();
    return rect.width >= 44 && rect.height >= 44 && rect.left >= 0 && rect.right <= innerWidth
      && rect.top >= 0 && rect.bottom <= innerHeight - 15;
  })()`), true);
};
const assertFixedDuringScroll = async () => {
  for (const fraction of [0, 0.25, 0.5, 0.75, 1, 0.5, 0]) {
    await evaluate(`window.scrollTo({ top: Math.max(0, document.documentElement.scrollHeight - innerHeight) * ${fraction}, behavior: 'instant' })`);
    await pause(100);
    const anchor = await evaluate(`(() => {
      const launcher = document.querySelector('.rp-ai-launcher');
      const rect = launcher.getBoundingClientRect();
      const style = getComputedStyle(launcher);
      return { position: style.position, transform: style.transform,
        bottom: innerHeight - rect.bottom, expectedBottom: parseFloat(style.bottom),
        right: document.documentElement.clientWidth - rect.right, expectedRight: parseFloat(style.right) };
    })()`);
    assert.equal(anchor.position, "fixed");
    assert.equal(anchor.transform, "none");
    assert.ok(Math.abs(anchor.bottom - anchor.expectedBottom) < 0.75, JSON.stringify(anchor));
    assert.ok(Math.abs(anchor.right - anchor.expectedRight) < 0.75, JSON.stringify(anchor));
  }
};
const chatInput = '[role="dialog"][aria-label="Rentify AI chatbot"] textarea';

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await viewport(1366, 900);
  await navigate("/");
  await assertLauncher("Ask Rentify AI");
  assert.equal(await evaluate("!!document.querySelector('.rp-ai-launcher-invitation')"), true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.rp-ai-launcher-button')).animationIterationCount"), "1");
  assert.equal(await evaluate("!!document.querySelector('[aria-label=\"Rentify AI chatbot\"]')"), false);
  await assertFixedDuringScroll();
  await screenshot("home-desktop");
  await evaluate("document.querySelector('.rp-ai-launcher-dismiss').focus()");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait("!document.querySelector('.rp-ai-launcher-invitation')");
  assert.equal(await evaluate("document.activeElement === document.querySelector('.rp-ai-launcher-button')"), true);
  await evaluate("document.querySelector('.rp-ai-launcher-button').click()");
  await wait(`document.activeElement === document.querySelector(${JSON.stringify(chatInput)})`);
  await send("Input.insertText", { text: "My unsent question" });
  await click('button[aria-label="Close Rentify AI"]');
  await wait("document.querySelector('.rp-ai-launcher-button')");
  assert.equal(await evaluate("!!document.querySelector('.rp-ai-launcher-invitation')"), false);
  await click(".rp-ai-launcher-button");
  await wait(`document.querySelector(${JSON.stringify(chatInput)})?.value === 'My unsent question'`);
  await click('button[aria-label="Close Rentify AI"]');

  for (const page of ["/vehicles", "/bookings", "/account-settings"]) {
    await navigate(page);
    await assertLauncher("Ask Rentify AI");
    assert.equal(await evaluate("!!document.querySelector('.rp-ai-launcher-invitation')"), false);
    if (page !== "/account-settings") {
      if (page === "/vehicles") await wait("document.querySelector('.rp-market-grid')");
      if (page === "/bookings") {
        assert.equal(await evaluate("document.querySelectorAll('.rp-ai-help-link').length"), 0);
      }
      await click(page === "/bookings" ? ".rp-ai-launcher-button" : ".rp-ai-help-link");
      await wait(`document.activeElement === document.querySelector(${JSON.stringify(chatInput)})`);
      await click('button[aria-label="Close Rentify AI"]');
    }
    await assertFixedDuringScroll();
    await screenshot(`${page.slice(1)}-desktop`);
    await viewport(390, 844, true);
    await assertLauncher("Ask AI");
    await assertFixedDuringScroll();
    await screenshot(`${page.slice(1)}-mobile`);
    await viewport(768, 1024);
    await assertLauncher("Ask Rentify AI");
    await assertFixedDuringScroll();
    await viewport(320, 568, true);
    await assertLauncher("Ask AI");
    await assertFixedDuringScroll();
    await evaluate("window.scrollTo(0, document.documentElement.scrollHeight)");
    if (page === "/bookings") {
      assert.equal(await evaluate(`(() => {
        const launcher = document.querySelector('.rp-ai-launcher-button').getBoundingClientRect();
        return [...document.querySelectorAll('.rp-booking-card button')].every(button => {
          const rect = button.getBoundingClientRect();
          return rect.bottom <= launcher.top || rect.right <= launcher.left || rect.left >= launcher.right;
        });
      })()`), true);
    }
    await screenshot(`${page.slice(1)}-small-mobile`);
    await viewport(1366, 900);
  }

  await navigate("/bookings");
  await click('.rp-bookings-page-header__help button:first-child');
  await wait("document.querySelector('[role=\"dialog\"][aria-labelledby=\"help-panel-title\"]')");
  await evaluate("[...document.querySelectorAll('[aria-labelledby=\"help-panel-title\"] button')].find(button => button.textContent.trim() === 'Ask Rentify AI').click()");
  await wait(`document.querySelector(${JSON.stringify(chatInput)})`);
  await click('button[aria-label="Close Rentify AI"]');

  await evaluate(`sessionStorage.removeItem(${JSON.stringify(invitationKey)})`);
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await viewport(320, 568, true);
  await navigate("/");
  await assertLauncher("Ask AI");
  await assertFixedDuringScroll();
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.rp-ai-launcher-button')).animationName"), "none");
  assert.equal(await evaluate("document.querySelector('.rp-ai-launcher-invitation').getBoundingClientRect().left >= 0"), true);
  await screenshot("invitation-small-mobile");
  await evaluate("document.querySelector('.rp-ai-launcher-dismiss').focus()");
  assert.equal(await evaluate("document.activeElement === document.querySelector('.rp-ai-launcher-dismiss')"), true);
  await pause(10500);
  assert.equal(await evaluate("!!document.querySelector('.rp-ai-launcher-invitation')"), true);
  await evaluate("document.querySelector('.rp-ai-launcher-button').focus()");
  await wait("!document.querySelector('.rp-ai-launcher-invitation')", 12000);
  assert.equal(await evaluate("document.activeElement === document.querySelector('.rp-ai-launcher-button')"), true);
  await navigate("/vehicles");
  assert.equal(await evaluate("!!document.querySelector('.rp-ai-launcher-invitation')"), false);

  await viewport(1366, 900);
  const { identifier } = await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) {
      if (key === ${JSON.stringify(invitationKey)}) throw new DOMException('Storage blocked', 'SecurityError');
      return originalGet.call(this, key);
    };
    Storage.prototype.setItem = function(key, value) {
      if (key === ${JSON.stringify(invitationKey)}) throw new DOMException('Storage blocked', 'SecurityError');
      return originalSet.call(this, key, value);
    };
  ` });
  await navigate("/");
  assert.equal(await evaluate("!!document.querySelector('.rp-ai-launcher-invitation')"), true);
  await click(".rp-ai-launcher-dismiss");
  await evaluate("[...document.querySelectorAll('nav button')].find(button => button.textContent.trim() === 'Vehicles').click()");
  await wait("location.pathname === '/vehicles' && document.querySelector('.rp-ai-help-link')");
  assert.equal(await evaluate("!!document.querySelector('.rp-ai-launcher-invitation')"), false);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier });

  authenticated = false;
  await navigate("/vehicles");
  await click(".rp-ai-help-link");
  await wait(`document.querySelector(${JSON.stringify(chatInput)})`);
  assert.equal(chatRequests, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ["all four chat pages", "desktop/tablet/320px/390px",
    "accessible labels", "dismiss/Escape/focus", "draft preservation", "contextual and Help entries",
    "once per session", "timed dismissal pauses for focus", "reduced motion", "blocked-storage fallback",
    "fixed bottom-right position during scrolling", "booking button clearance at page end",
    "guest access", "no automatic chat requests"], cancelledInterceptions, screenshots }, null, 2));
} finally {
  await fetch(`http://127.0.0.1:9236/json/close/${target.id}`);
  ws.close();
}
