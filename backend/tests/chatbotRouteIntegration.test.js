import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Vehicle from "../models/Vehicle.js";
import Booking from "../models/Booking.js";
import { rentalVehicles } from "./fixtures/chatbotRentalVehicles.js";
import { specificationVehicles } from "./fixtures/chatbotSpecificationVehicles.js";

const serviceKey = "chatbot-integration-fixture-secret-32-chars";
process.env.INTERNAL_API_KEY = serviceKey;
process.env.CHATBOT_INTERNAL_API_KEY = serviceKey;
const requireServiceKey = (req, res, next) => req.get("x-internal-key") === serviceKey
  ? next() : res.status(403).json({ detail: "Service access denied." });

const listen = async (app) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
};

const close = async (server) => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
};

test("HTTP exact-seat and listing-specification contracts use fresh public records and booking locks", async () => {
  const original = { find: Vehicle.find, distinct: Booking.distinct,
    url: process.env.CHATBOT_URL, autostart: process.env.CHATBOT_SERVICE_AUTOSTART };
  let locked = false;
  const selected = specificationVehicles.find(v => v.name === "Ford Ranger");
  Vehicle.find = query => {
    return { select: projection => {
      if (projection === "name brand model specs.type specs.subType") {
        assert.deepEqual(query, {});
        return { lean: async () => specificationVehicles };
      }
      assert.deepEqual(query, { availabilityStatus: "available" });
      assert.match(projection, /specs\.seats/);
      assert.match(projection, /specs\.fuel/);
      assert.doesNotMatch(projection, /plateNumber|owner\.email|owner\.phone/);
      return { lean: async () => specificationVehicles.filter(v => v.availabilityStatus === "available") };
    } };
  };
  Booking.distinct = async () => locked ? [selected._id] : [];
  const classifier = express(); classifier.use(express.json()); classifier.use("/chat", requireServiceKey);
  classifier.get("/health", (_req, res) => res.json({ status: "ok" }));
  classifier.post("/chat", (req, res) => res.json({ intent: "available_vehicles", confidence: .99,
    language: "en", topic: "vehicles", conditions: {}, entities: req.body.message === "specification"
      ? { listing_id: selected._id, specification_requested: "fuel" } : { pax: 5, seat_match: "exact" } }));
  let classifierServer, apiServer;
  try {
    classifierServer = await listen(classifier);
    process.env.CHATBOT_URL = `http://127.0.0.1:${classifierServer.address().port}`;
    process.env.CHATBOT_SERVICE_AUTOSTART = "false";
    const { default: chatRoutes } = await import("../routes/chat.routes.js");
    const api = express(); api.use(express.json()); api.use("/api/chat", chatRoutes);
    apiServer = await listen(api);
    const post = async message => {
      const response = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/chat`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const exact = await post("seats");
    assert.equal(exact.entities.seat_match, "exact");
    assert.deepEqual(exact.recommendations.map(v => v.name).sort(), ["Ford Ranger", "Toyota Vios"]);
    assert.ok(exact.recommendations.every(v => v.seats === 5));
    assert.match(exact.reply, /exactly 5/);
    const detail = await post("specification");
    assert.match(detail.reply, /Ford Ranger.*diesel/);
    assert.equal(detail.recommendations[0]._id, selected._id);
    assert.ok(detail.recommendations[0].displayRate > 0);
    locked = true;
    const next = await post("specification");
    assert.deepEqual(next.recommendations, []);
    assert.equal(next.requires_clarification, true);
    assert.doesNotMatch(next.reply, /fuel: diesel/);
  } finally {
    Vehicle.find = original.find; Booking.distinct = original.distinct;
    for (const [name, value] of [["CHATBOT_URL", original.url], ["CHATBOT_SERVICE_AUTOSTART", original.autostart]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (apiServer) await close(apiServer);
    if (classifierServer) await close(classifierServer);
  }
});

test("HTTP specification searches select public fuel and driver fields and preserve booking locks", async () => {
  const original = { find: Vehicle.find, distinct: Booking.distinct,
    url: process.env.CHATBOT_URL, autostart: process.env.CHATBOT_SERVICE_AUTOSTART };
  let locked = false;
  Vehicle.find = query => {
    return { select: projection => {
      if (projection === "name brand model specs.type specs.subType") {
        assert.deepEqual(query, {});
        return { lean: async () => specificationVehicles };
      }
      assert.deepEqual(query, { availabilityStatus: "available" });
      assert.match(projection, /specs\.fuel/);
      assert.match(projection, /driverOptionEnabled/);
      assert.doesNotMatch(projection, /plateNumber|owner\.email|owner\.phone/);
      return { lean: async () => specificationVehicles.filter(v => v.availabilityStatus === "available") };
    } };
  };
  Booking.distinct = async (_field, query) => {
    assert.deepEqual(query.status, { $in: ["pending", "confirmed", "extended"] });
    return locked ? [specificationVehicles.find(v => v.name === "Ford Transit")._id] : [];
  };
  const classifier = express(); classifier.use(express.json()); classifier.use("/chat", requireServiceKey);
  classifier.get("/health", (_req, res) => res.json({ status: "ok" }));
  classifier.post("/chat", (req, res) => res.json({ intent: "available_vehicles", confidence: 0.99,
    language: "en", topic: "vehicles", conditions: {}, entities: req.body.message === "driver"
      ? { category: "car", driver_requested: true } : req.body.message === "fuel"
      ? { category: "motorcycle", fuel: "gasoline", vehicle_subtype: "kuliglig" } : { pax: 18 } }));
  let classifierServer, apiServer;
  try {
    classifierServer = await listen(classifier);
    process.env.CHATBOT_URL = `http://127.0.0.1:${classifierServer.address().port}`;
    process.env.CHATBOT_SERVICE_AUTOSTART = "false";
    const { default: chatRoutes } = await import("../routes/chat.routes.js");
    const api = express(); api.use(express.json()); api.use("/api/chat", chatRoutes);
    apiServer = await listen(api);
    const post = async message => {
      const response = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/chat`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    for (const [message, expected] of [["seats", "Ford Transit"], ["driver", "Ford Everest"], ["fuel", "Honda Kuliglig"]]) {
      const result = await post(message);
      assert.deepEqual(result.recommendations.map(v => v.name), [expected]);
      assert.doesNotMatch(JSON.stringify(result), /FIX-123|private-fixture/);
    }
    locked = true;
    const noMatch = await post("seats");
    assert.deepEqual(noMatch.recommendations, []);
    assert.match(noMatch.reply, /18-seat minimum/);
  } finally {
    Vehicle.find = original.find; Booking.distinct = original.distinct;
    for (const [name, value] of [["CHATBOT_URL", original.url], ["CHATBOT_SERVICE_AUTOSTART", original.autostart]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (apiServer) await close(apiServer);
    if (classifierServer) await close(classifierServer);
  }
});

test("HTTP search explanations refresh public inventory and preserve the search filters", async () => {
  const original = { find: Vehicle.find, distinct: Booking.distinct,
    url: process.env.CHATBOT_URL, autostart: process.env.CHATBOT_SERVICE_AUTOSTART };
  const seen = [];
  let inventoryReads = 0;
  Vehicle.find = query => {
    assert.deepEqual(query, Object.keys(query).length ? { availabilityStatus: "available" } : {});
    inventoryReads++;
    return { select: () => ({ lean: async () => rentalVehicles
      .filter(vehicle => vehicle.availabilityStatus === "available")
      .map(vehicle => ({ ...vehicle, specs: { ...vehicle.specs, transmission: "Automatic" } })) }) };
  };
  Booking.distinct = async () => [];
  const classifier = express(); classifier.use(express.json()); classifier.use("/chat", requireServiceKey);
  classifier.get("/health", (_req, res) => res.json({ status: "ok" }));
  classifier.post("/chat", (req, res) => {
    if (!req.body.inventory_vocabulary) seen.push(req.body.previous_context);
    res.json({ intent: "available_transmission", confidence: 0.99, language: "en", topic: "vehicles",
      entities: { category: "car", transmission: "manual" }, conditions: {},
      ...(req.body.message === "search" ? {} : { requested_answer_type: "explanation" }) });
  });
  let classifierServer, apiServer;
  try {
    classifierServer = await listen(classifier);
    process.env.CHATBOT_URL = `http://127.0.0.1:${classifierServer.address().port}`;
    process.env.CHATBOT_SERVICE_AUTOSTART = "false";
    const { default: chatRoutes } = await import("../routes/chat.routes.js");
    const api = express(); api.use(express.json()); api.use("/api/chat", chatRoutes);
    apiServer = await listen(api);
    const post = async (message, conversationContext) => {
      const response = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/chat`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, conversationContext }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      return response.json();
    };
    const first = await post("search");
    const explanation = await post("Huh?", first.conversation_context);
    const why = await post("Why couldn't you find any?", explanation.conversation_context);
    assert.equal(inventoryReads, 6);
    assert.deepEqual(seen[1], first.conversation_context);
    assert.deepEqual(seen[2], explanation.conversation_context);
    assert.deepEqual(explanation.entities, first.entities);
    assert.deepEqual(why.entities, first.entities);
    assert.deepEqual(why.recommendations, []);
    assert.notEqual(explanation.reply, first.reply);
    assert.notEqual(why.reply, explanation.reply);
    assert.match(why.reply, /manual transmission/);
    assert.equal(why.conversation_context.requested_answer_type, "explanation");
  } finally {
    Vehicle.find = original.find; Booking.distinct = original.distinct;
    for (const [name, value] of [["CHATBOT_URL", original.url], ["CHATBOT_SERVICE_AUTOSTART", original.autostart]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (apiServer) await close(apiServer);
    if (classifierServer) await close(classifierServer);
  }
});

test("actual vehicle search excludes unavailable listings, booking locks and pending reservation locks", async () => {
  const original = { find: Vehicle.find, distinct: Booking.distinct,
    url: process.env.CHATBOT_URL, autostart: process.env.CHATBOT_SERVICE_AUTOSTART };
  const seen = [];
  Vehicle.find = query => {
    assert.deepEqual(query, Object.keys(query).length ? { availabilityStatus: "available" } : {});
    return { select: () => ({ lean: async () => rentalVehicles
      .filter(vehicle => vehicle.availabilityStatus === "available")
      .map(vehicle => vehicle.name === "Toyota Fortuner"
        ? { ...vehicle, bookingReservationId: "fixture-reservation" } : vehicle) }) };
  };
  Booking.distinct = async (field, query) => {
    assert.equal(field, "vehicle");
    assert.equal(query.actualReturnAt, null);
    assert.deepEqual(query.status, { $in: ["pending", "confirmed", "extended"] });
    seen.push(query);
    return [rentalVehicles[1]._id];
  };
  const classifier = express(); classifier.use(express.json()); classifier.use("/chat", requireServiceKey);
  classifier.get("/health", (_req, res) => res.json({ status: "ok" }));
  classifier.post("/chat", (_req, res) => res.json({ intent: "available_vehicles", confidence: 0.99,
    language: "en", topic: "vehicles", entities: { category: "car" }, conditions: {} }));
  let classifierServer, apiServer;
  try {
    classifierServer = await listen(classifier);
    process.env.CHATBOT_URL = `http://127.0.0.1:${classifierServer.address().port}`;
    process.env.CHATBOT_SERVICE_AUTOSTART = "false";
    const { default: chatRoutes } = await import("../routes/chat.routes.js");
    const api = express(); api.use(express.json()); api.use("/api/chat", chatRoutes);
    apiServer = await listen(api);
    const response = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Show available cars" }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.recommendations.map(v => v.name), ["Toyota Vios"]);
    assert.doesNotMatch(result.reply, /Ford Everest|Toyota Fortuner|Toyota Camry/);
    assert.deepEqual(result.conversation_context.choices, [{ brand: "Toyota", model: "Vios", listing_id: rentalVehicles[0]._id }]);
    assert.equal(seen.length, 1);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    Vehicle.find = original.find; Booking.distinct = original.distinct;
    for (const [name, value] of [["CHATBOT_URL", original.url], ["CHATBOT_SERVICE_AUTOSTART", original.autostart]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (apiServer) await close(apiServer);
    if (classifierServer) await close(classifierServer);
  }
});

test("HTTP repair metadata is canonical, survives follow-up context, and procedural browsing does not read inventory", async () => {
  const original = { find:Vehicle.find, bookingFind:Booking.find, url:process.env.CHATBOT_URL, autostart:process.env.CHATBOT_SERVICE_AUTOSTART };
  Vehicle.find = () => { throw new Error("Procedural answers must not fetch inventory"); };
  Booking.find = () => { throw new Error("Procedural answers must not fetch private bookings"); };
  const seen=[];
  const classifier=express(); classifier.use(express.json()); classifier.use("/chat",requireServiceKey);
  classifier.get("/health",(_req,res)=>res.json({status:"ok"}));
  classifier.post("/chat",(req,res)=>{
    if (!req.body.inventory_vocabulary) seen.push(req.body.previous_context);
    const variant=req.body.message==="I asked how"?"instructions_detail":req.body.message==="where"?"navigation":"instructions";
    res.json({intent:req.body.message==="browse"?"available_vehicles":"messaging",topic:req.body.message==="browse"?"vehicles":"support",confidence:0.99,language:"fil",
      response_variant:variant,requested_answer_type:req.body.message==="invalid"?"approved":variant==="navigation"?"navigation":"instructions",
      entities:{},conditions:{},reply:"Your private conversation has been sent automatically."});
  });
  let classifierServer;
  let apiServer;
  try {
    classifierServer=await listen(classifier); process.env.CHATBOT_URL=`http://127.0.0.1:${classifierServer.address().port}`; process.env.CHATBOT_SERVICE_AUTOSTART="false";
    const {default:chatRoutes}=await import("../routes/chat.routes.js");
    const api=express(); api.use(express.json()); api.use("/api/chat",chatRoutes); apiServer=await listen(api);
    const post=async(message,conversationContext=null)=>(await fetch(`http://127.0.0.1:${apiServer.address().port}/api/chat`,{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message,conversationContext})})).json();
    const initial=await post("how");
    assert.equal(initial.requested_answer_type,"instructions"); assert.match(initial.reply,/Mag-sign in.*Chat Owner.*Send message/);
    const repaired=await post("I asked how",initial.conversation_context);
    assert.deepEqual(seen.at(-1),initial.conversation_context);
    assert.equal(repaired.conversation_context.response_variant,"instructions_detail");
    assert.equal(repaired.conversation_context.requested_answer_type,"instructions");
    assert.doesNotMatch(repaired.reply,/sent automatically/);
    const navigation=await post("where",repaired.conversation_context);
    assert.equal(navigation.response_variant,"navigation"); assert.equal(navigation.requested_answer_type,"navigation");
    const browse=await post("browse",navigation.conversation_context);
    assert.equal(browse.intent,"available_vehicles"); assert.equal(browse.requires_live_data,false); assert.deepEqual(browse.recommendations,[]);
    assert.match(browse.reply,/Buksan ang Vehicles/);
    const invalid=await post("invalid"); assert.equal(invalid.reason_code,"malformed_classifier");
  } finally {
    Vehicle.find=original.find; Booking.find=original.bookingFind;
    for(const [name,value] of [["CHATBOT_URL",original.url],["CHATBOT_SERVICE_AUTOSTART",original.autostart]]) {
      if(value===undefined) delete process.env[name]; else process.env[name]=value;
    }
    if(apiServer) await close(apiServer); if(classifierServer) await close(classifierServer);
  }
});

test("public approval timing and rejection guidance survives HTTP while personal status still requires a renter session", async () => {
  const original = { find: Vehicle.find, bookingFind: Booking.find,
    url: process.env.CHATBOT_URL, autostart: process.env.CHATBOT_SERVICE_AUTOSTART };
  Vehicle.find = () => { throw new Error("Public booking guidance must not read vehicles"); };
  Booking.find = () => { throw new Error("Public guidance and guests must not read private bookings"); };
  const classifier = express();
  classifier.use(express.json());
  classifier.use("/chat", requireServiceKey);
  classifier.get("/health", (_req,res) => res.json({status:"ok"}));
  classifier.post("/chat", (req,res) => res.json({intent:"booking_status",topic:"booking",confidence:0.99,language:"en",
    entities:{},conditions:{},reply:"The owner approved your booking and refunded you.",
    ...(req.body.message === "my booking status" ? {} : {response_variant:req.body.message === "approval timing" ? "approval_timing" : "rejection"}) }));
  let classifierServer;
  let apiServer;
  try {
    classifierServer = await listen(classifier);
    process.env.CHATBOT_URL = `http://127.0.0.1:${classifierServer.address().port}`;
    process.env.CHATBOT_SERVICE_AUTOSTART = "false";
    const {default:chatRoutes} = await import("../routes/chat.routes.js");
    const api = express(); api.use(express.json()); api.use("/api/chat",chatRoutes);
    apiServer = await listen(api);
    const post = async (message) => (await fetch(`http://127.0.0.1:${apiServer.address().port}/api/chat`,{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message})})).json();
    const timing = await post("approval timing");
    assert.match(timing.reply,/cannot promise a turnaround time/);
    assert.equal(timing.conversation_context.response_variant,"approval_timing");
    const rejected = await post("owner rejected my paid booking");
    assert.match(rejected.reply,/Check payment status.*Report issue/);
    assert.doesNotMatch(rejected.reply,/approved your booking|refunded you|Please sign in/);
    const status = await post("my booking status");
    assert.equal(status.reason_code,"authentication_required");
    assert.match(status.reply,/Please sign in/);
  } finally {
    Vehicle.find = original.find; Booking.find = original.bookingFind;
    for (const [name,value] of [["CHATBOT_URL",original.url],["CHATBOT_SERVICE_AUTOSTART",original.autostart]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (apiServer) await close(apiServer);
    if (classifierServer) await close(classifierServer);
  }
});

test("HTTP schedules filter overlap conflicts per answer without relaxing unreturned vehicle locks", async () => {
  const original = {find:Vehicle.find, distinct:Booking.distinct,
    url:process.env.CHATBOT_URL, autostart:process.env.CHATBOT_SERVICE_AUTOSTART};
  const filters = [];
  Vehicle.find = () => ({select:()=>({lean:async()=>[rentalVehicles[1]]})});
  Booking.distinct = async (_field,filter) => {
    filters.push(filter);
    if (filter.actualReturnAt === null) return [];
    return filter.pickupAt.$lt.toISOString().startsWith("2026-10-16") ? [rentalVehicles[1]._id] : [];
  };
  const classifier = express(); classifier.use(express.json()); classifier.use("/chat",requireServiceKey);
  classifier.get("/health",(_req,res)=>res.json({status:"ok"}));
  classifier.post("/chat",(_req,res)=>res.json({intent:"rental_rate",confidence:0.99,language:"en",topic:"vehicles",
    entities:{brand:"Ford",model:"Everest",quote_requested:true,requested_date:"2026-10-15",requested_return_date:"2026-10-16",pickup_time:"09:00",return_time:"09:00"},
    additional_answers:[{intent:"rental_rate",confidence:0.99,language:"en",topic:"vehicles",
      entities:{brand:"Ford",model:"Everest",quote_requested:true,requested_date:"2026-10-18",requested_return_date:"2026-10-19",pickup_time:"09:00",return_time:"09:00"}}]}));
  let classifierServer;
  let apiServer;
  try {
    classifierServer = await listen(classifier);
    process.env.CHATBOT_URL = `http://127.0.0.1:${classifierServer.address().port}`;
    process.env.CHATBOT_SERVICE_AUTOSTART = "false";
    const {default:chatRoutes} = await import("../routes/chat.routes.js");
    const api = express(); api.use(express.json()); api.use("/api/chat",chatRoutes); apiServer = await listen(api);
    const response = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/chat`,{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"two schedules"})});
    const result = await response.json();
    assert.equal(response.status,200);
    assert.equal(response.headers.get("cache-control"),"no-store");
    assert.equal(filters.length,3);
    assert.equal(filters[0].actualReturnAt,null);
    for (const filter of filters) assert.deepEqual(filter.status.$in,["pending","confirmed","extended"]);
    assert.equal(filters[1].returnAt.$gt.toISOString(),"2026-10-15T01:00:00.000Z");
    assert.equal(result.quote,undefined);
    assert.equal(result.additional_answers[0].quote.rentalSubtotal,1800);
    assert.match(result.reply,/not confirmed.*pickup.*return/);
    assert.doesNotMatch(JSON.stringify(result),/bookingReservationId|renterId/);
  } finally {
    Vehicle.find = original.find; Booking.distinct = original.distinct;
    for (const [name,value] of [["CHATBOT_URL",original.url],["CHATBOT_SERVICE_AUTOSTART",original.autostart]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (apiServer) await close(apiServer);
    if (classifierServer) await close(classifierServer);
  }
});

test("policy answer variants survive the HTTP response and validated follow-up context", async () => {
  const original = { find: Vehicle.find, bookingFind: Booking.find,
    url: process.env.CHATBOT_URL, autostart: process.env.CHATBOT_SERVICE_AUTOSTART };
  const seen = [];
  Vehicle.find = () => { throw new Error("A policy answer must not read vehicle inventory"); };
  Booking.find = () => { throw new Error("A policy answer must not read private bookings"); };
  const classifier = express();
  classifier.use("/chat", requireServiceKey);
  classifier.use(express.json());
  classifier.get("/health", (_req, res) => res.json({ status: "ok" }));
  classifier.post("/chat", (req, res) => {
    if (!req.body.inventory_vocabulary) seen.push(req.body.previous_context);
    res.json({ intent: "walk_in_payment", confidence: 0.99, language: "en", topic: "payment",
      response_variant: req.body.message === "invalid" ? "approved_automatically" : req.body.message === "How do I request it?" ? "instructions" : "overview",
      reply: "Your cash payment was approved and received.", entities: {}, conditions: {} });
  });
  let classifierServer;
  let apiServer;
  try {
    classifierServer = await listen(classifier);
    process.env.CHATBOT_URL = `http://127.0.0.1:${classifierServer.address().port}`;
    process.env.CHATBOT_SERVICE_AUTOSTART = "false";
    const { default: chatRoutes } = await import("../routes/chat.routes.js");
    const api = express();
    api.use(express.json());
    api.use("/api/chat", chatRoutes);
    apiServer = await listen(api);
    const post = async (message, conversationContext) => {
      const response = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/chat`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, conversationContext }) });
      assert.equal(response.status, 200);
      return response.json();
    };
    const overview = await post("Is there a walk-in payment?");
    assert.match(overview.reply, /^Yes,.*remaining rental balance.*down payment is recorded/);
    assert.equal(overview.conversation_context.response_variant, "overview");
    const instructions = await post("How do I request it?", overview.conversation_context);
    assert.deepEqual(seen[1], overview.conversation_context);
    assert.equal(instructions.response_variant, "instructions");
    assert.equal(instructions.conversation_context.response_variant, "instructions");
    assert.match(instructions.reply, /Pay Remaining.*Request Walk-in Payment.*Request Walk-in Approval/);
    assert.doesNotMatch(instructions.reply, /Your cash payment was approved and received/);
    assert.deepEqual(instructions.recommendations, []);
    const invalid = await post("invalid");
    assert.equal(invalid.reason_code, "malformed_classifier");
    assert.doesNotMatch(invalid.reply, /approved and received/);
  } finally {
    Vehicle.find = original.find;
    Booking.find = original.bookingFind;
    for (const [name, value] of [["CHATBOT_URL", original.url], ["CHATBOT_SERVICE_AUTOSTART", original.autostart]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (apiServer) await close(apiServer);
    if (classifierServer) await close(classifierServer);
  }
});

test("HTTP round trips retain task through social replies and clear it on reset", async () => {
  const original = { find: Vehicle.find, bookingFind: Booking.find,
    url: process.env.CHATBOT_URL, autostart: process.env.CHATBOT_SERVICE_AUTOSTART };
  const seen = [];
  Vehicle.find = () => { throw new Error("Conversation policies must not read inventory"); };
  Booking.find = () => { throw new Error("Conversation policies must not read private records"); };
  const classifier = express();
  classifier.use("/chat", requireServiceKey);
  classifier.use(express.json());
  classifier.get("/health", (_req, res) => res.json({ status: "ok" }));
  classifier.post("/chat", (req, res) => {
    if (!req.body.inventory_vocabulary) seen.push(req.body.previous_context);
    const common = { confidence: 0.99, language: "en", entities: {}, conditions: {} };
    const message = req.body.message;
    if (message === "thanks") return res.json({ ...common, intent: "chat_gratitude", topic: "conversation" });
    if (message === "you okay?") return res.json({ ...common, intent: "chat_wellbeing", topic: "conversation", response_variant: "working", reply: "Got it." });
    if (message === "reset") return res.json({ ...common, intent: "chat_greeting", topic: "conversation", response_variant: "reset", reason_code: "conversation_reset" });
    if (message === "how?" && !req.body.previous_context) return res.json({ ...common, intent: "REJECT", requires_clarification: true,
      clarification: { required: true, type: "ambiguous_intent", field: null }, reason_code: "missing_followup_context",
      reply: "Which topic do you mean: choosing a vehicle, booking, or payment?" });
    res.json({ ...common, intent: "how_to_book", topic: "booking",
      ...(message === "and?" ? { response_variant: "continuation" } : {}),
      ...(message === "booking and thanks" ? { additional_answers: [{ ...common, intent: "chat_gratitude", topic: "conversation" }] } : {}) });
  });
  let classifierServer;
  let apiServer;
  try {
    classifierServer = await listen(classifier);
    process.env.CHATBOT_URL = `http://127.0.0.1:${classifierServer.address().port}`;
    process.env.CHATBOT_SERVICE_AUTOSTART = "false";
    const { default: chatRoutes } = await import("../routes/chat.routes.js");
    const api = express();
    api.use(express.json());
    api.use("/api/chat", chatRoutes);
    apiServer = await listen(api);
    const post = async (message, conversationContext) => {
      const response = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/chat`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, conversationContext }) });
      assert.equal(response.status, 200);
      return response.json();
    };
    const first = await post("booking and thanks");
    assert.equal(first.additional_answers[0].intent, "chat_gratitude");
    assert.equal(first.conversation_context.intent, "how_to_book");
    const gratitude = await post("thanks", first.conversation_context);
    assert.deepEqual(seen.at(-1), first.conversation_context);
    assert.equal(gratitude.intent, "chat_gratitude");
    assert.equal(gratitude.conversation_context.intent, "how_to_book");
    assert.equal(gratitude.conversation_context.idle_turns, 1);
    const wellbeing = await post("you okay?", gratitude.conversation_context);
    assert.match(wellbeing.reply, /here and ready to help/);
    assert.equal(wellbeing.conversation_context.intent, "how_to_book");
    assert.equal(wellbeing.conversation_context.idle_turns, 2);
    const continuation = await post("and?", wellbeing.conversation_context);
    assert.deepEqual(seen.at(-1), wellbeing.conversation_context);
    assert.equal(continuation.response_variant, "continuation");
    assert.match(continuation.reply, /After submitting the request.*Bookings.*owner's decision/);
    assert.equal(continuation.conversation_context.idle_turns, undefined);
    const reset = await post("reset", continuation.conversation_context);
    assert.equal(reset.conversation_context, null);
    const isolated = await post("how?", reset.conversation_context);
    assert.equal(isolated.intent, "REJECT");
    assert.match(isolated.reply, /Which topic.*booking/);
    await post("how?", { ...first.conversation_context, bookingId: "private", idle_turns: 999 });
    assert.equal(seen.at(-1), null, "invalid client context must be removed before forwarding");
  } finally {
    Vehicle.find = original.find;
    Booking.find = original.bookingFind;
    for (const [name, value] of [["CHATBOT_URL", original.url], ["CHATBOT_SERVICE_AUTOSTART", original.autostart]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (apiServer) await close(apiServer);
    if (classifierServer) await close(classifierServer);
  }
});

test("rental quotes reread rates and respect active bookings and in-flight reservations", async () => {
  const original = { find: Vehicle.find, distinct: Booking.distinct,
    url: process.env.CHATBOT_URL, autostart: process.env.CHATBOT_SERVICE_AUTOSTART };
  let rate = 1800;
  let locked = false;
  let reserved = false;
  let queries = 0;
  Vehicle.find = (query) => {
    assert.deepEqual(query, {}, "pricing must inspect public unavailable listings too");
    queries += 1;
    return { select: (fields) => {
      if (fields === "name brand model specs.type specs.subType") return { lean: async () => [rentalVehicles[1]] };
      assert.match(fields, /\+bookingReservationId/);
      assert.doesNotMatch(fields, /owner|plateNumber/);
      return { lean: async () => [{ ...rentalVehicles[1], dailyRentalRate: rate,
        ...(reserved ? { bookingReservationId: "000000000000000000000099" } : {}) }] };
    } };
  };
  Booking.distinct = async (_field, filter) => {
    assert.deepEqual(filter.status.$in, ["pending", "confirmed", "extended"]);
    assert.equal(filter.actualReturnAt, null);
    return locked ? [rentalVehicles[1]._id] : [];
  };
  const classifier = express();
  classifier.use("/chat", requireServiceKey);
  classifier.use(express.json());
  classifier.get("/health", (_req, res) => res.json({ status: "ok" }));
  classifier.post("/chat", (req, res) => res.json({ intent: "rental_rate", confidence: 0.99, language: "en",
    entities: { brand: "Ford", model: "Everest", listing_id: rentalVehicles[1]._id,
      duration_value: req.body.message === "malformed" ? "5" : 5, duration_unit: "day", quote_requested: true }, conditions: {} }));
  let classifierServer;
  let apiServer;
  try {
    classifierServer = await listen(classifier);
    process.env.CHATBOT_URL = `http://127.0.0.1:${classifierServer.address().port}`;
    process.env.CHATBOT_SERVICE_AUTOSTART = "false";
    const { default: chatRoutes } = await import("../routes/chat.routes.js");
    const api = express();
    api.use(express.json());
    api.use("/api/chat", chatRoutes);
    apiServer = await listen(api);
    const post = async (message, conversationContext) => {
      const response = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/chat`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, conversationContext }) });
      assert.equal(response.status, 200);
      if (message !== "malformed") assert.equal(response.headers.get("cache-control"), "no-store");
      return response.json();
    };
    const first = await post("quote for five days");
    assert.equal(first.quote.rentalSubtotal, 9000);
    assert.equal(first.conversation_context.entities.listing_id, rentalVehicles[1]._id);
    rate = 2000;
    const fresh = await post("same one", first.conversation_context);
    assert.equal(fresh.quote.rentalSubtotal, 9999.6);
    locked = true;
    const bookingLock = await post("same one", fresh.conversation_context);
    assert.equal(bookingLock.reason_code, "price_listing_unavailable");
    assert.deepEqual(bookingLock.recommendations, []);
    assert.equal(bookingLock.quote, undefined);
    locked = false;
    reserved = true;
    const reservation = await post("same one", fresh.conversation_context);
    assert.deepEqual(reservation.recommendations, []);
    assert.equal(reservation.quote, undefined);
    assert.doesNotMatch(JSON.stringify(reservation), /bookingReservationId|000000000000000000000099/);
    const invalid = await post("malformed");
    assert.equal(invalid.reason_code, "malformed_classifier");
    assert.equal(queries, 4, "invalid classifier data must not reach the database");
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
  classifier.use("/chat", requireServiceKey);
  classifier.use(express.json());
  classifier.get("/health", (_req, res) => res.json({ status: "ok" }));
  classifier.post("/chat", (req, res) => {
    if (!req.body.inventory_vocabulary) seen.push(req.body);
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
  classifier.use("/chat", requireServiceKey);
  classifier.use(express.json());
  classifier.get("/health", (_req, res) => res.json({ status: "ok" }));
  classifier.post("/chat", (req, res) => {
    if (!req.body.inventory_vocabulary) seen.push(req.body);
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
  classifier.use("/chat", requireServiceKey);
  classifier.use(express.json());
  classifier.get("/health", (_req, res) => res.json({ status: "ok" }));
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
