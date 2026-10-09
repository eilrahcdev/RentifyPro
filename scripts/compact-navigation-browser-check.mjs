// Run Vite on 4189 and isolated Chrome with CDP on 9249. All service calls use fixtures.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = process.env.RESPONSIVE_BASE_URL || "http://127.0.0.1:4189";
const cdp = process.env.RESPONSIVE_CDP_URL || "http://127.0.0.1:9249";
const output = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-compact-navigation-"));
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map(), errors = [], failures = [], checks = [];
let sequence = 0, role = "user";
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
  pending.set(id, {
    resolve: (result) => { clearTimeout(timeout); resolve(result); },
    reject: (error) => { clearTimeout(timeout); reject(error); },
  });
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
let fixtureCount = 24;
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (url.pathname.includes("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    const endpoint = url.pathname.slice(url.pathname.indexOf("/api/") + 4);
    if (endpoint === "/auth/me" || endpoint === "/auth/profile") return role === "guest" ? fulfill(requestId, { message: "Not signed in" }, 401) : fulfill(requestId, { user: role === "owner" ? owner : renter });
    if (endpoint === "/vehicles" || endpoint === "/owner/vehicles") return fulfill(requestId, { vehicles: Array.from({ length: fixtureCount }, (_, i) => ({ ...vehicle, _id: i === 0 ? vehicle._id : "507f1f77bcf86cd79" + String(i).padStart(8, "0") })), page: { hasMore: false } });
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

const clickText = (selector, label) => evaluate("[...document.querySelectorAll(" + JSON.stringify(selector) + ")].find(e=>e.textContent.trim()===" + JSON.stringify(label) + ").click()");
const setInput = (selector, value) => evaluate("(()=>{const e=document.querySelector(" + JSON.stringify(selector) + ");Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e," + JSON.stringify(value) + ");e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()");
async function checkLayout(name, selector = "main") {
  for (const [width,height] of [[320,568],[390,667],[667,375],[768,1024],[820,1180],[1024,768],[1440,900]]) {
    await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:width<1024});await pause(150);
    const result = await evaluate("(()=>{const scope=document.querySelector(" + JSON.stringify(selector) + ");const fields=[...scope.querySelectorAll('input:not([type=hidden]):not([type=file]),select,textarea')].filter(e=>e.getBoundingClientRect().width>0);return {docWidth:document.documentElement.scrollWidth,total:document.documentElement.scrollHeight,outside:fields.filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1}).map(e=>e.id||e.type),smallFields:fields.filter(e=>!['checkbox','radio'].includes(e.type)&&(parseFloat(getComputedStyle(e).fontSize)<16||e.getBoundingClientRect().height<43.5)).map(e=>e.id||e.type)};})()");
    checks.push({page:name,width,height,...result});
    expect(result.docWidth<=width&&result.outside.length===0,name+" overflow at "+width);
    if(width<1024)expect(result.smallFields.length===0,name+" field sizing at "+width);
  }
}
try {
  await send("Page.enable");await send("Runtime.enable");await send("Fetch.enable",{patterns:[{urlPattern:"http*"}]});await send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:667,deviceScaleFactor:1,mobile:true});
  await open({name:"browse",url:"/vehicles",role:"user",ready:"document.querySelector('.rp-list-reveal button')"});
  expect(await evaluate("document.querySelectorAll('.rp-market-grid .rp-vehicle-card').length===6"),"Browse initial batch");
  await clickText(".rp-list-reveal button","Load more");await pause(150);
  expect(await evaluate("document.querySelectorAll('.rp-market-grid .rp-vehicle-card').length===12"),"Browse Load more");
  await setInput("input[type=search]","Toyota");await pause(600);
  expect(await evaluate("document.querySelectorAll('.rp-market-grid .rp-vehicle-card').length===6"),"Search resets batch");
  await setInput("input[type=search]","");await pause(600);
  expect(await evaluate("document.querySelectorAll('.rp-market-grid .rp-vehicle-card').length===6"),"Returning to old search resets batch");
  await send("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});await pause(150);
  expect(await evaluate("document.querySelectorAll('.rp-market-grid .rp-vehicle-card').length===24"),"Desktop keeps loaded listings");
  await checkLayout("browse-24");
  fixtureCount=12;
  await open({name:"owner-vehicles",url:"/owner-dashboard?tab=Vehicles",role:"owner",ready:"document.querySelector('main button.rp-btn-secondary[aria-label]')"});
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:667,deviceScaleFactor:1,mobile:true});await pause(150);
  expect(await evaluate("document.querySelectorAll('.rp-owner-vehicle-grid > article').length===6"),"Owner initial batch");
  await clickText(".rp-list-reveal button","Load more");await pause(150);
  expect(await evaluate("document.querySelectorAll('.rp-owner-vehicle-grid > article').length===12"),"Owner Load more");
  await checkLayout("owner-vehicles-12");
  await evaluate("document.querySelector('main button.rp-btn-secondary[aria-label]').click()");
  await wait("document.querySelector('#owner-vehicle-form-scroll-region')");
  await checkLayout("vehicle-editor","[aria-labelledby=vehicle-modal-title]");
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:667,deviceScaleFactor:1,mobile:true});
  await clickText(".rp-editor-navigation button","Photos and cover");await pause(150);
  expect(await evaluate("document.activeElement.id==='vehicle-editor-section-4' && document.querySelector('#owner-vehicle-form-scroll-region').scrollTop>100"),"Photos shortcut scrolls and focuses section");
  expect(await evaluate("(()=>{const r=document.querySelector('.rp-vehicle-editor button[type=submit]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()"),"Editor save stays visible");
  await open({name:"settings",url:"/account-settings",role:"user",ready:"document.querySelector('.rp-profile-section')"});
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:667,deviceScaleFactor:1,mobile:true});await pause(150);
  expect(await evaluate("[...document.querySelectorAll('.rp-profile-section > div[id]')].every(e=>e.hidden)"),"Profile sections start compact");
  await evaluate("document.querySelector('.rp-profile-section__header > button').click()");await pause(150);
  expect(await evaluate("!document.querySelector('.rp-profile-section > div[id]').hidden && [...document.querySelector('.rp-profile-section').querySelectorAll('input')].some(e=>!e.disabled)"),"Edit opens existing editor");
  await checkLayout("profile-edit");
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:667,deviceScaleFactor:1,mobile:true});
  await setInput(".rp-account-selector select","Change Password");await pause(150);
  expect(await evaluate("document.activeElement.id==='account-content-title'"),"Settings selector focuses content");
  await checkLayout("settings-password");
  await open({name:"owner-dashboard",url:"/owner-dashboard?tab=Dashboard",role:"owner",ready:"document.querySelector('.rp-dashboard-work')"});
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:667,deviceScaleFactor:1,mobile:true});await pause(150);
  expect(await evaluate("document.querySelector('.rp-dashboard-tasks').getBoundingClientRect().top<document.querySelector('.rp-dashboard-calendar').getBoundingClientRect().top"),"Mobile tasks precede calendar");
  await send("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});await pause(150);
  expect(await evaluate("document.querySelector('.rp-dashboard-calendar').getBoundingClientRect().left<document.querySelector('.rp-dashboard-tasks').getBoundingClientRect().left"),"Desktop keeps calendar beside tasks");
  for (const url of ["/privacy-policy","/terms-and-conditions"]) {
    await open({name:"policy",url,role:"guest",ready:"document.querySelector('.rp-policy-contents')"});
    expect(await evaluate("[...document.querySelectorAll('.rp-policy-contents a')].every(a=>document.querySelector(a.getAttribute('href')))"),"Every policy shortcut resolves");
  }
  console.log(JSON.stringify({measurements:checks.length,failures,errors,output}));
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
} finally {
  await fs.writeFile(path.join(output,"results.json"),JSON.stringify({checks,failures,errors},null,2));
  await send("Page.close").catch(()=>{});ws.close();
}

