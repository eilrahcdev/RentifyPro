// Isolated API fixtures only; no live notification or account mutations.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = process.env.RESPONSIVE_BASE_URL || "http://127.0.0.1:4189";
const cdp = process.env.RESPONSIVE_CDP_URL || "http://127.0.0.1:9249";
const output = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-notification-menu-"));
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map(), checks = [], failures = [], errors = [], mutations = [];
let sequence = 0, assertions = 0, role = "user", notifications = [], readBehavior = "normal";
const pendingReads = [];
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
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (url.pathname.includes("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    const endpoint = url.pathname.slice(url.pathname.indexOf("/api/") + 4);
    if (["/auth/me", "/auth/profile"].includes(endpoint)) return fulfill(requestId, { user: { ...user, role } });
    if (endpoint === "/kyc/me") return fulfill(requestId, { status: "approved", verification: {
      accountStatus: "active", emailVerified: true, bookingEligible: true, listingEligible: role === "owner", documents: [],
    } });
    if (request.method === "GET" && endpoint === "/notifications") return fulfill(requestId, {
      notifications: notifications.filter(item => Boolean(item.archivedAt) === (url.searchParams.get("archived") === "true")),
      pagination: { hasMore: false },
    });
    if (request.method === "PATCH" && endpoint === "/notifications/read-all") {
      const { ids = [] } = JSON.parse(request.postData || "{}");
      mutations.push({ method: request.method, action: "read-all", ids });
      for (const notification of notifications) {
        if (!ids.length || ids.includes(notification._id)) notification.readAt = new Date().toISOString();
      }
      return fulfill(requestId, { success: true });
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
async function open(pageRole) {
  role = pageRole;
  readBehavior = "normal";
  notifications = initialNotifications();
  await send("Page.navigate", { url: "about:blank" });
  await send("Storage.clearDataForOrigin", { origin: base, storageTypes: "all" });
  await send("Page.navigate", { url: base + (role === "owner" ? "/owner-dashboard?tab=Notifications" : "/notifications") });
  await wait("document.querySelectorAll('article button[aria-label=\"Notification actions\"]').length===6 && !document.querySelector('[aria-label=\"Loading page\"]')");
  await evaluate("document.fonts.ready");
}
async function click(expression) {
  await wait(`(${expression})?.getBoundingClientRect().height>0`);
  await evaluate(`(${expression}).scrollIntoView({block:'nearest',behavior:'instant'})`);
  await pause(60);
  const point = await evaluate(`(() => { const e=${expression}, r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    if(!e.contains(document.elementFromPoint(x,y))) throw Error('Click target is covered: '+e.textContent.trim());
    return {x,y}; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}
const menuAction = label => `[...document.querySelectorAll('[role=menuitem]')].find(item=>item.textContent.trim()===${JSON.stringify(label)})`;
const trigger = index => `document.querySelectorAll('article button[aria-label="Notification actions"]')[${index}]`;
const detailsTrigger = index => `document.querySelectorAll('article button[aria-haspopup="dialog"]')[${index}]`;
const detailsDialog = "document.querySelector('[aria-labelledby=notification-details-title]')";
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
const assertMenuVisible = async label => {
  const result = await evaluate(`(() => { const menu=document.querySelector('[role=menu]'),m=menu.getBoundingClientRect();
    const card=menu.closest('article'),c=card.getBoundingClientRect(),next=card.nextElementSibling?.getBoundingClientRect();
    return {menu:{top:m.top,bottom:m.bottom},card:{top:c.top,bottom:c.bottom},
      overlapsNext:Boolean(next&&m.bottom>next.top),
      outside:m.left<0||m.right>innerWidth||m.top<0||m.bottom>innerHeight,
      blocked:[...menu.querySelectorAll('button')].filter(button=>{const r=button.getBoundingClientRect();
        return !button.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}).map(button=>button.textContent.trim())}; })()`);
  expect(result.overlapsNext, `${label}: fixture must overlap the following card`);
  expect(!result.outside && result.blocked.length === 0, `${label}: menu covered or clipped: ${JSON.stringify(result)}`);
  checks.push({ label, ...result });
};
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
  for (const pageRole of process.env.NOTIFICATION_POPUP_ONLY ? [] : process.env.NOTIFICATION_REPRO_ONLY ? ["user"] : ["user", "owner"]) {
    for (const width of process.env.NOTIFICATION_REPRO_ONLY ? [1440] : [320,390,768,1440]) {
      await viewport(width, 1000); await open(pageRole);
      assert.equal(await evaluate("document.querySelectorAll('article button[aria-haspopup=dialog]').length"), 6, "Each notification body must directly open its details");
      expect(await evaluate("document.documentElement.scrollWidth<=innerWidth && document.body.scrollWidth<=innerWidth"), `${pageRole}/${width}: long notification text must not cause horizontal overflow`);
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

      await click(trigger(0));
      await wait("document.querySelector('[role=menu]')");
      expect(await evaluate("![...document.querySelectorAll('[role=menuitem]')].some(item=>item.textContent.trim()==='View details')"), "View details must be removed from the action menu");
      expect(await evaluate(`!${detailsDialog}`), "Opening the action menu must not open details");
      await assertMenuVisible(`${pageRole}/${width}/read`);
      if (width === 1440 || width === 390) await screenshot(`${pageRole}-${width}`);
      await escape();
      expect(await evaluate("document.querySelector('article button[aria-expanded]').getAttribute('aria-expanded')==='false'"), "Escape must close the menu");
      if (process.env.NOTIFICATION_REPRO_ONLY) continue;

      await click(trigger(1)); await wait("document.querySelector('[role=menu]')");
      await assertMenuVisible(`${pageRole}/${width}/unread`);
      await click(menuAction("Mark as read"));
      await wait("[...document.querySelectorAll('article')[1].querySelectorAll('span')].some(span=>span.textContent.trim()==='read') && !document.querySelector('[role=menu]')");
      expect(mutations.at(-1)?.id === "507f1f77bcf86cd799439031" && mutations.at(-1)?.action === "read", "Mark as read must update the selected notification");
      expect(await evaluate(`!${detailsDialog}`), "Mark as read must not open details");

      await click(detailsTrigger(0));
      await wait("document.querySelector('[aria-labelledby=notification-details-title]')");
      await click("document.querySelector('.rp-modal-panel [aria-label=\"Close notification details\"]')");
      await wait("!document.querySelector('[aria-labelledby=notification-details-title]')");

      await click(trigger(0)); await wait("document.querySelector('[role=menu]')");
      await click(detailsTrigger(2));
      await wait("!document.querySelector('[role=menu]')");
      await wait(`${detailsDialog}?.open`);
      await click("document.querySelector('.rp-modal-panel [aria-label=\"Close notification details\"]')");
      await wait(`!${detailsDialog}`);

      await click(trigger(0)); await wait("document.querySelector('[role=menu]')");
      await click(trigger(3)); await wait("document.querySelectorAll('[role=menu]').length===1 && document.querySelectorAll('article')[3].querySelector('[role=menu]')");
      await escape();

      await click(trigger(0)); await wait("document.querySelector('[role=menu]')");
      await click(menuAction("Archive"));
      await wait("document.querySelectorAll('article').length===5");
      expect(mutations.at(-1)?.id === "507f1f77bcf86cd799439030" && mutations.at(-1)?.action === "archive", "Archive must update the selected notification");
      expect(await evaluate(`!${detailsDialog}`), "Archiving must not open details");
      await click("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Archive' && !button.closest('[role=menu]'))");
      await wait("document.querySelectorAll('article button[aria-label=\"Notification actions\"]').length===3");
      const beforeArchivedDetails = mutations.length;
      await click(detailsTrigger(1)); await wait(`${detailsDialog}?.open`);
      expect(mutations.length === beforeArchivedDetails, "Opening archived details must not mark the notification as read");
      await click("[...document.querySelectorAll('.rp-modal-panel footer button')].find(button=>button.textContent.trim()==='Close')");
      await wait(`!${detailsDialog}`);
      await click(trigger(0)); await wait("document.querySelector('[role=menu]')");
      await assertMenuVisible(`${pageRole}/${width}/archived`);
      await click(menuAction("Restore"));
      await wait("document.querySelectorAll('article').length===2");
      expect(mutations.at(-1)?.id === "507f1f77bcf86cd799439030" && mutations.at(-1)?.action === "restore", "Restore must update the selected notification");
      expect(await evaluate(`!${detailsDialog}`), "Restoring must not open details");
      await click(trigger(0)); await wait("document.querySelector('[role=menu]')");
      const beforeDelete = mutations.length;
      await click(menuAction("Delete"));
      await wait("document.body.innerText.includes('Confirm Action')");
      expect(mutations.length === beforeDelete, "Delete must wait for confirmation");
      expect(await evaluate(`!${detailsDialog}`), "Delete must only open the existing confirmation");
      await click("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Cancel' && button.getBoundingClientRect().height>0)");
      await wait("!document.body.innerText.includes('Confirm Action')");
      expect(mutations.length === beforeDelete, "Cancel must preserve the notification");
      await click(trigger(0)); await wait("document.querySelector('[role=menu]')");
      await click(menuAction("Delete"));
      await wait("document.body.innerText.includes('Confirm Action')");
      await click("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='OK' && button.getBoundingClientRect().height>0)");
      await wait("document.querySelectorAll('article').length===1 && !document.body.innerText.includes('Confirm Action')");
      expect(mutations.at(-1)?.id === "507f1f77bcf86cd799439036" && mutations.at(-1)?.action === "delete", "Confirmed Delete must update only the selected notification");
      expect(await evaluate("document.documentElement.scrollWidth<=innerWidth && document.body.scrollWidth<=innerWidth"), `${pageRole}/${width}: horizontal overflow`);
      checks.push({ label: `${pageRole}/${width}/actions-and-dismissal` });
    }
    if (!process.env.NOTIFICATION_REPRO_ONLY) {
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
  if (!process.env.NOTIFICATION_REPRO_ONLY) for (const width of [320,390,768,1440]) {
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
  if (!process.env.NOTIFICATION_REPRO_ONLY) {
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
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
} finally {
  await fs.writeFile(path.join(output,"results.json"),JSON.stringify({checks,assertions,failures,errors,mutations},null,2));
  console.log(JSON.stringify({checks:checks.length,assertions,failures,errors,output},null,2));
  await send("Page.close").catch(()=>{}); ws.close();
}
