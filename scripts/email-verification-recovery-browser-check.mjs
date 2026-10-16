// Uses local Vite on 4176 and an isolated Chrome CDP session on 9236.
// All API responses are fixtures; no accounts or emails are created.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = "http://127.0.0.1:4176";
const target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0, sends = 0, verifications = 0, mode = "normal", legacyResponse = false, cancelledRequests = 0;
const pending = new Map(), errors = [], verifiedBodies = [], checks = [];
const screenshots = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-email-recovery-captures-"));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const respond = (requestId, responseCode, data) => send("Fetch.fulfillRequest", {
  requestId, responseCode,
  responseHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" },
    { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
  ], body: Buffer.from(JSON.stringify(data)).toString("base64"),
});
const route = async ({ requestId, request }) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return respond(requestId, 200, {});
    if (url.pathname === "/api/auth/me") return respond(requestId, 401, { message: "No active session." });
    if (url.pathname === "/api/auth/login-challenge") return respond(requestId, 200, { challengeId: "fixture", question: "2 + 3" });
    if (url.pathname === "/api/auth/login") return respond(requestId, 403, {
      message: "Please verify your email before logging in.",
      errors: { email: "Please verify your email before logging in." },
      ...(!legacyResponse && { code: "EMAIL_VERIFICATION_REQUIRED" }),
    });
    if (url.pathname === "/api/auth/send-otp") {
      sends += 1;
      await new Promise(resolve => setTimeout(resolve, 150));
      if (mode === "smtp") return respond(requestId, 500, { message: "Failed to send OTP. Try again." });
      if (mode === "cooldown") return respond(requestId, 429, { message: "Too many OTP attempts. Try again in 00:02.", retryAfterSeconds: 2 });
      return respond(requestId, 200, { success: true, message: "If this email is registered, an OTP has been sent." });
    }
    if (url.pathname === "/api/auth/verify-otp") {
      verifications += 1;
      const body = JSON.parse(request.postData);
      verifiedBodies.push(body);
      await new Promise(resolve => setTimeout(resolve, 150));
      if (mode === "verify-limited") return respond(requestId, 429, { message: "Too many attempts. Please wait and try again.", retryAfterSeconds: 2 });
      if (mode === "unconfirmed") return respond(requestId, 200, { success: true, user: { isVerified: false } });
      if (body.otp !== "123456") return respond(requestId, 400, { message: "Invalid or expired code." });
      return respond(requestId, 200, { success: true, user: { email: body.email, isVerified: true, kycStatus: "pending_review" } });
    }
    return respond(requestId, 200, { success: true });
  }
  return url.origin === base
    ? send("Fetch.continueRequest", { requestId })
    : send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
};
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const item = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) item?.reject(new Error(message.error.message));
    else item?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") {
    route(message.params).catch(error => {
      if (/Invalid InterceptionId/.test(error.message)) cancelledRequests += 1;
      else errors.push(error.message);
    });
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
};
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const wait = async (expression, timeout = 15000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-2000)")}`);
};
const button = label => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
const click = label => evaluate(`${button(label)}.click()`);
const setValue = (selector, value) => evaluate(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
const fits = async () => assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
const capture = async name => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(path.join(screenshots, name), Buffer.from(data, "base64"));
};
const keyboardActivate = async label => {
  await send("Page.bringToFront");
  assert.equal(await evaluate(`(() => { const control = ${button(label)}; control.focus(); return document.activeElement === control; })()`), true);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
};
const begin = async (width, email = "legacy@gmail.com") => {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/signin` });
  await wait("document.querySelector('input[type=password]') && document.body.innerText.includes('Sign In')");
  await setValue('input[type=email]', email);
  await setValue('input[type=password]', "ValidPass1!");
  await setValue('input[inputmode=numeric]', "5");
  await evaluate("document.querySelector('form').requestSubmit()");
  await wait(`${button("Verify")} && !${button("Verify")}.disabled`);
  await fits();
};
const enterCode = value => setValue('input[aria-label="Code digit 1"]', value);

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.fixtureOffset = 0; const fixtureNow = Date.now.bind(Date); Date.now = () => fixtureNow() + window.fixtureOffset;" });

  await begin(1440);
  await capture("desktop-warning.png");
  const beforeSend = sends;
  await keyboardActivate("Verify");
  await wait("location.pathname === '/verify-email' && document.querySelector('input[aria-label=\"Code digit 1\"]:not(:disabled)')");
  assert.equal(sends - beforeSend, 1, "StrictMode must not send twice");
  assert.equal(await evaluate("[...document.querySelectorAll('input')].some(i => i.type === 'password')"), false);
  assert.equal(await evaluate(`${button("Verify Code")}.disabled`), true);
  assert.equal(await evaluate(`(() => {
    const back = ${button("Back to Sign In")}; back.focus();
    const style = getComputedStyle(back);
    return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
  })()`), true, "keyboard focus must be visible");
  await capture("desktop-code.png");
  checks.push("Keyboard Verify navigates to the existing code interface and sends exactly once; visible focus and incomplete-input blocking work.");

  await enterCode("000000");
  await click("Verify Code");
  await wait("document.body.innerText.includes('Invalid or expired code.')");
  await click("Clear Code");
  assert.equal(await evaluate("[...document.querySelectorAll('input[aria-label^=\"Code digit\"]')].every(i => i.value === '')"), true);
  await enterCode("123456");
  const beforeVerify = verifications;
  await evaluate(`${button("Verify Code")}.click(); ${button("Verify Code")}.click()`);
  await wait("document.querySelector('.rp-floating-alert') && document.body.innerText.includes('Email verified')");
  assert.equal(verifications - beforeVerify, 1);
  assert.equal(verifiedBodies.at(-1).signIn, false);
  assert.equal(await evaluate("document.querySelector('.rp-floating-alert button') === null"), true, "success alert must not contain a Sign In button");
  assert.equal(await evaluate("document.querySelector('.rp-floating-alert').textContent.trim()"), "Your email has been verified.");
  await capture("desktop-success.png");
  await wait("!document.querySelector('.rp-floating-alert')", 6000);
  assert.equal(await evaluate("location.pathname"), "/verify-email", "alert expiry must keep the success page open");
  await keyboardActivate("Go to Sign In");
  await wait("location.pathname === '/signin' && document.querySelector('input[type=password]') && !document.querySelector('.rp-floating-alert')");
  checks.push("Invalid codes remain errors; clear, full-code autofill, duplicate-click protection, a text-only success alert that expires, and page Sign In navigation work.");

  legacyResponse = true;
  await begin(390, "owner@gmail.com");
  await setValue('input[type=email]', "changed@gmail.com");
  await wait(`!${button("Verify")}`);
  checks.push("Legacy API responses work and changing the email removes the stale Verify action.");

  mode = "smtp";
  await begin(320);
  await click("Verify");
  await wait("document.body.innerText.includes('Failed to send OTP. Try again.')");
  await fits();
  assert.equal(await evaluate(`${button("Verify Code")}.disabled`), true);
  mode = "normal";
  await click("Send Code");
  await wait("document.body.innerText.includes('Code sent. It expires in 5 minutes.')");
  await evaluate("window.fixtureOffset = 46000");
  await wait(button("Resend Code"));
  const beforeResend = sends;
  await evaluate(`${button("Resend Code")}.click(); ${button("Resend Code")}.click()`);
  await wait("document.body.innerText.includes('Resend in') && !document.querySelector('input:disabled')");
  assert.equal(sends - beforeResend, 1);
  await fits();
  await capture("mobile-code.png");
  checks.push("At 320px SMTP failure stays actionable; Send Code and guarded resend work without overflow.");

  await evaluate("window.fixtureOffset += 301000");
  await wait("document.body.innerText.includes('This code expired.')");
  await enterCode("123456");
  assert.equal(await evaluate(`${button("Verify Code")}.disabled`), true);
  await click("Resend Code");
  await wait("!document.body.innerText.includes('This code expired.')");
  mode = "verify-limited";
  await enterCode("123456");
  await click("Verify Code");
  await wait("document.body.innerText.includes('Too many attempts. Please wait and try again.')");
  mode = "unconfirmed";
  await click("Verify Code");
  await wait("document.body.innerText.includes('Email verification was not confirmed.')");
  assert.equal(await evaluate("Boolean(document.querySelector('.rp-floating-alert'))"), false);
  mode = "normal";
  await click("Verify Code");
  await wait("document.querySelector('.rp-floating-alert')");
  assert.equal(await evaluate("document.querySelector('.rp-floating-alert button') === null"), true);
  await fits();
  await capture("mobile-success.png");
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Go to Sign In' && !b.closest('.rp-floating-alert')).click()");
  await wait("location.pathname === '/signin'");
  checks.push("Expired codes require resend; rate limits and unconfirmed responses never show success; mobile success can return to Sign In.");

  mode = "cooldown";
  await begin(768);
  await click("Verify");
  await wait("document.body.innerText.includes('Try again in 00:02.')");
  await fits();
  mode = "normal";
  await wait(button("Resend Code"));
  await click("Resend Code");
  await wait("document.body.innerText.includes('Code sent.')");
  await click("Back to Sign In");
  await wait("location.pathname === '/signin'");
  checks.push("At 768px a server resend cooldown is honored and Back to Sign In works.");

  await send("Page.navigate", { url: `${base}/verify-email` });
  await wait("document.body.innerText.includes('Return to Sign In and enter your account details')");
  await click("Back to Sign In");
  await wait("location.pathname === '/signin'");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, screenshots, sends, verifications, cancelledRequests, runtimeErrors: errors }, null, 2));
} finally {
  await send("Page.close").catch(() => {});
  ws.close();
}
