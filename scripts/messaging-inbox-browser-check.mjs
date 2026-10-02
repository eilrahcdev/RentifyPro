// Fixture browser check. Run with Vite on 4184 and Chrome CDP on 9245.
// Uses the real messaging pages with stubbed chat APIs; no account or message is changed.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = "http://127.0.0.1:4184";
const frontend = fileURLToPath(new URL("../frontend/", import.meta.url));
const fixtureName = `messaging-inbox-check-${process.pid}`;
const fixturePaths = [
  path.join(frontend, ".vite", `${fixtureName}.html`),
  path.join(frontend, ".vite", `${fixtureName}.jsx`),
];
const screenshotDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-messaging-check-"));
const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import RealtimeChatPage from "../src/pages/RealtimeChatPage";
import OwnerMessages from "../src/owner/pages/Messages";
import API from "../src/utils/api";
import { setSessionUser } from "../src/utils/sessionStore";
import "../src/index.css";

const ownerOne = { _id: "507f1f77bcf86cd799439011", name: "Alex Owner", email: "alex@example.test" };
const ownerTwo = { _id: "507f1f77bcf86cd799439012", name: "Blair Owner", email: "blair@example.test" };
const directOwner = { _id: "507f1f77bcf86cd799439013", name: "Direct Owner", email: "direct@example.test" };
const renter = { _id: "507f1f77bcf86cd799439014", name: "Taylor Renter", email: "taylor@example.test" };
const message = (id, sender, receiver, text) => ({ _id: id, sender, receiver, text, createdAt: "2026-09-30T09:00:00.000Z" });
const conversations = [
  { partner: ownerOne, lastMessage: { ...message("m1", ownerOne, renter, "Secret pickup code one"), vehicle: { name: "Toyota Vios" } }, recentBooking: { vehicle: { name: "Toyota Vios" }, status: "completed" }, unreadCount: 2 },
  { partner: ownerTwo, lastMessage: { ...message("m2", ownerTwo, renter, "Secret pickup code two"), vehicle: { name: "Honda City" } }, unreadCount: 1 },
];
const threads = [
  { partner: renter, vehicle: { name: "Toyota Vios" }, recentBooking: { vehicle: { name: "Toyota Vios" }, status: "confirmed" }, statusLabel: "Active Rental", isActive: true, unreadCount: 2, lastMessage: message("m3", renter, ownerOne, "Private renter message") },
];
setSessionUser(renter);
window.fixtureSetOwnerLastMessage = (lastMessage) => { threads[0].lastMessage = lastMessage; };
window.fixtureSetRenterLastMessage = (lastMessage) => { conversations[0].lastMessage = lastMessage; };
window.fixtureCalls = [];
const call = (kind, id) => window.fixtureCalls.push({ kind, id });
API.getConversations = async () => ({ conversations });
API.getOwnerRenterThreads = async () => ({ renters: threads });
API.getMessagesWithUser = async (id) => { call("messages", id); return { messages: id === ownerTwo._id ? [conversations[1].lastMessage] : id === renter._id ? [threads[0].lastMessage] : [] }; };
API.markMessagesAsRead = async (id) => { call("read", id); return { success: true }; };
API.openOwnerRenterThread = async (id) => { call("open", id); return { success: true }; };
API.setOwnerRenterThreadPin = async (id, pinned) => { call("pin", id); return { pinned, pinnedAt: new Date().toISOString() }; };
API.setConversationArchived = async (id, archived) => { call(archived ? "archive" : "restore", id); const item = conversations.find((entry) => entry.partner._id === id) || threads.find((entry) => entry.partner._id === id); if (item) item.isArchived = archived; return { archived }; };
API.deleteConversation = async (id) => { call("delete", id); return { success: true }; };
API.getUnreadNotificationCount = async () => ({ count: 0 });

function App() {
  const [mode, setMode] = useState("renter");
  const [directContext, setDirectContext] = useState(null);
  window.fixtureShow = (nextMode) => {
    setSessionUser(nextMode === "owner" ? ownerOne : renter);
    setDirectContext(nextMode === "direct" ? { partnerId: directOwner._id, partnerName: directOwner.name, partnerEmail: directOwner.email, vehicleId: "507f1f77bcf86cd799439015" } : null);
    setMode(nextMode);
  };
  return mode === "owner"
    ? <OwnerMessages key="owner" />
    : <RealtimeChatPage key={mode} isLoggedIn user={renter} initialChatContext={directContext} onChatContextHandled={() => setDirectContext(null)} />;
}
createRoot(document.getElementById("root")).render(<App />);
`;

let ws;
const pending = new Map();
const errors = [];
let sequence = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result?.value;
};
const wait = async (expression) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}`);
};
const screenshot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await fs.writeFile(path.join(screenshotDirectory, `${name}.png`), Buffer.from(data, "base64"));
};
const setViewport = (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });

try {
  await fs.mkdir(path.dirname(fixturePaths[0]), { recursive: true });
  await fs.writeFile(fixturePaths[0], `<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/.vite/${fixtureName}.jsx"></script></body></html>`);
  await fs.writeFile(fixturePaths[1], fixture);
  const target = await (await fetch("http://127.0.0.1:9245/json/new?about:blank", { method: "PUT" })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry?.reject(new Error(`${entry.method || "CDP"}: ${message.error.message}`));
      else entry?.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    } else if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const url = new URL(request.url);
      const blocked = url.origin !== base || url.pathname.startsWith("/api/");
      send(blocked ? "Fetch.failRequest" : "Fetch.continueRequest", { requestId, ...(blocked ? { errorReason: "Aborted" } : {}) }).catch((error) => errors.push(error.message));
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await setViewport(1440, 900);
  await send("Page.navigate", { url: `${base}/.vite/${fixtureName}.html` });
  await wait("document.querySelectorAll('.rp-chat-conversation').length === 2");
  assert.equal(await evaluate("Boolean(document.querySelector('.rp-chat-inbox-empty'))"), true);
  assert.deepEqual(await evaluate("window.fixtureCalls.filter(call => call.kind === 'messages' || call.kind === 'read')"), []);
  assert.equal(await evaluate("document.querySelectorAll('.rp-chat-conversation-preview p')[0].textContent"), "Secret pickup code one");
  assert.equal(await evaluate("document.querySelectorAll('.rp-chat-conversation-preview p')[1].textContent"), "Secret pickup code two");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.rp-chat-conversation-preview p')).fontWeight < getComputedStyle(document.querySelector('.rp-chat-conversation-title p')).fontWeight"), true);
  await screenshot("renter-desktop-inbox");

  await evaluate("document.querySelectorAll('.rp-chat-conversation-select')[1].focus()");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await wait("document.querySelector('.rp-chat-thread-header h2')?.textContent === 'Blair Owner' && window.fixtureCalls.some(call => call.kind === 'messages' && call.id === '507f1f77bcf86cd799439012')");
  assert.deepEqual(await evaluate("window.fixtureCalls.filter(call => call.kind === 'messages' || call.kind === 'read')"), [
    { kind: "messages", id: "507f1f77bcf86cd799439012" },
    { kind: "read", id: "507f1f77bcf86cd799439012" },
  ]);
  await evaluate("document.querySelector('button[aria-label=\"Show chat details\"]').click()");
  await wait("document.querySelector('.rp-chat-details-pane') !== null");
  assert.equal(await evaluate("document.querySelector('.rp-chat-details-pane').innerText.includes('blair@example.test')"), true);
  await screenshot("renter-desktop-details");
  await evaluate("document.querySelector('button[aria-label=\"Close chat details\"]').click()");
  const initialComposerHeight = await evaluate("document.querySelector('.rp-chat-composer textarea').clientHeight");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.rp-chat-composer textarea')).textAlign"), "start");
  await evaluate("document.querySelector('.rp-chat-composer textarea').focus()");
  await send("Input.insertText", { text: Array.from({ length: 45 }, () => "hello").join(" ") });
  await wait(`document.querySelector('.rp-chat-composer textarea').clientHeight > ${initialComposerHeight}`);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.rp-chat-composer textarea')).textAlign"), "start");
  assert.equal(await evaluate("document.querySelector('.rp-chat-composer textarea').clientHeight <= 112"), true);
  assert.equal(await evaluate("document.querySelector('.rp-chat-composer textarea').maxLength"), 2000);
  assert.equal(await evaluate("document.querySelector('.rp-chat-composer .rp-chat-character-counter') === null"), true);
  assert.equal(await evaluate("document.querySelectorAll('.rp-chat-thread-tools .rp-chat-more-button').length"), 1);
  await evaluate("document.querySelectorAll('.rp-chat-conversation .rp-chat-more-button')[0].click()");
  await wait("document.querySelector('[role=menuitem]') !== null");
  await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(button => button.textContent === 'Archive chat').click()");
  await wait("document.querySelectorAll('.rp-chat-conversation').length === 1");
  await evaluate("document.querySelector('.rp-chat-folder-nav button:nth-child(2)').click()");
  await wait("document.querySelector('.rp-chat-conversation-select')?.innerText.includes('Alex Owner')");
  await evaluate("document.querySelector('.rp-chat-conversation .rp-chat-more-button').click()");
  await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(button => button.textContent === 'Restore chat').click()");
  await wait("document.querySelectorAll('.rp-chat-conversation').length === 0");
  await evaluate("document.querySelector('.rp-chat-folder-nav button:first-child').click()");
  await wait("document.querySelectorAll('.rp-chat-conversation').length === 2");
  await evaluate("document.querySelector('.rp-chat-conversation-select').click()");
  await evaluate("document.querySelector('button[aria-label=\"Show chat details\"]').click()");
  await wait("document.querySelector('.rp-chat-details-pane')?.innerText.includes('Recently rented')");
  assert.equal(await evaluate("document.querySelector('.rp-chat-details-pane').innerText.includes('Toyota Vios')"), true);
  await evaluate("document.querySelector('button[aria-label=\"Close chat details\"]').click()");
  await evaluate("document.querySelector('.rp-chat-search input').focus()");
  await wait("document.body.innerText.includes('Recent searches')");
  await evaluate("document.querySelector('.rp-chat-search-back').click()");
  assert.equal(await evaluate("document.querySelector('.rp-chat-search-back') === null"), true);
  await evaluate("document.querySelector('.rp-chat-search input').focus()");
  await send("Input.insertText", { text: "Blair" });
  await wait("document.querySelectorAll('.rp-chat-conversation').length === 1");
  await evaluate("document.querySelector('.rp-chat-conversation-select').focus(); document.querySelector('.rp-chat-conversation-select').click()");
  await evaluate("document.querySelector('.rp-chat-search input').focus()");
  await wait("document.body.innerText.includes('Recent searches') && document.querySelectorAll('.rp-chat-conversation').length === 1");
  assert.equal(await evaluate("document.querySelector('.rp-chat-conversation-select').innerText.includes('Blair Owner')"), true);
  await evaluate("document.querySelector('.rp-chat-search-back').click()");

  await evaluate("window.fixtureShow('owner')");
  await wait("document.querySelectorAll('.owner-renter-card').length === 1");
  assert.equal(await evaluate("document.querySelector('.owner-renter-preview').textContent"), "Private renter message");
  assert.equal(await evaluate("document.querySelector('.owner-renter-card-select').getAttribute('aria-label').includes('Private renter message')"), true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.owner-renter-preview')).fontWeight < getComputedStyle(document.querySelector('.owner-renter-name')).fontWeight"), true);
  assert.equal(await evaluate("Boolean(document.querySelector('.owner-renter-card .rp-chat-more-button'))"), true);
  await screenshot("owner-desktop-inbox");
  const callsBeforePin = await evaluate("window.fixtureCalls.filter(call => call.kind === 'messages').length");
  await evaluate("document.querySelector('.owner-renter-card .rp-chat-more-button').click()");
  await wait("document.querySelector('[role=menuitem]') !== null");
  await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(button => button.textContent === 'Pin chat').click()");
  await wait("window.fixtureCalls.some(call => call.kind === 'pin')");
  assert.equal(await evaluate("window.fixtureCalls.filter(call => call.kind === 'messages').length"), callsBeforePin);
  await evaluate("document.querySelector('.owner-renter-card-select').focus()");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await wait("document.body.innerText.includes('Private renter message')");
  assert.equal(await evaluate("document.querySelectorAll('.owner-messages-thread-header .rp-chat-more-button').length"), 1);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.owner-messages-composer textarea')).textAlign"), "start");
  assert.equal(await evaluate("document.querySelector('.owner-messages-composer textarea').maxLength"), 2000);
  assert.equal(await evaluate("document.querySelector('.owner-messages-composer .rp-chat-character-counter') === null"), true);
  await evaluate("document.querySelector('button[aria-label=\"Show chat details\"]').click()");
  await wait("document.querySelector('.rp-chat-details-pane') !== null");
  assert.equal(await evaluate("document.querySelector('.rp-chat-details-pane').innerText.includes('taylor@example.test')"), true);
  assert.equal(await evaluate("document.querySelector('.rp-chat-details-pane').innerText.includes('Booking context')"), false);
  await screenshot("owner-desktop-details");
  await evaluate("document.querySelector('button[aria-label=\"Close chat details\"]').click()");
  await evaluate("document.querySelector('.owner-renter-card .rp-chat-more-button').click()");
  await wait("[...document.querySelectorAll('[role=menuitem]')].some(button => button.textContent === 'Archive chat')");
  await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(button => button.textContent === 'Archive chat').click()");
  await wait("document.querySelectorAll('.owner-renter-card').length === 0");
  await evaluate("document.querySelector('.rp-chat-folder-nav button:nth-child(2)').click()");
  await wait("document.querySelectorAll('.owner-renter-card').length === 1");
  await evaluate("document.querySelector('.owner-renter-card .rp-chat-more-button').click()");
  await wait("[...document.querySelectorAll('[role=menuitem]')].some(button => button.textContent === 'Restore chat')");
  await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(button => button.textContent === 'Restore chat').click()");
  await wait("document.querySelectorAll('.owner-renter-card').length === 0");
  await evaluate("document.querySelector('.rp-chat-folder-nav button:first-child').click()");
  assert.equal(await evaluate("window.fixtureCalls.some(call => call.kind === 'read' && call.id === '507f1f77bcf86cd799439014')"), true);

  await setViewport(390, 568);
  await evaluate("window.fixtureShow('renter')");
  await wait("document.querySelectorAll('.rp-chat-conversation').length === 2 && getComputedStyle(document.querySelector('.rp-chat-sidebar')).display !== 'none'");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.rp-chat-thread')).display"), "none");
  assert.equal(await evaluate("document.body.scrollWidth <= innerWidth"), true);
  await screenshot("renter-mobile-inbox");
  await evaluate("document.querySelector('.rp-chat-conversation-select').click()");
  await wait("getComputedStyle(document.querySelector('.rp-chat-thread')).display !== 'none' && document.activeElement === document.querySelector('.rp-chat-back-button')");
  assert.equal(await evaluate("document.querySelectorAll('.rp-chat-thread-tools .rp-chat-more-button').length"), 1);
  await evaluate("document.querySelector('button[aria-label=\"Show chat details\"]').click()");
  await wait("document.querySelector('.rp-chat-details-pane') !== null");
  assert.equal(await evaluate("document.querySelector('.rp-chat-details-pane').getBoundingClientRect().right <= innerWidth + 1"), true);
  await evaluate("document.querySelector('button[aria-label=\"Close chat details\"]').click()");
  assert.equal(await evaluate("document.querySelector('.rp-chat-composer').getBoundingClientRect().bottom <= innerHeight + 1"), true);
  await screenshot("renter-mobile-thread");
  await setViewport(667, 375);
  await wait("innerWidth === 667");
  assert.equal(await evaluate("document.querySelector('.rp-chat-composer').getBoundingClientRect().bottom <= innerHeight + 1"), true);
  assert.equal(await evaluate("document.body.scrollWidth <= innerWidth"), true);
  await setViewport(768, 600);
  await wait("innerWidth === 768");
  assert.equal(await evaluate("document.querySelector('.rp-chat-composer').getBoundingClientRect().bottom <= innerHeight + 1"), true);
  assert.equal(await evaluate("document.body.scrollWidth <= innerWidth"), true);
  await setViewport(390, 568);
  await wait("document.querySelector('.rp-chat-back-button') !== null");
  await evaluate("document.querySelector('.rp-chat-back-button').click()");
  await wait("getComputedStyle(document.querySelector('.rp-chat-sidebar')).display !== 'none' && document.activeElement === document.querySelector('.rp-chat-conversation-select')");
  assert.equal(await evaluate("document.querySelector('.rp-chat-inbox-empty') !== null"), true);

  await evaluate("window.fixtureShow('owner')");
  await wait("document.querySelector('.owner-renter-card-select') !== null && getComputedStyle(document.querySelector('.owner-messages-renters')).display !== 'none'");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.owner-messages-thread')).display"), "none");
  await screenshot("owner-mobile-inbox");
  await evaluate("document.querySelector('.owner-renter-card-select').click()");
  await wait("getComputedStyle(document.querySelector('.owner-messages-thread')).display !== 'none' && document.activeElement === document.querySelector('button[aria-label=\"Back to renters\"]')");
  assert.equal(await evaluate("document.querySelectorAll('.owner-messages-thread-header .rp-chat-more-button').length"), 1);
  await screenshot("owner-mobile-thread");
  await setViewport(768, 600);
  await wait("innerWidth === 768");
  assert.equal(await evaluate("document.querySelector('.owner-messages-composer').getBoundingClientRect().bottom <= innerHeight + 1"), true);
  assert.equal(await evaluate("document.body.scrollWidth <= innerWidth"), true);
  await setViewport(390, 568);
  await wait("document.querySelector('button[aria-label=\"Back to renters\"]') !== null");
  await evaluate("document.querySelector('button[aria-label=\"Back to renters\"]').click()");
  await wait("getComputedStyle(document.querySelector('.owner-messages-renters')).display !== 'none' && document.activeElement === document.querySelector('.owner-renter-card-select')");
  assert.equal(await evaluate("document.querySelector('.owner-renter-card .rp-chat-more-button') !== null"), true);

  await evaluate("window.fixtureSetOwnerLastMessage({ _id: 'long', sender: { _id: '507f1f77bcf86cd799439014' }, receiver: { _id: '507f1f77bcf86cd799439011' }, text: 'longword'.repeat(180), createdAt: '2026-09-30T10:00:00.000Z' }); window.fixtureShow('renter')");
  await wait("document.querySelector('.rp-chat-conversation') !== null");
  await evaluate("window.fixtureShow('owner')");
  await wait("document.querySelector('.owner-renter-preview')?.textContent.length > 1000");
  assert.equal(await evaluate("document.querySelector('.owner-renter-preview').getBoundingClientRect().right <= document.querySelector('.owner-renter-card').getBoundingClientRect().right - 48"), true);
  assert.equal(await evaluate("document.querySelector('.owner-renter-preview').scrollWidth > document.querySelector('.owner-renter-preview').clientWidth"), true);
  assert.equal(await evaluate("document.body.scrollWidth <= innerWidth"), true);
  await screenshot("owner-mobile-long-preview");
  await setViewport(1440, 900);
  await wait("innerWidth === 1440");
  assert.equal(await evaluate("document.querySelector('.owner-renter-preview').getBoundingClientRect().right <= document.querySelector('.owner-renter-card').getBoundingClientRect().right - 48"), true);
  assert.equal(await evaluate("document.body.scrollWidth <= innerWidth"), true);
  await screenshot("owner-desktop-long-preview");
  await setViewport(320, 568);
  await wait("innerWidth === 320");
  assert.equal(await evaluate("document.body.scrollWidth <= innerWidth"), true);
  assert.equal(await evaluate("document.querySelector('.owner-renter-preview').getBoundingClientRect().right <= document.querySelector('.owner-renter-card').getBoundingClientRect().right - 48"), true);
  await setViewport(390, 568);
  await wait("innerWidth === 390");

  await evaluate("window.fixtureSetOwnerLastMessage({ _id: 'm4', sender: { _id: '507f1f77bcf86cd799439011' }, receiver: { _id: '507f1f77bcf86cd799439014' }, text: 'See you soon', createdAt: '2026-09-30T10:00:00.000Z' }); window.fixtureShow('renter')");
  await wait("document.querySelector('.rp-chat-conversation') !== null");
  await evaluate("window.fixtureShow('owner')");
  await wait("document.querySelector('.owner-renter-preview')?.textContent === 'You: See you soon'");
  await evaluate("window.fixtureSetOwnerLastMessage(null); window.fixtureShow('renter')");
  await wait("document.querySelector('.rp-chat-conversation') !== null");
  await evaluate("window.fixtureShow('owner')");
  await wait("document.querySelector('.owner-renter-preview')?.textContent === 'No messages yet'");
  await evaluate("window.fixtureSetOwnerLastMessage({ _id: 'm5', sender: { _id: '507f1f77bcf86cd799439011' }, receiver: { _id: '507f1f77bcf86cd799439014' }, text: 'Hidden message', isDeleted: true, createdAt: '2026-09-30T11:00:00.000Z' }); window.fixtureShow('renter')");
  await wait("document.querySelector('.rp-chat-conversation') !== null");
  await evaluate("window.fixtureShow('owner')");
  await wait("document.querySelector('.owner-renter-preview')?.textContent === 'You: This message was deleted.'");

  await evaluate("window.fixtureSetRenterLastMessage({ _id: 'm6', sender: { _id: '507f1f77bcf86cd799439014' }, receiver: { _id: '507f1f77bcf86cd799439011' }, text: 'Thanks for the update', createdAt: '2026-09-30T11:30:00.000Z' }); window.fixtureShow('renter')");
  await wait("document.querySelector('.rp-chat-conversation-preview p')?.textContent === 'You: Thanks for the update'");
  await evaluate("window.fixtureSetRenterLastMessage(null); window.fixtureShow('owner')");
  await wait("document.querySelector('.owner-renter-card') !== null");
  await evaluate("window.fixtureShow('renter')");
  await wait("document.querySelector('.rp-chat-conversation-preview p')?.textContent === 'No messages yet'");
  await evaluate("window.fixtureSetRenterLastMessage({ _id: 'm7', sender: { _id: '507f1f77bcf86cd799439014' }, receiver: { _id: '507f1f77bcf86cd799439011' }, text: 'Hidden message', isDeleted: true, createdAt: '2026-09-30T12:00:00.000Z' }); window.fixtureShow('owner')");
  await wait("document.querySelector('.owner-renter-card') !== null");
  await evaluate("window.fixtureShow('renter')");
  await wait("document.querySelector('.rp-chat-conversation-preview p')?.textContent === 'You: This message was deleted.'");

  await evaluate("window.fixtureShow('direct')");
  await wait("document.querySelector('.rp-chat-thread-header h2')?.textContent === 'Direct Owner'");
  await wait("window.fixtureCalls.some(call => call.kind === 'messages' && call.id === '507f1f77bcf86cd799439013')");
  assert.equal(await evaluate("document.querySelector('.rp-chat-conversation-select[aria-current=true]')?.innerText.includes('Direct Owner')"), true);
  await wait("document.activeElement === document.querySelector('.rp-chat-back-button')");
  assert.deepEqual(errors, []);
  console.log(`Messaging inbox browser check passed. Screenshots: ${screenshotDirectory}`);
} finally {
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  await Promise.all(fixturePaths.map((file) => fs.rm(file, { force: true })));
}
