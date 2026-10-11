// Run Vite on 4176 and isolated Chrome with CDP on 9236.
// Real UI components use stubbed APIs; HTTP and socket service traffic is blocked.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = "http://127.0.0.1:4176";
const fixtureDirectory = fileURLToPath(new URL("../frontend/.vite/", import.meta.url));
const name = `button-consistency-${process.pid}`;
const files = [path.join(fixtureDirectory, `${name}.html`), path.join(fixtureDirectory, `${name}.jsx`)];
const output = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-buttons-"));
const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import BookingAccessModal from "../src/components/BookingAccessModal";
import ChatWidget from "../src/components/ChatWidget";
import Topbar from "../src/owner/components/Topbar";
import Analytics from "../src/owner/pages/Analytics";
import Sidebar from "../src/owner/components/Sidebar";
import { AdminSidebar } from "../src/admin/components/AdminShell";
import API from "../src/utils/api";
import { setSessionUser } from "../src/utils/sessionStore";
import { setSessionOwnerProfile } from "../src/utils/sessionStore";
import "../src/index.css";
import "../src/responsive.css";
setSessionUser({ _id: "507f1f77bcf86cd799439011", role: "owner", name: "Alexandra Maria Santos", firstName: "Alexandra", email: "owner@example.test" });
window.setOwnerName = firstName => setSessionOwnerProfile({ firstName, name: firstName + " Santos" });
window.actionCalls = [];
window.analyticsCalls = [];
API.getUnreadNotificationCount = async () => ({ unreadCount: 2 });
API.getOwnerRenterThreads = async () => ({ renters: [{ unreadCount: 3 }] });
API.getOwnerAnalytics = async ({ period }) => {
  window.analyticsCalls.push(period);
  if (window.holdAnalytics) await new Promise(resolve => { window.finishAnalytics = resolve; });
  return { period: { key: period }, summary: {}, vehiclePerformance: [], bookingTrend: [], monthlyEarningsTrend: [] };
};
window.addEventListener("navigate", e => window.actionCalls.push(e.detail));
window.addEventListener("open-add-vehicle", () => window.actionCalls.push("add"));
window.addEventListener("rentifypro:open-help", () => window.actionCalls.push("help"));
function App() {
  const [view, setView] = useState("access");
  window.showButtons = setView;
  const action = key => { window.actionCalls.push(key); setView(""); };
  return <div className="rp-owner-workspace">
    {view === "access" && <BookingAccessModal isOpen onSignIn={() => action("signin")} onRegister={() => action("register")} onBrowseVehicles={() => action("browse")} onClose={() => action("close")} />}
    {view === "owner" && <><Topbar onToggleSidebar={() => action("menu")} onNavigateToNotifications={() => action("notifications")} /><main className="p-4"><Analytics /></main></>}
    {view === "chat" && <ChatWidget isOpen onClose={() => action("chat-close")} />}
    {view === "sidebar" && <Sidebar activePage="Dashboard" setActivePage={key => action(key)} isMobileOpen onCloseMobile={() => {}} onLogout={() => action("logout")} />}
    {view === "admin" && <AdminSidebar activeView="dashboard" displayName="Fixture Admin" displayEmail="admin@example.test" mobileOpen onClose={() => action("admin-close")} onSelect={key => action(key)} onLogout={() => action("admin-logout")} />}
  </div>;
}
createRoot(document.getElementById("root")).render(<App />);
`;

let ws, send;
const errors = [], checks = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await fs.mkdir(fixtureDirectory, { recursive: true });
  await fs.writeFile(files[0], `<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/.vite/${name}.jsx"></script></body></html>`);
  await fs.writeFile(files[1], fixture);
  const target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const call = pending.get(message.id); pending.delete(message.id);
      if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    else if (message.method === "Fetch.requestPaused") {
      const { request, requestId } = message.params, url = new URL(request.url);
      const blocked = url.origin !== base || url.pathname.startsWith("/api/");
      send(blocked ? "Fetch.failRequest" : "Fetch.continueRequest", { requestId, ...(blocked ? { errorReason: "Aborted" } : {}) }).catch(error => errors.push(error.message));
    }
  };
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  const wait = async expression => {
    for (let i = 0; i < 150; i++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(80); }
    throw new Error(`Timed out: ${expression}`);
  };
  const show = async view => { await evaluate(`window.showButtons(${JSON.stringify(view)})`); await pause(100); };
  const button = label => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
  const namedButton = label => `document.querySelector('button[aria-label="${label}"]')`;
  const assertButton = async (label, { disabled = false } = {}) => {
    const result = await evaluate(`(() => {
      const b = ${button(label)}; if (!b) return null;
      const r = b.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(b);
      const text = range.getBoundingClientRect();
      return { svg: [...b.querySelectorAll('svg')].some(s => s.getBoundingClientRect().width > 0), disabled: b.disabled, height: r.height,
        visible: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && text.width > 0 && text.left >= r.left && text.right <= r.right };
    })()`);
    assert.ok(result, label);
    assert.equal(result.svg, false, `${label} has text only`);
    assert.equal(result.disabled, disabled, `${label} enabled state`);
    assert.ok(result.height >= 43.5 && result.visible, `${label} label and touch target fit: ${JSON.stringify(result)}`);
  };
  const assertResponsiveAction = async (name, label, width, iconCount) => {
    const result = await evaluate(`(() => {
      const b = ${namedButton(name)}, r = b.getBoundingClientRect();
      return { text: b.innerText.trim(), width: r.width, height: r.height,
        icons: [...b.querySelectorAll('svg')].filter(s => s.getBoundingClientRect().width > 0).length,
        fits: r.left >= 0 && r.right <= innerWidth, title: b.title, disabled: b.disabled };
    })()`);
    assert.ok(result.fits && result.height >= 44 && result.title === name && !result.disabled, `${name} is accessible and fits at ${width}px: ${JSON.stringify(result)}`);
    assert.equal(result.text, width < 768 ? "" : label);
    assert.equal(result.icons, width < 768 ? iconCount : 0);
    if (width < 768) assert.equal(result.width, 44);
  };
  const tapExpression = async expression => {
    await evaluate(`${expression}.scrollIntoView({block:'center'})`);
    const point = await evaluate(`(() => { const r = ${expression}.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`);
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const tap = label => tapExpression(button(label));
  const tapNamed = label => tapExpression(namedButton(label));
  const press = async (key, code, value) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: value });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: value });
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Network.setBlockedURLs", { urls: ["ws://*", "wss://*"] });
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await send("Page.navigate", { url: `${base}/.vite/${name}.html` });
  await send("Page.bringToFront");
  await wait("window.showButtons");
  for (const width of [320, 360, 390, 640, 767, 768, 1024, 1440]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: width === 320 ? 568 : 844, deviceScaleFactor: 1, mobile: width < 768 });
    for (const [label, action] of [["Sign In", "signin"], ["Register", "register"], ["Continue Browsing Vehicles", "browse"]]) {
      await show("access"); await assertButton(label); await tap(label);
      await wait(`window.actionCalls.at(-1) === ${JSON.stringify(action)} && !document.querySelector('.rp-modal-layer')`);
    }
    await show("owner"); await wait("document.querySelector('button[aria-label=\"Refresh vehicle analytics\"]:not(:disabled)')");
    await assertResponsiveAction("Add vehicle", "Add Vehicle", width, 2);
    await assertResponsiveAction("Refresh vehicle analytics", "Refresh", width, 1);
    assert.equal(await evaluate("[...document.querySelectorAll('.rp-owner-topbar button')].filter(b => b.getClientRects().length).every(b => {const r=b.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.height>=44;})"), true, `Owner header controls fit at ${width}px`);
    const layout = await evaluate(`(() => {
      const header = document.querySelector('.rp-owner-topbar'), h = header.querySelector('h1'), r = h.getBoundingClientRect();
      const centers = [...header.querySelectorAll('button')].filter(b => b.getClientRects().length).map(b => {const r=b.getBoundingClientRect();return r.y+r.height/2;});
      return { height: header.getBoundingClientRect().height, centers,
        greetingFits: r.width > 0 && r.left >= 0 && r.right <= header.querySelector('[aria-label="Help"]').getBoundingClientRect().left,
        truncation: getComputedStyle(h).textOverflow,
        badge: header.querySelector('[aria-label="Notifications"]').innerText.trim() };
    })()`);
    assert.ok(Math.max(...layout.centers) - Math.min(...layout.centers) < 1, `Header stays in one row at ${width}px`);
    assert.ok(layout.greetingFits && layout.truncation === "ellipsis", `Long greeting fits at ${width}px`);
    assert.equal(layout.height, width < 768 ? 64 : 80);
    assert.equal(layout.badge, "2");
    await tapNamed("Add vehicle"); await wait("window.actionCalls.at(-1) === 'add'");
    assert.deepEqual(await evaluate("window.actionCalls.slice(-2)"), ["Vehicles", "add"]);
    if (width === 320) {
      await evaluate("window.holdAnalytics = true"); await tapNamed("Refresh vehicle analytics");
      await wait("window.finishAnalytics && document.querySelector('button[aria-label=\"Refresh vehicle analytics\"]').disabled");
      assert.equal(await evaluate(`${namedButton("Refresh vehicle analytics")}.innerText.trim()`), "");
      assert.equal(await evaluate(`${namedButton("Refresh vehicle analytics")}.querySelectorAll('svg.animate-spin').length`), 1);
      const calls = await evaluate("window.analyticsCalls.length");
      await tapNamed("Refresh vehicle analytics");
      assert.equal(await evaluate("window.analyticsCalls.length"), calls, "Disabled refresh prevents duplicate requests");
      await evaluate("window.holdAnalytics = false; window.finishAnalytics()");
      await wait("!document.querySelector('button[aria-label=\"Refresh vehicle analytics\"]').disabled");
      await assertResponsiveAction("Refresh vehicle analytics", "Refresh", width, 1);
      await evaluate("window.setOwnerName('Alexandria-Christabelle')");
      await wait("document.querySelector('.rp-owner-topbar h1').getAttribute('aria-label').includes('Alexandria-Christabelle')");
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "Long owner names do not widen the page");
      await evaluate("window.setOwnerName('Juan')");
      await wait("document.querySelector('.rp-owner-topbar h1').innerText === 'Hi, Juan!'");
      await evaluate("window.scrollTo(0,0)");
      await fs.writeFile(path.join(output, "owner-header-320.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
      await tapNamed("Notifications"); await wait("window.actionCalls.at(-1) === 'notifications'");
      await show("owner"); await tapNamed("Open menu"); await wait("window.actionCalls.at(-1) === 'menu'");
      await show("owner"); await tapNamed("Help"); await wait("window.actionCalls.at(-1) === 'help'");
    }
    if (width === 768) {
      await evaluate("document.body.setAttribute('tabindex', '-1'); document.body.focus(); document.body.removeAttribute('tabindex')");
      for (const label of ["Open menu", "Help", "Notifications", "Add vehicle"]) {
        await press("Tab", "Tab", 9);
        assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), label);
        assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "solid");
      }
      await press("Enter", "Enter", 13);
      await wait("window.actionCalls.at(-1) === 'add'");
      await evaluate("window.scrollTo(0,0)");
      await fs.writeFile(path.join(output, "owner-header-768.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    }
    if (width === 390 || width === 1440) {
      await evaluate("window.scrollTo(0,0)");
      await fs.writeFile(path.join(output, `owner-header-${width}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    }
    await show("chat"); await assertButton("New chat", { disabled: true });
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Close Rentify AI\"]').getBoundingClientRect().right <= innerWidth"), true);
    await show("");
    for (const view of ["sidebar", "admin"]) {
      await show(view); await assertButton("Bookings"); await tap("Bookings");
      await wait(`window.actionCalls.at(-1) === ${JSON.stringify(view === "sidebar" ? "Bookings" : "bookings")}`);
    }
    checks.push(`Access choices, owner actions, New chat, and navigation fit and work at ${width}px`);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, screenshots: output }, null, 2));
} finally {
  if (send && ws?.readyState === WebSocket.OPEN) { await send("Page.close"); ws.close(); }
  await Promise.all(files.map(file => fs.rm(file, { force: true })));
}
