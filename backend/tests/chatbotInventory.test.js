import test from "node:test";
import assert from "node:assert/strict";
import { buildChatbotInventoryVocabulary, buildChatbotPayload, applyChatbotGuardrails,
  normalizeChatbotResponse, normalizeChatbotConversationContext } from "../utils/chatbotPayload.js";

const listing = (id, name, category, subtype) => ({ _id: id.toString(16).padStart(24, "0"), name,
  availabilityStatus: "available", dailyRentalRate: 250, pricingUnit: "hourly",
  specs: { type: category, subType: subtype, seats: 2, transmission: "Automatic", fuel: "Gasoline" },
  owner: { email: "private-owner@example.invalid" }, plateNumber: "PRIVATE-123", bookingReservationId: "private-reservation" });
const answer = entities => ({ intent: "available_vehicles", topic: "vehicles", confidence: .99,
  language: "en", entities, conditions: {} });

test("public request vocabulary includes live identities and custom subtypes without private fields", () => {
  const records = [listing(1001, "Rivian R1T", "truck", "Adventure Utility"), listing(1002, "Manual SUV", "car", "SUV")];
  const vocabulary = buildChatbotInventoryVocabulary(records);
  assert.deepEqual(vocabulary.brands, ["Rivian"]);
  assert.deepEqual(vocabulary.models, [{ brand: "Rivian", model: "R1T" }]);
  assert.ok(vocabulary.subtypes.some(item => item.name === "adventure utility" && item.category === "truck"));
  assert.doesNotMatch(JSON.stringify(vocabulary), /PRIVATE|private-|owner|email|bookingReservation|_id|dailyRentalRate/);
  const bounded = buildChatbotInventoryVocabulary(Array.from({ length: 1000 }, (_, index) =>
    listing(index + 1, `Make${index} Model${index}`, "truck", `Custom ${index}`)));
  assert.equal(bounded.brands.length, 128);
  assert.ok(bounded.models.length <= 512 && bounded.subtypes.length <= 256);
});

test("classifier and context accept current vocabulary and still reject fabricated or private entity fields", () => {
  const vocabulary = buildChatbotInventoryVocabulary([listing(1001, "Rivian R1T", "truck", "Adventure Utility")]);
  const entities = { brand: "Rivian", model: "R1T", category: "truck", vehicle_subtype: "adventure utility" };
  assert.equal(normalizeChatbotResponse(answer(entities)).valid, false);
  assert.equal(normalizeChatbotResponse(answer(entities), "english", 0, vocabulary).valid, true);
  assert.equal(normalizeChatbotResponse(answer({ ...entities, brand: "Invented" }), "english", 0, vocabulary).valid, false);
  assert.equal(normalizeChatbotResponse(answer({ ...entities, vehicle_subtype: "invented" }), "english", 0, vocabulary).valid, false);
  assert.equal(normalizeChatbotResponse(answer({ ...entities, owner: "other" }), "english", 0, vocabulary).valid, false);
  const context = { intent: "available_vehicles", topic: "vehicles", entities, choices: [{ brand: "Rivian", model: "R1T" }] };
  assert.ok(normalizeChatbotConversationContext(context, vocabulary));
  assert.equal(normalizeChatbotConversationContext({ ...context, entities: { ...entities, price: 1 } }, vocabulary), null);
  const social = { ...answer({}), intent: "chat_casual_conversation", topic: "conversation", inventory_vocabulary_requested: true };
  assert.equal(normalizeChatbotResponse(social).valid, true);
  assert.equal(normalizeChatbotResponse({ ...social, inventory_vocabulary_requested: "yes" }).valid, false);
  assert.equal(normalizeChatbotResponse({ ...answer({}), inventory_vocabulary_requested: true }).valid, false);
});

test("saved subtype and specification updates affect matches immediately in the same process", () => {
  const records = [listing(1001, "Yamaha Mio Gear", "motorcycle", "Kuliglig")];
  const fulfill = subtype => applyChatbotGuardrails(answer({ category: "motorcycle", vehicle_subtype: subtype }),
    buildChatbotPayload("Find motorcycles", "english", records, { category: "motorcycle", vehicle_subtype: subtype }));
  assert.equal(fulfill("kuliglig").recommendations.length, 1);
  records[0].specs.subType = "Scooter";
  assert.equal(fulfill("kuliglig").recommendations.length, 0);
  const card = fulfill("scooter").recommendations[0];
  assert.equal(card.subtype, "scooter");
  assert.equal(card.displayRate, 250);
  assert.equal(card.pricingUnit, "hourly");
  records[0].specs.subType = "Urban Shuttle";
  assert.equal(fulfill("urban shuttle").recommendations[0].subtype, "urban shuttle");
  assert.equal(fulfill("scooter").recommendations.length, 0);
  records[0].seats = 99; records[0].transmission = "Manual";
  assert.equal(fulfill("urban shuttle").recommendations[0].seats, 2);
  assert.equal(fulfill("urban shuttle").recommendations[0].transmission, "automatic");
});

test("sports car, supercar and hypercar stay separate according to saved labels and exclusions", () => {
  const records = [listing(1001, "BMW M3", "car", "Sports Car"), listing(1002, "Toyota Coupe", "car", "Supercar"),
    listing(1003, "Koenigsegg Agera", "car", "Hypercar"), listing(1004, "BMW Unlabelled", "car", "")];
  for (const [subtype, name] of [["sports car", "BMW M3"], ["supercar", "Toyota Coupe"], ["hypercar", "Koenigsegg Agera"]]) {
    const entities = { category: "car", vehicle_subtype: subtype };
    const result = applyChatbotGuardrails(answer(entities), buildChatbotPayload("Find cars", "english", records, entities));
    assert.deepEqual(result.recommendations.map(v => v.name), [name]);
  }
  const entities = { category: "car", excluded_subtypes: ["hypercar"] };
  const result = applyChatbotGuardrails(answer(entities), buildChatbotPayload("Find cars", "english", records, entities));
  assert.deepEqual(result.recommendations.map(v => v.name).sort(), ["BMW M3", "Toyota Coupe"]);
});
