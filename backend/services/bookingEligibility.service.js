import Booking from "../models/Booking.js";
import { getBookingRemainingAmount } from "../utils/bookingPayment.js";
import { getBookingLateReturnPolicy } from "../utils/lateReturnPolicy.js";

export const BOOKING_LIMITS = Object.freeze({ open: 3, pending: 2, simultaneous: 1 });
export const OPEN_BOOKING_STATUSES = ["pending", "confirmed", "extended"];
const ACTIVE_STATUSES = ["confirmed", "extended"];
const idOf = (value) => String(value?._id || value || "");
const timestamp = (value) => value ? new Date(value).getTime() : NaN;

export const evaluateBookingEligibility = (bookings, { pickupAt, returnAt, now = new Date() } = {}) => {
  const currentTime = timestamp(now);
  const open = bookings.filter((booking) => OPEN_BOOKING_STATUSES.includes(booking.status));
  const counts = { open: open.length, pending: open.filter((booking) => booking.status === "pending").length };
  const reasons = [];

  for (const booking of bookings) {
    // Cancelled/rejected reservations and refunds are not outstanding rentals.
    if (![...ACTIVE_STATUSES, "completed"].includes(booking.status)) continue;
    const returned = Boolean(booking.actualReturnAt || booking.returnStatus === "confirmed" || booking.status === "completed");
    const returnTime = timestamp(booking.returnAt);
    const graceMs = getBookingLateReturnPolicy(booking).graceMinutes * 60_000;
    const reference = `#${idOf(booking).slice(-6).toUpperCase()}`;
    if (!returned && currentTime > returnTime + graceMs) {
      reasons.push({
        code: "OVERDUE_VEHICLE_RETURN", bookingId: idOf(booking),
        message: `Booking ${reference} is overdue for return. Resolve the return or have an extension approved before making another booking.`,
      });
    }

    // The existing rental agreement allows settlement during the rental or at
    // return. Do not retroactively impose a pickup payment deadline. A return
    // grace period concerns the vehicle, not the outstanding rental balance.
    const balanceIsDue = returned || currentTime > returnTime;
    const remaining = booking.paymentStatus === "refunded" ? 0 : getBookingRemainingAmount(booking);
    if (balanceIsDue && remaining > 0) {
      const hasFinalPenalty = returned && Number(booking.lateReturnPenaltyFee) > 0;
      reasons.push({
        code: hasFinalPenalty ? "UNPAID_LATE_RETURN_PENALTY" : "OVERDUE_BOOKING_BALANCE",
        bookingId: idOf(booking), amountDue: remaining,
        message: `Booking ${reference} has an unpaid balance${hasFinalPenalty ? " including a late-return penalty" : ""} of PHP ${remaining.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Settle it before making another booking.`,
      });
    }
  }

  if (counts.open >= BOOKING_LIMITS.open) reasons.push({
    code: "OPEN_BOOKING_LIMIT", message: "You have reached the limit of 3 open bookings. Complete a rental or cancel a booking before making another request.",
  });
  if (counts.pending >= BOOKING_LIMITS.pending) reasons.push({
    code: "PENDING_BOOKING_LIMIT", message: "You already have 2 pending booking requests. Wait for an owner decision or cancel a request before making another.",
  });

  const start = timestamp(pickupAt);
  const end = timestamp(returnAt);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    const conflict = open.find((booking) => !booking.actualReturnAt && booking.returnStatus !== "confirmed" &&
      timestamp(booking.pickupAt) < end && timestamp(booking.returnAt) > start);
    if (conflict) reasons.push({
      code: "RENTER_SCHEDULE_CONFLICT", bookingId: idOf(conflict),
      message: "These dates overlap one of your open bookings. You can rent only one vehicle at a time. Choose different dates or resolve the existing booking.",
    });
  }

  return { eligible: reasons.length === 0, limits: BOOKING_LIMITS, counts, reasons };
};

export const getRenterBookingStatusRecords = async (renterId) => Booking.find({
  renter: renterId,
  $or: [
    { status: { $in: OPEN_BOOKING_STATUSES } },
    // Include paid records with a recorded balance too: adding a final late
    // fee must not be bypassed just because a historical status is stale.
    { status: "completed", paymentStatus: { $ne: "refunded" }, $or: [
      { paymentStatus: { $ne: "paid" } }, { paymentAmountDue: { $gt: 0 } }, { lateReturnPenaltyFee: { $gt: 0 } },
    ] },
  ],
}).select("_id status pickupAt returnAt actualReturnAt returnStatus paymentStatus paymentAmountPaid paymentAmountDue totalAmount baseAmount driverAmount transactionFee lateReturnPenaltyFee lateReturnFeeType lateReturnFeeValue lateReturnGraceMinutes vehicleDailyRate driverDailyRate rentalRateUnit driverSelected bookingDurationHours bookingDurationMinutes bookingDays")
  .maxTimeMS(10_000).lean();

export const getRenterBookingEligibility = async (renterId, options = {}) => {
  const bookings = await getRenterBookingStatusRecords(renterId);
  return evaluateBookingEligibility(bookings, options);
};

// Approval rechecks this because another reservation may have been created
// after an extension was requested. Pending requests reserve their time too.
export const findRenterScheduleConflict = (booking, returnAt) => Booking.findOne({
  _id: { $ne: booking._id }, renter: booking.renter?._id || booking.renter,
  status: { $in: OPEN_BOOKING_STATUSES }, actualReturnAt: null,
  returnStatus: { $ne: "confirmed" },
  pickupAt: { $lt: returnAt }, returnAt: { $gt: booking.pickupAt },
}).select("_id").maxTimeMS(10_000);
