import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyChatbotGuardrails, buildChatbotPayload, buildChatbotConversationContext,
  normalizeChatbotResponse, normalizeChatbotConversationContext } from "../utils/chatbotPayload.js";

const dataset = JSON.parse(fs.readFileSync(new URL("../data/chatbot/rentifypro_chatbot_dataset_v6.json", import.meta.url), "utf8"));
const items = Object.fromEntries(dataset.items.map((item) => [item.id, item]));
const answer = (intent, response_variant, language = "en") => applyChatbotGuardrails({
  intent, response_variant, language, confidence: 0.99, entities: {}, conditions: {},
  reply: "Your request was approved and paid. All bookings have insurance and a guaranteed refund.",
}, buildChatbotPayload("policy question", language));

test("serves approved purpose-specific answers after canonicalization in every language", () => {
  assert.equal(dataset.items.length, 61);
  for (const item of dataset.items) {
    for (const [variant, responses] of Object.entries(item.response_variants || {})) {
      for (const style of ["en", "fil", "taglish"]) {
        const result = answer(item.id, variant, style);
        assert.equal(result.reply, responses[style][0], `${item.id}.${variant}.${style}`);
        assert.equal(result.response_variant, variant);
        assert.deepEqual(result.recommendations, []);
        assert.doesNotMatch(result.reply, /Your request was approved and paid|guaranteed refund/);
        assert.doesNotMatch(result.reply, /[\u{1F300}-\u{1FAFF}]/u, "serious payment answers need no decorative emoji");
      }
    }
  }
});

test("walk-in answers preserve down payment, eligibility, approval, and receipt as separate requirements", () => {
  const overview = answer("walk_in_payment", "overview").reply;
  assert.match(overview, /^Yes,/);
  assert.match(overview, /remaining rental balance.*down payment is recorded.*eligible/);
  assert.match(overview, /owner must approve.*first/);
  assert.match(overview, /confirms receipt/);
  const instructions = answer("walk_in_payment", "instructions").reply;
  assert.match(instructions, /1\..*Bookings.*2\..*Pay Remaining.*3\..*Request Walk-in Payment.*Request Walk-in Approval/);
  assert.match(instructions, /sending the request does not pay the balance/);
  assert.doesNotMatch(instructions, /Would you|Anything else|How can I help|\?$/);
  const rejected = answer("walk_in_payment", "rejection").reply;
  assert.match(rejected, /pay.*online.*or submit a new.*eligible/);
  assert.match(rejected, /does not settle your balance or cancel the booking/);
  assert.doesNotMatch(rejected, /automatically approved|refund guaranteed|cannot request again/);
  for (const variant of ["no_downpayment", "initial_payment", "no_approval"]) {
    assert.match(answer("walk_in_payment", variant).reply, /^No,/);
  }
  const approval = answer("walk_in_payment", "approval").reply;
  assert.match(approval, /^Yes,.*owner must approve/);
  assert.match(approval, /still needs to confirm receipt/);
  assert.doesNotMatch(approval, /GCash|Maya|card|steps to request/);
});

test("unknown request status and unsupported policy facts stay uncertain", () => {
  const status = answer("walk_in_payment", "status");
  assert.match(status.reply, /cannot confirm your individual request status here/);
  assert.doesNotMatch(status.reply, /Your request (?:is|was) (?:approved|rejected|completed)/);
  const insurance = answer("insurance_included").reply;
  assert.match(insurance, /^It depends/);
  assert.doesNotMatch(insurance, /^Yes|all rentals|guaranteed/);
  const deposit = answer("security_deposit").reply;
  assert.match(deposit, /cannot confirm.*amount/);
  assert.doesNotMatch(deposit, /shown.*checkout|(?:PHP|₱)\s*\d/);
  assert.doesNotMatch(answer("advance_booking_discount").reply, /active promo|automatic.*discount|\d+%/);
});

test("purpose metadata is bounded by its intent and stores no payment or booking facts", () => {
  const context = buildChatbotConversationContext(answer("walk_in_payment", "approval"));
  assert.equal(context.response_variant, "approval");
  assert.deepEqual(Object.keys(context).sort(), ["choices", "clarification", "entities", "intent", "response_variant"]);
  for (const value of ["unknown", "__proto__", [], {}, 42]) {
    assert.equal(normalizeChatbotConversationContext({ ...context, response_variant: value }), null);
    assert.equal(normalizeChatbotResponse({ intent: "walk_in_payment", confidence: 0.99, response_variant: value }).valid, false);
  }
  assert.equal(normalizeChatbotConversationContext({ ...context, intent: "payment_methods" }), null);
  assert.equal(normalizeChatbotConversationContext({ ...context, paidAmount: 1000 }), null);
  assert.equal(normalizeChatbotConversationContext({ ...context, bookingId: "private" }), null);
  assert.equal(normalizeChatbotConversationContext({ ...context, response_variant: undefined })?.intent, "walk_in_payment");
  const malformed = answer("payment_methods", "approval");
  assert.equal(malformed.reason_code, "malformed_classifier");
  assert.doesNotMatch(malformed.reply, /Your request was approved/);
});

test("old classifiers retain canonical answers and simple acknowledgements stay brief", () => {
  assert.equal(answer("payment_methods").reply, items.payment_methods.responses.en[0]);
  for (const style of ["en", "fil", "taglish"]) {
    for (const intent of ["chat_gratitude", "chat_acknowledgement"]) {
      const result = applyChatbotGuardrails({ intent, language: style, confidence: 0.99 }, buildChatbotPayload("thanks", style));
      if (intent === "chat_acknowledgement") assert.ok(result.reply.length < 30);
      else {
        assert.ok(result.reply.length > 30 && result.reply.length < 160);
        assert.equal(result.reply, items.chat_gratitude.responses[style][0]);
        assert.match(result.reply, /welcome|Walang anuman/);
      }
      assert.doesNotMatch(result.reply, /\?|Anything else|let me know/);
    }
  }
});

test("booking guidance names real controls without promising approval or refunds", () => {
  const booking = answer("how_to_book").reply;
  assert.match(booking, /1\..*Vehicles.*2\..*pickup.*return.*3\..*verification.*Book Now.*4\..*Bookings/);
  assert.match(booking, /confirmed only after owner approval/);
  assert.match(answer("booking_extension", "instructions").reply, /Extend Rental Time.*later return date.*Send extension request.*wait for owner approval/);
  const cancellation = answer("booking_cancellation", "instructions").reply;
  assert.match(cancellation, /pending request can be cancelled directly.*approved or extended.*owner review/);
  assert.match(cancellation, /chat cannot cancel it for you/);
  assert.doesNotMatch(cancellation, /guaranteed refund|refund within \d/);
});

test("declared supercar and hypercar subtypes stay distinct and unlabelled cars are never guessed", () => {
  const vehicles = [
    { _id: "000000000000000000000951", name: "Toyota Test Coupe", dailyRentalRate: 3000, pricingUnit: "hourly", availabilityStatus: "available", specs: { type: "car", subType: "Supercar", seats: 2 } },
    { _id: "000000000000000000000952", name: "Koenigsegg Agera RS", dailyRentalRate: 15000, pricingUnit: "hourly", availabilityStatus: "available", specs: { type: "car", subType: "Hypercar", seats: 2 } },
    { _id: "000000000000000000000953", name: "BMW Unclassified", dailyRentalRate: 1000, pricingUnit: "hourly", availabilityStatus: "available", specs: { type: "car", subType: "", seats: 2 } },
  ];
  for (const subtype of ["supercar", "hypercar"]) {
    const entities = { category: "car", vehicle_subtype: subtype, excluded_subtypes: [subtype === "supercar" ? "hypercar" : "supercar"] };
    const result = applyChatbotGuardrails({ intent: "available_vehicles", confidence: 0.99, language: "fil", entities }, buildChatbotPayload("May sasakyan ba?", "filipino", vehicles, entities));
    assert.equal(result.recommendations.length, 1);
    assert.equal(result.recommendations[0].subtype, subtype);
    assert.doesNotMatch(result.reply, /I found|Shown matches|exactly|minimum seats|per hour/);
  }
});

test("free-text subtypes retain a verified broad category and localized specification summaries", () => {
  const vehicle = { _id: "000000000000000000000954", name: "Toyota Hiace", dailyRentalRate: 650, pricingUnit: "hourly", availabilityStatus: "available", specs: { type: "van", subType: "18 Seater", seats: 18, transmission: "Automatic", fuel: "Gasoline" } };
  const entities = { category: "van", pax: 18, seat_match: "exact", transmission: "automatic" };
  const result = applyChatbotGuardrails({ intent: "available_vehicles", confidence: 0.99, language: "fil", entities }, buildChatbotPayload("May van na 18 upuan?", "filipino", [vehicle], entities));
  assert.equal(result.recommendations[0]?.name, vehicle.name);
  assert.equal(result.recommendations[0]?.type, "van");
  assert.match(result.reply, /18 upuan/);
  assert.doesNotMatch(result.reply, /exactly|minimum seats|per hour|Shown matches/);
  const poisoned = normalizeChatbotResponse({ intent: "available_vehicles", confidence: 0.99, entities: { category: "car", excluded_subtypes: ["made up"] } });
  assert.equal(poisoned.valid, false);
});

test("composer failures follow the current question language and keep neutral follow-ups in context", async () => {
  const { chatbotFeedbackStyle, chatbotFeedbackText } = await import("../../frontend/src/utils/chatbotCooldown.js");
  assert.equal(chatbotFeedbackStyle("Paano makapagbayad ng booking?", "en"), "fil");
  assert.equal(chatbotFeedbackStyle("How do I pay ang booking ko?", "fil"), "taglish");
  assert.equal(chatbotFeedbackStyle("How do I pay online?", "fil"), "en");
  assert.equal(chatbotFeedbackStyle("BMW?", "fil"), "fil");
  assert.match(chatbotFeedbackText("network", "fil"), /^Hindi makakonekta/);
  assert.match(chatbotFeedbackText("network", "en"), /^Cannot connect/);
  assert.match(chatbotFeedbackText("network", "taglish"), /draft mo/);
  assert.match(chatbotFeedbackText("rate", "fil"), /Naabot ang chat limit/);
  assert.match(chatbotFeedbackText("busy", "en"), /Chat is busy/);
});
