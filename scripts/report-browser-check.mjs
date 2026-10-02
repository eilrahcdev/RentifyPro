// node --experimental-websocket scripts/report-browser-check.mjs
// Requires Vite on 4176 and an isolated headless Chrome on CDP 9236.
// Mounts the real report components with fixture props and stubbed submission methods.
// External HTTP traffic is blocked. No real reports or accounts are created.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = "http://127.0.0.1:4176";
const frontend = fileURLToPath(new URL("../frontend/", import.meta.url));
const fixtureDirectory = path.join(frontend, ".vite");
const fixtureName = `report-check-${process.pid}`;
const fixturePaths = [path.join(fixtureDirectory, `${fixtureName}.html`), path.join(fixtureDirectory, `${fixtureName}.jsx`)];
  const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ReportIssueModal from "../src/components/ReportIssueModal";
import MessageReportModal from "../src/components/MessageReportModal";
import API from "../src/utils/api";
import "../src/index.css";
window.reportCalls = []; window.reportSuccesses = []; window.pendingReports = [];
const request = (kind, payload) => {
  window.reportCalls.push({ kind, payload });
  return new Promise((resolve, reject) => window.pendingReports.push({ resolve, reject }));
};
API.createReport = data => request("booking", [...data.entries()].map(([key, value]) => [key, typeof value === "string" ? value : value.name]));
API.reportChatMessage = (id, category) => request("message", { id, category });
window.finishReport = (mode = "success") => {
  const pending = window.pendingReports.shift();
  if (mode === "success") pending.resolve({ report: { caseReference: "RPT-FIXTURE" } });
  else pending.reject(Object.assign(new Error(mode === "duplicate" ? "You already submitted this report." : "Fixture connection failed. Please retry."), mode === "duplicate" ? { details: { code: "DUPLICATE_REPORT", reportId: "existing-fixture" } } : {}));
};
const booking = { _id: "507f1f77bcf86cd799439012", owner: { name: "Fixture Owner" }, renter: { name: "Fixture Renter" } };
const message = { _id: "507f1f77bcf86cd799439019", text: "This is the exact reported message." };
function App() {
  const [open, setOpen] = useState(""); const [version, setVersion] = useState(0);
  window.replaceReportTarget = () => setVersion(v => v + 1);
  return <><button id="open-booking" onClick={() => setOpen("booking")}>Open booking report</button>
    <button id="open-owner" onClick={() => setOpen("owner")}>Open owner report</button>
    <button id="open-message" onClick={() => setOpen("message")}>Open message report</button>
    <ReportIssueModal booking={open === "booking" || open === "owner" ? { ...booking, _id: booking._id + version } : null} perspective={open === "owner" ? "owner" : "renter"} onClose={() => setOpen("")} onSubmitted={r => window.reportSuccesses.push(r)} />
    <MessageReportModal message={open === "message" ? message : null} senderName="Fixture Sender" onClose={() => setOpen("")} onReported={r => window.reportSuccesses.push(r)} />
  </>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
`;

let ws;
let send;
const errors = [];
const checks = [];
const modalSizes = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await fs.mkdir(fixtureDirectory, { recursive: true });
  await fs.writeFile(fixturePaths[0], `<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/.vite/${fixtureName}.jsx"></script></body></html>`);
  await fs.writeFile(fixturePaths[1], fixture);
  const target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const call = pending.get(message.id); pending.delete(message.id);
      if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    else if (message.method === "Fetch.requestPaused") {
      const { request, requestId } = message.params;
      const url = new URL(request.url);
      const blocked = url.origin !== base || url.pathname.startsWith("/api/");
      send(blocked ? "Fetch.failRequest" : "Fetch.continueRequest", { requestId, ...(blocked ? { errorReason: "Aborted" } : {}) }).catch(error => errors.push(error.message));
    }
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  const wait = async expression => {
    for (let i = 0; i < 150; i++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(100); }
    throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText")}`);
  };
  const click = async label => {
    assert.equal(await evaluate(`(() => { const e = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(label)}); if (!e) return false; e.click(); return true; })()`), true, label);
    await pause(30);
  };
  const key = async (name, modifiers = 0) => {
    const windowsVirtualKeyCode = { Tab: 9, Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38 }[name];
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, modifiers, windowsVirtualKeyCode, ...(name === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, modifiers, windowsVirtualKeyCode });
    await pause(30);
  };
  const fill = async value => {
    await evaluate(`(() => { const e = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await pause(30);
  };
  const selectCategory = async () => {
    await evaluate(`document.querySelector('[aria-haspopup="listbox"]').click()`);
    await wait(`document.querySelector('[role="option"]')`);
    await evaluate(`document.querySelector('[role="option"]').click()`);
    await pause(30);
  };
  const attach = async specs => {
    await evaluate(`(() => { const data = new DataTransfer(); for (const spec of ${JSON.stringify(specs)}) data.items.add(new File([new Uint8Array(spec.size)], spec.name, { type: spec.type })); const input = document.querySelector('input[type="file"]'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await pause(30);
  };
  const open = async label => {
    await evaluate(`document.querySelector(${JSON.stringify(label)}).focus()`);
    await evaluate(`document.querySelector(${JSON.stringify(label)}).click()`);
    await wait(`document.querySelector('dialog[open]')`);
  };
  const body = () => evaluate("document.body.innerText");
  const review = async () => { await click("Review report"); await wait(`document.body.innerText.includes('Submit this report?')`); };
  const count = () => evaluate("window.reportCalls.length");
  const assertCompact = async (view, width) => {
    const size = await evaluate(`(() => { const dialog = document.querySelector('dialog'); const form = dialog.querySelector('form'); return { height: Math.ceil(form.getBoundingClientRect().height), scrollHeight: dialog.scrollHeight, viewportHeight: innerHeight }; })()`);
    if (size.scrollHeight > size.viewportHeight + 1) await fs.writeFile(path.join(os.tmpdir(), "rentifypro-report-overflow.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    assert.ok(size.scrollHeight <= size.viewportHeight + 1, `${view} at ${width}px must fit without modal scrolling: ${JSON.stringify(size)}`);
    modalSizes.push({ view, width, height: size.height });
  };
  await send("Page.navigate", { url: `${base}/.vite/${fixtureName}.html` });
  await wait(`document.querySelector('#open-booking')`);
  await open("#open-booking");
  await click("Review report");
  assert.equal(await count(), 0);
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-haspopup')`), "listbox");
  assert.ok((await body()).includes("at least 20 characters"));
  await selectCategory();
  await fill("                  "); await click("Review report");
  assert.equal(await evaluate("document.activeElement.tagName"), "TEXTAREA");
  await fill("x".repeat(3001)); await click("Review report");
  assert.ok((await body()).includes("within 3,000"));
  const description = "  The vehicle had a broken headlight when I arrived.  ";
  await fill(description);
  checks.push("Required fields, trimmed description boundaries, and first-invalid-field focus");

  const valid = { name: "booking-evidence.pdf", type: "application/pdf", size: 100 };
  await attach([valid]);
  for (const invalid of [[{ name: "bad.exe", type: "application/octet-stream", size: 100 }], [{ ...valid, size: 0 }], [{ ...valid, size: 5 * 1024 * 1024 + 1 }], Array(6).fill(valid)]) {
    await attach(invalid); await click("Review report");
    assert.ok((await body()).includes("Your previous attachments have been kept."));
    assert.ok((await body()).includes("booking-evidence.pdf"));
    assert.equal(await evaluate("document.activeElement.textContent.trim()"), "Choose files");
    assert.equal(await count(), 0);
  }
  await attach([]);
  assert.ok((await body()).includes("Dismiss attachment error"));
  await click("Dismiss attachment error");
  await review();
  assert.equal(await count(), 0);
  assert.ok((await body()).includes(description.trim()));
  assert.ok((await body()).includes("booking-evidence.pdf"));
  await click("Back to edit");
  assert.equal(await evaluate("document.querySelector('textarea').value"), description);
  assert.ok((await body()).includes("booking-evidence.pdf"));
  checks.push("Invalid evidence is rejected without losing valid attachments; unresolved errors block review");

  await evaluate(`document.querySelector('[aria-haspopup="listbox"]').focus()`); await key("ArrowDown");
  assert.equal(await evaluate("document.activeElement.getAttribute('role')"), "option");
  await key("ArrowDown"); await key("Escape");
  assert.equal(await evaluate("Boolean(document.querySelector('dialog[open]'))"), true);
  assert.equal(await evaluate("Boolean(document.querySelector('[role=listbox]'))"), false);
  await review(); await key("Escape");
  assert.equal(await evaluate("document.querySelector('textarea').value"), description);
  await review();
  await evaluate(`document.querySelector('#open-booking').focus()`);
  assert.equal(await evaluate("document.querySelector('dialog').contains(document.activeElement)"), true);
  await evaluate(`[...document.querySelectorAll('dialog button')].find(e => e.textContent.trim() === 'Confirm and submit').focus()`); await key("Tab");
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), "Back to edit report");
  await key("Tab", 8);
  assert.equal(await evaluate("document.activeElement.textContent.trim()"), "Confirm and submit");
  await evaluate(`document.querySelector('dialog h2').focus()`); await key("Enter");
  assert.equal(await count(), 0);
  checks.push("Category keyboard navigation, Escape back to edit, modal focus containment, and no implicit confirmation");

  for (const width of [1440, 1024, 768, 430, 390, 360]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 640, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setTouchEmulationEnabled", { enabled: width < 768 });
    assert.equal(await evaluate("document.querySelector('dialog').scrollWidth <= window.innerWidth"), true, `review width ${width}`);
    await assertCompact("Booking review", width);
    await click("Back to edit");
    assert.equal(await evaluate("document.querySelector('dialog').scrollWidth <= window.innerWidth"), true, `edit width ${width}`);
    await assertCompact("Booking edit", width);
    await evaluate(`document.querySelector('[aria-haspopup="listbox"]').click()`);
    await assertCompact("Booking category menu", width);
    await key("Escape");
    await review();
  }
  await click("Back to edit");
  await attach(Array.from({ length: 5 }, (_, index) => ({ ...valid, name: `evidence-${index}.pdf` })));
  await fill("Detailed incident description. ".repeat(100).slice(0, 3000));
  await assertCompact("Booking edit with five files", 360);
  await fs.writeFile(path.join(os.tmpdir(), "rentifypro-report-edit-360.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await review();
  await assertCompact("Booking review with long details and five files", 360);
  await click("Back to edit"); await attach([valid]); await fill(description); await review();
  await fs.writeFile(path.join(os.tmpdir(), "rentifypro-report-confirmation-360.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  checks.push("Booking edit and review views fit 1440, 1024, 768, 430, 390, and 360px");

  await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Confirm and submit'); button.click(); button.click(); document.querySelector('form').requestSubmit(); })()`);
  await wait("window.reportCalls.length === 1");
  assert.equal(await count(), 1);
  assert.equal(await evaluate("[...document.querySelectorAll('dialog button')].every(e => e.disabled)"), true);
  await key("Escape"); assert.equal(await evaluate("Boolean(document.querySelector('dialog[open]'))"), true);
  await evaluate(`window.finishReport('error')`); await wait(`document.body.innerText.includes('Fixture connection failed')`);
  await click("Back to edit");
  assert.equal(await evaluate("document.querySelector('textarea').value"), description);
  assert.ok((await body()).includes("booking-evidence.pdf"));
  await review(); await click("Confirm and submit");
  await evaluate(`window.finishReport('duplicate')`); await wait(`document.body.innerText.includes('View existing report')`);
  assert.ok((await evaluate(`document.querySelector('dialog a').getAttribute('href')`)).endsWith("#report-existing-fixture"));
  await click("Confirm and submit"); await evaluate(`window.finishReport()`);
  await wait("!document.querySelector('dialog')");
  assert.equal(await evaluate("document.activeElement.id"), "open-booking");
  const payload = await evaluate("window.reportCalls[0].payload");
  assert.ok(payload.some(([name, value]) => name === "description" && value === description.trim()));
  assert.ok(payload.some(([name, value]) => name === "evidence" && value === valid.name));
  checks.push("One request per confirmation, busy controls, retry draft retention, duplicate link, success, and focus restoration");

  await open("#open-owner");
  assert.equal(await evaluate("document.querySelector('textarea').value"), "");
  assert.ok((await body()).includes("Fixture Renter"));
  await selectCategory(); await fill(description); await review(); await click("Confirm and submit");
  const successes = await evaluate("window.reportSuccesses.length");
  await evaluate("window.replaceReportTarget()"); await wait("document.querySelector('textarea')");
  await evaluate("window.finishReport()"); await pause(50);
  assert.equal(await evaluate("window.reportSuccesses.length"), successes);
  assert.equal(await evaluate("Boolean(document.querySelector('dialog[open]'))"), true);
  await click("Cancel");
  checks.push("Owner perspective, fresh drafts on reopen, and stale response protection when the target changes");

  const beforeMessage = await count();
  await open("#open-message"); await click("Review report");
  assert.equal(await count(), beforeMessage);
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-haspopup')"), "listbox");
  await selectCategory(); await review();
  assert.equal(await count(), beforeMessage);
  assert.ok((await body()).includes("This is the exact reported message."));
  for (const width of [1440, 1024, 768, 430, 390, 360]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 640, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setTouchEmulationEnabled", { enabled: width < 768 });
    assert.equal(await evaluate("document.querySelector('dialog').scrollWidth <= window.innerWidth"), true, `message review width ${width}`);
    await assertCompact("Message review", width);
    await click("Back to edit");
    assert.equal(await evaluate("document.querySelector('dialog').scrollWidth <= window.innerWidth"), true, `message edit width ${width}`);
    await assertCompact("Message edit", width);
    await evaluate(`document.querySelector('[aria-haspopup="listbox"]').click()`);
    await assertCompact("Message category menu", width);
    await key("Escape");
    await review();
  }
  checks.push("Message edit and review views fit all six viewport widths");
  await click("Back to edit");
  assert.equal(await evaluate(`document.querySelector('[aria-haspopup="listbox"]').getAttribute('aria-invalid')`), "false");
  await review();
  await evaluate(`[...document.querySelectorAll('dialog button')].find(e => e.textContent.trim() === 'Confirm and submit').focus()`);
  await key("Enter");
  await wait("window.pendingReports.length > 0");
  await evaluate("window.finishReport('error')"); await wait(`document.body.innerText.includes('Fixture connection failed')`);
  await click("Confirm and submit"); await evaluate("window.finishReport()"); await wait("!document.querySelector('dialog')");
  assert.deepEqual(await evaluate("window.reportCalls.at(-1).payload"), { id: "507f1f77bcf86cd799439019", category: "harassment" });
  checks.push("Message validation, exact message review, preserved category, explicit confirmation, retry, and success");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, checks, modalSizes, screenshot: path.join(os.tmpdir(), "rentifypro-report-confirmation-360.png") }, null, 2));
} finally {
  if (send && ws?.readyState === WebSocket.OPEN) { await send("Page.close"); ws.close(); }
  await Promise.all(fixturePaths.map(file => fs.rm(file, { force: true })));
}
