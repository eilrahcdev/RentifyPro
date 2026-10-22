// Isolated layout fixtures; every API request is intercepted before reaching a service.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = process.env.RESPONSIVE_BASE_URL || "http://127.0.0.1:4189";
const cdp = process.env.RESPONSIVE_CDP_URL || "http://127.0.0.1:9249";
const output = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-fixed-navbar-"));
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map(), checks = [], failures = [], errors = [];
let sequence = 0, signedIn = false, pendingVerification = false;
const user = { _id: "507f1f77bcf86cd799439011", name: "Fixture Renter", email: "renter@example.test", role: "user", isVerified: true, kycStatus: "approved" };
const owner = { ...user, _id: "507f1f77bcf86cd799439012", name: "Fixture Owner", role: "owner" };
const vehicle = {
  _id: "507f1f77bcf86cd799439031", name: "Toyota Fortuner", location: "Calasiao, Pangasinan",
  hourlyRentalRate: 1250, dailyRentalRate: 1250, pricingUnit: "hourly", availabilityStatus: "available",
  images: [], reviews: [], owner, description: "Layout fixture vehicle.",
  specs: { type: "Car", transmission: "Automatic", seats: 7, fuelType: "Diesel" },
};
const booking = {
  _id: "507f1f77bcf86cd799439021", status: "confirmed", paymentStatus: "partial", paymentAmountPaid: 9000,
  paymentAmountDue: 21140, pickupAt: new Date(Date.now() + 86400000).toISOString(),
  returnAt: new Date(Date.now() + 172800000).toISOString(), vehicle, owner, renter: user,
  totalAmount: 30000, baseAmount: 30000, transactionFee: 140, vehicleHourlyRate: 1250,
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
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
    { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,PUT,DELETE,OPTIONS" },
  ], body: Buffer.from(JSON.stringify(body)).toString("base64"),
});
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (url.pathname.includes("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    const endpoint = url.pathname.slice(url.pathname.indexOf("/api/") + 4);
    if (["/auth/me", "/auth/profile"].includes(endpoint)) return signedIn ? fulfill(requestId, { user }) : fulfill(requestId, { message: "Fixture guest" }, 401);
    if (endpoint === "/kyc/me") return fulfill(requestId, { status: pendingVerification ? "pending_review" : "approved", verification: {
      accountStatus: "active", emailVerified: true, bookingEligible: !pendingVerification,
      listingEligible: false, documents: [],
    } });
    if (endpoint === "/vehicles") return fulfill(requestId, { vehicles: Array.from({ length: 12 }, (_, index) => ({ ...vehicle, _id: index ? `507f1f77bcf86cd7994390${String(31 + index)}` : vehicle._id })), page: { hasMore: false } });
    if (endpoint === `/vehicles/${vehicle._id}`) return fulfill(requestId, { vehicle });
    if (endpoint === "/bookings/eligibility") return fulfill(requestId, { eligibility: { eligible: true, counts: { open: 1, pending: 0 }, limits: { open: 3, pending: 2 }, reasons: [] } });
    if (endpoint === "/bookings/me") return fulfill(requestId, { bookings: [booking], page: { hasMore: false } });
    if (endpoint === "/notifications") return fulfill(requestId, { notifications: Array.from({ length: 12 }, (_, index) => ({ _id: `fixture-${index}`, title: "Booking notification", message: "Review your booking details.", createdAt: new Date().toISOString() })) });
    if (endpoint === "/auth/login-challenge") return fulfill(requestId, { challengeId: "fixture", question: "2 + 3" });
    if (request.method !== "GET") return fulfill(requestId, { message: "No live mutations in this layout fixture." }, 503);
    return fulfill(requestId, { vehicles: [], bookings: [], notifications: [], conversations: [], messages: [], unreadCount: 0, stats: {}, summary: {} });
  }
  if (url.origin === base && !url.pathname.startsWith("/socket.io/")) return send("Fetch.continueRequest", { requestId });
  return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
}
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id); pending.delete(message.id);
    if (message.error) call?.reject(Error(message.error.message)); else call?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") route(message.params).catch(error => {
    if (!/Invalid InterceptionId|Target closed/.test(error.message)) errors.push(error.message);
  });
  else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function wait(expression) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await evaluate(`Boolean(${expression})`)) return; await pause(60); }
  throw Error(`Timeout: ${expression}; ${await evaluate("location.href+' '+document.body.innerText.slice(0,300)")}`);
}
const expect = (condition, message) => { if (!condition) failures.push(message); };
async function viewport(width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 1024 });
  await pause(100);
}
async function open(url, authenticated = false) {
  signedIn = authenticated;
  await send("Page.navigate", { url: "about:blank" });
  await send("Storage.clearDataForOrigin", { origin: base, storageTypes: "all" });
  await send("Page.navigate", { url: base + url });
  await wait("document.querySelector('.rp-site-navbar')?.getBoundingClientRect().height>0 && !document.querySelector('[aria-label=\"Loading your account\"]') && !document.querySelector('[aria-label=\"Loading page\"]')");
  await evaluate("document.fonts.ready");
  await evaluate("document.querySelector('.rp-ai-launcher-dismiss')?.click()");
  await pause(150);
}
async function click(expression) {
  await wait("!document.querySelector('[aria-label=\"Loading page\"]')");
  await evaluate(`(${expression}).scrollIntoView({block:'nearest',behavior:'instant'})`);
  await pause(80);
  const point = await evaluate(`(() => { const e = ${expression},r=e.getBoundingClientRect();
    const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
    if(!e.contains(hit)) throw Error('Click covered: '+e.outerHTML.slice(0,140)+' by '+hit?.outerHTML.slice(0,140));
    return {x,y}; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}
const navButton = label => `[...document.querySelectorAll('.rp-site-navbar button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
const measure = () => evaluate(`(() => {
  const nav=document.querySelector('.rp-site-navbar'), n=nav.getBoundingClientRect(), b=document.body.getBoundingClientRect();
  const leaked=[];
  for(const x of [4,innerWidth/2,innerWidth-4]) for(const y of [1,n.bottom-1]) {
    const hit=document.elementFromPoint(x,y);
    if(hit?.closest('.rp-renter-home,.rp-renter-page,.rp-policy-page')&&!nav.contains(hit)) leaked.push(hit.tagName+'.'+hit.className);
  }
  return {navTop:n.top,navBottom:n.bottom,bodyTop:b.top,bodyBottom:b.bottom,scrollTop:document.body.scrollTop,
    scrollable:document.body.scrollHeight>document.body.clientHeight+1,windowY:scrollY,
    overflow:document.body.scrollWidth>document.body.clientWidth+1,leaked,
    fixed:getComputedStyle(nav).position==='fixed'};
})()`);
async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(path.join(output, `${name}.png`), Buffer.from(shot.data, "base64"));
}
try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const pages = [
    ["home", "/", false], ["home-renter", "/", true], ["about", "/about", false],
    ["vehicles", "/vehicles", true], ["details", `/vehicle-details?vehicleId=${vehicle._id}`, true],
    ["bookings", "/bookings", true],
    ["settings", "/account-settings", true], ["notifications", "/notifications", true],
    ["messages", "/chat", true], ["privacy", "/privacy-policy", false], ["terms", "/terms-and-conditions", false],
  ];
  for (const [name, url, authenticated] of process.env.NAVBAR_INTERACTIONS_ONLY ? [] : process.env.NAVBAR_REPRO_ONLY ? pages.slice(0, 1) : pages) {
    await viewport(1440, 900); await open(url, authenticated);
    for (const [width, height] of process.env.NAVBAR_REPRO_ONLY ? [[1440, 900]] : [[320,568],[390,844],[768,1024],[1024,768],[1440,900],[667,375]]) {
      await viewport(width, height);
      await evaluate("document.body.scrollTo({top:0,behavior:'instant'})");
      const before = await measure();
      expect(before.fixed && before.navTop === 0, `${name} ${width}: navbar must remain fixed at the top`);
      expect(before.bodyTop >= before.navBottom - 1, `${name} ${width}: page scrolling area starts behind navbar: ${JSON.stringify(before)}`);
      expect(!before.overflow, `${name} ${width}: horizontal overflow`);
      await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: width / 4, y: Math.min(height - 30, before.navBottom + 180), deltaX: 0, deltaY: 700 });
      await pause(200);
      const after = await measure();
      expect(after.navTop === before.navTop && after.navBottom === before.navBottom, `${name} ${width}: navbar moved during scrolling`);
      expect(!before.scrollable || after.scrollTop > 0, `${name} ${width}: page content does not scroll`);
      expect(after.leaked.length === 0 && after.windowY === 0, `${name} ${width}: content enters navbar area: ${JSON.stringify(after)}`);
      checks.push({ name, width, height, before, after });
      if (name === "home" && [390,1440].includes(width)) await screenshot(`home-scrolled-${width}`);
    }
  }
  if (!process.env.NAVBAR_REPRO_ONLY) {
    await viewport(1440,900); await open("/");
    await click(navButton("About"));
    await pause(1400);
    expect(await evaluate("document.body.scrollTop>0 && document.querySelector('#about').getBoundingClientRect().top>=document.querySelector('.rp-site-navbar').getBoundingClientRect().bottom-1 && document.querySelector('#about').getBoundingClientRect().top<innerHeight"), "About shortcut must scroll below navbar");
    await click(navButton("Contacts")); await pause(1400);
    expect(await evaluate("document.body.scrollTop>0 && document.querySelector('#contacts').getBoundingClientRect().top>=document.querySelector('.rp-site-navbar').getBoundingClientRect().bottom-1 && document.querySelector('#contacts').getBoundingClientRect().top<innerHeight"), "Contacts shortcut must scroll below navbar");
    await click(navButton("Home"));
    await wait("document.body.scrollTop===0");
    await click(navButton("Vehicles"));
    await wait("location.pathname==='/vehicles' && document.querySelector('.rp-fleet-results')");
    expect(await evaluate("document.body.scrollTop===0"), "Page navigation must reset content scrolling");
    await click(navButton("Home")); await wait("document.querySelector('#home')");
    await evaluate("document.querySelector('#contacts').scrollIntoView({behavior:'instant'})");
    await click("[...document.querySelectorAll('#contacts button')].find(b=>b.textContent.trim()==='Home')");
    await wait("document.body.scrollTop===0");
    checks.push({ name: "navigation-and-footer-shortcuts" });

    await open("/about");
    await click("[...document.querySelectorAll('footer button')].find(b=>b.textContent.trim()==='Home')");
    await wait("document.body.scrollTop===0");
    const footerAnchors = await evaluate("document.querySelectorAll('footer a[href=\"#\"]').length");
    for (let index = 0; index < footerAnchors; index++) {
      await click(`document.querySelectorAll('footer a[href="#"]')[${index}]`);
      await wait("document.body.scrollTop===0");
    }
    checks.push({ name: "about-footer-scroll-shortcuts" });

    await open("/privacy-policy");
    await click("document.querySelector('.rp-policy-contents summary')");
    await click("document.querySelector('.rp-policy-contents a[href=\"#policy-section-7\"]')");
    expect(await evaluate("document.querySelector('#policy-section-7').getBoundingClientRect().top>=document.querySelector('.rp-site-navbar').getBoundingClientRect().bottom-1 && document.querySelector('#policy-section-7').getBoundingClientRect().top<innerHeight"), "Native policy anchors must land below navbar");
    checks.push({ name: "native-policy-anchor" });

    await open("/");

    await viewport(390,844);
    await evaluate("document.body.scrollTo({top:500,behavior:'instant'})");
    const originalScroll = await evaluate("document.body.scrollTop");
    await click("document.querySelector('.rp-site-navbar__menu-trigger')");
    await wait("document.querySelector('[aria-label=\"Close menu backdrop\"]')");
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 10, y: 400, deltaX: 0, deltaY: 500 });
    await pause(150);
    expect(await evaluate("getComputedStyle(document.body).overflowY==='hidden' && document.body.scrollTop===" + originalScroll), "Mobile menu must lock page scrolling");
    await click("document.querySelector('[aria-label=\"Close menu backdrop\"] + div [aria-label=\"Close menu\"]')");
    await wait("!document.querySelector('[aria-label=\"Close menu backdrop\"]')");
    expect(await evaluate("getComputedStyle(document.body).overflowY==='auto'"), "Closing menu must restore page scrolling");
    checks.push({ name: "mobile-menu-scroll-lock" });

    await viewport(1440,900);
    await click("document.querySelector('[aria-label=\"Help\"]')");
    await wait("document.querySelector('[role=\"dialog\"]')");
    expect(await evaluate("getComputedStyle(document.body).overflowY==='hidden'"), "Help dialog must lock page scrolling");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    await wait("!document.querySelector('[role=\"dialog\"]')");
    checks.push({ name: "help-dialog-scroll-lock-and-escape" });

    pendingVerification = true;
    await open("/vehicles", true);
    await wait("document.querySelector('[data-verification-notice]')");
    await click("document.querySelector('[data-verification-notice] button')");
    await wait("location.pathname==='/account-settings' && document.querySelector('#verification-status')");
    expect(await evaluate("document.querySelector('#verification-status').getBoundingClientRect().top>=document.querySelector('.rp-site-navbar').getBoundingClientRect().bottom-1"), "Verification status navigation must remain below navbar");
    checks.push({ name: "verification-notice-and-status-navigation" });
    pendingVerification = false;

    await open("/vehicles", true);
    await wait("document.querySelector('.rp-market-grid button.rp-vehicle-card__preview')");
    await evaluate("[...document.querySelectorAll('.rp-market-grid button.rp-vehicle-card__preview')].at(-1).focus()");
    expect(await evaluate("(() => { const button=document.activeElement,r=button.getBoundingClientRect();return r.top>=document.querySelector('.rp-site-navbar').getBoundingClientRect().bottom && r.bottom<=innerHeight && button.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)); })()"), "Keyboard focus must reveal the page control below navbar");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await send("Input.dispatchKeyEvent", { type: "char", key: "Enter", text: "\r", unmodifiedText: "\r" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await wait("document.querySelector('.rp-modal-layer')");
    expect(await evaluate("getComputedStyle(document.body).overflowY==='hidden'"), "Vehicle preview must preserve modal scroll locking");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    await wait("!document.querySelector('.rp-modal-layer')");
    expect(await evaluate("getComputedStyle(document.body).overflowY==='auto'"), "Closing vehicle preview must restore page scrolling");
    const idleListener = await send("Runtime.evaluate", { expression: "getEventListeners(document.body).scroll.some(entry=>entry.listener.name==='markActivity' && !entry.useCapture) && getEventListeners(window).scroll.some(entry=>entry.listener.name==='markActivity' && !entry.useCapture)", includeCommandLineAPI: true, returnByValue: true });
    expect(idleListener.result.value === true, "Session activity must still receive scrolling from the page container");
    checks.push({ name: "keyboard-page-control-preview-and-session-scroll-listener" });

    await open("/");
    await evaluate("document.documentElement.style.fontSize='200%'"); await pause(150);
    const enlarged = await measure();
    expect(enlarged.bodyTop >= enlarged.navBottom - 1 && !enlarged.overflow, "Layout must follow navbar height at 200 percent text");
    await evaluate("document.documentElement.style.fontSize=''");
    await click(navButton("Sign In"));
    await wait("location.pathname==='/signin' && document.querySelector('input[type=password]')");
    expect(await evaluate("!document.documentElement.classList.contains('rp-fixed-navbar-layout') && !document.documentElement.style.getPropertyValue('--rp-navbar-height') && getComputedStyle(document.body).position!=='fixed'"), "Leaving navbar pages must restore normal document layout");
    checks.push({ name: "resized-header-and-route-cleanup" });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
} finally {
  await fs.writeFile(path.join(output,"results.json"),JSON.stringify({checks,failures,errors},null,2));
  console.log(JSON.stringify({checks:checks.length,failures,errors,output},null,2));
  await send("Page.close").catch(()=>{}); ws.close();
}
