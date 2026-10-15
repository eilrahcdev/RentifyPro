import test from "node:test";
import assert from "node:assert/strict";
import { getBookingLateReturnInfo, getBookingExtensionQuote } from "../../frontend/src/utils/bookingPolicy.js";

const at = (time) => new Date(`2030-01-01T${time}:00Z`);
const booking = {
  status: "extended", returnAt: at("18:30"), vehicleHourlyRate: 100,
  bookingPolicy: { version: 2 }, lateReturn: {
    isOverdue: false, overdueMinutes: 120, accruedOverdueMinutes: 120,
    graceMinutes: 0, penaltyRatePerHour: 50, penaltyFee: 0,
  },
};

test("renter and owner display retained late time while an approved extension is current", () => {
  const info = getBookingLateReturnInfo(booking, at("18:15").getTime());
  assert.equal(info.isOverdue, false);
  assert.equal(info.accruedOverdueMinutes, 120);
  assert.equal(info.estimatedPenaltyFee, 100);
});

test("live display adds new overdue minutes to preserved earlier periods", () => {
  const info = getBookingLateReturnInfo(booking, at("19:00").getTime());
  assert.equal(info.isOverdue, true);
  assert.equal(info.overdueMinutes, 150);
  assert.equal(info.estimatedPenaltyFee, 125);
});

test("final handover charges stay fixed while the browser clock advances", () => {
  const info = getBookingLateReturnInfo({ ...booking, status: "completed", lateReturn: { ...booking.lateReturn, penaltyFee: 100 } }, at("23:00").getTime());
  assert.equal(info.overdueMinutes, 120);
  assert.equal(info.estimatedPenaltyFee, 100);
});

test("new and legacy extension previews distinguish future use from retroactive rental", () => {
  const source = { ...booking, returnAt: at("16:00") };
  assert.equal(getBookingExtensionQuote(source, at("18:30"), at("18:00").getTime()).totalAmount, 50);
  assert.equal(getBookingExtensionQuote({ ...source, bookingPolicy: { version: 1 } }, at("18:30"), at("18:00").getTime()).totalAmount, 250);
  assert.equal(getBookingExtensionQuote(source, at("16:30"), at("18:00").getTime()), null);
});
