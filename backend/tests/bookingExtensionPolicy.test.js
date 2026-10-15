import test from "node:test";
import assert from "node:assert/strict";
import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";
import User from "../models/User.js";
import eventBus from "../events/eventBus.js";
import { requestBookingExtension, requestBookingReturn, withdrawBookingExtension } from "../controllers/booking.controller.js";
import { reviewOwnerBookingExtensionRequest, confirmOwnerVehicleReturn } from "../controllers/ownerDashboard.controller.js";
import { syncOneBookingLifecycle } from "../jobs/bookingLifecycle.job.js";
import { calculateBookingLateReturn, getEstimatedLateReturnPenaltyFee, parseBookingHandoverTime, quoteBookingExtension } from "../utils/lateReturnPolicy.js";
import { getBookingPayableAmount } from "../utils/bookingPayment.js";

const owner = "507f1f77bcf86cd799439011";
const renter = "507f1f77bcf86cd799439012";
const id = "507f1f77bcf86cd799439013";
const at = (time) => new Date(`2030-01-01T${time}:00Z`);
const query = (value) => ({
  select() { return this; }, maxTimeMS() { return this; },
  populate: async () => value, lean: async () => value,
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});
const response = () => ({
  statusCode: 200, status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const req = (role, body = {}) => ({
  params: { id }, user: { _id: role === "owner" ? owner : renter }, body,
  protocol: "https", get: () => "rentifypro.test",
});
const fixture = (overrides = {}) => ({
  _id: id, owner: { _id: owner }, renter: { _id: renter },
  vehicle: { _id: "507f1f77bcf86cd799439014", name: "Fixture vehicle", images: [] },
  status: "confirmed", pickupAt: at("08:00"), returnAt: at("16:00"),
  returnStatus: "none", actualReturnAt: null, extensionStatus: "none",
  rentalRateUnit: "hourly", vehicleDailyRate: 100, driverDailyRate: 0, driverSelected: false,
  totalAmount: 800, baseAmount: 800, driverAmount: 0, transactionFee: 100,
  bookingDurationMinutes: 480, bookingDurationHours: 8, bookingDays: 1,
  paymentStatus: "paid", paymentAmountPaid: 900, paymentAmountDue: 0,
  lateReturnFeeType: "fixed_hourly", lateReturnFeeValue: 50, lateReturnGraceMinutes: 0,
  lateReturnPenaltyRatePerHour: 50, lateReturnPenaltyFee: 0,
  lateReturnNotifiedAt: at("15:00"), lateReturnIsOverdue: false,
  bookingPolicyVersion: 2, originalReturnAt: at("16:00"), extensionHistory: [],
  async save() {}, ...overrides,
});
function setup(t, booking = fixture(), time = "18:00") {
  t.mock.timers.enable({ apis: ["Date"], now: at(time) });
  let held = false;
  t.mock.method(User, "updateOne", async (filter, update) => {
    if (update.$set?.bookingMutationToken) {
      if (held) return { modifiedCount: 0 };
      held = true;
    } else if (update.$unset) held = false;
    return { modifiedCount: 1, matchedCount: 1 };
  });
  t.mock.method(Booking, "findOne", (filter) => {
    if (typeof filter._id !== "string") return query(null);
    if (filter.owner) assert.equal(filter.owner, owner);
    if (filter.renter) assert.equal(filter.renter, renter);
    return query(booking);
  });
  t.mock.method(Booking, "findById", () => query(booking));
  t.mock.method(Booking, "exists", async () => booking.status !== "completed" ? { _id: id } : null);
  t.mock.method(Vehicle, "findById", () => query({
    _id: booking.vehicle._id, availabilityStatus: "unavailable", availabilityHoldReason: "inspection",
  }));
  t.mock.method(Vehicle, "updateOne", async () => ({ matchedCount: 1 }));
  t.mock.method(eventBus, "emit", () => false);
  return booking;
}
async function requestExtension(time) {
  const res = response();
  await requestBookingExtension(req("renter", { newReturnAt: at(time).toISOString() }), res);
  return res;
}
async function approve() {
  const res = response();
  await reviewOwnerBookingExtensionRequest(req("owner", { action: "approve" }), res);
  return res;
}

test("late extension preserves earlier late time and bills only the approved additional interval", async (t) => {
  const booking = setup(t);
  assert.equal((await requestExtension("18:30")).statusCode, 200);
  t.mock.timers.setTime(at("18:15").getTime());
  const res = await approve();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(booking.totalAmount, 850);
  assert.equal(booking.lateReturnOverdueMinutes, 120);
  assert.equal(getEstimatedLateReturnPenaltyFee(booking), 100);
  assert.equal(booking.lateReturnPenaltyFee, 0, "accrued fees remain estimates until verified return");
  assert.equal(booking.paymentAmountPaid, 900);
  assert.equal(booking.paymentAmountDue, 50);
  assert.equal(booking.extensionHistory.length, 1);
});

test("legacy bookings retain their existing extension accounting", async (t) => {
  const booking = setup(t, fixture({ bookingPolicyVersion: 1, originalReturnAt: null }));
  assert.equal((await requestExtension("18:30")).statusCode, 200);
  assert.equal((await approve()).statusCode, 200);
  assert.equal(booking.totalAmount, 1050);
  assert.equal(booking.lateReturnOverdueMinutes, 0);
});

test("on-time request approved after the original deadline covers its agreed interval", async (t) => {
  const booking = setup(t, fixture(), "15:45");
  assert.equal((await requestExtension("17:00")).statusCode, 200);
  t.mock.timers.setTime(at("16:30").getTime());
  assert.equal((await approve()).statusCode, 200);
  assert.equal(booking.totalAmount, 900);
  assert.equal(booking.lateReturnOverdueMinutes, 0);
  assert.equal(getEstimatedLateReturnPenaltyFee(booking), 0);
});

test("extension submission rejects return times already in the past", async (t) => {
  const booking = setup(t);
  const res = await requestExtension("16:30");
  assert.equal(res.statusCode, 400);
  assert.equal(booking.extensionStatus, "none");
  assert.equal(booking.returnAt.getTime(), at("16:00").getTime());
});

test("owner cannot approve an expired extension or replace the current deadline", async (t) => {
  const booking = setup(t, fixture({
    extensionStatus: "requested", extensionRequestedAt: at("15:45"),
    extensionCurrentReturnAt: at("16:00"), extensionRequestedReturnAt: at("17:00"),
  }));
  const res = await approve();
  assert.equal(res.statusCode, 409);
  assert.equal(booking.extensionStatus, "expired");
  assert.equal(booking.returnAt.getTime(), at("16:00").getTime());
  assert.equal(booking.totalAmount, 800);
});

test("requesting return withdraws a pending extension without owner review", async (t) => {
  const booking = setup(t);
  assert.equal((await requestExtension("18:30")).statusCode, 200);
  const res = response();
  await requestBookingReturn(req("renter", { reportedHandoverAt: at("18:00").toISOString() }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(booking.extensionStatus, "withdrawn");
  assert.equal(booking.returnStatus, "requested");
  assert.equal(booking.returnReportedHandoverAt.getTime(), at("18:00").getTime());
  assert.equal((await approve()).statusCode, 409);
});

test("verified handover time ends charges despite a later owner confirmation", async (t) => {
  const booking = setup(t, fixture(), "16:00");
  const requested = response();
  await requestBookingReturn(req("renter", { reportedHandoverAt: at("16:00").toISOString() }), requested);
  assert.equal(requested.statusCode, 200);
  t.mock.timers.setTime(at("18:00").getTime());
  const res = response();
  await confirmOwnerVehicleReturn(req("owner", { actualReturnAt: at("16:00").toISOString() }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(booking.actualReturnAt.getTime(), at("16:00").getTime());
  assert.equal(booking.returnConfirmedAt.getTime(), at("18:00").getTime());
  assert.equal(booking.lateReturnPenaltyFee, 0);
  assert.equal(booking.paymentAmountPaid, 900);
});

test("a handover claim alone does not finalize charges or release the vehicle", async (t) => {
  const booking = setup(t);
  const res = response();
  await requestBookingReturn(req("renter", { reportedHandoverAt: at("16:00").toISOString() }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(booking.status, "confirmed");
  assert.equal(booking.actualReturnAt, null);
  assert.equal(booking.lateReturnPenaltyFee, 0);
  assert.equal(getEstimatedLateReturnPenaltyFee(booking), 100);
});

test("new policy requires explicit owner handover time and rejects impossible timestamps", async (t) => {
  const booking = setup(t, fixture({ returnStatus: "requested" }));
  for (const actualReturnAt of [undefined, "invalid", at("07:59").toISOString(), at("18:01").toISOString()]) {
    const res = response();
    await confirmOwnerVehicleReturn(req("owner", { actualReturnAt }), res);
    assert.equal(res.statusCode, 400, String(actualReturnAt));
    assert.equal(booking.status, "confirmed");
    assert.equal(booking.lateReturnPenaltyFee, 0);
  }
});

test("multiple late extensions preserve every uncovered period without double billing", async (t) => {
  const booking = setup(t);
  assert.equal((await requestExtension("18:30")).statusCode, 200);
  assert.equal((await approve()).statusCode, 200);
  t.mock.timers.setTime(at("19:00").getTime());
  assert.equal((await requestExtension("19:30")).statusCode, 200);
  assert.equal((await approve()).statusCode, 200);
  assert.equal(booking.totalAmount, 900);
  assert.equal(booking.extensionHistory.length, 2);
  assert.equal(booking.lateReturnOverdueMinutes, 150);
  t.mock.timers.setTime(at("20:00").getTime());
  await syncOneBookingLifecycle(booking, at("20:00"));
  assert.equal(booking.lateReturnOverdueMinutes, 180);
  assert.equal(getEstimatedLateReturnPenaltyFee(booking), 150);
});

test("withdrawal prevents a stale owner approval and preserves the current deadline", async (t) => {
  const booking = setup(t);
  assert.equal((await requestExtension("18:30")).statusCode, 200);
  const withdrawn = response();
  await withdrawBookingExtension(req("renter", { expectedRequestedAt: booking.extensionRequestedAt.toISOString() }), withdrawn);
  assert.equal(withdrawn.statusCode, 200);
  assert.equal(booking.extensionStatus, "withdrawn");
  assert.equal(booking.extensionHistory[0].status, "withdrawn");
  assert.equal(booking.returnAt.getTime(), at("16:00").getTime());
  assert.equal((await approve()).statusCode, 409);
});

test("stale request identifiers cannot approve a replacement request", async (t) => {
  const booking = setup(t);
  assert.equal((await requestExtension("18:30")).statusCode, 200);
  const res = response();
  await reviewOwnerBookingExtensionRequest(req("owner", { action: "approve", expectedRequestedAt: at("17:59").toISOString() }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(booking.extensionStatus, "requested");
  assert.equal(booking.totalAmount, 800);
});

test("a competing return request cannot race an owner extension decision through the lease", async (t) => {
  const booking = setup(t);
  assert.equal((await requestExtension("18:30")).statusCode, 200);
  t.mock.method(User, "updateOne", async () => ({ modifiedCount: 0 }));
  const res = response();
  await requestBookingReturn(req("renter"), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "BOOKING_UPDATE_IN_PROGRESS");
  assert.equal(booking.returnStatus, "none");
  assert.equal(booking.extensionStatus, "requested");
});

test("rejected extensions keep continuous lateness and add no rental charge", async (t) => {
  const booking = setup(t);
  assert.equal((await requestExtension("18:30")).statusCode, 200);
  const res = response();
  await reviewOwnerBookingExtensionRequest(req("owner", { action: "reject" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(booking.totalAmount, 800);
  assert.equal(booking.extensionHistory[0].status, "rejected");
  assert.equal(calculateBookingLateReturn(booking, at("18:30")).overdueMinutes, 150);
});

test("grace and selected driver charges stay snapshotted through an approved late extension", async (t) => {
  const booking = setup(t, fixture({ lateReturnGraceMinutes: 15, driverSelected: true, driverDailyRate: 20, driverAmount: 160, totalAmount: 960, paymentAmountPaid: 1060 }));
  assert.equal((await requestExtension("18:30")).statusCode, 200);
  assert.equal((await approve()).statusCode, 200);
  assert.equal(booking.totalAmount, 1020);
  assert.equal(booking.driverAmount, 170);
  assert.equal(booking.lateReturnOverdueMinutes, 105);
  assert.equal(getEstimatedLateReturnPenaltyFee(booking), 87.5);
  assert.equal(calculateBookingLateReturn(booking, at("18:40")).overdueMinutes, 105);
  assert.equal(calculateBookingLateReturn(booking, at("18:50")).overdueMinutes, 110);
});

test("zero penalty and transaction-fee snapshots remain zero after new charges", async (t) => {
  const booking = setup(t, fixture({ lateReturnFeeValue: 0, lateReturnPenaltyRatePerHour: 0, transactionFee: 0, paymentAmountPaid: 800 }));
  assert.equal((await requestExtension("18:30")).statusCode, 200);
  assert.equal((await approve()).statusCode, 200);
  assert.equal(booking.lateReturnOverdueMinutes, 120);
  assert.equal(getEstimatedLateReturnPenaltyFee(booking), 0);
  assert.equal(getBookingPayableAmount(booking), 850);
  assert.equal(booking.paymentAmountDue, 50);
});

test("final settlement adds earlier late fees once and preserves captured payments", async (t) => {
  const booking = setup(t);
  assert.equal((await requestExtension("18:30")).statusCode, 200);
  assert.equal((await approve()).statusCode, 200);
  t.mock.timers.setTime(at("18:30").getTime());
  const requested = response();
  await requestBookingReturn(req("renter", { reportedHandoverAt: at("18:30").toISOString() }), requested);
  t.mock.timers.setTime(at("20:00").getTime());
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = response();
    await confirmOwnerVehicleReturn(req("owner", { actualReturnAt: at("18:30").toISOString() }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(booking.lateReturnPenaltyFee, 100);
    assert.equal(booking.paymentAmountPaid, 900);
    assert.equal(booking.paymentAmountDue, 150);
    assert.equal(booking.returnConfirmedAt.getTime(), at("20:00").getTime());
  }
});

test("handover validation rejects normalized impossible dates, missing zones, and non-strings", () => {
  for (const value of ["2030-02-31T10:00:00Z", "2030-01-01T25:00:00Z", "2030-01-01T10:00:00", 123, {}, ["2030-01-01T10:00:00Z"]]) {
    assert.equal(parseBookingHandoverTime(value), null);
  }
  assert.equal(parseBookingHandoverTime("2030-01-01T18:30:00+08:00").toISOString(), "2030-01-01T10:30:00.000Z");
});

test("short extensions prorate vehicle and driver charges without rounding up to a full hour", () => {
  const booking = fixture({ driverSelected: true, driverDailyRate: 20 });
  assert.equal(quoteBookingExtension(booking, at("18:15"), at("18:00")).totalAmount, 30);
  assert.equal(quoteBookingExtension(booking, at("18:00"), at("18:00")), null);
});

test("extension, withdrawal, and return mutations remain scoped to the booking participant", async (t) => {
  const booking = setup(t);
  t.mock.method(Booking, "findOne", (filter) => query(
    (filter.renter && filter.renter !== renter) || (filter.owner && filter.owner !== owner) ? null : booking));
  for (const [handler, role, body] of [
    [requestBookingExtension, "renter", { newReturnAt: at("18:30").toISOString() }],
    [withdrawBookingExtension, "renter", {}], [requestBookingReturn, "renter", {}],
    [reviewOwnerBookingExtensionRequest, "owner", { action: "approve" }],
    [confirmOwnerVehicleReturn, "owner", { actualReturnAt: at("18:00").toISOString() }],
  ]) {
    const request = req(role, body); request.user = { _id: "507f1f77bcf86cd799439099" };
    const res = response(); await handler(request, res);
    assert.equal(res.statusCode, 404);
    assert.equal(booking.status, "confirmed");
    assert.equal(booking.extensionHistory.length, 0);
  }
});

test("new policy documents require an original deadline while legacy agreements remain valid", async () => {
  const invalid = new Booking({ ...fixture(), originalReturnAt: null });
  await assert.rejects(invalid.validate(), (error) => error.errors.originalReturnAt?.kind === "required");
  const legacy = new Booking({ ...fixture(), bookingPolicyVersion: 1, originalReturnAt: null });
  await legacy.validate();
});
