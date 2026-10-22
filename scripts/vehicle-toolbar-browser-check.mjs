// Isolated fixtures: all API calls and external traffic are intercepted.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = process.env.FLEET_TOOLBAR_BASE_URL || "http://127.0.0.1:4183";
const cdp = process.env.FLEET_TOOLBAR_CDP_URL || "http://127.0.0.1:9243";
const output = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-vehicle-toolbar-"));
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map(), errors = [], checks = [];
let sequence = 0, signedIn = false, failListings = false;
const user = { _id: "507f1f77bcf86cd799439011", name: "Fixture Renter", role: "user", isVerified: true, kycStatus: "approved" };
const fixtures = Array.from({ length: 24 }, (_, index) => ({
  _id: `507f1f77bcf86cd7994390${String(31 + index)}`,
  name: `Fixture ${index % 2 ? "motorcycle" : "car"} ${index + 1}`,
  location: "Dagupan City, Pangasinan", availabilityStatus: "available", hourlyRentalRate: 250,
  specs: { type: index % 2 ? "motorcycle" : "car", transmission: "Automatic", seats: 2 }, images: [],
}));
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
    { name: "Access-Control-Allow-Methods", value: "GET,OPTIONS" },
  ], body: Buffer.from(JSON.stringify(body)).toString("base64"),
});
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    if (request.method !== "GET") return fulfill(requestId, { message: "Fixture blocks live mutations." }, 503);
    if (url.pathname === "/api/auth/me") return signedIn ? fulfill(requestId, { user }) : fulfill(requestId, { message: "Fixture guest" }, 401);
    const search = (url.searchParams.get("search") || "").toLowerCase();
    const type = url.searchParams.get("vehicleType") || "";
    const vehicles = fixtures.filter(vehicle => (!type || vehicle.specs.type === type) && (!search || vehicle.name.toLowerCase().includes(search)));
    if (url.pathname === "/api/vehicles/suggestions") return fulfill(requestId, { suggestions: vehicles.slice(0, 3).map(vehicle => ({
      id: vehicle._id, name: vehicle.name, location: vehicle.location, hourlyRate: vehicle.hourlyRentalRate,
    })) });
    if (url.pathname === "/api/vehicles") {
      await pause(150);
      return failListings ? fulfill(requestId, { message: "Fixture listings unavailable." }, 503)
        : fulfill(requestId, { vehicles, pagination: { total: vehicles.length, hasNextPage: false } });
    }
    if (url.pathname.startsWith("/api/vehicles/")) return fulfill(requestId, { vehicle: fixtures.find(vehicle => vehicle._id === url.pathname.split("/").at(-1)) });
    return fulfill(requestId, { vehicles: [], notifications: [], unreadCount: 0 });
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
  return result.result.value;
};
async function wait(expression) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await pause(100);
  }
  throw Error(`Timed out: ${expression}`);
}
async function click(selector) {
  await wait(`document.querySelector(${JSON.stringify(selector)})`);
  const point = await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); const r=element.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}
const input = value => evaluate(`(() => {const element=document.getElementById('vehicle-market-search'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,${JSON.stringify(value)}); element.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const measure = () => evaluate(`(() => {
  const rect = selector => {const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};
  return {nav:rect('.rp-site-navbar'),toolbar:rect('.rp-results-toolbar'),filters:rect('.rp-quick-filters'),search:rect('#vehicle-market-search'),
    heading:rect('#vehicle-results-heading'),grid:document.querySelector('.rp-market-grid')?rect('.rp-market-grid'):null,
    scroll:document.body.scrollTop,overflow:document.documentElement.scrollWidth>innerWidth};
})()`);
const scrollDeep = async () => {
  await evaluate("document.getElementById('vehicle-market-search').blur(); document.body.scrollTo({top:900,behavior:'instant'})");
  await pause(80);
};
const assertSticky = async label => {
  const layout = await measure();
  assert.ok(layout.scroll > 100, `${label}: fixture must scroll`);
  assert.ok(Math.abs(layout.toolbar.top - layout.nav.bottom) <= 1, `${label}: toolbar must stay below navbar: ${JSON.stringify(layout)}`);
  assert.ok(layout.heading.bottom < layout.nav.bottom, `${label}: large heading should scroll away`);
  assert.equal(layout.overflow, false, `${label}: horizontal overflow`);
  return layout;
};
const assertContinuousBackdrop = async label => {
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const pixels = await evaluate(`(async () => {
    const shot = new Image(); shot.src = 'data:image/png;base64,${data}'; await shot.decode();
    const canvas = document.createElement('canvas'); canvas.width = shot.naturalWidth; canvas.height = shot.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(shot, 0, 0);
    const toolbar = document.querySelector('.rp-results-toolbar').getBoundingClientRect();
    const columns = [2, Math.floor(toolbar.left)-2, Math.ceil(toolbar.left)+2, Math.floor((toolbar.left+toolbar.right)/2), Math.floor(toolbar.right)-2, Math.ceil(toolbar.right)+2, document.body.clientWidth-2];
    const sample = y => columns.map(x => Array.from(context.getImageData(x, y, 1, 1).data));
    return { background: sample(Math.floor(toolbar.bottom)-5), divider: sample(Math.floor(toolbar.bottom)-1) };
  })()`);
  for (const [surface, samples] of Object.entries(pixels)) {
    for (const sample of samples) assert.deepEqual(sample, samples[3], `${label}: toolbar ${surface} must continue across the page gutters`);
  }
  assert.deepEqual(pixels.divider[3], pixels.background[3], `${label}: toolbar bottom edge must have no visible divider`);
};
const assertResultsVisible = async () => {
  await wait("document.querySelector('.rp-fleet-results .rp-market-grid')");
  const layout = await measure();
  assert.ok(layout.grid.top >= layout.toolbar.bottom - 1 && layout.grid.top <= layout.toolbar.bottom + 24, `First results must appear below toolbar: ${JSON.stringify(layout)}`);
};
const screenshot = async name => {
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await fs.writeFile(path.join(output, `${name}.png`), Buffer.from(data, "base64"));
};

try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Page.navigate", { url: `${base}/vehicles` });
  await wait("document.getElementById('vehicle-market-search') && document.querySelector('.rp-fleet-results .rp-market-grid')");
  for (const [width, height] of [[320,568],[390,844],[640,800],[767,900],[768,1024],[1024,768],[1440,900],[1920,1080],[667,375]]) {
    console.log(`Checking toolbar at ${width}x${height}`);
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    await evaluate("document.body.scrollTo({top:0,behavior:'instant'})");
    await pause(80);
    const before = await measure();
    assert.ok(before.toolbar.top > before.nav.bottom + 20, `${width}: toolbar must begin in normal flow`);
    await scrollDeep();
    const pinned = await assertSticky(`${width}x${height}`);
    await assertContinuousBackdrop(`${width}x${height}`);
    if (width >= 768) {
      assert.ok(Math.abs(pinned.filters.top - pinned.search.top) <= 1 && Math.abs(pinned.filters.bottom - pinned.search.bottom) <= 1, `${width}: control alignment`);
    } else {
      assert.ok(pinned.filters.bottom < pinned.search.top, `${width}: stacked controls`);
    }
    await evaluate("document.querySelector('.rp-quick-filters button:last-child').focus()");
    assert.equal(await evaluate("(() => {const r=document.activeElement.getBoundingClientRect(),c=document.querySelector('.rp-quick-filters').getBoundingClientRect();return r.left>=c.left&&r.right<=c.right;})()"), true, `${width}: focused category must be visible`);
    await assertSticky(`${width}: category keyboard focus`);
    if (await evaluate("Boolean(document.querySelector('.rp-ai-launcher-dismiss'))")) await click(".rp-ai-launcher-dismiss");
    await click("#vehicle-market-search");
    await wait("document.querySelectorAll('#vehicle-search-options [role=option]').length === 3");
    assert.equal(await evaluate("(() => {const r=document.querySelector('.rp-vehicle-search__options').getBoundingClientRect(); const item=document.querySelector('#vehicle-search-options [role=option]');const i=item.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&document.elementFromPoint(i.left+10,i.top+10)?.closest('[role=option]')===item;})()"), true, `${width}: suggestions must remain above results`);
    for (let index = 0; index < 3; index += 1) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown" });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown" });
    }
    await wait("document.getElementById('vehicle-market-search').getAttribute('aria-activedescendant')==='vehicle-search-option-2'");
    assert.equal(await evaluate("(() => {const m=document.querySelector('.rp-vehicle-search__options').getBoundingClientRect(),o=document.getElementById('vehicle-search-option-2').getBoundingClientRect();return o.top>=m.top&&o.bottom<=m.bottom&&m.bottom<=innerHeight;})()"), true, `${width}: selected suggestion must stay visible`);
    if (width === 390) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 450, deviceScaleFactor: 1, mobile: true });
      await pause(100);
      await assertSticky("Reduced mobile viewport");
      assert.equal(await evaluate("document.querySelector('.rp-vehicle-search__options').getBoundingClientRect().bottom<=innerHeight && document.activeElement.id==='vehicle-market-search'"), true, "Resizing the mobile viewport must preserve search focus and bound suggestions");
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    }
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape" });
    assert.equal(await evaluate("document.getElementById('vehicle-market-search').getAttribute('aria-expanded')"), "false");
    if ([390,1440].includes(width)) await screenshot(`sticky-${width}`);
    checks.push({ width, height, toolbarHeight: pinned.toolbar.height });
  }
  for (const width of [390,1440]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await scrollDeep();
    await evaluate("document.querySelector('.rp-quick-filters button:nth-child(2)').focus()");
    await click(".rp-quick-filters button:nth-child(2)");
    await wait("document.querySelector('.rp-bookings-page-header__description')?.textContent.trim()==='12 vehicles match your search'");
    await assertResultsVisible();
    await scrollDeep();
    await click("#vehicle-market-search");
    await input("Fixture car 1");
    await wait("document.querySelector('.rp-bookings-page-header__description')?.textContent.trim()==='6 vehicles match your search'");
    await assertResultsVisible();
    assert.equal(await evaluate("document.activeElement.id"), "vehicle-market-search", `${width}: search must retain focus`);
    await input("");
    await evaluate("document.querySelector('.rp-quick-filters button:first-child').focus()");
    await click(".rp-quick-filters button:first-child");
    await wait("document.querySelector('.rp-bookings-page-header__description')?.textContent.trim()==='24 vehicles match your search'");
    await evaluate("document.body.scrollTo({top:0,behavior:'instant'})");
    await click(".rp-quick-filters button:nth-child(2)");
    await wait("document.querySelector('.rp-bookings-page-header__description')?.textContent.trim()==='12 vehicles match your search'");
    assert.equal(await evaluate("document.body.scrollTop"), 0, `${width}: filtering at the top must not jump the page`);
    await click(".rp-quick-filters button:first-child");
    await wait("document.querySelector('.rp-bookings-page-header__description')?.textContent.trim()==='24 vehicles match your search'");
  }
  await scrollDeep();
  await evaluate("document.querySelector('.rp-vehicle-card:nth-child(5) button').focus()");
  await pause(80);
  assert.equal(await evaluate("document.activeElement.getBoundingClientRect().top >= document.querySelector('.rp-results-toolbar').getBoundingClientRect().bottom"), true, "Keyboard focus must not be hidden by toolbar");
  await scrollDeep();
  const refreshScroll = await evaluate("document.body.scrollTop");
  await evaluate("document.querySelector('button[aria-label=\"Refresh vehicles\"]').click()");
  await wait("document.querySelector('button[aria-label=\"Refreshing vehicles\"]')");
  assert.equal(await evaluate("document.querySelectorAll('.rp-vehicle-card').length"), 24, "Refresh must retain cards");
  await wait("document.querySelector('button[aria-label=\"Refresh vehicles\"]:not([disabled])')");
  assert.equal(await evaluate("document.body.scrollTop"), refreshScroll, "Refresh must preserve scroll position");
  await click("#vehicle-market-search");
  await input("No matching fixture");
  await wait("document.querySelector('.rp-results-status strong')?.textContent==='No vehicles match your search'");
  assert.equal(await evaluate("document.querySelector('.rp-results-status').getBoundingClientRect().top >= document.querySelector('.rp-results-toolbar').getBoundingClientRect().bottom"), true, "Empty state must stay below toolbar");
  await evaluate("document.querySelector('.rp-results-status button').click()");
  await wait("document.querySelectorAll('.rp-vehicle-card').length===24");
  assert.equal(await evaluate("document.getElementById('vehicle-market-search').value"), "");
  await scrollDeep();
  await click("#vehicle-market-search");
  await wait("document.querySelector('#vehicle-search-option-0')");
  await click("#vehicle-search-option-0");
  await wait("document.querySelector('.rp-modal-panel')");
  assert.equal(await evaluate("getComputedStyle(document.body).overflowY"), "hidden", "Preview must lock scrolling");
  assert.equal(await evaluate("(() => {const p=document.querySelector('.rp-modal-panel'),r=p.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+30)?.closest('.rp-modal-panel')===p;})()"), true, "Preview must cover sticky toolbar");
  await evaluate("document.querySelector('.rp-modal-panel button[aria-label=\"Close vehicle preview\"]').click()");
  await wait("!document.querySelector('.rp-modal-panel')");
  await assertSticky("After closing preview");
  failListings = true;
  await click(".rp-quick-filters button:nth-child(3)");
  await wait("document.querySelector('.rp-results-status--error')");
  failListings = false;
  await evaluate("document.querySelector('.rp-results-status--error button').click()");
  await wait("document.querySelectorAll('.rp-vehicle-card').length===12");
  await assertResultsVisible();
  signedIn = true;
  await send("Page.navigate", { url: `${base}/vehicles` });
  await wait("document.querySelectorAll('.rp-vehicle-card').length===24");
  await scrollDeep(); await assertSticky("Signed-in renter");
  await evaluate("document.querySelector('.rp-site-navbar').style.fontSize='200%'");
  await pause(100); await assertSticky("Resized navigation");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, viewports: checks, scenarios: ["filter and search repositioning", "focus visibility", "empty and error recovery", "preview layering", "guest and renter", "navigation resize"], output }));
} catch (error) {
  await screenshot("failure");
  console.error(JSON.stringify({ output, layout: await measure(), active: await evaluate("({id:document.activeElement.id,text:document.activeElement.textContent?.slice(0,80),expanded:document.getElementById('vehicle-market-search').getAttribute('aria-expanded'),options:document.querySelector('.rp-vehicle-search__options')?.textContent})") }));
  throw error;
} finally {
  await send("Page.close").catch(() => {});
  ws.close();
}
