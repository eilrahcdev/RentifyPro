import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";
import User from "../models/User.js";
import eventBus from "../events/eventBus.js";
import { createBooking, cancelMyBooking, requestBookingExtension, requestBookingReturn } from "../controllers/booking.controller.js";
import { updateOwnerBookingStatus, confirmOwnerVehicleReturn, reviewOwnerBookingExtensionRequest } from "../controllers/ownerDashboard.controller.js";
import { setOwnerVehicleAvailability } from "../controllers/ownerVehicle.controller.js";
import { syncVehicleAvailabilityByBookingState } from "../utils/vehicleAvailability.js";

// Always use a new fixture database on loopback, never the configured application database.
const databaseName = `rentifypro_booking_fixture_${randomUUID().replaceAll("-", "")}`;
const port = Number(process.env.BOOKING_MONGO_FIXTURE_PORT || 27017);
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
let connection, FixtureBooking, FixtureVehicle, FixtureUser;
let beforeOverlapResult, beforeVehicleUpdate;
let created = false;

async function fixture() {
  const owner = new mongoose.Types.ObjectId();
  const renters = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  await FixtureUser.collection.insertMany([owner, ...renters].map((_id, index) => ({
    _id, name: `Fixture participant ${index}`, email: `${_id}@fixture.invalid`,
    role: index === 0 ? "owner" : "user", kycStatus: "approved",
  })));
  const vehicle = await FixtureVehicle.create({
    owner, name: "Fixture vehicle", description: "Synthetic concurrency check", location: "Fixture location",
    dailyRentalRate: 250, pricingUnit: "hourly", availabilityStatus: "available",
  });
  const pickupAt = new Date(Date.now() + 48 * 3_600_000).toISOString();
  const returnAt = new Date(Date.now() + 52 * 3_600_000).toISOString();
  const request = (index = 0) => ({
    user: { _id: renters[index], role: "user" },
    body: { vehicleId: String(vehicle._id), pickupAt, returnAt },
    protocol: "https", get: () => "fixture.invalid",
  });
  const ownerRequest = (id, body) => ({
    params: { id: String(id) }, user: { _id: owner, role: "owner" }, body,
    protocol: "https", get: () => "fixture.invalid",
  });
  return { vehicle, request, ownerRequest };
}

async function main() {
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, "Invalid fixture port");
  connection = await mongoose.createConnection(`mongodb://127.0.0.1:${port}/${databaseName}`, {
    autoIndex: false, serverSelectionTimeoutMS: 5000,
  }).asPromise();
  FixtureBooking = connection.model("Booking", Booking.schema);
  FixtureVehicle = connection.model("Vehicle", Vehicle.schema);
  FixtureUser = connection.model("User", User.schema);
  created = true;
  await Promise.all([FixtureBooking.createCollection(), FixtureVehicle.createCollection(), FixtureUser.createCollection()]);
  for (const method of ["find", "exists", "findById", "create", "updateOne"]) {
    mock.method(Booking, method, (...args) => FixtureBooking[method](...args));
  }
  mock.method(Booking, "findOne", (...args) => {
    const query = FixtureBooking.findOne(...args);
    if (beforeOverlapResult && args[0].vehicle) {
      return (async () => { const result = await query; await beforeOverlapResult(); return result; })();
    }
    return query;
  });
  for (const method of ["findById", "findOne", "findOneAndUpdate"]) {
    mock.method(Vehicle, method, (...args) => FixtureVehicle[method](...args));
  }
  mock.method(Vehicle, "updateOne", (...args) => {
    if (beforeVehicleUpdate) {
      return (async () => { await beforeVehicleUpdate(); return FixtureVehicle.updateOne(...args); })();
    }
    return FixtureVehicle.updateOne(...args);
  });
  mock.method(User, "updateOne", (...args) => FixtureUser.updateOne(...args));
  mock.method(eventBus, "emit", () => {});

  {
    const { vehicle, request } = await fixture();
    const responses = [response(), response()];
    await Promise.all(responses.map((res, index) => createBooking(request(index), res)));
    assert.deepEqual(responses.map((res) => res.statusCode).sort(), [201, 409]);
    assert.equal(await FixtureBooking.countDocuments({ vehicle: vehicle._id }), 1);
    const booking = await FixtureBooking.findOne({ vehicle: vehicle._id });
    const stored = await FixtureVehicle.findById(vehicle._id).select("+bookingReservationId");
    assert.equal(String(stored.bookingReservationId), String(booking._id));
    assert.equal(booking.status, "pending");
    assert.equal(booking.paymentStatus, "unpaid");
    assert.equal(Object.hasOwn(await FixtureVehicle.findById(vehicle._id).lean(), "bookingReservationId"), false);
    console.log("PASS: Concurrent renters create one pending booking; reservation metadata stays private.");
  }

  {
    const { vehicle, request, ownerRequest } = await fixture();
    const entered = deferred(), resume = deferred();
    beforeOverlapResult = async () => { entered.resolve(); await resume.promise; };
    const first = response();
    const pending = createBooking(request(), first);
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error("Booking did not reach overlap check"); })]);
      assert.equal(await FixtureBooking.countDocuments({ vehicle: vehicle._id }), 0);
      assert.equal(await syncVehicleAvailabilityByBookingState(vehicle._id), "unavailable");
      const owner = response();
      await setOwnerVehicleAvailability(ownerRequest(vehicle._id, { availabilityStatus: "available" }), owner);
      assert.equal(owner.statusCode, 409);
      await FixtureVehicle.updateOne({ _id: vehicle._id }, { $set: { availabilityStatus: "available" } });
      const second = response();
      await createBooking(request(1), second);
      assert.equal(second.statusCode, 409);
      await syncVehicleAvailabilityByBookingState(vehicle._id);
    } finally {
      beforeOverlapResult = null;
      resume.resolve();
      await pending;
    }
    assert.equal(first.statusCode, 201);
    assert.equal(await FixtureBooking.countDocuments({ vehicle: vehicle._id }), 1);
    console.log("PASS: Synchronization, owner availability, and availability-only overwrites cannot reopen an in-flight reservation.");
  }

  {
    const { vehicle, request } = await fixture();
    await FixtureVehicle.updateOne({ _id: vehicle._id }, { $set: { availabilityStatus: "unavailable" } });
    beforeVehicleUpdate = async () => {
      beforeVehicleUpdate = null;
      await FixtureVehicle.updateOne({ _id: vehicle._id }, { $set: { availabilityStatus: "available" } });
      const res = response();
      await createBooking(request(), res);
      assert.equal(res.statusCode, 201);
    };
    assert.equal(await syncVehicleAvailabilityByBookingState(vehicle._id), "unavailable");
    assert.equal((await FixtureVehicle.findById(vehicle._id)).availabilityStatus, "unavailable");
    console.log("PASS: MongoDB rejects a stale availability write after a new reservation is acquired.");
  }

  for (const action of ["cancel", "reject"]) {
    const { vehicle, request, ownerRequest } = await fixture();
    const first = response();
    await createBooking(request(), first);
    assert.equal(first.statusCode, 201);
    const released = response();
    if (action === "cancel") {
      await cancelMyBooking({ ...request(), params: { id: String(first.body.booking._id) } }, released);
    } else {
      await updateOwnerBookingStatus(ownerRequest(first.body.booking._id, { status: "rejected" }), released);
    }
    assert.equal(released.statusCode, 200);
    const stored = await FixtureVehicle.findById(vehicle._id).select("+bookingReservationId");
    assert.equal(stored.availabilityStatus, "available");
    assert.equal(stored.bookingReservationId, null);
    const next = response();
    await createBooking(request(1), next);
    assert.equal(next.statusCode, 201);
    console.log(`PASS: The real ${action} controller releases its reservation and permits the next renter.`);
  }

  {
    const { vehicle, request, ownerRequest } = await fixture();
    const first = response();
    await createBooking(request(), first);
    assert.equal(first.statusCode, 201);
    await FixtureBooking.updateOne({ _id: first.body.booking._id }, { $set: {
      status: "confirmed", returnStatus: "requested", pickupAt: new Date(Date.now() - 3_600_000),
    } });
    const returned = response();
    await confirmOwnerVehicleReturn(ownerRequest(first.body.booking._id, { action: "confirm", actualReturnAt: new Date().toISOString() }), returned);
    assert.equal(returned.statusCode, 200);
    const stored = await FixtureVehicle.findById(vehicle._id).select("+bookingReservationId");
    assert.equal(stored.bookingReservationId, null);
    assert.equal(stored.availabilityStatus, "unavailable");
    assert.equal(stored.availabilityHoldReason, "inspection");
    const blocked = response();
    await createBooking(request(1), blocked);
    assert.equal(blocked.statusCode, 409);
    const available = response();
    await setOwnerVehicleAvailability(ownerRequest(vehicle._id, { availabilityStatus: "available" }), available);
    assert.equal(available.statusCode, 200);
    const next = response();
    await createBooking(request(1), next);
    assert.equal(next.statusCode, 201);
    console.log("PASS: Physical return clears the reservation but preserves inspection until the owner releases it.");
  }

  {
    const { request, ownerRequest } = await fixture();
    const first = response();
    await createBooking(request(), first);
    assert.equal(first.statusCode, 201);
    const bookingId = first.body.booking._id;
    const now = Date.now();
    const deadline = new Date(now - 2 * 3_600_000);
    const end = new Date(now + 30 * 60_000);
    await FixtureBooking.collection.updateOne({ _id: new mongoose.Types.ObjectId(bookingId) }, { $set: {
      status: "confirmed", pickupAt: new Date(now - 10 * 3_600_000), returnAt: deadline,
      originalReturnAt: deadline, bookingDurationMinutes: 480, bookingDurationHours: 8,
      baseAmount: 2000, totalAmount: 2000, transactionFee: 100,
      lateReturnFeeType: "fixed_hourly", lateReturnFeeValue: 50, lateReturnGraceMinutes: 0,
      lateReturnPenaltyRatePerHour: 50, paymentStatus: "paid", paymentAmountPaid: 2100, paymentAmountDue: 0,
    } });
    const renterRequest = (body) => ({ ...request(), params: { id: String(bookingId) }, body });
    const submitted = response();
    await requestBookingExtension(renterRequest({ newReturnAt: end.toISOString() }), submitted);
    assert.equal(submitted.statusCode, 200);
    const staleLifecycle = await FixtureBooking.findById(bookingId);
    const approved = response();
    await reviewOwnerBookingExtensionRequest(ownerRequest(bookingId, { action: "approve" }), approved);
    assert.equal(approved.statusCode, 200);
    let stored = await FixtureBooking.findById(bookingId);
    assert.equal(stored.totalAmount, 2125);
    assert.equal(stored.lateReturnOverdueMinutes, 120);
    assert.equal(stored.extensionHistory[0].status, "approved");
    assert.equal(stored.paymentAmountPaid, 2100);
    staleLifecycle.lateReturnOverdueMinutes = 999;
    await assert.rejects(staleLifecycle.save(), { name: "DocumentNotFoundError" });
    stored = await FixtureBooking.findById(bookingId);
    assert.equal(stored.lateReturnOverdueMinutes, 120);
    assert.equal(stored.extensionHistory.length, 1);
    const reported = response();
    await requestBookingReturn(renterRequest({ reportedHandoverAt: new Date(now).toISOString() }), reported);
    assert.equal(reported.statusCode, 200);
    const returned = response();
    await confirmOwnerVehicleReturn(ownerRequest(bookingId, { actualReturnAt: new Date(now).toISOString() }), returned);
    assert.equal(returned.statusCode, 200);
    stored = await FixtureBooking.findById(bookingId);
    assert.equal(stored.lateReturnPenaltyFee, 100);
    assert.equal(stored.paymentAmountPaid, 2100);
    assert.equal(stored.paymentAmountDue, 225);
    assert.equal(stored.actualReturnAt.getTime(), now);
    console.log("PASS: Real MongoDB preserves late periods, extension history, and captured payments; stale lifecycle saves are rejected.");
  }
}

main().catch((error) => {
  console.error("Booking MongoDB check failed:", error.code || error.name);
  process.exitCode = 1;
}).finally(async () => {
  mock.restoreAll();
  if (connection && created) {
    assert.match(databaseName, /^rentifypro_booking_fixture_[a-f0-9]{32}$/);
    assert.equal(connection.name, databaseName);
    await connection.dropDatabase();
    console.log("Synthetic fixture database removed; application records were not modified.");
  }
  await connection?.close();
});
