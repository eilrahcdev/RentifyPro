// Run Vite on 4189 and isolated Chrome with CDP on 9249. All service calls use fixtures.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = process.env.RESPONSIVE_BASE_URL || "http://127.0.0.1:4189";
const cdp = process.env.RESPONSIVE_CDP_URL || "http://127.0.0.1:9249";
const output = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-responsive-layout-"));
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map(), errors = [], failures = [], checks = [];
let sequence = 0, role = "user";
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const owner = { _id: "507f1f77bcf86cd799439012", name: "Alexandra Maria Santos", firstName: "Alexandra", email: "owner@example.test", role: "owner", isVerified: true, kycStatus: "approved" };
const renter = { ...owner, _id: "507f1f77bcf86cd799439011", name: "Christopher Emmanuel Dela Cruz", email: "renter@example.test", role: "user" };
const vehicle = {
  _id: "507f1f77bcf86cd799439031", name: "Toyota Fortuner 2.8 LTD Automatic", location: "Calasiao, Pangasinan, Ilocos Region",
  hourlyRentalRate: 1250, dailyRentalRate: 1250, pricingUnit: "hourly", availabilityStatus: "available", images: [], reviews: [], owner,
  specs: { type: "Car", transmission: "Automatic", seats: 7, fuelType: "Diesel" }, driverOptionEnabled: true, driverHourlyRate: 250,
  description: "A spacious seven-seat vehicle for family trips. Pickup details are arranged directly with the owner.",
};
const future = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
const booking = { _id: "507f1f77bcf86cd799439021", status: "confirmed", paymentStatus: "partial", paymentAmountPaid: 9000, paymentAmountDue: 21140, pickupAt: future(24), returnAt: future(48), vehicle, owner, renter, totalAmount: 30000, baseAmount: 30000, transactionFee: 140, vehicleHourlyRate: 1250, driverSelected: false };
const overdue = { ...booking, _id: "507f1f77bcf86cd799439022", pickupAt: future(-30), returnAt: future(-6), extensionRequest: { status: "requested", requestedReturnAt: future(8) } };
const stats = { vehiclesListed: 4, activeBookings: 2, totalRevenue: 24000, pendingBookings: 1, totalVehicles: 4, completedBookings: 4 };
const fulfill = (requestId, body, responseCode = 200) => send("Fetch.fulfillRequest", {
  requestId, responseCode, responseHeaders: [
    { name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,PUT,DELETE,OPTIONS" },
  ], body: Buffer.from(JSON.stringify(body)).toString("base64"),
});
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (url.pathname.includes("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    const endpoint = url.pathname.slice(url.pathname.indexOf("/api/") + 4);
    if (endpoint === "/auth/me" || endpoint === "/auth/profile") return role === "guest" ? fulfill(requestId, { message: "Not signed in" }, 401) : fulfill(requestId, { user: role === "owner" ? owner : renter });
    if (endpoint === "/vehicles" || endpoint === "/owner/vehicles") return fulfill(requestId, { vehicles: Array.from({ length: 4 }, (_, i) => ({ ...vehicle, _id: i === 0 ? vehicle._id : `507f1f77bcf86cd79943903${i + 1}` })), page: { hasMore: false } });
    if (endpoint === `/vehicles/${vehicle._id}`) return fulfill(requestId, { vehicle });
    if (endpoint === "/bookings/eligibility") return fulfill(requestId, { eligibility: { eligible: true, counts: { open: 2, pending: 1 }, limits: { open: 3, pending: 2 }, reasons: [] } });
    if (endpoint === "/bookings/me" || endpoint === "/owner/bookings") return fulfill(requestId, { bookings: [booking, overdue], page: { hasMore: false } });
    if (endpoint.includes("dashboard")) return fulfill(requestId, { stats, summary: stats, recentBookings: [booking], bookings: [booking], vehicles: [vehicle] });
    if (endpoint === "/notifications") return fulfill(requestId, { notifications: [{ _id: "notification-fixture", title: "Your vehicle booking and pickup arrangements are ready to review", message: "The owner approved your booking. Review your pickup dates, payment choices, and remaining balance in Bookings.", createdAt: future(-1) }] });
    if (endpoint === "/reports/mine") return fulfill(requestId, { reports: [{ _id: "report-fixture", caseReference: "RPT-2026-123456", perspective: "submitted", category: "vehicle_condition", status: "open", booking: booking._id, createdAt: future(-2), description: `Please review the pickup condition and the attached evidence. ${"LongBookingReference".repeat(10)}` }] });
    if (endpoint.includes("login-challenge")) return fulfill(requestId, { challengeId: "fixture", question: "2 + 3" });
    if (request.method !== "GET") return fulfill(requestId, { message: "This layout fixture does not change accounts, bookings, or payments." }, 503);
    return fulfill(requestId, { notifications: [], conversations: [], messages: [], users: [], reports: [], reviews: [], bookings: [], unreadCount: 0, count: 0, stats, summary: stats, vehicles: [] });
  }
  if (url.origin === base) return send("Fetch.continueRequest", { requestId });
  return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
}
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id); pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") route(message.params).catch((error) => { if (!/Invalid InterceptionId|Target closed/.test(error.message)) errors.push(error.message); });
  else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function wait(expression) {
  for (let i = 0; i < 150; i++) { if (await evaluate(`Boolean(${expression})`).catch(() => false)) return; await pause(80); }
  throw new Error(`Timeout: ${expression}; ${await evaluate("document.body.innerText.slice(0, 400)")}`);
}
const expect = (condition, message) => { if (!condition) failures.push(message); };
const measure = () => evaluate(`(() => {
  const visible = e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden';
  const rect = e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; };
  const content=[...document.querySelectorAll('main h1,main h2,main h3,main p,main dd,main input,main select,main button,main article,.rp-reports-page p,.rp-payment-dialog *')].filter(visible);
  const outside=content.filter(e=>{const r=e.getBoundingClientRect();if(r.left>=-1&&r.right<=innerWidth+1)return false;for(let p=e.parentElement;p;p=p.parentElement){if(['auto','scroll'].includes(getComputedStyle(p).overflowX)&&p.scrollWidth>p.clientWidth+1)return false;}return true;}).map(e=>({tag:e.tagName,text:e.textContent.slice(0,70),...rect(e)})).slice(0,8);
  const fields=[...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]),textarea,select')].filter(visible).map(e=>({label:e.getAttribute('aria-label')||e.placeholder||e.type,font:parseFloat(getComputedStyle(e).fontSize),...rect(e)}));
  const buttons=[...document.querySelectorAll('main button,.rp-auth-page button,.rp-payment-dialog button')].filter(visible).filter(e=>e.getBoundingClientRect().height<43.5).map(e=>({text:e.textContent.trim()||e.getAttribute('aria-label'),...rect(e)})).slice(0,8);
  return {viewport:innerWidth,docWidth:document.documentElement.scrollWidth,outside,fields,smallButtons:buttons,bookingPanel:document.querySelector('#booking-form')&&rect(document.querySelector('#booking-form')),cards:[...document.querySelectorAll('.rp-booking-card')].map(rect)};
})()`);
async function screenshot(name) {
  await evaluate("window.scrollTo(0,0)");
  const width = await evaluate("innerWidth"), height = await evaluate("Math.min(document.documentElement.scrollHeight, 1800)");
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
  const file = path.join(output, `${name}.png`);
  await fs.writeFile(file, Buffer.from(shot.data, "base64"));
  return file;
}
async function open(page) {
  role = page.role;
  await send("Page.navigate", { url: "about:blank" });
  await wait("location.href === 'about:blank'");
  await send("Storage.clearDataForOrigin", { origin: base, storageTypes: "all" });
  await send("Page.navigate", { url: base + page.url });
  if (role === "owner") {
    await wait("document.querySelector('.rp-owner-workspace')");
    await evaluate(`window.dispatchEvent(new CustomEvent('navigate', { detail: ${JSON.stringify(new URL(base + page.url).searchParams.get("tab"))} }))`);
    if (page.name === "owner-bookings") {
      await wait("[...document.querySelectorAll('main button')].some(b=>b.textContent.trim()==='All')");
      await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()==='All').click()");
    }
  }
  await wait(page.ready);
  await evaluate("document.fonts.ready");
  await pause(150);
}
try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const pages = [
    { name: "renter-bookings", url: "/bookings", role: "user", ready: "document.querySelector('.rp-booking-card')" },
    { name: "booking-form", url: `/vehicle-details?vehicleId=${vehicle._id}`, role: "user", ready: "document.querySelector('#booking-form input')" },
    { name: "browse", url: "/vehicles", role: "user", ready: "document.querySelector('.rp-market-grid button.rp-vehicle-card__preview')" },
    { name: "settings", url: "/account-settings", role: "user", ready: "document.querySelector('.rp-account-content input')" },
    { name: "notifications", url: "/notifications", role: "user", ready: "document.body.innerText.includes('Your vehicle booking')" },
    { name: "reports", url: "/reports", role: "user", ready: "document.querySelector('.rp-reports-page article')" },
    { name: "messages", url: "/chat", role: "user", ready: "document.body.innerText.includes('Messages') && !document.querySelector('[aria-label=\"Loading your account\"]')" },
    { name: "owner-bookings", url: "/owner-dashboard?tab=Bookings", role: "owner", ready: "document.querySelector('select[id^=payment-status]')" },
    { name: "owner-dashboard", url: "/owner-dashboard?tab=Dashboard", role: "owner", ready: "document.querySelector('main').innerText.includes('Revenue Today')" },
    { name: "owner-vehicles", url: "/owner-dashboard?tab=Vehicles", role: "owner", ready: "document.querySelector('.rp-owner-vehicles button[aria-label^=\"Edit \"]')" },
    { name: "owner-messages", url: "/owner-dashboard?tab=Messages", role: "owner", ready: "document.body.innerText.includes('Messages') && document.querySelector('.rp-owner-workspace main')" },
    { name: "renter-registration", url: "/register", role: "guest", ready: "document.querySelector('.rp-auth-page input')" },
    { name: "owner-registration", url: "/register-owner", role: "guest", ready: "document.querySelector('.rp-auth-page input')" },
  ];
  const selectedPages = process.env.RESPONSIVE_PAGES?.split(",");
  for (const page of pages.filter(page => !selectedPages || selectedPages.includes(page.name))) {
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    try { await open(page); } catch (error) { failures.push(`${page.name}: ${error.message}`); continue; }
    for (const width of [320, 360, 390, 430, 640, 768, 1024, 1280, 1440]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: width === 640 ? 450 : width < 768 ? 844 : 900, deviceScaleFactor: width === 640 ? 2 : 1, mobile: width < 640 });
      await pause(90);
      const result = { page: page.name, width, ...await measure() };
      expect(result.docWidth <= width, `${page.name}: page overflow at ${width}`);
      expect(result.outside.length === 0, `${page.name}: content outside viewport at ${width}: ${JSON.stringify(result.outside)}`);
      if (width < 1024) {
        expect(result.fields.every(f => f.font >= 16 && f.h >= 43.5), `${page.name}: unreadable fields at ${width}`);
        expect(result.smallButtons.length === 0, `${page.name}: small buttons at ${width}: ${JSON.stringify(result.smallButtons)}`);
      }
      if (page.name === "booking-form") {
        expect(width >= 1024 ? result.bookingPanel.y < 450 : result.bookingPanel.y < 1100, `Booking form too far down at ${width}`);
        expect(await evaluate("document.querySelector('#booking-form').compareDocumentPosition(document.querySelector('.rp-detail-information')) & Node.DOCUMENT_POSITION_FOLLOWING"), "Booking form keyboard order does not precede additional information");
      }
      if (width === 390 && ["renter-bookings", "owner-bookings", "booking-form", "settings", "owner-dashboard", "owner-registration"].includes(page.name)) result.screenshot = await screenshot(`${page.name}-${width}`);
      checks.push(result);
      console.log(JSON.stringify({ page: page.name, width, outside: result.outside.length, smallButtons: result.smallButtons.length, panelY: result.bookingPanel?.y, cardHeight: result.cards[0]?.h }));
    }
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await open(pages[0]);
  await send("Page.bringToFront");
  await evaluate("document.querySelector('.rp-booking-disclosure summary').focus()");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await wait("document.querySelector('.rp-booking-disclosure').open");
  expect(await evaluate("document.querySelector('.rp-booking-card').querySelectorAll('.rp-booking-info').length === 9"), "Expanded booking details lost information");
  expect((await measure()).outside.length === 0, "Expanded booking details overflow");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Pay Remaining').click()");
  await wait("document.querySelector('.rp-payment-dialog')");
  expect(await evaluate("[...document.querySelectorAll('input[name=booking-payment-method]')].every(e=>!e.checked)"), "Payment method must require an explicit choice");
  expect(await evaluate("document.querySelector('.rp-payment-dialog footer button:last-child').disabled"), "Payment action enabled before method selection");
  for (const [width, height] of [[320, 568], [390, 844], [667, 375], [768, 600], [1440, 900]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    await pause(90);
    const result = { page: "payment", width, height, ...await measure(), dialog: await evaluate(`(() => {const p=document.querySelector('.rp-payment-dialog'),b=p.querySelector('.overflow-y-auto'),f=p.querySelector('footer'),r=p.getBoundingClientRect();return {top:r.top,bottom:r.bottom,body:b.clientHeight,footerBottom:f.getBoundingClientRect().bottom};})()`) };
    expect(result.dialog.top >= 0 && result.dialog.bottom <= height + 1 && result.dialog.footerBottom <= height + 1, `Payment controls clipped at ${width}x${height}`);
    expect(result.dialog.body >= 150, `Payment scroll area too short at ${width}x${height}`);
    expect(result.outside.length === 0, `Payment horizontal overflow at ${width}x${height}`);
    if (width === 667 || width === 320) result.screenshot = await screenshot(`payment-${width}x${height}`);
    checks.push(result);
  }
  await open(pages[0]);
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Report issue').click()");
  await wait("document.querySelector('.rp-report-dialog[open]')");
  for (const [width, height] of [[320, 568], [667, 375], [390, 844]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    const result = { page: "report-dialog", width, height, ...await measure() };
    expect(result.docWidth <= width && result.fields.every(f => f.font >= 16), `Report form does not reflow at ${width}`);
    expect(await evaluate("(() => {const b=document.querySelector('.rp-report-dialog form button[type=submit]'); b.scrollIntoView({block:'center'}); const r=b.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;})()"), `Report action cannot be reached at ${width}x${height}`);
    checks.push(result);
  }
  await open(pages[2]);
  await evaluate("document.querySelector('.rp-market-grid button[aria-label^=\"View details\"]').click()");
  await wait("document.querySelector('[aria-label=\"Close vehicle preview\"]')");
  for (const [width, height] of [[320, 568], [667, 375], [390, 844]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    expect(await evaluate("(() => {const p=document.querySelector('.rp-modal-layer > div'),r=p.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;})()"), `Vehicle preview clipped at ${width}x${height}`);
    checks.push({ page: "vehicle-preview", width, height });
  }
  await open(pages[9]);
  await evaluate("window.dispatchEvent(new Event('open-add-vehicle'))");
  await wait("document.querySelector('#owner-vehicle-form-scroll-region')");
  for (const [width, height] of [[320, 568], [667, 375], [390, 844]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    const result = { page: "owner-vehicle-form", width, height, ...await measure() };
    expect(result.docWidth <= width && result.outside.length === 0, `Owner vehicle form overflows at ${width}`);
    expect(await evaluate("(() => {const p=document.querySelector('[aria-labelledby=vehicle-modal-title] > .relative'),r=p.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;})()"), `Owner vehicle form clipped at ${width}x${height}`);
    checks.push(result);
  }
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ checks, failures, errors }, null, 2));
  console.log(JSON.stringify({ measurements: checks.length, failures, errors, output }, null, 2));
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
} finally {
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ checks, failures, errors }, null, 2));
  console.log(`Responsive results: ${output}`);
  await send("Page.close").catch(() => {}); ws.close();
}
