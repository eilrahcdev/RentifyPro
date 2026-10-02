// Run Vite at 127.0.0.1:4176 and isolated headless Chrome with CDP at 9236.
// All API and address data below are fixtures; no account or document is created.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = "http://127.0.0.1:4176";
const target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 0;
const pending = new Map();
const errors = [];
const uploads = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error.message));
    else call?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") {
    handleRequest(message.params).catch((error) => errors.push(error.message));
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
};
const respond = (requestId, status, data) => send("Fetch.fulfillRequest", {
  requestId,
  responseCode: status,
  responseHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" },
    { name: "Access-Control-Allow-Headers", value: "content-type,x-pre-kyc-token" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,OPTIONS" },
  ],
  body: Buffer.from(JSON.stringify(data)).toString("base64"),
});
const handleRequest = async ({ requestId, request }) => {
  const url = new URL(request.url);
  if (url.hostname === "psgc.gitlab.io") {
    let data = [];
    if (url.pathname.endsWith("/regions/")) data = [{ code: "01", name: "Fixture Region" }];
    if (url.pathname.endsWith("/cities-municipalities/")) data = [{ code: "010101", name: "Fixture City" }];
    if (url.pathname.endsWith("/barangays/")) data = [{ code: "010101001", name: "Fixture Barangay" }];
    return respond(requestId, 200, data);
  }
  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return respond(requestId, 200, {});
    if (url.pathname === "/api/auth/me") return respond(requestId, 401, { message: "No session" });
    if (url.pathname === "/api/auth/check-registration-email") return respond(requestId, 200, { success: true, available: true });
    if (url.pathname === "/api/kyc/pre/session") return respond(requestId, 200, { preKycToken: "fixture-token" });
    if (url.pathname === "/api/kyc/pre/supporting-doc/verify") {
      const body = JSON.parse(request.postData || "{}");
      uploads.push({ type: body.supporting_doc_type, profile: body.user_profile });
      return respond(requestId, 200, { success: true, message: "Fixture document queued." });
    }
    if (url.pathname === "/api/kyc/pre/status") return respond(requestId, 200, { documents: [] });
    return respond(requestId, 200, { success: true, vehicles: [], notifications: [] });
  }
  if (url.origin === base) return send("Fetch.continueRequest", { requestId });
  return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
};
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const wait = async (expression) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-1000)")}`);
};
const setInput = (selector, value) => evaluate(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  if (!input) throw Error('Missing input: ' + ${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
const choose = (value) => evaluate(`(() => {
  const select = [...document.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === ${JSON.stringify(value)}));
  if (!select) throw Error('Missing option: ' + ${JSON.stringify(value)});
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)});
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
const clickButton = (label) => evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)})?.click()`);

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  for (const width of [390, 1200]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    await send("Page.navigate", { url: `${base}/register-owner` });
    await wait("document.querySelector('input[name=firstName]')");
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Registration progress\"] ol').children.length"), 5);
    assert.equal(await evaluate("document.querySelector('input[name=businessName]')"), null);
    await setInput("input[name=firstName]", "Maria");
    await setInput("input[name=lastName]", "Cruz");
    await setInput("input[name=businessEmail]", `owner${width}@gmail.com`);
    await setInput("input[name=phone]", "9123456789");
    await setInput('input[placeholder="Create Password"]', "Example123!abcd");
    await setInput('input[placeholder="Confirm Password"]', "Example123!abcd");
    await clickButton("Next");
    await wait("document.body.innerText.includes('Step 2 — Address')");
    assert.equal(await evaluate("document.querySelector('input[name=firstName]')"), null);
    await choose("01");
    await wait("[...document.querySelectorAll('select')].some(select => [...select.options].some(option => option.value === '010101'))");
    await choose("010101");
    await wait("[...document.querySelectorAll('select')].some(select => [...select.options].some(option => option.value === '010101001'))");
    await choose("010101001");
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await clickButton("Next");
    await wait("document.body.innerText.includes('Step 3 — Business document')");
    await choose("BIR Notice to Issue Receipt/Invoice");
    await wait("document.querySelector('input[name=taxIdentificationNumber]')");
    assert.equal(await evaluate("document.querySelector('input[name=permitNumber]')"), null);
    await setInput("input[name=businessName]", "Maria's Motors");
    await setInput("input[name=taxIdentificationNumber]", "123456789");
    await setInput("input[name=branchCode]", "00000");
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(join(tmpdir(), `rp-owner-registration-${width}.png`), Buffer.from(screenshot.data, "base64"));
    await evaluate(`(() => {
      const file = new File(['%PDF-1.4\\nfixture'], 'business.pdf', { type: 'application/pdf' });
      const transfer = new DataTransfer(); transfer.items.add(file);
      const input = document.querySelector('input[type=file]');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await wait("document.body.innerText.includes('business.pdf')");
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await clickButton("Upload and continue");
    await wait("document.body.innerText.includes('Step 4 — Identity verification')");
    assert.equal(uploads.at(-1)?.profile.tax_identification_number, "123456789");
    assert.equal(uploads.at(-1)?.profile.branch_code, "00000");
    assert.equal(uploads.at(-1)?.profile.permit_number, "");
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await clickButton("Back");
    await wait("document.body.innerText.includes('Step 3 — Business document')");
    await choose("Mayor's/Business Permit");
    await wait("document.querySelector('input[name=permitNumber]')");
    assert.equal(await evaluate("document.querySelector('input[name=taxIdentificationNumber]')"), null);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
    console.log(`owner ${width}px: five-step progress, BIR fields, permit fields, and upload transition passed`);
  }
  assert.deepEqual(errors, []);
} finally {
  ws.close();
  await fetch(`http://127.0.0.1:9236/json/close/${target.id}`).catch(() => {});
}
