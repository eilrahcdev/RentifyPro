// Run Vite on 4176 and isolated headless Chrome with CDP on 9236, then:
// node --experimental-websocket scripts/registration-draft-browser-check.mjs
// All API/address responses are fixtures. No live registrations are created.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = "http://127.0.0.1:4176";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const errors = [];
let ws, send, target;
const key = role => `rentifypro.registrationDraft.v1.${role}`;
const minute = 60000;
const common = { firstName: "Alice", lastName: "Example", phone: "9123456789",
  region: "01", province: "0101", city: "010101", barangay: "010101001" };
const fields = role => role === "user"
  ? { ...common, email: "alice@gmail.com", dateOfBirth: "1995-01-01", gender: "Female",
    emergencyContactName: "Bob Example", emergencyContactPhone: "9987654321", emergencyContactRelationship: "Friend" }
  : { ...common, businessEmail: "owner@gmail.com", ownerType: "business", businessName: "Example Transport", permitNumber: "TEST123" };

try {
  target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const respond = (requestId, status, data) => send("Fetch.fulfillRequest", {
    requestId, responseCode: status,
    responseHeaders: [
      { name: "Content-Type", value: "application/json" },
      { name: "Access-Control-Allow-Origin", value: base },
      { name: "Access-Control-Allow-Credentials", value: "true" },
      { name: "Access-Control-Allow-Headers", value: "content-type,x-pre-kyc-token" },
      { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
    ], body: Buffer.from(JSON.stringify(data)).toString("base64"),
  });
  const handle = async ({ requestId, request }) => {
    const url = new URL(request.url);
    if (url.hostname !== "psgc.gitlab.io" && url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return respond(requestId, 200, {});
      if (url.pathname === "/api/auth/me") return respond(requestId, 401, { message: "No session" });
      return respond(requestId, 200, { success: true, vehicles: [], notifications: [], documents: [] });
    }
    if (url.hostname === "psgc.gitlab.io") {
      // Resolve children before parents to catch restoration races.
      let data = [];
      if (url.pathname.endsWith("/regions/")) data = [{ code: "01", name: "Fixture Region" }];
      if (url.pathname.endsWith("/provinces/")) {
        await pause(500);
        data = [{ code: "0101", name: "Fixture Province" }];
      }
      if (url.pathname.endsWith("/cities-municipalities/")) {
        await pause(200);
        data = [{ code: "010101", name: "Fixture City" }];
      }
      if (url.pathname.endsWith("/barangays/")) data = [{ code: "010101001", name: "Fixture Barangay" }];
      return respond(requestId, 200, data);
    }
    if (url.origin !== base) return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
    return send("Fetch.continueRequest", { requestId });
  };
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const call = pending.get(message.id); pending.delete(message.id);
      if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    } else if (message.method === "Fetch.requestPaused") {
      handle(message.params).catch(error => {
        if (!/Invalid InterceptionId|Invalid parameters|Target closed/.test(error.message)) errors.push(error.message);
      });
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.draftClockOffset = 0;
    window.draftDocumentId = Math.random();
    const actualNow = Date.now.bind(Date);
    Date.now = () => actualNow() + window.draftClockOffset;
  ` });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  const wait = async (expression, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try { if (await evaluate(`Boolean(${expression})`)) return; } catch { /* Navigation may replace the context. */ }
      await pause(80);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  let pendingSeed = null;
  const navigate = async path => {
    const previous = await evaluate("window.draftDocumentId");
    let seedScript;
    if (pendingSeed) {
      const {role, remaining} = pendingSeed;
      seedScript = await send("Page.addScriptToEvaluateOnNewDocument", {source: `
        sessionStorage.setItem(${JSON.stringify(key(role))}, JSON.stringify({version: 1,
          fields: ${JSON.stringify(fields(role))}, expiresAt: Date.now() + ${remaining}}));
      `});
      pendingSeed = null;
    }
    await send("Page.navigate", { url: base + path });
    await wait(`window.draftDocumentId !== ${JSON.stringify(previous)} && document.querySelector('[data-registration-draft]')`);
    if (seedScript) await send("Page.removeScriptToEvaluateOnNewDocument", {identifier: seedScript.identifier});
  };
  const read = role => evaluate(`JSON.parse(sessionStorage.getItem(${JSON.stringify(key(role))}))`);
  const seed = async (role, remaining = 60 * minute) => {
    pendingSeed = {role, remaining};
  };
  const setInput = async (selector, value) => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw Error('Missing input: ' + ${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  })()`);
  const click = async text => evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)});
    if (!el) throw Error('Missing button: ' + ${JSON.stringify(text)});
    el.click();
  })()`);
  const advance = async milliseconds => {
    await evaluate(`window.draftClockOffset += ${milliseconds}; window.dispatchEvent(new Event('focus'));`);
    await pause(100);
  };
  const firstInput = role => role === "user" ? 'input[placeholder="John"]' : 'input[name="firstName"]';

  const inspectNotice = async (state, role = "user") => {
    assert.equal(await evaluate("document.querySelector('[data-registration-draft]').dataset.draftState"), state);
    // The status and action must share one box, with no extra explanatory paragraph below it.
    assert.ok(await evaluate(`(() => {
      const notice = document.querySelector('[data-registration-draft]');
      const status = notice.querySelector('[role="status"]');
      const action = [...notice.querySelectorAll('button')].find(button => button.textContent === 'Start over');
      return notice.children.length === 1 && status.parentElement === action.parentElement;
    })()`));
    for (const width of [1440, 1024, 768, 430, 390, 360]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"), `${state} notice overflows at ${width}px`);
      if (state === "restored" && [1440, 360].includes(width)) {
        await fs.mkdir(new URL("../qa/registration-draft/", import.meta.url), { recursive: true });
        const screenshot = await send("Page.captureScreenshot", { format: "png" });
        await fs.writeFile(new URL(`../qa/registration-draft/${role}-restored-${width}.png`, import.meta.url), Buffer.from(screenshot.data, "base64"));
      }
    }
  };

  await navigate("/register");
  await evaluate("sessionStorage.clear(); localStorage.clear()");
  await navigate("/register");
  await inspectNotice("new");
  for (const role of ["user", "owner"]) {
    const path = role === "user" ? "/register" : "/register-owner";
    await seed(role);
    await navigate(path);
    await wait("[...document.querySelectorAll('select')].some(el => el.value === '010101001')");
    await pause(900);
    await inspectNotice("restored", role);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(firstInput(role))}).value`), "Alice");
    for (const code of ["01", "0101", "010101", "010101001"]) {
      assert.ok(await evaluate(`[...document.querySelectorAll('select')].some(el => el.value === '${code}')`), `${role} restores ${code}`);
    }
    await setInput(firstInput(role), "Updated");
    await setInput('input[placeholder="Create Password"]', "DraftTest123!");
    await setInput('input[placeholder="Confirm Password"]', "DraftTest123!");
    await evaluate("document.querySelector('input[type=checkbox]').click()");
    await wait(`JSON.parse(sessionStorage.getItem(${JSON.stringify(key(role))})).fields.firstName === 'Updated'`);
    const saved = await read(role);
    assert.equal(saved.fields.password, undefined);
    assert.equal(saved.fields.agree, undefined);
    await navigate(path);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(firstInput(role))}).value`), "Updated");
    assert.equal(await evaluate("document.querySelector('input[placeholder=\"Create Password\"]').value"), "");
    assert.equal(await evaluate("document.querySelector('input[type=checkbox]').checked"), false);
    checks.push(`${role}: edited details and dependent address selections survive refresh; password/consent excluded`);

    await seed(role, 5 * minute);
    await navigate(path);
    await wait("document.querySelector('[aria-label=\"Registration draft expiry\"]')");
    assert.equal(await evaluate("document.activeElement.textContent"), "Keep my progress");
    for (const width of [1440, 1024, 768, 430, 390, 360]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"), `${role} overflow at ${width}`);
      assert.ok(await evaluate(`(() => { const r = document.querySelector('[aria-label="Registration draft expiry"]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`));
    }
    if (role === "user") {
      await fs.mkdir(new URL("../qa/registration-draft/", import.meta.url), { recursive: true });
      const shot = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(new URL("../qa/registration-draft/mobile-warning.png", import.meta.url), Buffer.from(shot.data, "base64"));
    }
    for (let i = 0; i < 11; i++) {
      await click("Keep my progress");
      await wait("!document.querySelector('[aria-label=\"Registration draft expiry\"]')");
      assert.ok((await read(role)).expiresAt - await evaluate("Date.now()") > 59 * minute);
      await advance(55 * minute);
      await wait("document.querySelector('[aria-label=\"Registration draft expiry\"]')");
    }
    await advance(5 * minute + 100);
    await wait("document.querySelector('[data-draft-state=expired]')");
    await inspectNotice("expired", role);
    assert.equal(await read(role), null);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(firstInput(role))}).value`), "");
    checks.push(`${role}: warning is focused, fits six widths, supports 11 extensions, and expiry clears the form`);

    await setInput(firstInput(role), "Restart");
    await click("Start over");
    await click("Keep editing");
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(firstInput(role))}).value`), "Restart");
    await click("Start over");
    await click("Clear and start over");
    await wait("document.querySelector('[data-draft-state=restarted]')");
    await inspectNotice("restarted", role);
    assert.equal(await read(role), null);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(firstInput(role))}).value`), "");
    checks.push(`${role}: start over supports cancellation and clears the form after confirmation`);
  }

  await seed("user", -1);
  await navigate("/register");
  assert.equal(await read("user"), null);
  assert.ok(await evaluate("Boolean(document.querySelector('[data-draft-state=expired]'))"));
  await seed("user", 500);
  await navigate("/register");
  await evaluate("window.draftClockOffset += 61 * 60000");
  await setInput(firstInput("user"), "Late");
  await wait("document.querySelector('[data-draft-state=expired]')");
  assert.equal(await read("user"), null);
  checks.push("Expired drafts are rejected on reload and late activity cannot revive an overdue draft");

  const blocked = await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    for (const name of ['getItem', 'setItem', 'removeItem']) {
      const original = Storage.prototype[name];
      Storage.prototype[name] = function(key, ...args) {
        if (String(key).startsWith('rentifypro.registrationDraft.')) throw new DOMException('Blocked', 'QuotaExceededError');
        return original.call(this, key, ...args);
      };
    }
  ` });
  await navigate("/register");
  await setInput(firstInput("user"), "Available");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(firstInput("user"))}).value`), "Available");
  assert.ok(await evaluate("Boolean(document.querySelector('[data-draft-state=unavailable]'))"));
  await inspectNotice("unavailable");
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: blocked.identifier });
  checks.push("Draft storage failures leave the form usable and explain that refresh recovery is unavailable");
  checks.push("All five draft notice states use one box and fit all six viewport widths");

  // Exercise busy/complete lifecycle using the same production hook and notice in StrictMode.
  await fs.mkdir(new URL("../frontend/.vite/", import.meta.url), { recursive: true });
  await fs.writeFile(new URL("../frontend/.vite/registration-draft-harness.html", import.meta.url), `
    <div id="root"></div><script type="module">
    import React, {useState, useCallback} from 'react';
    import {createRoot} from 'react-dom/client';
    import useRegistrationDraft from '/src/hooks/useRegistrationDraft.js';
    import Notice from '/src/components/RegistrationDraftNotice.jsx';
    const h = React.createElement;
    function Probe({reset}) {
      const [busy, setBusy] = useState(false);
      const draft = useRegistrationDraft('user', {firstName: ''}, {busy, onReset: reset});
      window.finishDraftRequest = () => {draft.complete(); setBusy(false)};
      window.failDraftRequest = () => setBusy(false);
      return h('div', draft.activityProps, h(Notice, {draft, busy}),
        h('input', {value: draft.form.firstName, onChange: e => draft.setForm({firstName: e.target.value})}),
        h('button', {onClick: () => setBusy(true)}, 'Begin request'));
    }
    function App() { const [key, setKey] = useState(0); const reset = useCallback(() => setKey(x => x + 1), []); return h(Probe, {key, reset}); }
    createRoot(document.getElementById('root')).render(h(React.StrictMode, null, h(App)));
    </script>`);
  await navigate("/.vite/registration-draft-harness.html");
  await setInput("input", "Submitting");
  await click("Begin request");
  await advance(61 * minute);
  assert.equal(await evaluate("document.querySelector('input').value"), "Submitting");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Start over').disabled"), true);
  await evaluate("window.finishDraftRequest()");
  await pause(1200);
  assert.equal(await read("user"), null);
  await setInput("input", "After success");
  assert.equal(await read("user"), null);
  checks.push("A pending request delays form reset; successful completion clears the draft without resaving it");

  await navigate("/.vite/registration-draft-harness.html");
  await setInput("input", "Pending");
  await click("Begin request");
  await advance(61 * minute);
  await evaluate("window.failDraftRequest()");
  await wait("document.querySelector('input').value === ''");
  assert.equal(await read("user"), null);
  checks.push("A failed pending request allows the overdue form to reset");

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, runtimeErrors: errors }, null, 2));
} catch (error) {
  if (send) {
    const snapshot = await send("Runtime.evaluate", { expression: `JSON.stringify({url:location.href, text:document.body.innerText.slice(-2000), selects:[...document.querySelectorAll('select')].map(e=>({value:e.value, options:[...e.options].map(o=>o.value)}))})`, returnByValue: true }).catch(() => null);
    console.error(snapshot?.result?.value);
  }
  console.error(JSON.stringify({ completedChecks: checks, runtimeErrors: errors }, null, 2));
  throw error;
} finally {
  if (send && target) await send("Page.close").catch(() => {});
  ws?.close();
}
