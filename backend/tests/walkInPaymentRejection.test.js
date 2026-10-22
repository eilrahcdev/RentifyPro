import test from "node:test";
import assert from "node:assert/strict";
import Booking from "../models/Booking.js";
import Notification from "../models/Notification.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import eventBus from "../events/eventBus.js";
import { NOTIFICATION_EVENTS } from "../events/notification.events.js";
import { registerNotificationHandlers } from "../handlers/notification.handlers.js";
import { reviewOwnerWalkInPaymentRequest } from "../controllers/ownerDashboard.controller.js";

const owner = "507f1f77bcf86cd799439011";
const renter = "507f1f77bcf86cd799439012";
const fixture = (overrides = {}) => ({
  _id: "507f1f77bcf86cd799439013", owner: { _id: owner }, renter: { _id: renter },
  vehicle: { _id: "507f1f77bcf86cd799439014", name: "Fixture vehicle", images: [] },
  status: "confirmed", paymentStatus: "partial", totalAmount: 1000, transactionFee: 100,
  paymentAmountPaid: 330, paymentAmountDue: 770, paymentMethod: "PayMongo",
  pickupAt: new Date("2030-01-01T10:00:00Z"), returnAt: new Date("2030-01-01T14:00:00Z"),
  walkInPaymentStatus: "requested", walkInRequestedAt: new Date("2026-10-21T01:00:00Z"),
  walkInReviewNote: "", ...overrides,
});
const response = () => ({
  statusCode: 200, status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const request = (body) => ({
  params: { id: "507f1f77bcf86cd799439013" }, user: { _id: owner }, body,
  protocol: "https", get: () => "fixture.test",
});
function setup(t, booking = fixture(), { realEvents = false } = {}) {
  const state = { booking, saves: 0, events: [] };
  if (booking) booking.save = async () => { state.saves++; };
  t.mock.method(Booking, "findOne", (filter) => ({ populate: async () => {
    assert.equal(filter.owner, owner);
    assert.equal(filter._id, request({}).params.id);
    return booking;
  } }));
  t.mock.method(Booking, "findById", () => ({ populate: async () => booking }));
  if (!realEvents) t.mock.method(eventBus, "emit", (event, payload) => { state.events.push({ event, payload }); return true; });
  return state;
}

test("walk-in rejection requires a nonblank string reason without saving or notifying", async (t) => {
  const state = setup(t);
  for (const note of [undefined, null, "", " \n\t ", 123, true, {}, ["Not available"]]) {
    const res = response();
    await reviewOwnerWalkInPaymentRequest(request({ action: "reject", note }), res);
    assert.equal(res.statusCode, 400, JSON.stringify(note));
    assert.match(res.body.message, /reason/i);
  }
  assert.equal(state.booking.walkInPaymentStatus, "requested");
  assert.equal(state.saves, 0);
  assert.equal(state.events.length, 0);
});

test("rejection rejects reasons over 500 characters instead of silently truncating", async (t) => {
  const state = setup(t);
  const res = response();
  await reviewOwnerWalkInPaymentRequest(request({ action: "reject", note: "x".repeat(501) }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /500/);
  assert.equal(state.saves, 0);
  assert.equal(state.events.length, 0);
});

test("rejection stores the trimmed reason and reviewer without changing the booking or collected payment", async (t) => {
  const state = setup(t);
  const res = response();
  await reviewOwnerWalkInPaymentRequest(request({ action: "reject", note: "  Please pay online.\nIn-person collection is unavailable.  " }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.booking.walkInPayment.status, "rejected");
  assert.equal(res.body.booking.walkInPayment.reviewNote, "Please pay online.\nIn-person collection is unavailable.");
  assert.equal(res.body.booking.walkInPayment.reviewedBy, owner);
  assert.equal(res.body.booking.status, "confirmed");
  assert.equal(res.body.booking.paymentStatus, "partial");
  assert.equal(res.body.booking.paymentAmountPaid, 330);
  assert.equal(res.body.booking.paymentAmountDue, 770);
  assert.equal(state.booking.paymentMethod, "PayMongo");
  assert.equal(state.booking.balancePaymentMethod, null);
  assert.equal(state.saves, 1);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].event, NOTIFICATION_EVENTS.WALKIN_PAYMENT_REJECTED);
  assert.equal(state.events[0].payload.booking.walkInReviewNote, res.body.booking.walkInPayment.reviewNote);
});

test("walk-in approval still accepts an omitted note", async (t) => {
  const state = setup(t);
  const res = response();
  await reviewOwnerWalkInPaymentRequest(request({ action: "approve" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.booking.walkInPayment.status, "approved");
  assert.equal(state.booking.walkInReviewNote, "");
  assert.equal(state.booking.balancePaymentMethod, "Walk-in");
  assert.equal(state.events[0].event, NOTIFICATION_EVENTS.WALKIN_PAYMENT_APPROVED);
});

test("rejection preserves owner ownership, lifecycle, downpayment, balance and pending-request checks", async (t) => {
  for (const [booking, code] of [
    [null, 404],
    [fixture({ status: "cancelled" }), 400],
    [fixture({ status: "pending" }), 400],
    [fixture({ paymentStatus: "paid" }), 400],
    [fixture({ paymentAmountPaid: 1100, paymentAmountDue: 0 }), 400],
    [fixture({ walkInPaymentStatus: "approved" }), 409],
    [fixture({ walkInPaymentStatus: "rejected" }), 409],
  ]) {
    await t.test(`${booking?.status || "missing"}/${booking?.paymentStatus || "missing"}/${booking?.walkInPaymentStatus || "missing"}/${code}`, async (t) => {
      const state = setup(t, booking);
      const res = response();
      await reviewOwnerWalkInPaymentRequest(request({ action: "reject", note: "Collection unavailable." }), res);
      assert.equal(res.statusCode, code);
      assert.equal(state.saves, 0);
      assert.equal(state.events.length, 0);
    });
  }
});

test("failed saves do not notify the renter", async (t) => {
  const state = setup(t);
  state.booking.save = async () => { throw new Error("Fixture save failure"); };
  const res = response();
  await reviewOwnerWalkInPaymentRequest(request({ action: "reject", note: "Collection unavailable." }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(state.events.length, 0);
});

test("the renter notification persists the full reason and a new request gets its own rejection notification", async (t) => {
  const state = setup(t, fixture(), { realEvents: true });
  const notifications = [];
  t.mock.method(Notification, "findOne", async ({ user, dedupeKey }) => notifications.find((item) => item.user === user && item.dedupeKey === dedupeKey) || null);
  t.mock.method(Notification, "create", async (data) => {
    const record = new Notification(data);
    await record.validate();
    notifications.push(data);
    return record;
  });
  t.mock.method(NotificationDelivery, "updateOne", async () => ({ modifiedCount: 0 }));
  registerNotificationHandlers();

  const reason = "x".repeat(500);
  const res = response();
  await reviewOwnerWalkInPaymentRequest(request({ action: "reject", note: reason }), res);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].user, renter);
  assert.equal(notifications[0].event, NOTIFICATION_EVENTS.WALKIN_PAYMENT_REJECTED);
  assert.ok(notifications[0].message.includes(`Reason: ${reason}`));
  assert.equal(notifications[0].data.bookingId, state.booking._id);
  assert.equal(notifications[0].data.walkInPaymentStatus, "rejected");

  state.booking.walkInPaymentStatus = "requested";
  state.booking.walkInRequestedAt = new Date("2026-10-21T02:00:00Z");
  await reviewOwnerWalkInPaymentRequest(request({ action: "reject", note: "A different collection time is needed." }), response());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications.length, 2);
  assert.match(notifications[1].message, /Reason: A different collection time is needed\./);
  assert.notEqual(notifications[0].dedupeKey, notifications[1].dedupeKey);
});
