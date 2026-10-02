import test from "node:test";
import assert from "node:assert/strict";
import Booking from "../models/Booking.js";
import eventBus from "../events/eventBus.js";
import { updateOwnerBookingPaymentStatus } from "../controllers/ownerDashboard.controller.js";
import { evaluateBookingEligibility } from "../services/bookingEligibility.service.js";

const owner = "507f1f77bcf86cd799439011";
const renter = "507f1f77bcf86cd799439012";
const fixture = (overrides = {}) => ({
  _id: "507f1f77bcf86cd799439013", owner: { _id: owner }, renter: { _id: renter },
  vehicle: { _id: "507f1f77bcf86cd799439014", name: "Fixture vehicle", images: [] },
  status: "confirmed", paymentStatus: "partial", totalAmount: 1000, transactionFee: 140,
  baseAmount: 1000, driverAmount: 0, vehicleDailyRate: 250, rentalRateUnit: "hourly", bookingDays: 1,
  pickupAt: new Date("2030-01-01T10:00:00Z"), returnAt: new Date("2030-01-01T14:00:00Z"),
  paymentAmountPaid: 342, paymentAmountDue: 798, paymentCheckoutAmount: 798,
  paymentMethod: "PayMongo", paymongoCheckoutId: "checkout-existing", paymongoVerifiedCheckoutIds: ["deposit-checkout"],
  walkInPaymentStatus: "none", paidAt: null, actualReturnAt: null,
  updatedAt: new Date("2026-01-01T10:00:00Z"), manualPaymentRevision: 0,
  ...overrides,
});
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const request = (paymentStatus, details = {}) => ({
  params: { id: "507f1f77bcf86cd799439013" }, user: { _id: owner }, body: { paymentStatus, ...details },
  protocol: "https", get: () => "rentifypro.test",
});
function setup(t, initial = fixture()) {
  let stored = initial, writes = 0, notifications = 0;
  t.mock.method(Booking, "findOne", (filter) => ({ populate: async () => {
    assert.equal(filter.owner, owner);
    return stored ? { ...stored } : null;
  } }));
  t.mock.method(Booking, "findOneAndUpdate", (filter, update, options) => ({ populate: async () => {
    assert.equal(filter.owner, owner);
    assert.equal(options.runValidators, true);
    assert.equal(options.new, true);
    if (filter.updatedAt.getTime() !== stored.updatedAt.getTime() ||
        (typeof filter.manualPaymentRevision === "number" && filter.manualPaymentRevision !== stored.manualPaymentRevision) ||
        (typeof filter.manualPaymentRevision === "object" && stored.manualPaymentRevision !== 0)) return null;
    writes++;
    stored = { ...stored, ...update.$set, manualPaymentRevision: stored.manualPaymentRevision + update.$inc.manualPaymentRevision, updatedAt: new Date(stored.updatedAt.getTime() + 1) };
    return { ...stored };
  } }));
  t.mock.method(eventBus, "emit", () => { notifications++; });
  return { booking: () => stored, writes: () => writes, notifications: () => notifications };
}

test("owner can mark a partial booking paid without completing or returning the vehicle", async (t) => {
  const state = setup(t);
  const res = response();
  await updateOwnerBookingPaymentStatus(request("paid", { expectedUpdatedAt: state.booking().updatedAt.toISOString() }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.booking.paymentStatus, "paid");
  assert.equal(res.body.booking.payment_status, "paid");
  assert.equal(res.body.booking.paymentAmountPaid, 1140);
  assert.equal(res.body.booking.paymentAmountDue, 0);
  assert.equal(res.body.booking.status, "confirmed");
  assert.equal(res.body.booking.actualReturnAt, null);
  assert.equal(state.booking().paymentCheckoutAmount, 0);
  assert.equal(state.booking().balancePaymentMethod, "Owner-confirmed");
  assert.equal(state.booking().manualPaymentUpdatedBy, owner);
  assert.equal(state.booking().manualPaymentStatus, "paid");
  assert.ok(state.booking().manualPaymentUpdatedAt instanceof Date);
  assert.ok(state.booking().paidAt instanceof Date);
  assert.equal(state.booking().paymongoCheckoutId, "checkout-existing");
  assert.deepEqual(state.booking().paymongoVerifiedCheckoutIds, ["deposit-checkout"]);
  assert.equal(state.notifications(), 1);
});

test("manual Paid settles finalized penalties and restores booking eligibility", async (t) => {
  const state = setup(t, fixture({ status: "completed", lateReturnPenaltyFee: 350, paymentAmountPaid: 1140, paymentAmountDue: 350, actualReturnAt: new Date() }));
  assert.equal(evaluateBookingEligibility([state.booking()]).eligible, false);
  const res = response();
  await updateOwnerBookingPaymentStatus(request("paid"), res);
  assert.equal(res.body.booking.paymentAmountPaid, 1490);
  assert.equal(res.body.booking.paymentAmountDue, 0);
  assert.equal(evaluateBookingEligibility([state.booking()]).eligible, true);
});

test("unpaid legacy records preserve their transaction fee when marked paid", async (t) => {
  setup(t, fixture({ paymentStatus: "unpaid", transactionFee: 0, paymentAmountPaid: 0, paymentAmountDue: 1000, paymentMethod: null }));
  const res = response();
  await updateOwnerBookingPaymentStatus(request("paid"), res);
  assert.equal(res.body.booking.amountPayable, 1140);
  assert.equal(res.body.booking.paymentAmountPaid, 1140);
  assert.equal(res.body.booking.paymentMethod, "Owner-confirmed");
});

test("Paid settles an approved walk-in balance and records who received it", async (t) => {
  const state = setup(t, fixture({ walkInPaymentStatus: "approved", walkInRequestedAt: new Date(), walkInRequestedBy: renter }));
  const res = response();
  await updateOwnerBookingPaymentStatus(request("paid"), res);
  assert.equal(res.body.booking.walkInPayment.status, "completed");
  assert.equal(res.body.booking.walkInPayment.confirmedBy, owner);
  assert.equal(state.booking().balancePaymentMethod, "Walk-in");
});

test("repeated Paid is not an additional payment and keeps the original paid timestamp", async (t) => {
  const paidAt = new Date("2026-01-01T12:00:00Z");
  const state = setup(t, fixture({ paymentStatus: "paid", paymentAmountPaid: 1140, paymentAmountDue: 0, paidAt }));
  const res = response();
  await updateOwnerBookingPaymentStatus(request("paid"), res);
  assert.equal(state.booking().paymentAmountPaid, 1140);
  assert.equal(state.booking().paidAt, paidAt);
});

test("Partial uses the entered total received and clears the old full-payment timestamp", async (t) => {
  const state = setup(t, fixture({ paymentStatus: "paid", paymentAmountPaid: 1140, paidAt: new Date(), walkInPaymentStatus: "completed" }));
  const res = response();
  await updateOwnerBookingPaymentStatus(request("partial", { paymentAmountPaid: 500 }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.booking.paymentStatus, "partial");
  assert.equal(res.body.booking.paymentAmountPaid, 500);
  assert.equal(res.body.booking.paymentAmountDue, 640);
  assert.equal(state.booking().paidAt, null);
  assert.equal(res.body.booking.walkInPayment.status, "none");
});

test("Partial rejects zero, full, missing, and malformed amounts instead of inventing a payment", async (t) => {
  const state = setup(t, fixture({ paymentStatus: "unpaid", paymentAmountPaid: 0 }));
  for (const paymentAmountPaid of [undefined, 0, -1, 1140, 1500, "", "abc", true, {}, [500]]) {
    const res = response();
    await updateOwnerBookingPaymentStatus(request("partial", { paymentAmountPaid }), res);
    assert.equal(res.statusCode, 400, JSON.stringify(paymentAmountPaid));
  }
  assert.equal(state.writes(), 0);
});

test("Unpaid and Refunded reset collected amounts and the dropdown response stays consistent", async (t) => {
  const state = setup(t);
  for (const status of ["unpaid", "refunded"]) {
    const res = response();
    await updateOwnerBookingPaymentStatus(request(status), res);
    assert.equal(res.body.booking.paymentStatus, status);
    assert.equal(res.body.booking.paymentAmountPaid, 0);
    assert.equal(res.body.booking.paymentAmountDue, 1140);
    assert.equal(state.booking().paidAt, null);
  }
});

test("another owner's booking is not writable", async (t) => {
  const state = setup(t, null);
  const res = response();
  await updateOwnerBookingPaymentStatus(request("paid"), res);
  assert.equal(res.statusCode, 404);
  assert.equal(state.writes(), 0);
});

test("a stale dropdown submission receives current status without changing it", async (t) => {
  const state = setup(t, fixture({ paymentStatus: "paid", paymentAmountPaid: 1140 }));
  const res = response();
  await updateOwnerBookingPaymentStatus(request("unpaid", { expectedUpdatedAt: "2025-01-01T00:00:00Z" }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.booking.paymentStatus, "paid");
  assert.equal(state.writes(), 0);
});

test("competing manual decisions apply only one atomic status/amount update", async (t) => {
  const state = setup(t);
  const responses = [response(), response()];
  await Promise.all(["paid", "unpaid"].map((status, index) => updateOwnerBookingPaymentStatus(request(status), responses[index])));
  assert.deepEqual(responses.map((res) => res.statusCode).sort(), [200, 409]);
  assert.equal(state.writes(), 1);
  assert.equal(state.notifications(), 1);
  assert.equal(responses.find((res) => res.statusCode === 409).body.booking.paymentStatus, state.booking().paymentStatus);
});

test("an earlier online payment save cannot overwrite a later manual correction", async (t) => {
  const source = fixture();
  const booking = Booking.hydrate({ ...source, owner, renter, vehicle: source.vehicle._id });
  // This represents a verifier that loaded revision zero, then waited on a
  // provider while the owner's atomic update advanced the stored revision.
  booking.paymentAmountPaid = 684;
  booking.paymentAmountDue = 456;
  t.mock.method(Booking.collection, "updateOne", async (filter) => {
    assert.deepEqual(filter.manualPaymentRevision, { $in: [0, null] });
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
  });
  await assert.rejects(booking.save(), { name: "DocumentNotFoundError" });
});

test("normal payment saves still work when no manual correction intervened", async (t) => {
  const source = fixture();
  const booking = Booking.hydrate({ ...source, owner, renter, vehicle: source.vehicle._id, manualPaymentRevision: 2 });
  booking.paymentAmountPaid = 500;
  t.mock.method(Booking.collection, "updateOne", async (filter) => {
    assert.equal(filter.manualPaymentRevision, 2);
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });
  await booking.save();
  assert.equal(booking.paymentAmountPaid, 500);
});
