// Local browser fixtures only; no live accounts, uploads, or verification decisions.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = process.env.ACCOUNT_BASE_URL || "http://127.0.0.1:4178";
const cdp = process.env.ACCOUNT_CDP_URL || "http://127.0.0.1:9239";
const output = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-account-mobile-"));
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map(), failures = [], errors = [], checks = [], mutations = [];
let sequence = 0, user, verification, statusError = false;
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
    { name: "Access-Control-Allow-Methods", value: "GET,POST,PUT,PATCH,OPTIONS" },
  ], body: Buffer.from(JSON.stringify(body)).toString("base64"),
});
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return fulfill(requestId, {});
  if (url.host === "psgc.gitlab.io") return fulfill(requestId, []);
  if (url.pathname.startsWith("/api/")) {
    if (request.method !== "GET") {
      mutations.push(url.pathname);
      return fulfill(requestId, { message: "This layout fixture blocks account mutations." }, 503);
    }
    if (url.pathname === "/api/auth/me") return fulfill(requestId, { success: true, user });
    if (url.pathname === "/api/kyc/me") return fulfill(requestId,
      statusError ? { message: "Synthetic status outage" } : { status: user.kycStatus, verification }, statusError ? 503 : 200);
    return fulfill(requestId, { success: true, vehicles: [], bookings: [], notifications: [], conversations: [],
      unreadCount: 0, activity: [], stats: {}, settings: { email: true, bookingUpdates: true } });
  }
  if (url.pathname.startsWith("/socket.io/")) return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
  return url.origin === base ? send("Fetch.continueRequest", { requestId })
    : send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
}
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id); pending.delete(message.id);
    message.error ? call?.reject(Error(message.error.message)) : call?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") route(message.params).catch(error => {
    if (!/Invalid InterceptionId|Target closed/.test(error.message)) errors.push(error.message);
  });
  else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function wait(expression) {
  const until = Date.now() + 15000;
  while (Date.now() < until) { if (await evaluate(`Boolean(${expression})`)) return; await pause(60); }
  throw Error(`Timed out: ${expression}`);
}
const expect = (value, message) => { if (!value) failures.push(message); };
const section = title => `[...document.querySelectorAll('.rp-profile-section')].find(el => el.querySelector('h3').textContent.includes(${JSON.stringify(title)}))`;
function seed(role, status = "approved", longText = false) {
  statusError = status === "unavailable";
  user = { _id: `507f1f77bcf86cd79943901${role === "owner" ? 2 : 1}`, role,
    name: longText ? "FixtureAccountWithAnUnbrokenLongNameForResponsiveChecks" : `Fixture ${role === "owner" ? "Owner" : "Renter"}`,
    firstName: longText ? "FixtureAccountWithAnUnbrokenLongNameForResponsiveChecks" : "Fixture", lastName: role === "owner" ? "Owner" : "Renter",
    email: longText ? "long.unbroken.fixture.account.email.for.responsive.checks@example.test" : `${role}@example.test`,
    avatar: `${base}/rentifypro-logo-optimized.png`, isVerified: true, kycStatus: "approved",
    dateOfBirth: "1995-01-01", emergencyContactName: "Fixture Emergency Contact",
    emergencyContactPhone: "9123456789", emergencyContactRelationship: "Sibling", ownerType: "individual" };
  verification = { accountStatus: "active", emailVerified: true, selfieVerified: true,
    bookingEligible: status === "approved" || status === "listing-pending", listingEligible: role === "owner" && status === "approved",
    documents: [{ docType: "id", status: status === "rejected" ? "rejected" : status === "approved" ? "verified" : "pending_review" }] };
}
async function open(width, role, status = "approved", longText = false) {
  await send("Page.bringToFront");
  await send("Page.navigate", { url: "about:blank" });
  await wait("location.href === 'about:blank'");
  seed(role, status, longText);
  await send("Storage.clearDataForOrigin", { origin: base, storageTypes: "all" });
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 1024 });
  await send("Emulation.setTouchEmulationEnabled", { enabled: width < 1024, maxTouchPoints: 5 });
  await send("Page.navigate", { url: base + (role === "owner" ? "/owner-dashboard?tab=Profile" : "/account-settings") });
  await wait("document.querySelector('.rp-profile-summary')");
  await wait("!document.querySelector('.rp-profile-summary button').disabled");
  await evaluate("document.fonts.ready");
  await pause(350);
  if (role === "user") {
    await evaluate("document.querySelector('.rp-site-navbar__actions button:has(img)').click()");
    await wait("[...document.querySelectorAll('button')].some(el => el.textContent.trim() === 'Sign Out')");
  }
  await wait(statusError ? "document.querySelector('[data-verification-link]')?.textContent === 'Verification status unavailable'"
    : "!document.querySelector('[data-verification-link]')?.textContent.includes('Checking')");
}
async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(path.join(output, `${name}.png`), Buffer.from(shot.data, "base64"));
}
try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) for (const role of ["user", "owner"]) {
    await open(width, role, "approved", width === 320);
    expect(await evaluate("document.querySelector('[data-verification-link]') === null"), `${role}/${width}: completed shortcut remains visible`);
    if (role === "user") await evaluate("document.querySelector('.rp-site-navbar__actions button:has(img)').click()");
    const metrics = await evaluate(`(() => {
      const card = document.querySelector('.rp-profile-summary');
      const button = card.querySelector('button');
      const photo = card.querySelector('img').parentElement;
      const a = photo.getBoundingClientRect(), b = button.getBoundingClientRect();
      const before = getComputedStyle(button, '::before');
      const inset = before.content !== 'none' ? parseFloat(before.left) : 0;
      const visualRadius = (b.width - inset * 2) / 2;
      const distance = Math.hypot(b.x + b.width / 2 - a.x - a.width / 2, b.y + b.height / 2 - a.y - a.height / 2);
      return { cardWidth: card.clientWidth, cardScroll: card.scrollWidth, pageWidth: innerWidth,
        pageScroll: document.documentElement.scrollWidth, photoWidth: a.width,
        buttonWidth: b.width, buttonHeight: b.height, circleOverlap: a.width / 2 + visualRadius - distance,
        accessibleName: button.getAttribute('aria-label') };
    })()`);
    expect(metrics.cardScroll <= metrics.cardWidth + 1 && metrics.pageScroll <= metrics.pageWidth + 1,
      `${role}/${width}: profile overflows ${JSON.stringify(metrics)}`);
    expect(metrics.buttonWidth >= 44 && metrics.buttonHeight >= 44, `${role}/${width}: undersized photo touch target`);
    expect(Boolean(metrics.accessibleName), `${role}/${width}: photo action has no accessible name`);
    if (width < 768) expect(metrics.circleOverlap <= 2, `${role}/${width}: camera background obscures photo ${JSON.stringify(metrics)}`);
    await evaluate("document.querySelector('.rp-profile-summary button').click()");
    await wait("document.querySelector('.rp-profile-summary').textContent.includes('Upload Photo')");
    expect(await evaluate("document.querySelector('.rp-profile-summary').textContent.includes('Remove Photo')"), `${role}/${width}: photo removal unavailable`);
    await evaluate("document.querySelector('.rp-profile-summary button').click()");
    if (role === "user") {
      const emergency = section("Emergency Contact Information");
      const aligned = await evaluate(`(() => { const el=${emergency};
        const a=el.querySelector('h3').getBoundingClientRect(), b=el.querySelector('button[aria-label^="Edit "]').getBoundingClientRect();
        return Math.abs(a.y + a.height / 2 - b.y - b.height / 2) <= 2; })()`);
      expect(aligned, `user/${width}: emergency Edit is on a separate row`);
      if (width === 390) {
        await evaluate(`${emergency}.scrollIntoView({ block: 'center' })`);
        await screenshot("emergency-contact-390");
      }
      await evaluate(`${emergency}.querySelector('button[aria-label^="Edit "]').click()`);
      await wait(`${emergency}.querySelector('button[aria-label^="Save "]')`);
      expect(await evaluate(`${emergency}.querySelector('input').disabled === false`), `user/${width}: emergency contact cannot be edited`);
    } else {
      const contact = section("Contact Information");
      await evaluate(`${contact}.querySelector('button[aria-label^="Edit "]').click()`);
      await wait(`${contact}.querySelector('button[aria-label^="Cancel "]')`);
      expect(await evaluate(`${contact}.scrollWidth <= ${contact}.clientWidth + 1`), `owner/${width}: edit actions overflow`);
      await evaluate(`${contact}.querySelector('button[aria-label^="Cancel "]').click()`);
    }
    if ([390, 768, 1440].includes(width)) {
      await evaluate("scrollTo(0, 0)");
      await screenshot(`${role}-${width}`);
    }
    checks.push(`${role}/${width}: photo, profile bounds, edit controls, completed shortcut`);
  }
  for (const role of ["user", "owner"]) for (const status of ["pending", "rejected", "unavailable", ...(role === "owner" ? ["listing-pending"] : [])]) {
    await open(390, role, status);
    expect(await evaluate("Boolean(document.querySelector('[data-verification-link]'))"), `${role}/${status}: required status link was hidden`);
    expect(await evaluate("Boolean(document.querySelector('[data-verification-notice]'))"), `${role}/${status}: required verification notice was hidden`);
    await evaluate("document.querySelector('[data-verification-link]').click()");
    if (role === "user") await wait("document.querySelector('.rp-account-selector select').value === 'Verification'");
    await wait(status === "unavailable" ? "document.body.innerText.includes('Synthetic status outage')"
      : "document.querySelector('[data-account-verification]')");
    checks.push(`${role}/${status}: status link opens verification details and notice stays available`);
  }
  assert.deepEqual(mutations, [], "Layout checks must never mutate accounts");
  assert.deepEqual(errors, [], "Browser runtime errors");
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ fixtureOnly: true, checks, failures, errors, mutations }, null, 2));
  console.log(JSON.stringify({ fixtureOnly: true, checks: checks.length, failures, errors, output }, null, 2));
  assert.deepEqual(failures, []);
} catch (error) {
  await screenshot("failure").catch(() => {});
  console.error(JSON.stringify({ output, failures, errors, text: await evaluate("document.body.innerText.slice(0, 1800)").catch(() => "") }, null, 2));
  throw error;
} finally {
  await send("Page.close").catch(() => {});
  ws.close();
}
