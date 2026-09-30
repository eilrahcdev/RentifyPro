// node --experimental-websocket scripts/session-browser-check.mjs
// Requires Vite on 4176 and an isolated headless Chrome on CDP 9236.
// Exercises the real app and API client with intercepted fixture responses only.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = "http://127.0.0.1:4176";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const errors = [];
let role = "user";
let profileDelay = 0;
let profileMode = "success";
let logoutMode = "success";
let logoutCalls = 0;
let documentLoads = 0;
let ws;
let send;
let target;
const fixtureUser = () => ({
  _id: "507f1f77bcf86cd799439011", name: "Session Fixture", email: "session@example.test",
  role, isVerified: true, kycStatus: "verified",
});

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
      { name: "Access-Control-Allow-Headers", value: "content-type" },
      { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
    ],
    body: Buffer.from(JSON.stringify(data)).toString("base64"),
  });
  const handleRequest = async ({ requestId, request, resourceType }) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return respond(requestId, 200, {});
      if (url.pathname === "/api/auth/me") {
        const user = role ? fixtureUser() : null;
        await pause(profileDelay);
        if (profileMode === "network") return send("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" });
        return respond(requestId, user ? 200 : 401, user ? { user } : { message: "No session" });
      }
      if (url.pathname === "/api/auth/logout") {
        logoutCalls += 1;
        await pause(250);
        if (logoutMode === "timeout") return; // The real API client's abort timer must recover.
        if (logoutMode === "network") return send("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" });
        if (logoutMode === "failure") return respond(requestId, 500, { message: "Fixture logout failure" });
        role = null;
        return respond(requestId, logoutMode === "expired" ? 401 : 200, { success: true });
      }
      return respond(requestId, 200, {
        success: true, vehicles: [], bookings: [], notifications: [], conversations: [],
        reviews: [], reports: [], unreadCount: 0, total: 0, stats: {}, summary: {},
        challenge: { id: "fixture", question: "1 + 1" },
      });
    }
    if (url.origin !== base) return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
    if (resourceType === "Document") documentLoads += 1;
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
      handleRequest(message.params).catch(error => {
        // A navigation/abort can discard a request that was deliberately delayed.
        if (!/Invalid InterceptionId|Invalid parameters|Target closed/.test(error.message)) errors.push(error.message);
      });
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.sessionSkeletonTimes = {};
    new MutationObserver(() => {
      const skeleton = document.querySelector('[role="status"][aria-label="Loading your account"]');
      const times = window.sessionSkeletonTimes;
      if (skeleton && times.start === undefined) times.start = performance.now();
      if (!skeleton && times.start !== undefined && times.end === undefined) times.end = performance.now();
    }).observe(document, { childList: true, subtree: true });
  ` });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  const wait = async (expression, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try { if (await evaluate(`Boolean(${expression})`)) return; } catch { /* document may be navigating */ }
      await pause(40);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const waitForDocumentLoad = async (previousCount) => {
    const start = Date.now();
    while (documentLoads <= previousCount && Date.now() - start < 15000) await pause(40);
    assert.ok(documentLoads > previousCount, "Expected a page reload");
  };
  const clickText = async (text, selector = "button") => {
    const expression = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim() === ${JSON.stringify(text)})`;
    await wait(expression);
    await evaluate(`${expression}.click()`);
  };
  const ready = async () => {
    await wait("document.querySelector('#root > *:not([aria-hidden=\"true\"]) button, #root > *:not([aria-hidden=\"true\"]) a, #root > *:not([aria-hidden=\"true\"]) input') && !document.querySelector('[aria-label=\"Loading your account\"]')");
    return evaluate("window.sessionSkeletonTimes?.start === undefined ? null : window.sessionSkeletonTimes.end - window.sessionSkeletonTimes.start");
  };
  const navigate = async (path = "/") => {
    await send("Page.navigate", { url: base + path });
  };
  const openLogout = async (owner = false) => {
    if (!owner) {
      await wait("[...document.querySelectorAll('button')].some(el => el.textContent.includes('Session Fixture'))");
      await evaluate("[...document.querySelectorAll('button')].find(el => el.textContent.includes('Session Fixture')).click()");
    }
    await clickText("Sign Out");
    await wait("document.querySelector('.rp-modal-layer')");
  };
  const confirm = async () => {
    // Same-tick duplicate activation must not send a second logout request.
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('.rp-modal-layer button')].find(el => el.textContent.trim() === 'Sign Out');
      button.click(); button.click();
    })()`);
    await wait("document.querySelector('[role=\"status\"][aria-label=\"Signing out\"]')");
    assert.equal(await evaluate("document.body.innerText.includes('Session Fixture')"), false);
  };

  await navigate();
  const fastMs = await ready();
  assert.equal(fastMs, null, `Fast restoration showed a skeleton for ${fastMs} ms`);
  checks.push({ scenario: "Fast saved session skips the skeleton" });

  profileDelay = 1700;
  await navigate();
  await wait("document.querySelector('[role=\"status\"][aria-label=\"Loading your account\"]')");
  const slowStart = await evaluate("window.sessionSkeletonTimes.start");
  assert.ok(slowStart >= 450, `Skeleton appeared after ${slowStart} ms`);
  const slowMs = await ready();
  assert.ok(slowMs >= 950 && slowMs < 1800, `Slow skeleton lasted ${slowMs} ms`);
  checks.push({ scenario: "Slow restoration shows a delayed skeleton", milliseconds: Math.round(slowMs) });
  profileDelay = 0;

  profileMode = "network";
  await navigate();
  await ready();
  assert.equal(await evaluate("document.body.innerText.includes('Could not check your account')"), false);
  assert.equal(await evaluate("document.body.innerText.includes('Session Fixture')"), false);
  profileMode = "success";
  await evaluate("window.dispatchEvent(new Event('online'))");
  await wait("document.body.innerText.includes('Session Fixture')");
  checks.push({ scenario: "Public page remains available during account-check failure and restores session online" });

  profileMode = "network";
  await navigate("/account-settings");
  await wait("document.body.innerText.includes('Could not check your account')");
  assert.equal(await evaluate("document.body.innerText.includes('Session Fixture')"), false);
  profileMode = "success";
  await clickText("Retry account check");
  await wait("!document.body.innerText.includes('Could not check your account')");
  await ready();
  checks.push({ scenario: "Private page remains blocked during account-check failure and recovers on retry" });

  await navigate();
  await ready();

  await openLogout();
  await clickText("Cancel", ".rp-modal-layer button");
  assert.equal(logoutCalls, 0);
  await openLogout();
  const loadsBeforeLogout = documentLoads;
  await confirm();
  await waitForDocumentLoad(loadsBeforeLogout);
  await ready();
  assert.equal(logoutCalls, 1);
  assert.equal(documentLoads, loadsBeforeLogout + 1);
  assert.equal(await evaluate("location.pathname"), "/");
  assert.equal(await evaluate("document.body.innerText.includes('Session Fixture')"), false);
  checks.push({ scenario: "Cancel does nothing; confirming signs out once and reloads the guest home page" });

  role = "owner";
  await navigate("/owner-dashboard");
  await ready();
  await openLogout(true);
  const loadsBeforeFailure = documentLoads;
  logoutMode = "failure";
  await confirm();
  await wait("document.querySelector('[role=\"alert\"]')");
  assert.equal(documentLoads, loadsBeforeFailure);
  assert.equal(role, "owner");
  assert.equal(await evaluate("Boolean(document.querySelector('#owner-navigation'))"), false);
  checks.push({ scenario: "Failed logout shows retry, hides account content, and does not reload" });

  logoutMode = "network";
  await clickText("Retry sign out");
  await wait("document.querySelector('[role=\"alert\"]')");
  assert.equal(documentLoads, loadsBeforeFailure);
  checks.push({ scenario: "Network failure remains recoverable" });

  logoutMode = "timeout";
  const timeoutStart = Date.now();
  await clickText("Retry sign out");
  await wait("document.querySelector('[role=\"alert\"]')");
  assert.ok(Date.now() - timeoutStart >= 9800);
  checks.push({ scenario: "A stalled logout times out and offers retry" });

  logoutMode = "success";
  await clickText("Retry sign out");
  await waitForDocumentLoad(loadsBeforeFailure);
  await wait("location.pathname === '/signin'");
  await ready();
  assert.equal(documentLoads, loadsBeforeFailure + 1);
  checks.push({ scenario: "Owner retry succeeds and reloads the existing sign-in destination" });

  role = "user";
  await navigate();
  await ready();
  await openLogout();
  logoutMode = "expired";
  const loadsBeforeExpired = documentLoads;
  await confirm();
  await waitForDocumentLoad(loadsBeforeExpired);
  await ready();
  assert.equal(await evaluate("Boolean(document.querySelector('[role=\"alert\"]'))"), false);
  checks.push({ scenario: "An already expired session completes logout" });

  role = "user";
  logoutMode = "success";
  await navigate();
  await ready();
  const loadsBeforeIdle = documentLoads;
  await evaluate(`(() => {
    const realNow = Date.now;
    Date.now = () => realNow() + 16 * 60 * 1000;
  })()`);
  await wait("document.querySelector('[role=\"status\"][aria-label=\"Signing out\"]')");
  await waitForDocumentLoad(loadsBeforeIdle);
  await wait("location.pathname === '/signin'");
  await ready();
  assert.equal(documentLoads, loadsBeforeIdle + 1);
  checks.push({ scenario: "Idle timeout uses the same sign-out flow and reloads sign-in" });

  profileDelay = 5000;
  await navigate();
  await wait("document.querySelector('[role=\"status\"][aria-label=\"Loading your account\"]')");
  const widths = [1440, 1024, 768, 430, 390, 360];
  for (const width of widths) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    const metrics = await evaluate(`({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      visibleText: document.body.innerText.trim(),
      focusable: document.querySelectorAll('button, a, input, select, textarea, [tabindex="0"]').length })`);
    assert.ok(metrics.scroll <= metrics.width, `Overflow at ${width}px`);
    assert.equal(metrics.focusable, 0);
    assert.ok(!metrics.visibleText.includes("Restoring"));
  }
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[aria-hidden=\"true\"]')).animationName"), "none");
  await fs.mkdir(new URL("../frontend/.vite/", import.meta.url), { recursive: true });
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(new URL("../frontend/.vite/session-skeleton-mobile.png", import.meta.url), Buffer.from(screenshot.data, "base64"));
  checks.push({ scenario: "Skeleton fits all six widths, has no controls, and respects reduced motion", widths });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, runtimeErrors: errors }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ completedChecks: checks, runtimeErrors: errors }, null, 2));
  throw error;
} finally {
  if (send && target) await send("Page.close").catch(() => {});
  ws?.close();
}
