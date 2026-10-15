import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyChatbotGuardrails, buildChatbotPayload, buildChatbotConversationContext, normalizeChatbotResponse, normalizeChatbotConversationContext } from '../utils/chatbotPayload.js';

const dataset = JSON.parse(readFileSync(new URL('../data/chatbot/rentifypro_chatbot_dataset_v6.json',import.meta.url)));
const answer = (variant, kind, language='en') => applyChatbotGuardrails({intent:'messaging',topic:'support',confidence:0.99,language,
  response_variant:variant,requested_answer_type:kind,reply:'Generic introduction from an untrusted classifier',entities:{},conditions:{}},buildChatbotPayload('messaging',language));

test('messaging answer types survive canonical fulfillment and public context in all styles', () => {
  const item = dataset.items.find(item=>item.id==='messaging');
  for(const language of ['en','fil','taglish']) {
    for(const [variant,kind] of [['overview','overview'],['instructions','instructions'],['instructions_detail','instructions'],
      ['navigation','navigation'],['troubleshooting','troubleshooting'],['no_reply','troubleshooting'],['explanation','explanation']]) {
      const result=answer(variant,kind,language);
      assert.equal(result.reply,item.response_variants[variant][language][0]);
      assert.equal(result.requested_answer_type,kind);
      const context=buildChatbotConversationContext(result);
      assert.equal(context.requested_answer_type,kind);
      assert.equal(context.response_variant,variant);
      assert.deepEqual(context.choices,[]);
      assert.doesNotMatch(JSON.stringify(context),/last_user_request|bookingId|renterId|paidAmount/);
    }
  }
});

test('answer type metadata accepts legacy absence and rejects unknown, coerced and unbounded values', () => {
  const base={intent:'messaging',confidence:0.99,language:'en',entities:{}};
  assert.ok(normalizeChatbotResponse(base).valid);
  for(const kind of ['instructions','navigation','explanation','overview','troubleshooting','confirmation','continuation']) {
    assert.ok(normalizeChatbotResponse({...base,requested_answer_type:kind}).valid);
  }
  for(const kind of ['paid','approved',42,true,[],{},'x'.repeat(500)]) {
    assert.equal(normalizeChatbotResponse({...base,requested_answer_type:kind}).valid,false);
    assert.equal(normalizeChatbotConversationContext({intent:'messaging',entities:{},requested_answer_type:kind}),null);
  }
});

test('ordinary fallback retains only a validated bounded task while reset and private scope discard it', () => {
  const initial=buildChatbotConversationContext(answer('instructions','instructions'));
  let context=initial;
  for(const reason_code of ['low_confidence','conversation_repair_clarification']) {
    context=buildChatbotConversationContext({intent:'REJECT',reason_code,requires_clarification:true},context);
    assert.equal(context.intent,'messaging');
    assert.equal(context.requested_answer_type,'instructions');
  }
  assert.equal(context.idle_turns,2);
  assert.equal(buildChatbotConversationContext({intent:'REJECT',reason_code:'conversation_repair_clarification'},context),null);
  for(const reason_code of ['private_record_scope','outside_scope','malformed_classifier','conversation_reset']) {
    assert.equal(buildChatbotConversationContext({intent:'REJECT',reason_code},initial),null);
  }
  assert.equal(buildChatbotConversationContext({intent:'REJECT',reason_code:'ambiguous_intent',topic:'account'},initial),null);
});

test('procedural vehicle guidance stays canonical without inventing inventory or schedule status', () => {
  for(const language of ['en','fil','taglish']) {
    const result=applyChatbotGuardrails({intent:'available_vehicles',confidence:0.99,language,topic:'vehicles',response_variant:'instructions',requested_answer_type:'instructions',
      entities:{category:'car',max_budget:2000,currency:'PHP'},reply:'A car is reserved for you'},buildChatbotPayload('browse',language));
    assert.equal(result.reply,dataset.items.find(item=>item.id==='available_vehicles').response_variants.instructions[language][0]);
    assert.deepEqual(result.recommendations,[]);
    assert.equal(result.requires_live_data,false);
    assert.equal(result.requires_clarification,false);
    assert.doesNotMatch(result.reply,/reserved for you/);
  }
});
