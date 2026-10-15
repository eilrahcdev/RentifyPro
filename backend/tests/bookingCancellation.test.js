import test from "node:test";
import assert from "node:assert/strict";
import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";
import eventBus from "../events/eventBus.js";
import {
  getOwnerBookings, reviewOwnerBookingCancellationRequest, updateOwnerBookingStatus,
} from "../controllers/ownerDashboard.controller.js";
import { getOwnerBookings as getOwnerBookingList } from "../controllers/booking.controller.js";
import { calculateBookingLateReturn, getEstimatedLateReturnPenaltyFee } from "../utils/lateReturnPolicy.js";
import { getBookingLateReturnInfo } from "../../frontend/src/utils/bookingPolicy.js";

const at = (hour) => new Date(`2030-01-01T${hour}:00:00Z`);
const fixture = (overrides = {}) => ({
  _id: "507f1f77bcf86cd799439013", owner: { _id: "owner" }, renter: { _id: "renter" },
  vehicle: { _id: "vehicle", images: [] }, status: "confirmed", updatedAt: at("17"),
  pickupAt: at("08"), returnAt: at("16"), actualReturnAt: null, returnStatus: "none",
  extensionStatus: "none", walkInPaymentStatus: "none", bookingPolicyVersion: 1,
  cancellationStatus: "requested", cancellationRequestedAt: at("17"),
  cancellationRequestedBy: "renter", cancellationRequestNote: "Plans changed",
  cancellationReviewedAt: null, cancellationReviewedBy: null,
  paymentStatus: "paid", paymentAmountPaid: 900, paymentAmountDue: 0,
  totalAmount: 800, baseAmount: 800, transactionFee: 100, rentalRateUnit: "hourly",
  vehicleDailyRate: 100, driverSelected: false, bookingWorkflowRevision: 2,
  lateReturnFeeType: "fixed_hourly", lateReturnFeeValue: 50, lateReturnGraceMinutes: 0,
  lateReturnIsOverdue: true, lateReturnOverdueMinutes: 120, lateReturnPenaltyRatePerHour: 50,
  lateReturnPenaltyFee: 0, lateReturnDetectedAt: at("16"), lateReturnNotifiedAt: at("16"),
  ...overrides,
});
const response = () => ({
  statusCode: 200, status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const request = (body = {}, query = {}) => ({
  params: { id: "507f1f77bcf86cd799439013" }, user: { _id: "owner" }, body, query,
  protocol: "https", get: () => "fixture.test",
});
const query = (value) => ({
  populate() { return this; }, select() { return this; }, sort() { return this; }, limit() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});
const same = (left, right) => left instanceof Date || right instanceof Date
  ? new Date(left).getTime() === new Date(right).getTime()
  : String(left?._id ?? left ?? "") === String(right?._id ?? right ?? "");
const matches = (booking, filter) => Object.entries(filter).every(([field, expected]) => {
  if (field === "$or") return expected.some((clause) => matches(booking, clause));
  if (field === "$and") return expected.every((clause) => matches(booking, clause));
  if (expected?.$in) return expected.$in.some((value) => same(booking[field], value));
  return same(booking[field], expected);
});
function setup(t, bookings = [fixture()]) {
  t.mock.timers.enable({ apis: ["Date"], now: at("18") });
  const state = { bookings, writes: [], notifications: [], saves: 0 };
  const snapshot = (booking) => booking && ({ ...booking, async save() {
    state.saves++;
    Object.assign(booking, this);
  } });
  t.mock.method(Booking, "findOne", (filter) => query(snapshot(bookings.find((item) => matches(item, filter)))));
  t.mock.method(Booking, "findById", (id) => query(snapshot(bookings.find((item) => same(item._id, id)))));
  t.mock.method(Booking, "find", (filter) => query(bookings.filter((item) => matches(item, filter)).map(snapshot)));
  t.mock.method(Booking, "exists", async () => false);
  t.mock.method(Vehicle, "findById", () => query(null));
  t.mock.method(Booking, "updateOne", async (filter, update) => {
    await state.beforeWrite?.(filter, update);
    const booking = bookings.find((item) => matches(item, filter));
    if (!booking) return { modifiedCount: 0 };
    Object.assign(booking, update.$set, { updatedAt: at("18") });
    for (const [field, increment] of Object.entries(update.$inc || {})) booking[field] = Number(booking[field] || 0) + increment;
    state.writes.push({ filter, update });
    return { modifiedCount: 1 };
  });
  t.mock.method(eventBus, "emit", (event) => { state.notifications.push(event); return false; });
  return state;
}

test("direct owner cancellation resolves a pending request atomically and preserves payments and return history", async (t) => {
  const state = setup(t);
  const original = { ...state.bookings[0] };
  const res = response();
  await updateOwnerBookingStatus(request({ status: "cancelled" }), res);
  assert.equal(res.statusCode, 200);
  const booking = state.bookings[0];
  assert.equal(booking.status, "cancelled");
  assert.equal(booking.cancellationStatus, "approved");
  assert.equal(booking.cancellationReviewedBy, "owner");
  assert.equal(booking.cancellationReviewAction, "approve");
  assert.equal(booking.cancellationReviewedAt.getTime(), at("18").getTime());
  assert.equal(booking.bookingWorkflowRevision, 3);
  for (const field of ["paymentStatus", "paymentAmountPaid", "paymentAmountDue", "totalAmount", "actualReturnAt", "cancellationRequestedAt", "cancellationRequestNote", "lateReturnOverdueMinutes"]) {
    assert.deepEqual(booking[field], original[field], field);
  }
  assert.equal(state.writes.length, 1);
  assert.equal(res.body.booking.cancellationRequest.status, "approved");
  assert.equal(res.body.booking.updatedAt.getTime(), booking.updatedAt.getTime());
  assert.equal(res.body.booking.lateReturn.isOverdue, false);
  assert.equal(res.body.booking.lateReturn.estimatedPenaltyFee, 0);
  for (const action of ["approve", "reject"]) {
    const stale = response();
    await reviewOwnerBookingCancellationRequest(request({ action }), stale);
    assert.equal(stale.statusCode, 400);
    assert.equal(stale.body.booking.status, "cancelled");
  }
  assert.equal(state.writes.length, 1);
});

test("direct cancellation without a pending request preserves earlier review metadata and finalized charges", async (t) => {
  const state = setup(t, [fixture({ cancellationStatus: "rejected", cancellationReviewedBy: "previous-owner", cancellationReviewNote: "Earlier decision", lateReturnPenaltyFee: 75 })]);
  const res = response();
  await updateOwnerBookingStatus(request({ status: "cancelled" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(state.bookings[0].cancellationStatus, "rejected");
  assert.equal(state.bookings[0].cancellationReviewedBy, "previous-owner");
  assert.equal(state.bookings[0].cancellationReviewNote, "Earlier decision");
  assert.equal(res.body.booking.lateReturn.penaltyFee, 75);
  assert.equal(res.body.booking.paymentAmountPaid, 900);
});

for (const action of ["approve", "reject"]) {
  test(`cancellation ${action} retains the request audit and preserves captured payments`, async (t) => {
    const state = setup(t);
    const res = response();
    await reviewOwnerBookingCancellationRequest(request({ action, expectedRequestedAt: at("17").toISOString(), note: "Reviewed" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(state.bookings[0].status, action === "approve" ? "cancelled" : "confirmed");
    assert.equal(state.bookings[0].cancellationStatus, action === "approve" ? "approved" : "rejected");
    assert.equal(state.bookings[0].cancellationReviewNote, "Reviewed");
    assert.equal(state.bookings[0].paymentAmountPaid, 900);
    assert.equal(state.bookings[0].actualReturnAt, null);
    assert.equal(state.writes.length, 1);
    assert.equal(state.saves, 0, "review decisions use conditional updates");
  });
}

test("concurrent approval and rejection commit only one cancellation decision", async (t) => {
  const state = setup(t);
  const results = [response(), response()];
  await Promise.all(["approve", "reject"].map((action, index) => reviewOwnerBookingCancellationRequest(request({ action }), results[index])));
  assert.deepEqual(results.map((res) => res.statusCode).sort(), [200, 409]);
  assert.equal(state.writes.length, 1);
  assert.equal(state.notifications.length, 1);
});

test("a stale cancellation rejection cannot overwrite a newer direct cancellation", async (t) => {
  const state = setup(t);
  state.beforeWrite = () => {
    Object.assign(state.bookings[0], { status: "cancelled", cancellationStatus: "approved", updatedAt: at("19"), bookingWorkflowRevision: 3 });
  };
  const res = response();
  await reviewOwnerBookingCancellationRequest(request({ action: "reject" }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(state.bookings[0].status, "cancelled");
  assert.equal(state.bookings[0].cancellationStatus, "approved");
  assert.equal(state.writes.length, 0);
  assert.equal(state.notifications.length, 0);
  assert.equal(res.body.booking.status, "cancelled");
});

test("a competing vehicle return prevents an older direct cancellation from committing", async (t) => {
  const state = setup(t);
  state.beforeWrite = () => {
    Object.assign(state.bookings[0], { status: "completed", actualReturnAt: at("17"), updatedAt: at("19"), bookingWorkflowRevision: 3 });
  };
  const res = response();
  await updateOwnerBookingStatus(request({ status: "cancelled" }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(state.bookings[0].status, "completed");
  assert.equal(state.writes.length, 0);
  assert.equal(state.notifications.length, 0);
});

test("a stale request identifier cannot review a replacement cancellation request", async (t) => {
  const state = setup(t);
  const res = response();
  await reviewOwnerBookingCancellationRequest(request({ action: "approve", expectedRequestedAt: at("16").toISOString() }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(state.writes.length, 0);
});

test("a replacement request arriving during review is protected by the conditional write", async (t) => {
  const state = setup(t);
  state.beforeWrite = () => { state.bookings[0].cancellationRequestedAt = at("18"); };
  const res = response();
  await reviewOwnerBookingCancellationRequest(request({ action: "approve" }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(state.writes.length, 0);
});

for (const handler of [updateOwnerBookingStatus, reviewOwnerBookingCancellationRequest]) {
  test(`${handler === updateOwnerBookingStatus ? "direct cancellation" : "cancellation review"} rejects a newer workflow even when its timestamp matches`, async (t) => {
    const state = setup(t);
    state.beforeWrite = () => { state.bookings[0].bookingWorkflowRevision++; };
    const res = response();
    await handler(request({ status: "cancelled", action: "approve" }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(state.bookings[0].status, "confirmed");
    assert.equal(state.writes.length, 0);
    assert.equal(state.notifications.length, 0);
  });
}

test("legacy requests without a workflow revision or request timestamp can still be reviewed", async (t) => {
  const state = setup(t, [fixture({ bookingWorkflowRevision: undefined, cancellationRequestedAt: undefined })]);
  const res = response();
  await reviewOwnerBookingCancellationRequest(request({ action: "approve" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(state.bookings[0].status, "cancelled");
  assert.equal(state.bookings[0].bookingWorkflowRevision, 1);
});

test("both cancellation paths protect a pending physical return", async (t) => {
  const state = setup(t, [fixture({ returnStatus: "requested" })]);
  for (const handler of [updateOwnerBookingStatus, reviewOwnerBookingCancellationRequest]) {
    const res = response();
    await handler(request({ status: "cancelled", action: "approve" }), res);
    assert.equal(res.statusCode, 409);
  }
  assert.equal(state.bookings[0].status, "confirmed");
  assert.equal(state.writes.length, 0);
});

test("cancellation writes stay scoped to the owning account", async (t) => {
  const state = setup(t);
  for (const handler of [updateOwnerBookingStatus, reviewOwnerBookingCancellationRequest]) {
    const res = response();
    await handler({ ...request({ status: "cancelled", action: "approve" }), user: { _id: "another-owner" } }, res);
    assert.equal(res.statusCode, 404);
  }
  assert.equal(state.writes.length, 0);
});

for (const handler of [getOwnerBookings, getOwnerBookingList]) {
  test(`${handler === getOwnerBookings ? "owner dashboard" : "booking"} API excludes terminal requests while retaining valid actions and history`, async (t) => {
    const bookings = ["cancelled", "rejected", "completed", "confirmed", "extended", "pending"].map((status, index) => fixture({ _id: `booking-${index}`, status }));
    setup(t, bookings);
    const actions = response();
    await handler(request({}, { view: "action" }), actions);
    assert.equal(actions.statusCode, 200);
    assert.deepEqual(actions.body.bookings.map((booking) => booking.status), ["confirmed", "extended", "pending"]);
    const history = response();
    await handler(request({}, { view: "history" }), history);
    assert.deepEqual(history.body.bookings.map((booking) => booking.status), ["cancelled", "rejected", "completed"]);
    assert.equal(history.body.bookings[0].cancellationRequest.status, "requested", "legacy audit is retained");
    assert.equal(history.body.bookings[0].lateReturn.isOverdue, false);
    assert.equal(history.body.bookings[0].lateReturn.estimatedPenaltyFee, 0);
  });
}

for (const status of ["cancelled", "rejected"]) {
  for (const version of [1, 2]) {
    test(`${status} policy v${version} stops estimates while preserving finalized fees and stored history`, () => {
      const booking = fixture({ status, bookingPolicyVersion: version, originalReturnAt: at("16"), extensionHistory: [] });
      const original = structuredClone(booking);
      const first = calculateBookingLateReturn(booking, at("18"));
      const later = calculateBookingLateReturn(booking, at("23"));
      assert.equal(first.isOverdue, false);
      assert.equal(first.estimatedPenaltyFee, 0);
      assert.equal(later.overdueMinutes, first.overdueMinutes);
      assert.equal(later.estimatedPenaltyFee, 0);
      assert.equal(getEstimatedLateReturnPenaltyFee(booking), 0);
      const payload = { ...booking, bookingPolicy: { version }, lateReturn: { isOverdue: true, overdueMinutes: 120, accruedOverdueMinutes: 60, penaltyRatePerHour: 50, penaltyFee: 0 } };
      const display = getBookingLateReturnInfo(payload, at("23").getTime());
      assert.equal(display.isOverdue, false);
      assert.equal(display.accruedOverdueMinutes, 0);
      assert.equal(display.estimatedPenaltyFee, 0);
      booking.lateReturnPenaltyFee = 75;
      assert.equal(getEstimatedLateReturnPenaltyFee(booking), 75);
      assert.equal(getBookingLateReturnInfo({ ...payload, lateReturn: { ...payload.lateReturn, penaltyFee: 75 } }).penaltyFee, 75);
      booking.lateReturnPenaltyFee = 0;
      assert.deepEqual(booking, original, "calculation does not rewrite historical records");
    });
  }
}
