import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVehicleBookingComparison,
  resolveOwnerAnalyticsPeriod,
} from "../utils/ownerAnalytics.js";

test("owner analytics periods use a safe default and adjacent comparison window", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const period = resolveOwnerAnalyticsPeriod("unsupported", now);

  assert.equal(period.key, "90d");
  assert.equal(period.end.toISOString(), now.toISOString());
  assert.equal(period.end.getTime() - period.start.getTime(), 90 * 24 * 60 * 60 * 1000);
  assert.equal(period.start.getTime() - period.previousStart.getTime(), 90 * 24 * 60 * 60 * 1000);
});

test("vehicle comparison includes zero-booking vehicles and normalizes newer listings", () => {
  const period = resolveOwnerAnalyticsPeriod("90d", new Date("2026-01-01T00:00:00.000Z"));
  const vehicles = [
    { _id: "alpha", name: "Alpha", createdAt: "2025-01-01T00:00:00.000Z", availabilityStatus: "available" },
    { _id: "bravo", name: "Bravo", createdAt: "2025-01-01T00:00:00.000Z", availabilityStatus: "available" },
    { _id: "charlie", name: "Charlie", createdAt: "2025-01-01T00:00:00.000Z", availabilityStatus: "unavailable" },
    { _id: "delta", name: "Delta", createdAt: "2025-12-25T00:00:00.000Z", availabilityStatus: "available" },
    { _id: "echo", name: "Echo", createdAt: "2025-12-29T00:00:00.000Z", availabilityStatus: "available" },
  ];
  const bookingActivity = [
    { _id: "alpha", bookings: 12, previousBookings: 6, approvedBookings: 9, declinedBookings: 1, pendingBookings: 2, completedBookings: 5 },
    { _id: "bravo", bookings: 3, previousBookings: 3, approvedBookings: 2, declinedBookings: 1, completedBookings: 1 },
    { _id: "delta", bookings: 2, previousBookings: 0, approvedBookings: 1, pendingBookings: 1 },
  ];

  const result = buildVehicleBookingComparison({ vehicles, bookingActivity, period });
  const byId = new Map(result.vehiclePerformance.map((row) => [row.vehicleId, row]));

  assert.equal(result.summary.totalVehicles, 5);
  assert.equal(result.summary.totalBookingRequests, 17);
  assert.equal(result.summary.frequentlyBookedVehicles, 1);
  assert.equal(result.summary.vehiclesWithoutBookings, 2);
  assert.equal(result.summary.newListings, 2);
  assert.equal(byId.get("alpha").frequency, "frequent");
  assert.equal(byId.get("alpha").approvalRate, 90);
  assert.equal(byId.get("bravo").frequency, "infrequent");
  assert.equal(byId.get("charlie").frequency, "none");
  assert.equal(byId.get("charlie").bookings, 0);
  assert.equal(byId.get("delta").frequency, "new");
  assert.equal(byId.get("echo").frequency, "new");
  assert.equal(byId.get("echo").bookings, 0);
  assert.ok(byId.get("delta").bookingRate > byId.get("alpha").bookingRate);
});
