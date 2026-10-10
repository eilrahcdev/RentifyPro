import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import Booking from "../models/Booking.js";
import User from "../models/User.js";
import RevokedSession from "../models/RevokedSession.js";
import { summarizeRenterBookingStatus } from "../services/chatbotBookingStatus.service.js";

const serviceKey = "chatbot-private-status-fixture-secret-32-chars";
process.env.INTERNAL_API_KEY = serviceKey;
process.env.CHATBOT_INTERNAL_API_KEY = serviceKey;

const at = new Date("2030-01-01T12:00:00Z");
const fixture = (overrides = {}) => ({
  _id: "booking-1", status: "confirmed", returnAt: new Date("2030-01-01T14:00:00Z"),
  actualReturnAt: null, returnStatus: "none", paymentStatus: "partial",
  totalAmount: 1000, transactionFee: 140, paymentAmountPaid: 342,
  lateReturnPenaltyFee: 0, lateReturnGraceMinutes: 15,
  ...overrides,
});

test("renter status uses booking due and return grace rules without treating pending as debt", () => {
  const summary = summarizeRenterBookingStatus([
    fixture(),
    fixture({ _id: "booking-2", status: "pending", paymentStatus: "unpaid", paymentAmountPaid: 0 }),
    fixture({ _id: "booking-3", status: "extended", returnAt: new Date("2030-01-01T11:00:00Z"), paymentStatus: "paid", paymentAmountPaid: 1140 }),
    fixture({ _id: "booking-4", returnAt: new Date("2030-01-01T11:50:00Z"), paymentStatus: "paid", paymentAmountPaid: 1140 }),
    fixture({ _id: "booking-5", status: "completed", lateReturnPenaltyFee: 350, paymentAmountPaid: 1140 }),
    fixture({ _id: "booking-6", status: "completed", paymentStatus: "refunded", paymentAmountPaid: 0 }),
    fixture({ _id: "booking-7", status: "cancelled", paymentStatus: "unpaid", paymentAmountPaid: 0 }),
  ], at);

  assert.deepEqual(summary, {
    activeCount: 3, pendingCount: 1, overdueCount: 1, withinGraceCount: 1,
    dueCount: 1, dueTotal: 350, notDueCount: 1, notDueTotal: 798,
    latePenaltyDueCount: 1,
  });
});

const listen = async (app) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
};
const close = async (server) => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
};

test("chatbot reads only the authenticated renter's bookings and denies guests, owners, and revoked sessions", async () => {
  const original = {
    chatbotUrl: process.env.CHATBOT_URL,
    autostart: process.env.CHATBOT_SERVICE_AUTOSTART,
    jwtSecret: process.env.JWT_SECRET,
    bookingFind: Booking.find,
    userFindById: User.findById,
    revokedExists: RevokedSession.exists,
  };
  const classifier = express();
  classifier.use("/chat", (req, res, next) => req.get("x-internal-key") === serviceKey
    ? next() : res.status(403).json({ detail: "Service access denied." }));
  classifier.use(express.json());
  classifier.get("/health", (_req, res) => res.json({ status: "ok" }));
  classifier.post("/chat", (req, res) => {
    const intents = {
      active: "my_active_bookings", overdue: "my_overdue_return",
      unpaid: "my_unpaid_balance", status: "booking_status",
      "active-fil": "my_active_bookings", "unpaid-taglish": "my_unpaid_balance",
      mixed: "payment_methods", malformed: "payment_methods",
    };
    res.json({
      intent: intents[req.body.message], confidence: 0.995,
      language: req.body.message.endsWith("-fil") ? "fil"
        : req.body.message.endsWith("-taglish") ? "taglish" : "en",
      reply: "Classifier placeholder", alternatives: [], entities: { brand: null, model: null },
      conditions: {}, requires_clarification: false,
      ...(req.body.message === "mixed" || req.body.message === "malformed" ? { additional_answers: [{
        intent: "my_unpaid_balance", confidence: 0.99, language: "en", conditions: {},
        entities: req.body.message === "malformed" ? { renterId: "renter-b" } : { brand: null, model: null },
      }] } : {}),
    });
  });
  const classifierServer = await listen(classifier);
  process.env.CHATBOT_URL = `http://127.0.0.1:${classifierServer.address().port}`;
  process.env.CHATBOT_SERVICE_AUTOSTART = "false";
  process.env.JWT_SECRET = "chatbot-renter-status-test-secret";

  const bookedFor = [];
  let revoked = false;
  Booking.find = (filter) => {
    bookedFor.push(filter.renter);
    const records = filter.renter === "renter-a" ? [
      fixture({ _id: "active-a", returnAt: new Date(Date.now() - 60 * 60 * 1000), paymentAmountPaid: 500 }),
      fixture({ _id: "pending-a", status: "pending", paymentStatus: "unpaid", paymentAmountPaid: 0 }),
      fixture({ _id: "fee-a", status: "completed", lateReturnPenaltyFee: 350, paymentAmountPaid: 1140 }),
    ] : [];
    return { select() { return this; }, maxTimeMS() { return this; }, lean: async () => records };
  };
  User.findById = (id) => ({ select: async () => ({
    _id: id, role: id === "owner-a" ? "owner" : "user", isVerified: true,
    sessionVersion: 0, isArchived: false, isDisabled: false,
  }) });
  RevokedSession.exists = async () => revoked;

  let apiServer;
  try {
    const { default: chatRoutes } = await import("../routes/chat.routes.js");
    const api = express();
    api.use(express.json());
    api.use(cookieParser());
    api.use("/api/chat", chatRoutes);
    apiServer = await listen(api);
    const url = `http://127.0.0.1:${apiServer.address().port}/api/chat`;
    const tokenFor = (id) => jwt.sign({ id, sessionVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
    const post = async (message, token, extra = {}) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { cookie: `token=${token}` } : {}) },
        body: JSON.stringify({ message, language: "auto", ...extra }),
      });
      return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() };
    };

    const guest = await post("active", null, { renterId: "renter-a" });
    assert.equal(guest.status, 200);
    assert.equal(guest.cache, "no-store");
    assert.match(guest.body.reply, /sign in/i);
    assert.deepEqual(bookedFor, []);

    const filipinoGuest = await post("active-fil", null);
    assert.match(filipinoGuest.body.reply, /Mag-sign in/);
    assert.deepEqual(bookedFor, []);

    const owner = await post("active", tokenFor("owner-a"));
    assert.match(owner.body.reply, /renter account/i);
    assert.deepEqual(bookedFor, []);

    const renter = tokenFor("renter-a");
    const active = await post("active", renter, { renterId: "someone-else" });
    assert.equal(active.status, 200);
    assert.equal(active.cache, "no-store");
    assert.match(active.body.reply, /1 active booking/);
    assert.equal(active.body.reason_code, "authenticated_renter_booking_status");
    assert.deepEqual(bookedFor, ["renter-a"]);

    const overdue = await post("overdue", renter);
    assert.match(overdue.body.reply, /1 vehicle return overdue/);
    assert.match(overdue.body.reply, /finalized unpaid late-return penalty/);

    const unpaid = await post("unpaid", renter);
    assert.match(unpaid.body.reply, /2 balances due/);
    assert.match(unpaid.body.reply, /PHP 990\.00/);

    const taglishUnpaid = await post("unpaid-taglish", renter);
    assert.match(taglishUnpaid.body.reply, /due balance sa account mo/);

    const status = await post("status", renter);
    assert.match(status.body.reply, /1 active booking/);
    assert.match(status.body.reply, /1 pending request/);
    assert.match(status.body.reply, /2 balances due/);

    const otherRenter = await post("unpaid", tokenFor("renter-b"), { renterId: "renter-a" });
    assert.match(otherRenter.body.reply, /no balance currently due/i);
    assert.equal(bookedFor.at(-1), "renter-b");

    const beforeRevocation = bookedFor.length;
    const mixedGuest = await post("mixed", null, { renterId: "renter-a" });
    assert.match(mixedGuest.body.reply, /PayMongo/);
    assert.match(mixedGuest.body.reply, /sign in/i);
    assert.equal(mixedGuest.cache, "no-store");
    assert.equal(bookedFor.length, beforeRevocation);
    const mixedOwner = await post("mixed", tokenFor("owner-a"));
    assert.match(mixedOwner.body.reply, /renter account/i);
    assert.equal(bookedFor.length, beforeRevocation);
    const malformed = await post("malformed", renter);
    assert.equal(malformed.body.intent, "REJECT");
    assert.equal(bookedFor.length, beforeRevocation);
    const mixedRenter = await post("mixed", renter, { renterId: "renter-b", conversationContext: { intent: "my_unpaid_balance", entities: { renterId: "renter-b" } } });
    assert.match(mixedRenter.body.reply, /PayMongo/);
    assert.match(mixedRenter.body.reply, /PHP 990\.00/);
    assert.equal(bookedFor.at(-1), "renter-a");
    assert.deepEqual(mixedRenter.body.conversation_context.entities, { brand: null, model: null });
    const beforeMixedRevocation = bookedFor.length;
    revoked = true;
    const revokedReply = await post("mixed", renter);
    assert.equal(revokedReply.status, 401);
    assert.equal(bookedFor.length, beforeMixedRevocation);
    assert.doesNotMatch(JSON.stringify(revokedReply.body), /PHP 990/);
  } finally {
    Booking.find = original.bookingFind;
    User.findById = original.userFindById;
    RevokedSession.exists = original.revokedExists;
    for (const [name, value] of [["CHATBOT_URL", original.chatbotUrl],
      ["CHATBOT_SERVICE_AUTOSTART", original.autostart], ["JWT_SECRET", original.jwtSecret]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (apiServer) await close(apiServer);
    await close(classifierServer);
  }
});
