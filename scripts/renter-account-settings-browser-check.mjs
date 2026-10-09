// Run against Vite on 4178 and isolated Chrome on 9239 with fake camera flags.
// API responses and ID/selfie inputs are simulated; no live accounts are changed.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const base = "http://127.0.0.1:4178";
const reportDir = "docs/reports/renter-account-settings-fix-2026-10-09";
const target = await (await fetch("http://127.0.0.1:9239/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0, selfieMode = "pass", attempt = null, settings = { email: true, bookingUpdates: true }, profileCalls = 0, cancelledIntercepts = 0;
const pending = new Map(), errors = [], checks = [], requests = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
const user = { _id: "507f1f77bcf86cd799439011", name: "Fixture Renter", email: "fixture@example.test",
  role: "user", isVerified: true, kycStatus: "approved", dateOfBirth: "2000-01-01" };
async function fulfill(requestId, body, status = 200) {
  return send("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [
    { name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,PUT,OPTIONS" },
  ], body: Buffer.from(JSON.stringify(body)).toString("base64") });
}
async function route({ requestId, request }) {
  const url = new URL(request.url), path = url.pathname;
  if (path.startsWith("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    if (path === "/api/auth/me") { profileCalls++; return fulfill(requestId, { success: true, user }); }
    if (path === "/api/auth/notification-settings") {
      if (request.method === "PUT") { settings = JSON.parse(request.postData); requests.push({ path, body: settings }); }
      return fulfill(requestId, { success: true, settings: { ...settings, sms: true, promotions: true } });
    }
    if (path === "/api/auth/login-activity") return fulfill(requestId, { activity: [{ _id: "fixture", createdAt: new Date().toISOString(), ip: "192.0.2.1", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36" }] });
    if (path === "/api/kyc/me") return fulfill(requestId, {
      status: "approved", remarks: "Your identity is verified. You can request a rental.", reverification: attempt,
      lastFaceReverifiedAt: attempt?.status === "approved" ? new Date().toISOString() : null,
    });
    if (path === "/api/kyc/reverify/id-register") {
      attempt = { attemptId: crypto.randomUUID(), status: "id_uploaded" };
      return fulfill(requestId, { success: true, attemptId: attempt.attemptId });
    }
    if (path === "/api/kyc/reverify/selfie/verify") {
      const body = JSON.parse(request.postData);
      assert.equal(body.attemptId, attempt.attemptId);
      assert.ok(body.selfie_image_base64.startsWith("data:image/"));
      if (selfieMode === "error") return fulfill(requestId, { message: "Verification service is temporarily unavailable. Try again." }, 503);
      attempt.status = selfieMode === "pass" ? "approved" : selfieMode === "pending" ? "selfie_matched" : "rejected";
      return fulfill(requestId, { verified: selfieMode !== "fail", kycStatus: selfieMode === "pass" ? "approved" : "challenge_passed",
        reverificationStatus: attempt.status, message: "Try another selfie in even lighting." });
    }
    if (path === "/api/kyc/reverify/cancel") {
      assert.equal(JSON.parse(request.postData).attemptId, attempt.attemptId);
      if (attempt.status !== "approved") attempt.status = "cancelled";
      return fulfill(requestId, { success: true });
    }
    if (["/api/kyc/id-register", "/api/kyc/selfie/verify"].includes(path)) throw new Error("Reverification used the original approval flow");
    return fulfill(requestId, { success: true, vehicles: [], notifications: [], conversations: [], unreadCount: 0, total: 0, activity: [] });
  }
  if (url.origin !== base) return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
  return send("Fetch.continueRequest", { requestId });
}
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id); pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") void route(message.params).catch((error) => {
    if (error.message === "Invalid InterceptionId.") cancelledIntercepts++; else errors.push(error.message);
  });
  else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function wait(expression, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await evaluate(`Boolean(${expression})`)) return; await pause(75); }
  throw new Error(`Timed out: ${expression}`);
}
const hasText = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`;
async function click(text) {
  const button = `[...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)} && !el.disabled)`;
  await wait(button); await evaluate(`${button}.click()`);
}
async function section(label) {
  await evaluate(`(() => {
    const select = document.querySelector('.rp-account-selector select');
    if (select.getBoundingClientRect().height > 0) {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(label)});
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } else [...document.querySelectorAll('.rp-account-navigation button')].find(el => el.textContent.trim() === ${JSON.stringify(label)}).click();
  })()`);
}
async function uploadId() {
  await click("Reverify face");
  await evaluate(`(async () => {
    const select = document.querySelector('#kyc-id-type');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, select.options[1].value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#aaa'; ctx.fillRect(0, 0, 640, 400);
    ctx.fillStyle = '#222'; for(let x = 0; x < 640; x += 40) ctx.fillRect(x, 0, 20, 400);
    ctx.fillStyle = '#fff'; ctx.font = '30px sans-serif'; ctx.fillText('SIMULATED ID FIXTURE', 20, 200);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const data = new DataTransfer(); data.items.add(new File([blob], 'simulated-id.png', { type: 'image/png' }));
    const input = document.querySelector('input[type=file][accept="image/jpeg,image/png"]'); input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await click("Upload ID & Continue"); await wait(hasText("Take a live selfie"));
}
async function captureSelfie() {
  await click("Open camera"); await click("Take photo"); await wait(hasText("Use selfie and continue"));
  assert.equal(await evaluate("window.__fixtureTracks.every(track => track.readyState === 'ended')"), true);
  await click("Use selfie and continue");
}
try {
  await fs.mkdir(reportDir, { recursive: true });
  await send("Page.enable"); await send("Runtime.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__fixtureTracks = [];
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await getMedia(...args); window.__fixtureTracks.push(...stream.getTracks()); return stream;
    };` });
  for (const [width, height] of [[1280, 900], [390, 844], [768, 1024]]) {
    settings = { email: true, bookingUpdates: true };
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    await send("Page.navigate", { url: `${base}/account-settings` }); await wait("document.querySelector('.rp-account-selector select')");
    await section("Notifications Settings"); await wait(hasText("Booking and payment emails"));
    assert.equal(await evaluate(`${hasText("SMS alerts")} || ${hasText("Promotions")}`), false);
    await wait("document.querySelector('input[type=checkbox]').checked && !document.querySelector('input[type=checkbox]').disabled");
    await evaluate("document.querySelector('input[type=checkbox]').click()");
    await wait("document.querySelectorAll('input[type=checkbox]')[1].disabled");
    assert.equal(await evaluate("document.querySelectorAll('input[type=checkbox]')[1].disabled"), true);
    await click("Save Settings"); await wait(hasText("Notification settings saved."));
    assert.deepEqual(Object.keys(requests.at(-1).body).sort(), ["bookingUpdates", "email"]);
    await section("Recent sign-ins"); await wait(hasText("Chrome on Windows"));
    assert.equal(await evaluate(hasText("Mozilla/5.0")), false);
    await section("Verification"); await wait(hasText("Reverify face"));
    assert.equal(await evaluate(hasText("confidence")), false);
    await click("Reverify face"); await wait(hasText("Upload your ID again"));
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
    await evaluate("document.querySelector('#kyc-id-type').scrollIntoView({block:'center'})");
    const capture = await send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(`${reportDir}/reverify-${width}.png`, Buffer.from(capture.data, "base64"));
    await click("Cancel verification"); await wait(`!${hasText("Upload your ID again")}`);
    checks.push(`${width}px: supported preferences, save payload, readable sign-ins, score-free verification, and responsive reverification`);
  }
  await uploadId(); await click("Open camera"); await wait(hasText("Take photo"));
  await click("Cancel verification"); await wait(`!${hasText("Take a live selfie")}`);
  assert.equal(attempt.status, "cancelled");
  assert.equal(await evaluate("window.__fixtureTracks.every(track => track.readyState === 'ended')"), true);
  checks.push("Cancelling an active camera stops its tracks and cancels only the new attempt");
  for (const mode of ["fail", "error", "pending", "pass"]) {
    selfieMode = mode; await uploadId(); await captureSelfie();
    if (mode === "fail") await wait(hasText("Selfie needs another try"));
    if (mode === "error") await wait(hasText("We couldn't complete verification right now"));
    if (mode === "pending") {
      await wait(hasText("Your existing approval remains active"));
      attempt.status = "approved";
      await click("Refresh Status");
      await wait(hasText("Face reverified"));
      checks.push("Refresh Status updates a completed document review without restarting the camera");
    }
    if (mode === "pass") await wait(hasText("Face reverified"));
    assert.equal(await evaluate(hasText("Identity verified")), true);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
    await click(["pass", "pending"].includes(mode) ? "Close verification" : "Cancel verification");
    await wait(`!${hasText("Upload your ID again")}`);
    checks.push(`Simulated ${mode} result preserves approval and provides the appropriate recovery/status`);
  }
  assert.deepEqual(errors, []);
  const beforeIdle = profileCalls;
  await pause(750);
  assert.equal(profileCalls, beforeIdle, "Account settings must not continuously refresh the profile");
  checks.push("Profile synchronization settles without repeated background requests");
  const result = { simulated: true, checks, runtimeErrors: errors, cancelledNavigationIntercepts: cancelledIntercepts, profileCalls };
  await fs.writeFile(`${reportDir}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ completedChecks: checks, runtimeErrors: errors, visibleText: await evaluate("document.body.innerText").catch(() => "") }, null, 2));
  throw error;
} finally {
  await send("Page.close").catch(() => {}); ws.close();
}
