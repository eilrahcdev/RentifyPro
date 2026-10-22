// Run Vite on 4183 and an isolated CDP browser on 9243. All API traffic is intercepted.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = process.env.VEHICLE_LAYOUT_BASE_URL || "http://127.0.0.1:4183";
const cdp = process.env.VEHICLE_LAYOUT_CDP_URL || "http://127.0.0.1:9243";
const output = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-vehicle-layout-"));
const user = { _id: "507f1f77bcf86cd799439011", name: "Fixture Renter", role: "user", isVerified: true, kycStatus: "approved" };
const owner = { _id: "507f1f77bcf86cd799439013", name: "Fixture Owner" };
const initialVehicle = {
  _id: "507f1f77bcf86cd799439014", name: "Layout fixture vehicle", location: "Dagupan City, Pangasinan",
  dailyRentalRate: 250, availabilityStatus: "available", images: [], reviews: [], owner,
  description: "Vehicle details used only by the isolated layout fixture.",
  specs: { type: "Car", transmission: "Automatic", seats: 5, fuelType: "Gasoline" },
};
let vehicle = initialVehicle, signedIn = false, eligibilityReasons = [], sequence = 0;
const errors = [], checks = [], submissions = [], pending = new Map();
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000);
  pending.set(id, {
    resolve: result => { clearTimeout(timer); resolve(result); },
    reject: error => { clearTimeout(timer); reject(error); },
  });
  ws.send(JSON.stringify({ id, method, params }));
});
const fulfill = (requestId, body, responseCode = 200) => send("Fetch.fulfillRequest", {
  requestId, responseCode, responseHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" },
    { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
  ], body: Buffer.from(JSON.stringify(body)).toString("base64"),
});
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    if (url.pathname === "/api/bookings" && request.method === "POST") {
      submissions.push(JSON.parse(request.postData));
      return fulfill(requestId, { message: "Fixture booking failure. Please try again." }, 503);
    }
    if (request.method !== "GET") return fulfill(requestId, { message: "Live mutations are blocked by this fixture." }, 503);
    if (url.pathname === "/api/auth/me") return signedIn ? fulfill(requestId, { user }) : fulfill(requestId, { message: "Fixture guest" }, 401);
    if (url.pathname === "/api/kyc/me") return fulfill(requestId, { verification: {
      accountStatus: "active", emailVerified: true, selfieVerified: true, bookingEligible: true, documents: [],
    } });
    if (url.pathname === `/api/vehicles/${vehicle._id}`) return fulfill(requestId, { vehicle });
    if (url.pathname === "/api/bookings/eligibility") return fulfill(requestId, { eligibility: {
      eligible: eligibilityReasons.length === 0, reasons: eligibilityReasons,
      counts: { open: 0, pending: 0 }, limits: { open: 3, pending: 2 },
    } });
    return fulfill(requestId, { vehicles: [vehicle], bookings: [], notifications: [], conversations: [], unreadCount: 0 });
  }
  if (url.origin === base && !url.pathname.startsWith("/socket.io/")) return send("Fetch.continueRequest", { requestId });
  return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
}
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id); pending.delete(message.id);
    if (message.error) call?.reject(Error(message.error.message)); else call?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") route(message.params).catch(error => errors.push(error.message));
  else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(expression) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await evaluate(`Boolean(${expression})`)) return; await pause(75); }
  throw Error(`Timed out: ${expression}`);
}
async function open(width, height, authenticated = false) {
  signedIn = authenticated;
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
  await send("Page.navigate", { url: "about:blank" });
  await send("Page.navigate", { url: `${base}/vehicle-details?vehicleId=${vehicle._id}` });
  await wait("document.querySelector('.rp-detail-information')");
  await wait(`document.querySelector('#booking-form .rp-btn-primary')?.textContent.trim() === ${JSON.stringify(authenticated ? eligibilityReasons.length ? "View bookings to resolve" : "Book Now" : "Sign In to Book")}`);
  await evaluate("document.fonts.ready");
  await wait("[...document.querySelectorAll('.rp-detail-gallery img')].every(img=>img.complete)");
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  const point = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();
    const x=r.x+r.width/2,y=r.y+r.height/2;
    if(!e.contains(document.elementFromPoint(x,y))) throw Error('Covered control: '+${JSON.stringify(selector)});
    return {x,y}; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}
const measure = () => evaluate(`(() => {
  const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  const info=document.querySelector('.rp-detail-information'), main=document.querySelector('.rp-renter-main');
  return {width:innerWidth,layout:rect('.rp-vehicle-details-layout'),gallery:rect('.rp-detail-gallery'),cover:rect('.rp-detail-cover'),
    booking:rect('.rp-vehicle-booking'),information:rect('.rp-detail-information'),specifications:rect('.rp-detail-specifications'),secondary:rect('.rp-detail-secondary'),
    informationColumns:getComputedStyle(info).gridTemplateColumns.split(' ').length,bottomPadding:parseFloat(getComputedStyle(main).paddingBottom),
    specificationsBeforeBooking:Boolean(document.querySelector('.rp-detail-specifications').compareDocumentPosition(document.querySelector('#booking-form'))&Node.DOCUMENT_POSITION_FOLLOWING),
    specificationCount:document.querySelectorAll('.rp-detail-specification-grid > div').length,
    specificationColumns:getComputedStyle(document.querySelector('.rp-detail-specification-grid')).gridTemplateColumns.split(' ').length,
    overflow:document.body.scrollWidth>document.body.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1,
    bodyBottom:document.body.getBoundingClientRect().bottom,viewportHeight:innerHeight};
})()`);
async function checkLayout(name) {
  const m = await measure(), close = (a, b) => Math.abs(a - b) < 2;
  assert.equal(m.overflow, false, `${name}: horizontal overflow`);
  assert.equal(m.specificationsBeforeBooking, true, `${name}: specifications precede booking in document reading order`);
  assert.equal(m.specificationCount, 6, `${name}: keep all six specifications without duplicating the section`);
  assert.equal(m.specificationColumns, 2, `${name}: keep compact two-column specifications`);
  assert.ok(close(m.bodyBottom, m.viewportHeight), `${name}: scroll viewport must reach the screen bottom`);
  if (m.width >= 768) {
    assert.ok(close(m.specifications.left, m.layout.left) && close(m.secondary.right, m.layout.right), `${name}: the lower information row must span both columns`);
    assert.ok(close(m.gallery.top, m.booking.top) && close(m.gallery.bottom, m.booking.bottom), `${name}: photo and booking panels must align`);
    assert.ok(close(m.specifications.right, m.gallery.right) && close(m.secondary.left, m.booking.left), `${name}: specifications and supporting details stay in their desktop columns`);
    assert.ok(close(m.specifications.top, m.secondary.top) && close(m.specifications.bottom, m.secondary.bottom), `${name}: lower panels remain aligned`);
    assert.ok(m.information.top >= m.booking.bottom && m.information.top - m.booking.bottom <= 25, `${name}: information follows the top row without a large gap`);
    assert.ok(m.cover.height >= 256, `${name}: gallery image remains usable`);
    assert.equal(m.bottomPadding, 32, `${name}: retain a small bottom gutter`);
  } else {
    assert.ok(m.specifications.top > m.gallery.bottom && m.booking.top > m.specifications.bottom && m.information.top > m.booking.bottom, `${name}: mobile order must be image, specifications, booking, supporting details`);
    assert.equal(m.informationColumns, 1, `${name}: preserve stacked mobile information`);
    assert.equal(m.cover.height, 192, `${name}: preserve mobile image height`);
    assert.equal(m.bottomPadding, 64, `${name}: preserve mobile page spacing`);
  }
  checks.push({ name, ...m });
}
async function screenshot(name) {
  await evaluate("document.body.scrollTo({top:0,behavior:'instant'})");
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await fs.writeFile(path.join(output, `${name}.png`), Buffer.from(shot.data, "base64"));
}

try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  for (const [width, height] of [[320,568],[390,844],[667,375],[767,960],[768,1024],[1024,768],[1440,1080],[1920,1080]]) {
    vehicle = initialVehicle;
    await open(width, height);
    await checkLayout(`guest-${width}`);
    if ([390,1440,1920].includes(width)) await screenshot(`guest-${width}`);
  }
  vehicle = { ...initialVehicle, name: "Long vehicle name with additional trim and model information", owner: { ...owner, name: "Long owner name with multiple family names" },
    driverOptionEnabled: true, driverHourlyRate: 75,
    images: [`${base}/bmw-x5.png`, `${base}/hero-car1.png`, `${base}/hero-car.jpg`],
    reviews: [{ _id: "fixture-review", name: "Fixture Reviewer", rating: 4, comment: "Synthetic review used only to exercise expandable content." }],
  };
  for (const width of [390,768,1440]) {
    await open(width, 1080, true);
    await checkLayout(`signed-in-driver-gallery-${width}`);
    const totals = () => evaluate("[...document.querySelectorAll('.rp-detail-summary-row')].find(row=>row.textContent.includes('Estimated total')).textContent");
    const before = await totals();
    await click('.rp-detail-driver-fields button:last-child');
    assert.notEqual(await totals(), before, "Driver selection still updates the estimate");
    await click('button[aria-label="Next image"]');
    await wait("document.querySelector('button[aria-label=\"Show vehicle image 2\"]')?.getAttribute('aria-pressed')==='true'");
    await click('.rp-detail-secondary > details:first-child > summary');
    await click('.rp-detail-reviews > summary');
    await checkLayout(`expanded-details-${width}`);
    await click('.rp-detail-review-body button');
    await wait("[...document.querySelectorAll('h3')].some(e=>e.textContent==='All Reviews')");
    await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Close').click()");
    await wait("![...document.querySelectorAll('h3')].some(e=>e.textContent==='All Reviews')");
    await click('#booking-form .rp-btn-primary');
    await wait("document.querySelector('#booking-form [role=\"alert\"]')?.textContent.includes('Fixture booking failure')");
    assert.equal(submissions.at(-1).vehicleId, vehicle._id);
    assert.equal(submissions.at(-1).driverSelected, true);
    await checkLayout(`booking-error-${width}`);
  }
  vehicle = initialVehicle;
  eligibilityReasons = Array.from({ length: 4 }, (_, index) => ({ code: "OVERDUE_BOOKING_BALANCE", bookingId: `fixture-booking-${index}`, amountDue: 1234.56 }));
  await open(1440, 1080, true);
  await checkLayout("multiple-booking-restrictions");
  await screenshot("booking-restrictions");
  await click('.rp-detail-back');
  await wait("location.pathname==='/vehicles'");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, names: checks.map(check=>check.name), runtimeErrors: errors, output }, null, 2));
  await fs.writeFile(path.join(output, "measurements.json"), JSON.stringify(checks, null, 2));
} finally {
  await send("Page.close").catch(() => {});
  ws.close();
}
