// Isolated browser fixtures; every API request is intercepted before it can reach a service.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = process.env.CALENDAR_BROWSER_BASE || "http://127.0.0.1:4192";
const cdp = process.env.CALENDAR_BROWSER_CDP || "http://127.0.0.1:9252";
const owner = { _id: "507f1f77bcf86cd799439011", name: "Calendar Fixture Owner", role: "owner", isVerified: true, kycStatus: "approved" };
const renter = { _id: "507f1f77bcf86cd799439012", name: "Fixture Renter" };
const booking = (id, name, pickupAt, returnAt, extra = {}) => ({
  _id: id, owner, renter, vehicle: { _id: `vehicle-${id}`, name, images: [] },
  status: "confirmed", paymentStatus: "paid", pickupAt, returnAt,
  createdAt: "2026-10-20T01:00:00Z", updatedAt: "2026-10-20T01:00:00Z", ...extra,
});
const bookings = [
  booking("same-day", "Same-day fixture vehicle", "2026-10-22T01:00:00Z", "2026-10-22T09:00:00Z"),
  booking("ongoing", "Ongoing fixture vehicle", "2026-10-21T01:00:00Z", "2026-10-24T09:00:00Z"),
  booking("extension", "Extension fixture vehicle", "2026-10-20T01:00:00Z", "2026-10-24T09:00:00Z", {
    extensionRequest: { status: "requested", requestedReturnAt: "2026-10-25T09:00:00Z", requestedAt: "2026-10-22T01:00:00Z" },
  }),
  booking("completed", "Completed default fixture vehicle", "2026-10-22T01:00:00Z", "2026-10-22T09:00:00Z", { status: "completed" }),
  booking("approved-extended", "Approved extended fixture vehicle", "2026-10-27T01:00:00Z", "2026-10-29T09:00:00Z", { status: "extended", extensionRequest: { status: "requested", requestedReturnAt: "2026-10-31T09:00:00Z" } }),
  booking("overdue", "Overdue fixture vehicle", "2026-10-19T01:00:00Z", "2026-10-22T01:00:00Z"),
  booking("pending", "Unapproved fixture must stay excluded", "2026-10-22T01:00:00Z", "2026-10-22T09:00:00Z", { status: "pending" }),
  booking("cancelled", "Cancelled fixture must stay excluded", "2026-10-22T01:00:00Z", "2026-10-22T09:00:00Z", { status: "cancelled" }),
  ...Array.from({ length: 12 }, (_, index) => booking(`busy-${index}`, `Busy fixture vehicle ${index + 1} with a long descriptive name`, "2026-10-23T01:00:00Z", "2026-10-23T09:00:00Z", {
    renter: { ...renter, name: index ? "Fixture Renter" : "LongFixtureName".repeat(12) },
  })),
];
const historyBookings = [
  ...bookings.filter(row => row.status === "completed"),
  booking("past-rental", "Completed history fixture vehicle", "2026-10-12T01:00:00Z", "2026-10-14T09:00:00Z", { status: "completed", actualReturnAt: "2026-10-13T09:00:00Z" }),
  booking("past-stale", "Completed stale-request fixture vehicle", "2026-10-12T01:00:00Z", "2026-10-12T09:00:00Z", {
    status: "completed", lateReturn: { isOverdue: true, overdueMinutes: 120 },
    cancellationRequest: { status: "requested", requestedAt: "2026-10-12T00:00:00Z" },
    extensionRequest: { status: "requested", requestedReturnAt: "2026-10-25T09:00:00Z", requestedAt: "2026-10-12T00:00:00Z" },
  }),
  booking("past-span", "Completed cross-month fixture vehicle", "2026-09-30T01:00:00Z", "2026-10-02T09:00:00Z", { status: "completed" }),
  booking("past-september", "September history fixture vehicle", "2026-09-15T01:00:00Z", "2026-09-15T09:00:00Z", { status: "completed" }),
  booking("past-november", "November history fixture vehicle", "2026-11-10T01:00:00Z", "2026-11-10T09:00:00Z", { status: "completed" }),
];

const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map(), errors = [], mutations = [], checks = [], screenshots = [], held = [];
const cancelled = new Set();
const historyRequests = [], heldHistory = [];
let historyMode = "success";
let sequence = 0, mode = "success", activeRoutes = 0;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const fulfill = (requestId, body, status = 200) => send("Fetch.fulfillRequest", {
  requestId, responseCode: status, responseHeaders: [
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
    if (request.method !== "GET") mutations.push({ path: url.pathname, method: request.method });
    if (url.pathname === "/api/auth/me") return fulfill(requestId, { user: owner });
    if (url.pathname === "/api/owner/bookings") {
      if (url.searchParams.get("view") === "calendar") {
        const start = url.searchParams.get("calendarStart"), end = url.searchParams.get("calendarEnd");
        const cursor = Number(url.searchParams.get("cursor") || 0);
        historyRequests.push({ start, end, cursor });
        const rows = historyBookings.filter(row => row.status === "completed" && new Date(row.pickupAt) < new Date(end) && new Date(row.returnAt) >= new Date(start));
        const page = rows.slice(cursor, cursor + 2), hasMore = cursor + 2 < rows.length;
        const body = { bookings: page, page: { hasMore, nextCursor: hasMore ? String(cursor + 2) : null } };
        if (historyMode === "error") return fulfill(requestId, { message: "Fixture calendar history unavailable" }, 503);
        if (historyMode === "hold") { heldHistory.push({ requestId, body, start }); return; }
        return fulfill(requestId, body);
      }
      if (mode === "hold") { held.push(requestId); return; }
      if (mode === "error") return fulfill(requestId, { message: "Fixture booking service unavailable" }, 503);
      return fulfill(requestId, { bookings, page: { hasMore: false } });
    }
    return fulfill(requestId, { success: true, bookings: [], vehicles: [], notifications: [], conversations: [], unreadCount: 0, stats: {}, summary: {} });
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
    cancelled.add(message.params.requestId);
  } else if (message.method === "Fetch.requestPaused") {
    activeRoutes++;
    route(message.params).catch(async (error) => {
      if (error.message === "Invalid InterceptionId.") {
        await pause(50);
        if (cancelled.has(message.params.networkId)) return;
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
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${expression}`);
}
const preview = "document.querySelector('.rp-calendar-preview[open]')";
const legendButton = "document.querySelector('.rp-dashboard-calendar button[aria-label=\"Calendar legend\"]')";
const legendPanel = `document.getElementById(${legendButton}?.getAttribute('aria-controls'))`;
const dateCell = (day) => `document.querySelector('[data-owner-calendar-date="${day.includes("-") ? day : `2026-10-${day}`}"]')`;
const summaryText = "document.querySelector('.rp-dashboard-calendar').closest('.space-y-5').querySelector('section').innerText";
const historyReady = "document.querySelector('.rp-dashboard-calendar') && !document.querySelector('.rp-dashboard-calendar').textContent.includes('Loading completed bookings')";
const markerColors = (day) => evaluate(`[...${dateCell(day)}.querySelectorAll('div > span')].map(marker=>getComputedStyle(marker).backgroundColor)`);
async function selectDate(day, keyboard = false) {
  await wait(dateCell(day));
  await evaluate(`${dateCell(day)}.scrollIntoView({block:'center',behavior:'instant'}); ${dateCell(day)}.focus({preventScroll:true})`);
  if (keyboard) await key("Enter"); else await evaluate(`${dateCell(day)}.click()`);
  await wait(preview);
}
async function key(value, modifiers = 0) {
  const code = value === " " ? "Space" : value;
  const windowsVirtualKeyCode = { Escape: 27, Tab: 9, Enter: 13, " ": 32 }[value];
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: value, code, modifiers, windowsVirtualKeyCode, ...(value === "Enter" ? { text: "\r" } : value === " " ? { text: " " } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: value, code, modifiers, windowsVirtualKeyCode });
}
async function pointerClick(expression) {
  const point = await evaluate(`(() => {const r=(${expression}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}
async function viewport(width, height = 900) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 640 });
  await pause(80);
}
async function navigate() {
  for (let attempt = 0; activeRoutes && attempt < 160; attempt++) await pause(25);
  await send("Page.navigate", { url: `${base}/owner-dashboard?tab=Dashboard` });
}
async function layout() {
  return evaluate(`(() => {
    const p=${preview},r=p.getBoundingClientRect(),list=p.querySelector('.rp-calendar-preview__list');
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,
      overflow:document.documentElement.scrollWidth>innerWidth,
      contentOverflow:p.scrollWidth>p.clientWidth,
      scrollable:!!list && list.scrollHeight>list.clientHeight,
      modal:p.matches(':modal'),locked:document.body.style.overflow==='hidden'};
  })()`);
}
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-calendar-check-"));
async function screenshot(label) {
  const result = await send("Page.captureScreenshot", { format: "png" });
  const file = path.join(artifacts, `${label}.png`);
  await fs.writeFile(file, Buffer.from(result.data, "base64"));
  screenshots.push(file);
}

try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setTimezoneOverride", { timezoneId: "Asia/Manila" });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `{
    const OriginalDate=Date, now='2026-10-22T04:00:00Z';
    window.Date=class extends OriginalDate {constructor(...args){super(...(args.length?args:[now]))}static now(){return new OriginalDate(now).getTime()}};
  }` });
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await viewport(1440); await navigate(); await send("Page.bringToFront");
  await wait("document.querySelector('.rp-dashboard-calendar')");

  if (process.argv.includes("--baseline")) {
    await evaluate("[...document.querySelectorAll('.rp-dashboard-calendar button')].find(b=>b.querySelector('span')?.textContent.trim()==='22').click()");
    assert.equal(await evaluate(`Boolean(${preview})`), true, "Clicking a date should open its booking preview");
  } else {
    assert.equal(await evaluate("Boolean(document.querySelector('.rp-dashboard-calendar input[type=checkbox]'))"), false, "Completed bookings should display automatically without an include toggle");
    await wait(historyReady);
    assert.equal(await evaluate(`Boolean(${legendButton})`), true, "The calendar toolbar should have a compact Legend disclosure instead of inline labels");
    assert.ok(historyRequests.length >= 2, "Completed history is fetched and fully paginated on the initial dashboard visit");
    await selectDate("22", true);
    await wait(`${preview}.textContent.includes('Same-day fixture vehicle')`);
    const text = await evaluate(`${preview}.innerText`);
    assert.match(text, /5 bookings/);
    assert.match(text, /Pickup.*9:00 AM/); assert.match(text, /Return.*5:00 PM/);
    assert.match(text, /Confirmed/); assert.match(text, /Active rental/);
    assert.match(text, /Completed default fixture vehicle/);
    assert.match(text, /Overdue fixture vehicle/);
    assert.doesNotMatch(text, /Cancelled fixture|Unapproved fixture/);
    assert.equal(await evaluate(`${preview}.querySelectorAll('img').length`), 0);
    assert.equal(await evaluate(`${preview}.contains(document.activeElement)`), true);
    assert.equal(await evaluate(`${dateCell("22")}.getAttribute('aria-expanded')`), "true");
    assert.equal(await evaluate(`${dateCell("22")}.getAttribute('aria-controls') === ${preview}.id`), true);
    assert.equal(await evaluate("document.body.innerText.includes('Schedule for October 22, 2026')"), true);
    await key("Escape"); await wait(`!${preview}`);
    assert.equal(await evaluate(`document.activeElement===${dateCell("22")}`), true);
    checks.push("Automatic completed history, keyboard date selection, both same-day events, booking deduplication, cancellation exclusions, text-only content and Escape focus return");

    const expectedLegend = { Pickup: "rgb(4, 120, 87)", Return: "rgb(194, 65, 12)", "Active rental": "rgb(29, 78, 216)", Completed: "rgb(100, 116, 139)", Overdue: "rgb(185, 28, 28)" };
    assert.equal(await evaluate(`${legendButton}.getAttribute('aria-expanded')`), "false");
    assert.equal(await evaluate(`Boolean(${legendPanel})`), false);
    await evaluate(`${legendButton}.scrollIntoView({block:'center',behavior:'instant'});${legendButton}.focus()`);
    await key("Enter"); await wait(legendPanel);
    assert.equal(await evaluate(`${legendButton}.getAttribute('aria-expanded')`), "true");
    const actualLegend = await evaluate(`Object.fromEntries([...${legendPanel}.querySelectorAll('li')].map(el=>[el.textContent.trim(),getComputedStyle(el.querySelector('span > span')).backgroundColor]))`);
    assert.deepEqual(actualLegend, expectedLegend);
    assert.equal(await evaluate(`${legendPanel}.querySelectorAll('button,input,select,a').length`), 0, "The legend explains colors without filtering or changing bookings");
    await key("Escape"); await wait(`!${legendPanel}`);
    assert.equal(await evaluate(`document.activeElement===${legendButton}`), true);
    await key(" "); await wait(legendPanel);
    await key(" "); await wait(`!${legendPanel}`);
    await pointerClick(legendButton); await wait(legendPanel);
    await pointerClick("document.querySelector('.rp-dashboard-calendar [data-calendar-month]')");
    await wait(`!${legendPanel}`);
    await pointerClick(legendButton); await wait(legendPanel);
    await key("Tab"); await wait(`!${legendPanel}`);
    assert.equal(await evaluate(`document.activeElement===${legendButton}`), false, "Tab continues into the calendar without trapping focus");
    for (const width of [1920, 1440, 1280, 1024, 768, 640, 639, 390, 320]) {
      await viewport(width);
      await evaluate(`${legendButton}.scrollIntoView({block:'center',behavior:'instant'})`);
      const gridTop = await evaluate("document.querySelector('[data-owner-calendar-date]').getBoundingClientRect().top");
      await pointerClick(legendButton); await wait(legendPanel);
      const legendLayout = await evaluate(`(() => {
        const p=${legendPanel},r=p.getBoundingClientRect(),b=${legendButton}.getBoundingClientRect();
        const toolbar=${legendButton}.closest('[data-calendar-toolbar]');
        const controls=[...toolbar.querySelectorAll('button,[data-calendar-month]')].map(el=>el.getBoundingClientRect());
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,position:getComputedStyle(p).position,
          buttonWidth:b.width,buttonHeight:b.height,buttonBottom:b.bottom,
          overflow:document.documentElement.scrollWidth>innerWidth || p.scrollWidth>p.clientWidth,
          overlap:controls.some((a,i)=>controls.slice(i+1).some(c=>Math.min(a.right,c.right)>Math.max(a.left,c.left) && Math.min(a.bottom,c.bottom)>Math.max(a.top,c.top))),
          rows:[...p.children].map(el=>{const row=el.getBoundingClientRect();return {left:row.left,top:row.top,right:row.right,bottom:row.bottom}}),
          gridTop:document.querySelector('[data-owner-calendar-date]').getBoundingClientRect().top,
          visible:p.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),
          locked:document.body.style.overflow==='hidden'};
      })()`);
      assert.equal(legendLayout.overflow, false, `Legend overflow at ${width}`);
      assert.equal(legendLayout.overlap, false, `Toolbar controls overlap at ${width}`);
      assert.ok(legendLayout.left >= 0 && legendLayout.right <= width && legendLayout.top >= 0 && legendLayout.bottom <= 900, `Legend bounds at ${width}: ${JSON.stringify(legendLayout)}`);
      assert.ok(legendLayout.buttonWidth >= 44 && legendLayout.buttonHeight >= 44);
      assert.equal(legendLayout.locked, false);
      assert.equal(legendLayout.visible, true, `Legend must be visible above the calendar at ${width}`);
      assert.ok(legendLayout.rows.every((row,index,rows)=>!index || row.top>=rows[index-1].bottom), "Each legend status has its own aligned row");
      if (width >= 640) {
        assert.equal(legendLayout.position, "absolute");
        assert.ok(Math.abs(legendLayout.gridTop-gridTop)<1, "The desktop dropdown should not move the calendar");
      } else {
        assert.equal(legendLayout.position, "static");
        assert.ok(legendLayout.top >= legendLayout.buttonBottom, "The mobile legend expands below the controls");
      }
      if ([1440,390,320].includes(width)) await screenshot(`legend-${width}`);
      await key("Escape"); await wait(`!${legendPanel}`);
    }
    await viewport(1440);
    await evaluate(`${legendButton}.scrollIntoView({block:'center',behavior:'instant'})`);
    await pointerClick(legendButton); await wait(legendPanel);
    await viewport(390);
    assert.equal(await evaluate(`getComputedStyle(${legendPanel}).position`), "static");
    await viewport(768);
    assert.equal(await evaluate(`getComputedStyle(${legendPanel}).position`), "absolute");
    await key("Escape"); await wait(`!${legendPanel}`);
    await viewport(1440);
    checks.push("Legend disclosure: Enter/Space and pointer toggle, Escape focus return, outside dismissal, natural Tab order, unchanged five colors, nine widths without toolbar overlap, mobile expansion, desktop overlay and live breakpoint changes");
    assert.equal((await markerColors("22"))[0], expectedLegend.Overdue, "Overdue markers take priority over ordinary return markers");
    assert.ok((await markerColors("22")).includes(expectedLegend.Pickup));
    assert.deepEqual(await markerColors("12"), [expectedLegend.Completed, expectedLegend.Completed]);
    assert.deepEqual(await markerColors("25"), [], "An unapproved extension must not create an event on its proposed return date");
    assert.match(await evaluate(`${dateCell("25")}.getAttribute('aria-label')`), /0 bookings/);
    assert.deepEqual(await markerColors("24"), [expectedLegend.Return, expectedLegend.Return], "The approved return dates remain visible while an extension is pending");
    await selectDate("28");
    assert.deepEqual(await markerColors("28"), [expectedLegend["Active rental"]]);
    assert.match(await evaluate(`${preview}.innerText`), /Approved extended fixture vehicle/);
    assert.match(await evaluate(`${preview}.innerText`), /Active rental/);
    assert.match(await evaluate(`${preview}.innerText`), /Status: Extended/);
    assert.doesNotMatch(await evaluate(`${preview}.innerText`), /Extension request/i);
    await key("Escape");
    assert.deepEqual(await markerColors("29"), [expectedLegend.Return]);
    assert.deepEqual(await markerColors("31"), [], "A further pending extension must not change an already extended rental's schedule");
    checks.push("Five-color schedule legend without extension requests, no proposed-date events, unchanged approved returns, blue approved extensions and red overdue priority");

    await selectDate("22");
    await pointerClick(dateCell("25"));
    await wait(`${preview}?.textContent.includes('October 25, 2026')`);
    assert.match(await evaluate(`${preview}.innerText`), /0 bookings/);
    assert.match(await evaluate(`${preview}.innerText`), /No booking events for this date/);
    assert.doesNotMatch(await evaluate(`${preview}.innerText`), /Extension fixture vehicle|Extension request/);
    assert.equal(await evaluate("document.querySelectorAll('.rp-calendar-preview[open]').length"), 1);
    await pointerClick("document.querySelector('header')");
    await wait(`!${preview}`);
    await selectDate("26");
    assert.match(await evaluate(`${preview}.innerText`), /No booking events for this date/);
    await evaluate(`${preview}.querySelector('button[aria-label="Close booking preview"]').click()`);
    await wait(`!${preview}`);
    const extensionReview = "[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Extension Request') && button.textContent.includes('Extension fixture vehicle'))";
    await wait(extensionReview);
    await evaluate(`${extensionReview}.click()`);
    await wait("document.querySelector('[role=dialog][aria-label=\"Review Extension Request\"]')");
    assert.equal(await evaluate("[...document.querySelectorAll('[role=dialog] button')].some(button=>button.textContent.trim()==='Approve Extension')"), true);
    assert.equal(await evaluate("[...document.querySelectorAll('[role=dialog] button')].some(button=>button.textContent.trim()==='Decline Extension')"), true);
    await evaluate("document.querySelector('[role=dialog] button[aria-label=\"Close modal\"]').click()");
    await wait("!document.querySelector('[role=dialog]')");
    checks.push("Switch dates, empty proposed-return preview, outside dismissal, Close button and preserved extension review in Renter Requests");

    await selectDate("23");
    let bounds = await layout();
    assert.equal(bounds.scrollable, true);
    assert.equal(bounds.modal, false); assert.equal(bounds.locked, false);
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.top >= 0 && bounds.bottom <= bounds.height);
    await screenshot("desktop-busy");
    await evaluate(`${preview}.querySelector('.rp-calendar-preview__list').scrollTop=10000`);
    assert.equal(await evaluate(`${preview}.querySelector('.rp-calendar-preview__list').scrollTop>0`), true);
    await key("Escape");
    for (const [day, block, expected] of [["01", "start", "below"], ["31", "end", "above"]]) {
      await evaluate(`${dateCell(day)}.scrollIntoView({block:${JSON.stringify(block)}});${dateCell(day)}.click()`);
      await wait(preview);
      assert.equal(await evaluate(`${preview}.dataset.placement`), expected);
      await key("Escape");
    }
    checks.push("Busy-day internal scrolling, viewport bounds and above/below placement");

    for (const width of [1440, 1024, 768, 640, 639, 390, 320]) {
      await viewport(width); await selectDate("23");
      bounds = await layout();
      assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.top >= 0 && bounds.bottom <= bounds.height, `Preview bounds at ${width}: ${JSON.stringify(bounds)}`);
      assert.equal(bounds.overflow, false, `Page horizontal overflow at ${width}`);
      assert.equal(bounds.contentOverflow, false, `Preview horizontal overflow at ${width}`);
      assert.equal(bounds.modal, width < 640); assert.equal(bounds.locked, width < 640);
      assert.equal(bounds.scrollable, true);
      if (width < 640) {
        assert.ok(Math.abs(bounds.bottom-bounds.height) < 2);
        for (let step = 0; step < 6; step++) {
          await key("Tab");
          assert.equal(await evaluate(`${preview}.contains(document.activeElement)||document.activeElement===document.body`), true);
        }
      }
      const controls = await evaluate(`[...${preview}.querySelectorAll('button')].map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height}))`);
      assert.ok(controls.every(b=>b.width>=44 && b.height>=44));
      if (width === 390) await screenshot("mobile-busy");
      await key("Escape"); await wait(`!${preview}`);
      assert.equal(await evaluate("document.body.style.overflow==='hidden'"), false);
    }
    checks.push("Seven widths from 320 to 1440px, wrapping, mobile focus containment, safe sheet bounds, 44px controls and scroll-lock cleanup");

    await viewport(390); await selectDate("26");
    await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: 10, y: 10 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: 10, y: 10 });
    await wait(`!${preview}`);
    await selectDate("22"); await viewport(768);
    await wait(`${preview} && !${preview}.matches(':modal')`);
    assert.equal(await evaluate("document.body.style.overflow==='hidden'"), false);
    await viewport(390); await wait(`${preview}?.matches(':modal')`);
    await evaluate(`${preview}.querySelector('.rp-calendar-preview__details').click()`);
    await wait("document.querySelector('[role=dialog][aria-label=\"Thursday, October 22, 2026\"]')");
    assert.equal(await evaluate(`Boolean(${preview})`), false);
    await evaluate("document.querySelector('[role=dialog] button[aria-label=\"Close modal\"]').click()");
    await wait("!document.querySelector('[role=dialog]')");
    await viewport(1440); await selectDate("22");
    await evaluate("document.querySelector('button[aria-label=\"Next month\"]').click()");
    await wait(`!${preview}`);
    assert.equal(await evaluate("document.body.innerText.includes('November 2026')"), true);
    await evaluate("[...document.querySelectorAll('.rp-dashboard-calendar button')].find(b=>b.textContent.trim()==='Today').click()");
    assert.equal(await evaluate(`Boolean(${preview})`), false);
    checks.push("Mobile backdrop dismissal, live breakpoint changes, existing full day details, month navigation and Today");

    mode = "error"; await navigate();
    await wait("document.body.innerText.includes('Fixture booking service unavailable')");
    await selectDate("22");
    assert.match(await evaluate(`${preview}.innerText`), /unavailable|could not/i);
    assert.doesNotMatch(await evaluate(`${preview}.innerText`), /No booking events/);
    await key("Escape");
    mode = "hold"; await navigate();
    await wait("document.querySelector('[role=status]') && !document.querySelector('.rp-dashboard-calendar')");
    assert.equal(await evaluate(`Boolean(${preview})`), false);
    mode = "success";
    for (let attempt = 0; held.length < 2 && attempt < 100; attempt++) await pause(50);
    await Promise.all(held.splice(0).map(id=>fulfill(id,{bookings,page:{hasMore:false}})));
    await wait("document.querySelector('.rp-dashboard-calendar')");
    await wait(historyReady);
    await selectDate("22");
    assert.match(await evaluate(`${preview}.innerText`), /5 bookings/);
    checks.push("Existing loading gate, API-error state distinct from an empty date, and recovery");

    await key("Escape");
    const originalSummary = await evaluate(summaryText);
    historyMode = "hold";
    await navigate();
    await wait("document.querySelector('.rp-dashboard-calendar').textContent.includes('Loading completed bookings')");
    await selectDate("12");
    assert.match(await evaluate(`${preview}.innerText`), /Loading booking events/);
    assert.doesNotMatch(await evaluate(`${preview}.innerText`), /No booking events/);
    await wait("document.querySelector('.rp-calendar-preview')");
    for (let attempt = 0; !heldHistory.length && attempt < 100; attempt++) await pause(25);
    assert.ok(heldHistory.length);
    historyMode = "success";
    await Promise.all(heldHistory.splice(0).map(item=>fulfill(item.requestId,item.body)));
    await wait("!document.querySelector('.rp-dashboard-calendar').textContent.includes('Loading completed bookings')");
    assert.match(await evaluate(`${preview}.innerText`), /2 bookings/);
    assert.match(await evaluate(`${preview}.innerText`), /Completed history fixture vehicle/);
    assert.match(await evaluate(`${preview}.innerText`), /Completed stale-request fixture vehicle/);
    assert.match(await evaluate(`${preview}.innerText`), /Completed rental/);
    assert.doesNotMatch(await evaluate(`${preview}.innerText`), /Extension request|Cancellation request|Overdue/i);
    assert.equal(await evaluate(summaryText), originalSummary);
    assert.ok(historyRequests.some(item=>item.cursor===2), "Every history page is requested");
    assert.ok(historyRequests.every(item=>new Date(item.end)-new Date(item.start)<=43*86400000));
    assert.equal(historyRequests[0].start, "2026-09-27T16:00:00.000Z");
    assert.equal(historyRequests[0].end, "2026-10-31T16:00:00.000Z");
    await evaluate(`${preview}.querySelector('.rp-calendar-preview__details').click()`);
    await wait("document.querySelector('[role=dialog][aria-label=\"Monday, October 12, 2026\"]')");
    assert.equal(await evaluate("[...document.querySelectorAll('[role=dialog] button')].some(b=>/Approve|Decline|Reject/.test(b.textContent))"), false);
    assert.equal(await evaluate("document.querySelector('[role=dialog]').textContent.includes('This vehicle is overdue')"), false);
    await evaluate("document.querySelector('[role=dialog] button[aria-label=\"Close modal\"]').click()");
    await selectDate("14");
    assert.match(await evaluate(`${preview}.innerText`), /Return.*5:00 PM/);
    await key("Escape"); await selectDate("01");
    assert.match(await evaluate(`${preview}.innerText`), /Completed cross-month fixture/);
    await key("Escape"); await selectDate("25");
    assert.doesNotMatch(await evaluate(`${preview}.innerText`), /Completed stale-request fixture/);
    checks.push("Default month-scoped history, all pages, loading without false empty states, unchanged totals, completed labels, original rental dates and read-only legacy records");

    await key("Escape");
    historyMode = "hold";
    await evaluate("document.querySelector('button[aria-label=\"Previous month\"]').click()");
    for (let attempt=0; !heldHistory.length && attempt<100; attempt++) await pause(25);
    assert.equal(heldHistory.length,1);
    const staleSeptember = heldHistory.shift();
    await evaluate("document.querySelector('button[aria-label=\"Next month\"]').click()");
    for (let attempt=0; !heldHistory.length && attempt<100; attempt++) await pause(25);
    assert.equal(heldHistory.length,1);
    const currentOctober = heldHistory.shift();
    historyMode = "success";
    await fulfill(currentOctober.requestId,currentOctober.body);
    await wait("!document.querySelector('.rp-dashboard-calendar').textContent.includes('Loading completed bookings')");
    await fulfill(staleSeptember.requestId,staleSeptember.body);
    await pause(80); await selectDate("12");
    assert.match(await evaluate(`${preview}.innerText`), /Completed history fixture vehicle/);
    await key("Escape");
    historyMode = "error";
    await evaluate("document.querySelector('button[aria-label=\"Next month\"]').click()");
    await wait("document.querySelector('.rp-dashboard-calendar [role=alert]')");
    await selectDate("2026-11-10");
    assert.match(await evaluate(`${preview}.innerText`), /Completed bookings could not be loaded/);
    assert.doesNotMatch(await evaluate(`${preview}.innerText`), /No booking events/);
    await key("Escape"); historyMode = "success";
    await evaluate("document.querySelector('.rp-dashboard-calendar [role=alert] button').click()");
    await wait("!document.querySelector('.rp-dashboard-calendar [role=alert]') && !document.querySelector('.rp-dashboard-calendar').textContent.includes('Loading completed bookings')");
    await selectDate("2026-11-10");
    assert.match(await evaluate(`${preview}.innerText`), /November history fixture/);
    await key("Escape");
    await evaluate("document.querySelector('button[aria-label=\"Previous month\"]').click()");
    await wait("!document.querySelector('.rp-dashboard-calendar').textContent.includes('Loading completed bookings')");
    for (const width of [1440,768,390,320]) {
      await viewport(width); await selectDate("12");
      const bounds = await layout();
      assert.ok(bounds.left>=0 && bounds.right<=bounds.width && bounds.top>=0 && bounds.bottom<=bounds.height);
      assert.equal(bounds.overflow,false);
      assert.equal(bounds.modal,width<640);
      if(width===1440 || width===390) await screenshot(`completed-${width}`);
      await key("Escape");
      assert.equal(await evaluate("Boolean(document.querySelector('.rp-dashboard-calendar input[type=checkbox]'))"),false);
    }
    await selectDate("26");
    assert.match(await evaluate(`${preview}.innerText`),/No booking events for this date/);
    assert.equal(await evaluate(summaryText),originalSummary);
    checks.push("Month navigation races, history failure and Retry, responsive completed previews without a toggle, empty dates and unchanged operational summary");
    assert.deepEqual(mutations, [], "Calendar preview must not write booking or payment data");
    assert.deepEqual(errors, [], "No browser runtime or interception errors");
    console.log(JSON.stringify({ checks, screenshots, mutations: mutations.length, runtimeErrors: errors.length }, null, 2));
  }
} catch (error) {
  if (!process.argv.includes("--baseline")) {
    await screenshot("failure").catch(()=>{});
    console.error(JSON.stringify({ checks, errors, screenshots, diagnostics: await evaluate(`({active:document.activeElement?.outerHTML?.slice(0,500),preview:document.querySelector('.rp-calendar-preview')?.outerHTML?.slice(0,500),date:document.querySelector('[data-owner-calendar-date="2026-10-22"]')?.getBoundingClientRect().toJSON()})`).catch(()=>null) }, null, 2));
  }
  throw error;
} finally {
  await send("Page.close").catch(()=>{});
  ws.close();
}
