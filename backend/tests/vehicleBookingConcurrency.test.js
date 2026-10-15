import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";
import User from "../models/User.js";
import { approvedAccountFixture } from "./helpers/approvedAccountFixture.js";
import eventBus from "../events/eventBus.js";
import { createBooking } from "../controllers/booking.controller.js";
import { setOwnerVehicleAvailability } from "../controllers/ownerVehicle.controller.js";
import { hasActiveBookingForVehicle, syncVehicleAvailabilityByBookingState } from "../utils/vehicleAvailability.js";

const vehicleId = "64b000000000000000000001";
const now = new Date("2030-01-01T12:00:00Z");
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const query = (value) => ({
  select() { return this; }, maxTimeMS() { return this; },
  lean: async () => value, populate: async () => value,
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const request = (renter = "renter-a", overrides = {}) => ({
  user: { _id: renter, role: "user" },
  body: { vehicleId, pickupAt: "2030-01-02T10:00:00Z", returnAt: "2030-01-02T14:00:00Z", ...overrides },
  protocol: "https", get: () => "fixture.test",
});

function database(t) {
  approvedAccountFixture(t);
  t.mock.timers.enable({ apis: ["Date"], now });
  const state = {
    bookings: [], leases: new Map(),
    vehicle: {
      _id: vehicleId, owner: "owner", name: "Fixture vehicle", dailyRentalRate: 250,
      pricingUnit: "hourly", availabilityStatus: "available", availabilityHoldReason: "none",
      bookingReservationId: null, images: [],
    },
  };
  const matches = (filter) => Object.entries(filter).every(([key, value]) => {
    const actual = state.vehicle[key] ?? null;
    if (value?.$in) return value.$in.includes(actual);
    return String(value ?? null) === String(actual);
  });
  const document = () => {
    const snapshot = { ...state.vehicle };
    return { ...snapshot, async save() {
      for (const key of ["availabilityStatus", "availabilityHoldReason"]) {
        if (this[key] !== snapshot[key]) state.vehicle[key] = this[key];
      }
    } };
  };
  t.mock.method(User, "updateOne", async (filter, update) => {
    const token = state.leases.get(filter._id);
    if (update.$unset) {
      if (token === filter.bookingMutationToken) state.leases.delete(filter._id);
      return { modifiedCount: 1 };
    }
    if (filter.bookingMutationToken) return { matchedCount: token === filter.bookingMutationToken ? 1 : 0 };
    if (token) return { modifiedCount: 0 };
    state.leases.set(filter._id, update.$set.bookingMutationToken);
    return { modifiedCount: 1 };
  });
  t.mock.method(Vehicle, "findById", () => query(document()));
  t.mock.method(Vehicle, "findOne", () => query(document()));
  t.mock.method(Vehicle, "findOneAndUpdate", async (filter, update) => {
    if (!matches(filter)) return null;
    Object.assign(state.vehicle, update.$set);
    return document();
  });
  t.mock.method(Vehicle, "updateOne", async (filter, update) => {
    await state.beforeVehicleUpdate?.(filter, update);
    if (!matches(filter)) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(state.vehicle, update.$set);
    for (const key of Object.keys(update.$unset || {})) delete state.vehicle[key];
    return { matchedCount: 1, modifiedCount: 1 };
  });
  t.mock.method(Booking, "find", (filter) => query(state.bookings.filter((booking) => booking.renter === filter.renter)));
  t.mock.method(Booking, "findOne", async (filter) => {
    const booking = state.bookings.find((entry) => entry.vehicle === filter.vehicle &&
      filter.status.$in.includes(entry.status) && entry.pickupAt < filter.pickupAt.$lt && entry.returnAt > filter.returnAt.$gt);
    await state.beforeOverlapResult?.();
    return booking || null;
  });
  t.mock.method(Booking, "exists", async (filter) => {
    const exists = state.bookings.some((booking) => booking.vehicle === filter.vehicle &&
      filter.status.$in.includes(booking.status) && !booking.actualReturnAt);
    await state.beforeExistsResult?.();
    return exists;
  });
  t.mock.method(Booking, "findById", (id) => query(state.bookings.find((booking) => String(booking._id) === String(id)) || null));
  t.mock.method(Booking, "create", async (data) => {
    await state.beforeBookingInsert?.();
    const booking = { ...data };
    state.bookings.push(booking);
    await state.afterBookingInsert?.();
    return booking;
  });
  t.mock.method(eventBus, "emit", () => {});
  return state;
}

test("two different renters booking the same vehicle concurrently create only one pending booking", async (t) => {
  const state = database(t);
  const results = [response(), response()];
  await Promise.all(results.map((res, index) => createBooking(request(`renter-${index}`), res)));
  assert.deepEqual(results.map((res) => res.statusCode).sort(), [201, 409]);
  assert.equal(state.bookings.length, 1);
  assert.equal(state.bookings[0].status, "pending");
  assert.equal(state.bookings[0].paymentStatus, "unpaid");
  assert.equal(String(state.vehicle.bookingReservationId), String(state.bookings[0]._id));
});

test("availability synchronization cannot reopen a vehicle between reservation and booking insertion", async (t) => {
  const state = database(t);
  const entered = deferred(), resume = deferred();
  state.beforeOverlapResult = async () => { entered.resolve(); await resume.promise; };
  const first = response();
  const pending = createBooking(request(), first);
  await entered.promise;
  try {
    assert.equal(state.bookings.length, 0);
    assert.equal(await syncVehicleAvailabilityByBookingState(vehicleId), "unavailable");
    assert.equal(await hasActiveBookingForVehicle(vehicleId), true);
    const second = response();
    await createBooking(request("renter-b"), second);
    assert.equal(second.statusCode, 409);
  } finally {
    resume.resolve();
    await pending;
  }
  assert.equal(first.statusCode, 201);
  assert.equal(state.bookings.length, 1);
});

test("a stale availability snapshot cannot overwrite a reservation acquired after its booking check", async (t) => {
  const state = database(t);
  state.vehicle.availabilityStatus = "unavailable";
  let interleaved = false;
  state.beforeVehicleUpdate = async () => {
    if (interleaved) return;
    interleaved = true;
    state.vehicle.availabilityStatus = "available";
    state.beforeVehicleUpdate = null;
    const res = response();
    await createBooking(request(), res);
    assert.equal(res.statusCode, 201);
  };
  assert.equal(await syncVehicleAvailabilityByBookingState(vehicleId), "unavailable");
  assert.equal(state.vehicle.availabilityStatus, "unavailable");
  assert.equal(String(state.vehicle.bookingReservationId), String(state.bookings[0]._id));
});

test("an availability-only overwrite cannot admit a second booking, including different dates", async (t) => {
  const state = database(t);
  const first = response();
  await createBooking(request(), first);
  state.vehicle.availabilityStatus = "available";
  const second = response();
  await createBooking(request("renter-b", { pickupAt: "2030-01-03T10:00:00Z", returnAt: "2030-01-03T14:00:00Z" }), second);
  assert.equal(second.statusCode, 409);
  assert.equal(state.bookings.length, 1);
  await syncVehicleAvailabilityByBookingState(vehicleId);
  assert.equal(state.vehicle.availabilityStatus, "unavailable");
});

test("owners cannot mark an in-flight reservation available before its booking exists", async (t) => {
  const state = database(t);
  state.vehicle.availabilityStatus = "unavailable";
  state.vehicle.bookingReservationId = new mongoose.Types.ObjectId();
  const res = response();
  await setOwnerVehicleAvailability({ params: { id: vehicleId }, user: { _id: "owner" }, body: { availabilityStatus: "available" } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(state.vehicle.availabilityStatus, "unavailable");
});

test("validation failures release only their own unsaved reservation and allow a retry", async (t) => {
  const state = database(t);
  state.beforeBookingInsert = async () => { throw new mongoose.Error.ValidationError(); };
  const failed = response();
  await createBooking(request(), failed);
  assert.equal(failed.statusCode, 500);
  assert.equal(state.vehicle.availabilityStatus, "available");
  assert.equal(state.vehicle.bookingReservationId, undefined);
  assert.equal(state.leases.size, 0);
  state.beforeBookingInsert = null;
  const retried = response();
  await createBooking(request("renter-b"), retried);
  assert.equal(retried.statusCode, 201);
  assert.equal(state.bookings.length, 1);
});

test("an unknown insert outcome keeps the reservation even when no booking is visible yet", async (t) => {
  const state = database(t);
  state.beforeBookingInsert = async () => { throw new Error("fixture connection interrupted"); };
  const failed = response();
  await createBooking(request(), failed);
  assert.equal(failed.statusCode, 500);
  assert.ok(state.vehicle.bookingReservationId);
  assert.equal(state.leases.size, 0);
  state.beforeBookingInsert = null;
  const second = response();
  await createBooking(request("renter-b"), second);
  assert.equal(second.statusCode, 409);
  assert.equal(state.bookings.length, 0);
});

test("a saved booking whose acknowledgement is lost keeps its reservation", async (t) => {
  const state = database(t);
  state.afterBookingInsert = async () => { throw new Error("fixture acknowledgement lost"); };
  const first = response();
  await createBooking(request(), first);
  assert.equal(first.statusCode, 500);
  assert.equal(state.bookings.length, 1);
  assert.equal(String(state.vehicle.bookingReservationId), String(state.bookings[0]._id));
  const second = response();
  await createBooking(request("renter-b"), second);
  assert.equal(second.statusCode, 409);
});

for (const status of ["cancelled", "rejected"]) {
  test(`${status} bookings release their reservation without blocking a new renter`, async (t) => {
    const state = database(t);
    await createBooking(request(), response());
    state.bookings[0].status = status;
    assert.equal(await syncVehicleAvailabilityByBookingState(vehicleId), "available");
    assert.equal(state.vehicle.bookingReservationId, undefined);
    const next = response();
    await createBooking(request("renter-b"), next);
    assert.equal(next.statusCode, 201);
  });
}

test("physical return releases the reservation while the inspection hold still blocks booking", async (t) => {
  const state = database(t);
  await createBooking(request(), response());
  state.bookings[0].status = "completed";
  state.bookings[0].actualReturnAt = now;
  state.vehicle.availabilityHoldReason = "inspection";
  assert.equal(await syncVehicleAvailabilityByBookingState(vehicleId), "unavailable");
  assert.equal(state.vehicle.bookingReservationId, undefined);
  const blocked = response();
  await createBooking(request("renter-b"), blocked);
  assert.equal(blocked.statusCode, 409);
  const owner = response();
  await setOwnerVehicleAvailability({ params: { id: vehicleId }, user: { _id: "owner" }, body: { availabilityStatus: "available" } }, owner);
  assert.equal(owner.statusCode, 200);
  assert.equal(state.vehicle.availabilityHoldReason, "none");
  const next = response();
  await createBooking(request("renter-b"), next);
  assert.equal(next.statusCode, 201);
});

test("a delayed release cannot clear a newer reservation", async (t) => {
  const state = database(t);
  const oldReservation = new mongoose.Types.ObjectId(), newReservation = new mongoose.Types.ObjectId();
  state.vehicle.availabilityStatus = "unavailable";
  state.vehicle.bookingReservationId = oldReservation;
  state.beforeVehicleUpdate = async () => {
    state.beforeVehicleUpdate = null;
    state.vehicle.bookingReservationId = newReservation;
  };
  assert.equal(await syncVehicleAvailabilityByBookingState(vehicleId, { releaseReservationId: oldReservation }), "unavailable");
  assert.equal(state.vehicle.bookingReservationId, newReservation);
  assert.equal(state.vehicle.availabilityStatus, "unavailable");
});

test("a concurrent manual hold cannot be erased by an availability synchronization", async (t) => {
  const state = database(t);
  state.vehicle.availabilityStatus = "unavailable";
  state.beforeVehicleUpdate = async () => {
    state.beforeVehicleUpdate = null;
    state.vehicle.availabilityHoldReason = "manual";
  };
  assert.equal(await syncVehicleAvailabilityByBookingState(vehicleId), "unavailable");
  assert.equal(state.vehicle.availabilityHoldReason, "manual");
});

test("manual and inspection holds block claims even when an unrelated update sets availability to available", async (t) => {
  const state = database(t);
  for (const hold of ["manual", "inspection"]) {
    state.vehicle.availabilityHoldReason = hold;
    const res = response();
    await createBooking(request(), res);
    assert.equal(res.statusCode, 409);
  }
  assert.equal(state.bookings.length, 0);
});
