// Opt-in browser fixtures: Vite on 4176 and an isolated Chrome on CDP 9236.
// All API responses are intercepted; this creates no registrations or stored documents.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = "http://127.0.0.1:4176";
const tab = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map(), errors = [], checks = [];
let sequence = 0, role = "user", idUploads = 0, supportingUploads = 0, idReads = 0, staleRead = false, selfieChecks = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15_000);
  pending.set(id, { resolve: (result) => { clearTimeout(timeout); resolve(result); }, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function fulfill(event, data, type = "application/json") {
  await send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200,
    responseHeaders: [{ name: "Content-Type", value: type }, { name: "Access-Control-Allow-Origin", value: base },
      { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Access-Control-Allow-Headers", value: "content-type,x-pre-kyc-token" },
      { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" }, { name: "Cache-Control", value: "no-store" }],
    body: Buffer.from(type === "application/json" ? JSON.stringify(data) : data).toString("base64") });
}
function document(type, revision, mismatched = false) {
  return { docType: type, status: "pending_review", detailsMatched: false, identityReadyForSelfie: type === "id" && !mismatched,
    documentRevision: revision, selectedDocCategory: type === "supporting" ? "DTI Business Name Registration" : mismatched ? "PRC ID" : "Philippine Passport",
    docCategory: type === "supporting" ? "DTI Business Name Registration" : "Philippine Passport",
    reasonCode: mismatched ? "DOCUMENT_TYPE_MISMATCH" : "PRIVATE_OCR_REVIEW_REQUIRED",
    reason: mismatched ? "The detected document type does not match the selected type." : "An administrator must inspect the original before approval.",
    ...(mismatched ? { status: "reupload_required" } : {}),
    automatedScreening: { outcome: mismatched ? "correction_needed" : "passed", mismatchFields: [],
      checks: { documentType: !mismatched, issuingCountry: mismatched ? null : true, layout: mismatched ? null : true, requiredFields: mismatched ? null : true,
        validity: mismatched ? null : true, registrationDetails: mismatched ? null : true } } };
}
async function route(event) {
  const url = new URL(event.request.url);
  if (url.pathname === "/qa-document-checker") {
    const fields = { firstName: "Sample", lastName: "Applicant", phone: "9123456789", region: "01", province: "0101", city: "010101", barangay: "010101001",
      ...(role === "user" ? { email: "synthetic@gmail.com", dateOfBirth: "1990-05-12", gender: "Female",
        emergencyContactName: "Other Applicant", emergencyContactPhone: "9987654321", emergencyContactRelationship: "Friend" }
        : { businessEmail: "synthetic-owner@gmail.com", ownerType: "business", businessName: "Sample Rentals", permitNumber: "TEST123" }) };
    return fulfill(event, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body data-fixture-role="${role}"><div id="root"></div>
      <script>sessionStorage.clear();localStorage.clear();window.clockOffset=0;const realNow=Date.now.bind(Date);Date.now=()=>realNow()+window.clockOffset;
      sessionStorage.setItem('rentifypro.registrationDraft.v1.${role}',JSON.stringify({version:1,fields:${JSON.stringify(fields)},expiresAt:Date.now()+3600000}));</script>
      <script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script>
      <script type="module">import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import Page from '${role === "user" ? "/src/components/RegisterPage.jsx" : "/src/pages/RegisterOwnerPage.jsx"}';
      import '/src/index.css';ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Page));</script></body></html>`, "text/html");
  }
  if (url.hostname !== "psgc.gitlab.io" && url.pathname.startsWith("/api/")) {
    if (event.request.method === "OPTIONS") return fulfill(event, {});
    if (url.pathname.endsWith("check-registration-email")) return fulfill(event, { success: true, available: true });
    if (url.pathname.endsWith("/pre/session")) return fulfill(event, { success: true, preKycToken: "synthetic-session-token", expiresIn: 3600 });
    if (url.pathname.endsWith("/pre/id-register")) {
      idUploads++; idReads = 0;
      const body = JSON.parse(event.request.postData);
      assert.equal(body.user_profile.first_name, "Sample");
      assert.equal(body.id_type, idUploads === 1 ? "Philippine Passport" : "PRC ID");
      return fulfill(event, { success: true, documentStatus: "queued", documentRevision: `id-${idUploads}` });
    }
    if (url.pathname.endsWith("/pre/supporting-doc/verify")) {
      supportingUploads++;
      const body = JSON.parse(event.request.postData);
      assert.equal(body.user_profile.business_name, "Sample Rentals");
      assert.equal(body.supporting_doc_type, "DTI Business Name Registration");
      return fulfill(event, { success: true, documentStatus: "queued", documentRevision: `supporting-${supportingUploads}` });
    }
    if (url.pathname.endsWith("/pre/status")) {
      const documents = [];
      if (supportingUploads) documents.push(document("supporting", `supporting-${supportingUploads}`));
      if (idUploads) {
        idReads++;
        if (idUploads === 2 && idReads === 1) { staleRead = true; documents.push(document("id", "id-1")); }
        else documents.push(idReads === 1 ? { ...document("id", `id-${idUploads}`), status: "processing", identityReadyForSelfie: false, automatedScreening: null }
          : document("id", `id-${idUploads}`, idUploads === 2));
      }
      return fulfill(event, { success: true, documents });
    }
    if (url.pathname.endsWith("/pre/selfie/verify")) {
      selfieChecks++;
      return fulfill(event, { success: true, verified: selfieChecks > 1, message: selfieChecks === 1 ? "Face does not match ID." : "Fixture match" });
    }
    if (/register$/.test(url.pathname)) throw Error("Unexpected account registration request");
    return fulfill(event, { success: true });
  }
  if (url.hostname === "psgc.gitlab.io") {
    const levels = [["regions", "01"], ["provinces", "0101"], ["cities-municipalities", "010101"], ["barangays", "010101001"]];
    const entry = levels.find(([name]) => url.pathname.endsWith(`/${name}/`));
    return fulfill(event, entry ? [{ code: entry[1], name: `Fixture ${entry[0]}` }] : []);
  }
  if (url.origin !== base) return send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" });
  await send("Fetch.continueRequest", { requestId: event.requestId });
}
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task?.reject(Error(message.error.message)) : task?.resolve(message.result); }
  else if (message.method === "Fetch.requestPaused") void route(message.params).catch((error) => { errors.push(error.message); });
  else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function until(expression) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) { if (await evaluate(`Boolean(${expression})`)) return; await pause(80); }
  throw Error(`Timed out: ${expression}`);
}
const input = async (selector, value) => {
  await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input');
  Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});
  e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  await pause(100);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), value);
};
const click = async (text) => { await evaluate("window.clockOffset+=2100"); await evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e||e.disabled)throw Error('Missing/disabled button: '+${JSON.stringify(text)});e.click();})()`); await pause(100); };
async function pickFile() {
  await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=650;const context=canvas.getContext('2d');
    context.fillStyle='#c5cbd2';context.fillRect(0,0,1000,650);context.fillStyle='#273340';
    for(let y=20;y<650;y+=35)for(let x=20;x<1000;x+=45)context.fillRect(x,y,15,12);
    context.fillStyle='white';context.fillRect(20,35,950,70);context.fillStyle='black';context.font='30px Arial';context.fillText('SYNTHETIC TEST - NOT A DOCUMENT',30,80);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const transfer=new DataTransfer();transfer.items.add(new File([blob],'synthetic-test.png',{type:'image/png'}));
    const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await pause(150);
}
async function captures(name) {
  for (const width of [1440, 390]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 1000, deviceScaleFactor: 1, mobile: width === 390 });
    await pause(100);
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
    const metrics = await send("Page.getLayoutMetrics");
    const png = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: Math.ceil(metrics.cssContentSize.height), scale: 1 } });
    await fs.writeFile(`qa/document-checker-${name}-${width}.png`, Buffer.from(png.data, "base64"));
  }
}
try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  for (const current of ["user", "owner"]) {
    role = current; idUploads = 0; supportingUploads = 0; selfieChecks = 0;
    await send("Page.navigate", { url: `${base}/qa-document-checker` });
    await until(`document.body.dataset.fixtureRole===${JSON.stringify(role)} && document.querySelector('input[type=password]') && document.querySelector('input[type=email]')?.value`);
    await input('input[placeholder="Create Password"]', "Synthetic123!"); await input('input[placeholder="Confirm Password"]', "Synthetic123!");
    await click("Next");
    if (role === "owner") await until("[...document.querySelectorAll('select')].some(e=>e.value==='010101001')");
    await click("Next");
    if (role === "user") {
      await until("[...document.querySelectorAll('select')].some(e=>e.value==='010101001')");
      await click("Next");
    }
    if (role === "owner") {
      await input('select[name="supportingDocType"]', "DTI Business Name Registration");
      await input('input[name="permitNumber"]', "TEST123"); await pickFile();
      await click("Upload and check document");
      await until("document.body.innerText.includes('Business document check passed. You can continue.')");
      assert.equal(await evaluate("document.body.innerText.includes('Step 3')"), true);
      await captures("business");
      checks.push("Business upload checks in the same step and preserves the selected file");
      await click("Next");
    }
    await until("[...document.querySelectorAll('select')].some(e=>[...e.options].some(o=>o.value==='Philippine Passport'))");
    await evaluate(`(()=>{const e=[...document.querySelectorAll('select')].find(e=>[...e.options].some(o=>o.value==='Philippine Passport'));e.value='Philippine Passport';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await pickFile(); await click("Upload and check ID");
    await until("document.body.innerText.includes('Checking your ID type and registration details...')");
    assert.equal(await evaluate("Boolean(document.querySelector('[data-identity-view=id]'))"), true);
    assert.equal(await evaluate("document.body.innerText.includes('Open camera')"), false);
    await until("document.querySelector('[data-identity-view=selfie]')");
    assert.equal(await evaluate("document.body.innerText.includes('Checking your ID details')"), false);
    assert.equal(await evaluate("Boolean(document.querySelector('input[type=file]'))"), false);
    assert.equal(await evaluate("document.body.innerText.includes('Checking document...')"), false);
    assert.equal(await evaluate("document.body.innerText.includes('Open camera')"), true);
    assert.equal(await evaluate("document.activeElement===document.querySelector('[data-identity-view=selfie] h2')"), true);
    assert.equal(await evaluate("document.body.innerText.includes('ID uploaded')"), false);
    assert.equal(await evaluate("document.body.innerText.includes('Government ID (')"), false);
    await click("Next");
    assert.equal(await evaluate("Boolean(document.querySelector('[data-identity-view=selfie]'))"), true);
    assert.equal(await evaluate("document.body.innerText.includes('Please verify your selfie matches the ID.')"), true);
    await captures(`selfie-${role}`);
    await click("Open camera");
    await until("document.body.innerText.includes('Take photo')");
    await evaluate("window.fixtureCameraTracks=document.querySelector('video').srcObject.getTracks()");
    await click("Back to ID");
    assert.equal(await evaluate("window.fixtureCameraTracks.every(track=>track.readyState==='ended')"), true);
    assert.equal(await evaluate("Boolean(document.querySelector('[data-identity-view=id]'))"), true);
    assert.equal(await evaluate("Boolean(document.querySelector('input[type=file]'))"), true);
    assert.equal(await evaluate("document.body.innerText.includes('synthetic-test.png')"), true);
    assert.equal(await evaluate("document.body.innerText.includes('Open camera')"), false);
    assert.equal(await evaluate("document.querySelector('[data-document-result=id]').querySelectorAll('p').length"), 1);
    await click("Next");
    await until("document.querySelector('[data-identity-view=selfie]')");
    await click("Open camera");
    await until("document.body.innerText.includes('Take photo')");
    await click("Take photo");
    await until("document.body.innerText.includes('Use selfie and continue')");
    await click("Use selfie and continue");
    await until("/does(?:n't| not).*match/.test(document.body.innerText) && document.querySelector('img[alt=\"Captured selfie preview\"]')");
    assert.equal(await evaluate("Boolean(document.querySelector('[data-identity-view=selfie]'))"), true);
    await click("Use selfie and continue");
    await until("document.body.innerText.includes('Selfie matched')");
    await click("Next");
    await until("document.body.innerText.includes('Waiting for ')");
    assert.equal(await evaluate("[...document.querySelectorAll('button')].some(button=>button.disabled&&button.textContent.includes('Waiting for '))"), true);
    await click("Back");
    await until("document.querySelector('[data-identity-view=selfie]')");
    for (const text of ["Selected document type", "Philippine issuer evidence", "Document features", "Required fields readable", "Needs confirmation"])
      assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`), false);
    if (role === "user") {
      await captures("id");
      await click("Back to ID");
      await evaluate(`(()=>{const e=[...document.querySelectorAll('select')].find(e=>e.value==='Philippine Passport');e.value='PRC ID';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await pause(100);
      assert.equal(await evaluate("document.body.innerText.includes('ID check passed.')"), false);
      assert.equal(await evaluate("document.body.innerText.includes('Open camera')"), false);
      await click("Upload and check ID"); await until("document.body.innerText.includes('The uploaded ID does not match the selected type.')");
      assert.equal(await evaluate("document.body.innerText.includes('Open camera')"), false);
      assert.equal(await evaluate("document.querySelector('[data-document-result=id]').querySelectorAll('p').length"), 1);
      assert.equal(staleRead, true);
      checks.push("Changing type invalidates confirmation and ignores the previous upload revision");
    }
    checks.push(`${role}: separate selfie view, heading focus, camera cleanup, ID retained on Back, failed-match retry, and final manual approval gate`);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ simulated: true, checks }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ errors, checks, body: await evaluate("document.body.innerText.slice(-2200)") }, null, 2));
  throw error;
} finally { await send("Page.close"); ws.close(); }
