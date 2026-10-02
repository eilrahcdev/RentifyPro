// Vite on 4176; isolated Chrome CDP on 9236. All service responses are fixtures.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = "http://127.0.0.1:4176";
const frontend = fileURLToPath(new URL("../frontend/", import.meta.url));
const fixtureName = `auto-growing-check-${process.pid}`;
const fixtureDirectory = path.join(frontend, ".vite");
const fixturePaths = ["html", "jsx"].map((extension) => path.join(fixtureDirectory, `${fixtureName}.${extension}`));
const screenshotDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-auto-growing-"));
const fixture = `
import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import AutoResizeTextarea from "../src/components/AutoResizeTextarea";
import BookingReviewModal from "../src/components/BookingReviewModal";
import ReportIssueModal from "../src/components/ReportIssueModal";
import ReportsCenter from "../src/components/ReportsCenter";
import ReturnReviewModal from "../src/owner/components/ReturnReviewModal";
import VehiclePhotoReviews from "../src/components/VehiclePhotoReviews";
import Vehicles from "../src/owner/pages/Vehicles";
import BookingsPage from "../src/pages/BookingsPage";
import { DocumentReviewDialog } from "../src/admin/components/AdminUI";
import ReportsView from "../src/admin/pages/ReportsView";
import ChatWidget from "../src/components/ChatWidget";
import API from "../src/utils/api";
import { adminDataApi } from "../src/admin/adminDataApi";
import { setSessionUser } from "../src/utils/sessionStore";
import "../src/index.css";

const user = { _id: "507f1f77bcf86cd799439011", role: "user", name: "Fixture Renter", isVerified: true, kycStatus: "approved" };
setSessionUser(user);
const booking = { _id: "507f1f77bcf86cd799439012", status: "confirmed", paymentStatus: "paid", paymentAmountDue: 0,
  totalAmount: 1000, vehicleDailyRate: 500, pickupAt: new Date(Date.now() - 172800000).toISOString(),
  returnAt: new Date(Date.now() - 3600000).toISOString(), lateReturn: { isOverdue: true },
  owner: { _id: "507f1f77bcf86cd799439013", name: "Fixture Owner" }, vehicle: { name: "Toyota Innova", images: [], location: "Dagupan City" } };
const report = { _id: "report-fixture", caseReference: "FIXTURE-001", category: "vehicle_condition", status: "open", priority: "normal",
  createdAt: new Date().toISOString(), booking: booking._id, description: "Fixture incident description for layout verification.", evidence: [],
  reporter: { name: "Fixture Renter" }, reporterRole: "renter", reportedUser: { name: "Fixture Owner" }, reportedRole: "owner" };
window.fixtureCalls = [];
API.getMyReports = async () => ({ reports: [{ ...report, _id: "appeal", canAppeal: true, perspective: "received", status: "actioned" },
  { ...report, _id: "information", perspective: "submitted", status: "awaiting_information", informationRequest: "Provide the incident date." }] });
API.getOwnerVehicles = async () => ({ vehicles: [] });
API.getMyBookings = async ({view}) => ({ bookings: view === "history" ? [] : [booking], page: { hasMore: false } });
API.getUnreadNotificationCount = async () => ({ count: 0 });
API.getUnreadMessageCount = async () => ({ count: 0 });
API.getVehiclePhotos = async () => ({ photos: [{ id: "photo-fixture", vehicleType: "car", status: "needs_review", reason: "Fixture review" }] });
API.reviewVehiclePhoto = async (id, body) => { window.fixtureCalls.push({ kind: "photo", id, body }); return {}; };
API.reviewBooking = async (id, body) => { window.fixtureCalls.push({ kind: "review", id, body }); return { booking: { ...booking, reviewRating: body.rating } }; };
API.chatWithBot = async (body) => { window.fixtureCalls.push({ kind: "chat", body }); return { reply: "Fixture response", language: "en", recommendations: [] }; };
adminDataApi.getReports = async () => ({ reports: [report], summary: {} });
const noop = () => {};

function App() {
  const [mode, setMode] = useState("generic");
  const [note, setNote] = useState("");
  const ref = useRef(null);
  window.fixtureShow = (next) => { setNote(""); setMode(next); };
  window.fixtureSetNote = setNote;
  window.fixtureFocus = () => ref.current.focus();
  const body = mode === "review" ? <BookingReviewModal booking={booking} onClose={noop} />
    : mode === "incident" ? <ReportIssueModal booking={booking} onClose={noop} />
    : mode === "return" ? <ReturnReviewModal review={{ booking, action: "confirm" }} note={note} loading={false} onNoteChange={setNote} onClose={noop} onSubmit={noop} />
    : mode === "reports" ? <ReportsCenter embedded />
    : mode === "photos" ? <VehiclePhotoReviews admin />
    : mode === "vehicles" ? <Vehicles />
    : mode === "bookings" ? <BookingsPage isLoggedIn user={user} />
    : mode === "document" ? <DocumentReviewDialog document={{ fileName: "Fixture document", customer: "Fixture Applicant", role: "Renter", document: "ID", approval: "Pending", canReview: true }} onClose={noop} onApprove={noop} onReject={noop} />
    : mode === "admin-reports" ? <ReportsView />
    : mode === "chat" ? <ChatWidget isOpen onClose={noop} />
    : <form id="fixture-form" className="mx-auto max-w-lg space-y-4">
        <label className="block">Controlled note<AutoResizeTextarea ref={ref} id="controlled" value={note} onChange={event => setNote(event.target.value)} className="rounded-xl border px-3 py-2 text-base leading-6" /></label>
        <label className="block">Uncontrolled note<AutoResizeTextarea id="uncontrolled" name="reason" className="rounded-xl border px-3 py-2 text-base leading-6" /></label>
        <div id="hidden-container" style={{display: "none"}}><AutoResizeTextarea id="hidden-note" defaultValue={"A saved note ".repeat(20)} className="rounded-xl border px-3 py-2 text-base leading-6" /></div>
      </form>;
  return <main className="p-4" key={mode}>{body}</main>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
`;

let ws;
let target;
let sequence = 0;
const pending = new Map();
const errors = [];
const checks = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = async (expression) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await pause(75);
  }
  throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-1400)")}`);
};
const set = async (selector, value) => {
  await evaluate(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await pause(80);
};
const show = async (mode, selector) => {
  await evaluate(`window.fixtureShow(${JSON.stringify(mode)})`);
  await wait(`document.querySelector(${JSON.stringify(selector)})`);
  await pause(100);
};
const clickText = async (text) => {
  await wait(`[...document.querySelectorAll('button')].some(button => button.textContent.trim() === ${JSON.stringify(text)})`);
  await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
};
const metrics = (selector) => evaluate(`(() => {
  const field = document.querySelector(${JSON.stringify(selector)});
  const style = getComputedStyle(field);
  const rect = field.getBoundingClientRect();
  return { height: rect.height, width: rect.width, left: rect.left, right: rect.right, clientHeight: field.clientHeight, scrollHeight: field.scrollHeight,
    overflowY: style.overflowY, value: field.value, maxLength: field.maxLength, rows: field.rows, fontSize: parseFloat(style.fontSize) };
})()`);
const screenshot = async (name) => {
  await fs.writeFile(path.join(screenshotDirectory, `${name}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64"));
};
const viewport = async (width, height = 844) => {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
  await send("Emulation.setTouchEmulationEnabled", { enabled: width < 768 });
  await pause(100);
};
const paragraph = "The vehicle was clean and pickup was easy ";
async function checkField(name, selector, { rows = 1, maxLength, review = false } = {}) {
  const empty = await metrics(selector);
  assert.equal(empty.rows, rows, name);
  assert.ok(empty.height >= 44 && empty.height <= (rows === 1 ? 56 : 80), `${name}: compact initial height ${empty.height}`);
  if (maxLength !== undefined) assert.equal(empty.maxLength, maxLength, name);
  await set(selector, paragraph.repeat(12));
  const wrapped = await metrics(selector);
  assert.ok(wrapped.height > empty.height, `${name}: grows on wrapping`);
  assert.equal(wrapped.value, paragraph.repeat(12), `${name}: wrapping preserves value`);
  await set(selector, paragraph.repeat(40));
  const capped = await metrics(selector);
  assert.ok(capped.height <= 200, `${name}: bounded height`);
  assert.ok(capped.scrollHeight > capped.clientHeight && capped.overflowY === "auto", `${name}: scrolls at cap`);
  await set(selector, review ? "Good\nride! 🚗" : "First line\nSecond line");
  assert.equal((await metrics(selector)).value, review ? "Good ride " : "First line\nSecond line", `${name}: existing newline rules`);
  await set(selector, "");
  assert.ok(Math.abs((await metrics(selector)).height - empty.height) <= 1, `${name}: shrinks after deletion`);
  checks.push(name);
}

try {
  await fs.mkdir(fixtureDirectory, { recursive: true });
  await fs.writeFile(fixturePaths[0], `<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/.vite/${fixtureName}.jsx"></script></body></html>`);
  await fs.writeFile(fixturePaths[1], fixture);
  target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const call = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) call?.reject(new Error(message.error.message));
      else call?.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    } else if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const local = new URL(request.url).origin === base && !new URL(request.url).pathname.startsWith("/api/");
      send(local ? "Fetch.continueRequest" : "Fetch.failRequest", local ? { requestId } : { requestId, errorReason: "Aborted" }).catch(error => errors.push(error.message));
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setBlockedURLs", { urls: ["ws://*", "wss://*"] });
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Storage.clearDataForOrigin", { origin: base, storageTypes: "all" });
  await viewport(1366, 900);
  await send("Page.navigate", { url: `${base}/.vite/${fixtureName}.html` });
  await wait("document.getElementById('controlled')");
  await checkField("controlled note", "#controlled");
  await evaluate("window.fixtureSetNote('Loaded draft '.repeat(40))");
  await wait("document.getElementById('controlled').clientHeight > 80");
  await evaluate("window.fixtureFocus()");
  assert.equal(await evaluate("document.activeElement.id"), "controlled");
  await evaluate("window.fixtureSetNote('')");
  await checkField("uncontrolled note", "#uncontrolled");
  await set("#uncontrolled", paragraph.repeat(25));
  assert.equal(await evaluate("new FormData(document.getElementById('fixture-form')).get('reason')"), paragraph.repeat(25));
  await evaluate("document.getElementById('fixture-form').reset()");
  await wait("document.getElementById('uncontrolled').clientHeight <= 44");
  await evaluate("document.getElementById('hidden-container').style.display = 'block'");
  await wait("document.getElementById('hidden-note').clientHeight > 44");
  await set("#controlled", paragraph.repeat(4));
  await viewport(390);
  const mobileHeight = (await metrics("#controlled")).height;
  await viewport(1366, 900);
  assert.ok((await metrics("#controlled")).height < mobileHeight, "shrinks after width increases");
  checks.push("loaded drafts, native ref, form reset, hidden field, responsive width");

  for (const width of [1366, 390, 320]) {
    await viewport(width, width > 768 ? 900 : 844);
    await show("review", "#booking-review-comment");
    await checkField(`review ${width}px`, "#booking-review-comment", { maxLength: 1200, review: true });
    await screenshot(`review-${width}`);
    await show("incident", "#report-description");
    await checkField(`incident ${width}px`, "#report-description", { rows: 2, maxLength: 3000 });
    await show("return", "textarea");
    await checkField(`return note ${width}px`, "textarea", { maxLength: 500 });
    await show("document", "#document-rejection-reason");
    await checkField(`document instructions ${width}px`, "#document-rejection-reason", { rows: 2, maxLength: 500 });
    await show("admin-reports", "button");
    await wait("document.body.innerText.includes('FIXTURE-001')");
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('FIXTURE-001')).click()");
    await wait("document.querySelectorAll('textarea').length === 4");
    for (const [index, name] of ["information request", "policy reason", "user explanation", "internal note"].entries()) {
      await checkField(`admin ${name} ${width}px`, `textarea:nth-of-type(1)[placeholder=${JSON.stringify(["Specify the dates, explanation, or evidence needed to continue review.", "Policy or evidence supporting the decision", "Clear, respectful explanation", "Private administrative context"][index])}]`, { rows: index === 3 ? 1 : 2, maxLength: index === 3 ? 2000 : 1000 });
    }
    await show("reports", "button");
    await clickText("Appeal decision");
    await wait("document.querySelector('textarea[aria-label=\"Appeal explanation\"]')");
    await checkField(`appeal ${width}px`, 'textarea[aria-label="Appeal explanation"]', { rows: 2 });
    await clickText("Provide requested information");
    await wait("document.querySelector('textarea[aria-label=\"Requested report information\"]')");
    await checkField(`report response ${width}px`, 'textarea[aria-label="Requested report information"]', { rows: 2 });
    await show("photos", "textarea[name=reason]");
    await checkField(`photo reason ${width}px`, "textarea[name=reason]", { maxLength: 500 });
    await show("vehicles", ".rp-owner-vehicles");
    await evaluate("window.dispatchEvent(new Event('open-add-vehicle'))");
    await wait("document.getElementById('owner-vehicle-description')");
    await checkField(`vehicle description ${width}px`, "#owner-vehicle-description", { rows: 2, maxLength: 2000 });
    await show("bookings", "button");
    await clickText("Extend Rental Time");
    await wait("document.querySelector('textarea[aria-label=\"Optional note to owner\"]')");
    await checkField(`extension note ${width}px`, 'textarea[aria-label="Optional note to owner"]', { maxLength: 500 });
    await show("chat", 'textarea[aria-label="Message Rentify AI"]');
    const selector = 'textarea[aria-label="Message Rentify AI"]';
    const initial = await metrics(selector);
    assert.equal(initial.rows, 1);
    assert.equal(initial.maxLength, 500);
    await set(selector, paragraph.repeat(12));
    const grown = await metrics(selector);
    assert.ok(grown.height > initial.height && grown.height <= 100, `chat ${width}px: three-line cap`);
    assert.equal(grown.overflowY, "auto");
    assert.equal(grown.value, paragraph.repeat(12).slice(0, 500));
    assert.ok(grown.left >= 0 && grown.right <= width, `chat ${width}px: fits viewport`);
    if (width < 768) assert.ok(grown.fontSize >= 16, "mobile input font avoids focus zoom");
    await screenshot(`chat-${width}`);
    await set(selector, "");
    assert.equal((await metrics(selector)).height, initial.height);
    checks.push(`chat layout ${width}px`);
  }

  const chatSelector = 'textarea[aria-label="Message Rentify AI"]';
  await evaluate(`document.querySelector(${JSON.stringify(chatSelector)}).focus()`);
  await send("Input.insertText", { text: paragraph.repeat(25) });
  assert.equal((await metrics(chatSelector)).value.length, 500, "native chatbot limit during paste");
  await set(chatSelector, "Can I rent a Toyota in Cebu for ₱2,000?");
  await evaluate(`document.querySelector(${JSON.stringify(chatSelector)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))`);
  assert.equal(await evaluate("window.fixtureCalls.filter(call => call.kind === 'chat').length"), 0, "IME Enter does not send");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await wait("window.fixtureCalls.some(call => call.kind === 'chat')");
  assert.equal(await evaluate("window.fixtureCalls.find(call => call.kind === 'chat').body.message"), "Can I rent a Toyota in Cebu for ₱2,000?");
  await wait(`document.querySelector(${JSON.stringify(chatSelector)}).value === ''`);
  assert.ok((await metrics(chatSelector)).height <= 50, "chat shrinks after send");
  await wait("!document.body.innerText.includes('Rentify AI is thinking')");
  await set(chatSelector, paragraph.repeat(12));
  await evaluate("document.querySelector('button[aria-label=\"Start a new chatbot conversation\"]').click()");
  await wait(`document.querySelector(${JSON.stringify(chatSelector)}).value === ''`);
  checks.push("chat paste limit, IME, Enter send, Unicode payload, send/new-conversation reset");
  await viewport(390, 560);
  await show("incident", "#report-description");
  await set("#report-description", paragraph.repeat(40));
  assert.ok((await metrics("#report-description")).height <= 100, "short mobile screen uses a smaller cap");
  assert.equal((await metrics("#report-description")).overflowY, "auto");
  await screenshot("incident-short-mobile");
  checks.push("short mobile viewport cap");
  assert.deepEqual(errors, [], "browser exceptions");
  console.log(JSON.stringify({ passed: checks, screenshotDirectory }, null, 2));
} finally {
  ws?.close();
  if (target) await fetch(`http://127.0.0.1:9236/json/close/${target.id}`).catch(() => {});
  await Promise.all(fixturePaths.map(file => fs.rm(file, { force: true })));
}
