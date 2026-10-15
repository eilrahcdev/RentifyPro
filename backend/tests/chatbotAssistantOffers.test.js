import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyChatbotGuardrails, buildChatbotPayload, buildChatbotConversationContext,
  normalizeChatbotConversationContext, normalizeChatbotResponse, getChatbotDatasetInfo, getChatbotContextOutcome } from "../utils/chatbotPayload.js";

const dataset = JSON.parse(readFileSync(new URL("../data/chatbot/rentifypro_chatbot_dataset_v6.json", import.meta.url)));
const final = (intent, variant, language = "en", extra = {}) => applyChatbotGuardrails({
  intent, confidence: 0.99, language, entities: {}, reply: "Untrusted classifier text with an invented next step.",
  ...(variant ? { response_variant: variant } : {}), ...extra,
}, buildChatbotPayload("fixture", "auto"));

test("only actual canonical offers produce bounded public offer state in all languages", () => {
  for (const language of ["en", "fil", "taglish"]) {
    for (const [intent, variant, action] of [["verification_security", null, "instructions"],
      ["walk_in_payment", "overview", "instructions"], ["available_vehicles", "instructions", "search"]]) {
      const reply = final(intent, variant, language);
      assert.doesNotMatch(reply.reply, /Untrusted|invented next step/);
      const state = buildChatbotConversationContext(reply);
      assert.deepEqual(state.pending_offer, { intent, action, source_variant: variant || "base" });
      assert.equal(normalizeChatbotConversationContext(state).intent, intent);
      assert.equal(buildChatbotConversationContext({ ...reply, reply: "I can approve your verification." }).pending_offer, undefined);
      assert.equal(buildChatbotConversationContext({ ...reply, requires_clarification: true }).pending_offer, undefined);
      assert.ok(JSON.stringify(state).length < 800);
      assert.doesNotMatch(JSON.stringify(state), /password|otp|token|kycStatus|bookingId|renterId|paymentStatus/);
    }
  }
});

test("acknowledgements retain offers but fulfillment rejection reset and idle expiry remove them", () => {
  const initial = buildChatbotConversationContext(final("verification_security"));
  const social = final("chat_acknowledgement");
  const retained = buildChatbotConversationContext(social, initial);
  assert.equal(retained.intent, "verification_security");
  assert.equal(retained.idle_turns, 1);
  assert.deepEqual(retained.pending_offer, initial.pending_offer);
  assert.equal(retained.assistant_action, "overview");
  assert.doesNotMatch(social.reply, /next step/);
  const declined = buildChatbotConversationContext({ ...social, reason_code: "assistant_offer_declined" }, initial);
  assert.equal(declined.pending_offer, undefined);
  assert.equal(declined.intent, initial.intent);
  const instructions = final("verification_security", "instructions", "en", { requested_answer_type: "instructions" });
  assert.match(instructions.reply, /check the review status first/);
  const fulfilled = buildChatbotConversationContext(instructions, retained);
  assert.equal(fulfilled.pending_offer, undefined);
  assert.equal(fulfilled.assistant_action, "instructions");
  assert.equal(buildChatbotConversationContext(final("how_to_book"), initial).pending_offer, undefined);
  assert.equal(buildChatbotConversationContext({ ...social, reason_code: "conversation_reset" }, initial), null);
  assert.equal(buildChatbotConversationContext(social, buildChatbotConversationContext(social, retained)), null);
  assert.equal(getChatbotContextOutcome({ ...social, conversation_context: retained }, initial), "retained");
  assert.equal(getChatbotContextOutcome({ ...social, conversation_context: null }, { ...retained, idle_turns: 2 }), "expired");
  assert.equal(getChatbotContextOutcome({ intent: "REJECT", reason_code: "private_scope", conversation_context: null }, { ...retained, idle_turns: 2 }), "cleared");
  assert.equal(getChatbotContextOutcome({ ...social, reason_code: "conversation_reset" }, retained), "reset");
  assert.equal(getChatbotContextOutcome(social, null, true), "rejected");
});

test("offer metadata rejects invented actions cross-task sources unknown fields coercions and private data", () => {
  const context = buildChatbotConversationContext(final("verification_security"));
  for (const pending_offer of [[], "instructions", { ...context.pending_offer, intent: "my_unpaid_balance" },
    { ...context.pending_offer, action: "approve_kyc" }, { ...context.pending_offer, source_variant: "navigation" },
    { ...context.pending_offer, token: "fixture" }, { ...context.pending_offer, source_variant: 1 },
    { ...context.pending_offer, action: {} }]) {
    assert.equal(normalizeChatbotConversationContext({ ...context, pending_offer }), null);
  }
  for (const assistant_action of [[], {}, 4, "approve_kyc", "x".repeat(200)]) {
    assert.equal(normalizeChatbotConversationContext({ ...context, assistant_action }), null);
  }
  assert.equal(normalizeChatbotConversationContext({ intent: "my_unpaid_balance", entities: {},
    pending_offer: { intent: "my_unpaid_balance", action: "instructions", source_variant: "base" } }), null);
  assert.equal(normalizeChatbotConversationContext({ ...context, history: ["private"] }), null);
  assert.equal(normalizeChatbotResponse({ intent: "verification_security", confidence: 0.99,
    pending_offer: context.pending_offer }).valid, false);
  assert.equal(normalizeChatbotConversationContext({ intent: "verification_security", entities: {} }).intent, "verification_security");
});

test("approved long replies and dataset hashes agree with the Python response contract", () => {
  const verification = dataset.items.find(item => item.id === "verification_security");
  for (const language of ["en", "fil", "taglish"]) {
    const answer = final("verification_security", "instructions", language);
    assert.equal(answer.reply, verification.response_variants.instructions[language][0]);
    assert.ok(answer.reply.length > 500 && answer.reply.length <= 4000);
    assert.doesNotMatch(answer.reply, /Your account is verified|we approved/);
    assert.equal(normalizeChatbotResponse({ intent: "verification_security", confidence: 0.99, reply: "x".repeat(4001) }).valid, false);
  }
  assert.match(getChatbotDatasetInfo().datasetSha256, /^[a-f0-9]{64}$/);
  assert.match(getChatbotDatasetInfo().configSha256, /^[a-f0-9]{64}$/);
});
