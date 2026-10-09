// Run against Vite on 4178 and isolated Chrome on 9239.
// API responses and business documents are simulated; no live accounts are changed.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const base = "http://127.0.0.1:4178";
const reportDir = "docs/reports/owner-upgrade-fix-2026-10-09";
const target = await (await fetch("http://127.0.0.1:9239/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0, profileCalls = 0, cancelledIntercepts = 0, documentRecord = null, revisionNumber = 0, uploadFailure = false, statusFailure = false, upgradeFailure = false;
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
    { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Access-Control-Allow-Headers", value: "content-type,x-pre-kyc-token" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,PUT,OPTIONS" },
  ], body: Buffer.from(JSON.stringify(body)).toString("base64") });
}
async function route({ requestId, request }) {
  const url = new URL(request.url), path = url.pathname;
  if (path.startsWith("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    if (path === "/api/auth/me") { profileCalls++; return fulfill(requestId, { success: true, user }); }
    if (path === "/api/kyc/pre/session") return fulfill(requestId, { preKycToken: 'fixture.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000) + 3600 })).toString('base64url') + '.signature' });
    if (path === "/api/kyc/pre/status") {
      if (statusFailure) return fulfill(requestId, { message: "Fixture status service unavailable" }, 503);
      return fulfill(requestId, { documents: documentRecord ? [documentRecord] : [] });
    }
    if (path === "/api/kyc/pre/supporting-doc/verify") {
      const body = JSON.parse(request.postData); requests.push({ path, body });
      if (uploadFailure) return fulfill(requestId, { message: "Fixture upload unavailable. Try again." }, 503);
      documentRecord = { docType: "supporting", status: "queued", selectedDocCategory: body.supporting_doc_type,
        documentRevision: 'fixture-revision-' + ++revisionNumber, expiresAt: new Date(Date.now()+3600000).toISOString() };
      return fulfill(requestId, { success: true, documentStatus: "queued", documentRevision: documentRecord.documentRevision });
    }
    if (path === "/api/auth/upgrade-to-owner") {
      const body = JSON.parse(request.postData); requests.push({ path, body });
      assert.equal(documentRecord.status, "verified"); assert.equal(body.supportingDocRevision, documentRecord.documentRevision);
      assert.equal(body.supportingDocType, documentRecord.selectedDocCategory);
      if (upgradeFailure) return fulfill(requestId, { code: "ACCOUNT_CHANGED", message: "Your account changed during submission. Refresh Account Settings before trying again." }, 409);
      Object.assign(user, { role: "owner", ownerType: body.ownerType, businessName: body.businessName, permitNumber: body.permitNumber, licenseNumber: body.licenseNumber });
      return fulfill(requestId, { success: true, user });
    }
    if (path === "/api/kyc/me") return fulfill(requestId, { status: user.kycStatus, remarks: "Fixture identity status" });
    return fulfill(requestId, { success: true, stats: {}, vehicles: [], bookings: [], notifications: [], conversations: [], unreadCount: 0, total: 0, activity: [], reviews: [] });
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
  await wait("document.querySelector('.rp-account-selector select')");
  await evaluate(`(() => {
    const select = document.querySelector('.rp-account-selector select');
    if (select.getBoundingClientRect().height > 0) {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(label)});
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } else [...document.querySelectorAll('.rp-account-navigation button')].find(el => el.textContent.trim() === ${JSON.stringify(label)}).click();
  })()`);
}
async function value(id, value) {
  await evaluate(`(() => { const input = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`);
}
const pdfFixture = (() => {
  const stream = 'BT /F1 18 Tf 40 160 Td (SIMULATED BUSINESS DOCUMENT) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 240] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf).toString('base64');
})();
async function chooseFile(kind = "image") {
  await evaluate(`(async () => {
    let file;
    if (${JSON.stringify(kind)} === 'image') {
      const canvas=document.createElement('canvas'); canvas.width=1200; canvas.height=800; const ctx=canvas.getContext('2d');
      ctx.fillStyle='#eee';ctx.fillRect(0,0,1200,800);ctx.fillStyle='#111';ctx.font='48px Arial';
      for(let n=0;n<9;n++)ctx.fillText('SIMULATED BUSINESS DOCUMENT '+n,40,70+n*76);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));file=new File([blob],'synthetic-business.png',{type:'image/png'});
    } else if (${JSON.stringify(kind)} === 'pdf') file=new File([Uint8Array.from(atob(${JSON.stringify(pdfFixture)}), c=>c.charCodeAt(0))],'synthetic-business.pdf',{type:'application/pdf'});
    else file=new File(['bad file'],'invalid-document.txt',{type:'text/plain'});
    const data=new DataTransfer();data.items.add(file);const input=document.getElementById('upgrade-document-file');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
}
async function load(width=1280,height=900) {
  user.role='user';user.kycStatus='approved';delete user.ownerType;delete user.businessName;delete user.permitNumber;
  documentRecord=null;uploadFailure=false;statusFailure=false;upgradeFailure=false;
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});
  const previousPage = await evaluate("window.__fixturePageId || ''");
  await send('Page.navigate',{url:base+'/account-settings'});
  await wait(`window.__fixturePageId && window.__fixturePageId !== ${JSON.stringify(previousPage)} && document.querySelector('.rp-account-selector select')`);
  await section('Become a Vehicle Owner');await wait("document.querySelector('[data-owner-upgrade]')");
  await wait("!document.body.innerText.includes('Checking document status...')");
}
async function fillDetails() {
  await value('upgrade-owner-type','individual');await value('upgrade-business-name','Fixture Motors');
  await value('upgrade-document-type','DTI Business Name Registration');await value('upgrade-permit','DTI-123');
}
const upgradeDisabled = "[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='Upgrade to Owner').disabled";
try {
  await fs.mkdir(reportDir,{recursive:true});await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'http*'}]});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__fixturePageId=crypto.randomUUID();window.__revokedPreviewUrls=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=(url)=>{window.__revokedPreviewUrls.push(url);revoke(url);};`});
  for(const [width,height] of [[1280,900],[390,844],[768,1024]]) {
    await load(width,height);assert.equal(await evaluate(upgradeDisabled),true);
    await fillDetails();await chooseFile();await wait("document.querySelector('[data-document-preview] img')?.naturalWidth > 0");
    const originalUrl=await evaluate("document.querySelector('[data-document-preview] img').src");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-document-preview] img')).objectFit"),'contain');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),true);
    await click('Submit document for review');await wait(hasText('Document status: Queued for checking'));
    assert.equal(await evaluate(upgradeDisabled),true);documentRecord.status='pending_review';
    await click('Refresh document status');await wait(hasText('Document status: Awaiting admin review'));
    assert.equal(await evaluate(upgradeDisabled),true);documentRecord.status='verified';
    await click('Refresh document status');await wait(hasText('Document status: Approved'));await wait('!'+upgradeDisabled);
    await value('upgrade-business-name','Changed Unreviewed Business');await wait(hasText('Your details changed.'));assert.equal(await evaluate(upgradeDisabled),true);
    await value('upgrade-business-name','Fixture Motors');await wait('!'+upgradeDisabled);
    await evaluate("document.querySelector('[data-document-preview]').scrollIntoView({block:'center'})");
    const screenshot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(reportDir+'/preview-'+width+'.png',Buffer.from(screenshot.data,'base64'));
    await click('Remove document');await wait("!document.querySelector('[data-document-preview]')");
    assert.equal(await evaluate(`window.__revokedPreviewUrls.includes(${JSON.stringify(originalUrl)})`),true);
    assert.equal(await evaluate(upgradeDisabled),true);await chooseFile('pdf');await wait("document.querySelector('[data-document-preview] iframe')");await wait(hasText('Open PDF'));
    await chooseFile('image');await wait("document.querySelector('[data-document-preview] img')?.naturalWidth > 0");
    await chooseFile('invalid');await wait(hasText('must be JPG, PNG, or PDF'));assert.equal(await evaluate("Boolean(document.querySelector('[data-document-preview]'))"),false);
    checks.push(width+'px: image/PDF preview, uncropped image, replacement/removal cleanup, invalid-file rejection, review gating and changed-details protection');
  }
  await load();await fillDetails();await chooseFile();await wait("document.querySelector('[data-document-preview] img')?.naturalWidth > 0");
  uploadFailure=true;await click('Submit document for review');await wait(hasText('Fixture upload unavailable'));assert.equal(await evaluate(upgradeDisabled),true);
  uploadFailure=false;await click('Submit document for review');await wait(hasText('Document status: Queued for checking'));
  documentRecord.status='rejected';documentRecord.reason='Fixture correction: upload the matching document.';await click('Refresh document status');await wait(hasText(documentRecord.reason));assert.equal(await evaluate(upgradeDisabled),true);
  documentRecord.status='verified';documentRecord.expiresAt=new Date(0).toISOString();await click('Refresh document status');await wait(hasText('Document status: Review expired'));assert.equal(await evaluate(upgradeDisabled),true);
  documentRecord.expiresAt=new Date(Date.now()+3600000).toISOString();statusFailure=true;await click('Refresh document status');await wait(hasText("We couldn't refresh your document status"));assert.equal(await evaluate(upgradeDisabled),true);
  statusFailure=false;await click('Refresh document status');await wait('!'+upgradeDisabled);
  upgradeFailure=true;await click('Upgrade to Owner');await wait(hasText('Your account changed during submission'));assert.equal(user.role,'user');
  upgradeFailure=false;await wait('!'+upgradeDisabled);await click('Upgrade to Owner');await wait(hasText('You are a vehicle owner'));
  await click('Open owner dashboard');await wait("location.pathname === '/owner-dashboard'");await wait(hasText('Dashboard'));
  assert.equal(user.role,'owner');assert.equal(await evaluate("localStorage.getItem('isNewOwner')"),'true');
  checks.push('Upload/status failures, rejection, expiry, guarded upgrade retry, and owner dashboard handoff');
  await load();user.kycStatus='not_started';const previousPage=await evaluate('window.__fixturePageId');await send('Page.reload');
  await wait(`window.__fixturePageId !== ${JSON.stringify(previousPage)} && document.querySelector('.rp-account-selector select')`);await section('Become a Vehicle Owner');await wait(hasText('Open identity verification'));
  assert.equal(await evaluate("document.getElementById('upgrade-owner-type').disabled || document.getElementById('upgrade-owner-type').closest('fieldset').disabled"),true);
  await click('Open identity verification');await wait(hasText('ID & Selfie Verification'));checks.push('Unverified identity blocks owner document submission and links to identity verification');
  assert.deepEqual(errors,[]);
  const result={simulated:true,checks,runtimeErrors:errors,cancelledNavigationIntercepts:cancelledIntercepts};
  await fs.writeFile(reportDir+'/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} catch(error) { console.error(JSON.stringify({completedChecks:checks,runtimeErrors:errors,visibleText:await evaluate('document.body.innerText').catch(()=> '')},null,2));throw error; }
finally {await send('Page.close').catch(()=>{});ws.close();}
