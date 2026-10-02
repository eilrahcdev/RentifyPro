// Run Vite on 4176 and isolated headless Chrome with CDP on 9236, then:
// node --experimental-websocket scripts/registration-email-browser-check.mjs
// All API/address responses are fixtures. No live registrations are created.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = "http://127.0.0.1:4176";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const errors = [];
let ws, send, target;
let mode = 'duplicate', delay = 0, emailCalls = 0, registrationCalls = 0, kycCalls = 0;
const checkedEmails = [];
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
      if (url.pathname === "/api/auth/check-registration-email") {
        emailCalls++;
        checkedEmails.push(JSON.parse(request.postData).email);
        const current = mode;
        if (current === "timeout") return;
        await pause(delay);
        if (current === "network") return send("Fetch.failRequest", {requestId, errorReason: "InternetDisconnected"});
        if (current === "duplicate") return respond(requestId, 409, {success: false, code: "EMAIL_ALREADY_REGISTERED", message: "This email is already registered. Please sign in or use another email.", errors: {email: "This email is already registered. Please sign in or use another email."}});
        if (current === "failure") return respond(requestId, 503, {success: false, message: "We couldn't check your email right now. Please try again."});
        if (current === "limited") return respond(requestId, 429, {success: false, message: "Too many email checks. Try again in 00:02.", retryAfterSeconds: 2});
        if (current === "malformed") return respond(requestId, 200, {success: true});
        return respond(requestId, 200, {success: true, available: true});
      }
      if (url.pathname === "/api/auth/register") registrationCalls++;
      if (url.pathname.startsWith("/api/kyc/")) kycCalls++;
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

  const pathFor = role => role === "user" ? "/register" : "/register-owner";
  const emailSelector = 'input[type="email"]';
  const cooldown = () => evaluate("window.draftClockOffset += 2100");
  const stepOne = "Boolean(document.querySelector('input[type=\"email\"]'))";
  const stepTwo = "Boolean(document.querySelector('input[type=\"file\"]'))";
  const fillCredentials = async () => {
    await wait("[...document.querySelectorAll('select')].some(el => el.value === '010101001')");
    await pause(800);
    await setInput('input[placeholder="Create Password"]', "DraftTest123!");
    await setInput('input[placeholder="Confirm Password"]', "DraftTest123!");
    await evaluate("document.querySelector('input[type=checkbox]').click()");
  };
  const prepare = async role => {
    await seed(role);
    await navigate(pathFor(role));
    await fillCredentials();
  };
  const next = async () => { await cooldown(); await click("Next"); };

  await navigate("/register");
  await evaluate("sessionStorage.clear(); localStorage.clear()");
  for (const role of ["user", "owner"]) {
    await prepare(role);
    let before = emailCalls;
    mode = "duplicate"; delay = 700;
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Next');
      button.click(); button.click();
    })()`);
    await wait("document.body.innerText.includes('Checking email...')");
    assert.ok(await evaluate("[...document.querySelectorAll('form input')].every(el => el.matches(':disabled'))"));
    await wait("document.body.innerText.includes('This email is already registered')");
    await wait("document.activeElement.type === 'email'");
    assert.equal(emailCalls, before + 1);
    assert.ok(await evaluate(stepOne));
    assert.ok(!(await evaluate(stepTwo)));
    assert.equal((await read(role)).fields.firstName, "Alice");
    assert.equal(registrationCalls, 0);
    assert.equal(kycCalls, 0);
    checks.push(`${role}: a duplicate blocks Step 2, focuses email, preserves the draft, and rapid clicks send one request`);

    await cooldown();
    before = emailCalls;
    await evaluate("document.querySelector('form').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))");
    await wait("document.body.innerText.includes('Checking email...')");
    await wait("!document.body.innerText.includes('Checking email...')");
    assert.equal(emailCalls, before + 1);
    assert.ok(await evaluate(stepOne));
    assert.equal(registrationCalls, 0);
    checks.push(`${role}: submitting Step 1 with Enter follows the same check and cannot invoke final registration`);

    mode = "available";
    await setInput(emailSelector, "  NEW.USER@GMAIL.COM  ");
    await next();
    await wait(stepTwo);
    assert.equal(checkedEmails.at(-1), "new.user@gmail.com");
    assert.ok(!(await evaluate(stepOne)));
    checks.push(`${role}: correcting the email allows Step 2 only after a positive server response`);

    await cooldown(); await click("Back");
    before = emailCalls; mode = "duplicate";
    await next();
    await wait("document.body.innerText.includes('This email is already registered')");
    assert.equal(emailCalls, before + 1);
    assert.ok(await evaluate(stepOne));
    await navigate(pathFor(role));
    await fillCredentials();
    before = emailCalls;
    await next();
    await wait("document.body.innerText.includes('This email is already registered')");
    assert.equal(emailCalls, before + 1);
    assert.equal((await read(role)).fields.available, undefined);
    checks.push(`${role}: Back and refresh require a fresh check; availability is not stored in the draft`);

    for (const failure of ["failure", "network", "limited", "malformed", "timeout"]) {
      await prepare(role);
      mode = failure; delay = 0;
      await next();
      await wait("document.querySelector('form [role=\"alert\"]')", 20000);
      assert.ok(await evaluate(stepOne));
      assert.ok(!(await evaluate(stepTwo)));
      assert.equal((await read(role)).fields.firstName, "Alice");
      if (failure === "timeout") assert.ok(await evaluate("document.body.innerText.includes('took too long')"));
      mode = "available";
      await next();
      await wait(stepTwo);
    }
    checks.push(`${role}: server/network failures, rate limits, malformed replies, and the 15-second timeout block progress and support retry`);

    await prepare(role);
    mode = "available"; delay = 1200;
    await next();
    await wait("document.body.innerText.includes('Checking email...')");
    // Deliberately dispatch a change to a disabled input to exercise cancellation.
    await setInput(emailSelector, "changed@gmail.com");
    await pause(1400);
    assert.ok(await evaluate(stepOne));
    assert.equal(await evaluate("document.querySelector('input[type=email]').value"), "changed@gmail.com");
    assert.ok(!(await evaluate(stepTwo)));
    mode = "duplicate"; delay = 0;
    await next();
    await wait("document.body.innerText.includes('This email is already registered')");
    checks.push(`${role}: an obsolete response cannot advance a changed email`);

    for (const width of [1440, 1024, 768, 430, 390, 360]) {
      await send("Emulation.setDeviceMetricsOverride", {width, height: 900, deviceScaleFactor: 1, mobile: false});
      assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"), `${role} overflow at ${width}`);
    }
    await fs.mkdir(new URL("../qa/registration-email/", import.meta.url), {recursive: true});
    const shot = await send("Page.captureScreenshot", {format: "png"});
    await fs.writeFile(new URL(`../qa/registration-email/${role}-duplicate-mobile.png`, import.meta.url), Buffer.from(shot.data, "base64"));
    checks.push(`${role}: duplicate-email feedback fits all six viewport widths`);
  }
  assert.equal(registrationCalls, 0);
  assert.equal(kycCalls, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({checks, emailCalls, registrationCalls, kycCalls, runtimeErrors: errors}, null, 2));
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
