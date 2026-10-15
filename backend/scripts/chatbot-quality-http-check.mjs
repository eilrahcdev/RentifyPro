import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import Vehicle from "../models/Vehicle.js";
import Booking from "../models/Booking.js";
import { rentalVehicles } from "../tests/fixtures/chatbotRentalVehicles.js";

const target = new URL(process.argv[2] || "http://127.0.0.1:8003");
assert.ok(["127.0.0.1", "localhost"].includes(target.hostname), "Use an isolated local Python service.");
process.env.NODE_ENV = "test";
// Functional checks are isolated from the default-quota HTTP tests in chatbotProtection.test.js.
process.env.ENABLE_RATE_LIMIT = "false";
process.env.CHATBOT_URL = target.origin;
process.env.CHATBOT_SERVICE_AUTOSTART = "false";
process.env.CHATBOT_INTERNAL_API_KEY = "fixture-only-quality-check-key-32-characters";
const metadataResponse = await fetch(target, { headers: { "x-internal-key": process.env.CHATBOT_INTERNAL_API_KEY } });
assert.equal(metadataResponse.status, 200);
const metadata = await metadataResponse.json();
for (const [field, filename] of [["dataset_sha256", "rentifypro_chatbot_dataset_v6.json"], ["config_sha256", "chatbot_config.json"]]) {
  assert.equal(metadata[field], createHash("sha256").update(readFileSync(new URL(`../../chatbot-service/${filename}`, import.meta.url))).digest("hex"));
}
assert.equal(metadata.intent_count, 61);
const listing = (id, name, type, subType, seats = 2) => ({
  _id: id.toString(16).padStart(24, "0"), name, availabilityStatus: "available", location: "Cebu",
  dailyRentalRate: 650, pricingUnit: "hourly", driverOptionEnabled: false,
  specs: { type, subType, seats, fuel: "Gasoline", transmission: "Automatic" },
});
const inventory = [
  ...rentalVehicles,
  listing(951, "BMW M3", "car", "Sedan", 5), listing(952, "BMW X3", "car", "SUV", 5),
  listing(953, "Toyota Commuter", "van", "18 Seater", 18),
  listing(954, "Koenigsegg Agera RS", "car", "Hypercar"),
  listing(955, "Toyota Test Coupe", "car", "Supercar"),
  listing(956, "BMW Unclassified", "car", "", 5),
  listing(1001, "Yamaha Mio Gear", "motorcycle", "Kuliglig"),
  listing(1002, "Rivian R1T", "truck", "Adventure Utility", 5),
  listing(1003, "BMW Test Sports Car", "car", "Sports Car", 2),
];
// No database connection: queries use only this explicitly labelled test inventory.
Vehicle.find = () => ({ select: () => ({ lean: async () => inventory }) });
Booking.distinct = async () => [];
const { default: chatRoutes } = await import("../routes/chat.routes.js");
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  if (req.headers.origin === "http://127.0.0.1:4176") {
    res.set("Access-Control-Allow-Origin", req.headers.origin);
    res.set("Access-Control-Allow-Credentials", "true");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
// This fixture-only control never connects to MongoDB or changes real inventory.
app.post("/fixture/subtype", (req, res) => {
  const vehicle = inventory.find(record => record.name === "Yamaha Mio Gear");
  if (!["Kuliglig", "Scooter", "Urban Shuttle"].includes(req.body.subtype)) return res.sendStatus(400);
  vehicle.specs.subType = req.body.subtype;
  return res.json({ name: vehicle.name, subtype: vehicle.specs.subType });
});
app.use("/api/chat", chatRoutes);
app.get("/api/auth/me", (_req, res) => res.status(401).json({ message: "No fixture session" }));
app.get("/api/vehicles", (_req, res) => res.json({ vehicles: inventory, pagination: { total: inventory.length } }));
app.get("/api/vehicles/locations", (_req, res) => res.json({ locations: [] }));
const server = app.listen(process.argv.includes("--serve") ? 5012 : 0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const evidence = [];
async function post(message, context = null, previousLanguage = null, language = "auto") {
  const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, conversationContext: context, previousLanguage, language }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.valid, true, JSON.stringify(result));
  for (const card of result.recommendations) {
    const source = inventory.find(vehicle => vehicle._id === card._id);
    assert.ok(source, "Every card must exist in fixture inventory.");
    assert.equal(source.availabilityStatus, "available");
    assert.equal(card.seats, source.specs.seats);
    assert.equal(card.fuel, (source.specs.fuel || "").toLowerCase());
    assert.equal(card.pricingUnit, source.pricingUnit);
    assert.equal(card.displayRate, card.displayRateUnit === "day" ? card.dailyRate : card.hourlyRate);
    assert.equal(source.pricingUnit === "daily" ? card.dailyRate : card.hourlyRate, source.dailyRentalRate);
  }
  evidence.push({ message, result });
  return result;
}
try {
  for (const [message, intent, style] of [
    ["How do I pay for my booking?", "payment_methods", "en"],
    ["Paano makapagbayad ng booking?", "payment_methods", "fil"],
    ["How do I pay ang booking ko?", "payment_methods", "taglish"],
    ["Paano magbayad ng down payment?", "payment_downpayment", "fil"],
    ["What policies does RentifyPro have?", "help_request", "en"],
    ["Ano ang mga patakaran ng RentifyPro?", "help_request", "fil"],
    ["What policies ang meron sa RentifyPro?", "help_request", "taglish"],
    ["What is your cancellation policy?", "booking_cancellation", "en"],
    ["May refund ba?", "rental_refund_guidance", "fil"],
    ["Ano ang policy sa late return?", "late_return_policy", "fil"],
  ]) {
    const answer = await post(message);
    assert.equal(answer.intent, intent, message);
    assert.equal(answer.language, style, message);
    assert.equal(answer.requires_clarification, false, message);
    if (intent === "payment_methods") assert.equal(answer.response_variant, "instructions");
  }
  const extension = await post("Can I extend my rental?");
  for (const message of ["okay, thanks", "thank you", "salamat", "salamat po"]) {
    const result = await post(message, extension.conversation_context);
    assert.equal(result.intent, "chat_gratitude");
    assert.ok(result.reply.length > 30 && result.reply.length < 160);
    assert.equal(result.conversation_context.intent, "booking_extension");
  }
  let result = await post("Is there an 18-seater?");
  assert.equal(result.recommendations[0].name, "Toyota Commuter");
  const seats = result.conversation_context;
  for (const message of ["How about BMW vehicles?", "I mean BMW vehicles for rent", "How about Toyota?"]) {
    result = await post(message, result.conversation_context);
    assert.equal(result.entities.pax, undefined);
    assert.ok(result.recommendations.length);
  }
  result = await post("How about an automatic one?", seats);
  assert.equal(result.entities.pax, 18);
  result = await post("May Koenigsegg ba?");
  assert.equal(result.recommendations[0].subtype, "hypercar");
  for (const message of ["May supercar ba?", "Gusto ko supercar, hindi hypercar"]) {
    result = await post(message, result.conversation_context);
    assert.equal(result.recommendations[0].subtype, "supercar");
    assert.equal(result.recommendations[0].name, "Toyota Test Coupe");
  }
  for (const style of ["en", "fil", "taglish"]) {
    result = await post("Do you have manual cars?", null, null, style);
    const explain = await post("Huh?", result.conversation_context, style);
    assert.equal(explain.requested_answer_type, "explanation");
    assert.equal(explain.language, style);
    assert.notEqual(explain.reply, result.reply);
    assert.equal(explain.entities.transmission, "manual");
  }
  assert.equal((await post("my booking status")).reason_code, "authentication_required");
  assert.equal((await post("start a new conversation", seats)).conversation_context, null);
  const beforeUpdate = await post("Meron bang kuliglig?");
  assert.deepEqual(beforeUpdate.recommendations.map(v => v.name), ["Yamaha Mio Gear"]);
  const yamaha = await post("How about Yamaha?", beforeUpdate.conversation_context);
  assert.equal(yamaha.entities.vehicle_subtype, undefined);
  for (const subtype of ["Scooter", "Urban Shuttle"]) {
    inventory.find(vehicle => vehicle.name === "Yamaha Mio Gear").specs.subType = subtype;
    assert.deepEqual((await post("Meron bang kuliglig?")).recommendations, []);
    const result = await post(`Do you have ${subtype}?`);
    assert.deepEqual(result.recommendations.map(v => v.name), ["Yamaha Mio Gear"]);
    assert.equal(result.recommendations[0].subtype, subtype.toLowerCase());
  }
  inventory.find(vehicle => vehicle.name === "Yamaha Mio Gear").specs.subType = "Kuliglig";
  for (const brand of ["Chevrolet", "Mitsubishi", "Ducati"]) {
    const result = await post(`Do you have ${brand}?`);
    assert.equal(result.entities.brand, brand);
    assert.equal(result.requires_clarification, false);
    assert.deepEqual(result.recommendations, []);
  }
  const liveModel = await post("Show R1T rentals");
  assert.equal(liveModel.entities.brand, "Rivian");
  assert.deepEqual(liveModel.recommendations.map(v => v.name), ["Rivian R1T"]);
  const sports = await post("Do you have sports cars?");
  assert.deepEqual(sports.recommendations.map(v => v.name), ["BMW Test Sports Car"]);
  console.log(JSON.stringify({ passed: evidence.length, classifier: metadata.routing_revision, intents: metadata.intent_count,
    inventory: "isolated fixture; no database writes", url: base }));
  if (process.argv.includes("--serve")) {
    process.on("SIGINT", () => server.close(() => process.exit(0)));
    process.on("SIGTERM", () => server.close(() => process.exit(0)));
  } else await new Promise(resolve => server.close(resolve));
} catch (error) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  throw error;
}
