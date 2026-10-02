import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import ChatMessage from "../models/ChatMessage.js";
import ChatThread from "../models/ChatThread.js";
import eventBus from "../events/eventBus.js";
import { getConversations, sendMessageToUser, updateConversationArchive } from "../controllers/chat.controller.js";

const ownerId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
const renterId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439012");
const strangerId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439013");

const response = () => ({
  code: 200,
  body: null,
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
});

test("conversation lists expose only the viewer's archive state and a real booking vehicle", async (t) => {
  const messages = [{
    _id: new mongoose.Types.ObjectId(),
    sender: { _id: ownerId, name: "Owner", email: "owner@example.test" },
    receiver: { _id: renterId, name: "Renter", email: "renter@example.test" },
    text: "Pickup details",
    createdAt: new Date("2026-09-30T09:00:00Z"),
  }];
  const chain = (result) => {
    const query = { sort: () => query, limit: () => query, select: () => query, populate: () => query, lean: async () => result };
    return query;
  };
  t.mock.method(ChatMessage, "find", () => chain(messages));
  t.mock.method(ChatMessage, "aggregate", async () => []);
  t.mock.method(ChatThread, "find", () => chain([{ owner: ownerId, renter: renterId, archivedFor: [renterId] }]));
  t.mock.method(Booking, "find", () => chain([{
    _id: new mongoose.Types.ObjectId(), owner: ownerId, renter: renterId,
    vehicle: { _id: new mongoose.Types.ObjectId(), name: "Toyota Vios" },
    status: "completed", createdAt: new Date("2026-09-20T09:00:00Z"),
  }]));

  const ownerRes = response();
  await getConversations({ user: { _id: ownerId } }, ownerRes);
  assert.equal(ownerRes.body.conversations[0].isArchived, false);
  assert.equal(ownerRes.body.conversations[0].recentBooking.vehicle.name, "Toyota Vios");

  const renterRes = response();
  await getConversations({ user: { _id: renterId } }, renterRes);
  assert.equal(renterRes.body.conversations[0].isArchived, true);
  assert.equal(renterRes.body.conversations[0].recentBooking.status, "completed");
});

test("an archived conversation remains visible after it falls outside the recent message cap", async (t) => {
  const chain = (result) => {
    const query = { sort: () => query, limit: () => query, select: () => query, populate: () => query, lean: async () => result };
    return query;
  };
  t.mock.method(ChatMessage, "find", () => chain([]));
  t.mock.method(ChatMessage, "aggregate", async () => []);
  t.mock.method(ChatThread, "find", () => chain([{ owner: ownerId, renter: renterId, archivedFor: [renterId] }]));
  t.mock.method(ChatMessage, "findOne", () => chain({
    _id: new mongoose.Types.ObjectId(),
    sender: { _id: ownerId, name: "Owner" },
    receiver: { _id: renterId, name: "Renter" },
    text: "Older visible message",
    createdAt: new Date("2026-01-01T09:00:00Z"),
  }));
  t.mock.method(Booking, "find", () => chain([]));

  const res = response();
  await getConversations({ user: { _id: renterId } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.conversations.length, 1);
  assert.equal(res.body.conversations[0].isArchived, true);
  assert.equal(res.body.conversations[0].partner.name, "Owner");
});

test("sending a message restores the conversation for both participants", async (t) => {
  const bookingId = new mongoose.Types.ObjectId();
  const vehicleId = new mongoose.Types.ObjectId();
  t.mock.method(Booking, "findOne", () => ({
    sort: () => ({ select: async () => ({ _id: bookingId, owner: ownerId, renter: renterId, vehicle: vehicleId }) }),
  }));
  let savedMessage;
  t.mock.method(ChatMessage, "create", async (data) => {
    savedMessage = { ...data, _id: new mongoose.Types.ObjectId(), createdAt: new Date() };
    return savedMessage;
  });
  t.mock.method(ChatMessage, "findById", () => {
    const query = {
      populate: () => query,
      lean: async () => ({ ...savedMessage, sender: { _id: ownerId, name: "Owner" }, receiver: { _id: renterId, name: "Renter" } }),
    };
    return query;
  });
  let archiveUpdate;
  t.mock.method(ChatThread, "updateOne", async (filter, update) => {
    archiveUpdate = { filter, update };
    return { modifiedCount: 1 };
  });
  t.mock.method(eventBus, "emit", () => {});

  const res = response();
  await sendMessageToUser({
    user: { _id: ownerId },
    params: { userId: String(renterId) },
    body: { text: "Hello" },
  }, res);
  assert.equal(res.code, 201);
  assert.equal(res.body.message.text, "Hello");
  assert.deepEqual(archiveUpdate.update.$pull.archivedFor.$in.map(String), [String(ownerId), String(renterId)]);
  assert.equal(String(archiveUpdate.filter.owner), String(ownerId));
  assert.equal(String(archiveUpdate.filter.renter), String(renterId));
});

test("archive and restore belong only to the authenticated participant", async (t) => {
  t.mock.method(Booking, "findOne", (filter) => ({
    sort: () => ({ select: async () => filter.$or.some((pair) =>
      String(pair.owner) === String(ownerId) && String(pair.renter) === String(renterId)
    ) ? { _id: new mongoose.Types.ObjectId(), owner: ownerId, renter: renterId } : null }),
  }));
  t.mock.method(ChatMessage, "findOne", () => ({ sort: () => ({ select: async () => null }) }));
  const archivedFor = [];
  const writes = [];
  t.mock.method(ChatThread, "findOneAndUpdate", (filter, update) => {
    writes.push({ filter, update });
    const id = update.$addToSet?.archivedFor;
    if (id && !archivedFor.some((entry) => String(entry) === String(id))) archivedFor.push(id);
    const removed = update.$pull?.archivedFor;
    if (removed) archivedFor.splice(archivedFor.findIndex((entry) => String(entry) === String(removed)), 1);
    return { lean: async () => ({ archivedFor: [...archivedFor] }) };
  });

  const run = async (userId, partnerId, archived) => {
    const res = response();
    await updateConversationArchive({ user: { _id: userId }, params: { userId: String(partnerId) }, body: { archived } }, res);
    return res;
  };

  assert.equal((await run(ownerId, renterId, true)).body.archived, true);
  assert.deepEqual(archivedFor.map(String), [String(ownerId)]);
  assert.equal((await run(renterId, ownerId, true)).body.archived, true);
  assert.deepEqual(archivedFor.map(String), [String(ownerId), String(renterId)]);
  assert.equal((await run(ownerId, renterId, false)).body.archived, false);
  assert.deepEqual(archivedFor.map(String), [String(renterId)]);
  assert.equal(writes.length, 3);
  assert.equal((await run(strangerId, ownerId, true)).code, 403);
  assert.equal(writes.length, 3);
  assert.equal((await run(ownerId, renterId, "true")).code, 400);
  assert.equal(writes.length, 3);
});
