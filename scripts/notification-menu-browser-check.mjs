// Isolated API fixtures only; no live notification or account mutations.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = process.env.RESPONSIVE_BASE_URL || "http://127.0.0.1:4189";
const cdp = process.env.RESPONSIVE_CDP_URL || "http://127.0.0.1:9249";
const hoverOnly = process.env.NOTIFICATION_HOVER_ONLY === "1";
const output = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-notification-menu-"));
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map(), checks = [], failures = [], errors = [], mutations = [];
let sequence = 0, assertions = 0, role = "user", notifications = [], readBehavior = "normal", bulkBehavior = "normal";
const pendingReads = [];
const pendingReadAll = [];
const pendingBulks = [];
const user = { _id: "507f1f77bcf86cd799439011", name: "Fixture User", email: "user@example.test", isVerified: true, kycStatus: "approved" };
const initialNotifications = () => Array.from({ length: 8 }, (_, index) => ({
  _id: `507f1f77bcf86cd79943903${index}`, title: `Booking update ${index + 1}`,
  message: index === 5 ? `Review your booking.\nReference: ${"A".repeat(120)}` : "Review your booking.", createdAt: new Date().toISOString(),
  readAt: index === 1 || index === 6 ? null : new Date().toISOString(), archivedAt: index >= 6 ? new Date().toISOString() : null,
  ...(index === 3 ? { event: "verification.document_rejected" } : index === 4 ? {
    event: "late_return.processed", data: { isOverdue: true, feeStatus: "final", lateReturnPenaltyFee: 150, remainingBalance: 150, vehicleName: "Fixture vehicle" },
  } : {}),
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
    { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,PUT,DELETE,OPTIONS" },
  ], body: Buffer.from(JSON.stringify(body)).toString("base64"),
});
async function fulfillBulk({ requestId, ids, action, archived }, behavior = "normal") {
  if (behavior === "fail") return fulfill(requestId, { message: "Bulk update failed." }, 503);
  const selected = notifications.filter(item => ids.includes(item._id) && Boolean(item.archivedAt) === archived);
  if (selected.length !== ids.length || (action === "bulk-delete" && !archived && selected.some(item => !item.readAt))) {
    return fulfill(requestId, { message: "Selected notifications are unavailable." }, 409);
  }
  const processedIds = behavior === "partial" ? ids.slice(0, 1) : ids;
  if (action === "bulk-archive") {
    for (const item of notifications) if (processedIds.includes(item._id)) item.archivedAt = new Date().toISOString();
  } else notifications = notifications.filter(item => !processedIds.includes(item._id));
  return fulfill(requestId, { success: processedIds.length === ids.length, processedIds, failedIds: ids.filter(id => !processedIds.includes(id)) });
}
async function fulfillReadAll({ requestId, ids }) {
  let modifiedCount = 0;
  for (const notification of notifications) {
    if (!notification.archivedAt && !notification.readAt && (!ids.length || ids.includes(notification._id))) {
      notification.readAt = new Date().toISOString();
      modifiedCount++;
    }
  }
  return fulfill(requestId, { success: true, modifiedCount });
}
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (url.pathname.includes("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    const endpoint = url.pathname.slice(url.pathname.indexOf("/api/") + 4);
    if (["/auth/me", "/auth/profile"].includes(endpoint)) return fulfill(requestId, { user: { ...user, role } });
    if (endpoint === "/kyc/me") return fulfill(requestId, { status: "approved", verification: {
      accountStatus: "active", emailVerified: true, bookingEligible: true, listingEligible: role === "owner", documents: [],
    } });
    if (request.method === "GET" && endpoint === "/notifications") {
      const list = notifications.filter(item => Boolean(item.archivedAt) === (url.searchParams.get("archived") === "true"));
      const limit = Math.min(100, Number(url.searchParams.get("limit") || 100));
      const offset = Number((url.searchParams.get("cursor") || "offset:0").split(":")[1]);
      const hasMore = list.length > offset + limit;
      return fulfill(requestId, { notifications: list.slice(offset, offset + limit), pagination: { hasMore, nextCursor: hasMore ? `offset:${offset + limit}` : null } });
    }
    if ((request.method === "PATCH" && endpoint === "/notifications/bulk/archive") || (request.method === "DELETE" && endpoint === "/notifications/bulk")) {
      const { ids, archived = false } = JSON.parse(request.postData || "{}");
      const action = endpoint.endsWith("archive") ? "bulk-archive" : "bulk-delete";
      const operation = { requestId, ids, archived, action };
      mutations.push({ method: request.method, action, ids, archived });
      if (bulkBehavior === "hold") { pendingBulks.push(operation); return; }
      return fulfillBulk(operation, bulkBehavior);
    }
    if (request.method === "PATCH" && endpoint === "/notifications/read-all") {
      const { ids = [] } = JSON.parse(request.postData || "{}");
      mutations.push({ method: request.method, action: "read-all", ids });
      if (readBehavior === "fail") return fulfill(requestId, { message: "Failed to mark selected notifications as read." }, 503);
      if (readBehavior === "hold") { pendingReadAll.push({ requestId, ids }); return; }
      return fulfillReadAll({ requestId, ids });
    }
    const match = endpoint.match(/^\/notifications\/([^/]+)(?:\/(read|archive|restore))?$/);
    if (match && request.method !== "GET") {
      const [, id, action] = match;
      const notification = notifications.find(item => item._id === id);
      mutations.push({ method: request.method, id, action: action || "delete" });
      if (action === "read" && readBehavior === "hold") {
        pendingReads.push({ requestId, id });
        return;
      }
      if (action === "read" && readBehavior === "fail") return fulfill(requestId, { message: "Failed to update notification." }, 503);
      if (action === "read") notification.readAt = new Date().toISOString();
      if (action === "archive") notification.archivedAt = new Date().toISOString();
      if (action === "restore") notification.archivedAt = null;
      if (!action && request.method === "DELETE") notifications = notifications.filter(item => item._id !== id);
      return fulfill(requestId, { success: true, notification });
    }
    if (request.method !== "GET") return fulfill(requestId, { message: "Unexpected mutation blocked by layout fixture." }, 503);
    return fulfill(requestId, { notifications: [], vehicles: [], bookings: [], conversations: [], renters: [], unreadCount: 0, stats: {}, summary: {} });
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
  throw Error(`Timeout: ${expression}; ${await evaluate("document.body.innerText.slice(0,300)")}`);
}
const expect = (condition, message) => { assertions += 1; if (!condition) failures.push(message); };
async function viewport(width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 1024 });
  await pause(100);
}
async function open(pageRole, extra = 0) {
  role = pageRole;
  readBehavior = "normal";
  bulkBehavior = "normal";
  notifications = [...initialNotifications(), ...Array.from({ length: extra }, (_, index) => ({
    _id: (100 + index).toString(16).padStart(24, "0"), title: `Additional notification ${index + 1}`, message: "Pagination fixture.", createdAt: new Date().toISOString(), readAt: new Date().toISOString(), archivedAt: null,
  }))];
  await send("Page.navigate", { url: "about:blank" });
  await send("Storage.clearDataForOrigin", { origin: base, storageTypes: "all" });
  await send("Page.navigate", { url: base + (role === "owner" ? "/owner-dashboard?tab=Notifications" : "/notifications") });
  await wait(`document.querySelectorAll('article button[aria-haspopup="dialog"]').length===${Math.min(6 + extra, pageRole === "owner" ? 100 : 30)} && !document.querySelector('[aria-label="Loading page"]')`);
  await evaluate("document.fonts.ready");
}
async function click(expression) {
  await wait(`(${expression})?.getBoundingClientRect().height>0`);
  await evaluate(`(${expression}).scrollIntoView({block:'nearest',behavior:'instant'})`);
  await pause(60);
  const point = await evaluate(`(() => { const e=${expression}, r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    if(!e.contains(document.elementFromPoint(x,y))) throw Error('Click target is covered: '+(e.getAttribute('aria-label')||e.textContent.trim())+' by '+document.elementFromPoint(x,y)?.outerHTML.slice(0,350));
    return {x,y}; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}
const menuAction = label => `[...document.querySelectorAll('[role=menuitem]')].find(item=>item.textContent.trim()===${JSON.stringify(label)})`;
const detailsTrigger = index => `document.querySelectorAll('article button[aria-haspopup="dialog"]')[${index}]`;
const detailsDialog = "document.querySelector('[aria-labelledby=notification-details-title]')";
const pageButton = label => `[...document.querySelectorAll('button')].find(button=>(button.getAttribute('aria-label') || button.textContent.trim())===${JSON.stringify(label)})`;
const rowCheck = index => `document.querySelectorAll('article input[type=checkbox]')[${index}]`;
const bulkDialog = "document.querySelector('[role=alertdialog]')";
const confirmButton = "document.querySelector('[role=alertdialog] button.rp-btn-primary')";
async function selectRows(indices) {
  for (const index of indices) await click(rowCheck(index));
}
async function selectChoice(label) {
  await click(pageButton("Selection options"));
  await wait("document.querySelector('[role=menu][aria-label=\"Select notifications\"]')");
  await click(menuAction(label));
  await wait("!document.querySelector('[role=menu][aria-label=\"Select notifications\"]')");
}
const popupPanel = "document.querySelector('[aria-label=\"Close notifications modal\"]')?.closest('.rp-modal-panel')";
const popupTrigger = index => `(${popupPanel})?.querySelectorAll('article button[aria-haspopup="dialog"]')[${index}]`;
async function showPopup(width, expectedCount = 7) {
  if (width < 1024) {
    await click("document.querySelector('button[aria-label=\"Open menu\"]')");
    await click("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Notifications' && button.getBoundingClientRect().height>0)");
  } else {
    await click("document.querySelector('button[aria-label=Notifications]')");
  }
  await wait(`${popupPanel}?.querySelectorAll('article').length===${expectedCount}`);
}
async function openPopup(width) {
  role = "user";
  readBehavior = "normal";
  const ago = hours => new Date(Date.now() - hours * 3600000).toISOString();
  notifications = [...initialNotifications(),
    { _id: "507f1f77bcf86cd799439039", title: "Yesterday unread", message: "An unread notification from yesterday.", createdAt: ago(30), readAt: null },
    { _id: "507f1f77bcf86cd79943903a", title: "Yesterday read", message: "Excluded older read notification.", createdAt: ago(30), readAt: ago(29) },
    { _id: "507f1f77bcf86cd79943903b", title: "Expired unread", message: "Excluded old notification.", createdAt: ago(60), readAt: null },
    { _id: "507f1f77bcf86cd79943903c", title: "Future notification", message: "Excluded future notification.", createdAt: ago(-1), readAt: null },
  ];
  await send("Page.navigate", { url: "about:blank" });
  await send("Storage.clearDataForOrigin", { origin: base, storageTypes: "all" });
  await send("Page.navigate", { url: base + "/" });
  await showPopup(width);
}
async function escape() {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait("!document.querySelector('[role=menu]')");
}
async function press(key, code, keyCode, modifiers = 0) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, modifiers });
  if (key === "Enter" || key === " ") {
    const text = key === "Enter" ? "\r" : " ";
    await send("Input.dispatchKeyEvent", { type: "char", key, text, unmodifiedText: text, modifiers });
  }
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, modifiers });
}
async function completePendingRead(readExpression = "[...document.querySelectorAll('article')[1].querySelectorAll('span')].some(span=>span.textContent.trim()==='read')") {
  const deadline = Date.now() + 5000;
  while (!pendingReads.length && Date.now() < deadline) await pause(30);
  assert.equal(pendingReads.length, 1, "Expected one pending read request");
  const { requestId, id } = pendingReads.shift();
  const notification = notifications.find(item => item._id === id);
  notification.readAt = new Date().toISOString();
  await fulfill(requestId, { success: true, notification });
  await wait(readExpression);
}
async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(path.join(output, `${name}.png`), Buffer.from(shot.data, "base64"));
}
try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  for (const pageRole of process.env.NOTIFICATION_POPUP_ONLY || process.env.NOTIFICATION_BULK_ONLY ? [] : process.env.NOTIFICATION_REPRO_ONLY ? ["user"] : ["user", "owner"]) {
    for (const width of process.env.NOTIFICATION_REPRO_ONLY ? [1440] : [320,390,768,1440]) {
      await viewport(width, 1000); await open(pageRole);
      assert.equal(await evaluate("document.querySelectorAll('article button[aria-haspopup=dialog]').length"), 6, "Each notification body must directly open its details");
      expect(await evaluate("document.documentElement.scrollWidth<=innerWidth && document.body.scrollWidth<=innerWidth"), `${pageRole}/${width}: long notification text must not cause horizontal overflow`);
      const hoverPoint = await evaluate("(() => {const r=document.querySelector('article').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()");
      const beforeHover = mutations.length;
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverPoint });
      expect(await evaluate("(() => {const card=document.querySelector('article'),style=getComputedStyle(card);return style.outlineStyle==='solid' && style.outlineWidth==='2px' && style.outlineColor==='rgb(1, 127, 230)' && getComputedStyle(card.querySelector('button[aria-haspopup=dialog]')).backgroundColor==='rgba(0, 0, 0, 0)'})()"), "Hover must outline the whole notification card in blue without highlighting its inner button");
      expect(await evaluate("[...document.querySelectorAll('article')].slice(1).every(card=>getComputedStyle(card).outlineStyle==='none')"), "Hover must not outline other notification cards");
      if (width === 390 || width === 1440) await screenshot(`${pageRole}-${width}-hover`);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
      expect(await evaluate("getComputedStyle(document.querySelector('article')).outlineStyle==='none'"), "The blue outline must clear when the pointer leaves");
      expect(mutations.length === beforeHover, "Hovering must not change read status or mutate notifications");
      checks.push({ label: `${pageRole}/${width}/card-hover-outline` });
      if (hoverOnly) continue;
      const beforeDetails = mutations.length;
      await click(detailsTrigger(0));
      await wait(`${detailsDialog}?.open`);
      expect(await evaluate(`${detailsDialog}.textContent.includes('Booking update 1')`), "The selected notification details must be shown");
      expect(await evaluate("(() => { const panel=document.querySelector('.rp-modal-panel'),r=panel.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth+1 && r.top>=0 && r.bottom<=innerHeight+1 && panel.scrollWidth<=panel.clientWidth; })()"), "The notification details panel must fit the viewport");
      expect(mutations.length === beforeDetails, "Opening a read notification must not send another read request");
      if (width === 390 || width === 1440) await screenshot(`${pageRole}-${width}-details`);
      await escape();
      await wait(`!${detailsDialog}`);
      expect(await evaluate(`document.activeElement===${detailsTrigger(0)}`), "Closing details must restore focus to the notification");
      checks.push({ label: `${pageRole}/${width}/click-details` });

      for (const [key, code, keyCode] of [["Enter", "Enter", 13], [" ", "Space", 32]]) {
        await evaluate(`${detailsTrigger(0)}.focus()`);
        await press(key, code, keyCode);
        await wait(`${detailsDialog}?.open`);
        expect(await evaluate("document.activeElement.id==='notification-details-title'"), "Opening details must focus its heading");
        expect(await evaluate("Boolean(document.querySelector('dialog:modal'))"), "Notification details must make the background inert");
        await press("Tab", "Tab", 9, 8);
        expect(await evaluate(`document.activeElement===${detailsDialog}.querySelector('footer').lastElementChild`), "Shift+Tab from the heading must focus the last dialog control");
        await press("Tab", "Tab", 9);
        expect(await evaluate("document.activeElement===document.querySelector('.rp-modal-panel [aria-label=\"Close notification details\"]')"), "Tab from the last control must wrap to the first dialog control");
        await press("Tab", "Tab", 9, 8);
        expect(await evaluate(`document.activeElement===${detailsDialog}.querySelector('footer').lastElementChild`), "Shift+Tab from the first control must wrap to the last");
        await escape();
        await wait(`!${detailsDialog}`);
        expect(await evaluate(`document.activeElement===${detailsTrigger(0)}`), "Escape must return focus to the notification");
      }
      expect(await evaluate(`getComputedStyle(${detailsTrigger(0)}).outlineStyle!=='none' && parseFloat(getComputedStyle(${detailsTrigger(0)}).outlineWidth)>=2`), "The notification must have a visible keyboard focus indicator");
      expect(await evaluate(`getComputedStyle(${detailsTrigger(0)}).cursor==='pointer'`), "The notification body must indicate it is clickable");
      checks.push({ label: `${pageRole}/${width}/keyboard-details` });

      if (width === 390) {
        readBehavior = "hold";
        await click(detailsTrigger(1));
        await wait(`${detailsDialog}?.open`);
        expect(await evaluate(`${detailsDialog}.textContent.includes('Booking update 2')`), "Unread details must open before the read request completes");
        expect(await evaluate("[...document.querySelectorAll('article')[1].querySelectorAll('span')].some(span=>span.textContent.trim()==='unread')"), "A pending read request must not falsely mark the notification as read");
        await completePendingRead();
        expect(await evaluate("document.activeElement.id==='notification-details-title'"), "A read response must not reset dialog focus");
        expect(await evaluate(`${detailsDialog}.textContent.includes('Booking update 2')`), "A read response must preserve the selected details");
        await escape(); await wait(`!${detailsDialog}`);

        await open(pageRole);
        readBehavior = "hold";
        await click(detailsTrigger(1)); await wait(`${detailsDialog}?.open`);
        await escape(); await wait(`!${detailsDialog}`);
        await click(detailsTrigger(2)); await wait(`${detailsDialog}?.open`);
        await completePendingRead();
        expect(await evaluate(`${detailsDialog}.textContent.includes('Booking update 3') && !${detailsDialog}.textContent.includes('Booking update 2')`), "A late read response must not replace another notification's details");
        await escape(); await wait(`!${detailsDialog}`);

        await open(pageRole);
        readBehavior = "hold";
        await click(detailsTrigger(1)); await wait(`${detailsDialog}?.open`);
        await escape(); await wait(`!${detailsDialog}`);
        await completePendingRead();
        expect(await evaluate(`!${detailsDialog}`), "A late read response must not reopen closed details");
        checks.push({ label: `${pageRole}/${width}/delayed-read-and-selection` });

        await open(pageRole);
        readBehavior = "fail";
        await click(detailsTrigger(1)); await wait(`${detailsDialog}?.open`);
        await wait("document.body.textContent.includes('Failed to update notification.')");
        expect(await evaluate(`${detailsDialog}.textContent.includes('Booking update 2')`), "Read-update failures must leave the full details available");
        await escape(); await wait(`!${detailsDialog}`);
        expect(await evaluate("[...document.querySelectorAll('article')[1].querySelectorAll('span')].some(span=>span.textContent.trim()==='unread')"), "Read-update failures must preserve unread status");
        checks.push({ label: `${pageRole}/${width}/failed-read` });
        await open(pageRole);
      }

      expect(await evaluate("!document.querySelector('article [aria-label=\"Notification actions\"]') && !document.querySelector('article [aria-haspopup=menu]')"), "Notification rows must not show three-dot menus");
      if (width === 1440 || width === 390) await screenshot(`${pageRole}-${width}`);
      if (process.env.NOTIFICATION_REPRO_ONLY) continue;

      await click(rowCheck(1)); await click(pageButton("Mark selected as read"));
      await wait("[...document.querySelectorAll('article')[1].querySelectorAll('span')].some(span=>span.textContent.trim()==='read')");
      expect(mutations.at(-1)?.ids?.[0] === "507f1f77bcf86cd799439031" && mutations.at(-1)?.action === "read-all", "The toolbar must mark only the selected notification as read");
      expect(await evaluate(`!${detailsDialog}`), "Mark as read must not open details");
      await selectChoice("None");

      await click(pageButton("Selection options"));
      await click(detailsTrigger(2)); await wait(`${detailsDialog}?.open`);
      expect(await evaluate("!document.querySelector('[role=menu]')"), "Opening details must dismiss the selection menu");
      await escape(); await wait(`!${detailsDialog}`);

      await click(rowCheck(0));
      const beforeArchive = mutations.length;
      await click(pageButton("Archive selected")); await wait(`${bulkDialog}?.open`);
      expect(mutations.length === beforeArchive, "Single-item toolbar archiving must still wait for confirmation");
      await click(confirmButton); await wait("document.querySelectorAll('article').length===5");
      expect(mutations.at(-1)?.ids?.[0] === "507f1f77bcf86cd799439030" && mutations.at(-1)?.action === "bulk-archive", "The toolbar must archive the selected notification");
      expect(await evaluate(`!${detailsDialog}`), "Archiving must not open details");
      await click(pageButton("View archive"));
      await wait("document.querySelectorAll('article button[aria-haspopup=dialog]').length===3");
      expect(await evaluate("!document.querySelector('article [aria-label=\"Notification actions\"]') && document.querySelectorAll('article [aria-label=\"Restore notification\"]').length===3"), "Archived rows must provide direct restore icons without three-dot menus");
      const beforeArchivedDetails = mutations.length;
      await click(detailsTrigger(1)); await wait(`${detailsDialog}?.open`);
      expect(mutations.length === beforeArchivedDetails, "Opening archived details must not mark the notification as read");
      await escape(); await wait(`!${detailsDialog}`);
      if (width === 1440 || width === 390) await screenshot(`${pageRole}-${width}-archive`);
      await click("document.querySelector('article [aria-label=\"Restore notification\"]')");
      await wait("document.querySelectorAll('article').length===2");
      expect(mutations.at(-1)?.id === "507f1f77bcf86cd799439030" && mutations.at(-1)?.action === "restore", "The restore icon must restore only its own archived notification");
      expect(await evaluate(`!${detailsDialog}`), "Restoring must not open details");

      await click(rowCheck(0));
      const beforeDelete = mutations.length;
      await click(pageButton("Delete selected")); await wait(`${bulkDialog}?.open`);
      expect(mutations.length === beforeDelete && await evaluate(`${bulkDialog}.textContent.includes('Delete 1 notification?')`), "Single-item toolbar deletion must show its confirmation");
      expect(await evaluate(`!${detailsDialog}`), "Delete must only open its confirmation");
      await click("[...document.querySelectorAll('[role=alertdialog] button')].find(button=>button.textContent.trim()==='Cancel')");
      await wait(`!${bulkDialog}`);
      expect(mutations.length === beforeDelete, "Cancel must preserve the notification");
      await click(pageButton("Delete selected")); await wait(`${bulkDialog}?.open`);
      await click(confirmButton);
      await wait(`document.querySelectorAll('article').length===1 && !${bulkDialog}`);
      expect(mutations.at(-1)?.ids?.[0] === "507f1f77bcf86cd799439036" && mutations.at(-1)?.action === "bulk-delete", "Confirmed deletion must update only the selected notification");
      expect(await evaluate("document.documentElement.scrollWidth<=innerWidth && document.body.scrollWidth<=innerWidth"), `${pageRole}/${width}: horizontal overflow`);
      checks.push({ label: `${pageRole}/${width}/toolbar-actions-and-direct-restore` });
    }
    if (!process.env.NOTIFICATION_REPRO_ONLY && !hoverOnly) {
      await open(pageRole);
      await click(detailsTrigger(4)); await wait(`${detailsDialog}?.open`);
      expect(await evaluate(`${detailsDialog}.textContent.includes('Late-return Fee') && ${detailsDialog}.textContent.includes('150.00') && ${detailsDialog}.textContent.includes('Fixture vehicle')`), "Full late-return and payment details must be preserved");
      expect(await evaluate(`${detailsDialog}.textContent.includes('View Booking & Payment')`) === (pageRole === "user"), "Booking and payment navigation must preserve its existing role boundary");
      if (pageRole === "user") {
        await click("[...document.querySelectorAll('.rp-modal-panel footer button')].find(button=>button.textContent.trim()==='View Booking & Payment')");
        await wait("location.pathname==='/bookings' || location.pathname==='/booking-history'");
        await wait("document.querySelector('[aria-label=\"Booking views\"] button[aria-pressed=\"true\"]')?.textContent.trim()==='Unsettled'");
        expect(await evaluate("document.querySelector('[aria-label=\"Booking views\"] button[aria-pressed=\"true\"]').textContent.trim()==='Unsettled'"), "Final-fee navigation must still select unsettled bookings");
      } else {
        await escape(); await wait(`!${detailsDialog}`);
      }
      await open(pageRole);
      await click(detailsTrigger(3)); await wait(`${detailsDialog}?.open`);
      const verificationHref = pageRole === "owner" ? "/owner-dashboard?tab=Profile#verification-status" : "/account-settings#verification-status";
      expect(await evaluate(`${detailsDialog}.querySelector('a')?.getAttribute('href')`) === verificationHref, "Verification details must retain the role-specific status link");
      expect(await evaluate(`!${detailsDialog}.textContent.includes('View Booking')`), "Verification details must not link to booking or payment actions");
      await click(`${detailsDialog}.querySelector('a')`);
      await wait(`location.pathname+location.search+location.hash===${JSON.stringify(verificationHref)}`);
      checks.push({ label: `${pageRole}/related-navigation` });

      await open(pageRole);
      await click(detailsTrigger(5)); await wait(`${detailsDialog}?.open`);
      expect(await evaluate(`${detailsDialog}.textContent.includes(${JSON.stringify("A".repeat(120))})`), "Long notification messages must be available in full");
      expect(await evaluate("document.querySelector('.rp-modal-panel').scrollWidth<=document.querySelector('.rp-modal-panel').clientWidth"), "Long details must wrap inside the dialog");
      expect(await evaluate("document.elementFromPoint(2,2)?.classList.contains('rp-modal-backdrop')"), "The backdrop must remain available outside the details panel");
      await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: 2, y: 2 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: 2, y: 2 });
      await wait(`!${detailsDialog}`);
      expect(await evaluate(`document.activeElement===${detailsTrigger(5)}`), "Backdrop dismissal must return focus to the notification");
      checks.push({ label: `${pageRole}/long-details-and-backdrop` });
    }
  }
  if (!process.env.NOTIFICATION_REPRO_ONLY && !process.env.NOTIFICATION_BULK_ONLY && !hoverOnly) for (const width of [320,390,768,1440]) {
    await viewport(width, 1000); await openPopup(width);
    assert.equal(await evaluate(`(${popupPanel}).querySelectorAll('article button[aria-haspopup=dialog]').length`), 7, "Each Today popup notification must directly open its full details");
    expect(await evaluate(`!(${popupPanel}).textContent.includes('Yesterday read') && !(${popupPanel}).textContent.includes('Expired unread') && !(${popupPanel}).textContent.includes('Future notification')`), "The popup must preserve its existing age and read-status filter");
    expect(await evaluate("document.documentElement.scrollWidth<=innerWidth && document.body.scrollWidth<=innerWidth"), "Long popup notification text must not overflow horizontally");
    if (width === 390 || width === 1440) await screenshot(`popup-${width}`);
    const beforeDetails = mutations.length;
    await click(popupTrigger(0)); await wait(`${detailsDialog}?.open`);
    expect(await evaluate(`${detailsDialog}.textContent.includes('Booking update 1')`), "The popup must open the selected notification's full details");
    expect(mutations.length === beforeDetails, "Opening a read popup notification must not change its read status");
    expect(await evaluate("location.pathname==='/'"), "Opening popup details must not navigate to View all");
    if (width === 390 || width === 1440) await screenshot(`popup-${width}-details`);
    await escape(); await wait(`!${detailsDialog}`);
    expect(await evaluate(`document.activeElement===${popupTrigger(0)}`), "Closing details must return focus to the popup notification");
    expect(await evaluate("document.body.style.overflow==='hidden'"), "Closing details must keep the popup's scroll lock");

    for (const [key, code, keyCode] of [["Enter", "Enter", 13], [" ", "Space", 32]]) {
      await evaluate(`(${popupTrigger(0)}).focus()`);
      await press(key, code, keyCode); await wait(`${detailsDialog}?.open`);
      expect(await evaluate("document.activeElement.id==='notification-details-title'"), "Popup details must move keyboard focus into the dialog");
      await escape(); await wait(`!${detailsDialog}`);
      expect(await evaluate(`document.activeElement===${popupTrigger(0)}`), "Keyboard dismissal must return focus to the popup item");
    }
    expect(await evaluate(`getComputedStyle(${popupTrigger(0)}).outlineStyle!=='none' && parseFloat(getComputedStyle(${popupTrigger(0)}).outlineWidth)>=2`), "Popup notifications must have a visible keyboard focus indicator");

    const beforeRead = mutations.length;
    if (width === 390) readBehavior = "hold";
    await click(popupTrigger(1)); await wait(`${detailsDialog}?.open`);
    expect(await evaluate(`${detailsDialog}.textContent.includes('Booking update 2')`), "Unread popup details must be shown immediately");
    const popupRead = `(${popupTrigger(1)})?.textContent.trim().endsWith('read') && !(${popupTrigger(1)})?.textContent.trim().endsWith('unread')`;
    if (width === 390) await completePendingRead(popupRead); else await wait(popupRead);
    readBehavior = "normal";
    expect(mutations.length === beforeRead + 1 && mutations.at(-1)?.action === "read" && mutations.at(-1)?.id === "507f1f77bcf86cd799439031", "Opening a popup item must mark only that notification as read");
    await escape(); await wait(`!${detailsDialog}`);

    await click(popupTrigger(6)); await wait(`${detailsDialog}?.open`);
    await wait(`(${popupPanel}).querySelectorAll('article').length===6`);
    expect(await evaluate(`${detailsDialog}.textContent.includes('Yesterday unread')`), "Older unread details must stay open after their row leaves the recent list");
    await escape(); await wait(`!${detailsDialog}`);
    await wait("document.activeElement.id==='renter-notifications-title'");
    expect(await evaluate("document.activeElement.id==='renter-notifications-title'"), "Removed popup rows must return focus to the popup heading");
    checks.push({ label: `popup/${width}/individual-details` });
    await click("document.querySelector('[aria-label=\"Close notifications modal\"]')");
    await wait(`!${popupPanel}`);
    expect(await evaluate("document.body.style.overflow!=='hidden'"), "Closing the popup must restore scrolling");
    await showPopup(width, 6);
    expect(await evaluate(`!${detailsDialog}`), "Reopening the popup must not reopen previously selected details");

    await openPopup(width);
    const beforeBulk = mutations.length;
    await click(`[...(${popupPanel}).querySelectorAll('button')].find(button=>button.textContent.trim()==='Mark all as read')`);
    await wait(`(${popupPanel}).querySelectorAll('article').length===6`);
    expect(mutations.length === beforeBulk + 1 && mutations.at(-1)?.action === "read-all", "The existing bulk-read button must remain available");
    assert.deepEqual(mutations.at(-1).ids.sort(), ["507f1f77bcf86cd799439031", "507f1f77bcf86cd799439039"], "Bulk read must remain limited to the popup's unread notifications");
    expect(await evaluate(`!${detailsDialog}`), "Bulk read must not open individual details");
    await click(`[...(${popupPanel}).querySelectorAll('button')].find(button=>button.textContent.trim()==='View all')`);
    await wait(`location.pathname==='/notifications' && !${popupPanel}`);
    expect(await evaluate("document.body.style.overflow!=='hidden'"), "View all must close the popup and restore scrolling");
    checks.push({ label: `popup/${width}/bulk-and-view-all` });
  }
  if (!process.env.NOTIFICATION_REPRO_ONLY && !process.env.NOTIFICATION_BULK_ONLY && !hoverOnly) {
    await viewport(390, 1000); await openPopup(390);
    readBehavior = "fail";
    await click(popupTrigger(1)); await wait(`${detailsDialog}?.open`);
    await wait(`(${popupPanel}).textContent.includes('Failed to update notification.')`);
    expect(await evaluate(`${detailsDialog}.textContent.includes('Booking update 2')`), "A failed read update must keep popup details available");
    await escape(); await wait(`!${detailsDialog}`);
    expect(await evaluate(`(${popupTrigger(1)}).textContent.trim().endsWith('unread')`), "A failed read update must preserve the popup item's unread status");

    await openPopup(390); readBehavior = "hold";
    await click(popupTrigger(1)); await wait(`${detailsDialog}?.open`);
    await escape(); await wait(`!${detailsDialog}`);
    await click(popupTrigger(2)); await wait(`${detailsDialog}?.open`);
    await completePendingRead(`!(${popupTrigger(1)}).textContent.trim().endsWith('unread')`);
    expect(await evaluate(`${detailsDialog}.textContent.includes('Booking update 3') && !${detailsDialog}.textContent.includes('Booking update 2')`), "A late read response must not replace another popup item's details");
    await escape(); await wait(`!${detailsDialog}`);
    await openPopup(390); readBehavior = "hold";
    await click(popupTrigger(1)); await wait(`${detailsDialog}?.open`);
    await escape(); await wait(`!${detailsDialog}`);
    await completePendingRead(`!(${popupTrigger(1)}).textContent.trim().endsWith('unread')`);
    expect(await evaluate(`!${detailsDialog}`), "A late read response must not reopen closed popup details");
    checks.push({ label: "popup/read-errors-and-delayed-responses" });

    await openPopup(390);
    await click(popupTrigger(4)); await wait(`${detailsDialog}?.open`);
    expect(await evaluate(`${detailsDialog}.textContent.includes('Late-return Fee') && ${detailsDialog}.textContent.includes('150.00')`), "The popup must show the existing full payment details");
    await click("[...document.querySelectorAll('.rp-modal-panel footer button')].find(button=>button.textContent.trim()==='View Booking & Payment')");
    await wait("location.pathname==='/bookings' && document.querySelector('[aria-label=\"Booking views\"] button[aria-pressed=\"true\"]')?.textContent.trim()==='Unsettled'");
    expect(await evaluate(`!${detailsDialog} && !${popupPanel} && document.body.style.overflow!=='hidden'`), "Booking navigation must close both dialogs and restore scrolling");
    await openPopup(390);
    await click(popupTrigger(3)); await wait(`${detailsDialog}?.open`);
    await click(`${detailsDialog}.querySelector('a')`);
    await wait("location.pathname==='/account-settings' && location.hash==='#verification-status'");
    checks.push({ label: "popup/booking-and-verification-navigation" });
  }
  if (!process.env.NOTIFICATION_REPRO_ONLY && !process.env.NOTIFICATION_POPUP_ONLY && !hoverOnly) {
    for (const pageRole of ["user", "owner"]) for (const width of process.env.NOTIFICATION_BULK_WIDTH ? [Number(process.env.NOTIFICATION_BULK_WIDTH)] : [320,390,768,1440]) {
      await viewport(width, 1000); await open(pageRole);
      expect(await evaluate(`!${pageButton("Select notifications")} && document.querySelectorAll('article input[type=checkbox]').length===6`), "Both roles must show row checkboxes without a separate selection button");
      expect(await evaluate("!!document.querySelector('[aria-label=\"Notification selection\"]').closest('.rp-page-header, .rp-owner-page-header')"), "Bulk controls must occupy the existing page header instead of a separate panel");
      expect(await evaluate(`!${pageButton("Delete All")}`), "Delete All must be replaced by selection-based actions");
      const beforeSelection = mutations.length;
      expect(await evaluate(`(() => {const group=document.querySelector('[aria-label="Notification selection controls"]'),checkbox=group.querySelector('input[type=checkbox]'),arrow=${pageButton("Selection options")};return group.contains(arrow) && Math.abs(checkbox.parentElement.getBoundingClientRect().right-arrow.getBoundingClientRect().left)<=2})()`), "The checkbox and dropdown arrow must form one attached control");
      expect(await evaluate(`(() => {const group=document.querySelector('[aria-label="Notification selection controls"]'),checkbox=group.querySelector('input'),arrow=${pageButton("Selection options")};return group.getBoundingClientRect().width<=56 && checkbox.getBoundingClientRect().width===18 && arrow.querySelector('svg path').getAttribute('d')==='M0 0h10L5 6Z'})()`), "The Gmail-style selection control must use an 18px square and a compact solid triangle");
      await click(pageButton("Selection options"));
      expect(await evaluate("(() => {const control=document.querySelector('[aria-label=\"Notification selection controls\"]').getBoundingClientRect(),menu=document.querySelector('[role=menu][aria-label=\"Select notifications\"]').getBoundingClientRect();return Math.abs(control.left-menu.left)<=1 && menu.top>=control.bottom && menu.right<=innerWidth})()"), "The dropdown must open below and align with the joined checkbox control");
      if (width === 390 || width === 1440) await screenshot(`bulk-${pageRole}-${width}-selection-menu`);
      await click("document.querySelector('h1')");
      await wait("!document.querySelector('[role=menu]')");
      await selectChoice("Read");
      expect(await evaluate("document.querySelectorAll('article input:checked').length===5 && !document.querySelectorAll('article input[type=checkbox]')[1].checked"), "Read selection must select only displayed read notifications");
      await selectChoice("Unread");
      expect(await evaluate("document.querySelectorAll('article input:checked').length===1 && document.querySelectorAll('article input[type=checkbox]')[1].checked"), "Unread selection must replace the selection with displayed unread notifications");
      await selectChoice("All");
      expect(await evaluate("document.querySelectorAll('article input:checked').length===6"), "All must select only the displayed view");
      await selectChoice("None");
      expect(mutations.length === beforeSelection, "Selection dropdown choices must not mutate notifications");
      expect(await evaluate("[...document.querySelectorAll('.rp-floating-alert')].every(alert=>getComputedStyle(alert).pointerEvents==='none')"), "Notification floating alerts must allow clicks through to underlying controls");
      expect(await evaluate(`!${pageButton("Archive selected")} && !${pageButton("Delete selected")} && !!${pageButton("Mark all as read")}`), "Empty selections must show the normal header controls without bulk actions");
      await evaluate(`${pageButton("Selection options")}.focus()`); await press("ArrowDown", "ArrowDown", 40);
      await wait("document.querySelector('[role=menu][aria-label=\"Select notifications\"]')");
      expect(await evaluate("document.activeElement.textContent.trim()==='All'"), "The dropdown must open from the keyboard and focus its first option");
      await press("End", "End", 35);
      expect(await evaluate("document.activeElement.textContent.trim()==='Unread'"), "Dropdown keyboard navigation must reach its last option");
      await press("Escape", "Escape", 27);
      expect(await evaluate(`!document.querySelector('[role=menu]') && document.activeElement===${pageButton("Selection options")}`), "Escape must close the selection menu and restore focus");
      await evaluate(`${rowCheck(0)}.focus()`); await press(" ", "Space", 32);
      expect(await evaluate(`getComputedStyle(${rowCheck(0)}).outlineStyle!=='none' && parseFloat(getComputedStyle(${rowCheck(0)}).outlineWidth)>=2`), "Row checkboxes must support keyboard selection with a visible focus indicator");
      expect(await evaluate(`!!${pageButton("Archive selected")} && !${pageButton("Mark all as read")}`), "Checking a row must immediately replace the read-all control with bulk actions");
      await selectChoice("None");
      expect(await evaluate(`document.querySelectorAll('article input:checked').length===0 && !${pageButton("Delete selected")} && !!${pageButton("Mark all as read")}`), "Clearing must keep checkboxes visible and restore the normal header controls");
      expect(await evaluate(`document.activeElement===${pageButton("Selection options")}`), "None must return focus to the persistent dropdown trigger");
      await click(rowCheck(0));
      expect(await evaluate("document.querySelector('input[aria-label=\"Select all displayed\"]').indeterminate"), "Select all must reflect a partial selection");
      await click(rowCheck(1));
      expect(await evaluate(`${pageButton("Delete selected")}.disabled && document.body.textContent.includes('Read selected notifications before deleting them.')`), "Unread active selections must prevent deletion with an explanation");
      expect(mutations.length === beforeSelection && await evaluate(`!${detailsDialog}`), "Checkboxes must not open details or mark notifications as read");
      await click(rowCheck(1)); await click(rowCheck(2));
      expect(await evaluate("document.documentElement.scrollWidth<=innerWidth && document.body.scrollWidth<=innerWidth && [...document.querySelector('[aria-label=\"Notification selection\"]').querySelectorAll('button')].every(button=>{const bounds=button.getBoundingClientRect();return bounds.left>=0 && bounds.right<=innerWidth+1})"), `${pageRole}/${width}: selected header actions must stay within the viewport`);
      expect(await evaluate("[...document.querySelector('[aria-label=\"Notification selection\"]').querySelectorAll('button')].every(button=>button.querySelector('svg') && button.getAttribute('aria-label') && !button.textContent.trim())"), "Toolbar buttons must use icons with accessible names instead of visible word labels");
      await evaluate(`${pageButton("Archive selected")}.focus()`);
      await wait("[...document.querySelectorAll('[role=tooltip]')].some(tooltip=>tooltip.textContent.trim()==='Archive')");
      await press("Escape", "Escape", 27);
      expect(await evaluate(`!document.querySelector('[role=tooltip]') && document.activeElement===${pageButton("Archive selected")}`), "Keyboard tooltips must dismiss with Escape without moving focus");
      for (const [label, text] of [["Archive selected", "Archive"], ["Delete selected", "Delete"], ["Mark selected as read", "Mark as read"], ["View archive", "View archive"]]) {
        const point = await evaluate(`(() => {const r=${pageButton(label)}.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
        await wait(`[...document.querySelectorAll('[role=tooltip]')].some(tooltip=>tooltip.textContent.trim()===${JSON.stringify(text)})`);
        expect(await evaluate("document.querySelectorAll('[role=tooltip]').length===1"), "Moving between toolbar icons must show only the current tooltip");
        expect(await evaluate(`(() => {const tooltip=[...document.querySelectorAll('[role=tooltip]')].find(tooltip=>tooltip.textContent.trim()===${JSON.stringify(text)}),r=tooltip.getBoundingClientRect();return r.top>=${point.y}+10 && r.left>=0 && r.right<=innerWidth && tooltip.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})()`), `${label}: hover labels must appear below the cursor without clipping or covering`);
        if (label === "View archive" && (width === 390 || width === 1440)) await screenshot(`bulk-${pageRole}-${width}-tooltip`);
      }
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
      await wait("!document.querySelector('[role=tooltip]')");
      await click(detailsTrigger(0)); await wait(`${detailsDialog}?.open`);
      await escape(); await wait(`!${detailsDialog}`);
      expect(await evaluate("document.querySelectorAll('article input:checked').length===2"), "Opening details must preserve the checkbox selection");
      if (width === 390 || width === 1440) await screenshot(`bulk-${pageRole}-${width}-selection`);
      await click(pageButton("Archive selected")); await wait(`${bulkDialog}?.open`);
      expect(await evaluate(`${bulkDialog}.textContent.includes('Archive 2 notifications?') && document.activeElement.textContent.trim()==='Cancel'`), "Archive confirmation must show the count and default focus to Cancel");
      expect(mutations.length === beforeSelection, "No archive request may be sent before confirmation");
      if (width === 390 || width === 1440) await screenshot(`bulk-${pageRole}-${width}-archive`);
      await escape(); await wait(`!${bulkDialog}`);
      expect(await evaluate(`document.activeElement===${pageButton("Archive selected")}`), "Canceling confirmation must restore focus to its action");
      await click(pageButton("Delete selected")); await wait(`${bulkDialog}?.open`);
      expect(await evaluate(`${bulkDialog}.textContent.includes('Delete 2 notifications?') && ${bulkDialog}.textContent.includes('cannot be undone')`), "Delete confirmation must show its count and permanent effect");
      if (width === 390 || width === 1440) await screenshot(`bulk-${pageRole}-${width}-delete`);
      await click("[...document.querySelectorAll('[role=alertdialog] button')].find(button=>button.textContent.trim()==='Cancel')");
      await wait(`!${bulkDialog}`);
      expect(mutations.length === beforeSelection, "Cancel must preserve all selected notifications");
      await click(pageButton("Delete selected")); await wait(`${bulkDialog}?.open`);
      if (width === 390) {
        bulkBehavior = "hold";
        await evaluate(`(${confirmButton}).click(); (${confirmButton}).click()`);
        const deadline = Date.now() + 5000;
        while (!pendingBulks.length && Date.now() < deadline) await pause(30);
        assert.equal(pendingBulks.length, 1, "Duplicate confirmation clicks must send only one batch request");
        await press("Escape", "Escape", 27);
        expect(await evaluate(`${bulkDialog}?.open && ${bulkDialog}.getAttribute('aria-busy')==='true'`), "The processing dialog must stay open and prevent dismissal");
        await fulfillBulk(pendingBulks.shift()); bulkBehavior = "normal";
      } else await click(confirmButton);
      await wait(`document.querySelectorAll('article').length===4 && !${bulkDialog}`);
      assert.deepEqual(mutations.at(-1).ids, ["507f1f77bcf86cd799439030", "507f1f77bcf86cd799439032"], "Bulk delete must send only the selected IDs");
      expect(mutations.at(-1).action === "bulk-delete" && mutations.at(-1).archived === false, "Active deletion must explicitly identify its view");
      expect(notifications.find(item => item._id === "507f1f77bcf86cd799439031")?.readAt === null, "Unselected unread notifications must stay untouched");
      expect(await evaluate("document.querySelectorAll('article input[type=checkbox]').length===4 && document.querySelectorAll('article input:checked').length===0 && document.body.textContent.includes('2 notifications deleted.')"), "Successful bulk deletion must clear the selection, keep checkboxes available, and report its actual count");

      await selectRows([0, 1]);
      await click(pageButton("Archive selected")); await wait(`${bulkDialog}?.open`);
      await click(confirmButton);
      await wait(`document.querySelectorAll('article').length===2 && !${bulkDialog}`);
      expect(mutations.at(-1).action === "bulk-archive", "Selected notifications must be archived with one batch request");
      expect(notifications.find(item => item._id === "507f1f77bcf86cd799439031")?.readAt === null, "Archiving must preserve unread status");
      await click(pageButton("View archive"));
      await wait("document.querySelectorAll('article').length===4");
      await selectRows([0]);
      expect(await evaluate(`!${pageButton("Archive selected")}`), "The archived view must not offer archiving again");
      await click(pageButton("View active notifications"));
      await wait("document.querySelectorAll('article').length===2 && document.querySelectorAll('article input:checked').length===0");
      await click(pageButton("View archive")); await wait("document.querySelectorAll('article').length===4");
      expect(await evaluate("document.querySelectorAll('article input:checked').length===0"), "Changing views must clear the old selection");
      await click("document.querySelector('input[aria-label=\"Select all displayed\"]')");
      expect(await evaluate("document.querySelectorAll('article input:checked').length===4 && !document.querySelector('input[aria-label=\"Select all displayed\"]').indeterminate"), "Select all displayed must select only the currently loaded view");
      await click("document.querySelector('input[aria-label=\"Select all displayed\"]')");
      expect(await evaluate("document.querySelectorAll('article input:checked').length===0"), "Select all must support deselecting the displayed items");
      await click(rowCheck(0)); await click(rowCheck(1));
      expect(await evaluate(`!${pageButton("Delete selected")}.disabled`), "Archived unread notifications must remain eligible for deletion");
      await click(pageButton("Delete selected")); await wait(`${bulkDialog}?.open`);
      await click(confirmButton);
      await wait(`document.querySelectorAll('article').length===2 && !${bulkDialog}`);
      expect(mutations.at(-1).archived === true && mutations.at(-1).ids.length === 2, "Archived deletion must target only the selected archived IDs");
      expect(await evaluate("document.documentElement.scrollWidth<=innerWidth && document.body.scrollWidth<=innerWidth"), `${pageRole}/${width}: bulk controls must not cause horizontal overflow`);
      checks.push({ label: `bulk/${pageRole}/${width}/selection-confirmation-and-views` });

      if (width === 390) {
        await open(pageRole); await selectRows([0, 1]); readBehavior = "fail";
        await click(pageButton("Mark selected as read"));
        await wait("[...document.querySelectorAll('.rp-floating-alert')].some(alert=>alert.textContent.includes('Failed to mark selected notifications as read.'))");
        expect(await evaluate(`document.querySelectorAll('article input:checked').length===2 && ${pageButton("Delete selected")}.disabled`), "Read failures must preserve the selection and unread deletion restriction");
        readBehavior = "hold";
        await evaluate(`(${pageButton("Mark selected as read")}).click(); (${pageButton("Mark selected as read")}).click()`);
        const readDeadline = Date.now() + 5000;
        while (!pendingReadAll.length && Date.now() < readDeadline) await pause(30);
        assert.equal(pendingReadAll.length, 1, "Repeated selected-read clicks must send one request");
        expect(await evaluate(`${pageButton("Archive selected")}.disabled && ${pageButton("Selection options")}.disabled`), "Pending selected-read updates must block conflicting toolbar actions");
        await fulfillReadAll(pendingReadAll.shift()); readBehavior = "normal";
        await wait(`!${pageButton("Delete selected")}.disabled && ${pageButton("Mark selected as read")}.disabled`);
        assert.deepEqual(mutations.at(-1).ids, ["507f1f77bcf86cd799439031"], "Selected-read must send only selected unread IDs, never an empty all-read request");
        expect(notifications.find(item => item._id === "507f1f77bcf86cd799439036")?.readAt === null, "Selected-read must leave unselected archived unread notifications unchanged");
        expect(await evaluate("document.querySelectorAll('article input:checked').length===2 && [...document.querySelectorAll('.rp-floating-alert')].some(alert=>alert.textContent.includes('1 notification marked as read.'))"), "Selected-read must retain the selection and show a truthful floating success alert");
        await wait("![...document.querySelectorAll('.rp-floating-alert')].some(alert=>alert.textContent.includes('1 notification marked as read.'))");
        checks.push({ label: `bulk/${pageRole}/selected-read-errors-success-and-alert-expiry` });

        await open(pageRole); await selectRows([0, 2]); bulkBehavior = "fail";
        await click(pageButton("Archive selected")); await wait(`${bulkDialog}?.open`);
        await click(confirmButton); await wait(`${bulkDialog}.textContent.includes('Bulk update failed.')`);
        expect(await evaluate("document.querySelectorAll('article').length===6 && document.querySelectorAll('article input:checked').length===2"), "A failed batch must retain the list and selection");
        await click("[...document.querySelectorAll('[role=alertdialog] button')].find(button=>button.textContent.trim()==='Cancel')");
        await wait(`!${bulkDialog}`); bulkBehavior = "partial";
        await click(pageButton("Archive selected")); await wait(`${bulkDialog}?.open`);
        await click(confirmButton);
        await wait(`${bulkDialog}.textContent.includes('1 completed; 1 could not be updated') && document.querySelectorAll('article').length===5`);
        expect(await evaluate("document.querySelectorAll('article input:checked').length===1"), "Partial success must retain only unsuccessful selections");
        bulkBehavior = "normal"; await click(confirmButton);
        await wait(`!${bulkDialog} && document.querySelectorAll('article').length===4`);
        assert.deepEqual(mutations.at(-1).ids, ["507f1f77bcf86cd799439032"], "Retry must target only the unsuccessful ID");
        checks.push({ label: `bulk/${pageRole}/failure-and-partial-retry` });
      }
      if (width === 1440) {
        await open(pageRole); await selectRows([0]);
        const incoming = { _id: "507f1f77bcf86cd799439099", title: "Incoming notification", message: "Realtime fixture.", createdAt: new Date().toISOString(), readAt: null, archivedAt: null };
        notifications.unshift(incoming);
        await evaluate(`import('/src/utils/socket.js').then(({getSocket})=>getSocket().listeners('notification:new').forEach(listener=>listener(${JSON.stringify(incoming)})))`);
        await wait("document.querySelectorAll('article').length===7");
        expect(await evaluate(`!(${rowCheck(0)}).checked && document.querySelectorAll('article input:checked').length===1`), "Incoming notifications must not become selected automatically");
        await click(pageButton("Archive selected")); await wait(`${bulkDialog}?.open`);
        await click(confirmButton); await wait(`!${bulkDialog}`);
        assert.deepEqual(mutations.at(-1).ids, ["507f1f77bcf86cd799439030"], "Realtime insertions must not change the selected target");
        checks.push({ label: `bulk/${pageRole}/realtime-selection` });
      }
    }
    await open("user", 95);
    await click("document.querySelector('input[aria-label=\"Select all displayed\"]')");
    expect(await evaluate("document.querySelectorAll('article input:checked').length===30"), "Renter select-all must cover only the loaded cursor page");
    for (const count of [60,90,101]) {
      await click(pageButton("Load more")); await wait(`document.querySelectorAll('article').length===${count}`);
      expect(await evaluate("document.querySelectorAll('article input:checked').length===30"), "Loading more must not select additional notifications automatically");
    }
    expect(await evaluate("document.querySelector('input[aria-label=\"Select all displayed\"]').disabled"), "Select all must not silently exceed the 100-item limit");
    await evaluate("[...document.querySelectorAll('article input[type=checkbox]')].filter(input=>!input.checked).forEach(input=>input.click())");
    expect(await evaluate("document.querySelectorAll('article input:checked').length===100 && [...document.querySelectorAll('article input[type=checkbox]')].filter(input=>!input.checked).every(input=>input.disabled)"), "Individual selection must enforce the 100-item limit");
    await click(pageButton("Selection options"));
    expect(await evaluate(`${menuAction("All")}.disabled && !${menuAction("None")}.disabled`), "Over-limit menu selections must be disabled while None remains available");
    await click(menuAction("None"));
    expect(await evaluate(`document.querySelectorAll('article input:checked').length===0 && document.activeElement===${pageButton("Selection options")}`), "Clearing a selection beyond the select-all limit must retain focus in the header");
    checks.push({ label: "bulk/pagination-and-selection-limit" });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
} finally {
  await fs.writeFile(path.join(output,"results.json"),JSON.stringify({checks,assertions,failures,errors,mutations},null,2));
  console.log(JSON.stringify({checks:checks.length,assertions,failures,errors,output},null,2));
  await send("Page.close").catch(()=>{}); ws.close();
}
