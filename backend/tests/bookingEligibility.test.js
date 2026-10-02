import test from "node:test";
import assert from "node:assert/strict";
import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";
import User from "../models/User.js";
import eventBus from "../events/eventBus.js";
import { evaluateBookingEligibility, getRenterBookingEligibility } from "../services/bookingEligibility.service.js";
import { acquireBookingMutationLock } from "../utils/bookingMutationLock.js";
import { createBooking, getMyBookingEligibility, requestBookingExtension } from "../controllers/booking.controller.js";
import { reviewOwnerBookingExtensionRequest } from "../controllers/ownerDashboard.controller.js";
import bookingRouter from "../routes/booking.routes.js";
import { protect } from "../middleware/auth.middleware.js";

const now = new Date("2030-01-01T12:00:00Z");
const fixture = (overrides = {}) => ({
  _id: "booking-000001", renter: "renter", owner: "owner", vehicle: "vehicle",
  status: "confirmed", pickupAt: new Date("2030-01-01T10:00:00Z"), returnAt: new Date("2030-01-01T14:00:00Z"),
  actualReturnAt: null, returnStatus: "none", paymentStatus: "partial",
  totalAmount: 1000, transactionFee: 140, paymentAmountPaid: 342, paymentAmountDue: 798,
  lateReturnPenaltyFee: 0, lateReturnGraceMinutes: 15, vehicleDailyRate: 250, rentalRateUnit: "hourly",
  ...overrides,
});
const eligibility = (bookings, options = {}) => evaluateBookingEligibility(bookings, { now, ...options });
const codes = (result) => result.reasons.map((reason) => reason.code);
const response = () => ({ statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, set(key, value) { this.headers[key] = value; }, json(body) { this.body = body; return this; } });
const queryResult = (value) => ({ select() { return this; }, maxTimeMS() { return this; }, lean: async () => value, populate: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });

test("confirmed and extended partial payments remain eligible before return, including walk-in arrangements", () => {
  for (const status of ["confirmed", "extended"]) {
    for (const walkInPaymentStatus of ["none", "requested", "approved"]) {
      assert.equal(eligibility([fixture({ status, walkInPaymentStatus })]).eligible, true);
    }
  }
});

test("pending unpaid requests and upcoming confirmed unpaid rentals are not overdue debt", () => {
  assert.equal(eligibility([fixture({ status: "pending", paymentStatus: "unpaid", paymentAmountPaid: 0 })]).eligible, true);
  assert.equal(eligibility([fixture({ pickupAt: new Date("2030-01-02"), returnAt: new Date("2030-01-03"), paymentStatus: "unpaid", paymentAmountPaid: 0 })]).eligible, true);
});

test("overdue return is detected from the clock even when fully paid and the lifecycle flag is stale", () => {
  const result = eligibility([fixture({ returnAt: new Date("2030-01-01T11:00:00Z"), paymentStatus: "paid", paymentAmountPaid: 1140, paymentAmountDue: 0, lateReturnIsOverdue: false })]);
  assert.deepEqual(codes(result), ["OVERDUE_VEHICLE_RETURN"]);
});

test("return grace boundary is respected and a stale overdue flag does not block an approved extension", () => {
  const booking = fixture({ returnAt: new Date("2030-01-01T11:45:00Z"), paymentStatus: "paid", paymentAmountPaid: 1140 });
  assert.equal(eligibility([booking]).eligible, true);
  assert.deepEqual(codes(eligibility([booking], { now: new Date(now.getTime() + 1) })), ["OVERDUE_VEHICLE_RETURN"]);
  assert.equal(eligibility([fixture({ lateReturnIsOverdue: true })]).eligible, true);
});

test("an overdue rental balance blocks new bookings even within vehicle-return grace", () => {
  const result = eligibility([fixture({ returnAt: new Date("2030-01-01T11:50:00Z") })]);
  assert.deepEqual(codes(result), ["OVERDUE_BOOKING_BALANCE"]);
  assert.equal(result.reasons[0].amountDue, 798);
});

test("returned/completed unpaid bookings block even with no late penalty, including an early return", () => {
  for (const overrides of [{ status: "completed" }, { actualReturnAt: now, returnStatus: "confirmed" }]) {
    assert.deepEqual(codes(eligibility([fixture(overrides)])), ["OVERDUE_BOOKING_BALANCE"]);
  }
});

test("final penalty remains blocking after walk-in approval until payment is actually confirmed", () => {
  const booking = fixture({ status: "completed", lateReturnPenaltyFee: 350, paymentAmountPaid: 1140, walkInPaymentStatus: "approved" });
  const blocked = eligibility([booking]);
  assert.deepEqual(codes(blocked), ["UNPAID_LATE_RETURN_PENALTY"]);
  assert.equal(blocked.reasons[0].amountDue, 350);
  assert.equal(eligibility([{ ...booking, paymentAmountPaid: 1490, paymentAmountDue: 0, paymentStatus: "paid", walkInPaymentStatus: "completed" }]).eligible, true);
});

test("paid historic penalties, waived penalties, and legacy paid records do not block", () => {
  assert.equal(eligibility([fixture({ status: "completed", lateReturnPenaltyFee: 350, paymentAmountPaid: 1490, paymentStatus: "paid" })]).eligible, true);
  assert.equal(eligibility([fixture({ status: "completed", lateReturnPenaltyFee: 0, paymentAmountPaid: 1140, paymentAmountDue: 0 })]).eligible, true);
  assert.equal(eligibility([fixture({ status: "completed", paymentStatus: "paid", paymentAmountPaid: 0, paymentAmountDue: 0 })]).eligible, true);
});

test("running penalty estimates are not finalized debt", () => {
  assert.equal(eligibility([fixture({ lateReturnIsOverdue: true, lateReturnOverdueMinutes: 60, lateReturnPenaltyRatePerHour: 100 })]).eligible, true);
});

test("cancelled/rejected bookings and completed refunds do not consume slots or block", () => {
  const history = ["cancelled", "rejected", "completed"].map((status) => fixture({ status, paymentStatus: "refunded" }));
  const result = eligibility(history);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.counts, { open: 0, pending: 0 });
});

test("three open bookings block a fourth; all open statuses count", () => {
  const result = eligibility([fixture(), fixture({ status: "extended" }), fixture({ status: "pending" })]);
  assert.deepEqual(codes(result), ["OPEN_BOOKING_LIMIT"]);
  assert.deepEqual(result.counts, { open: 3, pending: 1 });
});

test("two pending requests block another; an owner decision or cancellation frees a pending slot", () => {
  const pending = fixture({ status: "pending" });
  assert.deepEqual(codes(eligibility([pending, pending])), ["PENDING_BOOKING_LIMIT"]);
  assert.equal(eligibility([pending, fixture({ status: "confirmed" })]).eligible, true);
  assert.equal(eligibility([pending, fixture({ status: "cancelled" })]).eligible, true);
});

test("overlapping schedules are blocked across vehicles, owners, pending requests and driver rentals", () => {
  for (const status of ["pending", "confirmed", "extended"]) {
    const result = eligibility([fixture({ status, driverSelected: true })], { pickupAt: "2030-01-01T13:00:00Z", returnAt: "2030-01-01T15:00:00Z" });
    assert.deepEqual(codes(result), ["RENTER_SCHEDULE_CONFLICT"]);
  }
});

test("back-to-back schedules and non-overlapping future bookings are allowed", () => {
  for (const pickupAt of ["2030-01-01T14:00:00Z", "2030-01-02T10:00:00Z"]) {
    assert.equal(eligibility([fixture()], { pickupAt, returnAt: "2030-01-03T14:00:00Z" }).eligible, true);
  }
  assert.equal(eligibility([fixture({ actualReturnAt: now, paymentStatus: "paid", paymentAmountPaid: 1140 })], { pickupAt: now, returnAt: "2030-01-01T14:00:00Z" }).eligible, true);
});

test("eligibility queries are scoped to the signed-in renter and preflight is private/non-cacheable", async (t) => {
  t.mock.method(Booking, "find", (filter) => {
    assert.equal(filter.renter, "renter");
    assert.ok(filter.$or.some((entry) => entry.status === "completed"));
    return queryResult([fixture()]);
  });
  assert.equal((await getRenterBookingEligibility("renter", { now })).eligible, true);
  const res = response();
  await getMyBookingEligibility({ user: { _id: "renter" }, query: { renter: "someone-else" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  const invalid = response();
  await getMyBookingEligibility({ user: { _id: "renter" }, query: { pickupAt: "bad-date" } }, invalid);
  assert.equal(invalid.statusCode, 400);
});

test("preflight is authenticated and declared before the booking ID route", () => {
  const routes = bookingRouter.stack.filter((layer) => layer.route);
  const index = routes.findIndex((layer) => layer.route.path === "/eligibility");
  assert.ok(index >= 0);
  assert.equal(routes[index].route.stack[0].handle, protect);
  assert.ok(index < routes.findIndex((layer) => layer.route.path === "/:id"));
});

function mockLease(t) {
  let heldToken = null;
  t.mock.method(User, "updateOne", async (filter, update) => {
    if (update.$unset) {
      if (heldToken === filter.bookingMutationToken) heldToken = null;
      return { modifiedCount: 1 };
    }
    if (filter.bookingMutationToken) return { matchedCount: heldToken === filter.bookingMutationToken ? 1 : 0 };
    if (heldToken) return { modifiedCount: 0 };
    heldToken = update.$set.bookingMutationToken;
    return { modifiedCount: 1 };
  });
  return () => heldToken;
}

test("database lease serializes the same renter and can be acquired after release", async (t) => {
  const held = mockLease(t);
  const first = await acquireBookingMutationLock("renter");
  await assert.rejects(acquireBookingMutationLock("renter"), { code: "BOOKING_UPDATE_IN_PROGRESS" });
  await first.renew();
  await first.release();
  assert.equal(held(), null);
  const second = await acquireBookingMutationLock("renter");
  await first.release();
  assert.notEqual(held(), null, "an older token cannot unlock a new request");
  await second.release();
});

test("a lost or expired lease prevents a delayed request from writing", async (t) => {
  mockLease(t);
  const lock = await acquireBookingMutationLock("renter");
  await lock.release();
  await assert.rejects(lock.renew(), { code: "BOOKING_UPDATE_IN_PROGRESS" });
});

function mockCreation(t, bookings) {
  t.mock.timers.enable({ apis: ["Date"], now });
  const held = mockLease(t);
  let vehicleWrites = 0;
  const vehicles = new Map(["vehicle-a", "vehicle-b"].map((_id) => [_id, {
    _id, owner: "owner", name: "Fixture vehicle", dailyRentalRate: 250, pricingUnit: "hourly",
    availabilityStatus: "available", availabilityHoldReason: "none", images: [], save: async () => {},
  }]));
  t.mock.method(Booking, "find", () => queryResult(bookings));
  t.mock.method(Booking, "findOne", () => queryResult(null));
  t.mock.method(Booking, "exists", async () => true);
  t.mock.method(Booking, "create", async (data) => {
    const booking = { ...data, _id: `new-${bookings.length}` };
    bookings.push(booking);
    return booking;
  });
  t.mock.method(Booking, "findById", (id) => queryResult(bookings.find((booking) => booking._id === id)));
  t.mock.method(Vehicle, "findById", (id) => queryResult(vehicles.get(id)));
  t.mock.method(Vehicle, "findOneAndUpdate", async (filter) => {
    vehicleWrites++;
    const vehicle = vehicles.get(filter._id);
    vehicle.availabilityStatus = "unavailable";
    return vehicle;
  });
  t.mock.method(eventBus, "emit", () => {});
  return { held, vehicleWrites: () => vehicleWrites };
}
const createRequest = (vehicleId = "vehicle-a", day = 2) => ({
  user: { _id: "renter", role: "user" },
  body: { vehicleId, pickupAt: `2030-01-${String(day).padStart(2, "0")}T10:00:00Z`, returnAt: `2030-01-${String(day).padStart(2, "0")}T14:00:00Z` },
  protocol: "https", get: () => "rentifypro.test",
});

test("direct POST is denied before touching vehicle availability when the renter has due penalties", async (t) => {
  const bookings = [fixture({ status: "completed", lateReturnPenaltyFee: 350, paymentAmountPaid: 1140 })];
  const state = mockCreation(t, bookings);
  const res = response();
  await createBooking(createRequest(), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "UNPAID_LATE_RETURN_PENALTY");
  assert.equal(bookings.length, 1);
  assert.equal(state.vehicleWrites(), 0);
  assert.equal(state.held(), null);
});

test("concurrent POSTs cannot exceed two pending requests, even for different vehicles and dates", async (t) => {
  const bookings = [fixture({ status: "pending" })];
  const state = mockCreation(t, bookings);
  const responses = [response(), response()];
  await Promise.all(responses.map((res, index) => createBooking(createRequest(index ? "vehicle-b" : "vehicle-a", index + 2), res)));
  assert.deepEqual(responses.map((res) => res.statusCode).sort(), [201, 409]);
  assert.equal(bookings.length, 2);
  assert.equal(state.held(), null);
  const retry = response();
  await createBooking(createRequest("vehicle-b", 3), retry);
  assert.equal(retry.body.code, "PENDING_BOOKING_LIMIT");
  assert.equal(state.vehicleWrites(), 1);
});

test("concurrent POSTs cannot exceed three open bookings", async (t) => {
  const bookings = [fixture(), fixture({ _id: "booking-000002", status: "extended" })];
  mockCreation(t, bookings);
  const responses = [response(), response()];
  await Promise.all(responses.map((res, index) => createBooking(createRequest(index ? "vehicle-b" : "vehicle-a", index + 2), res)));
  assert.deepEqual(responses.map((res) => res.statusCode).sort(), [201, 409]);
  const retry = response();
  await createBooking(createRequest("vehicle-b", 3), retry);
  assert.equal(retry.body.code, "OPEN_BOOKING_LIMIT");
  assert.equal(bookings.length, 3);
});

test("creation failures release the renter lease and preserve retry access", async (t) => {
  const state = mockCreation(t, []);
  t.mock.method(Booking, "create", async () => { throw new Error("fixture write failure"); });
  const res = response();
  await createBooking(createRequest(), res);
  assert.equal(res.statusCode, 500);
  assert.equal(state.held(), null);
});

test("an eligibility database failure does not reserve a vehicle or bypass the rules", async (t) => {
  const state = mockCreation(t, []);
  t.mock.method(Booking, "find", () => { throw new Error("fixture eligibility outage"); });
  const res = response();
  await createBooking(createRequest(), res);
  assert.equal(res.statusCode, 500);
  assert.equal(state.vehicleWrites(), 0);
  assert.equal(state.held(), null);
});

test("a direct POST cannot book overlapping dates even with free booking slots", async (t) => {
  const state = mockCreation(t, [fixture({ pickupAt: new Date("2030-01-02T10:00:00Z"), returnAt: new Date("2030-01-02T14:00:00Z") })]);
  const res = response();
  await createBooking(createRequest(), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "RENTER_SCHEDULE_CONFLICT");
  assert.equal(state.vehicleWrites(), 0);
});

test("extension review and creation share the same renter lease", async (t) => {
  const state = mockCreation(t, []);
  const booking = fixture({ extensionStatus: "requested", extensionRequestedReturnAt: new Date("2030-01-01T18:00:00Z") });
  const lock = await acquireBookingMutationLock("renter");
  t.mock.method(Booking, "findOne", () => queryResult(booking));
  const res = response();
  await reviewOwnerBookingExtensionRequest({ params: { id: "booking" }, user: { _id: "owner" }, body: { action: "approve" } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "BOOKING_UPDATE_IN_PROGRESS");
  assert.notEqual(state.held(), null, "the competing review must not release the creation lease");
  await lock.release();
});

test("extension requests cannot bypass the six-month booking horizon", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const booking = fixture({ extensionStatus: "none" });
  t.mock.method(Booking, "findOne", () => queryResult(booking));
  const res = response();
  await requestBookingExtension({
    params: { id: "booking" },
    user: { _id: "renter" },
    body: { newReturnAt: "2030-07-02T10:00:00Z" },
  }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /within 6 months/);
});

for (const [label, handler, body] of [
  ["request", requestBookingExtension, { newReturnAt: "2030-01-01T18:00:00Z" }],
  ["approval", reviewOwnerBookingExtensionRequest, { action: "approve" }],
]) {
  test(`extension ${label} checks other vehicles held by the same renter without changing the schedule`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now });
    mockLease(t);
    let saves = 0;
    const booking = fixture({ extensionStatus: label === "request" ? "none" : "requested", extensionRequestedReturnAt: new Date("2030-01-01T18:00:00Z"), save: async () => { saves++; } });
    t.mock.method(Booking, "findOne", (filter) => {
      if (filter._id === "booking") return queryResult(booking);
      if (filter.renter) {
        assert.equal(filter.renter, "renter");
        assert.equal(filter._id.$ne, booking._id);
        return queryResult({ _id: "other-vehicle-booking" });
      }
      return queryResult(null);
    });
    const res = response();
    await handler({ params: { id: "booking" }, user: { _id: label === "request" ? "renter" : "owner" }, body }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "RENTER_SCHEDULE_CONFLICT");
    assert.equal(booking.returnAt.toISOString(), "2030-01-01T14:00:00.000Z");
    assert.equal(saves, 0);
  });
}
