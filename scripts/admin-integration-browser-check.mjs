import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const origin = "http://127.0.0.1:4181";
const cdp = "http://127.0.0.1:9244";
const tab = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map(), errors = [];
let sequence = 0;
let lastDecision;
let approvalRequests = 0;
let accountApproved = false;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
  pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const id = number => String(number).padStart(24, "0");
const docs = Array.from({ length: 31 }, (_, index) => ({ id: id(index + 1), customerId: id(index + 101), customer: "Synthetic Applicant", customerName: "Synthetic Applicant",
  accountLink: { status: "registered", label: "Registered customer", customerId: id(index + 101) },
  email: `synthetic-${index + 1}@example.test`, fileName: `synthetic-document-${index + 1}.png`, document: "Philippine Passport", role: "Renter",
  submitted: "2026-10-16", submittedAt: "2026-10-16T00:00:00Z", approval: index === 1 ? "Replacement required" : "Pending",
  processingStage: index === 1 ? "reupload_required" : "pending_review", detailsMatched: false, canApprove: false,
  canCompareManually: false, fileAvailable: false, docType: "id", reviewVersion: "fixture-version", fileHash: "fixture-hash" }));
Object.assign(docs[2], { document: "BIR Certificate of Registration (Form 2303)", selectedDocCategory: "BIR Certificate of Registration (Form 2303)", role: "Operator",
  customerId: id(100), accountLink: { status: "registered", label: "Registered customer", customerId: id(100) }, email: "synthetic-0@example.test",
  docType: "supporting", canCompareManually: true, fileAvailable: true, previewUrl: `/api/admin/documents/${id(3)}/file` });
Object.assign(docs[3], { selectedDocCategory: "Philippine Passport", canCompareManually: true, fileAvailable: true,
  previewUrl: `/api/admin/documents/${id(4)}/file` });
Object.assign(docs[29], { accountLink: { status: "needs_review", label: "Account link needs review", customerId: "" } });
Object.assign(docs[30], { customerId: "", customerName: "", customer: "unregistered@example.test", email: "unregistered@example.test",
  accountLink: { status: "registration_incomplete", label: "Registration incomplete", customerId: "" }, approval: "Approved", processingStage: "verified",
  fileAvailable: true, previewUrl: `/api/admin/documents/${id(31)}/file` });
const customers = Array.from({ length: 31 }, (_, index) => ({ id: id(index + 100), name: `Synthetic Customer ${index + 1}`,
  email: `synthetic-${index}@example.test`, phone: "9123456789", role: "Renter", status: "Pending Verification", created: "2026-10-16", createdAt: "2026-10-16T00:00:00Z" }));
Object.assign(customers[0], { role: "Operator", emailVerified: true, verification: { emailVerified: true, documentsApproved: false,
  selfieVerified: true, bookingEligible: false, pendingReasons: ["Business document approval"], pendingDocumentIds: [id(3)] } });
const assistance = { ...docs[0], id: id(99), customerId: "", customerName: "", customer: customers[0].email,
  email: customers[0].email, fileName: "synthetic-registration-assistance.png", reviewPurpose: "Registration assistance",
  accountLink: { status: "registration_incomplete", label: "Registration incomplete", customerId: "" } };
const bookings = Array.from({ length: 31 }, (_, index) => ({ id: id(index + 200), reference: String(index + 1),
  vehicle: "Synthetic Vehicle", renter: "Synthetic Applicant", operator: "Synthetic Operator", status: "Extended",
  createdAt: "2026-10-16T00:00:00Z", pickupAt: "2026-10-14T00:00:00Z", returnAt: "2026-10-15T00:00:00Z", isOverdue: true, paymentAmountDue: 0 }));
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script>
<script type="module">import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';const{useState}=React;const{createRoot}=ReactDOM;
import Documents from '/src/admin/pages/DocumentsView.jsx';import Customers from '/src/admin/pages/CustomersView.jsx';import Bookings from '/src/admin/pages/BookingsView.jsx';
import{DocumentReviewDialog}from'/src/admin/components/AdminUI.jsx';import '/src/index.css';
import AdminAccountPage from '/AdminAccountPage.jsx';
const docs=${JSON.stringify(docs)},customers=${JSON.stringify(customers)},bookings=${JSON.stringify(bookings)};
function App(){const[view,setView]=useState('Documents'),[review,setReview]=useState(null);return <main className="min-w-0 p-4"><p>Synthetic QA fixture</p><nav>{['Documents','Customers','Bookings','Admin'].map(name=><button key={name} className="min-h-11 px-3" onClick={()=>setView(name)}>{name}</button>)}</nav>{view==='Admin'?<AdminAccountPage user={{name:'Synthetic Admin',email:'admin@example.test'}} onLogout={()=>{}}/>:view==='Documents'?<Documents documents={docs} onReview={setReview} onView={setReview}/>:view==='Customers'?<Customers customers={customers} adminEmail="admin@example.test" onView={()=>{}} onEdit={()=>{}} onToggleDisabled={()=>{}} onDelete={()=>{}}/>:<Bookings bookings={bookings} onView={()=>{}}/>}{review?<DocumentReviewDialog document={review} onClose={()=>setReview(null)} onApprove={details=>{window.__lastInspection=details.inspection}} onReject={()=>{}}/>:null}</main>}
createRoot(document.getElementById('root')).render(<App/>);</script></body></html>`;
async function fulfill(event) {
  if (new URL(event.request.url).pathname === "/qa-admin") {
    const transformed = await fetch(`${origin}/@vite/client`);
    assert.equal(transformed.status, 200);
    const fixture = html.slice(0, html.indexOf('<script type="module">import React ')) + '<script type="module" src="/qa-admin-module.jsx"></script></body></html>';
    await send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "text/html" }], body: Buffer.from(fixture).toString("base64") });
  } else if (new URL(event.request.url).pathname === "/qa-admin-module.jsx") {
    // Only the synthetic wrapper is transpiled here; components use the normal Vite pipeline.
    const module = html.match(/<script type="module">import React [\s\S]*?<\/script>/)[0].replace(/^<script type="module">|<\/script>$/g, "");
    const { transform } = await import("esbuild");
    const result = await transform(module, { loader: "jsx", jsx: "transform", jsxFactory: "React.createElement", jsxFragment: "React.Fragment" });
    const code = result.code;
    await send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/javascript" }], body: Buffer.from(code).toString("base64") });
  } else if (new URL(event.request.url).pathname.endsWith("/comparison")) {
    const request = new URL(event.request.url);
    const identity = request.pathname.includes(id(4));
    const statusOnly = request.searchParams.get("statusOnly") === "1";
    await send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "X-RentifyPro-Admin-Contract", value: "2.2.0" }],
      body: Buffer.from(JSON.stringify({ profile: identity ? { first_name: "Synthetic", last_name: "Applicant", date_of_birth: "1990-05-12" }
        : { business_name: "Synthetic Rentals", tax_identification_number: "123-456-789", branch_code: "00000" },
        identifierScreening: identity ? { state: statusOnly ? "complete" : "processing", ...(statusOnly ? { maskedIdentifier: "**** 2345", identifierAvailable: true } : {}) } : null,
        identifierDuplicateCheck: identity && !statusOnly ? "file_hash_only" : "available",
        reviewVersion: "fixture-version", fileHash: "fixture-hash" })).toString("base64") });
  } else if (new URL(event.request.url).pathname.endsWith("/admin/data")) {
    await send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "X-RentifyPro-Admin-Contract", value: "2.2.0" }],
      body: Buffer.from(JSON.stringify({ customers: customers.map((customer, index) => accountApproved && index === 0
        ? { ...customer, status: "Active", verification: { ...customer.verification, documentsApproved: true, documentApprovalComplete: true, bookingEligible: true, pendingReasons: [], pendingDocumentIds: [] } } : customer),
        vehicles: [], documents: [...docs.map((document, index) => accountApproved && index === 2 ? { ...document, approval: "Approved", processingStage: "verified" } : document), assistance],
        bookings, operationalAlerts: [{ id: "registration-assistance", severity: "info", title: "Registration assistance requested",
          description: "Applicants requested an ID comparison before submitting their accounts.", count: 1, view: "documents",
          context: { status: "Pending Review", purpose: "Registration assistance" } }], page: { hasMore: false }, syncedAt: "2026-10-16T00:00:00Z" })).toString("base64") });
  } else if (event.request.method === "PATCH" && /\/admin\/documents\/[a-f\d]{24}$/.test(new URL(event.request.url).pathname)) {
    lastDecision = JSON.parse(event.request.postData);
    assert.ok(["Rejected", "Approved"].includes(lastDecision.approval));
    if (lastDecision.approval === "Approved") assert.equal(Object.hasOwn(lastDecision, "reason"), false);
    if (lastDecision.approval === "Approved") approvalRequests++;
    const failed = lastDecision.approval === "Approved" && lastDecision.adminPassword === "wrong";
    const document = { ...docs.find(doc => event.request.url.endsWith(doc.id)), approval: lastDecision.approval, processingStage: lastDecision.approval === "Approved" ? "verified" : "rejected" };
    if (!failed && lastDecision.approval === "Approved" && document.id === id(3)) accountApproved = true;
    if (lastDecision.approval === "Approved") await new Promise(resolve => setTimeout(resolve, 400));
    await send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: failed ? 403 : 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "X-RentifyPro-Admin-Contract", value: "2.2.0" }],
      body: Buffer.from(JSON.stringify(failed ? { message: "Synthetic password was incorrect." } : { document })).toString("base64") });
  } else if (new URL(event.request.url).pathname.endsWith("/file")) {
    await send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "image/png" }],
      body: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pY4AAAAASUVORK5CYII=" });
  } else {
    await send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 503,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from('{"message":"Synthetic unavailable file"}').toString("base64") });
  }
}
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) { const item = pending.get(message.id); if (!item) return; pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); }
  else if (message.method === "Fetch.requestPaused") void fulfill(message.params).catch(error => errors.push(error.message));
  else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value;
};
const waitFor = async expression => {
  for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Fixture did not become ready: ${expression}. ${errors.join("; ")}`);
};
const fillApproval = async (password = "SyntheticAdmin1!") => evaluate(`
  (()=>{
  const password=document.querySelector('[role=dialog] input[type=password]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(password,${JSON.stringify(password)});
  password.dispatchEvent(new Event('input',{bubbles:true}));
  })()
`);
const filterRegistration = async label => {
  await evaluate("document.getElementById([...document.querySelectorAll('label')].find(label=>label.textContent==='Account registration').htmlFor).click()");
  await waitFor("document.querySelector('[role=listbox]')!==null");
  await evaluate(`[...document.querySelectorAll('[role=option]')].find(option=>option.textContent.trim()===${JSON.stringify(label)}).click()`);
};
const screenshots = await fs.mkdtemp(path.join(os.tmpdir(), "admin-browser-"));
const checks = [];
try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.bringToFront");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/qa-admin*" }, { urlPattern: "*/api/*" }] });
  for (const width of [390, 768, 1280]) {
    accountApproved = false;
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await send("Page.navigate", { url: `${origin}/qa-admin` });
    await waitFor("document.querySelectorAll('tbody tr').length===25");
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
    await evaluate("document.querySelector('[aria-label=\"Next documents page\"]').click()");
    await waitFor("document.querySelectorAll('tbody tr').length===6");
    await evaluate("document.querySelector('[aria-label=\"Previous documents page\"]').click()");
    await waitFor("document.querySelectorAll('tbody tr').length===25");
    await filterRegistration("Registration incomplete");
    await waitFor("document.querySelectorAll('tbody tr').length===1");
    assert.equal(await evaluate("document.querySelector('tbody').innerText.includes('unregistered@example.test')"), true);
    assert.equal(await evaluate("document.querySelector('tbody').innerText.includes('Registration applicant')"), true);
    await filterRegistration("Account link needs review");
    await waitFor("document.querySelectorAll('tbody tr').length===1");
    assert.equal(await evaluate("document.querySelector('tbody').innerText.includes('synthetic-document-30.png')"), true);
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Clear Filters').click()");
    await waitFor("document.querySelectorAll('tbody tr').length===25");
    await evaluate("[...document.querySelectorAll('button[aria-pressed]')].find(button=>button.textContent.startsWith('Pending Review')).click()");
    await waitFor("document.querySelector('button[aria-pressed=true]')!==null");
    assert.equal(await evaluate("[...document.querySelectorAll('tbody tr')].every(row=>row.innerText.includes('Pending Review'))"), true);
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Clear Filters').click()");
    await evaluate("[...document.querySelectorAll('tbody button')].find(button=>button.textContent==='Review').click()");
    await waitFor("document.querySelector('[role=dialog]')!==null");
    assert.equal(await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Approve Document').disabled"), true);
    assert.equal(await evaluate("document.body.innerText.includes('The original file is unavailable')"), true);
    await waitFor("document.querySelector('[role=dialog]').contains(document.activeElement)");
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(screenshots, `review-${width}.png`), Buffer.from(screenshot.data, "base64"));
    await evaluate("document.querySelector('[role=dialog] button[aria-label]').click()");
    await evaluate("[...document.querySelectorAll('tbody tr')].find(row=>row.innerText.includes('synthetic-document-3.png')).querySelector('td:last-child button').click()");
    await waitFor("document.querySelector('[role=dialog]')?.innerText.includes('TIN')");
    assert.equal(await evaluate("document.querySelectorAll('[aria-labelledby=manual-comparison-title] input:not([type=checkbox]),[aria-labelledby=manual-comparison-title] select').length"), 0);
    assert.equal(await evaluate("document.querySelectorAll('[aria-labelledby=manual-comparison-title] input[type=checkbox]').length"), 3);
    assert.equal(await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Approve Document').disabled"), true);
    await fillApproval();
    await evaluate("document.querySelectorAll('[aria-labelledby=manual-comparison-title] input[type=checkbox]').forEach(input=>input.click())");
    await waitFor("[...document.querySelectorAll('button')].find(button=>button.textContent==='Approve Document').disabled===false");
    await evaluate("document.querySelector('[aria-labelledby=manual-comparison-title] input[type=checkbox]').click()");
    await waitFor("[...document.querySelectorAll('button')].find(button=>button.textContent==='Approve Document').disabled===true");
    await evaluate("document.querySelector('[aria-labelledby=manual-comparison-title] input[type=checkbox]').click()");
    await waitFor("[...document.querySelectorAll('button')].find(button=>button.textContent==='Approve Document').disabled===false");
    await evaluate("document.querySelector('[aria-labelledby=manual-comparison-title]').scrollIntoView({block:'start'})");
    const inspectionScreenshot = await send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(screenshots, `inspection-${width}.png`), Buffer.from(inspectionScreenshot.data, "base64"));
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Approve Document').click()");
    assert.equal(await evaluate("window.__lastInspection.reviewMode"), "visual");
    assert.equal(await evaluate("Object.hasOwn(window.__lastInspection,'fields')"), false);
    await evaluate("document.querySelector('[role=dialog] button[aria-label]').click()");
    await evaluate("[...document.querySelectorAll('tbody tr')].find(row=>row.innerText.includes('synthetic-document-4.png')).querySelector('td:last-child button').click()");
    await waitFor("document.querySelector('[role=dialog]')?.innerText.includes('reading the current original')");
    await fillApproval();
    await evaluate("document.querySelectorAll('[aria-labelledby=manual-comparison-title] input[type=checkbox]').forEach(input=>input.click())");
    assert.equal(await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Approve Document').disabled"), true);
    await waitFor("document.querySelector('[role=dialog]')?.innerText.includes('**** 2345')");
    assert.equal(await evaluate("document.querySelectorAll('[aria-labelledby=manual-comparison-title] input:checked').length"), 0);
    await evaluate("document.querySelector('[role=dialog] button[aria-label]').click()");
    for (const view of ["Customers", "Bookings"]) {
      await evaluate(`[...document.querySelectorAll('main>nav button')].find(button=>button.textContent===${JSON.stringify(view)}).click()`);
      await waitFor("document.querySelectorAll('tbody tr').length===25");
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
    }
    await evaluate("[...document.querySelectorAll('main>nav button')].find(button=>button.textContent==='Admin').click()");
    await waitFor("document.querySelector('nav[aria-label=\"Admin navigation\"]')!==null");
    await waitFor("document.body.innerText.includes('Registration assistance requested')");
    assert.equal(await evaluate("[...document.querySelectorAll('section')].find(section=>section.innerText.includes('Pending reviews'))?.innerText.includes('29')"), true);
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.innerText.includes('Registration assistance requested')).click()");
    await waitFor("document.querySelectorAll('tbody tr').length===1 && document.querySelector('tbody').innerText.includes('synthetic-registration-assistance.png')");
    assert.equal(await evaluate("[...document.querySelectorAll('button[aria-pressed=true]')].some(button=>button.textContent==='Registration assistance')"), true);
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
    const assistanceScreenshot = await send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(screenshots, `assistance-${width}.png`), Buffer.from(assistanceScreenshot.data, "base64"));
    await evaluate("document.querySelector('tbody td:last-child button').click()");
    await waitFor("document.querySelector('[role=dialog]')!==null");
    assert.equal(await evaluate("[...document.querySelectorAll('[role=dialog] button')].some(button=>button.textContent==='Approve Document')"), false);
    assert.equal(await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent==='Reject').disabled"), true);
    assert.equal(await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent==='Save comparison').disabled"), true);
    await evaluate("document.querySelector('[aria-label=\"Close review\"]').click()");
    if (width < 1024) await evaluate("document.querySelector('[aria-label=\"Open navigation\"]').click()");
    await evaluate("[...document.querySelectorAll('nav[aria-label=\"Admin navigation\"] button')].find(button=>button.textContent==='Documents').click()");
    await waitFor("document.querySelectorAll('tbody tr').length===25");
    await filterRegistration("Registration incomplete");
    await waitFor("document.querySelectorAll('tbody tr').length===1");
    await evaluate("document.querySelector('tbody td:last-child button').click()");
    await waitFor("document.querySelector('[role=dialog]')?.innerText.includes('final approval is available only after account submission')");
    assert.equal(await evaluate("[...document.querySelectorAll('[role=dialog] button')].some(button=>button.textContent==='Approve Document')"), false);
    const unregisteredScreenshot = await send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(screenshots, `unregistered-${width}.png`), Buffer.from(unregisteredScreenshot.data, "base64"));
    if (width === 390) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 640, deviceScaleFactor: 1, mobile: true });
      assert.equal(await evaluate("document.querySelector('[role=dialog]').getBoundingClientRect().top>=0 && document.querySelector('[role=dialog]').getBoundingClientRect().bottom<=innerHeight"), true);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('[role=dialog]')).overflowY"), "auto");
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: true });
    }
    await evaluate("document.querySelector('[aria-label=\"Close preview\"]').click()");
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Clear Filters').click()");
    await waitFor("document.querySelectorAll('tbody tr').length===25");
    await evaluate("[...document.querySelectorAll('tbody button')].find(button=>button.textContent==='Review').click()");
    await waitFor("document.querySelector('[role=dialog]')!==null");
    await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent==='Reject').click()");
    await waitFor("document.querySelector('[role=alertdialog] select')!==null");
    assert.equal(await evaluate("[...document.querySelectorAll('[role=alertdialog] button')].find(button=>button.textContent==='Reject document').disabled"), true);
    await evaluate("const select=document.querySelector('[role=alertdialog] select');select.value=select.options[1].value;select.dispatchEvent(new Event('change',{bubbles:true}))");
    await waitFor("document.querySelector('[role=alertdialog] textarea').value.includes('blurry or unreadable')");
    await evaluate("const area=document.querySelector('[role=alertdialog] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,area.value+' Additional inspection detail.');area.dispatchEvent(new Event('input',{bubbles:true}));const password=document.querySelector('[role=alertdialog] input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(password,'SyntheticAdmin1!');password.dispatchEvent(new Event('input',{bubbles:true}))");
    await waitFor("[...document.querySelectorAll('[role=alertdialog] button')].find(button=>button.textContent==='Reject document').disabled===false");
    const rejectionScreenshot = await send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(screenshots, `rejection-${width}.png`), Buffer.from(rejectionScreenshot.data, "base64"));
    await evaluate("[...document.querySelectorAll('[role=alertdialog] button')].find(button=>button.textContent==='Reject document').click()");
    await waitFor("document.querySelector('[role=alertdialog]')===null");
    assert.ok(lastDecision.reason.endsWith("Additional inspection detail."));
    if (width < 1024) await evaluate("document.querySelector('[aria-label=\"Open navigation\"]').click()");
    await evaluate("[...document.querySelectorAll('nav[aria-label=\"Admin navigation\"] button')].find(button=>button.textContent==='Customers').click()");
    await waitFor("document.querySelectorAll('tbody tr').length===25");
    assert.equal(await evaluate("document.querySelector('tbody tr').innerText.includes('Needs: Business document approval')"), true);
    await evaluate("document.querySelector('tbody tr td:last-child button').click()");
    await waitFor("document.querySelector('[role=dialog]')?.innerText.includes('Still required: Business document approval')");
    assert.equal(await evaluate("document.querySelector('[role=dialog]').innerText.includes('synthetic-registration-assistance.png')"), false);
    assert.equal(await evaluate("[...document.querySelectorAll('[role=dialog] button')].filter(button=>button.textContent==='Review document').length"), 1);
    const customerScreenshot = await send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(screenshots, `customer-${width}.png`), Buffer.from(customerScreenshot.data, "base64"));
    await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent==='Review document').click()");
    await waitFor("document.querySelector('[role=dialog]')?.innerText.includes('TIN')");
    assert.equal(await evaluate("document.querySelectorAll('[role=dialog]').length"), 1);
    assert.equal(await evaluate("document.querySelector('[role=dialog]').innerText.includes('synthetic-0@example.test')"), true);
    await evaluate("document.querySelectorAll('[aria-labelledby=manual-comparison-title] input[type=checkbox]').forEach(input=>input.click())");
    assert.equal(await evaluate("document.querySelector('[role=dialog] textarea')===null"), true);
    assert.equal(await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent==='Approve Document').disabled"), true);
    await fillApproval("wrong");
    await waitFor("[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent==='Approve Document').disabled===false");
    const requestsBefore = approvalRequests;
    await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent==='Approve Document').click()");
    await waitFor("document.querySelector('[role=dialog] [role=alert]')?.innerText.includes('password was incorrect')");
    assert.equal(await evaluate("document.querySelector('[role=alertdialog]')===null"), true);
    assert.equal(await evaluate("document.querySelector('[role=dialog] input[type=password]').value"), "");
    await fillApproval();
    await evaluate("document.querySelector('[role=dialog] input[type=password]').scrollIntoView({block:'center'})");
    const approvalScreenshot = await send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(screenshots, `approval-${width}.png`), Buffer.from(approvalScreenshot.data, "base64"));
    await evaluate("const button=[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent==='Approve Document');button.click();button.click()");
    await waitFor("document.querySelector('[role=dialog][aria-busy=true]')!==null");
    assert.equal(await evaluate("document.querySelector('[role=alertdialog]')===null"), true);
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Close review\"]').disabled"), true);
    await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert.equal(await evaluate("document.querySelector('[role=dialog]')!==null"), true);
    await waitFor("document.querySelector('[role=dialog]')===null");
    assert.equal(approvalRequests - requestsBefore, 2);
    assert.equal(lastDecision.inspection.reviewMode, "visual");
    await waitFor("document.body.innerText.includes('Customer account is now active')");
    assert.equal(await evaluate("document.querySelector('tbody tr').innerText.includes('Active')"), true);
    assert.equal(await evaluate("document.querySelector('tbody tr').innerText.includes('Needs:')"), false);
    checks.push({ width, registrationLabelsAndFilters: true, assistanceQueueNavigation: true, separateReviewCounts: true,
      assistanceCannotApproveOrReject: true, draftExcludedFromCustomerProfile: true, incompleteRegistrationNotice: true, remainingRequirements: true,
      reviewFromCustomerProfile: true, refreshedAccountStatus: true, pagination: true, pendingShortcut: true, editableRejectionPresets: true, backgroundIdentifierUpdates: true,
      approvalBlockedWithoutOriginal: true, businessComparisonRequiresInspection: true, noRepeatedFieldEntry: true, combinedApproval: true,
      approvalWithoutSecondModal: true, noApprovalReasonRequired: true, passwordStillRequired: true,
      inlineApprovalErrors: true, duplicateSubmissionsBlocked: true, modalFocus: true, overflow: false });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ simulated: true, checks, screenshots }, null, 2));
} finally { await send("Page.close").catch(() => {}); ws.close(); }
