import test from "node:test";
import assert from "node:assert/strict";
import Vehicle from "../models/Vehicle.js";
import { createOwnerVehicle, updateOwnerVehicle } from "../controllers/ownerVehicle.controller.js";
import { syncOneBookingLifecycle } from "../jobs/bookingLifecycle.job.js";
import {
  createBookingLateReturnPolicySnapshot,
  getBookingLateReturnPenaltyRatePerHour,
  getBookingLateReturnPolicy,
  getEstimatedLateReturnPenaltyFee,
  getVehicleLateReturnPolicy,
} from "../utils/lateReturnPolicy.js";

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("missing owner fee values stay zero even with the former global multiplier set", (t) => {
  const previous = process.env.LATE_RETURN_PENALTY_MULTIPLIER;
  process.env.LATE_RETURN_PENALTY_MULTIPLIER = "0.75";
  t.after(() => {
    if (previous === undefined) delete process.env.LATE_RETURN_PENALTY_MULTIPLIER;
    else process.env.LATE_RETURN_PENALTY_MULTIPLIER = previous;
  });

  for (const vehicle of [
    {},
    { lateReturnFeeType: "percentage" },
    { lateReturnFeeType: "fixed_hourly" },
    { lateReturnFeeType: "percentage", lateReturnFeeValue: null },
    { lateReturnFeeType: "percentage", lateReturnFeeValue: "" },
    { lateReturnFeeType: "percentage", lateReturnFeeValue: "invalid" },
    { lateReturnFeeType: "percentage", lateReturnFeeValue: -1 },
  ]) {
    assert.equal(getVehicleLateReturnPolicy(vehicle).value, 0);
    const snapshot = createBookingLateReturnPolicySnapshot({
      vehicle, vehicleHourlyRate: 800, driverHourlyRate: 100, driverSelected: true,
    });
    assert.equal(snapshot.lateReturnFeeValue, 0);
    assert.equal(snapshot.lateReturnPenaltyRatePerHour, 0);
  }

  const booking = {
    vehicleDailyRate: 800, driverDailyRate: 100, rentalRateUnit: "hourly", driverSelected: true,
    lateReturnIsOverdue: true, lateReturnOverdueMinutes: 120,
  };
  assert.equal(getBookingLateReturnPolicy(booking).isSnapshot, false);
  assert.equal(getBookingLateReturnPolicy(booking).value, 0);
  assert.equal(getBookingLateReturnPenaltyRatePerHour(booking), 0);
  assert.equal(getEstimatedLateReturnPenaltyFee(booking), 0);
});

test("owner percentage and fixed hourly fees retain their existing calculations", () => {
  const percentage = createBookingLateReturnPolicySnapshot({
    vehicle: { lateReturnFeeType: "percentage", lateReturnFeeValue: 18.5, lateReturnGraceMinutes: 15 },
    vehicleHourlyRate: 800, driverHourlyRate: 100, driverSelected: true,
  });
  assert.deepEqual(percentage, {
    lateReturnFeeType: "percentage", lateReturnFeeValue: 18.5,
    lateReturnGraceMinutes: 15, lateReturnPenaltyRatePerHour: 166.5,
  });
  const fixed = createBookingLateReturnPolicySnapshot({
    vehicle: { lateReturnFeeType: "fixed_hourly", lateReturnFeeValue: 350.75, lateReturnGraceMinutes: 5 },
    vehicleHourlyRate: 800, driverHourlyRate: 100, driverSelected: true,
  });
  assert.deepEqual(fixed, {
    lateReturnFeeType: "fixed_hourly", lateReturnFeeValue: 350.75,
    lateReturnGraceMinutes: 5, lateReturnPenaltyRatePerHour: 350.75,
  });
});

test("hydrating an older vehicle without a fee does not introduce a charge", () => {
  const vehicle = Vehicle.hydrate({ dailyRentalRate: 800, pricingUnit: "hourly" });
  assert.equal(vehicle.lateReturnFeeValue, 0);
  assert.equal(createBookingLateReturnPolicySnapshot({ vehicle, vehicleHourlyRate: 800 }).lateReturnPenaltyRatePerHour, 0);
});

test("booking-time policies are used when an hourly rate was not snapshotted", () => {
  const booking = {
    lateReturnFeeType: "percentage", lateReturnFeeValue: 18.5, lateReturnGraceMinutes: 15,
    vehicleDailyRate: 800, driverDailyRate: 100, rentalRateUnit: "hourly", driverSelected: true,
    vehicle: { lateReturnFeeType: "fixed_hourly", lateReturnFeeValue: 999 },
  };
  assert.equal(getBookingLateReturnPenaltyRatePerHour(booking), 166.5);
  assert.equal(getBookingLateReturnPenaltyRatePerHour({
    ...booking, lateReturnFeeType: "fixed_hourly", lateReturnFeeValue: 350.75,
  }), 350.75);
});

test("stored booking rates, zero-fee snapshots, and finalized charges remain authoritative", () => {
  for (const feeType of ["percentage", "fixed_hourly"]) {
    const booking = Object.freeze({
      lateReturnFeeType: feeType, lateReturnFeeValue: 25, lateReturnGraceMinutes: 15,
      lateReturnPenaltyRatePerHour: 37.5, vehicleDailyRate: 800, rentalRateUnit: "hourly",
      lateReturnIsOverdue: true, lateReturnOverdueMinutes: 120,
      vehicle: { lateReturnFeeType: "fixed_hourly", lateReturnFeeValue: 999 },
    });
    assert.equal(getBookingLateReturnPolicy(booking).value, 25);
    assert.equal(getBookingLateReturnPolicy(booking).graceMinutes, 15);
    assert.equal(getBookingLateReturnPenaltyRatePerHour(booking), 37.5);
    assert.equal(getEstimatedLateReturnPenaltyFee(booking), 75);
    assert.equal(getBookingLateReturnPenaltyRatePerHour({ ...booking, lateReturnPenaltyRatePerHour: 0 }), 0);
    assert.equal(getEstimatedLateReturnPenaltyFee({
      ...booking, lateReturnFeeValue: 0, lateReturnPenaltyRatePerHour: 0,
    }), 0);
  }
  assert.equal(getBookingLateReturnPenaltyRatePerHour({ lateReturnPenaltyRatePerHour: 37.5 }), 37.5);
  assert.equal(getEstimatedLateReturnPenaltyFee(Object.freeze({ lateReturnPenaltyFee: 123.45 })), 123.45);
});

test("lifecycle synchronization preserves existing policy and hourly-rate snapshots", async () => {
  let saves = 0;
  const booking = {
    status: "confirmed", returnAt: new Date("2026-08-28T11:00:00Z"),
    vehicleDailyRate: 800, rentalRateUnit: "hourly", driverSelected: false,
    lateReturnNotifiedAt: new Date("2026-08-28T11:16:00Z"),
    async save() { saves += 1; },
  };
  for (const [key, value] of Object.entries({
    lateReturnFeeType: "percentage", lateReturnFeeValue: 25,
    lateReturnGraceMinutes: 15, lateReturnPenaltyRatePerHour: 37.5,
  })) Object.defineProperty(booking, key, { value, enumerable: true, writable: false });

  await syncOneBookingLifecycle(booking, new Date("2026-08-28T12:00:00Z"));
  assert.equal(saves, 1);
  assert.equal(booking.lateReturnFeeValue, 25);
  assert.equal(booking.lateReturnPenaltyRatePerHour, 37.5);
  assert.equal(booking.lateReturnOverdueMinutes, 45);
  assert.equal(getEstimatedLateReturnPenaltyFee(booking), 28.13);
});

test("owner vehicle creation persists zero when the fee was omitted", async (t) => {
  let created;
  t.mock.method(Vehicle, "create", async (payload) => {
    created = { ...payload, _id: "vehicle-id" };
    return created;
  });
  const res = response();
  await createOwnerVehicle({
    body: {
      name: "Test vehicle", description: "A test vehicle", dailyRentalRate: 800,
      location: "Pangasinan", availabilityStatus: "available",
      imageUrls: ["https://vehicles.example.test/photo.jpg"],
      specType: "car", specSubType: "Sedan", specSeats: 4,
      specTransmission: "Automatic", specFuel: "Gasoline", specPlateNumber: "ABC123",
    },
    files: [], user: { _id: "owner-id" }, protocol: "http", get: () => "rentifypro.test",
  }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(created.lateReturnFeeValue, 0);
  assert.equal(res.body.vehicle.lateReturnPolicy.value, 0);
});

test("editing another vehicle field preserves the owner's stored late-return fee", async (t) => {
  for (const feeType of ["percentage", "fixed_hourly"]) {
    await t.test(feeType, async (t) => {
      const vehicle = {
        _id: "vehicle-id", owner: "owner-id", name: "Test vehicle", dailyRentalRate: 800,
        lateReturnFeeType: feeType, lateReturnFeeValue: 25, lateReturnGraceMinutes: 15,
        images: ["https://vehicles.example.test/photo.jpg"], specs: {},
        async save() {},
      };
      t.mock.method(Vehicle, "findOne", async () => vehicle);
      const res = response();
      await updateOwnerVehicle({
        params: { id: "vehicle-id" }, user: { _id: "owner-id" }, body: { name: "Updated vehicle" },
        files: [], protocol: "http", get: () => "rentifypro.test",
      }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(vehicle.lateReturnFeeType, feeType);
      assert.equal(vehicle.lateReturnFeeValue, 25);
      assert.equal(vehicle.lateReturnGraceMinutes, 15);
    });
  }
});
