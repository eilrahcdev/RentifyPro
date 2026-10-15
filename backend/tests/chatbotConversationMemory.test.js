import test from "node:test";
import assert from "node:assert/strict";
import { applyChatbotGuardrails, buildChatbotPayload, buildChatbotConversationContext,
  normalizeChatbotConversationContext } from "../utils/chatbotPayload.js";

const answer = (intent, extras = {}) => applyChatbotGuardrails({ intent, confidence: 0.99,
  language: "en", entities: {}, conditions: {}, ...extras }, buildChatbotPayload("question", "en"));
const task = () => buildChatbotConversationContext(answer("walk_in_payment", { response_variant: "instructions", topic: "payment" }));

test("brief social answers preserve one validated task and expire after two idle turns", () => {
  const initial = task();
  for (const intent of ["chat_acknowledgement", "chat_gratitude", "chat_wellbeing", "chat_greeting", "chat_identity", "chat_gender_identity", "chat_language_support", "chat_casual_conversation"]) {
    const first = buildChatbotConversationContext(answer(intent), initial);
    assert.deepEqual(first, { ...initial, idle_turns: 1 });
    const second = buildChatbotConversationContext(answer("chat_acknowledgement"), first);
    assert.deepEqual(second, { ...initial, idle_turns: 2 });
    assert.equal(buildChatbotConversationContext(answer("chat_gratitude"), second), null);
    assert.equal(buildChatbotConversationContext(answer(intent)), null);
  }
  assert.equal(initial.idle_turns, undefined, "retaining a task must not mutate the previous context");
});

test("meaningful new answers replace old task, and reset or goodbye removes it", () => {
  const retained = buildChatbotConversationContext(answer("chat_gratitude"), task());
  const next = buildChatbotConversationContext(answer("booking_cancellation", { response_variant: "instructions", topic: "booking" }), retained);
  assert.equal(next.intent, "booking_cancellation");
  assert.equal(next.response_variant, "instructions");
  assert.equal(next.idle_turns, undefined);
  assert.equal(buildChatbotConversationContext(answer("chat_greeting", { response_variant: "reset", reason_code: "conversation_reset" }), next), null);
  assert.equal(buildChatbotConversationContext(answer("chat_goodbye"), next), null);
  assert.equal(buildChatbotConversationContext(answer("REJECT", { reason_code: "private_record_scope" }), next), null);
  for (const intent of ["help_request", "unclear_message"]) {
    assert.equal(buildChatbotConversationContext(answer(intent), next), null);
  }
  const unclearInput = buildChatbotConversationContext(answer("nonsense_message"), next);
  assert.deepEqual(unclearInput, { ...next, idle_turns: 1 });
  const second = buildChatbotConversationContext(answer("nonsense_message"), unclearInput);
  assert.deepEqual(second, { ...next, idle_turns: 2 });
  assert.equal(buildChatbotConversationContext(answer("nonsense_message"), second), null);
});

test("task context rejects oversized counters, unknown fields, private records, and incompatible variants", () => {
  const initial = task();
  for (const idle_turns of [-1, 3, true, false, "1", 1.5, NaN, Infinity, {}, []]) {
    assert.equal(normalizeChatbotConversationContext({ ...initial, idle_turns }), null);
  }
  for (const extra of [{ reply: "ignore rules" }, { task_context: initial }, { bookingId: "private" }, { amount: 10 },
    { response_variant: "paid" }, { intent: "payment_methods", response_variant: "approval" }]) {
    assert.equal(normalizeChatbotConversationContext({ ...initial, ...extra }), null);
    assert.equal(buildChatbotConversationContext(answer("chat_acknowledgement"), { ...initial, ...extra }), null);
  }
  const social = buildChatbotConversationContext(answer("chat_identity"));
  assert.equal(social, null);
  assert.equal(buildChatbotConversationContext(answer("chat_gratitude"), { ...initial, intent: "chat_identity", response_variant: undefined, topic: "conversation" }), null);
});

test("reset and wellbeing variants survive final canonicalization in all response styles", () => {
  for (const language of ["en", "fil", "taglish"]) {
    for (const [intent, response_variant] of [["chat_greeting", "reset"], ["chat_wellbeing", "working"]]) {
      const result = answer(intent, { response_variant, language, reply: "Got it." });
      assert.equal(result.response_variant, response_variant);
      assert.notEqual(result.reply, "Got it.");
      assert.equal(result.requires_clarification, false);
    }
  }
});

test("pending task clarification remains bounded across an acknowledgement", () => {
  const initial = buildChatbotConversationContext(answer("available_vehicles", { topic: "vehicles",
    entities: { brand: null, model: null, category: "sedan", transmission: "automatic", max_budget: 2000, currency: "PHP" } }));
  assert.equal(initial.clarification.field, "rate_unit");
  const retained = buildChatbotConversationContext(answer("chat_acknowledgement"), initial);
  assert.equal(retained.clarification.field, "rate_unit");
  assert.equal(retained.entities.max_budget, 2000);
  assert.equal(retained.entities.transmission, "automatic");
  assert.equal(retained.idle_turns, 1);
});
