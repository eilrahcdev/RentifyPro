import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeNotificationData } from "../services/notification.service.js";

test("late-return notification details survive notification data sanitization", () => {
  const data = sanitizeNotificationData({
    bookingId: "booking-1",
    vehicleName: "Yamaha R3",
    scheduledReturnAt: "2026-08-29T12:00:00.000Z",
    actualReturnAt: "2026-08-29T16:40:00.000Z",
    overdueMinutes: 280,
    graceMinutes: 15,
    lateReturnPenaltyRatePerHour: 200,
    lateReturnPenaltyFee: 933.33,
    feeStatus: "final",
    rentalAmount: 19053.36,
    transactionFee: 140,
    totalAmountPayable: 20126.69,
    paymentAmountPaid: 5758.01,
    remainingBalance: 14368.68,
    paymentLocation: "My Bookings",
    paymentAction: "Pay Remaining",
    unapprovedInternalValue: "must not leak",
  });

  assert.equal(data.vehicleName, "Yamaha R3");
  assert.equal(data.lateReturnPenaltyFee, 933.33);
  assert.equal(data.remainingBalance, 14368.68);
  assert.equal(data.paymentAction, "Pay Remaining");
  assert.equal(data.unapprovedInternalValue, undefined);
});
