// Requires local Vite on 4178 and an isolated Chrome debugging endpoint on 9239.
// All account, verification, and location responses are fixtures; no live account is updated.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = "http://127.0.0.1:4178";
const reportDir = "docs/reports/owner-account-settings-fix-2026-10-10";
await fs.mkdir(reportDir, { recursive: true });
const target = await (await fetch("http://127.0.0.1:9239/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0, profileDelay = 0, geoDelay = 0, profileFailure = "", geoFailure = false;
let preferencesFailure = false, activityFailure = false, passwordFailure = false, preferenceSaveFailure = false;
const pending = new Map(), errors = [], checks = [], requests = [];
const initialUser = {
  _id: "507f1f77bcf86cd799439011", name: "Fixture Owner", email: "owner@example.test",
  role: "owner", isVerified: true, kycStatus: "approved", ownerType: "business",
  phone: "9123456789", address: "12 Fixture Street, Fixture City", region: "R", province: "P", city: "C", barangay: "B",
  businessName: "Fixture Rentals", permitNumber: "PERMIT-123", licenseNumber: "",
  avatar: `${base}/rentifypro-logo-optimized.png`,
};
let user = { ...initialUser }, settings = { email: true, bookingUpdates: true };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
async function fulfill(requestId, body, status = 200) {
  return send("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [
    { name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,PUT,PATCH,OPTIONS" },
  ], body: Buffer.from(JSON.stringify(body)).toString("base64") });
}
async function route({ requestId, request }) {
  const url = new URL(request.url), path = url.pathname;
  if (request.method === "OPTIONS") return fulfill(requestId, {});
  if (url.host === "psgc.gitlab.io") {
    if (path === "/api/regions/") return fulfill(requestId, [{ code: "R", name: "Fixture Region" }, { code: "N", name: "Fixture Region Without Provinces" }]);
    if (path === "/api/regions/R/provinces/") return fulfill(requestId, [{ code: "P", name: "Fixture Province" }]);
    if (path === "/api/regions/N/provinces/") {
      if (geoDelay) await pause(geoDelay);
      return fulfill(requestId, geoFailure ? { message: "Unavailable" } : [], geoFailure ? 503 : 200);
    }
    if (path === "/api/regions/N/cities-municipalities/") return fulfill(requestId, [{ code: "NC", name: "Fixture Direct City" }]);
    if (path === "/api/provinces/P/cities-municipalities/") return fulfill(requestId, [{ code: "C", name: "Fixture City" }]);
    if (path === "/api/cities-municipalities/C/barangays/") return fulfill(requestId, [{ code: "B", name: "Fixture Barangay" }]);
    if (path === "/api/cities-municipalities/NC/barangays/") return fulfill(requestId, [{ code: "NB", name: "Fixture Direct Barangay" }]);
    throw new Error(`Unexpected location fixture route: ${path}`);
  }
  if (path.startsWith("/api/")) {
    if (path === "/api/auth/me") return fulfill(requestId, { success: true, user });
    if (path === "/api/kyc/me") return fulfill(requestId, { status: user.kycStatus, remarks: "Simulated verification status" });
    if (path === "/api/auth/profile") {
      const body = JSON.parse(request.postData); requests.push({ path, body });
      if (profileDelay) await pause(profileDelay);
      if (profileFailure === "phone") return fulfill(requestId, { message: "This phone number is already registered.", errors: { phone: "This phone number is already registered." } }, 409);
      if (profileFailure === "avatar") return fulfill(requestId, { message: "Simulated photo service unavailable." }, 503);
      Object.assign(user, body, Object.hasOwn(body, "avatar") ? { avatar: body.avatar ? `${base}/rentifypro-logo-optimized.png?updated` : "" } : {});
      return fulfill(requestId, { success: true, user });
    }
    if (path === "/api/auth/change-password") {
      requests.push({ path, fields: Object.keys(JSON.parse(request.postData)) });
      return fulfill(requestId, passwordFailure ? { message: "Current password is incorrect.", code: "CURRENT_PASSWORD_INCORRECT" } : { success: true, message: "Password updated successfully." }, passwordFailure ? 400 : 200);
    }
    if (path === "/api/auth/notification-settings") {
      if (request.method === "PUT") {
        const body = JSON.parse(request.postData); requests.push({ path, body });
        if (preferenceSaveFailure) return fulfill(requestId, { message: "Simulated preferences save unavailable." }, 503);
        settings = body;
      } else if (preferencesFailure) return fulfill(requestId, { message: "Simulated preference service unavailable." }, 503);
      return fulfill(requestId, { settings: { ...settings, sms: true, promotions: true } });
    }
    if (path === "/api/auth/login-activity") return fulfill(requestId, activityFailure ? { message: "Simulated sign-in service unavailable." } : { activity: [{ _id: "fixture", createdAt: "2026-10-10T09:00:00Z", ip: "192.0.2.1", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36" }] }, activityFailure ? 503 : 200);
    return fulfill(requestId, { success: true, renters: [], vehicles: [], bookings: [], conversations: [], notifications: [], unreadCount: 0, total: 0, stats: {} });
  }
  if (url.origin === base) return send("Fetch.continueRequest", { requestId });
  return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
}
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id); pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") {
    void route(message.params).catch((error) => { if (!/Invalid InterceptionId/.test(error.message)) errors.push(error.message); });
  } else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
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
const section = (name) => `[...document.querySelectorAll('.rp-profile-section')].find(el => el.textContent.includes(${JSON.stringify(name)}))`;
const actionButton = (name, action) => `${section(name)}.querySelector('button[aria-label=${JSON.stringify(`${action} ${name}${action === "Cancel" ? " changes" : ""}`)}]')`;
async function action(name, verb) {
  const button = actionButton(name, verb);
  await wait(`${button} && !${button}.disabled`); await evaluate(`${button}.click()`);
}
async function click(text) {
  const button = `[...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)} && !el.disabled)`;
  await wait(button); await evaluate(`${button}.click()`);
}
async function setField(label, value) {
  const field = `[...document.querySelectorAll('label')].find(el => el.textContent.trim() === ${JSON.stringify(label)})?.control`;
  await wait(`${field} && !${field}.disabled`);
  await evaluate(`(() => { const el=${field}; const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true})); })()`);
}
async function load(width = 1280, tab = "Profile") {
  await send("Emulation.setDeviceMetricsOverride", { width, height: width < 768 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 768 });
  await send("Page.navigate", { url: `${base}/owner-dashboard?tab=${tab}` });
  await wait("document.querySelectorAll('.rp-profile-section').length === 4");
  await wait(hasText("Simulated verification status"));
  await wait(`${actionButton("Contact Information", "Edit")} && !${actionButton("Contact Information", "Edit")}.disabled`);
}
async function openDetails(label) {
  await evaluate(`(() => { const el=[...document.querySelectorAll('details')].find(el=>el.querySelector('summary')?.textContent.trim()===${JSON.stringify(label)}); el.open=true; })()`);
  await pause(100);
}
async function uploadPhoto() {
  await evaluate(`(async () => { const canvas=document.createElement('canvas');canvas.width=40;canvas.height=40;
    canvas.getContext('2d').fillRect(0,0,40,40);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const transfer=new DataTransfer();transfer.items.add(new File([blob],'fixture-photo.png',{type:'image/png'}));
    const el=document.querySelector('input[type=file]');el.files=transfer.files;el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
}
async function screenshot(name) {
  const capture = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(`${reportDir}/${name}.png`, Buffer.from(capture.data, "base64"));
}
try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.WebSocket=class extends WebSocket { constructor(url,protocols) { super(new URL(url,location.href).host===location.host?url:'ws://127.0.0.1:1',protocols); } };` });
  await load();
  assert.equal(await evaluate(`${section("Personal Information")}.querySelector('.rp-btn-secondary') === null`), true);
  assert.equal(await evaluate(`${section("Business Information")}.querySelector('.rp-btn-secondary') === null`), true);
  assert.equal(await evaluate("[...document.querySelectorAll('.rp-profile-section input,.rp-profile-section select')].every(el=>el.labels.length===1)"), true);
  checks.push("Registered identity/business fields are read-only and all profile fields have associated labels.");

  await action("Contact Information", "Edit");
  const beforeValidation = requests.length;
  await setField("Phone Number", "99"); await action("Contact Information", "Save"); await wait(hasText("Check the highlighted fields"));
  assert.equal(requests.length, beforeValidation);
  await setField("Phone Number", "+639234567890");
  profileFailure = "phone";
  await action("Contact Information", "Save"); await wait(hasText("This phone number is already registered."));
  await wait(`${actionButton("Contact Information", "Save")} && !${actionButton("Contact Information", "Save")}.disabled`);
  assert.equal(await evaluate(`${section("Contact Information")}.querySelectorAll('input')[1].value`), "9234567890");
  const storedPhone = await evaluate("import('/src/owner/utils/ownerProfile.js').then(m=>m.getOwnerProfileFromStorage().phone)");
  assert.equal(storedPhone, initialUser.phone); assert.equal(user.phone, initialUser.phone);
  checks.push("Invalid phones are blocked locally; rejected saves keep an editable draft and the confirmed profile unchanged.");
  await action("Location Information", "Edit"); await action("Contact Information", "Edit");
  assert.equal(await evaluate(`${section("Contact Information")}.querySelectorAll('input')[1].value`), "9234567890");
  profileFailure = ""; profileDelay = 700;
  await action("Contact Information", "Save");
  await wait(`${section("Contact Information")}.textContent.includes('Saving...')`);
  assert.equal(await evaluate(`${actionButton("Location Information", "Edit")}.disabled`), true);
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Change profile photo\"]').disabled"), true);
  await wait(hasText("Profile updated successfully."));
  profileDelay = 0;
  checks.push("Switching sections preserves drafts; an in-flight save blocks conflicting edits and photo writes.");

  await action("Location Information", "Edit");
  await setField("Region", "N");
  await wait(`${section("Location Information")}.querySelectorAll('select')[2].options.length===2`);
  await setField("City / Municipality", "NC");
  await wait(`${section("Location Information")}.querySelectorAll('select')[3].options.length===2`);
  await setField("Barangay", "NB"); await setField("Full Address", "13 Fixture Street, Fixture Direct City");
  await action("Location Information", "Save"); await wait(hasText("Profile updated successfully."));
  assert.equal(user.province, ""); assert.equal(user.city, "NC"); assert.equal(user.kycStatus, "approved");
  checks.push("A region without provinces loads its cities and barangays and saves without changing KYC approval.");

  user = { ...initialUser }; await load(); await action("Location Information", "Edit");
  geoDelay = 600; await setField("Region", "N"); await pause(100); await setField("Region", "R");
  await wait(`${section("Location Information")}.querySelectorAll('select')[1].options.length===2`);
  await setField("Province", "P");
  await wait(`${section("Location Information")}.querySelectorAll('select')[2].options.length===2`);
  await pause(700);
  assert.equal(await evaluate(`${section("Location Information")}.querySelectorAll('select')[2].options[1].value`), "C");
  geoDelay = 0; geoFailure = true; await setField("Region", "N"); await wait(hasText("Location options are unavailable."));
  assert.equal(await evaluate(`${section("Location Information")}.querySelectorAll('select')[2].disabled`), true);
  assert.equal(await evaluate(hasText("Province (Not required)")), false);
  geoFailure = false; await click("Retry location options");
  await wait(`${section("Location Information")}.querySelectorAll('select')[2].options.length===2`);
  await action("Location Information", "Cancel");
  checks.push("Stale location responses are ignored; loading failures stay distinct from a province-free region and can be retried.");

  profileFailure = "avatar"; const previousAvatar = user.avatar;
  await uploadPhoto(); await wait(hasText("Simulated photo service unavailable."));
  assert.equal(await evaluate("document.querySelector('.rp-profile-summary img').getAttribute('src')"), previousAvatar);
  assert.equal(await evaluate("import('/src/owner/utils/ownerProfile.js').then(m=>m.getOwnerProfileFromStorage().avatar)"), previousAvatar);
  profileFailure = ""; await uploadPhoto(); await wait(hasText("Profile photo updated."));
  assert.equal(await evaluate("document.querySelector('.rp-profile-summary img').getAttribute('src')"), user.avatar);
  await evaluate("document.querySelector('[aria-label=\"Change profile photo\"]').click()");
  await wait("document.activeElement.textContent.trim()==='Upload Photo'");
  await send("Input.dispatchKeyEvent", { type:"keyDown",key:"Escape",code:"Escape" });
  await wait("document.activeElement.getAttribute('aria-label')==='Change profile photo'");
  checks.push("Failed photo updates keep the old photo, successful updates use the server URL, and the photo menu supports focus and Escape.");

  preferencesFailure = true; await openDetails("Notification Preferences"); await wait(hasText("Simulated preference service unavailable."));
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(el=>el.textContent==='Save preferences').disabled"), true);
  preferencesFailure = false; await click("Retry notification preferences");
  await wait("document.querySelector('input[type=checkbox]').checked");
  await evaluate("document.querySelector('input[type=checkbox]').click()");
  assert.equal(await evaluate("document.querySelectorAll('input[type=checkbox]')[1].disabled"), true);
  preferenceSaveFailure = true; await click("Save preferences"); await wait(hasText("Simulated preferences save unavailable."));
  assert.equal(settings.email, true); assert.equal(await evaluate("document.querySelector('input[type=checkbox]').checked"), false);
  preferenceSaveFailure = false; await click("Save preferences"); await wait(hasText("Notification preferences saved."));
  assert.deepEqual(Object.keys(settings).sort(), ["bookingUpdates", "email"]);
  assert.equal(settings.email, false);
  checks.push("Notification load/save errors preserve choices; only supported email and booking preferences are submitted.");

  await openDetails("Change Password");
  await setField("Current Password", "OldPassword1!"); await setField("New Password", "NewPassword1!"); await setField("Confirm New Password", "DifferentPassword1!");
  await click("Update Password"); await wait(hasText("New password and confirmation do not match."));
  await setField("Confirm New Password", "NewPassword1!"); passwordFailure = true;
  await click("Update Password"); await wait(hasText("Current password is incorrect."));
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Change profile photo\"]') !== null"), true);
  passwordFailure = false; await click("Update Password"); await wait(hasText("Password updated successfully."));
  assert.equal(await evaluate("document.querySelector('#owner-newPassword').value"), "");
  assert.deepEqual(requests.filter(entry=>entry.path==='/api/auth/change-password').at(-1).fields.sort(), ["currentPassword","newPassword"]);
  checks.push("Password mismatch and incorrect-current-password errors preserve the session; success clears the password fields.");

  activityFailure = true; await openDetails("Recent sign-ins"); await wait(hasText("Simulated sign-in service unavailable."));
  activityFailure = false; await click("Refresh sign-ins"); await wait(hasText("Chrome on Windows"));
  assert.equal(await evaluate(hasText("Mozilla/5.0")), false);
  checks.push("Recent sign-ins have error/retry states and readable device labels.");

  for (const status of ["not_started", "rejected", "challenge_passed", "approved"]) {
    user = { ...initialUser, kycStatus: status }; await load();
    assert.equal(await evaluate("Boolean(document.querySelector('.rp-profile-summary .lucide-badge-check'))"), status === "approved");
    assert.equal(await evaluate(hasText("Business Permit")), false);
  }
  checks.push("Verification indicators follow actual KYC state and no document-specific status is invented.");
  for (const width of [320,390,768,1280]) {
    user = { ...initialUser, name: "Fixture Account With A Very Long Owner Name", email:"long.owner.email.for.responsive.assessment@example.test" };
    await load(width);
    const metrics = await evaluate("(() => {const main=document.querySelector('main');const card=document.querySelector('.rp-profile-summary');return {width:innerWidth,mainWidth:main.clientWidth,mainScroll:main.scrollWidth,cardWidth:card.clientWidth,cardScroll:card.scrollWidth};})()");
    assert.ok(metrics.mainScroll <= metrics.mainWidth + 1,JSON.stringify(metrics));
    assert.ok(metrics.cardScroll <= metrics.cardWidth + 1,JSON.stringify(metrics));
    await action("Contact Information", "Edit");
    assert.equal(await evaluate(`${section("Contact Information")}.querySelectorAll('input')[1].getBoundingClientRect().height >= 44`), true);
    await action("Contact Information", "Cancel");
    await screenshot(`owner-settings-${width}`);
    checks.push(`${width}px: long profile text stays within its card, editable phone fields have 44px height, and Cancel works.`);
  }
  await load(1280,"Settings");
  checks.push("The existing Settings route opens the working account page instead of a placeholder.");
  assert.deepEqual(errors,[]);
  const result = { simulated:true,liveAccountsChanged:false,checks,runtimeErrors:errors };
  await fs.writeFile(`${reportDir}/browser-results.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} catch (error) {
  await screenshot("failure");
  console.error(JSON.stringify({checks,runtimeErrors:errors,message:error.message},null,2));
  throw error;
} finally {
  await new Promise(resolve=>{ws.onclose=resolve;ws.close();});
  await fetch(`http://127.0.0.1:9239/json/close/${target.id}`);
}
