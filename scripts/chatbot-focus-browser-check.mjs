// Run Vite on 4176 and isolated headless Chrome with CDP on 9236, then:
// node --experimental-websocket scripts/chatbot-focus-browser-check.mjs
import assert from "node:assert/strict";
import { fulfillHoldoutRequests } from "../backend/scripts/chatbot-holdout-fulfill.mjs";
import coverage from "../chatbot-service/chatbot_coverage.json" with { type: "json" };
import { getChatbotServiceHeaders } from "../backend/utils/chatbotServiceAuth.js";

const base = "http://127.0.0.1:4176";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let sequence = 0;
let chatRequests = 0;
let realRouting = false;
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
const respond = (requestId, status, data) => send("Fetch.fulfillRequest", {
  requestId,
  responseCode: status,
  responseHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" },
    { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
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
      if (realRouting) {
        const response = await fetch(`${process.env.CHATBOT_CLASSIFIER_URL}/chat`, {
          method: "POST", headers: { "content-type": "application/json", ...getChatbotServiceHeaders() },
          redirect: "error",
          body: JSON.stringify({ message: body.message, language: body.language,
            previous_language: body.previousLanguage, previous_context: body.conversationContext || body.pendingSearch }),
        });
        assert.equal(response.status, 200);
        const [answer] = fulfillHoldoutRequests([{ message: body.message, classifier: await response.json() }], true);
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
  if (process.env.CHATBOT_CLASSIFIER_URL) {
    realRouting = true;
    for (const conversation of coverage.conversations) {
      await wait("!document.querySelector('button[aria-label=\"Start a new chatbot conversation\"]').disabled");
      await click('button[aria-label="Start a new chatbot conversation"]');
      await wait("document.querySelector('.rp-ai-chat-body').textContent.toLowerCase().includes('suggested questions')");
      for (const turn of conversation.turns) {
        if (turn.reset) {
          await click('button[aria-label="Start a new chatbot conversation"]');
          await wait("document.querySelector('.rp-ai-chat-body').textContent.toLowerCase().includes('suggested questions')");
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
        for (const [key, value] of Object.entries(turn.clarification || {})) assert.equal(answer.clarification[key], value);
        for (const phrase of turn.reply_contains || []) assert.ok(answer.reply.toLowerCase().includes(phrase.toLowerCase()));
        await wait(`document.querySelector('.rp-ai-chat-body').innerText.includes(${JSON.stringify(answer.reply)})`);
        await wait(`document.querySelectorAll('.rp-ai-chat-body p').length > ${messageCount}`);
        await wait("!document.querySelector('button[aria-label=\"Start a new chatbot conversation\"]').disabled");
        if (turn.reset) assert.equal(sentMessages.at(-1).conversationContext, null);
        assert.equal(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(input)})`), true);
      }
    }
    assert.deepEqual(errors, []);
    console.log(`Actual Python routing and Node vehicle fixtures: ${realAnswers.length} conversation turns rendered and context/reset checks passed.`);
  }
  console.log("Chatbot focus, budget context, date follow-up, reopening, and new-chat context reset passed.");
} finally {
  await send("Target.closeTarget", { targetId: target.id }).catch(() => {});
  ws.close();
}
