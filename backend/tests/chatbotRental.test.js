import test from "node:test";
import assert from "node:assert/strict";
import { applyChatbotGuardrails, buildChatbotPayload, normalizeChatbotConversationContext,
  normalizeChatbotResponse, buildChatbotConversationContext } from "../utils/chatbotPayload.js";
import { getChatbotRentalQuote } from "../utils/chatbotRentalQuote.js";
import { getVehicleHourlyRate, roundCurrency } from "../utils/pricing.js";
import { rentalVehicles } from "./fixtures/chatbotRentalVehicles.js";
import { specificationVehicles } from "./fixtures/chatbotSpecificationVehicles.js";

const fulfill = (entities, vehicles = rentalVehicles, intent = "rental_rate", language = "en") =>
  applyChatbotGuardrails({ intent, confidence: 0.99, language, entities, conditions: {} },
    buildChatbotPayload("rental inquiry", language, vehicles, entities));

test("exact capacity stays distinct from legacy minimum capacity and rejects malformed contracts", () => {
  for (const pax of [2, 5, 18]) {
    const result = fulfill({ pax, seat_match: "exact" }, specificationVehicles, "available_vehicles");
    assert.equal(result.valid, true);
    assert.ok(result.recommendations.length);
    assert.ok(result.recommendations.every(v => v.seats === pax));
    assert.match(result.reply, new RegExp(`exactly ${pax}`));
  }
  const legacy = fulfill({ pax: 5 }, specificationVehicles, "available_vehicles");
  assert.equal(legacy.valid, true);
  assert.ok(legacy.recommendations.some(v => v.seats > 5));
  for (const entities of [{ seat_match: "exact" }, { pax: 5, seat_match: true },
      { pax: 5, seat_match: "approximate" }, { specification_requested: "plateNumber" },
      { driver_included_required: "true" }]) {
    assert.equal(normalizeChatbotResponse({ intent: "available_vehicles", confidence: .99, language: "en", entities }).valid, false);
  }
});

test("listing specification replies answer actual records and distinguish duplicate listing IDs", () => {
  const entities = { brand: "Ford", model: "Ranger", specification_requested: "seats" };
  const result = fulfill(entities, specificationVehicles, "available_vehicles");
  assert.equal(result.valid, true);
  assert.match(result.reply, /Ford Ranger.*5/);
  const original = specificationVehicles.find(v => v.name === "Ford Ranger");
  const duplicate = { ...original, _id: "000000000000000000000299", specs: { ...original.specs, seats: 4 } };
  const ambiguous = fulfill(entities, [original, duplicate], "available_vehicles");
  assert.equal(ambiguous.requires_clarification, true);
  const selected = fulfill({ ...entities, listing_id: duplicate._id }, [original, duplicate], "available_vehicles");
  assert.match(selected.reply, /4/);
  assert.deepEqual(selected.recommendations.map(v => v._id), [duplicate._id]);
  assert.doesNotMatch(JSON.stringify(selected), /plateNumber|owner\.email/);
  const included = fulfill({ category: "car", driver_included_required: true }, specificationVehicles, "available_vehicles");
  assert.deepEqual(included.recommendations, []);
  assert.match(included.reply, /cannot verify|not recorded/i);
});

test("specification filters combine exact stored values without defaults or private fields", () => {
  for (const [entities, names] of [
    [{ pax: 18 }, ["Ford Transit"]],
    [{ category: "truck" }, ["Isuzu FSR", "Ford Ranger"]],
    [{ category: "pickup" }, ["Ford Ranger"]],
    [{ category: "car", driver_requested: true }, ["Ford Everest"]],
    [{ brand: "Ford", category: "car", driver_requested: true }, ["Ford Everest"]],
    [{ category: "truck", transmission: "manual", fuel: "diesel" }, ["Isuzu FSR"]],
    [{ category: "truck", transmission: "manual", fuel: "gasoline" }, []],
    [{ category: "motorcycle", vehicle_subtype: "kuliglig", fuel: "gasoline" }, ["Honda Kuliglig"]],
  ]) {
    const result = fulfill(entities, specificationVehicles, "available_vehicles");
    assert.equal(result.valid, true);
    assert.deepEqual(result.recommendations.map(v => v.name).sort(), [...names].sort());
    assert.doesNotMatch(JSON.stringify(result), /FIX-123|private-fixture/);
    for (const vehicle of result.recommendations) {
      if (entities.fuel) assert.equal(vehicle.fuel, entities.fuel);
      if (entities.driver_requested) assert.equal(vehicle.driverOptionEnabled, true);
      if (entities.driver_requested) assert.match(result.reply, /optional.*do not include/);
      if (entities.pax) assert.ok(vehicle.seats >= entities.pax);
      assert.ok(Number.isFinite(vehicle.displayRate));
      assert.ok(["hour", "day"].includes(vehicle.displayRateUnit));
      if (entities.fuel || entities.transmission || entities.pax || Object.hasOwn(entities, "driver_requested")) {
        assert.match(result.reply, new RegExp(vehicle.name));
        assert.match(result.reply, /PHP.*per (?:hour|day)/);
      }
    }
  }
  const unknown = specificationVehicles.filter(v => v.name === "Toyota Unknown Specs");
  for (const entities of [{ fuel: "gasoline" }, { transmission: "automatic" }, { pax: 1 },
    { driver_requested: true }, { driver_requested: false }, { excluded_fuels: ["diesel"] }]) {
    assert.deepEqual(fulfill(entities, unknown, "available_vehicles").recommendations, []);
  }
  const only = fulfill({ driver_requested: false, self_drive_only: true }, specificationVehicles, "available_vehicles");
  assert.ok(only.recommendations.length);
  assert.ok(only.recommendations.every(v => v.driverOptionEnabled === false));
  const optional = fulfill({ category: "car", driver_requested: true }, specificationVehicles, "available_vehicles");
  assert.match(optional.reply, /optional.*do not include/);
  assert.equal(optional.quote, undefined);
  const branded = fulfill({ brand: "Ford", category: "car", driver_requested: true }, specificationVehicles, "vehicle_brand_search");
  assert.deepEqual(branded.recommendations.map(v => v.name), ["Ford Everest"]);
  assert.match(branded.reply, /optional.*do not include/);
});

test("new specification and clarification fields are bounded while legacy payloads remain valid", () => {
  const base = { intent: "available_vehicles", confidence: 0.99, language: "en", entities: {}, conditions: {} };
  for (const entities of [{}, { fuel: "diesel" }, { excluded_fuels: ["electric"] },
    { driver_requested: false, self_drive_only: true }]) {
    assert.equal(normalizeChatbotResponse({ ...base, entities }).valid, true);
    assert.ok(normalizeChatbotConversationContext({ intent: "available_vehicles", entities }));
  }
  for (const entities of [{ fuel: "nuclear" }, { fuel: ["diesel"] }, { fuel: {} },
    { excluded_fuels: ["nuclear"] }, { excluded_fuels: Array(5).fill("diesel") },
    { self_drive_only: "true", driver_requested: false }, { self_drive_only: true, driver_requested: true },
    { fuel: "diesel", ownerEmail: "private" }, { fuel: "diesel", plateNumber: "private" }]) {
    assert.equal(normalizeChatbotResponse({ ...base, entities }).valid, false);
    assert.equal(normalizeChatbotConversationContext({ intent: "available_vehicles", entities }), null);
  }
  for (const field of ["transmission", "fuel", "driver"]) {
    for (const language of ["en", "fil", "taglish"]) {
      const result = applyChatbotGuardrails({ ...base, language, reason_code: "conflicting_vehicle_specifications",
        requires_clarification: true, clarification: { required: true, type: "ambiguous_entity", field } },
        buildChatbotPayload("conflicting search", language, specificationVehicles));
      assert.equal(result.valid, true);
      assert.deepEqual(result.recommendations, []);
      assert.equal(result.requires_live_data, false);
      assert.match(result.reply, /\?/);
    }
  }
});

test("search explanations use validated filters and current inventory in every reply style", () => {
  for (const language of ["en", "fil", "taglish"]) {
    for (const [intent, entities] of [
      ["available_transmission", { category: "car", transmission: "manual", location: "Cebu" }],
      ["available_vehicles", { category: "suv", location: "Davao", pax: 7, max_budget: 1500, currency: "PHP", rate_unit: "day" }],
      ["vehicle_brand_search", { brand: "Toyota", model: "Vios", transmission: "manual" }],
    ]) {
      const classifier = { intent, language, confidence: 0.99, entities, conditions: {},
        requested_answer_type: "explanation", reply: "Your booking is confirmed and there will be a matching listing tomorrow." };
      const first = applyChatbotGuardrails(classifier, buildChatbotPayload("Huh?", language, rentalVehicles, entities));
      const why = applyChatbotGuardrails(classifier, buildChatbotPayload("Why couldn't you find any?", language, rentalVehicles, entities));
      assert.equal(first.valid, true);
      assert.equal(first.requires_clarification, false);
      assert.deepEqual(first.recommendations, []);
      assert.match(first.reply, /filter/i);
      assert.notEqual(first.reply, why.reply);
      for (const value of [entities.category, entities.brand, entities.model, entities.transmission, entities.location].filter(Boolean)) {
        const label = language === "fil" && value === "car" ? "kotse" : value;
        assert.ok(first.reply.toLowerCase().includes(label.toLowerCase()), first.reply);
      }
      if (entities.pax) assert.match(first.reply, language === "fil" ? /hindi bababa sa 7 upuan/ : /minimum seats: 7/);
      if (entities.max_budget) assert.match(first.reply, language === "fil" ? /PHP 1,500 bawat araw/ : /PHP 1,500 per day/);
      assert.doesNotMatch(first.reply, /booking is confirmed|tomorrow|bukas|Toyota Camry/i);
      assert.equal(first.quote, undefined);
    }
    const entities = { category: "car", transmission: "automatic" };
    const search = fulfill(entities, rentalVehicles, "available_transmission", language);
    const explanation = applyChatbotGuardrails({ intent: "available_transmission", language, confidence: 0.99,
      entities, conditions: {}, requested_answer_type: "explanation" },
      buildChatbotPayload("What do you mean?", language, rentalVehicles, entities));
    assert.deepEqual(explanation.recommendations, search.recommendations);
    assert.notEqual(explanation.reply, search.reply);
    assert.match(explanation.reply, /automatic transmission/);
    for (const vehicle of search.recommendations) assert.ok(explanation.reply.includes(vehicle.name));
    assert.equal(buildChatbotConversationContext(explanation).requested_answer_type, "explanation");
  }
});

test("price inquiries distinguish unavailable, missing, filtered and invalid-rate listings", () => {
  const unavailable = fulfill({ brand: "Toyota", model: "Camry", rate_unit: "day" });
  assert.equal(unavailable.reason_code, "price_listing_unavailable");
  assert.match(unavailable.reply, /listings exist.*unavailable/);
  assert.deepEqual(unavailable.recommendations, []);
  const missing = fulfill({ brand: "Toyota", model: "Innova", rate_unit: "day" });
  assert.equal(missing.reason_code, "price_listing_not_found");
  assert.doesNotMatch(missing.reply, /PHP [0-9]/);
  const filtered = fulfill({ brand: "Toyota", model: "Vios", location: "Davao" });
  assert.equal(filtered.reason_code, "price_filters_unmatched");
  assert.deepEqual(filtered.recommendations, []);
  const malformed = fulfill({ brand: "Toyota", model: "Vios" }, [{ ...rentalVehicles[0], dailyRentalRate: null }]);
  assert.equal(malformed.reason_code, "price_not_verified");
  assert.doesNotMatch(malformed.reply, /PHP 0/);
});

test("cheapest searches retain category, filters and comparable hourly or daily units", () => {
  for (const rate_unit of ["day", "hour"]) {
    const result = fulfill({ category: "motorcycle", sort_by: "lowest_price", rate_unit }, rentalVehicles, "available_vehicles");
    assert.deepEqual(result.recommendations.map(v => v.name), ["Honda Click", "Yamaha Mio"]);
    assert.ok(result.recommendations.every(v => v.type === "motorcycle" && v.displayRateUnit === rate_unit));
    assert.match(result.reply, rate_unit === "day" ? /PHP 500 per day/ : /PHP 20\.83 per hour/);
  }
  const empty = fulfill({ category: "motorcycle", location: "Davao", sort_by: "lowest_price" }, rentalVehicles, "available_vehicles");
  assert.deepEqual(empty.recommendations, []);
  const seats = fulfill({ category: "motorcycle", sort_by: "lowest_price", pax: 3 }, rentalVehicles, "available_vehicles");
  assert.deepEqual(seats.recommendations, []);
});

test("Node preserves classifier entities and enforces missing budget units independently", () => {
  const budget = fulfill({ category: "sedan", transmission: "automatic", max_budget: 2000, currency: "PHP" }, rentalVehicles, "available_vehicles");
  assert.equal(budget.clarification.field, "rate_unit");
  assert.deepEqual(budget.recommendations, []);
  const entities = { category: "suv" };
  const response = applyChatbotGuardrails({ intent: "available_vehicles", confidence: 0.99, language: "en", entities },
    buildChatbotPayload("this car for 3 days and 6.5 people", "en", rentalVehicles, entities));
  assert.ok(response.recommendations.every(vehicle => vehicle.type === "suv"));
  assert.equal(response.recommendations.length, 2);
});

test("quotations use the same rounding and duration math as booking creation", () => {
  for (const [vehicle, duration_value, duration_unit, driver_requested] of [
    [rentalVehicles[1], 5, "day", false], [rentalVehicles[1], 5, "day", true],
    [rentalVehicles[2], 3, "day", false], [rentalVehicles[4], 1.5, "hour", false],
  ]) {
    const result = fulfill({ brand: vehicle.name.split(" ")[0], model: vehicle.name.split(" ").slice(1).join(" "),
      listing_id: vehicle._id, quote_requested: true, duration_value, duration_unit, driver_requested });
    const hours = duration_value * (duration_unit === "day" ? 24 : 1);
    const base = roundCurrency(getVehicleHourlyRate(vehicle) * hours);
    const driver = driver_requested ? roundCurrency(getVehicleHourlyRate(vehicle, { rateField: "driverDailyRate" }) * hours) : 0;
    assert.equal(result.quote.baseRental, base);
    assert.equal(result.quote.driverCharge, driver);
    assert.equal(result.quote.rentalSubtotal, roundCurrency(base + driver));
    assert.match(result.reply, /checkout fees.*not a confirmed booking or payment due/);
    const context = buildChatbotConversationContext(result);
    assert.equal(context.entities.listing_id, vehicle._id);
    assert.doesNotMatch(JSON.stringify(context), /rentalSubtotal|baseRental|driverCharge|bookingId|paymentAmount/);
  }
});

test("quotes ask for a listing, duration or unsupported driver without inventing totals", () => {
  const listing = fulfill({ category: "suv", duration_value: 5, duration_unit: "day", quote_requested: true });
  assert.equal(listing.clarification.field, "model");
  assert.equal(listing.quote, undefined);
  const duration = fulfill({ brand: "Toyota", model: "Vios", quote_requested: true });
  assert.equal(duration.clarification.field, "duration");
  const driver = fulfill({ brand: "Toyota", model: "Vios", duration_value: 3, duration_unit: "day", driver_requested: true });
  assert.equal(driver.clarification.field, "driver");
  assert.equal(driver.quote, undefined);
  const duplicate = fulfill({ brand: "Toyota", model: "Vios", duration_value: 3, duration_unit: "day" },
    [rentalVehicles[0], { ...rentalVehicles[0], _id: "000000000000000000000099", dailyRentalRate: 1900 }]);
  assert.equal(duplicate.clarification.field, "model");
  assert.equal(duplicate.quote, undefined);
  const selected = fulfill({ brand: "Toyota", model: "Vios", listing_id: rentalVehicles[0]._id,
    duration_value: 3, duration_unit: "day" },
    [rentalVehicles[0], { ...rentalVehicles[0], _id: "000000000000000000000099", dailyRentalRate: 1900 }]);
  assert.equal(selected.quote.rentalSubtotal, 7200);
});

test("driver rate questions use fresh verified rates with and without a driver", () => {
  const entities = { brand: "Ford", model: "Everest", rate_unit: "hour", driver_requested: true };
  assert.match(fulfill(entities).reply, /PHP 100 per hour, with a driver/);
  assert.match(fulfill({ ...entities, driver_requested: false }).reply, /PHP 75 per hour, without a driver/);
  const invalid = fulfill(entities, [{ ...rentalVehicles[1], driverDailyRate: null }]);
  assert.equal(invalid.reason_code, "quote_rate_not_verified");
  assert.equal(invalid.quote, undefined);
});

test("new rental entity contracts reject poisoned, coerced and unbounded client context", () => {
  const context = { intent: "rental_rate", entities: { brand: "Ford", model: "Everest" }, choices: [] };
  for (const extra of [
    { duration_value: "5", duration_unit: "day" }, { duration_value: NaN, duration_unit: "hour" },
    { duration_value: true, duration_unit: "day" }, { duration_value: 1 },
    { duration_value: 366, duration_unit: "day" }, { duration_value: 1, duration_unit: "week" },
    { quote_requested: "true" }, { driver_requested: 1 }, { listing_id: { $ne: null } },
    { requested_date: "2026-02-30" }, { pickup_time: "25:00" }, { rentalSubtotal: 1 },
    { max_budget: true, currency: "PHP" }, { brand: { $ne: null } },
  ]) {
    assert.equal(normalizeChatbotConversationContext({ ...context, entities: { ...context.entities, ...extra } }), null);
    assert.equal(normalizeChatbotResponse({ intent: "rental_rate", confidence: 0.99, language: "en",
      entities: { ...context.entities, ...extra } }).valid, false);
  }
});

test("unverified rates and contradictory vehicle specifications are not recommendations", () => {
  for (const patch of [{ dailyRentalRate: null }, { dailyRentalRate: -1 }, { dailyRentalRate: Infinity },
    { pricingUnit: "weekly" }, { specs: { type: "motorcycle", subType: "suv", seats: 7 } },
    { specs: { type: "motorcycle", transmission: "not automatic", seats: 2 } }]) {
    const result = fulfill({ category: "motorcycle", transmission: "automatic", sort_by: "lowest_price" },
      [{ ...rentalVehicles[4], ...patch }], "available_vehicles");
    assert.deepEqual(result.recommendations, []);
  }
  const subtype = fulfill({ category: "suv" }, [{ ...rentalVehicles[1], specs: { type: "car", subType: "SUV" } }], "available_vehicles");
  assert.equal(subtype.recommendations[0].type, "suv");
});

test("quotes cannot accept client prices or return a confirmed future booking", () => {
  assert.equal(getChatbotRentalQuote(rentalVehicles[1], { duration_value: 5, duration_unit: "day", driver_requested: "true" }), null);
  const result = fulfill({ brand: "Ford", model: "Everest", duration_value: 5, duration_unit: "day", requested_date: "2026-10-12" });
  assert.match(result.reply, /not confirmed.*pickup.*return/i);
  const fresh = fulfill({ brand: "Ford", model: "Everest", duration_value: 5, duration_unit: "day" },
    [{ ...rentalVehicles[1], dailyRentalRate: 2000 }]);
  assert.equal(fresh.quote.rentalSubtotal, 9999.6);
  const removed = fulfill({ brand: "Ford", model: "Everest", listing_id: rentalVehicles[1]._id, duration_value: 5, duration_unit: "day" }, []);
  assert.equal(removed.quote, undefined);
  assert.deepEqual(removed.recommendations, []);
});

test("classifier extras cannot manufacture quotations, payment totals or booking confirmations", () => {
  const response = { intent: "rental_rate", confidence: 0.99, language: "en", entities: { brand: "Toyota", model: "Vios" },
    quote: { rentalSubtotal: 1 }, bookingConfirmed: true, paymentAmountDue: 1, renterId: "private" };
  const final = applyChatbotGuardrails(response, buildChatbotPayload("rental rate", "en", rentalVehicles, response.entities));
  assert.equal(final.quote, undefined);
  assert.equal(final.bookingConfirmed, undefined);
  assert.equal(final.paymentAmountDue, undefined);
  assert.equal(final.renterId, undefined);
  assert.equal(normalizeChatbotResponse({ ...response, confidence: true }).valid, false);
  assert.equal(normalizeChatbotResponse({ ...response, requires_clarification: "false" }).valid, false);
  assert.equal(normalizeChatbotResponse({ ...response, top_preds: [{ id: "rental_rate", score: "1", paymentAmountDue: 1 }] }).valid, false);
  const predictions = normalizeChatbotResponse({ ...response, top_preds: [{ id: "rental_rate", score: 0.9, paymentAmountDue: 1 }] });
  assert.deepEqual(predictions.top_preds, [{ intent_id: "rental_rate", id: "rental_rate", score: 0.9 }]);
});

test("complete Manila schedules use booking duration calculations and reject reversed dates", () => {
  const entities = { brand: "Ford", model: "Everest", quote_requested: true,
    requested_date: "2026-10-12", requested_return_date: "2026-10-15", pickup_time: "09:00", return_time: "10:30" };
  const final = fulfill(entities);
  assert.equal(final.quote.durationHours, 73.5);
  assert.equal(final.quote.rentalSubtotal, 5512.5);
  assert.match(final.reply, /Asia\/Manila/);
  const reversed = fulfill({ ...entities, requested_return_date: "2026-10-11" });
  assert.equal(reversed.quote, undefined);
  assert.equal(reversed.clarification.field, "duration");
  assert.doesNotMatch(reversed.reply, /PHP 0/);
  const conflicting = fulfill({ ...entities, duration_value: 3, duration_unit: "day" });
  assert.equal(conflicting.quote, undefined);
  assert.equal(conflicting.clarification.field, "duration");
  assert.match(conflicting.reply, /conflicts/);
});

test("regression inventory distinguishes broad cars, sedans, trucks, pickups and motorcycles", () => {
  const inventory = [...rentalVehicles,
    { ...rentalVehicles[0], _id: "000000000000000000000101", name: "Isuzu FSR",
      specs: { type: "truck", subType: "Dump Truck", transmission: "Manual", seats: 3 } },
    { ...rentalVehicles[0], _id: "000000000000000000000102", name: "Ford Ranger Raptor",
      specs: { type: "truck", subType: "Pick Up", transmission: "Automatic", seats: 5 } },
  ];
  for (const [category, expected] of [
    ["car", ["Toyota Vios", "Ford Everest", "Toyota Fortuner"]],
    ["sedan", ["Toyota Vios"]], ["truck", ["Isuzu FSR", "Ford Ranger Raptor"]],
    ["pickup", ["Ford Ranger Raptor"]], ["motorcycle", ["Honda Click", "Yamaha Mio"]],
  ]) {
    const result = fulfill({ category }, inventory, "available_vehicles");
    assert.equal(result.valid, true);
    assert.equal(result.entities.category, category);
    assert.deepEqual(result.recommendations.map(v => v.name).sort(), [...expected].sort(), category);
    assert.ok(result.recommendations.every(v => v.name !== "Toyota Camry"));
    assert.ok(new RegExp(`\\b${expected.length}\\s+(?:currently\\s+)?available\\b`, "i").test(result.reply)
      || expected.every(name => result.reply.includes(name)), result.reply);
  }
});

test("regression transmission and seat filters retain exact matches and honest no-match responses", () => {
  for (const [entities, expected] of [
    [{ category: "car", transmission: "automatic" }, ["Toyota Vios", "Ford Everest"]],
    [{ category: "car", transmission: "manual" }, ["Toyota Fortuner"]],
    [{ category: "suv", pax: 7 }, ["Ford Everest", "Toyota Fortuner"]],
    [{ category: "van", pax: 12 }, ["Toyota Hiace"]],
    [{ category: "sedan", pax: 6 }, []], [{ category: "motorcycle", pax: 3 }, []],
    [{ category: "car", transmission: "manual", location: "Cebu" }, []],
  ]) {
    const result = fulfill(entities, rentalVehicles, "available_vehicles");
    assert.deepEqual(result.recommendations.map(v => v.name).sort(), [...expected].sort(), JSON.stringify(entities));
    assert.equal(result.requires_clarification, false);
    for (const vehicle of result.recommendations) {
      if (entities.transmission) assert.equal(vehicle.transmission.toLowerCase(), entities.transmission);
      if (entities.pax) assert.ok(vehicle.seats >= entities.pax);
    }
    if (!expected.length) {
      assert.match(result.reply, /couldn't find|no current available/i);
      assert.equal(result.quote, undefined);
      assert.doesNotMatch(result.reply, /reserved for you|booking confirmed|payment received/i);
    }
  }
});

test("representative legacy Python outputs remain accepted without requiring new metadata", () => {
  for (const [intent, entities] of [
    ["chat_greeting", { brand: null, model: null }],
    ["available_transmission", { brand: null, model: null, category: "sedan", transmission: "manual" }],
    ["available_vehicles", { brand: null, model: null, category: "pickup" }],
    ["payment_methods", { brand: null, model: null }],
  ]) {
    const classifier = { intent, confidence: 0.99, language: "en", entities, conditions: {} };
    const normalized = normalizeChatbotResponse(classifier);
    assert.equal(normalized.valid, true, intent);
    const result = applyChatbotGuardrails(classifier, buildChatbotPayload("legacy inquiry", "en", rentalVehicles, entities));
    assert.equal(result.valid, true, intent);
    assert.equal(result.intent, intent);
    for (const [key, value] of Object.entries(entities)) assert.deepEqual(result.entities[key], value);
    assert.notEqual(result.reason_code, "malformed_classifier");
  }
});

test("contextual instruction variants survive canonical fulfillment and preserve bounded context", () => {
  const classifier = { intent: "walk_in_payment", confidence: 0.99, language: "en", topic: "payment",
    entities: {}, conditions: {}, response_variant: "instructions", requested_answer_type: "instructions",
    reply: "Your booking was approved and your balance is paid." };
  const result = applyChatbotGuardrails(classifier, buildChatbotPayload("How do I request it?", "en"));
  assert.equal(result.valid, true);
  assert.equal(result.response_variant, "instructions");
  assert.equal(result.requested_answer_type, "instructions");
  assert.match(result.reply, /Request Walk-in Approval/);
  assert.doesNotMatch(result.reply, /your balance is paid/i);
  const context = buildChatbotConversationContext(result);
  assert.equal(context.response_variant, "instructions");
  assert.equal(context.requested_answer_type, "instructions");
  assert.ok(normalizeChatbotConversationContext(context));
});

test("unsupported classifier fields fail closed without manufactured live data", () => {
  const base = { intent: "available_vehicles", confidence: 0.99, language: "en", entities: { category: "car" }, conditions: {} };
  for (const patch of [
    { entities: { category: "car", bookingId: "private" } },
    { entities: { category: "car", rentalSubtotal: 1 } },
    { conditions: { owner_approved: true } },
    { requested_answer_type: "paid" },
  ]) {
    const classifier = { ...base, ...patch, reply: "Your booking is confirmed and paid." };
    assert.equal(normalizeChatbotResponse(classifier).valid, false);
    const result = applyChatbotGuardrails(classifier, buildChatbotPayload("search", "en", rentalVehicles));
    assert.equal(result.reason_code, "malformed_classifier");
    assert.deepEqual(result.recommendations, []);
    assert.doesNotMatch(result.reply, /confirmed and paid/);
    assert.equal(buildChatbotConversationContext(result), null);
  }
});
