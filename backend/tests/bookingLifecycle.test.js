import test from "node:test";
import assert from "node:assert/strict";

import Booking from "../models/Booking.js";
import { syncOneBookingLifecycle } from "../jobs/bookingLifecycle.job.js";
import { hasActiveBookingForVehicle } from "../utils/vehicleAvailability.js";
import { getMyBookings, isOnlineBalancePaymentBlockedByWalkIn } from "../controllers/booking.controller.js";
import { getOwnerBookings } from "../controllers/ownerDashboard.controller.js";
import { validateVehicleAvailability, validateVehicleUpdate } from "../middleware/validate.middleware.js";
import {
  createBookingLateReturnPolicySnapshot,
  getEstimatedLateReturnPenaltyFee,
} from "../utils/lateReturnPolicy.js";

test("paid bookings become overdue without being auto-completed", async () => {
  const now = new Date("2026-08-28T12:00:00.000Z");
  let saves = 0;
  const booking = {
    status: "confirmed",
    returnAt: new Date("2026-08-28T11:00:00.000Z"),
    paymentStatus: "paid",
    walkInPaymentStatus: "none",
    driverSelected: false,
    vehicleDailyRate: 100,
    driverDailyRate: 0,
    rentalRateUnit: "hourly",
    lateReturnIsOverdue: false,
    lateReturnOverdueMinutes: 0,
    lateReturnDetectedAt: null,
    lateReturnNotifiedAt: new Date("2026-08-28T11:01:00.000Z"),
    lateReturnPenaltyRatePerHour: 0,
    autoCompletedAt: null,
    actualReturnAt: null,
    async save() {
      saves += 1;
    },
  };

  const changed = await syncOneBookingLifecycle(booking, now);

  assert.equal(changed, true);
  assert.equal(saves, 1);
  assert.equal(booking.status, "confirmed");
  assert.equal(booking.actualReturnAt, null);
  assert.equal(booking.autoCompletedAt, null);
  assert.equal(booking.lateReturnIsOverdue, true);
  assert.equal(booking.lateReturnOverdueMinutes, 60);
});

test("a snapshotted grace period is excluded from overdue minutes", async () => {
  const booking = {
    status: "confirmed",
    returnAt: new Date("2026-08-28T11:00:00.000Z"),
    driverSelected: false,
    vehicleDailyRate: 800,
    driverDailyRate: 0,
    rentalRateUnit: "hourly",
    lateReturnFeeType: "percentage",
    lateReturnFeeValue: 25,
    lateReturnGraceMinutes: 15,
    lateReturnPenaltyRatePerHour: 200,
    lateReturnPenaltyFee: 0,
    lateReturnIsOverdue: false,
    lateReturnOverdueMinutes: 0,
    lateReturnDetectedAt: null,
    lateReturnNotifiedAt: new Date("2026-08-28T11:16:00.000Z"),
    async save() {},
  };

  await syncOneBookingLifecycle(booking, new Date("2026-08-28T11:20:00.000Z"));

  assert.equal(booking.lateReturnIsOverdue, true);
  assert.equal(booking.lateReturnOverdueMinutes, 5);
});

test("vehicle locks are based on an unreturned booking, not scheduled time", async () => {
  const originalExists = Booking.exists;
  let receivedQuery;
  Booking.exists = async (query) => {
    receivedQuery = query;
    return { _id: "booking-id" };
  };

  try {
    assert.equal(await hasActiveBookingForVehicle("vehicle-id"), true);
    assert.deepEqual(receivedQuery.status.$in, ["pending", "confirmed", "extended"]);
    assert.equal(receivedQuery.actualReturnAt, null);
    assert.equal(Object.hasOwn(receivedQuery, "returnAt"), false);
  } finally {
    Booking.exists = originalExists;
  }
});

test("active walk-in balance settlements block a second online checkout", () => {
  assert.equal(
    isOnlineBalancePaymentBlockedByWalkIn({ paymentStatus: "partial", walkInPaymentStatus: "requested" }),
    true
  );
  assert.equal(
    isOnlineBalancePaymentBlockedByWalkIn({ paymentStatus: "partial", walkInPaymentStatus: "approved" }),
    true
  );
  assert.equal(
    isOnlineBalancePaymentBlockedByWalkIn({ paymentStatus: "partial", walkInPaymentStatus: "rejected" }),
    false
  );
  assert.equal(
    isOnlineBalancePaymentBlockedByWalkIn({ paymentStatus: "unpaid", walkInPaymentStatus: "approved" }),
    false
  );
});

test("booking schema exposes the explicit return workflow", () => {
  assert.deepEqual(Booking.schema.path("returnStatus").enumValues, ["none", "requested", "confirmed", "declined"]);
  assert.ok(Booking.schema.path("returnRequestedAt"));
  assert.ok(Booking.schema.path("returnConfirmedAt"));
  assert.ok(Booking.schema.path("returnConfirmedBy"));
  assert.ok(Booking.schema.path("returnReviewedAt"));
  assert.ok(Booking.schema.path("returnReviewAction"));
});

test("late-return policies are snapshotted with the booking-time rates", () => {
  assert.deepEqual(
    createBookingLateReturnPolicySnapshot({
      vehicle: {
        lateReturnFeeType: "percentage",
        lateReturnFeeValue: 25,
        lateReturnGraceMinutes: 15,
      },
      vehicleHourlyRate: 800,
      driverHourlyRate: 100,
      driverSelected: true,
    }),
    {
      lateReturnFeeType: "percentage",
      lateReturnFeeValue: 25,
      lateReturnGraceMinutes: 15,
      lateReturnPenaltyRatePerHour: 225,
    }
  );

  assert.equal(
    createBookingLateReturnPolicySnapshot({
      vehicle: { lateReturnFeeType: "fixed_hourly", lateReturnFeeValue: 350, lateReturnGraceMinutes: 5 },
      vehicleHourlyRate: 800,
    }).lateReturnPenaltyRatePerHour,
    350
  );
});

test("active overdue bookings expose an estimated fee before final return confirmation", () => {
  assert.equal(
    getEstimatedLateReturnPenaltyFee({
      lateReturnFeeType: "percentage",
      lateReturnFeeValue: 25,
      lateReturnGraceMinutes: 0,
      lateReturnPenaltyRatePerHour: 200,
      lateReturnPenaltyFee: 0,
      lateReturnIsOverdue: true,
      lateReturnOverdueMinutes: 280,
    }),
    933.33
  );
});

test("vehicle schema supports an inspection availability hold", async () => {
  const { default: Vehicle } = await import("../models/Vehicle.js");
  assert.deepEqual(Vehicle.schema.path("availabilityHoldReason").enumValues, ["none", "manual", "inspection"]);
  assert.deepEqual(Vehicle.schema.path("lateReturnFeeType").enumValues, ["percentage", "fixed_hourly"]);
  assert.equal(Vehicle.schema.path("lateReturnFeeValue").defaultValue, 25);
  assert.equal(Vehicle.schema.path("lateReturnGraceMinutes").defaultValue, 0);
});

test("owner action queue includes pending vehicle return requests", async () => {
  const originalFind = Booking.find;
  let receivedQuery;
  let receivedLimit;
  let responsePayload;
  Booking.find = (query) => {
    receivedQuery = query;
    return {
      populate() {
        return this;
      },
      sort() {
        return this;
      },
      async limit(value) {
        receivedLimit = value;
        return [];
      },
    };
  };

  try {
    await getOwnerBookings(
      { query: { view: "action" }, user: { _id: "owner-id" } },
      { json(payload) { responsePayload = payload; }, status() { return this; } }
    );
    assert.equal(responsePayload.success, true);
    assert.ok(receivedQuery.$or.some((condition) => condition.returnStatus === "requested"));
    assert.equal(receivedLimit, 11);
    assert.deepEqual(responsePayload.page, { hasMore: false, nextCursor: null, limit: 10 });
  } finally {
    Booking.find = originalFind;
  }
});

test("owner active bookings exclude pending requests and use ten-card pagination", async () => {
  const originalFind = Booking.find;
  let receivedQuery;
  let receivedSort;
  let receivedLimit;
  let responsePayload;
  Booking.find = (query) => {
    receivedQuery = query;
    return {
      populate() {
        return this;
      },
      sort(value) {
        receivedSort = value;
        return this;
      },
      async limit(value) {
        receivedLimit = value;
        return [];
      },
    };
  };

  try {
    await getOwnerBookings(
      { query: { view: "active", limit: "10" }, user: { _id: "owner-id" } },
      { json(payload) { responsePayload = payload; }, status() { return this; } }
    );
    assert.equal(responsePayload.success, true);
    assert.deepEqual(receivedQuery.status.$in, ["confirmed", "extended"]);
    assert.deepEqual(receivedSort, { pickupAt: 1, _id: 1 });
    assert.equal(receivedLimit, 11);
    assert.equal(responsePayload.page.limit, 10);
  } finally {
    Booking.find = originalFind;
  }
});

test("renter unsettled bookings include only due balances or active walk-in settlements", async (t) => {
  let receivedQuery;
  let receivedSort;
  let receivedLimit;
  t.mock.method(Booking, "find", (query) => {
    receivedQuery = query;
    return {
      populate() {
        return this;
      },
      sort(value) {
        receivedSort = value;
        return this;
      },
      async limit(value) {
        receivedLimit = value;
        return [];
      },
    };
  });
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };

  await getMyBookings(
    { query: { view: "unsettled", limit: "10" }, user: { _id: "renter-id" } },
    response
  );

  const unsettledFilter = receivedQuery.$and[0];
  const balanceConditions = unsettledFilter.$and[0].$or;
  const dueConditions = unsettledFilter.$and[1].$or;
  assert.equal(response.statusCode, 200);
  assert.deepEqual(unsettledFilter.status.$in, ["confirmed", "extended", "completed"]);
  assert.equal(unsettledFilter.paymentStatus.$ne, "refunded");
  assert.ok(balanceConditions.some((condition) => condition.paymentAmountDue?.$gt === 0));
  assert.ok(dueConditions.some((condition) => condition.status === "completed"));
  assert.ok(dueConditions.some((condition) => condition.returnAt?.$lt instanceof Date));
  assert.ok(dueConditions.some((condition) => condition.walkInPaymentStatus?.$in?.includes("approved")));
  assert.deepEqual(receivedSort, { updatedAt: -1, _id: -1 });
  assert.equal(receivedLimit, 11);
  assert.deepEqual(response.body.page, { hasMore: false, nextCursor: null, limit: 10 });
});

test("vehicle availability validation accepts the inspection/maintenance hold", () => {
  let nextCalled = false;
  validateVehicleAvailability(
    { body: { availabilityStatus: "unavailable", availabilityHoldReason: "inspection" } },
    { status() { return this; }, json() {} },
    () => { nextCalled = true; }
  );
  assert.equal(nextCalled, true);
});

test("vehicle updates validate bounded late-return policy settings", async () => {
  let nextCalled = false;
  const validRequest = {
    body: {
      lateReturnFeeType: "fixed_hourly",
      lateReturnFeeValue: "350",
      lateReturnGraceMinutes: "15",
    },
    files: [],
  };
  await validateVehicleUpdate(
    validRequest,
    { status() { return this; }, json() {} },
    () => { nextCalled = true; }
  );
  assert.equal(nextCalled, true);
  assert.equal(validRequest.body.lateReturnFeeValue, 350);
  assert.equal(validRequest.body.lateReturnGraceMinutes, 15);

  let invalidPayload;
  await validateVehicleUpdate(
    {
      body: {
        lateReturnFeeType: "percentage",
        lateReturnFeeValue: "101",
        lateReturnGraceMinutes: "0",
      },
      files: [],
    },
    {
      status() { return this; },
      json(payload) { invalidPayload = payload; },
    },
    () => {}
  );
  assert.equal(invalidPayload.success, false);
  assert.match(invalidPayload.errors.lateReturnFeeValue, /between 0 and 100/);
});
