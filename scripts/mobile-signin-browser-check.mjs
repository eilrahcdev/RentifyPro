// Local browser fixtures only; no real accounts, email, documents or payments.
// Run Vite on 4186 and an isolated CDP browser on 9246.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = process.env.BROWSER_CHECK_BASE || "http://127.0.0.1:4186";
const debug = process.env.BROWSER_CHECK_CDP || "http://127.0.0.1:9246";
const target = await (await fetch(debug + "/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0, signedIn = false, denyCookie = false, holdProfile = false, statusFailure = false;
let user, verification;
let profileReads = 0, logoutCalls = 0;
const pending = new Map(), heldProfiles = [], errors = [], checks = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
const fulfill = (requestId, data, status = 200) => send("Fetch.fulfillRequest", { requestId, responseCode: status,
  responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Cache-Control", value: "no-store" }],
  body: Buffer.from(JSON.stringify(data)).toString("base64") });
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname === "/api/auth/me") {
      profileReads += 1;
      if (signedIn && holdProfile) { heldProfiles.push(requestId); return; }
      return signedIn && !denyCookie ? fulfill(requestId, { success: true, user }) : fulfill(requestId, { message: "Please log in." }, 401);
    }
    if (url.pathname === "/api/auth/login-challenge") return fulfill(requestId, { challengeId: "fixture", question: "2 + 3" });
    if (url.pathname === "/api/auth/login") { signedIn = true; return fulfill(requestId, { success: true, user }); }
    if (url.pathname === "/api/auth/logout") { logoutCalls += 1; signedIn = false; return fulfill(requestId, { success: true }); }
    if (url.pathname === "/api/kyc/me") return statusFailure ? fulfill(requestId, { message: "Synthetic status outage" }, 503)
      : fulfill(requestId, { status: user.kycStatus, verification });
    if (url.pathname === "/api/auth/notification-settings") return fulfill(requestId, { settings: { email: true, bookingUpdates: true } });
    return fulfill(requestId, { success: true, stats: {}, summary: {}, vehicles: [], bookings: [], reviews: [], activity: [], notifications: [], conversations: [], unreadCount: 0, total: 0 });
  }
  if (url.pathname.startsWith("/socket.io/")) return fulfill(requestId, { message: "Socket disabled in UI fixtures" }, 400);
  if (url.origin === base) return send("Fetch.continueRequest", { requestId });
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
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result?.value;
};
async function wait(expression, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await evaluate(`Boolean(${expression})`).catch(() => false)) return; await pause(80); }
  throw Error(`Timed out: ${expression}; ${await evaluate("document.body.innerText.slice(-1500)")}`);
}
const setValue = (selector, value) => evaluate(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
function seed(role, approved = false) {
  signedIn = false; denyCookie = false; holdProfile = false; statusFailure = false;
  user = { _id: "507f1f77bcf86cd799439011", role, name: "Synthetic Applicant", email: "fixture@gmail.com", isVerified: true,
    kycStatus: approved ? "approved" : "challenge_passed", ownerType: "individual", dateOfBirth: "1995-01-01", phone: "9123456789" };
  verification = { accountStatus: "active", emailVerified: true, selfieVerified: true, ownerAccount: role === "owner",
    documentApprovalComplete: approved, bookingEligible: approved, listingEligible: role === "owner" && approved,
    documents: ["id", ...(role === "owner" ? ["supporting"] : [])].map(docType => ({ docType, reference: `synthetic-${docType}`,
      documentRevision: "fixture-v1", selectedDocCategory: docType === "id" ? "Philippine Passport" : "DTI Business Name Registration",
      status: approved ? "verified" : "pending_review", reason: "" })) };
}
async function startSignIn() {
  await send("Page.navigate", { url: base + "/signin" });
  await wait("document.querySelector('input[type=email]') && !document.querySelector('[aria-label=\"Loading your account\"]')");
  await wait("document.querySelector('input[inputmode=numeric]') && !document.querySelector('input[inputmode=numeric]').disabled");
  await setValue("input[type=email]", user.email);
  await setValue("input[type=password]", "FixturePass1!");
  await setValue("input[inputmode=numeric]", "5");
  await evaluate("document.querySelector('form').requestSubmit()");
}

try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
  seed("user"); denyCookie = true;
  await startSignIn();
  await wait("document.body.innerText.includes('Your browser could not keep your sign-in')");
  assert.equal(await evaluate("location.pathname"), "/signin");
  assert.equal(await evaluate("Boolean(document.querySelector('[data-verification-notice]'))"), false);
  checks.push("Missing session stays on sign-in with an actionable error");

  for (const role of ["user", "owner"]) for (const approved of [false, true]) {
    seed(role, approved); holdProfile = true;
    await startSignIn();
    const until = Date.now() + 10000;
    while (!heldProfiles.length && Date.now() < until) await pause(50);
    assert.ok(heldProfiles.length, "Sign-in must verify the profile before navigation");
    assert.equal(await evaluate("location.pathname"), "/signin");
    assert.equal(await evaluate("Boolean(document.querySelector('[data-verification-notice]'))"), false);
    holdProfile = false;
    for (const id of heldProfiles.splice(0)) await fulfill(id, { success: true, user });
    await wait(role === "owner" ? "location.pathname === '/owner-dashboard'" : "location.pathname === '/'");
    if (role === "user") {
      await evaluate("[...document.querySelectorAll('nav button')].find(button=>button.textContent.includes('Synthetic Applicant')).click()");
    }
    await wait("document.querySelector('[data-verification-link]') && document.querySelector('[data-verification-link]').textContent !== 'Checking verification'");
    if (role === "user" && !approved) {
      await evaluate("[...document.querySelectorAll('nav button')].find(button=>button.textContent.includes('Synthetic Applicant')).click()");
    }
    const previousReads = profileReads;
    await send("Page.reload");
    const reloadDeadline = Date.now() + 10000;
    while (profileReads === previousReads && Date.now() < reloadDeadline) await pause(50);
    assert.ok(profileReads > previousReads, "Reload must check the cookie-backed profile");
    await wait(role === "owner" ? "document.querySelector('.rp-owner-workspace') && !document.querySelector('[aria-label=\"Loading your account\"]')"
      : "document.querySelector('nav')?.textContent.includes('Synthetic Applicant') && !document.querySelector('[aria-label=\"Loading your account\"]')");
    if (role === "user" && approved) await evaluate("[...document.querySelectorAll('nav button')].find(button=>button.textContent.includes('Synthetic Applicant')).click()");
    if (approved) {
      await wait("document.querySelector('[data-verification-link]')?.textContent === 'Verification Complete'");
      assert.equal(await evaluate("Boolean(document.querySelector('[data-verification-notice]'))"), false);
    } else {
      await wait("document.querySelector('[data-verification-notice]')?.textContent.includes('Verification Pending')");
      for (const width of [320, 390, 768, 1440]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
        await pause(350);
        assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"), `${role} overflow at ${width}`);
        const size = await evaluate("(() => {const r=document.querySelector('[data-verification-notice] button').getBoundingClientRect(); return {w:r.width,h:r.height};})()");
        assert.ok(size.h >= 44 && size.w >= 44);
        const visibility = await evaluate("(() => {const b=document.querySelector('[data-verification-notice] button'),v=b.getBoundingClientRect(),hit=document.elementFromPoint(v.left+v.width/2,v.top+v.height/2);return {visible:b.contains(hit),top:v.top,bottom:v.bottom,hit:hit?.outerHTML.slice(0,220)};})()");
        if (!visibility.visible) {
          await fs.mkdir(new URL("../frontend/.vite/", import.meta.url), { recursive: true });
          const shot = await send("Page.captureScreenshot", { format: "png" });
          await fs.writeFile(new URL(`../frontend/.vite/signin-${role}-covered.png`, import.meta.url), Buffer.from(shot.data, "base64"));
        }
        assert.ok(visibility.visible, `${role} notice action must not be covered at ${width}: ${JSON.stringify(visibility)}`);
        await evaluate("window.scrollTo(0,0)");
        if (width === 390 || width === 1440) {
          await fs.mkdir(new URL("../frontend/.vite/", import.meta.url), { recursive: true });
          const shot = await send("Page.captureScreenshot", { format: "png" });
          await fs.writeFile(new URL(`../frontend/.vite/signin-${role}-${width}.png`, import.meta.url), Buffer.from(shot.data, "base64"));
        }
      }
      await evaluate("document.querySelector('[data-verification-notice] button').click()");
      await wait(role === "owner" ? "location.search.includes('tab=Profile') && document.querySelector('[data-account-verification]')"
        : "location.pathname === '/account-settings' && document.querySelector('[data-account-verification]')");
      assert.equal(await evaluate("location.hash"), "#verification-status");
      statusFailure = true;
      await evaluate("window.dispatchEvent(new Event('focus'))");
      await wait("document.querySelector('[data-verification-notice]')?.textContent.includes('Verification status unavailable')");
      statusFailure = false;
      user.kycStatus = "approved"; verification.bookingEligible = true; verification.listingEligible = role === "owner";
      verification.documentApprovalComplete = true; verification.documents.forEach(document => { document.status = "verified"; });
      await evaluate("[...document.querySelectorAll('[data-verification-notice] button')].find(button=>button.textContent==='Retry status check').click()");
      await wait("!document.querySelector('[data-verification-notice]')");
      checks.push(`${role} pending notice fits four widths, opens status, handles outages and clears after approval`);
    }
    checks.push(`${role}/${approved ? "approved" : "pending"} enters only after the profile confirms its session`);
    if (role === "user" && !approved) await evaluate("[...document.querySelectorAll('nav button')].find(button=>button.textContent.includes('Synthetic Applicant')).click()");
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Sign Out').click()");
    await wait("document.querySelector('.rp-modal-layer')");
    const previousLogouts = logoutCalls;
    await evaluate("(() => {const button=[...document.querySelectorAll('.rp-modal-layer button')].find(button=>button.textContent.trim()==='Sign Out');button.click();button.click();})()");
    await wait("!document.querySelector('[aria-label=\"Signing out\"]') && !document.querySelector('[aria-label=\"Loading your account\"]') && !document.querySelector('[data-verification-notice]') && (location.pathname === '/signin' || document.body.innerText.includes('Sign In'))");
    assert.equal(logoutCalls, previousLogouts + 1);
    checks.push(`${role}/${approved ? "approved" : "pending"} restores after refresh and signs out once without restoring the old session`);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, runtimeErrors: errors }, null, 2));
} finally {
  await send("Page.close").catch(() => {}); ws.close();
}
