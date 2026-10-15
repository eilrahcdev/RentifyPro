// Run Vite on 4176 and isolated headless Chrome with CDP on 9236, then:
// node --experimental-websocket scripts/chatbot-focus-browser-check.mjs
import assert from "node:assert/strict";
import { fulfillHoldoutRequests } from "../backend/scripts/chatbot-holdout-fulfill.mjs";
import coverage from "../chatbot-service/chatbot_coverage.json" with { type: "json" };
import { chatbotOfferConversations } from "../backend/tests/fixtures/chatbotOfferConversations.js";
import { getChatbotServiceHeaders } from "../backend/utils/chatbotServiceAuth.js";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = "http://127.0.0.1:4176";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let sequence = 0;
let chatRequests = 0;
let realRouting = false;
let usingApiFixture = false;
let cooldownFixture = null;
let heldRateRequest = null;
const rateOnly = process.env.CHATBOT_RATE_ONLY === "1";
const qualityConversations = [
  { id: "quality_dynamic_inventory", turns: [
    { input: "Do you have Chevrolet?", intent: "vehicle_brand_search", language: "en", cards: [], reply_contains: ["Chevrolet"] },
    { input: "May Mitsubishi ba?", intent: "vehicle_brand_search", language: "fil", cards: [], reply_contains: ["Mitsubishi"] },
    { input: "Do you have Ducati?", intent: "vehicle_brand_search", language: "en", cards: [], reply_contains: ["Ducati"] },
    { input: "Meron bang kuliglig?", intent: "available_vehicles", language: "fil", cards: ["Yamaha Mio Gear"], subtype: "kuliglig" },
    { input: "How about Yamaha?", intent: "available_vehicles", language: "en", absent_entities: ["vehicle_subtype"] },
    { update_subtype: "Scooter", input: "Meron bang kuliglig?", intent: "available_vehicles", language: "fil", cards: [] },
    { input: "Do you have scooters?", intent: "available_vehicles", language: "en", cards: ["Yamaha Mio Gear"], subtype: "scooter" },
    { update_subtype: "Urban Shuttle", input: "May urban shuttle ba?", intent: "available_vehicles", language: "fil", cards: ["Yamaha Mio Gear"], subtype: "urban shuttle" },
    { input: "Show urban shuttle na sasakyan", intent: "available_vehicles", language: "taglish", cards: ["Yamaha Mio Gear"], subtype: "urban shuttle" },
    { input: "Show R1T rentals", intent: "vehicle_brand_search", language: "en", cards: ["Rivian R1T"] },
    { input: "RIVIAN", intent: "vehicle_brand_search", language: "en", cards: ["Rivian R1T"] },
    { input: "Do you have sports cars?", intent: "available_vehicles", language: "en", cards: ["BMW Test Sports Car"], subtype: "sports car" },
    { input: "Gusto ko supercar, hindi hypercar", intent: "available_vehicles", language: "fil", cards: ["Toyota Test Coupe"], subtype: "supercar" },
  ] },
  { id: "quality_language", turns: [
    { input: "How do I pay for my booking?", intent: "payment_methods", response_variant: "instructions", language: "en", reply_contains: ["Pay Now", "PayMongo"] },
    { input: "Paano makapagbayad ng booking?", intent: "payment_methods", response_variant: "instructions", language: "fil", reply_contains: ["Buksan ang Bookings", "PayMongo"] },
    { input: "How do I pay ang booking ko?", intent: "payment_methods", response_variant: "instructions", language: "taglish", reply_contains: ["Pay Now", "PayMongo"] },
    { input: "What policies does RentifyPro have?", intent: "help_request", response_variant: "policies", language: "en", reply_contains: ["30%", "owner review"] },
    { input: "Ano ang policy sa late return?", intent: "late_return_policy", language: "fil", reply_contains: ["eksaktong fee"] },
  ] },
  { id: "quality_gratitude", turns: [
    { input: "Can I extend my rental?", intent: "booking_extension", language: "en", reply_contains: ["Extend Rental Time"] },
    { input: "okay, thanks", intent: "chat_gratitude", language: "en", reply_contains: ["You're welcome", "rental"] },
    { input: "salamat po", intent: "chat_gratitude", language: "fil", reply_contains: ["Walang anuman", "tulong"] },
  ] },
  { id: "quality_search", turns: [
    { input: "Is there an 18-seater?", intent: "available_vehicles", language: "en", reply_contains: ["18 seats"], cards: ["Toyota Commuter"] },
    { input: "How about BMW vehicles?", intent: "available_vehicles", language: "en", reply_contains: ["BMW"], absent_entities: ["pax", "seat_match"] },
    { input: "I mean BMW vehicles for rent", intent: "vehicle_brand_search", language: "en", reply_contains: ["BMW"], absent_entities: ["pax"] },
    { input: "How about Toyota?", intent: "available_vehicles", language: "en", reply_contains: ["Toyota"], absent_entities: ["pax"] },
    { input: "May Koenigsegg ba?", intent: "vehicle_brand_search", language: "fil", reply_contains: ["Koenigsegg"], cards: ["Koenigsegg Agera RS"] },
    { input: "May supercar ba?", intent: "available_vehicles", language: "fil", reply_contains: ["supercar"], cards: ["Toyota Test Coupe"], subtype: "supercar" },
    { input: "Gusto ko supercar, hindi hypercar", intent: "available_vehicles", language: "fil", reply_contains: ["hindi kasamang subtype: hypercar"], cards: ["Toyota Test Coupe"], subtype: "supercar" },
  ] },
];
const realAnswers = [];
const sentMessages = [];
const budgetContext = { intent: "available_vehicles",
  entities: { brand: null, model: null, category: "suv", location: "cebu", max_budget: 2000, currency: "PHP" },
  clarification: { required: true, type: "missing_entity", field: "rate_unit" }, choices: [] };
const pending = new Map();
const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const respond = (requestId, status, data, extraHeaders = []) => send("Fetch.fulfillRequest", {
  requestId,
  responseCode: status,
  responseHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" },
    { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
    { name: "Access-Control-Expose-Headers", value: "Retry-After,RateLimit,RateLimit-Policy" },
    ...extraHeaders,
  ],
  body: Buffer.from(JSON.stringify(data)).toString("base64"),
});
const handleRequest = async ({ requestId, request }) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return respond(requestId, 200, {});
    if (url.pathname === "/api/auth/me") return respond(requestId, 401, { message: "No session" });
    if (url.pathname === "/api/chat") {
      chatRequests += 1;
      const body = JSON.parse(request.postData);
      sentMessages.push(body);
      if (cooldownFixture) {
        if (cooldownFixture === "held-rate") { heldRateRequest = requestId; return; }
        if (cooldownFixture === "rate") return respond(requestId, 429, {
          code: "CHAT_RATE_LIMITED", message: "Too many chatbot requests.", ...(rateOnly ? {} : { retryAfterSeconds: 5 }),
        }, [{ name: "Retry-After", value: "5" }]);
        if (cooldownFixture === "busy") return respond(requestId, 503, {
          code: "CHAT_SERVICE_BUSY", layer: "concurrency", retryAfterSeconds: 5,
        }, [{ name: "Retry-After", value: "5" }]);
        if (cooldownFixture === "network") return send("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" });
        if (cooldownFixture === "service") return respond(requestId, 503, { message: "Fixture service unavailable." });
        return respond(requestId, 200, { intent: "insurance_included", language: "en", recommendations: [],
          reply: "I cannot confirm specific insurance coverage. Check the listing and ask the owner.",
          conversation_context: { intent: "insurance_included", entities: {}, topic: "vehicles", assistant_action: "overview" } });
      }
      if (realRouting) {
        if (process.env.CHATBOT_API_FIXTURE_URL && usingApiFixture) {
          const fixtureUrl = new URL(process.env.CHATBOT_API_FIXTURE_URL);
          assert.ok(["127.0.0.1", "localhost"].includes(fixtureUrl.hostname));
          const response = await fetch(new URL("/api/chat", fixtureUrl), {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error",
          });
          assert.equal(response.status, 200);
          const answer = await response.json();
          realAnswers.push(answer);
          return respond(requestId, 200, answer);
        }
        const response = await fetch(`${process.env.CHATBOT_CLASSIFIER_URL}/chat`, {
          method: "POST", headers: { "content-type": "application/json", ...getChatbotServiceHeaders() },
          redirect: "error",
          body: JSON.stringify({ message: body.message, language: body.language,
            previous_language: body.previousLanguage, previous_context: body.conversationContext || body.pendingSearch }),
        });
        assert.equal(response.status, 200);
        const [answer] = fulfillHoldoutRequests([{ message: body.message, classifier: await response.json(),
          previous_context: body.conversationContext || body.pendingSearch }], true);
        realAnswers.push(answer);
        return respond(requestId, 200, answer);
      }
      await pause(650);
      if (body.message === "Any SUVs in Cebu under 2000?") {
        return respond(requestId, 200, { intent: "available_vehicles", language: "en",
          reply: "Is your PHP 2,000 budget per day or per hour?", recommendations: [],
          entities: budgetContext.entities, clarification: budgetContext.clarification, conversation_context: budgetContext });
      }
      if (["per day", "How about tomorrow?"].includes(body.message)) {
        return respond(requestId, 200, { intent: "available_vehicles", language: "en",
          reply: body.message === "per day" ? "Current SUVs matching Cebu and PHP 2,000 per day."
            : "Availability for tomorrow is not confirmed. Choose pickup and return dates.",
          recommendations: [], conversation_context: { ...budgetContext,
            entities: { ...budgetContext.entities, rate_unit: "day" },
            clarification: { required: false, type: null, field: null } } });
      }
      return respond(requestId, 200, {
        intent: "chat_gender_identity", language: "en", reply: "I'm an AI assistant, so I don't have a gender or sexual orientation.",
        recommendations: [],
      });
    }
    return respond(requestId, 200, { vehicles: [], total: 0, notifications: [] });
  }
  if (url.origin !== base) return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
  return send("Fetch.continueRequest", { requestId });
};
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
    handleRequest(message.params).catch((error) => errors.push(error.message));
  }
};

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const wait = async (expression, timeout = 15000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await evaluate(`Boolean(${expression})`)) return; } catch { /* navigation in progress */ }
    await pause(40);
  }
  throw new Error(`Timed out: ${expression}`);
};
const click = async (selector) => {
  await wait(`document.querySelector(${JSON.stringify(selector)})`);
  const rect = await evaluate(`(() => {
    const { x, y, width, height } = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: x + width / 2, y: y + height / 2 };
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Page.navigate", { url: base });
  await click('.rp-ai-launcher-button');

  const input = '[role="dialog"][aria-label="Rentify AI chatbot"] textarea';
  await wait(`document.querySelector(${JSON.stringify(input)})`);
  assert.equal(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(input)})`), true);
  if (!rateOnly) {
  await send("Input.insertText", { text: "are you a girl?" });
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input)}).value`), "are you a girl?");

  await click('button[aria-label="Send message"]');
  await wait("document.body.innerText.includes('are you a girl?')");
  assert.equal(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(input)})`), true);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input)}).disabled`), false);
  await send("Input.insertText", { text: "and you?" });
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input)}).value`), "and you?");

  await wait("document.body.innerText.includes(\"don't have a gender\")");
  assert.equal(chatRequests, 1);
  assert.equal(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(input)})`), true);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input)}).value`), "and you?");

  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await wait("document.body.innerText.includes('and you?')");
  await wait(`document.querySelector(${JSON.stringify(input)}).value === ''`);
  await wait("document.querySelectorAll('[role=\"dialog\"] .rp-ai-chat-body p').length >= 5");
  assert.equal(chatRequests, 2);
  assert.equal(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(input)})`), true);

  await send("Input.insertText", { text: "Any SUVs in Cebu under 2000?" });
  await click('button[aria-label="Send message"]');
  await wait("document.body.innerText.includes('budget per day or per hour')");
  await send("Input.insertText", { text: "per day" });
  await click('button[aria-label="Send message"]');
  await wait("document.body.innerText.includes('Current SUVs matching Cebu')");
  assert.deepEqual(sentMessages[3].conversationContext, budgetContext);
  assert.equal(sentMessages[3].previousLanguage, "en");
  assert.equal(sentMessages[3].pendingSearch.location, "cebu");

  await click('button[aria-label="Close Rentify AI"]');
  await wait("!document.querySelector('[role=\"dialog\"][aria-label=\"Rentify AI chatbot\"]')");
  await click('.rp-ai-launcher-button');
  await wait(`document.activeElement === document.querySelector(${JSON.stringify(input)})`);
  await send("Input.insertText", { text: "How about tomorrow?" });
  await click('button[aria-label="Send message"]');
  await wait("document.body.innerText.includes('Availability for tomorrow is not confirmed')");
  assert.equal(sentMessages[4].conversationContext.entities.rate_unit, "day");
  assert.equal(sentMessages[4].conversationContext.entities.location, "cebu");
  await click('button[aria-label="Start a new chatbot conversation"]');
  await wait("!document.body.innerText.includes('Availability for tomorrow is not confirmed')");
  await send("Input.insertText", { text: "hello" });
  await click('button[aria-label="Send message"]');
  await wait("document.body.innerText.includes(\"don't have a gender\")");
  assert.equal(sentMessages[5].conversationContext, null);
  assert.equal(sentMessages[5].pendingSearch, null);
  assert.deepEqual(errors, []);
  }
  await click('button[aria-label="Start a new chatbot conversation"]');
  cooldownFixture = "success";
  await send("Input.insertText", { text: "Is insurance included?" });
  await click('button[aria-label="Send message"]');
  await wait("document.querySelector('.rp-ai-chat-body').textContent.includes('specific insurance coverage')");
  await wait("!document.querySelector('button[aria-label=\"Send message\"]').disabled");
  const beforeRateHistory = await evaluate("JSON.parse(sessionStorage.getItem('rentifypro.chatWidget.v2:guest')).conversations");
  await evaluate(`(() => {
    window.__chatClock = performance.now();
    window.__chatWallClock = Date.now();
    window.__originalDateNow = Date.now;
    Date.now = () => window.__chatWallClock;
    window.__chatTimers = new Map();
    window.__chatTimerSequence = 1000000;
    window.__originalPerformanceNow = performance.now.bind(performance);
    window.__originalSetInterval = window.setInterval;
    window.__originalClearInterval = window.clearInterval;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => window.__chatClock });
    window.setInterval = (callback, delay, ...args) => {
      if (delay !== 250) return window.__originalSetInterval(callback, delay, ...args);
      const id = ++window.__chatTimerSequence; window.__chatTimers.set(id, callback); return id;
    };
    window.clearInterval = id => window.__chatTimers.delete(id) || window.__originalClearInterval(id);
  })()`);
  cooldownFixture = "rate";
  const beforeRejected = chatRequests;
  await send("Input.insertText", { text: "Show me vans please" });
  await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="Send message"]');
    button.click(); button.click();
    document.querySelector(${JSON.stringify(input)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await wait("document.querySelector('#rp-chat-composer-notice')?.textContent.includes('00:05')");
  assert.equal(chatRequests, beforeRejected + 1);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input)}).value`), "Show me vans please");
  assert.equal(await evaluate("document.querySelector('button[aria-label=\"Send message\"]').disabled"), true);
  assert.deepEqual(await evaluate("JSON.parse(sessionStorage.getItem('rentifypro.chatWidget.v2:guest')).conversations"), beforeRateHistory);
  assert.equal(await evaluate("document.querySelector('.rp-ai-chat-body').textContent.includes('Too many chatbot')"), false);
  assert.equal(await evaluate("document.querySelector('.rp-ai-chat-body').textContent.includes('Show me vans please')"), false);
  await evaluate("window.__chatClock += 1000; window.__chatWallClock += 1000; for (const tick of window.__chatTimers.values()) tick();");
  await wait("document.querySelector('#rp-chat-composer-notice')?.textContent.includes('00:04')");
  const feedbackScreens = [];
  for (const width of [1280, 320]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: width === 320 });
    const metrics = await evaluate(`(() => {
      const notice = document.querySelector('#rp-chat-composer-notice');
      const composer = document.querySelector(${JSON.stringify(input)});
      const bounds = notice.getBoundingClientRect();
      return { noticeWidth: bounds.width, withinViewport: bounds.left >= 0 && bounds.right <= innerWidth,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        color: getComputedStyle(notice).color, fontSize: getComputedStyle(notice).fontSize,
        draft: composer.value, described: composer.getAttribute('aria-describedby') === notice.id };
    })()`);
    assert.equal(metrics.withinViewport, true); assert.equal(metrics.horizontalOverflow, false);
    assert.equal(metrics.draft, "Show me vans please"); assert.equal(metrics.described, true);
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    const path = join(tmpdir(), `rentifypro-chatbot-cooldown-${width}-20261012.png`);
    writeFileSync(path, Buffer.from(screenshot.data, "base64")); feedbackScreens.push({ width, path, metrics });
  }
  await send("Emulation.clearDeviceMetricsOverride");
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  assert.equal(chatRequests, beforeRejected + 1);
  await evaluate("window.__chatClock += 4000; window.__chatWallClock += 4000; for (const tick of window.__chatTimers.values()) tick();");
  await wait("!document.querySelector('button[aria-label=\"Send message\"]').disabled");
  assert.equal(chatRequests, beforeRejected + 1);
  await wait("!document.querySelector('#rp-chat-composer-notice')");
  assert.equal(await evaluate("window.__chatTimers.size"), 0);
  assert.equal(await evaluate("localStorage.getItem('rentifypro.chatWidget.cooldown.v1:guest')"), null);
  cooldownFixture = "success";
  await click('button[aria-label="Send message"]');
  await wait("document.querySelector('.rp-ai-chat-body').textContent.includes('Show me vans please')");
  await wait("!document.querySelector('button[aria-label=\"Send message\"]').disabled");
  assert.equal(chatRequests, beforeRejected + 2);
  assert.equal(sentMessages.at(-1).conversationContext.intent, "insurance_included");
  for (const mode of ["network", "service"]) {
    const history = await evaluate("JSON.parse(sessionStorage.getItem('rentifypro.chatWidget.v2:guest')).conversations");
    cooldownFixture = mode;
    await send("Input.insertText", { text: `Unsent ${mode} message` });
    await click('button[aria-label="Send message"]');
    await wait(`document.querySelector('#rp-chat-composer-notice')?.textContent.includes(${JSON.stringify(mode === "network" ? "Cannot connect" : "Chat service is unavailable")})`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input)}).value`), `Unsent ${mode} message`);
    assert.deepEqual(await evaluate("JSON.parse(sessionStorage.getItem('rentifypro.chatWidget.v2:guest')).conversations"), history);
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(input)});
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  }
  await evaluate(`Date.now = window.__originalDateNow;
    window.setInterval = window.__originalSetInterval; window.clearInterval = window.__originalClearInterval;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => Math.max(window.__chatClock, window.__originalPerformanceNow()) });`);
  cooldownFixture = null;
  console.log(JSON.stringify({ cooldownChecks: "passed", fakeClock: true, desktopMobileScreens: feedbackScreens }));
  if (rateOnly) {
    await click('button[aria-label="Start a new chatbot conversation"]');
    cooldownFixture = "success";
    const normalMessages = ["Is insurance included?", "okay thanks", "huh?", "what do you mean got it?", "trucks?", "pick up trucks?", "vans?", "motorcycle?"];
    const beforeNormal = chatRequests;
    for (const text of normalMessages) {
      await send("Input.insertText", { text });
      await evaluate(`(() => {
        const button = document.querySelector('button[aria-label="Send message"]'); button.click(); button.click();
        document.querySelector(${JSON.stringify(input)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await wait("!document.querySelector('button[aria-label=\"Send message\"]').disabled");
      assert.equal(sentMessages.at(-1).message, text);
    }
    assert.equal(chatRequests, beforeNormal + normalMessages.length);
    const preservedHistory = await evaluate("JSON.parse(sessionStorage.getItem('rentifypro.chatWidget.v2:guest')).conversations");
    cooldownFixture = "held-rate";
    await send("Input.insertText", { text: "meron bang 10 seater na suv?" });
    await click('button[aria-label="Send message"]');
    await wait("document.querySelector('button[aria-label=\"Send message\"]').disabled");
    assert.ok(heldRateRequest);
    await send("Input.insertText", { text: "okay" });
    await respond(heldRateRequest, 429, { code: "CHAT_RATE_LIMITED", retryAfterSeconds: 5 }, [{ name: "Retry-After", value: "5" }]);
    await wait("document.querySelector('button') && document.body.innerText.includes('Restore previous draft')");
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input)}).value`), "okay");
    const stored = await evaluate("JSON.parse(sessionStorage.getItem('rentifypro.chatWidget.v2:guest'))");
    assert.equal(stored.rejectedDraft.text, "meron bang 10 seater na suv?");
    assert.deepEqual(stored.conversations, preservedHistory);
    await send("Page.reload"); await click('.rp-ai-launcher-button');
    await wait("document.body.innerText.includes('Restore previous draft')");
    assert.equal(await evaluate("document.querySelector('button[aria-label=\"Send message\"]').disabled"), true,
      "Reload must preserve the active server cooldown");
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input)}).value`), "okay");
    await evaluate("[...document.querySelectorAll('#rp-chat-composer-notice button')].find(button => button.textContent.includes('Restore')).click()");
    await wait(`document.querySelector(${JSON.stringify(input)}).value === 'meron bang 10 seater na suv?'`);
    const reloaded = await evaluate("JSON.parse(sessionStorage.getItem('rentifypro.chatWidget.v2:guest'))");
    assert.equal(reloaded.rejectedDraft.text, "okay"); assert.deepEqual(reloaded.conversations, preservedHistory);
    const beforeReset = chatRequests;
    assert.equal(await evaluate("document.querySelector('button[aria-label=\"Start a new chatbot conversation\"]').disabled"), false);
    await click('button[aria-label="Start a new chatbot conversation"]');
    await wait("document.querySelector('.rp-ai-chat-body').querySelectorAll('p.whitespace-pre-line').length === 1");
    const resetState = await evaluate("JSON.parse(sessionStorage.getItem('rentifypro.chatWidget.v2:guest'))");
    assert.notEqual(resetState.conversation.id, reloaded.conversation.id);
    assert.equal(resetState.conversations.english.length, 1);
    assert.equal(resetState.conversations.english[0].conversationContext, undefined);
    assert.equal(chatRequests, beforeReset);
    assert.equal(await evaluate("document.querySelector('button[aria-label=\"Send message\"]').disabled"), true);
    assert.equal(await evaluate("document.querySelector('button[aria-label=\"Start a new chatbot conversation\"]').disabled"), false);
    await send("Page.reload"); await click('.rp-ai-launcher-button');
    assert.equal(await evaluate("document.querySelector('button[aria-label=\"Send message\"]').disabled"), true);
    assert.equal(chatRequests, beforeReset);
    await wait("!document.querySelector('button[aria-label=\"Send message\"]').disabled", 10000);
    assert.equal(chatRequests, beforeReset);
    await send("Input.insertText", { text: "Navigation draft" });
    heldRateRequest = null;
    await click('button[aria-label="Send message"]');
    await wait("document.querySelector('button[aria-label=\"Send message\"]').disabled");
    assert.ok(heldRateRequest);
    await evaluate("[...document.querySelectorAll('nav button')].find(button => button.textContent.trim() === 'Vehicles').click()");
    await wait("location.pathname === '/vehicles'");
    await click('.rp-ai-launcher-button');
    await wait(`document.querySelector(${JSON.stringify(input)}).value === 'Navigation draft'`);
    assert.equal(await evaluate("document.querySelector('button[aria-label=\"Send message\"]').disabled"), false);
    await send("Fetch.failRequest", { requestId: heldRateRequest, errorReason: "Aborted" }).catch(() => {});
    await click('button[aria-label="Start a new chatbot conversation"]');
    cooldownFixture = "busy";
    await send("Input.insertText", { text: "Preserve this busy draft" });
    await click('button[aria-label="Send message"]');
    await wait("document.querySelector('#rp-chat-composer-notice')?.textContent.includes('Chat is busy')");
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input)}).value`), "Preserve this busy draft");
    assert.equal(await evaluate("document.querySelector('.rp-ai-chat-body').textContent.includes('Chat is busy')"), false);
    const beforeBusyReset = chatRequests;
    await click('button[aria-label="Start a new chatbot conversation"]');
    assert.equal(await evaluate("document.querySelector('button[aria-label=\"Send message\"]').disabled"), true);
    assert.equal(chatRequests, beforeBusyReset);
    await evaluate(`(() => {
      const frame = document.createElement('iframe'); frame.hidden = true; document.body.appendChild(frame);
      window.__cooldownFrame = frame;
      frame.contentWindow.localStorage.setItem('rentifypro.chatWidget.cooldown.v1:guest',
        JSON.stringify({ until: Date.now() + 6000, type: 'busy', layer: 'concurrency' }));
    })()`);
    await wait("document.querySelector('#rp-chat-composer-notice')?.textContent.includes('00:06')");
    await evaluate("window.__cooldownFrame.contentWindow.localStorage.setItem('rentifypro.chatWidget.cooldown.v1:user:unrelated', JSON.stringify({ until: Date.now() + 60000, type: 'rate' }));");
    assert.equal(await evaluate("document.querySelector('#rp-chat-composer-notice').textContent.includes('Chat is busy')"), true);
    await wait("!document.querySelector('button[aria-label=\"Send message\"]').disabled", 10000);
    assert.equal(chatRequests, beforeBusyReset);
    await evaluate("window.__cooldownFrame.remove()");
    cooldownFixture = "held-rate";
    heldRateRequest = null;
    await send("Input.insertText", { text: "Previous conversation request" });
    await click('button[aria-label="Send message"]');
    await wait("document.querySelector('button[aria-label=\"Send message\"]').disabled");
    const oldRequest = heldRateRequest;
    const beforePendingReset = chatRequests;
    assert.ok(oldRequest);
    assert.equal(await evaluate("document.querySelector('button[aria-label=\"Start a new chatbot conversation\"]').disabled"), false);
    await click('button[aria-label="Start a new chatbot conversation"]');
    await respond(oldRequest, 200, { reply: "Late previous reply", language: "en", recommendations: [], conversation_context: budgetContext }).catch(() => {});
    await pause(150);
    assert.equal(chatRequests, beforePendingReset);
    assert.equal(await evaluate("document.querySelector('.rp-ai-chat-body').textContent.includes('Late previous reply')"), false);
    assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('rentifypro.chatWidget.v2:guest')).conversations.english.length"), 1);
    cooldownFixture = "success";
    await send("Input.insertText", { text: "New conversation request" });
    await click('button[aria-label="Send message"]');
    await wait("!document.querySelector('button[aria-label=\"Send message\"]').disabled");
    assert.equal(sentMessages.at(-1).conversationContext, null);
    assert.equal(sentMessages.at(-1).pendingSearch, null);
    assert.equal(sentMessages.at(-1).previousLanguage, null);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ rateOnly: true, normalMessages: 8, duplicateCalls: 0, draftReload: "passed",
      navigationAbort: "passed", contextPreserved: true, cooldownReload: "passed", newChatCooldown: "passed",
      capacityNotice: "passed", crossDocumentCooldown: "passed", lateReply: "ignored" }));
  }
  if (!rateOnly && (process.env.CHATBOT_CLASSIFIER_URL || process.env.CHATBOT_API_FIXTURE_URL)) {
    realRouting = true;
    assert.ok(!process.env.CHATBOT_API_FIXTURE_URL || process.env.CHATBOT_CLASSIFIER_URL,
      "Provide the isolated CHATBOT_CLASSIFIER_URL as well as CHATBOT_API_FIXTURE_URL for the complete browser check.");
    for (const conversation of [...coverage.conversations, ...(process.env.CHATBOT_API_FIXTURE_URL ? [...chatbotOfferConversations, ...qualityConversations] : [])]) {
      usingApiFixture = conversation.id.startsWith("offer_") || conversation.id.startsWith("quality_");
      await wait("!document.querySelector('button[aria-label=\"Start a new chatbot conversation\"]').disabled");
      await click('button[aria-label="Start a new chatbot conversation"]');
      await wait("document.querySelector('.rp-ai-chat-body').textContent.toLowerCase().includes('suggested questions')");
      let expectedContext = null;
      let expectedLanguage = null;
      for (const turn of conversation.turns) {
        if (turn.update_subtype) {
          const response = await fetch(new URL("/fixture/subtype", process.env.CHATBOT_API_FIXTURE_URL), {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subtype: turn.update_subtype }),
          });
          assert.equal(response.status, 200);
        }
        if (turn.reset) {
          await click('button[aria-label="Start a new chatbot conversation"]');
          await wait("document.querySelector('.rp-ai-chat-body').textContent.toLowerCase().includes('suggested questions')");
          expectedContext = null;
          expectedLanguage = null;
        }
        const before = realAnswers.length;
        await wait(`document.querySelector(${JSON.stringify(input)}).value === ''`);
        await click(input);
        await send("Input.insertText", { text: turn.input });
        await wait("!document.querySelector('button[aria-label=\"Send message\"]').disabled");
        const messageCount = await evaluate("document.querySelectorAll('.rp-ai-chat-body p').length");
        await click('button[aria-label="Send message"]');
        const started = Date.now();
        while (realAnswers.length === before && Date.now() - started < 15000) await pause(40);
        assert.equal(realAnswers.length, before + 1, `${conversation.id}: ${turn.input}`);
        const answer = realAnswers.at(-1);
        assert.equal(answer.intent, turn.intent, `${conversation.id}: ${turn.input}`);
        if (turn.language) assert.equal(answer.language, turn.language);
        for (const field of turn.absent_entities || []) assert.equal(answer.entities[field], undefined);
        if (turn.cards) assert.deepEqual(answer.recommendations.map(vehicle => vehicle.name), turn.cards);
        if (turn.subtype) assert.ok(answer.recommendations.every(vehicle => vehicle.subtype === turn.subtype));
        assert.deepEqual(sentMessages.at(-1).conversationContext, expectedContext, `${conversation.id}: forwarded context`);
        if (expectedLanguage) assert.equal(sentMessages.at(-1).previousLanguage, expectedLanguage, `${conversation.id}: forwarded reply language`);
        if (Object.hasOwn(turn, "response_variant")) assert.equal(answer.response_variant ?? null, turn.response_variant);
        if (turn.task) assert.equal(answer.conversation_context.intent, turn.task);
        if (turn.offer) assert.equal(answer.conversation_context.pending_offer.action, turn.offer);
        if (turn.no_offer) assert.equal(answer.conversation_context?.pending_offer, undefined);
        if (turn.no_context) assert.equal(answer.conversation_context, null);
        if (usingApiFixture) assert.doesNotMatch(answer.reply, /Of course!|Tell me what you're trying to do|add a little more detail/);
        for (const [key, value] of Object.entries(turn.clarification || {})) assert.equal(answer.clarification[key], value);
        for (const phrase of turn.reply_contains || []) assert.ok(answer.reply.toLowerCase().includes(phrase.toLowerCase()), `${conversation.id}: ${turn.input}: missing ${phrase}: ${answer.reply}`);
        if (turn.reply_any) assert.ok(turn.reply_any.includes(answer.reply), `${conversation.id}: multilingual acknowledgement`);
        await wait(`document.querySelector('.rp-ai-chat-body').innerText.includes(${JSON.stringify(answer.reply)})`);
        if (conversation.id.startsWith("quality_")) {
          const cards = await evaluate(`Array.from(document.querySelectorAll('.rp-ai-chat-body article')).slice(-${answer.recommendations.length || 0}).map(card => card.innerText)`);
          if (answer.recommendations.length) {
            assert.equal(cards.length, answer.recommendations.length);
            answer.recommendations.forEach((vehicle, index) => {
              assert.ok(cards[index].includes(vehicle.name));
              assert.ok(cards[index].includes(`${vehicle.seats} ${answer.language === "fil" ? "upuan" : "seats"}`));
              assert.ok(cards[index].includes(vehicle.fuel));
              if (vehicle.subtype) assert.ok(cards[index].toLowerCase().includes(vehicle.subtype));
              assert.ok(cards[index].includes(answer.language === "fil" ? "oras" : "hour"));
            });
          }
        }
        await wait(`document.querySelectorAll('.rp-ai-chat-body p').length > ${messageCount}`);
        await wait("!document.querySelector('button[aria-label=\"Start a new chatbot conversation\"]').disabled");
        if (turn.reset) assert.equal(sentMessages.at(-1).conversationContext, null);
        assert.equal(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(input)})`), true);
        expectedContext = answer.conversation_context;
        expectedLanguage = answer.language;
        if (conversation.id === "offer_a_verification" && turn.input === "okay, thanks") {
          await send("Page.reload");
          await click('.rp-ai-launcher-button');
          await wait(`document.querySelector(${JSON.stringify(input)})`);
          const stored = await evaluate(`JSON.parse(sessionStorage.getItem('rentifypro.chatWidget.v2:guest'))`);
          const latest = stored.conversations.english.filter(message => message.sender === 'bot').at(-1);
          assert.deepEqual(latest.conversationContext, expectedContext);
        }
      }
    }
    const beforeFreshOffer = realAnswers.length;
    await send("Input.insertText", { text: "How is my account verified?" });
    await click('button[aria-label="Send message"]');
    const freshOfferStarted = Date.now();
    while (realAnswers.length === beforeFreshOffer && Date.now() - freshOfferStarted < 15000) await pause(40);
    assert.equal(realAnswers.length, beforeFreshOffer + 1);
    await wait("!document.querySelector('button[aria-label=\"Start a new chatbot conversation\"]').disabled");
    await wait("document.querySelector('.rp-ai-chat-body').textContent.includes('Would you like the steps')");
    assert.equal(realAnswers.at(-1).conversation_context.pending_offer.action, "instructions");
    const stored = await evaluate(`JSON.parse(sessionStorage.getItem('rentifypro.chatWidget.v2:guest'))`);
    assert.ok(stored.conversation);
    await evaluate(`(() => {
      const key = 'rentifypro.chatWidget.v2:guest';
      const state = JSON.parse(sessionStorage.getItem(key));
      state.conversation.lastActivityAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
      sessionStorage.setItem(key, JSON.stringify(state));
    })()`);
    await send("Page.reload");
    await click('.rp-ai-launcher-button');
    await wait(`document.querySelector(${JSON.stringify(input)})`);
    await wait("document.querySelector('.rp-ai-chat-body').textContent.toLowerCase().includes('suggested questions')");
    const beforeExpiryRequest = realAnswers.length;
    await send("Input.insertText", { text: "What's the next step?" });
    await click('button[aria-label="Send message"]');
    await wait("document.querySelector('.rp-ai-chat-body').textContent.includes('Which task')");
    assert.equal(realAnswers.length, beforeExpiryRequest + 1);
    assert.equal(sentMessages.at(-1).conversationContext, null);
    assert.equal(realAnswers.at(-1).conversation_context, null);
    assert.deepEqual(errors, []);
    console.log(`Actual Python routing and Node vehicle fixtures: ${realAnswers.length} conversation turns rendered and context/reset checks passed.`);
  }
  console.log(rateOnly ? "Chatbot rate-limit composer checks passed." : "Chatbot focus, budget context, date follow-up, reopening, and new-chat context reset passed.");
} finally {
  await send("Target.closeTarget", { targetId: target.id }).catch(() => {});
  ws.close();
}
