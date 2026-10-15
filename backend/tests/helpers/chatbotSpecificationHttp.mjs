import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cases = [
  ["Do you have 5-seater vehicles?", { pax: 5, seat_match: "exact" }],
  ["Do you have 5 seaters?", { pax: 5, seat_match: "exact" }],
  ["Do you have 5 seater vehicles for rent?", { pax: 5, seat_match: "exact" }],
  ["Do you have diesel vehicles?", { fuel: "diesel" }],
  ["Diesel engine?", { fuel: "diesel" }],
  ["May diesel na sasakyan ba?", { fuel: "diesel" }],
  ["May automatic na SUV na 5-seater?", { category: "suv", transmission: "automatic", pax: 5, seat_match: "exact" }],
  ["Do you have automatic 5-seat SUVs?", { category: "suv", transmission: "automatic", pax: 5, seat_match: "exact" }],
  ["May automatic na SUV na at least 5 seats?", { category: "suv", transmission: "automatic", pax: 5, seat_match: "minimum" }],
  ["Do you have manual transmission vehicles?", { transmission: "manual" }],
  ["May automatic na SUV na 5-seater na diesel?", { category: "suv", transmission: "automatic", pax: 5, seat_match: "exact", fuel: "diesel" }],
];
const lower = value => String(value || "").trim().toLowerCase();
const localUrl = value => {
  const url = new URL(value);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Only localhost test endpoints are allowed");
  return url.origin;
};
const matches = (vehicle, fields) => vehicle.availabilityStatus === "available" && !vehicle.locked
  && (!fields.category || lower(vehicle.specs?.type) === "suv"
    || (lower(vehicle.specs?.type) === "car" && lower(vehicle.specs?.subType) === "suv"))
  && (!fields.transmission || lower(vehicle.specs?.transmission) === fields.transmission)
  && (!fields.fuel || lower(vehicle.specs?.fuel) === fields.fuel)
  && (!fields.pax || (Number.isInteger(vehicle.specs?.seats)
    && (fields.seat_match === "exact" ? vehicle.specs.seats === fields.pax : vehicle.specs.seats >= fields.pax)));

let server;
try {
  let inventory, apiUrl, identityCases;
  const live = process.argv[2] === "--live";
  if (live) {
    apiUrl = localUrl(process.argv[3] || "http://localhost:5000");
    const response = await fetch(`${apiUrl}/api/vehicles?limit=100`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.pagination.hasNextPage, false, "Use a complete inventory snapshot for this smoke check");
    inventory = data.vehicles;
  } else {
    const input = JSON.parse(readFileSync(0, "utf8"));
    inventory = input.vehicles;
    identityCases = input.identityCases;
    process.env.NODE_ENV = "test";
    process.env.INTERNAL_API_KEY = "fixture-only-specification-http-key-32-characters";
    process.env.CHATBOT_INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
    process.env.CHATBOT_URL = localUrl(input.classifierUrl);
    process.env.CHATBOT_SERVICE_AUTOSTART = "false";
    const [{ default: express }, { default: Vehicle }, { default: Booking }] = await Promise.all([
      import("express"), import("../../models/Vehicle.js"), import("../../models/Booking.js"),
    ]);
    Vehicle.find = query => {
      return { select: projection => {
        if (projection === "name brand model specs.type specs.subType") {
          assert.deepEqual(query, {});
          return { lean: async () => inventory };
        }
        assert.deepEqual(query, { availabilityStatus: "available" });
        assert.match(projection, /specs\.seats/);
        assert.match(projection, /specs\.fuel/);
        assert.doesNotMatch(projection, /plateNumber|owner\.email|owner\.phone/);
        return { lean: async () => inventory.filter(v => v.availabilityStatus === "available") };
      } };
    };
    Booking.distinct = async () => inventory.filter(v => v.locked).map(v => v._id);
    const { default: chatRoutes } = await import("../../routes/chat.routes.js");
    const app = express(); app.use(express.json()); app.use("/api/chat", chatRoutes);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    apiUrl = `http://127.0.0.1:${server.address().port}`;
  }
  const records = [], cookies = new Map();
  const post = async (message, conversationContext = null, language = "auto") => {
    const response = await fetch(`${apiUrl}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json", cookie: [...cookies.values()].join("; ") },
      body: JSON.stringify({ message, language, conversationContext }), signal: AbortSignal.timeout(30000),
    });
    for (const cookie of response.headers.getSetCookie()) cookies.set(cookie.split("=")[0], cookie.split(";")[0]);
    assert.equal(response.status, 200, `${message}: HTTP ${response.status}; respect any server cooldown before retrying`);
    const answer = await response.json();
    records.push({ message, intent: answer.intent, entities: answer.entities, reply: answer.reply,
      cards: answer.recommendations.map(v => ({ id: v._id, name: v.name, seats: v.seats, fuel: v.fuel, transmission: v.transmission })) });
    if (live) await new Promise(resolve => setTimeout(resolve, 2500));
    return answer;
  };
  const verify = (answer, fields) => {
    assert.equal(answer.requires_clarification, false);
    assert.ok(["available_vehicles", "available_transmission", "passenger_capacity"].includes(answer.intent));
    for (const [field, value] of Object.entries(fields)) assert.equal(answer.entities[field], value);
    const expected = inventory.filter(v => matches(v, fields));
    assert.equal(answer.recommendations.length, Math.min(3, expected.length), JSON.stringify({ fields, entities: answer.entities, reply: answer.reply }));
    for (const card of answer.recommendations) {
      const stored = expected.find(v => String(v._id) === card._id);
      assert.ok(stored, `${card.name} violates a mandatory filter or availability rule`);
      assert.equal(card.seats, stored.specs?.seats || 0);
      if (fields.fuel) assert.equal(card.fuel, lower(stored.specs.fuel));
      if (fields.transmission) assert.equal(card.transmission, lower(stored.specs.transmission));
    }
    if (!expected.length) assert.match(answer.reply, /couldn't find|Walang available|Wala akong mahanap/i);
  };
  if (identityCases) {
    let context = null;
    for (const testCase of identityCases) {
      if (testCase.update) {
        const vehicle = inventory.find(v => v._id === testCase.update.id.toString(16).padStart(24, "0"));
        assert.ok(vehicle);
        vehicle.specs.subType = testCase.update.subtype;
      }
      const answer = await post(testCase.message, testCase.followup ? context : null, testCase.language || "auto");
      if (testCase.language) assert.equal(answer.language, testCase.language);
      assert.equal(answer.requires_clarification, false, testCase.message);
      for (const [field, value] of Object.entries(testCase.entities || {})) assert.deepEqual(answer.entities[field], value, testCase.message);
      for (const field of testCase.absent || []) assert.equal(answer.entities[field], undefined, testCase.message);
      if (testCase.intent) assert.equal(answer.intent, testCase.intent);
      assert.deepEqual(answer.recommendations.map(v => v._id).sort(), testCase.ids.map(id => id.toString(16).padStart(24, "0")).sort(), testCase.message);
      for (const card of answer.recommendations) {
        const stored = inventory.find(v => v._id === card._id);
        assert.equal(stored.availabilityStatus, "available");
        assert.ok(!stored.locked && !stored.bookingReservationId);
        assert.equal(card.seats, stored.specs.seats);
        assert.equal(card.pricingUnit, stored.pricingUnit);
        assert.equal(stored.pricingUnit === "daily" ? card.dailyRate : card.hourlyRate, stored.dailyRentalRate);
        if (testCase.entities?.brand) {
          assert.equal(card.brand, testCase.entities.brand);
          assert.ok(lower(stored.name).startsWith(lower(testCase.entities.brand) + " "));
        }
        if (testCase.entities?.model) assert.equal(lower(stored.name), lower(`${testCase.entities.brand} ${testCase.entities.model}`));
        if (testCase.entities?.category) assert.equal(["car", "truck"].includes(testCase.entities.category) ? card.category : card.type, testCase.entities.category);
        if (testCase.entities?.vehicle_subtype) assert.equal(lower(stored.specs.subType), testCase.entities.vehicle_subtype);
        if (testCase.entities?.pax) assert.ok(testCase.entities.seat_match === "exact" ? stored.specs.seats === testCase.entities.pax : stored.specs.seats >= testCase.entities.pax);
        for (const field of ["fuel", "transmission"]) if (testCase.entities?.[field]) assert.equal(lower(stored.specs[field]), testCase.entities[field]);
      }
      if (testCase.reply) assert.match(answer.reply, new RegExp(testCase.reply, "i"));
      context = answer.conversation_context;
    }
  } else {
    for (const [message, fields] of cases) verify(await post(message), fields);
    let context = (await post("Show automatic SUVs")).conversation_context;
    verify(await post("Only 5 seaters", context), { category: "suv", transmission: "automatic", pax: 5, seat_match: "exact" });
    context = (await post("How do I book?", context)).conversation_context;
    const diesel = await post("Do you have diesel vehicles?", context);
    verify(diesel, { fuel: "diesel" });
    for (const stale of ["category", "pax", "transmission"]) assert.equal(diesel.entities[stale], undefined);
    const reset = await post("Start a new conversation", diesel.conversation_context);
    assert.equal(reset.conversation_context, null);
    verify(await post("Do you have 5 seaters?", reset.conversation_context), { pax: 5, seat_match: "exact" });
  }
  console.log(JSON.stringify({ mode: live ? "real localhost inventory" : "isolated HTTP inventory with real Python classification", passedRequests: records.length, records }));
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
