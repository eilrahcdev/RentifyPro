import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Vehicle from "../models/Vehicle.js";
import Booking from "../models/Booking.js";

const listen = async (app) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
};

const close = async (server) => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
};

test("compound vehicle questions use current records once and validate follow-up context", async () => {
  const original = { find: Vehicle.find, distinct: Booking.distinct, url: process.env.CHATBOT_URL, autostart: process.env.CHATBOT_SERVICE_AUTOSTART };
  const seen = [];
  let queries = 0;
  let available = true;
  Vehicle.find = () => {
    queries += 1;
    return { select: () => ({ lean: async () => [
      { _id: "vios", name: "Toyota Vios", location: "Cebu City", availabilityStatus: available ? "available" : "unavailable",
        dailyRentalRate: 2400, pricingUnit: "daily", specs: { type: "sedan", seats: 5, transmission: "Automatic" } },
    ] }) };
  };
  Booking.distinct = async () => [];
  const classifier = express();
  classifier.use(express.json());
  classifier.get("/", (_req, res) => res.json({ status: "ok" }));
  classifier.post("/chat", (req, res) => {
    seen.push(req.body);
    res.json({ intent: "rental_rate", confidence: 0.99, language: "en",
      entities: { brand: "Toyota", model: "Vios", rate_unit: "day", location: "cebu" }, conditions: {},
      ...(req.body.message === "combined" ? { additional_answers: [
        { intent: "payment_downpayment", confidence: 0.99, language: "en", entities: {}, conditions: { downpayment_percent: 30 } },
        { intent: "payment_methods", confidence: 0.99, language: "en", entities: {}, conditions: {} },
      ] } : {}) });
  });
  let apiServer;
  let classifierServer;
  try {
    classifierServer = await listen(classifier);
    process.env.CHATBOT_URL = `http://127.0.0.1:${classifierServer.address().port}`;
    process.env.CHATBOT_SERVICE_AUTOSTART = "false";
    const { default: chatRoutes } = await import("../routes/chat.routes.js");
    const api = express();
    api.use(express.json());
    api.use("/api/chat", chatRoutes);
    apiServer = await listen(api);
    const post = async (body) => {
      const response = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/chat`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const combined = await post({ message: "combined" });
    assert.match(combined.reply, /PHP 2,400/);
    assert.match(combined.reply, /30%/);
    assert.match(combined.reply, /GCash/);
    assert.equal(combined.additional_answers.length, 2);
    assert.equal(queries, 1);
    assert.equal(combined.conversation_context.entities.location, "cebu");
    assert.doesNotMatch(JSON.stringify(combined.conversation_context), /dailyRate|displayRate/);
    available = false;
    const followup = await post({ message: "same one", conversationContext: combined.conversation_context });
    assert.deepEqual(seen[1].previous_context, combined.conversation_context);
    assert.deepEqual(followup.recommendations, []);
    assert.equal(queries, 2, "a follow-up must retrieve current records again");
    await post({ message: "same one", conversationContext: { ...combined.conversation_context, renterId: "other" } });
    assert.equal(seen[2].previous_context, null);
  } finally {
    Vehicle.find = original.find;
    Booking.distinct = original.distinct;
    for (const [name, value] of [["CHATBOT_URL", original.url], ["CHATBOT_SERVICE_AUTOSTART", original.autostart]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (apiServer) await close(apiServer);
    if (classifierServer) await close(classifierServer);
  }
});

test("chat route preserves a missing-unit clarification and fulfills its short follow-up", async () => {
  const seen = [];
  const classifier = express();
  classifier.use(express.json());
  classifier.get("/", (_req, res) => res.json({ status: "ok" }));
  classifier.post("/chat", (req, res) => {
    seen.push(req.body);
    const hasUnit = req.body.message === "per day";
    const entities = { brand: null, model: null, category: "suv", max_budget: 2000,
      currency: "PHP", ...(hasUnit ? { rate_unit: "day" } : {}) };
    res.json({ intent: "available_vehicles", confidence: 0.995, language: hasUnit ? "taglish" : "en",
      entities, conditions: {}, alternatives: [],
      requires_clarification: !hasUnit,
      clarification: { required: !hasUnit, type: hasUnit ? null : "missing_entity", field: hasUnit ? null : "rate_unit" },
      reply: hasUnit ? "" : "Is your PHP 2,000 budget per day or per hour?" });
  });
  const classifierServer = await listen(classifier);
  process.env.CHATBOT_URL = `http://127.0.0.1:${classifierServer.address().port}`;
  process.env.CHATBOT_SERVICE_AUTOSTART = "false";

  const previousFind = Vehicle.find;
  const previousDistinct = Booking.distinct;
  let vehicleQueries = 0;
  Vehicle.find = () => {
    vehicleQueries += 1;
    return { select: () => ({ lean: async () => [
      { _id: "everest", name: "Ford Everest", dailyRentalRate: 1800, pricingUnit: "daily", availabilityStatus: "available", specs: { type: "suv", seats: 7 } },
      { _id: "fortuner", name: "Toyota Fortuner", dailyRentalRate: 2500, pricingUnit: "daily", availabilityStatus: "available", specs: { type: "suv", seats: 7 } },
    ] }) };
  };
  Booking.distinct = async () => [];

  let apiServer;
  try {
    const { default: chatRoutes } = await import("../routes/chat.routes.js");
    const api = express();
    api.use(express.json());
    api.use("/api/chat", chatRoutes);
    apiServer = await listen(api);
    const url = `http://127.0.0.1:${apiServer.address().port}/api/chat`;
    const post = async (body) => {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body) });
      assert.equal(response.status, 200);
      return response.json();
    };

    const first = await post({ message: "Are there SUVs under ₱2,000?", language: "auto" });
    assert.equal(first.intent, "available_vehicles");
    assert.equal(first.clarification.field, "rate_unit");
    assert.equal(vehicleQueries, 0, "missing rate unit must not trigger a listing query");
    assert.equal(seen[0].language, "auto");

    const second = await post({ message: "per day", language: "auto", previousLanguage: "taglish",
      pendingSearch: first.entities });
    assert.deepEqual(seen[1].previous_context, first.entities);
    assert.equal(seen[1].previous_language, "taglish");
    assert.equal(second.language, "taglish");
    assert.deepEqual(second.recommendations.map((vehicle) => vehicle._id), ["everest"]);
    assert.match(second.reply, /PHP 2,000 per day/);
    assert.equal(vehicleQueries, 1);
  } finally {
    Vehicle.find = previousFind;
    Booking.distinct = previousDistinct;
    if (apiServer) await close(apiServer);
    await close(classifierServer);
  }
});

test("chat route checks public unavailable status and booking locks without recommending unavailable units", async () => {
  const original = { find: Vehicle.find, distinct: Booking.distinct,
    url: process.env.CHATBOT_URL, autostart: process.env.CHATBOT_SERVICE_AUTOSTART };
  const records = [
    { _id: "city", name: "Honda City", availabilityStatus: "unavailable", specs: { type: "sedan" } },
    { _id: "vios", name: "Toyota Vios", availabilityStatus: "available", specs: { type: "sedan" } },
    { _id: "everest", name: "Ford Everest", availabilityStatus: "available", specs: { type: "suv" } },
    { _id: "civic-1", name: "Honda Civic", availabilityStatus: "available" },
    { _id: "civic-2", name: "Honda Civic", availabilityStatus: "unavailable" },
  ];
  const queries = [];
  let failLookup = false;
  Vehicle.find = (query) => {
    queries.push(query);
    return { select: (fields) => {
      assert.doesNotMatch(fields, /owner|plateNumber|availabilityHoldReason/);
      return { lean: async () => {
        if (failLookup) throw new Error("fixture lookup failure");
        return query.availabilityStatus ? records.filter((vehicle) => vehicle.availabilityStatus === query.availabilityStatus) : records;
      } };
    } };
  };
  Booking.distinct = async (field, query) => {
    assert.equal(field, "vehicle");
    assert.equal(query.actualReturnAt, null);
    assert.deepEqual(query.status.$in, ["pending", "confirmed", "extended"]);
    return ["everest"];
  };
  const classifier = express();
  classifier.use(express.json());
  classifier.get("/", (_req, res) => res.json({ status: "ok" }));
  const cases = {
    "Why are unavailable cars hidden?": { intent: "vehicle_unavailability" },
    "Show unavailable cars": { topic: "vehicles", conditions: { vehicle_status_overview: true,
      vehicle_status_list: true, vehicle_status_unavailable: true } },
    "Is Honda City unavailable?": { entities: { brand: "Honda", model: "City" } },
    "Is Toyota Vios unavailable?": { entities: { brand: "Toyota", model: "Vios" } },
    "Is Ford Everest unavailable?": { entities: { brand: "Ford", model: "Everest" } },
    "Is Nissan Almera unavailable?": { entities: { brand: "Nissan", model: "Almera" } },
    "Is Honda Civic unavailable?": { entities: { brand: "Honda", model: "Civic" } },
    "Are there unavailable vehicles?": { conditions: { vehicle_status_overview: true } },
    "When will the unavailable car be available again?": { requires_clarification: true,
      clarification: { required: true, type: "missing_entity", field: "model" }, reply: "Which vehicle or listing do you mean?" },
    "Show available Ford vehicles": { intent: "vehicle_brand_search", entities: { brand: "Ford", model: null } },
    "Malformed classifier": { conditions: { vehicle_status_overview: "yes" } },
    "Missing status reference": {},
  };
  classifier.post("/chat", (req, res) => res.json({
    intent: "vehicle_availability_status", confidence: 0.99, language: "en",
    entities: { brand: null, model: null }, ...cases[req.body.message],
  }));
  let apiServer;
  let classifierServer;
  try {
    classifierServer = await listen(classifier);
    process.env.CHATBOT_URL = `http://127.0.0.1:${classifierServer.address().port}`;
    process.env.CHATBOT_SERVICE_AUTOSTART = "false";
    const { default: chatRoutes } = await import("../routes/chat.routes.js");
    const api = express();
    api.use(express.json());
    api.use("/api/chat", chatRoutes);
    api.use((_error, _req, res, _next) => res.status(503).json({ message: "Availability lookup failed." }));
    apiServer = await listen(api);
    const post = async (message) => {
      const response = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/chat`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }),
      });
      return { response, body: await response.json() };
    };
    const explanation = await post("Why are unavailable cars hidden?");
    assert.equal(explanation.body.intent, "vehicle_unavailability");
    assert.equal(queries.length, 0);
    assert.deepEqual(explanation.body.recommendations, []);
    const listed = await post("Show unavailable cars");
    assert.equal(listed.body.intent, "vehicle_availability_status");
    assert.equal(listed.response.headers.get("cache-control"), "no-store");
    assert.match(listed.body.reply, /Ford Everest \(unavailable\)/);
    assert.match(listed.body.reply, /Honda City \(unavailable\)/);
    assert.doesNotMatch(listed.body.reply, /Toyota Vios/);
    assert.deepEqual(listed.body.recommendations, []);
    assert.equal(listed.body.conversation_context.conditions.vehicle_status_list, true);
    for (const [message, reason] of [
      ["Is Honda City unavailable?", "vehicle_status_unavailable"],
      ["Is Toyota Vios unavailable?", "vehicle_status_available"],
      ["Is Ford Everest unavailable?", "vehicle_status_unavailable"],
      ["Is Nissan Almera unavailable?", "vehicle_status_not_found"],
      ["Is Honda Civic unavailable?", "ambiguous_vehicle_listing"],
    ]) {
      const { response, body } = await post(message);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(body.reason_code, reason);
      assert.deepEqual(body.recommendations, []);
    }
    const overview = await post("Are there unavailable vehicles?");
    assert.match(overview.body.reply, /3 currently unavailable and 2 available/);
    assert.equal(queries.every((query) => Object.keys(query).length === 0), true);
    const queryCount = queries.length;
    const missingVehicle = await post("When will the unavailable car be available again?");
    assert.equal(missingVehicle.body.clarification.field, "model");
    assert.equal(queries.length, queryCount);
    const malformed = await post("Malformed classifier");
    assert.equal(malformed.body.reason_code, "malformed_classifier");
    assert.equal(queries.length, queryCount);
    const missingReference = await post("Missing status reference");
    assert.equal(missingReference.body.clarification.field, "model");
    assert.equal(queries.length, queryCount);
    const search = await post("Show available Ford vehicles");
    assert.deepEqual(queries.at(-1), { availabilityStatus: "available" });
    assert.deepEqual(search.body.recommendations, []);
    assert.match(search.body.reply, /couldn't find any available/);
    failLookup = true;
    const failed = await post("Is Honda City unavailable?");
    assert.equal(failed.response.status, 503);
    assert.doesNotMatch(JSON.stringify(failed.body), /currently unavailable|private|fixture lookup/);
  } finally {
    Vehicle.find = original.find;
    Booking.distinct = original.distinct;
    if (original.url === undefined) delete process.env.CHATBOT_URL; else process.env.CHATBOT_URL = original.url;
    if (original.autostart === undefined) delete process.env.CHATBOT_SERVICE_AUTOSTART; else process.env.CHATBOT_SERVICE_AUTOSTART = original.autostart;
    if (apiServer) await close(apiServer);
    if (classifierServer) await close(classifierServer);
  }
});
