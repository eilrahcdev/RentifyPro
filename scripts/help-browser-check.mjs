// Fixture browser check. Vite :4182 and isolated Chrome CDP :9242.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = "http://127.0.0.1:4182";
const target = await (await fetch("http://127.0.0.1:9242/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let sequence = 0;
let role = "guest";
const pending = new Map();
const errors = [];
const pageLoadResolvers = new Set();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject, method, params });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const iconButtonColors = (selector) => evaluate(`(() => {
  const style = getComputedStyle(document.querySelector(${JSON.stringify(selector)}));
  return [style.color, style.backgroundColor, style.borderTopColor, style.borderTopLeftRadius];
})()`);
const wait = async (expression, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}`);
};
const clickText = (label, root = "document") => evaluate(`(() => {
  const scope = ${root};
  const button = [...scope.querySelectorAll('button')].find((item) => item.textContent.trim().startsWith(${JSON.stringify(label)}) || item.getAttribute('aria-label')?.startsWith(${JSON.stringify(label)}));
  if (!button) throw new Error('Missing button: ${label}');
  button.focus();
  button.click();
})()`);
const capture = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await fs.mkdir(".impeccable/review", { recursive: true });
  await fs.writeFile(`.impeccable/review/${name}.png`, Buffer.from(data, "base64"));
};
const fulfill = (requestId, body, status = 200) => send("Fetch.fulfillRequest", {
  requestId,
  responseCode: status,
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
  if (url.pathname === "/api/auth/me" || url.pathname === "/api/auth/profile") {
    if (role === "guest") return fulfill(requestId, { message: "No session" }, 401);
    return fulfill(requestId, { user: {
      _id: "507f1f77bcf86cd799439011",
      name: "Fixture Owner",
      email: "owner@example.test",
      role,
      isVerified: true,
      kycStatus: "approved",
    } });
  }
  return fulfill(requestId, {
    success: true, bookings: [], vehicles: [], notifications: [], renters: [],
    conversations: [], unreadCount: 0, total: 0, stats: {}, summary: {},
  });
}

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}; ${String(entry.params.expression || "").slice(0, 180)}`));
    else entry.resolve(message.result);
    return;
  }
  if (message.method === "Fetch.requestPaused") void route(message.params).catch((error) => {
    if (!error.message.includes("Invalid InterceptionId")) errors.push(error.message);
  });
  if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
  if (message.method === "Page.loadEventFired") {
    for (const resolve of pageLoadResolvers) resolve();
    pageLoadResolvers.clear();
  }
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await send("Page.navigate", { url: base });
  await wait("location.origin === 'http://127.0.0.1:4182'");
  await evaluate("localStorage.clear(); sessionStorage.clear()");
  await send("Page.navigate", { url: `${base}/help` });
  await wait("document.querySelector('h1')?.textContent === 'Help & User Manuals'");
  assert.equal(await evaluate("document.querySelector('header')?.innerText.trim()"), "Help");
  assert.equal(await evaluate("document.querySelector('header button')?.textContent.trim()"), "");
  assert.equal(await evaluate("document.querySelector('header button svg')?.classList.contains('lucide-chevron-left')"), true);
  assert.equal(await evaluate("document.querySelector('header button')?.getBoundingClientRect().width"), 44);
  assert.equal(await evaluate("document.querySelector('header img') === null"), true);
  const backColors = await iconButtonColors("header button");
  assert.deepEqual(backColors, ["rgb(29, 78, 216)", "rgb(239, 246, 255)", "rgb(219, 234, 254)", "12px"]);
  await capture("help-desktop");
  assert.equal(await evaluate("document.body.innerText.includes('Request a booking')"), false);
  await clickText("I rent vehicles");
  await wait("location.pathname === '/help/renter' && document.querySelector('h1')?.textContent === 'Help'");
  for (const title of ["Verify your identity", "Request a booking", "Understand booking payments"]) assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(title)})`), true);
  for (const title of ["Complete owner verification", "List a vehicle", "Manage booking requests"]) assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(title)})`), false);
  await clickText("Request a booking");
  await wait("location.pathname === '/help/request-booking'");
  await wait("document.activeElement?.textContent === 'Request a booking' && document.activeElement?.tagName === 'H1'");
  assert.equal(await evaluate("document.querySelector('header')?.innerText.trim()"), "Help");
  assert.equal(await evaluate("document.querySelector('header button')?.getAttribute('aria-label')"), "Back to renter guides");
  await capture("help-guide-desktop");
  assert.equal(await evaluate("document.querySelector('article ol')?.children.length"), 4);
  await evaluate("history.back()");
  await wait("location.pathname === '/help/renter' && document.querySelector('h1')?.textContent === 'Help'");
  await wait("document.activeElement?.textContent === 'Help' && document.activeElement?.tagName === 'H1'");
  await clickText("Understand booking payments");
  await wait("location.pathname === '/help/booking-payments'");
  assert.equal(await evaluate("document.querySelector('main a[href=\"/signin\"]')?.textContent.trim()"), "Sign in to continue");
  await evaluate("history.back()");
  await wait("location.pathname === '/help/renter' && document.querySelector('h1')?.textContent === 'Help'");
  await clickText("Back", "document.querySelector('header')");
  await wait("location.pathname === '/help' && document.querySelector('h1')?.textContent === 'Help & User Manuals'");
  await clickText("I want to list a vehicle");
  await wait("location.pathname === '/help/owner' && document.querySelector('h1')?.textContent === 'Vehicle Owner Help & User Manual'");
  for (const title of ["Complete owner verification", "List a vehicle", "Manage booking requests"]) assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(title)})`), true);
  assert.equal(await evaluate("document.body.innerText.includes('Request a booking')"), false);

  await send("Page.navigate", { url: `${base}/help/unknown-guide` });
  await wait("document.querySelector('h1')?.textContent === 'Guide not found'");
  await clickText("View current manual");
  await wait("location.pathname === '/help' && document.activeElement?.textContent === 'Help & User Manuals'");
  await clickText("I want to list a vehicle");
  await wait("location.pathname === '/help/owner'");

  for (const width of [1440, 768, 390, 320]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 768 });
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `Help index overflow at ${width}px`);
    if (width === 390) await capture("help-mobile");
    if (width === 320) await capture("help-320");
  }

  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/` });
  await wait("document.querySelector('button') && document.body.innerText.includes('How RentifyPro Works')");
  await clickText("Help", "document.querySelector('nav')");
  await wait("document.querySelector('[role=dialog][aria-labelledby=help-panel-title]')");
  assert.equal(await evaluate("document.querySelector('#help-panel-title')?.textContent"), "Help");
  assert.deepEqual(await iconButtonColors("[role=dialog] header button"), backColors);
  assert.equal(await evaluate("document.querySelector('[role=dialog]')?.innerText.includes('List a vehicle')"), false);
  await capture("help-panel-desktop");
  assert.equal(await evaluate("document.activeElement?.getAttribute('aria-label') === 'Close Help panel'"), true);
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))");
  assert.equal(await evaluate("document.activeElement?.textContent.trim()"), "Ask Rentify AI");
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))");
  assert.equal(await evaluate("document.activeElement?.getAttribute('aria-label')"), "Close Help panel");
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await wait("!document.querySelector('[role=dialog][aria-labelledby=help-panel-title]')");
  assert.equal(await evaluate("document.activeElement?.getAttribute('aria-label')"), "Help");
  await clickText("Help", "document.querySelector('nav')");
  await clickText("I rent vehicles", "document.querySelector('[role=dialog][aria-labelledby=help-panel-title]')");
  await wait("document.activeElement?.id === 'help-panel-title' && document.activeElement?.textContent === 'Help'");
  assert.equal(await evaluate("document.querySelector('[role=dialog]')?.innerText.includes('List a vehicle')"), false);
  assert.equal(await evaluate("document.querySelector('[role=dialog]')?.innerText.includes('Open renter user manual')"), false);
  assert.equal(await evaluate("document.querySelector('[role=dialog]')?.innerText.includes('Read guide')"), false);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[role=dialog]')).borderTopLeftRadius"), "16px");
  assert.equal(await evaluate("document.querySelector('[role=dialog]').getBoundingClientRect().right < innerWidth"), true);
  assert.equal(await evaluate(`(() => {
    const panel = document.querySelector('[role=dialog][aria-labelledby=help-panel-title]');
    const content = panel.lastElementChild;
    return panel.getBoundingClientRect().bottom - content.lastElementChild.getBoundingClientRect().bottom < 60;
  })()`), true, "Renter task list leaves no large blank area");
  await capture("help-panel-renter-desktop");
  await clickText("Choose another manual", "document.querySelector('[role=dialog][aria-labelledby=help-panel-title]')");
  await wait("document.activeElement?.id === 'help-panel-title' && document.activeElement?.textContent === 'Help'");
  await clickText("I rent vehicles", "document.querySelector('[role=dialog][aria-labelledby=help-panel-title]')");
  await clickText("Request a booking", "document.querySelector('[role=dialog][aria-labelledby=help-panel-title]')");
  await wait("location.pathname === '/' && document.querySelector('[role=dialog] article h3')?.textContent === 'Request a booking'");
  await wait("document.activeElement?.tagName === 'H3' && document.activeElement?.textContent === 'Request a booking'");
  assert.equal(await evaluate("document.querySelector('[role=dialog] article ol')?.children.length"), 4);
  await capture("help-panel-task-desktop");
  await clickText("Back to Help tasks", "document.querySelector('[role=dialog][aria-labelledby=help-panel-title]')");
  await wait("location.pathname === '/' && document.querySelector('[role=dialog]')?.innerText.includes('Choose a task for step-by-step instructions.')");
  await clickText("Understand booking payments", "document.querySelector('[role=dialog][aria-labelledby=help-panel-title]')");
  await wait("location.pathname === '/' && document.querySelector('[role=dialog] article h3')?.textContent === 'Understand booking payments'");
  assert.equal(await evaluate("document.querySelector('[role=dialog] article ol')?.children.length"), 4);
  await clickText("Close Help panel");
  await clickText("Help", "document.querySelector('nav')");
  await clickText("Ask Rentify AI", "document.querySelector('[role=dialog][aria-labelledby=help-panel-title]')");
  await wait("document.querySelector('[aria-label=\"Rentify AI chatbot\"]')");

  role = "user";
  await send("Page.navigate", { url: `${base}/help/list-vehicle` });
  await wait("location.pathname === '/help/list-vehicle' && document.querySelector('article h1')");
  assert.equal(await evaluate("document.querySelector('main a[href=\"/account-settings\"]')?.textContent.trim()"), "Open Account Settings");
  assert.equal(await evaluate("document.querySelector('main')?.innerText.includes('choose Become a Vehicle Owner')"), true);
  await evaluate("document.querySelector('main a[href=\"/account-settings\"]').click()");
  await wait("location.pathname === '/account-settings' && document.body.innerText.includes('Become a Vehicle Owner')");
  assert.equal(await evaluate("document.querySelector('nav button[aria-label=\"Help\"]')?.previousElementSibling?.getAttribute('aria-label')"), "Chatroom");
  await clickText("Help", "document.querySelector('nav')");
  await wait("document.querySelector('#help-panel-title')?.textContent === 'Help'");
  assert.equal(await evaluate("document.querySelector('[role=dialog]')?.innerText.includes('List a vehicle')"), false);
  await clickText("Close Help panel");
  await send("Page.navigate", { url: `${base}/help` });
  await wait("document.querySelector('h1')?.textContent === 'Help'");
  assert.equal(await evaluate("document.body.innerText.includes('Manage booking requests')"), false);

  role = "owner";
  await evaluate("localStorage.setItem('isNewOwner', 'true')");
  await send("Page.navigate", { url: `${base}/help` });
  await wait("document.querySelector('h1')?.textContent === 'Vehicle Owner Help & User Manual'");
  assert.equal(await evaluate("document.body.innerText.includes('Request a booking')"), false);
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Page.navigate", { url: `${base}/owner-dashboard?tab=Vehicles` });
  await wait("document.querySelector('#owner-navigation') && document.body.innerText.includes('Vehicle Management')");
  assert.equal(await evaluate('document.querySelector(\'header button[aria-label="Help"] svg\')?.classList.contains("lucide-circle-question-mark")'), true);
  assert.equal(await evaluate('document.querySelector(\'header button[aria-label="Help"]\')?.nextElementSibling?.getAttribute("aria-label")'), 'Notifications');
  assert.equal(await evaluate('document.querySelector(\'#owner-navigation\')?.innerText.includes("Help")'), false);
  await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.querySelector(\'header button[aria-label="Help"]\').getBoundingClientRect().right <= innerWidth'), true);
  assert.equal(await evaluate('document.querySelector(\'header button[aria-label="Notifications"]\').getBoundingClientRect().right <= innerWidth'), true);
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Search your vehicles"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Honda');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickText("Need help listing a vehicle?");
  await wait("document.querySelector('[role=dialog][aria-labelledby=help-panel-title]')?.innerText.includes('List a vehicle')");
  assert.equal(await evaluate("document.querySelector('[role=dialog] article ol')?.children.length"), 4);
  assert.equal(await evaluate("document.querySelector('[role=dialog] article')?.innerText.includes('What happens next?')"), true);
  assert.equal(await evaluate("document.querySelector('[role=dialog]')?.innerText.includes('Open full guide')"), false);
  await capture("help-panel-contextual-mobile");
  await clickText("Close Help panel");
  await wait("!document.querySelector('[role=dialog][aria-labelledby=help-panel-title]')");
  assert.equal(await evaluate("document.querySelector('input[aria-label=\"Search your vehicles\"]').value"), "Honda");
  await evaluate("document.querySelector('button[aria-label=\"Open menu\"]').click()");
  await wait("document.querySelector('#owner-navigation[role=dialog]')");
  assert.deepEqual(await iconButtonColors('#owner-navigation button[aria-label="Close menu"]'), backColors);
  assert.equal(await evaluate('document.querySelector(\'#owner-navigation button[aria-label="Close menu"]\').getBoundingClientRect().width'), 44);
  assert.equal(await evaluate('document.querySelector(\'#owner-navigation\')?.innerText.includes("Help")'), false);
  await clickText("Close menu", "document.querySelector('#owner-navigation')");
  await clickText("Help", "document.querySelector('header')");
  await wait("document.querySelector('[role=dialog][aria-labelledby=help-panel-title]')");
  assert.equal(await evaluate("document.querySelector('#help-panel-title')?.textContent"), "Help");
  assert.equal(await evaluate("document.querySelector('[role=dialog]')?.innerText.includes('Request a booking')"), false);
  assert.equal(await evaluate("document.querySelector('[role=dialog]')?.innerText.includes('Manage booking requests')"), true);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "Owner Help panel overflow at 390px");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[role=dialog]')).borderTopLeftRadius"), "16px");
  assert.equal(await evaluate("document.querySelector('[role=dialog]').getBoundingClientRect().right < innerWidth"), true);
  assert.equal(await evaluate(`(() => {
    const panel = document.querySelector('[role=dialog][aria-labelledby=help-panel-title]');
    const content = panel.lastElementChild;
    return panel.getBoundingClientRect().bottom - content.lastElementChild.getBoundingClientRect().bottom < 60;
  })()`), true, "Owner task list leaves no large blank area");
  await capture("help-panel-mobile");
  await clickText("List a vehicle", "document.querySelector('[role=dialog][aria-labelledby=help-panel-title]')");
  await wait("location.pathname === '/owner-dashboard' && location.search === '?tab=Vehicles' && document.querySelector('[role=dialog] article h3')?.textContent === 'List a vehicle'");
  await wait("document.activeElement?.tagName === 'H3' && document.activeElement?.textContent === 'List a vehicle'");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 568, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate(`(() => {
    const panel = document.querySelector('[role=dialog][aria-labelledby=help-panel-title]');
    const content = panel.lastElementChild;
    return panel.getBoundingClientRect().bottom <= innerHeight - 11 && content.scrollHeight > content.clientHeight;
  })()`), true, "Long owner guide scrolls within a short viewport");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate("document.querySelector('input[aria-label=\"Search your vehicles\"]')?.value"), "Honda");
  await capture("help-panel-task-mobile");
  await clickText("Back to Help tasks", "document.querySelector('[role=dialog][aria-labelledby=help-panel-title]')");
  await wait("location.pathname === '/owner-dashboard' && document.querySelector('[role=dialog]')?.innerText.includes('Manage booking requests')");
  assert.equal(await evaluate("document.querySelector('input[aria-label=\"Search your vehicles\"]')?.value"), "Honda");
  await clickText("Close Help panel");
  await evaluate('window.dispatchEvent(new CustomEvent("rentifypro:open-help", { detail: { guideSlug: "booking-payments" } }))');
  await wait("document.querySelector('[role=dialog][aria-labelledby=help-panel-title]')");
  assert.equal(await evaluate("document.querySelector('[role=dialog]')?.innerText.includes('Manage booking requests')"), true);
  assert.equal(await evaluate("document.querySelector('[role=dialog]')?.innerText.includes('Understand booking payments')"), false);
  await clickText("Close Help panel");
  await send("Page.navigate", { url: `${base}/help/list-vehicle` });
  await wait("location.pathname === '/help/list-vehicle' && document.activeElement?.textContent === 'List a vehicle' && document.activeElement?.tagName === 'H1'");
  const reloadComplete = new Promise((resolve) => pageLoadResolvers.add(resolve));
  await send("Page.reload", { ignoreCache: true });
  await reloadComplete;
  await wait("location.pathname === '/help/list-vehicle' && document.querySelector('article h1')?.textContent === 'List a vehicle'");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "Owner guide overflow at 390px");
  await clickText("Back", "document.querySelector('header')");
  await wait("location.pathname === '/help/owner' && document.querySelector('h1')?.textContent === 'Vehicle Owner Help & User Manual'");
  await send("Page.navigate", { url: `${base}/help/owner-verification` });
  await wait("location.pathname === '/help/owner-verification' && document.querySelector('main a[href=\"/owner-dashboard?tab=Profile\"]')");
  assert.equal(await evaluate("document.querySelector('main a[href=\"/owner-dashboard?tab=Profile\"]')?.textContent.trim()"), "Open owner profile");
  await clickText("Back", "document.querySelector('header')");
  await wait("location.pathname === '/help/owner'");
  await clickText("Back", "document.querySelector('header')");
  await wait("location.pathname === '/owner-dashboard' && document.body.innerText.includes('Vehicle Management')");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate('getComputedStyle(document.querySelector(\'#owner-navigation button[aria-label="Close menu"]\')).display'), 'none');
  assert.deepEqual(errors, []);
  console.log("Help browser check passed: owner navbar Help opens owner-only sidebar tasks without route changes or lost search, task Back, direct guide links, contextual help, focus, Escape, AI handoff, 320/390/768/1440 widths.");
} finally {
  ws.close();
}
