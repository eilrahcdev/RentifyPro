// Uses synthetic account, document and provider responses. Vite: 4176, isolated Chrome CDP: 9236.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = "http://127.0.0.1:4176", pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const statusOnly = process.argv.includes("--status-only");
const edgesOnly = process.argv.includes("--edges-only") || statusOnly;
const target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map(), errors = [], checks = [], uploads = [];
let sequence = 0, user, verification, backendKycStatus, statusFailure = "", invalidResponse = false, interrupted = false;
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const fulfill = (requestId, value, status = 200) => send("Fetch.fulfillRequest", { requestId, responseCode: status,
  responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,PUT,PATCH,OPTIONS" }], body: Buffer.from(JSON.stringify(value)).toString("base64") });
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return fulfill(requestId, {});
  if (url.host === "psgc.gitlab.io") return fulfill(requestId, []);
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname === "/api/auth/me") return fulfill(requestId, { success: true, user });
    if (url.pathname === "/api/kyc/me") {
      const failure = statusFailure; statusFailure = "";
      if (failure === "network") return send("Fetch.failRequest", { requestId, errorReason: "ConnectionReset" });
      if (failure === "malformed") return fulfill(requestId, {});
      if (failure === "session") return fulfill(requestId, { message: "Your session expired. Sign in again." }, 401);
      return fulfill(requestId, { status: backendKycStatus, remarks: "Synthetic document review status.", verification });
    }
    if (url.pathname.startsWith("/api/vehicles/") && url.pathname.split("/").at(-1) === "507f1f77bcf86cd799439099") return fulfill(requestId, { success: true, vehicle: {
      _id: "507f1f77bcf86cd799439099", name: "Synthetic Verification Vehicle", owner: { _id: "507f1f77bcf86cd799439090", name: "Synthetic Owner", verified: true },
      availabilityStatus: "available", dailyRentalRate: 1200, pricingUnit: "day", images: [], specs: { seats: 4 } } });
    if (url.pathname === "/api/bookings/eligibility") return fulfill(requestId, { success: true, eligibility: { eligible: verification.bookingEligible, verification,
      counts: { open: 0, pending: 0 }, limits: { open: 3, pending: 2 }, reasons: verification.bookingEligible ? [] : [{ code: "IDENTITY_VERIFICATION_REQUIRED", message: "All required approvals must be complete." }] } });
    if (url.pathname === "/api/auth/notification-settings") return fulfill(requestId, { success: true, settings: { email: true, bookingUpdates: true } });
    if (url.pathname.startsWith("/api/kyc/documents/")) {
      uploads.push({ docType: url.pathname.split("/").at(-1), body: JSON.parse(request.postData) });
      if (invalidResponse) { invalidResponse = false; return fulfill(requestId, {}); }
      const doc = verification.documents.find(entry => entry.docType === uploads.at(-1).docType);
      const body = uploads.at(-1).body;
      if (body.document_revision && !body.id_image_base64) {
        assert.equal(body.document_revision, doc.documentRevision);
        doc.faceSetupRequired = false; doc.identityReadyForSelfie = true;
        return fulfill(requestId, { success: true });
      }
      doc.status = "pending_review"; doc.documentRevision = `replacement-${uploads.length}`; doc.reason = "Replacement awaiting admin review.";
      if (doc.docType === "id") { verification.selfieVerified = false; doc.faceSetupRequired = interrupted; doc.identityReadyForSelfie = false; user.kycStatus = "id_uploaded"; }
      else user.kycStatus = "challenge_passed";
      backendKycStatus = user.kycStatus;
      verification.bookingEligible = false; verification.listingEligible = false;
      if (interrupted) { interrupted = false; return send("Fetch.failRequest", { requestId, errorReason: "ConnectionReset" }); }
      return fulfill(requestId, { success: true, message: "Replacement saved for review." });
    }
    return fulfill(requestId, { success: true, vehicles: [], bookings: [], notifications: [], count: 0, activity: [] });
  }
  return url.origin === base ? send("Fetch.continueRequest", { requestId }) : send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
}
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) { const call = pending.get(message.id); pending.delete(message.id); message.error ? call?.reject(Error(message.error.message)) : call?.resolve(message.result); }
  else if (message.method === "Fetch.requestPaused") route(message.params).catch(error => { if (error.message !== "Invalid InterceptionId.") errors.push(error.message); });
  else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};
const evaluate = async expression => {
  const value = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
  return value.result?.value;
};
async function key(key, code, virtualKey) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: virtualKey });
  if (key === "Enter") await send("Input.dispatchKeyEvent", { type: "char", key, text: "\r", unmodifiedText: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtualKey });
}
async function wait(expression, timeout = 16000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await evaluate(`Boolean(${expression})`).catch(() => false)) return; await pause(80); }
  throw Error(`Timed out: ${expression}. ${await evaluate("JSON.stringify({url:location.href,width:innerWidth,body:document.body.innerText.slice(-1000)})")} Fixture: ${user?.role}/${user?.kycStatus}. Runtime errors: ${JSON.stringify(errors)}`);
}
const surface = "document.querySelector('[data-account-verification]')";
async function click(label) {
  const button = `[...document.querySelectorAll('button')].find(element => element.innerText.trim() === ${JSON.stringify(label)} && !element.disabled)`;
  await wait(button); await evaluate(`${button}.click()`);
}
function seed(role, status) {
  user = { _id: "507f1f77bcf86cd799439011", name: "Synthetic Applicant", email: "fixture@gmail.com", role,
    isVerified: true, kycStatus: status === "approved" ? "approved" : status === "rejected" ? "rejected" : "challenge_passed",
    dateOfBirth: "1995-01-01", ownerType: "business", businessName: "Synthetic Rentals", permitNumber: "TEST123", phone: "9123456789" };
  verification = { accountStatus: "active", emailVerified: true, selfieVerified: true, ownerAccount: role === "owner",
    bookingEligible: status === "approved", listingEligible: role === "owner" && status === "approved",
    documents: ["id", ...(role === "owner" ? ["supporting"] : [])].map(docType => ({ docType, reference: `fixture-${docType}`,
      documentRevision: `${docType}-v1`, selectedDocCategory: docType === "id" ? "Philippine Passport" : "DTI Business Name Registration",
      status: status === "approved" || (role === "owner" && docType === "id") ? "verified" : status === "rejected" ? "rejected" : "pending_review",
      reason: status === "rejected" && docType !== "id" ? "Upload a readable business permit." : "Synthetic review status.", identityReadyForSelfie: docType === "id" })) };
  backendKycStatus = user.kycStatus;
}
async function navigate(role, reload = false) {
  const previous = await evaluate("window.verificationFixturePage");
  if (reload) await send("Page.reload", { ignoreCache: true });
  else await send("Page.navigate", { url: base + (role === "owner" ? "/owner-dashboard?tab=Profile" : "/account-settings") });
  await wait(`window.verificationFixturePage !== ${JSON.stringify(previous)}`);
  if (role === "user" && user.kycStatus === "approved") await click("Verification");
  await wait(surface); await wait(`!${surface}.querySelector('button')?.disabled`);
}
async function chooseFile() {
  await evaluate(`(() => { const canvas=document.createElement('canvas'); canvas.width=800; canvas.height=600;
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,800,600);context.fillStyle='#111';context.font='40px sans-serif';context.fillText('SYNTHETIC TEST IMAGE',40,100);
    const bytes=Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),char=>char.charCodeAt(0));
    const transfer=new DataTransfer();transfer.items.add(new File([bytes],'synthetic-document.png',{type:'image/png'}));
    const field=document.querySelector('#account-document-file');field.files=transfer.files;field.dispatchEvent(new Event('change',{bubbles:true})); })()`);
}
try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `if(location.origin===${JSON.stringify(base)}){localStorage.clear();sessionStorage.clear();}window.verificationFixturePage=Math.random();` });
  for (const width of edgesOnly ? [] : [320, 390, 768, 1200]) for (const role of ["user", "owner"]) for (const status of ["pending", "approved", "rejected"]) {
    await send("Page.navigate", { url: "about:blank" }); await wait("location.href === 'about:blank'"); seed(role, status);
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await navigate(role);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
    assert.equal(await evaluate(`${surface}.innerText.includes('Account access') && ${surface}.innerText.includes('Verified')`), true);
    assert.equal(await evaluate(`${surface}.innerText.includes('Locked until')`), status !== "approved");
    await navigate(role, true); assert.equal(await evaluate(`${surface}.querySelectorAll('button').length`), verification.documents.length);
    checks.push(`${role} ${status} account access and independent documents restore at ${width}px`);
    if (status === "rejected" && [390, 1200].includes(width)) {
      await evaluate(`${surface}.scrollIntoView({block:'start'})`);
      const screenshot = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(path.join(os.tmpdir(), `rentifypro-${role}-document-review-${width}.png`), Buffer.from(screenshot.data, "base64"));
    }
  }
  for (const role of statusOnly ? [] : ["user", "owner"]) {
    await send("Page.navigate", { url: "about:blank" }); await wait("location.href === 'about:blank'"); seed(role, "rejected");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate(role); await click(role === "owner" ? "Replace business document" : "Replace ID");
    const beforeCancel = uploads.length;
    await click("Cancel replacement"); assert.equal(await evaluate("Boolean(document.querySelector('#account-document-file'))"), false);
    assert.equal(uploads.length, beforeCancel);
    checks.push(`${role} cancelling replacement leaves the saved document unchanged`);
    await click(role === "owner" ? "Replace business document" : "Replace ID");
    await wait("document.querySelector('#account-document-file')"); await chooseFile();
    invalidResponse = true; const before = uploads.length;
    await evaluate(`(() => { const button=${surface}.querySelector('button[type=submit]'); button.click(); button.click(); })()`);
    await wait(`${surface}.querySelector('[role=alert]') && !${surface}.querySelector('button[type=submit]').disabled`);
    assert.equal(uploads.length, before + 1); assert.equal(verification.documents.at(-1).status, "rejected");
    checks.push(`${role} duplicate submit clicks produce one document request`);
    checks.push(`${role} malformed upload response preserves selected file and correction status`);
    interrupted = true; await click("Submit replacement");
    await wait(`${surface}.innerText.includes('Replacement awaiting admin review.') && !${surface}.querySelector('button[type=submit]').disabled`);
    assert.equal(uploads.length, before + 2);
    await navigate(role, true); assert.equal(await evaluate(`${surface}.innerText.includes('Pending Review')`), true);
    assert.equal(await evaluate(`${surface}.innerText.includes('Locked until')`), true);
    if (role === "owner") assert.equal(verification.selfieVerified, true);
    else {
      assert.equal(verification.selfieVerified, false); assert.equal(await evaluate(`${surface}.innerText.includes('Continue selfie verification')`), false);
      verification.documents[0].identityReadyForSelfie = true;
      await click("Refresh Status"); await click("Continue selfie verification");
      await wait("document.body.innerText.includes('Capture Your Selfie') || document.querySelector('video')");
      assert.equal(await evaluate("document.querySelectorAll('select#kyc-id-type').length"), 0);
    }
    checks.push(`${role} interrupted replacement restores its backend status and preserves unrelated verification`);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
  }
  for (const role of statusOnly ? [] : ["user", "owner"]) {
    await send("Page.navigate", { url: "about:blank" }); await wait("location.href === 'about:blank'"); seed(role, "pending");
    verification.selfieVerified = false; user.kycStatus = "id_uploaded";
    verification.bookingEligible = false; verification.listingEligible = false;
    const identity = verification.documents[0]; identity.status = "pending_review";
    identity.faceSetupRequired = true; identity.identityReadyForSelfie = false;
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate(role); await navigate(role, true);
    await evaluate(`${surface}.querySelector('button').focus()`); await key("Tab", "Tab", 9);
    assert.equal(await evaluate("document.activeElement.innerText"), "Retry saved ID setup");
    assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "solid");
    assert.equal(await evaluate(`${surface}.innerText.includes('Your ID is saved.')`), true);
    assert.equal(await evaluate(`${surface}.innerText.includes('Continue selfie verification')`), false);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
    await evaluate(`${surface}.scrollIntoView({block:'start'})`);
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(os.tmpdir(), `rentifypro-${role}-saved-id-recovery-390.png`), Buffer.from(screenshot.data, "base64"));
    const before = uploads.length, revision = identity.documentRevision;
    await evaluate(`(() => { const button=[...${surface}.querySelectorAll('button')].find(element=>element.innerText==='Retry saved ID setup'); button.click(); button.click(); })()`);
    await wait(`${surface}.innerText.includes('Continue selfie verification') && !${surface}.innerText.includes('Saving the document.')`);
    assert.equal(uploads.length, before + 1); assert.equal(identity.documentRevision, revision);
    assert.equal(uploads.at(-1).body.document_revision, revision); assert.equal(uploads.at(-1).body.id_image_base64, undefined);
    await click("Continue selfie verification");
    await wait("document.body.innerText.includes('Capture Your Selfie') || document.querySelector('video')");
    assert.equal(await evaluate("document.querySelectorAll('select#kyc-id-type').length"), 0);
    checks.push(`${role} refreshing interrupted ID setup restores its reference and resumes with one saved-document request`);
  }
  for (const width of statusOnly ? [390] : [390, 1200]) for (const role of ["user", "owner"]) {
    await send("Page.navigate", { url: "about:blank" }); await wait("location.href === 'about:blank'"); seed(role, "approved");
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await navigate(role);
    const document = verification.documents.at(-1), revision = document.documentRevision;
    document.status = "rejected"; document.reason = "The text is unreadable. Submit a clearer copy.";
    verification.bookingEligible = false; verification.listingEligible = false; backendKycStatus = "rejected";
    await evaluate("window.dispatchEvent(new Event('focus'))");
    await wait(`${surface}.innerText.includes('Verification needs correction') && !${surface}.querySelector('button').disabled`);
    assert.equal(await evaluate(`${surface}.innerText.includes('The text is unreadable.') && ${surface}.innerText.includes('Document saved privately.')`), true);
    assert.equal(document.documentRevision, revision); assert.equal(verification.selfieVerified, true);
    document.status = "verified"; verification.bookingEligible = true; verification.listingEligible = role === "owner"; backendKycStatus = "approved";
    await evaluate("window.dispatchEvent(new Event('focus'))");
    await wait(`${surface}.innerText.includes('Verification Complete') && !${surface}.querySelector('button').disabled`);
    checks.push(`${role} fresh approval/rejection status replaces cached account summaries on focus at ${width}px`);
    for (const failure of ["network", "malformed", "session"]) {
      statusFailure = failure; await click(role === "owner" ? "Refresh status" : "Refresh Status");
      if (failure === "session") {
        await wait("location.pathname === '/signin' && document.body.innerText.length > 100");
        await navigate(role);
      } else await wait(`${surface}.innerText.includes('Showing the last checked status.') && !${surface}.querySelector('button').disabled`);
      assert.equal(document.documentRevision, revision); assert.equal(verification.selfieVerified, true);
      if (failure !== "session") {
        await click(role === "owner" ? "Refresh status" : "Refresh Status"); await wait(`!${surface}.innerText.includes('Showing the last checked status.') && !${surface}.querySelector('button').disabled`);
      }
    }
    await navigate(role, true); assert.equal(await evaluate(`${surface}.innerText.includes('Verification Complete')`), true);
    checks.push(`${role} network, malformed status and expired-session recovery preserve saved references at ${width}px`);
    await evaluate(`(async () => {
      const reactModule=await import('/node_modules/.vite/deps/react.js');const React=reactModule.default||reactModule;
      const clientModule=await import('/node_modules/.vite/deps/react-dom_client.js');
      const {default:Notice}=await import('/src/components/NotificationDetailsModal.jsx');
      const container=document.createElement('div');document.body.append(container);window.verificationNoticeRoot=(clientModule.default||clientModule).createRoot(container);
      window.verificationNoticeRoot.render(React.createElement(Notice,{viewerRole:${JSON.stringify(role)},notification:{event:'verification.document_rejected',title:'Government ID rejected',message:'Reason: The text is unreadable. Submit a clearer copy. Open Verification Status and choose Replace ID.'},onClose:()=>window.verificationNoticeRoot.unmount(),onOpenBookings:()=>{throw Error('Verification notice must open verification');}}));
    })()`);
    await wait("document.querySelector('[aria-labelledby=\"notification-details-title\"] a')");
    const link = await evaluate("document.querySelector('[aria-labelledby=\"notification-details-title\"] a').getAttribute('href')");
    assert.equal(link, role === "owner" ? "/owner-dashboard?tab=Profile#verification-status" : "/account-settings#verification-status");
    assert.equal(await evaluate("document.querySelector('[aria-labelledby=\"notification-details-title\"]').innerText.includes('View Booking')"), false);
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(os.tmpdir(), `rentifypro-${role}-verification-notice-${width}.png`), Buffer.from(screenshot.data, "base64"));
    await evaluate("document.querySelector('[aria-labelledby=\"notification-details-title\"] a').click()");
    await wait(`${surface} && location.hash === '#verification-status'`);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
    checks.push(`${role} rejection notice opens the correct Verification Status section at ${width}px`);
  }
  for (const width of [390, 1200]) {
    await send("Page.navigate", { url: "about:blank" }); await wait("location.href === 'about:blank'"); seed("user", "pending"); user.kycStatus = "approved";
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await send("Page.navigate", { url: base + "/vehicle-details?vehicleId=507f1f77bcf86cd799439099" });
    await wait("document.body.innerText.includes('Verification Pending') && [...document.querySelectorAll('button')].some(button=>button.innerText==='Verify Identity to Book')");
    assert.equal(await evaluate("document.body.innerText.includes('View bookings to resolve')"), false);
    verification.documents[0].status = "verified"; verification.bookingEligible = true; backendKycStatus = "approved"; user.kycStatus = "rejected";
    await evaluate("window.dispatchEvent(new Event('focus'))");
    await wait("[...document.querySelectorAll('button')].some(button=>button.innerText==='Book Now' && !button.disabled)");
    verification.documents[0].status = "rejected"; verification.bookingEligible = false; backendKycStatus = "rejected";
    await evaluate("window.dispatchEvent(new Event('focus'))");
    await wait("document.body.innerText.includes('Verification needs correction')");
    await click("Verify Identity to Book"); await wait(`${surface} && location.hash === '#verification-status'`);
    assert.equal(await evaluate(`${surface}.innerText.includes('Verification needs correction')`), true);
    checks.push(`booking restrictions and next action use fresh backend status rather than cached KYC at ${width}px`);
  }
  await evaluate(`(async () => {
    const reactModule=await import('/node_modules/.vite/deps/react.js');const React=reactModule.default||reactModule;
    const clientModule=await import('/node_modules/.vite/deps/react-dom_client.js');const {createRoot}=clientModule.default||clientModule;
    const {DocumentReviewDialog}=await import('/src/admin/components/AdminUI.jsx');
    const container=document.createElement('div');document.body.append(container);
    window.verificationHistoryRoot=createRoot(container);
    window.verificationHistoryRoot.render(React.createElement(DocumentReviewDialog,{document:{fileName:'Synthetic history fixture',customer:'Synthetic Applicant',role:'Renter',approval:'Pending Review',
      reviewHistory:[{action:'reject',reviewVersion:'id-v1',reason:'Upload a readable ID.',reviewedBy:'synthetic-admin',reviewedAt:'2026-10-15T00:00:00Z'}]},onClose:()=>window.verificationHistoryRoot.unmount()}));
  })()`);
  const history = "document.querySelector('[aria-labelledby=\"review-title\"]')";
  await wait(`${history}?.querySelector('summary')?.innerText === 'Document decision history'`);
  await evaluate(`${history}.querySelector('summary').focus()`); await key("Enter", "Enter", 13);
  await wait(`${history}.querySelector('details').open`);
  assert.equal(await evaluate(`${history}.querySelector('details').innerText.includes('id-v1') && ${history}.querySelector('details').innerText.includes('synthetic-admin')`), true);
  await key("Enter", "Enter", 13); await wait(`!${history}.querySelector('details').open`);
  await evaluate("document.querySelector('[aria-label=\"Close review\"]').click()");
  await wait("!document.querySelector('[aria-labelledby=\"review-title\"]')");
  checks.push("admin decision history expands and collapses with Enter and shows its document version and reviewer");
  assert.deepEqual(errors, []);
  const report = path.join(os.tmpdir(), `rentifypro-account-verification-browser${edgesOnly ? "-recovery" : ""}.json`);
  await fs.writeFile(report, JSON.stringify({ fixtureOnly: true, checks, uploads: uploads.length, errors }, null, 2));
  console.log(JSON.stringify({ fixtureOnly: true, passed: checks.length, report }));
} finally {
  await new Promise(resolve => { ws.addEventListener("close", resolve, { once: true }); ws.close(); });
  await fetch(`http://127.0.0.1:9236/json/close/${target.id}`).catch(() => {});
}
