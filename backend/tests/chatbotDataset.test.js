import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import datasetV6 from "../data/chatbot/rentifypro_chatbot_dataset_v6.json" with { type: "json" };

import {
  applyChatbotGuardrails,
  buildChatbotPayload,
  fulfillVehicleAvailabilityStatus,
  getChatbotDatasetInfo,
  normalizeChatbotResponse,
  normalizePendingVehicleSearch,
  normalizeChatbotConversationContext,
  buildChatbotConversationContext,
  validateChatbotInput,
} from "../utils/chatbotPayload.js";

test("rejects poisoned conversation context and nested compound answers", () => {
  const context = { intent: "available_vehicles", entities: { brand: "Toyota", model: "Vios", location: "Cebu", pax: 5 },
    clarification: { required: false, type: null, field: null }, choices: [{ brand: "Toyota", model: "Vios" }] };
  assert.deepEqual(normalizeChatbotConversationContext(context), context);
  assert.equal(normalizeChatbotConversationContext({ ...context, renterId: "other" }), null);
  assert.equal(normalizeChatbotConversationContext({ ...context, entities: { ...context.entities, paymentAmount: 1 } }), null);
  assert.equal(normalizeChatbotConversationContext({ ...context, choices: [{ brand: "Toyota", model: "Vios", renterId: "other" }] }), null);
  const answer = { intent: "payment_methods", confidence: 0.99, language: "en", entities: {}, conditions: {} };
  assert.equal(normalizeChatbotResponse({ ...answer, additional_answers: [{ ...answer, additional_answers: [answer] }] }).valid, false);
  assert.equal(normalizeChatbotResponse({ ...answer, additional_answers: [answer, answer, answer] }).valid, false);
  assert.equal(normalizeChatbotResponse({ ...answer, additional_answers: [{ ...answer, entities: { renterId: "other" } }] }).valid, false);
  assert.equal(normalizeChatbotResponse({ ...answer, intent: "constructor" }).valid, false);
  assert.equal(normalizeChatbotConversationContext({ ...context, intent: "__proto__" }), null);
});

test("fulfills location, capacity, exclusions and dates against current public vehicle fields", () => {
  const vehicles = [
    { _id: "cebu-ford", name: "Ford Everest", location: "Cebu City", availabilityStatus: "available", dailyRentalRate: 1800, pricingUnit: "daily", specs: { type: "suv", seats: 7, transmission: "Automatic" } },
    { _id: "manila-ford", name: "Ford Everest", location: "Manila", availabilityStatus: "available", dailyRentalRate: 1700, pricingUnit: "daily", specs: { type: "suv", seats: 7, transmission: "Automatic" } },
    { _id: "toyota", name: "Toyota Fortuner", location: "Cebu City", availabilityStatus: "available", dailyRentalRate: 1600, pricingUnit: "daily", specs: { type: "suv", seats: 7, transmission: "Automatic" } },
    { _id: "small", name: "Honda CRV", location: "Cebu City", availabilityStatus: "available", dailyRentalRate: 1500, pricingUnit: "daily", specs: { type: "suv", seats: 5, transmission: "Automatic" } },
  ];
  const classifier = { intent: "available_vehicles", confidence: 0.99, language: "en", entities: {
    brand: null, model: null, category: "suv", location: "cebu", pax: 7, excluded_brands: ["Toyota"],
    max_budget: 2000, currency: "PHP", rate_unit: "day", requested_schedule: "tomorrow" }, conditions: {} };
  const result = applyChatbotGuardrails(classifier, buildChatbotPayload("show cars", "en", vehicles, classifier.entities));
  assert.deepEqual(result.recommendations.map(({ _id }) => _id), ["cebu-ford"]);
  assert.match(result.reply, /requested dates is not confirmed/);
  const context = buildChatbotConversationContext(result);
  assert.deepEqual(context.choices, [{ brand: "Ford", model: "Everest" }]);
  assert.doesNotMatch(JSON.stringify(context), /dailyRate|displayRate|owner|payment|renterId/);
  const refreshed = applyChatbotGuardrails(classifier, buildChatbotPayload("same search", "en",
    vehicles.map((vehicle) => ({ ...vehicle, availabilityStatus: "unavailable" })), context.entities));
  assert.deepEqual(refreshed.recommendations, []);
  const status = fulfillVehicleAvailabilityStatus({ ...classifier, intent: "vehicle_availability_status",
    conditions: { vehicle_status_overview: true } }, vehicles.map((vehicle) => ({ ...vehicle, availabilityStatus: "unavailable" })));
  assert.match(status.reply, /1 currently unavailable and 0 available/);
  assert.deepEqual(status.recommendations, []);
  const missingUnit = { ...classifier, intent: "vehicle_availability_status", entities: {
    brand: null, model: null, max_budget: 2000, currency: "PHP", location: "cebu" }, conditions: {},
    requires_clarification: true, clarification: { required: true, type: "missing_entity", field: "rate_unit" },
    reply: "Is your PHP 2,000 budget per day or per hour?" };
  const askUnit = applyChatbotGuardrails(missingUnit, buildChatbotPayload("unavailable under 2000", "en"));
  assert.equal(askUnit.clarification.field, "rate_unit");
  assert.deepEqual(askUnit.recommendations, []);
  assert.equal(askUnit.requires_live_data, false);
});

test("uses chatbot dataset v6 by default", () => {
  const info = getChatbotDatasetInfo();

  assert.equal(
    path.basename(info.datasetPath),
    "rentifypro_chatbot_dataset_v6.json"
  );
  assert.ok(info.intentsCount > 20, "v6 should expose more intents than v5");
});

test("keeps bounded clarification topics and inventory actions without storing private values", () => {
  const response = applyChatbotGuardrails({ intent: "REJECT", confidence: 0.99, language: "en",
    requires_clarification: true, clarification: { required: true, type: "ambiguous_intent", field: null },
    topic: "payment", candidate_intents: ["payment_methods", "payment_downpayment", "unpaid_balance"],
    entities: {}, reply: "Which payment question?" }, buildChatbotPayload("payment", "en"));
  const context = buildChatbotConversationContext(response);
  assert.equal(context.topic, "payment");
  assert.deepEqual(context.candidate_intents, ["payment_methods", "payment_downpayment", "unpaid_balance"]);
  assert.equal(normalizeChatbotConversationContext({ ...context, topic: "__proto__" }), null);
  assert.equal(normalizeChatbotConversationContext({ ...context, candidate_intents: ["my_unpaid_balance"] }), null);
  assert.equal(normalizeChatbotConversationContext({ ...context, conditions: { paymentAmount: 1 } }), null);
  assert.equal(normalizeChatbotConversationContext({ ...context, topic: [] }), null);
  assert.equal(normalizeChatbotResponse({ ...response, candidate_intents: ["unknown"] }).valid, false);
  const status = { intent: "vehicle_availability_status", confidence: 0.99, language: "en", topic: "vehicles",
    entities: {}, conditions: { vehicle_status_overview: true, vehicle_status_list: true, vehicle_status_unavailable: true } };
  const records = [
    { _id: "unavailable", name: "Honda City", availabilityStatus: "unavailable", owner: "PRIVATE-OWNER" },
    { _id: "available", name: "Toyota Vios", availabilityStatus: "available" },
  ];
  const listed = fulfillVehicleAvailabilityStatus(status, records);
  assert.match(listed.reply, /Honda City \(unavailable\)/);
  assert.doesNotMatch(listed.reply, /Toyota Vios|PRIVATE-OWNER/);
  assert.deepEqual(listed.recommendations, []);
  assert.deepEqual(buildChatbotConversationContext(listed).conditions, status.conditions);
  assert.deepEqual(buildChatbotConversationContext(listed).choices, [{ brand: "Honda", model: "City" }]);
  const fresh = fulfillVehicleAvailabilityStatus(status, records.map((v) => ({ ...v, availabilityStatus: "available" })));
  assert.match(fresh.reply, /no currently unavailable/);
  assert.doesNotMatch(fresh.reply, /Honda City/);
  assert.deepEqual(fresh.recommendations, []);
  assert.match(fulfillVehicleAvailabilityStatus(status, []).reply, /no current vehicle listings/);
  assert.equal(applyChatbotGuardrails({ ...status, conditions: { vehicle_status_list: "yes" } },
    buildChatbotPayload("list unavailable", "en")).reason_code, "malformed_classifier");
  const unavailablePayment = applyChatbotGuardrails({ intent: "payment_troubleshooting", confidence: 0.99,
    language: "en", topic: "payment", entities: {}, conditions: { payment_option_unavailable: true },
    reply: "GCash is definitely down and your payment succeeded." }, buildChatbotPayload("GCash unavailable", "en"));
  assert.match(unavailablePayment.reply, /can't verify a payment-provider outage/);
  assert.doesNotMatch(unavailablePayment.reply, /definitely down|payment succeeded/);
  assert.equal(buildChatbotConversationContext(unavailablePayment).conditions.payment_option_unavailable, true);
});

test("uses chatbot dataset v6 even when a legacy override is configured", () => {
  const previousDatasetPath = process.env.CHATBOT_DATASET_PATH;
  process.env.CHATBOT_DATASET_PATH = "rentifypro_chatbot_dataset_v5.json";

  try {
    const info = getChatbotDatasetInfo();
    assert.equal(path.basename(info.datasetPath), "rentifypro_chatbot_dataset_v6.json");
  } finally {
    if (previousDatasetPath === undefined) {
      delete process.env.CHATBOT_DATASET_PATH;
    } else {
      process.env.CHATBOT_DATASET_PATH = previousDatasetPath;
    }
  }
});

test("v6 contains unique intents with complete multilingual responses", () => {
  assert.equal(datasetV6.schema_version, "v6_intent_multilingual_conversational");

  const intentIds = new Set();
  const normalizedExamples = new Map();
  const normalizeExample = (value) => String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%#'\-\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  for (const item of datasetV6.items) {
    assert.ok(item.id, "every v6 intent must have an id");
    assert.equal(intentIds.has(item.id), false, `duplicate v6 intent id: ${item.id}`);
    assert.equal(typeof item.description, "string", `${item.id} must have a description`);
    assert.ok(Array.isArray(item.aliases), `${item.id} aliases must be an array`);
    assert.ok(Array.isArray(item.examples) && item.examples.length > 0, `${item.id} must have examples`);
    assert.ok(Array.isArray(item.hard_negatives), `${item.id} hard negatives must be an array`);
    assert.equal(typeof item.requires_live_data, "boolean", `${item.id} must declare live-data use`);
    assert.equal(typeof item.live_source, "string", `${item.id} must declare a live source or an empty value`);
    assert.equal(typeof item.policy_source, "string", `${item.id} must declare a policy source or an empty value`);
    assert.equal(typeof item.reviewed_at, "string", `${item.id} must have a review date`);
    for (const language of ["en", "fil", "taglish"]) {
      assert.ok(Array.isArray(item.responses?.[language]), `${item.id}.${language} responses must be an array`);
      assert.ok(item.responses[language].every((answer) => typeof answer === "string" && answer.trim()), `${item.id}.${language} responses must be complete`);
    }
    for (const example of item.examples) {
      const normalized = normalizeExample(example);
      assert.equal(normalizedExamples.has(normalized), false, `duplicate example '${example}' in ${item.id} and ${normalizedExamples.get(normalized)}`);
      normalizedExamples.set(normalized, item.id);
    }
    intentIds.add(item.id);
  }

  for (const requiredIntent of ["booking_limits", "schedule_conflict", "late_return_policy", "unpaid_balance", "vehicle_brand_search", "my_active_bookings", "my_overdue_return", "my_unpaid_balance"]) {
    assert.equal(intentIds.has(requiredIntent), true, `${requiredIntent} must be supported`);
  }
  assert.equal(intentIds.has("chat_capabilities"), false, "chat capabilities should be merged into help_request");
  assert.equal(intentIds.has("online_payment"), false, "online payment should be merged into payment_methods");
});

test("keeps v6 response variants as separate chatbot replies", () => {
  const greeting = datasetV6.items.find((item) => item.id === "chat_greeting");
  const payload = buildChatbotPayload("hello", "english");
  const result = applyChatbotGuardrails(
    { intent: "chat_greeting", score: 0.9, reply: "", reply_lang: "en" },
    payload
  );

  assert.ok(greeting.responses.en.includes(result.reply));
});

test("preserves meaningful Unicode, amounts, percentages, apostrophes, and hyphens", () => {
  for (const message of [
    "Can I pay 30%?",
    "How much is ₱1,000?",
    "What is the owner's late-return fee?",
    "Can I extend for 2 days?",
    "你好，pwede mag-book?",
  ]) {
    const result = validateChatbotInput(message);
    assert.equal(result.isValid, true, message);
    assert.equal(result.message, message.normalize("NFKC"), message);
  }

  const amountPayload = buildChatbotPayload("Show vehicles under ₱1,000", "english");
  assert.equal(amountPayload.slots.budget, 1000);
});

test("does not classify or override intents in the Node payload layer", () => {
  const payload = buildChatbotPayload("How can I pay my 30% using GCash?", "english");
  assert.equal(Object.hasOwn(payload, "hintIntentId"), false);
  assert.equal(Object.hasOwn(payload, "preflightRejectReason"), false);

  const result = applyChatbotGuardrails(
    {
      intent: "payment_downpayment",
      confidence: 0.94,
      language: "en",
      reply: "classifier wording is validated against the canonical policy response",
      alternatives: [{ intent: "payment_methods", confidence: 0.12 }],
    },
    payload
  );
  assert.equal(result.intent, "payment_downpayment");
  assert.equal(result.reply, datasetV6.items.find((item) => item.id === "payment_downpayment").responses.en[0]);
});

test("uses safe fallback for malformed classifier results", () => {
  const normalized = normalizeChatbotResponse({
    intent: "invented_intent",
    confidence: 4,
    language: "unsupported",
    alternatives: [{ intent: "also_invented", confidence: 2 }],
  });
  assert.equal(normalized.valid, false);

  const result = applyChatbotGuardrails(normalized, buildChatbotPayload("question", "english"));
  assert.equal(result.intent, "REJECT");
  assert.equal(result.reason_code, "malformed_classifier");
});

test("preserves candidate-specific clarification metadata", () => {
  const result = applyChatbotGuardrails(
    {
      intent: "REJECT",
      confidence: 0.52,
      language: "en",
      reply: "Are you asking about available payment methods, the 30% down payment, or paying the remaining balance?",
      alternatives: [
        { intent: "payment_methods", confidence: 0.52 },
        { intent: "payment_downpayment", confidence: 0.5 },
      ],
      requires_clarification: true,
      reason_code: "ambiguous_intent",
    },
    buildChatbotPayload("payment", "english")
  );
  assert.equal(result.intent, "REJECT");
  assert.equal(result.requires_clarification, true);
  assert.equal(result.alternatives.length, 2);
  assert.match(result.reply, /payment methods/i);
});

test("sorts unchanged live vehicle results deterministically", () => {
  const vehicles = [
    { _id: "b", name: "Beta", hourlyRate: 100, availabilityStatus: "available", specs: { type: "Sedan", seats: 5, transmission: "Automatic" } },
    { _id: "c", name: "Charlie", hourlyRate: 80, availabilityStatus: "available", specs: { type: "Sedan", seats: 5, transmission: "Automatic" } },
    { _id: "a", name: "Alpha", hourlyRate: 100, availabilityStatus: "available", specs: { type: "Sedan", seats: 5, transmission: "Automatic" } },
  ];
  const payload = buildChatbotPayload("What vehicles are available?", "english", vehicles);
  const response = {
    intent: "available_vehicles",
    confidence: 0.95,
    language: "en",
    reply: "",
    alternatives: [],
  };
  const first = applyChatbotGuardrails(response, payload);
  const second = applyChatbotGuardrails(response, payload);
  assert.deepEqual(first.recommendations.map((vehicle) => vehicle._id), ["c", "a", "b"]);
  assert.deepEqual(second.recommendations, first.recommendations);
  assert.doesNotMatch(first.reply, /random/i);
});

test("validates and canonicalizes the vehicle brand entity contract", () => {
  const normalized = normalizeChatbotResponse({
    intent: "vehicle_brand_search",
    confidence: 0.99,
    language: "en",
    reply: "",
    alternatives: [],
    entities: { brand: "tOyOtA", model: "Vios" },
  });
  assert.equal(normalized.valid, true);
  assert.deepEqual(normalized.entities, { brand: "Toyota", model: "Vios" });

  const unknown = normalizeChatbotResponse({
    intent: "vehicle_brand_search",
    confidence: 0.99,
    language: "en",
    alternatives: [],
    entities: { brand: "ABC Motors", model: null },
  });
  assert.equal(unknown.valid, false);

  const inventedField = normalizeChatbotResponse({
    intent: "vehicle_brand_search",
    confidence: 0.99,
    language: "en",
    alternatives: [],
    entities: { brand: "Toyota", color: "red" },
  });
  assert.equal(inventedField.valid, false);
});

test("filters brand and model searches against live vehicle fixtures without fabricating matches", () => {
  const vehicles = [
    { _id: "vios", name: "Toyota Vios", hourlyRate: 120, availabilityStatus: "available", specs: { type: "car", seats: 5, transmission: "Automatic" } },
    { _id: "innova", name: "Toyota Innova", hourlyRate: 100, availabilityStatus: "available", specs: { type: "van", seats: 8, transmission: "Automatic" } },
    { _id: "city", name: "Honda City", hourlyRate: 80, availabilityStatus: "available", specs: { type: "car", seats: 5, transmission: "Automatic" } },
    { _id: "unavailable", name: "Toyota Wigo", hourlyRate: 50, availabilityStatus: "unavailable", specs: { type: "car", seats: 5, transmission: "Automatic" } },
  ];
  const classifier = {
    intent: "vehicle_brand_search",
    confidence: 0.99,
    language: "en",
    reply: "",
    alternatives: [],
    entities: { brand: "Toyota", model: null },
  };
  const payload = buildChatbotPayload("Toyota", "english", vehicles, classifier.entities);
  const first = applyChatbotGuardrails(classifier, payload);
  const second = applyChatbotGuardrails(classifier, payload);

  assert.deepEqual(first.recommendations.map((vehicle) => vehicle._id), ["innova", "vios"]);
  assert.deepEqual(second.recommendations, first.recommendations);
  assert.match(first.reply, /current RentifyPro Toyota listings/i);
  assert.match(first.reply, /confirm availability/i);
  assert.doesNotMatch(first.reply, /Toyota is available/i);

  const modelPayload = buildChatbotPayload("Toyota Vios", "english", vehicles, { brand: "Toyota", model: "Vios" });
  const modelResult = applyChatbotGuardrails(
    { ...classifier, entities: { brand: "Toyota", model: "Vios" } },
    modelPayload
  );
  assert.deepEqual(modelResult.recommendations.map((vehicle) => vehicle._id), ["vios"]);

  const emptyPayload = buildChatbotPayload("Nissan", "english", vehicles, { brand: "Nissan", model: null });
  const emptyResult = applyChatbotGuardrails(
    { ...classifier, entities: { brand: "Nissan", model: null } },
    emptyPayload
  );
  assert.deepEqual(emptyResult.recommendations, []);
  assert.match(emptyResult.reply, /available Nissan vehicles/i);
  assert.doesNotMatch(emptyResult.reply, /never supports/i);
});

test("returns Filipino live brand-search replies for Tagalog brand questions", () => {
  const vehicles = [
    { _id: "ranger", name: "Ford Ranger", hourlyRate: 140, availabilityStatus: "available", specs: { type: "pickup", seats: 5, transmission: "Automatic" } },
    { _id: "everest", name: "Ford Everest", hourlyRate: 160, availabilityStatus: "available", specs: { type: "suv", seats: 7, transmission: "Automatic" } },
    { _id: "vios", name: "Toyota Vios", hourlyRate: 100, availabilityStatus: "available", specs: { type: "car", seats: 5, transmission: "Automatic" } },
  ];
  const classifier = {
    intent: "vehicle_brand_search",
    confidence: 0.99,
    language: "fil",
    reply: "",
    alternatives: [],
    entities: { brand: "Ford", model: null },
  };
  const payload = buildChatbotPayload("Ford meron?", "auto", vehicles, classifier.entities);
  const result = applyChatbotGuardrails(classifier, payload);

  assert.equal(payload.selectedLanguage, "filipino");
  assert.equal(result.language, "fil");
  assert.deepEqual(result.recommendations.map((vehicle) => vehicle._id), ["ranger", "everest"]);
  assert.match(result.reply, /May nakita akong 2 kasalukuyang listahan ng Ford sa RentifyPro/i);
  assert.match(result.reply, /petsa at oras ng pagkuha at pagbabalik/i);
  assert.doesNotMatch(result.reply, /current|listing matches|provide your/i);

  const mayQuestion = buildChatbotPayload("may Toyota ba?", "auto", vehicles, { brand: "Toyota", model: null });
  assert.equal(mayQuestion.selectedLanguage, "filipino");
});

test("resolves only unique one-edit vehicle model typos against live listings", () => {
  const vehicles = [
    { _id: "raptor", name: "Ford Ranger Raptor", hourlyRate: 175, availabilityStatus: "available", specs: { type: "pickup", seats: 5, transmission: "Automatic" } },
    { _id: "everest", name: "Ford Everest", hourlyRate: 160, availabilityStatus: "available", specs: { type: "suv", seats: 7, transmission: "Automatic" } },
  ];
  const typoMessage = "is thre a ford rptor availble?";
  const classifier = {
    intent: "vehicle_brand_search",
    confidence: 0.995,
    language: "en",
    reply: "",
    alternatives: [],
    entities: { brand: "Ford", model: "Rptor" },
  };
  const payload = buildChatbotPayload(typoMessage, "auto", vehicles, classifier.entities);
  const result = applyChatbotGuardrails(classifier, payload);

  assert.equal(payload.originalMessage, typoMessage);
  assert.equal(payload.slots.model, "Raptor");
  assert.deepEqual(result.recommendations.map((vehicle) => vehicle._id), ["raptor"]);
  assert.deepEqual(result.entities, { brand: "Ford", model: "Raptor" });
  assert.match(result.reply, /Ford Raptor/i);

  const ambiguousVehicles = [
    { _id: "civic", name: "Honda Civic", model: "Civic", hourlyRate: 100, availabilityStatus: "available", specs: { type: "car", seats: 5 } },
    { _id: "civix", name: "Honda Civix", model: "Civix", hourlyRate: 105, availabilityStatus: "available", specs: { type: "car", seats: 5 } },
  ];
  const ambiguous = buildChatbotPayload(
    "Honda Civi",
    "auto",
    ambiguousVehicles,
    { brand: "Honda", model: "Civi" }
  );
  assert.equal(ambiguous.slots.model, "Civi");
  assert.deepEqual(ambiguous.vehicles, []);
});

test("keeps brand plus rate as rental_rate while using matching live listing prices", () => {
  const vehicles = [
    { _id: "vios", name: "Toyota Vios", hourlyRate: 125.5, availabilityStatus: "available", specs: { type: "car", seats: 5, transmission: "Automatic" } },
    { _id: "city", name: "Honda City", hourlyRate: 80, availabilityStatus: "available", specs: { type: "car", seats: 5, transmission: "Automatic" } },
  ];
  const response = {
    intent: "rental_rate",
    confidence: 0.995,
    language: "en",
    reply: "",
    alternatives: [],
    entities: { brand: "Toyota", model: "Vios" },
  };
  const payload = buildChatbotPayload("how much is the Toyota Vios?", "english", vehicles, response.entities);
  const result = applyChatbotGuardrails(response, payload);

  assert.equal(result.intent, "rental_rate");
  assert.deepEqual(result.entities, { brand: "Toyota", model: "Vios" });
  assert.deepEqual(result.recommendations.map((vehicle) => vehicle._id), ["vios"]);
  assert.match(result.reply, /PHP 125\.5 per hour/i);
});

test("does not present unsupported insurance or fixed-deposit claims as guarantees", () => {
  const insurance = datasetV6.items.find((item) => item.id === "insurance_included");
  const deposit = datasetV6.items.find((item) => item.id === "security_deposit");
  assert.doesNotMatch(insurance.responses.en[0], /included in all|every rental is insured/i);
  assert.doesNotMatch(deposit.responses.en[0], /(?:PHP|₱)\s*1,?000/i);
});

test("uses a fixed listing snapshot for daily rates and daily budgets", () => {
  const vehicles = [
    { _id: "vios", name: "Toyota Vios", dailyRentalRate: 2400, pricingUnit: "daily", availabilityStatus: "available", specs: { type: "sedan", seats: 5, transmission: "Automatic" } },
    { _id: "everest", name: "Ford Everest", dailyRentalRate: 1800, pricingUnit: "daily", availabilityStatus: "available", specs: { type: "suv", seats: 7, transmission: "Automatic" } },
    { _id: "fortuner", name: "Toyota Fortuner", dailyRentalRate: 2500, pricingUnit: "daily", availabilityStatus: "available", specs: { type: "suv", seats: 7, transmission: "Automatic" } },
    { _id: "hidden", name: "Honda SUV", dailyRentalRate: 1000, pricingUnit: "daily", availabilityStatus: "unavailable", specs: { type: "suv", seats: 7, transmission: "Automatic" } },
  ];
  const rateClassifier = { intent: "rental_rate", confidence: 0.995, language: "en", reply: "",
    entities: { brand: "Toyota", model: "Vios", rate_unit: "day" }, conditions: {} };
  const ratePayload = buildChatbotPayload("How much is a Toyota Vios per day?", "auto", vehicles, rateClassifier.entities);
  const rate = applyChatbotGuardrails(rateClassifier, ratePayload);
  assert.deepEqual(rate.recommendations.map((vehicle) => vehicle._id), ["vios"]);
  assert.match(rate.reply, /PHP 2,400 per day/);
  assert.equal(rate.recommendations[0].displayRate, 2400);
  assert.equal(rate.recommendations[0].displayRateUnit, "day");

  const searchClassifier = { intent: "available_vehicles", confidence: 0.995, language: "en", reply: "",
    entities: { brand: null, model: null, category: "suv", max_budget: 2000, currency: "PHP", rate_unit: "day" } };
  const payload = buildChatbotPayload("Are there SUVs under ₱2,000 per day?", "auto", vehicles, searchClassifier.entities);
  const first = applyChatbotGuardrails(searchClassifier, payload);
  const second = applyChatbotGuardrails(searchClassifier, payload);
  assert.deepEqual(first.recommendations.map((vehicle) => vehicle._id), ["everest"]);
  assert.deepEqual(first, second);
  assert.match(first.reply, /PHP 2,000 per day/);
  assert.doesNotMatch(first.reply, /Fortuner|Honda SUV/);
});

test("keeps known-intent clarifications and validates pending search context", () => {
  const entities = { brand: null, model: null, category: "suv", max_budget: 2000, currency: "PHP" };
  const classifier = { intent: "available_vehicles", confidence: 0.995, language: "en",
    entities, reply: "Is your PHP 2,000 budget per day or per hour?", requires_clarification: true,
    clarification: { required: true, type: "missing_entity", field: "rate_unit" } };
  const response = applyChatbotGuardrails(classifier, buildChatbotPayload("SUV under ₱2,000", "auto", [], entities));
  assert.equal(response.intent, "available_vehicles");
  assert.equal(response.clarification.field, "rate_unit");
  assert.match(response.reply, /per day or per hour/);
  assert.deepEqual(normalizePendingVehicleSearch(entities), entities);
  assert.equal(normalizePendingVehicleSearch({ ...entities, currency: "USD" }), null);
  assert.equal(normalizePendingVehicleSearch({ ...entities, secret: "x" }), null);

  const malformed = normalizeChatbotResponse({ intent: "available_vehicles", confidence: 0.9, language: "en",
    entities: { ...entities, rate_unit: "week" } });
  assert.equal(malformed.valid, false);
  const invalidCondition = normalizeChatbotResponse({ intent: "payment_downpayment", confidence: 0.9,
    language: "en", conditions: { payment_after_due_date: "yes" } });
  assert.equal(invalidCondition.valid, false);
});

test("covers the 30 percent option and balance-due condition without account guesses", () => {
  const conditions = { downpayment_percent: 30, remaining_balance: true, payment_after_due_date: true };
  for (const language of ["en", "fil", "taglish"]) {
    const classifier = { intent: "payment_downpayment", confidence: 0.995, language,
      entities: { brand: null, model: null }, conditions, reply: "" };
    const response = applyChatbotGuardrails(classifier,
      buildChatbotPayload("Can I pay 30% now and the balance after the due date?", "auto"));
    assert.equal(response.intent, "payment_downpayment");
    assert.match(response.reply, /30%/);
    assert.match(response.reply, /balance|balanse/i);
    assert.match(response.reply, /return|pagbabalik|naibalik/i);
    assert.doesNotMatch(response.reply, /your balance is PHP|paid your balance/i);
  }
  const standalone = applyChatbotGuardrails({ intent: "unpaid_balance", confidence: 0.94,
    language: "en", conditions: { remaining_balance: true, payment_after_due_date: true } },
  buildChatbotPayload("Can I pay the remaining balance after the deadline?", "auto"));
  assert.match(standalone.reply, /remaining balance.*due/i);
  assert.match(standalone.reply, /block another booking/i);
  assert.doesNotMatch(standalone.reply, /30%/);
});

test("asks for the booking or model when the live reference is missing or ambiguous", () => {
  const pickup = applyChatbotGuardrails({ intent: "booking_pickup_time", confidence: 0.995, language: "en",
    reply: "Which booking or vehicle are you asking about?", requires_clarification: true,
    clarification: { required: true, type: "missing_entity", field: "booking" } },
  buildChatbotPayload("What time can I pick up the car?", "auto"));
  assert.equal(pickup.intent, "booking_pickup_time");
  assert.match(pickup.reply, /booking or vehicle/i);
  assert.doesNotMatch(pickup.reply, /deposit|late.return fee/i);

  const vehicles = [
    { _id: "civic", name: "Honda Civic", model: "Civic", hourlyRate: 100, availabilityStatus: "available", specs: { type: "sedan" } },
    { _id: "civix", name: "Honda Civix", model: "Civix", hourlyRate: 105, availabilityStatus: "available", specs: { type: "sedan" } },
  ];
  const entities = { brand: "Honda", model: "Civi" };
  const response = applyChatbotGuardrails({ intent: "vehicle_brand_search", confidence: 0.995,
    language: "en", entities, reply: "" }, buildChatbotPayload("Honda Civi", "auto", vehicles, entities));
  assert.equal(response.clarification.type, "ambiguous_entity");
  assert.match(response.reply, /Civic and Civix/);
  assert.deepEqual(response.recommendations, []);
});

test("vehicle status distinguishes unavailable, available, missing and ambiguous listings without recommendations", () => {
  const vehicles = [
    { _id: "city", name: "Honda City", availabilityStatus: "unavailable",
      owner: { email: "private-owner@example.invalid" }, specs: { type: "sedan", plateNumber: "PRIVATE-PLATE" } },
    { _id: "vios", name: "Toyota Vios", availabilityStatus: "available", specs: { type: "sedan" } },
  ];
  for (const language of ["en", "fil", "taglish"]) {
    const classifier = (entities, conditions = {}) => ({
      intent: "vehicle_availability_status", confidence: 0.99, language, entities, conditions,
    });
    const unavailable = fulfillVehicleAvailabilityStatus(classifier({ brand: "Honda", model: "City" }), vehicles);
    assert.equal(unavailable.reason_code, "vehicle_status_unavailable");
    assert.match(unavailable.reply, /Honda City/);
    assert.match(unavailable.reply, /unavailable/);
    assert.deepEqual(unavailable.recommendations, []);
    assert.doesNotMatch(JSON.stringify(unavailable), /private-owner|PRIVATE-PLATE/);
    const available = fulfillVehicleAvailabilityStatus(classifier({ brand: "Toyota", model: "Vios" }), vehicles);
    assert.equal(available.reason_code, "vehicle_status_available");
    assert.deepEqual(available.recommendations, []);
    const missing = fulfillVehicleAvailabilityStatus(classifier({ brand: "Ford", model: "Everest" }), vehicles);
    assert.equal(missing.reason_code, "vehicle_status_not_found");
    const overview = fulfillVehicleAvailabilityStatus(classifier(
      { brand: null, model: null }, { vehicle_status_overview: true }
    ), vehicles);
    assert.equal(overview.reason_code, "vehicle_status_overview");
    assert.match(overview.reply, /1.*unavailable.*1.*available/);
    const ambiguous = fulfillVehicleAvailabilityStatus(classifier({ brand: "Honda", model: "City" }), [
      ...vehicles, { _id: "city-2", name: "Honda City", availabilityStatus: "available" },
    ]);
    assert.equal(ambiguous.reason_code, "ambiguous_vehicle_listing");
    assert.equal(ambiguous.clarification.field, "model");
    assert.deepEqual(ambiguous.recommendations, []);
  }
});

test("unavailable explanations stay canonical and empty available searches do not claim no listing exists", () => {
  const entities = { brand: "Honda", model: "City" };
  const vehicles = [{ _id: "city", name: "Honda City", availabilityStatus: "unavailable" }];
  const search = applyChatbotGuardrails({
    intent: "vehicle_brand_search", confidence: 0.99, language: "en", entities,
  }, buildChatbotPayload("Honda City", "auto", vehicles, entities));
  assert.match(search.reply, /couldn't find any available Honda City/);
  assert.match(search.reply, /does not confirm that no listing exists/);
  assert.deepEqual(search.recommendations, []);
  const explanation = applyChatbotGuardrails({
    intent: "vehicle_unavailability", confidence: 0.99, language: "en",
    reply: "All unavailable vehicles will be available tomorrow.",
  }, buildChatbotPayload("Show unavailable cars", "auto", vehicles));
  assert.match(explanation.reply, /Vehicles page/);
  assert.doesNotMatch(explanation.reply, /tomorrow/);
  assert.deepEqual(explanation.recommendations, []);
  const invalid = normalizeChatbotResponse({
    intent: "vehicle_availability_status", confidence: 0.99, language: "en",
    conditions: { vehicle_status_overview: "yes" },
  });
  assert.equal(invalid.valid, false);
});
