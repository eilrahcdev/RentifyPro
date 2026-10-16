// Synthetic browser checks; every admin request is intercepted before it reaches a server.
// Start Vite on 4181 and an isolated Chrome debugging instance on 9244 before running.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { transform } from "esbuild";
import { ADMIN_API_CONTRACT_VERSION } from "../shared/adminApiContract.js";

const origin = "http://127.0.0.1:4181";
const cdp = "http://127.0.0.1:9244";
const tab = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
let failRefresh = false;
const transactionsOnly = process.argv.includes("--transactions");
let transactionMode = transactionsOnly ? "records" : "empty";
let transactionPaid = 300;
let transactionRequests = 0;
const pending = new Map();
const errors = [];
const checks = [];
const screenshots = await fs.mkdtemp(path.join(os.tmpdir(), "admin-ui-consistency-"));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
  pending.set(id, { resolve: (result) => { clearTimeout(timeout); resolve(result); }, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`UI did not become ready: ${expression}. ${errors.join("; ")}`);
};
const click = async (expression) => {
  const point = await evaluate(`(async () => { const element = ${expression}; if (!element) throw new Error('Missing click target'); element.scrollIntoView({block:'center',inline:'nearest'}); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); const rect = element.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
};
const key = async (name, modifiers = 0) => {
  const codes = { Tab: 9, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, Enter: 13 };
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: codes[name], nativeVirtualKeyCode: codes[name], modifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: codes[name], nativeVirtualKeyCode: codes[name], modifiers });
};
const button = (text, scope = "document") => `[...${scope}.querySelectorAll('button')].find(element => element.textContent.trim() === ${JSON.stringify(text)})`;
const selectView = async (label) => {
  if (await evaluate("innerWidth < 1024")) {
    await click("document.querySelector('[aria-label=\"Open navigation\"]')");
    await waitFor("document.querySelector('[aria-label=\"Open navigation\"]').getAttribute('aria-expanded')==='true'");
    await waitFor("document.getElementById('admin-navigation').getBoundingClientRect().left >= -0.5");
  }
  await click(button(label, "document.querySelector('nav[aria-label=\"Admin navigation\"]')"));
  await waitFor(`document.querySelector('h1')?.textContent === ${JSON.stringify(label)}`);
  await waitFor("document.body.innerText.includes('Synthetic') || document.body.innerText.includes('No data')");
};
const capture = async (name) => {
  const result = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(path.join(screenshots, `${name}.png`), Buffer.from(result.data, "base64"));
};

const customer = { id: "000000000000000000000101", name: "Synthetic Customer", email: "synthetic@example.test", phone: "9123456789", role: "Renter", status: "Active", created: "2026-10-16", createdAt: "2026-10-16T00:00:00Z" };
const documentRecord = { id: "000000000000000000000102", customerId: customer.id, customer: customer.name, email: customer.email, role: "Renter", fileName: "synthetic-document.png", document: "Passport", docType: "id", approval: "Pending", processingStage: "pending_review", submitted: "2026-10-16", fileAvailable: false, canApprove: false, canCompareManually: false, accountLink: { status: "registered", label: "Registered customer", customerId: customer.id } };
const booking = { id: "000000000000000000000103", reference: "SYNTHETIC-1", renter: customer.name, vehicle: "Synthetic Vehicle", operator: "Synthetic Operator", status: "Confirmed", pickupAt: "2026-10-17T09:00:00Z", returnAt: "2026-10-18T09:00:00Z", createdAt: "2026-10-16T00:00:00Z" };
const report = { id: "000000000000000000000104", caseReference: "SYNTHETIC-REPORT-1", categoryLabel: "Booking concern", description: "Synthetic report used only to exercise admin UI controls.", status: "open", priority: "normal", sourceType: "booking", createdAt: "2026-10-16T00:00:00Z", reporter: customer, reportedUser: { name: "Synthetic Operator", email: "operator@example.test" }, reportedRole: "owner", evidence: [], activity: [] };
const vehicle = { id: "000000000000000000000105", name: "Synthetic Vehicle", operator: "Synthetic Operator", status: "Available", type: "Car", category: "Sedan", location: "Synthetic operating area", plateNumber: "QA-001", rentalRate: 1000, seats: 4 };
const fixtureModule = `import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import AdminAccountPage from '/AdminAccountPage.jsx';
import AdminModal from '/src/admin/components/AdminModal.jsx';
import {FilterSelect} from '/src/admin/components/AdminUI.jsx';
import '/src/index.css';
const {useState, StrictMode}=React; const {createRoot}=ReactDOM;
function ModalFixture(){const [open,setOpen]=useState(false),[nested,setNested]=useState(false),[busy,setBusy]=useState(false),[value,setValue]=useState('one');
return <main className="admin-ui p-4"><button id="modal-trigger" onClick={()=>setOpen(true)}>Open fixture modal</button>{open?<AdminModal onClose={()=>setOpen(false)} busy={busy}><section role="dialog" aria-modal="true" aria-labelledby="fixture-title" className="w-full max-w-md overflow-y-auto bg-white p-5"><h2 id="fixture-title">Synthetic dialog</h2><button data-dialog-initial onClick={()=>setOpen(false)}>Close fixture</button><FilterSelect label="Fixture choice" value={value} onChange={setValue} options={['one','two']}/><button onClick={()=>setNested(true)}>Open nested modal</button><button onClick={()=>setBusy(!busy)}>{busy?'Finish fixture request':'Start fixture request'}</button></section></AdminModal>:null}{nested?<AdminModal onClose={()=>setNested(false)}><section role="dialog" aria-modal="true" aria-labelledby="nested-title" className="w-full max-w-sm bg-white p-5"><h2 id="nested-title">Synthetic nested dialog</h2><button onClick={()=>setNested(false)}>Close nested</button></section></AdminModal>:null}</main>}
createRoot(document.getElementById('root')).render(<StrictMode>{location.pathname==='/qa-ui-modal'?<ModalFixture/>:<AdminAccountPage user={{name:'Synthetic Admin',email:'admin@example.test'}} onLogout={()=>{window.__syntheticLogout=true}}/>}</StrictMode>);`;
const transformed = await transform(fixtureModule, { loader: "jsx", jsx: "transform" });
const fixtureHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/qa-ui-module.jsx"></script></body></html>`;

const fulfill = async ({ requestId, request }) => {
  const url = new URL(request.url);
  let body;
  let contentType = "application/json";
  let status = 200;
  if (url.pathname === "/qa-ui-module.jsx") { body = transformed.code; contentType = "application/javascript"; }
  else if (url.pathname.startsWith("/qa-ui")) { body = fixtureHtml; contentType = "text/html"; }
  else if (url.pathname.endsWith("/admin/data")) {
    if (failRefresh) { status = 503; body = { message: "Synthetic refresh failure. Please retry." }; }
    else body = { customers: [customer], documents: [documentRecord], bookings: [booking], vehicles: [vehicle], operationalAlerts: [], syncedAt: "2026-10-16T00:00:00Z", page: { hasMore: false } };
  } else if (url.pathname.endsWith("/admin/reports")) body = { reports: [report], summary: { open: 1 }, page: { hasMore: false, total: 1 } };
  else if (url.pathname.endsWith("/admin/audit-logs")) body = { logs: [{ id: "synthetic-log", createdAt: "2026-10-16T00:00:00Z", action: "synthetic_check", outcome: "success", targetLabel: "Synthetic record", summary: "Synthetic audit entry" }], actions: ["synthetic_check"], summary: { total: 1, success: 1 }, page: { total: 1, hasMore: false } };
  else if (url.pathname.endsWith("/auth/sessions")) body = { sessions: [{ id: "synthetic-session", current: true, userAgent: "Synthetic Chrome/1 Windows", expiresAt: "2026-10-17T00:00:00Z", lastSeenAt: "2026-10-16T00:00:00Z" }] };
  else if (url.pathname.endsWith("/auth/passkey/status")) body = { enabled: false, enabledAt: null };
  else if (url.pathname.endsWith("/admin/transactions")) {
    transactionRequests++;
    const end = url.searchParams.get("trendEndMonth") || "2026-10";
    const date = new Date(`${end}-01T12:00:00`);
    const monthlyTrend = Array.from({ length: 6 }, (_, index) => { const month = new Date(date.getFullYear(), date.getMonth() - 5 + index, 1); return { key: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`, collected: 0, outstanding: 0 }; });
    const transactions = transactionMode === "empty" ? [] : [
      { _id: "000000000000000000000201", bookingStatus: "confirmed", paymentStatus: "partial", rentalAmount: 1000, transactionFee: 100, amountPayable: 1100, paymentAmountPaid: transactionPaid, paymentAmountDue: 1100 - transactionPaid, paymongoReference: "SYNTHETIC-PAYMENT-1", paymentMethod: "PayMongo", paymentChannel: "card", createdAt: "2026-10-16T00:00:00Z", renter: { name: "Synthetic Renter" }, owner: { name: "Synthetic Owner" }, vehicle: { name: "Synthetic Vehicle" } },
      { _id: "000000000000000000000202", bookingStatus: "completed", paymentStatus: "paid", rentalAmount: 500, transactionFee: 100, amountPayable: 600, paymentAmountPaid: 600, paymentAmountDue: 0, paymongoReference: "SYNTHETIC-PAYMENT-2", paymentMethod: "Walk-in", createdAt: "2026-10-16T00:00:00Z" },
      { _id: "000000000000000000000203", bookingStatus: "pending", paymentStatus: "unpaid", rentalAmount: 200, transactionFee: 100, amountPayable: 300, paymentAmountPaid: 0, paymentAmountDue: 300, paymongoReference: "SYNTHETIC-PAYMENT-3", createdAt: "2026-10-16T00:00:00Z" },
    ];
    const paymentStatus = url.searchParams.get("paymentStatus") || "all";
    const search = (url.searchParams.get("search") || "").toLowerCase();
    const rows = transactions.filter(row => (paymentStatus === "all" || row.paymentStatus === paymentStatus) && (!search || JSON.stringify(row).toLowerCase().includes(search)));
    const totals = transactions.reduce((sum, row) => ({ totalCollected: sum.totalCollected + row.paymentAmountPaid, totalOutstanding: sum.totalOutstanding + row.paymentAmountDue, totalPayable: sum.totalPayable + row.amountPayable, totalTransactionFees: sum.totalTransactionFees + row.transactionFee }), { totalCollected: 0, totalOutstanding: 0, totalPayable: 0, totalTransactionFees: 0 });
    Object.assign(monthlyTrend.at(-1), { collected: totals.totalCollected, outstanding: totals.totalOutstanding });
    body = { transactions: rows, summary: { totalRecords: transactions.length, paidBookings: transactions.filter(row => row.paymentStatus === "paid").length, unpaidBookings: transactions.filter(row => row.paymentStatus === "unpaid").length, partialPayments: transactions.filter(row => row.paymentStatus === "partial").length, refundedBookings: 0, ...totals, monthlyTrend, trendStartMonth: monthlyTrend[0].key }, page: { hasMore: false } };
    if (transactionMode === "failure") { status = 503; body = { message: "Synthetic transaction request failed." }; }
    else if (transactionMode === "invalid") body = { transactions: [], page: { hasMore: false } };
    else if (transactionMode === "records" && url.searchParams.has("paymentStatus")) await new Promise(resolve => setTimeout(resolve, 350));
  } else { status = 503; body = { message: "This synthetic fixture blocks unhandled admin requests." }; }
  await send("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: contentType }, { name: "X-RentifyPro-Admin-Contract", value: ADMIN_API_CONTRACT_VERSION }], body: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)).toString("base64") });
};
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") void fulfill(message.params).catch((error) => errors.push(error.message));
  else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.bringToFront");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/qa-ui*" }, { urlPattern: "*/api/*" }] });
  for (const width of [320, 390, 768, 1024, 1280, 1440]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    await send("Page.navigate", { url: `${origin}/qa-ui-admin` });
    await waitFor("document.querySelector('h1')?.textContent==='Dashboard' && document.querySelector('[aria-label=\"Priority platform statistics\"]')!==null");
    await evaluate("document.fonts.ready");
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Open navigation\"]').getClientRects().length > 0"), width < 1024);
    if (transactionsOnly) {
      transactionMode = "records";
      transactionPaid = 300;
      await selectView("Transaction Records");
      assert.equal(await evaluate("document.querySelector('[aria-label=\"Transaction statistics\"]')===null"), true, "Loading must not present zero totals as real data");
      await waitFor("document.querySelectorAll('tbody tr').length===3");
      await waitFor("!document.querySelector('[aria-label=\"Refresh transaction records\"]').disabled");
      assert.equal(await evaluate("(() => { const title=document.querySelector('h1').getBoundingClientRect(), control=document.querySelector('[aria-label=\"Hide transaction records\"]').getBoundingClientRect(); return title.right<=control.left || title.bottom<=control.top || title.top>=control.bottom; })()"), true, "Title and eye control must not overlap");
      assert.equal(await evaluate("document.querySelector('[aria-label=\"Transaction statistics\"]').textContent.includes('₱900.00')"), true);
      assert.equal(await evaluate("(() => { const amount=[...document.querySelectorAll('[aria-label=\"Transaction statistics\"] p')].find(element=>element.textContent==='₱900.00');return amount.getBoundingClientRect().height<=parseFloat(getComputedStyle(amount).lineHeight)+1; })()"), true, "Currency amounts must not split across lines");
      assert.equal(await evaluate("document.querySelector('tbody tr td:nth-child(6)').textContent.trim()"), "₱1,100.00");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('tbody tr td:nth-child(6)')).textAlign"), "right");
      await click("document.querySelector('[aria-label=\"Hide transaction records\"]')");
      await waitFor("document.getElementById('transaction-records-content').textContent.includes('Transaction records hidden')");
      assert.equal(await evaluate("document.getElementById('transaction-records-content').querySelector('table')===null && !document.getElementById('transaction-records-content').textContent.includes('₱')"), true);
      assert.equal(await evaluate("document.querySelector('[aria-label=\"Show transaction records\"]').nextElementSibling.getAttribute('aria-label')"), "Refresh transaction records");
      assert.equal(await evaluate("document.querySelector('[aria-label=\"Show transaction records\"]').getAttribute('aria-pressed')"), "true");
      transactionPaid = 600;
      const beforeRefresh = transactionRequests;
      await click("document.querySelector('[aria-label=\"Refresh transaction records\"]')");
      for (let attempt = 0; attempt < 100 && transactionRequests < beforeRefresh + 2; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
      await waitFor("!document.querySelector('[aria-label=\"Refresh transaction records\"]').disabled");
      assert.ok(transactionRequests >= beforeRefresh + 2, "Both record totals and trend refresh while hidden");
      assert.equal(await evaluate("document.getElementById('transaction-records-content').querySelector('table')===null"), true);
      await click("document.querySelector('[aria-label=\"Show transaction records\"]')");
      await waitFor("document.querySelectorAll('tbody tr').length===3");
      assert.equal(await evaluate("document.querySelector('[aria-label=\"Transaction statistics\"]').textContent.includes('₱1,200.00')"), true);
      await click(button("Partial"));
      await waitFor("document.querySelectorAll('tbody tr').length===1 && document.querySelector('tbody tr').textContent.includes('SYNTHETIC-PAYMENT-1')");
      assert.equal(await evaluate("document.querySelector('[aria-label=\"Transaction statistics\"]').textContent.includes('₱1,200.00')"), true, "Filtered rows must not change platform totals");
      await click("document.querySelector('[aria-label=\"Hide transaction records\"]')");
      await click("document.querySelector('[aria-label=\"Show transaction records\"]')");
      assert.equal(await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Partial').getAttribute('aria-pressed')"), "true");
      transactionMode = "failure";
      await click("document.querySelector('[aria-label=\"Refresh transaction records\"]')");
      await waitFor("document.getElementById('transaction-records-content').textContent.includes('Transaction records unavailable')");
      assert.equal(await evaluate("document.getElementById('transaction-records-content').querySelector('[aria-label=\"Transaction statistics\"]')===null"), true);
      transactionMode = "invalid";
      await click(button("Try again"));
      await waitFor("document.getElementById('transaction-records-content').textContent.includes('incomplete or invalid')");
      transactionMode = "records";
      await click(button("Try again"));
      await waitFor("document.querySelector('tbody tr')?.textContent.includes('SYNTHETIC-PAYMENT-1')");
      await click(button("Retry payment history"));
      await waitFor("!document.getElementById('transaction-records-content').textContent.includes('Synthetic transaction request failed')");
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
      if (width === 390 || width === 1280) await capture(`transaction-records-${width}`);
      checks.push(`${width}px: eye immediately precedes Refresh; all transaction data hides; hidden refresh updates totals; filters persist; monetary columns align; loading, failure, and malformed data never show invented zero totals; retry recovers`);
      continue;
    }
    if (width === 390 || width === 1280) await capture(`dashboard-${width}`);
    for (const label of ["Dashboard", "Bookings", "Transaction Records", "Vehicles", "Customers", "Documents", "User Reports", "Audit Logs", "Security"]) {
      if (label !== "Dashboard") await selectView(label);
      if (label === "User Reports") await waitFor("document.body.innerText.includes('SYNTHETIC-REPORT-1')");
      if (label === "Audit Logs") await waitFor("document.body.innerText.includes('Synthetic audit entry')");
      if (label === "Security") await waitFor("document.body.innerText.includes('Active admin sessions')");
      if (label === "Transaction Records") await waitFor("document.body.innerText.includes('No transaction records') || document.body.innerText.includes('No records')");
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `${label} overflow at ${width}px`);
      const smallButtons = await evaluate("[...document.querySelectorAll('.admin-ui button')].filter(element=>element.getClientRects().length && !element.closest('[inert]') && element.getBoundingClientRect().height<43.5).map(element=>({text:element.textContent.trim(),height:element.getBoundingClientRect().height}))");
      assert.deepEqual(smallButtons, [], `${label} undersized buttons at ${width}px`);
      if (label === "Documents") {
        assert.equal(await evaluate("getComputedStyle(document.querySelector('input[type=search]')).fontSize"), width < 640 ? "16px" : "14px");
        assert.equal(await evaluate("getComputedStyle(document.querySelector('[role=combobox]')).fontSize"), width < 640 ? "16px" : "14px");
      }
      checks.push(`${width}px: ${label} navigation, contained layout, 44px controls`);
    }
    await selectView("Customers");
    await click("document.querySelector('tbody button[aria-haspopup=\"menu\"]')");
    await waitFor("document.querySelector('[role=menu]')!==null");
    await waitFor("document.querySelector('[role=menu]')?.contains(document.activeElement)");
    await key("ArrowDown");
    assert.equal(await evaluate("document.activeElement.textContent.trim()"), "Disable account");
    await key("Escape");
    await waitFor("document.querySelector('[role=menu]')===null");
    assert.equal(await evaluate("document.activeElement.getAttribute('aria-haspopup')"), "menu");
    await click("document.querySelector('tbody button[aria-haspopup=\"menu\"]')");
    await waitFor("document.querySelector('[role=menu]')!==null");
    await click(button("Edit customer", "document.querySelector('[role=menu]')"));
    await waitFor("document.querySelector('[aria-labelledby=customer-edit-title]')?.contains(document.activeElement)");
    assert.equal(await evaluate("document.body.style.overflow"), "hidden");
    await send("Emulation.setDeviceMetricsOverride", { width, height: 540, deviceScaleFactor: 1, mobile: width < 768 });
    assert.equal(await evaluate("document.querySelector('[role=dialog]').getBoundingClientRect().bottom <= innerHeight && document.querySelector('[role=dialog]').getBoundingClientRect().top >= 0"), true);
    if (width === 390 || width === 1280) await capture(`edit-short-screen-${width}`);
    await key("Escape");
    await waitFor("document.querySelector('[role=dialog]')===null");
    assert.equal(await evaluate("document.getElementById('root').inert"), false);
    assert.equal(await evaluate("document.body.style.overflow"), "");
    assert.equal(await evaluate("document.activeElement.getAttribute('aria-haspopup')"), "menu");
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    for (const label of ["Bookings", "Vehicles", "Documents"]) {
      await selectView(label);
      await click("document.querySelector('tbody tr td:last-child button')");
      await waitFor("document.querySelector('[role=dialog]')?.contains(document.activeElement)");
      await send("Emulation.setDeviceMetricsOverride", { width, height: 540, deviceScaleFactor: 1, mobile: width < 768 });
      assert.equal(await evaluate("document.querySelector('[role=dialog]').getBoundingClientRect().bottom <= innerHeight && document.querySelector('[role=dialog]').getBoundingClientRect().top >= 0"), true, `${label} dialog must fit a short viewport`);
      await key("Escape");
      await waitFor("document.querySelector('[role=dialog]')===null");
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    }
    await selectView("User Reports");
    await waitFor("document.body.innerText.includes('SYNTHETIC-REPORT-1')");
    await click(width < 1024 ? "document.querySelector('button[aria-label*=\"SYNTHETIC\"]') || [...document.querySelectorAll('button')].find(element=>element.textContent.includes('Booking concern'))" : button("Review"));
    await waitFor("document.querySelector('[aria-labelledby=report-review-title]')?.contains(document.activeElement)");
    await click(button("Make decision", "document.querySelector('[role=dialog]')"));
    await waitFor("document.querySelector('[aria-labelledby=decision-title]')?.contains(document.activeElement)");
    assert.equal(await evaluate("document.querySelectorAll('[role=dialog]').length"), 2);
    assert.equal(await evaluate("document.querySelector('[aria-labelledby=report-review-title]').closest('.admin-modal').inert"), true);
    if (width === 390 || width === 1280) await capture(`decision-${width}`);
    await key("Escape");
    await waitFor("document.querySelectorAll('[role=dialog]').length===1");
    assert.equal(await evaluate("document.querySelector('[aria-labelledby=report-review-title]').contains(document.activeElement)"), true);
    await key("Escape");
    await waitFor("document.querySelector('[role=dialog]')===null");
    checks.push(`${width}px: customer edit fits short screens; nested report dialogs restore focus and Escape closes only the top dialog`);
    if (width < 1024) {
      await click("document.querySelector('[aria-label=\"Open navigation\"]')");
      await waitFor("document.getElementById('admin-navigation').getBoundingClientRect().left >= -0.5");
      assert.equal(await evaluate("document.body.style.overflow"), "hidden");
      await key("Tab", 8);
      assert.equal(await evaluate("document.activeElement.textContent.trim()"), "Sign Out");
      await click(button("Sign Out", "document.querySelector('aside')"));
      await waitFor("document.querySelector('[aria-labelledby=admin-logout-title]')?.contains(document.activeElement)");
      assert.equal(await evaluate("document.body.style.overflow"), "hidden");
      await key("Escape");
      await waitFor("document.querySelector('[role=dialog]')===null");
      assert.equal(await evaluate("document.body.style.overflow"), "");
      assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), "Open navigation");
      checks.push(`${width}px: mobile menu traps focus; sign-out modal keeps scrolling locked and cancellation restores the menu trigger`);
    }
  }
  await selectView("Dashboard");
  failRefresh = true;
  await click("document.querySelector('[aria-label=\"Refresh admin data\"]')");
  await waitFor("document.querySelector('.admin-toast-region [role=alert]')!==null");
  assert.equal(await evaluate("document.querySelector('.admin-toast-region [data-tone=error]')?.textContent.includes('Synthetic refresh failure')"), true);
  await click("document.querySelector('[aria-label=\"Dismiss notification\"]')");
  await waitFor("document.querySelector('.admin-toast-region')===null");
  failRefresh = false;
  await click("document.querySelector('[aria-label=\"Refresh admin data\"]')");
  await waitFor("document.querySelector('.admin-toast-region [role=status]')!==null");
  checks.push("Refresh failure uses an error icon and alert; dismissal works; retry uses success status");

  await send("Page.navigate", { url: `${origin}/qa-ui-modal` });
  await waitFor("document.getElementById('modal-trigger')!==null");
  await click("document.getElementById('modal-trigger')");
  await waitFor("document.querySelector('[role=dialog]')?.contains(document.activeElement)");
  const firstControl = await evaluate("document.activeElement.textContent");
  await key("Tab", 8);
  assert.equal(await evaluate("document.activeElement.textContent"), "Start fixture request");
  await key("Tab");
  assert.equal(await evaluate("document.activeElement.textContent"), firstControl);
  await click("document.querySelector('[role=combobox]')");
  await waitFor("document.querySelector('[role=listbox]')!==null");
  await key("Escape");
  await waitFor("document.querySelector('[role=listbox]')===null");
  assert.equal(await evaluate("document.querySelector('[role=dialog]')!==null"), true);
  await click(button("Start fixture request"));
  await key("Escape");
  assert.equal(await evaluate("document.querySelector('[role=dialog]')!==null"), true);
  await click(button("Finish fixture request"));
  await key("Escape");
  await waitFor("document.querySelector('[role=dialog]')===null");
  assert.equal(await evaluate("document.activeElement.id"), "modal-trigger");
  assert.equal(await evaluate("document.body.style.overflow"), "");
  checks.push("StrictMode: focus wraps in both directions; dropdown Escape leaves modal open; busy Escape is blocked; focus and scrolling restore after close");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ simulated: true, checks, screenshots }, null, 2));
} catch (error) {
  await capture("failure").catch(() => {});
  console.error(JSON.stringify({ screenshots, state: await evaluate("({width:innerWidth,title:document.querySelector('h1')?.textContent,active:document.activeElement?.outerHTML.slice(0,300),overflow:document.documentElement.scrollWidth})").catch(() => null) }));
  throw error;
} finally {
  await send("Page.close").catch(() => {});
  ws.close();
}
