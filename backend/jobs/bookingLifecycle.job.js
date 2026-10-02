import Booking from "../models/Booking.js";
import eventBus from "../events/eventBus.js";
import { NOTIFICATION_EVENTS } from "../events/notification.events.js";
import {
  getDurationMinutes,
  roundCurrency,
} from "../utils/pricing.js";
import {
  getBookingLateReturnPenaltyRatePerHour,
  getBookingLateReturnPolicy,
} from "../utils/lateReturnPolicy.js";

const ACTIVE_BOOKING_STATUSES = ["confirmed", "extended"];
const DEFAULT_LIFECYCLE_INTERVAL_MS = 60 * 1000;

let lifecycleTimer = null;

const parseLifecycleInterval = () => {
  const raw = Number(process.env.BOOKING_LIFECYCLE_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LIFECYCLE_INTERVAL_MS;
  return Math.floor(raw);
};

const getReturnBoundaryWithGrace = (returnAt, graceMinutes = 0) => {
  if (!returnAt || Number.isNaN(returnAt.getTime())) return null;
  const grace = Math.max(0, Math.floor(Number(graceMinutes || 0)));
  if (grace <= 0) return returnAt;
  return new Date(returnAt.getTime() + grace * 60 * 1000);
};

export const syncOneBookingLifecycle = async (booking, now = new Date()) => {
  const returnAt = booking?.returnAt ? new Date(booking.returnAt) : null;
  if (!returnAt || Number.isNaN(returnAt.getTime())) return false;
  if (now.getTime() < returnAt.getTime()) return false;
  const lateReturnPolicy = getBookingLateReturnPolicy(booking);

  const overdueBoundary = getReturnBoundaryWithGrace(returnAt, lateReturnPolicy.graceMinutes);
  if (!overdueBoundary || now.getTime() <= overdueBoundary.getTime()) return false;
  const overdueMinutes = Math.max(0, getDurationMinutes(overdueBoundary, now));
  let changed = false;
  if (!booking.lateReturnIsOverdue) {
    booking.lateReturnIsOverdue = true;
    changed = true;
  }
  if (Number(booking.lateReturnOverdueMinutes || 0) !== overdueMinutes) {
    booking.lateReturnOverdueMinutes = overdueMinutes;
    changed = true;
  }
  if (!booking.lateReturnDetectedAt) {
    booking.lateReturnDetectedAt = now;
    changed = true;
  }
  const penaltyRatePerHour = getBookingLateReturnPenaltyRatePerHour(booking);
  if (roundCurrency(Number(booking.lateReturnPenaltyRatePerHour || 0)) !== penaltyRatePerHour) {
    booking.lateReturnPenaltyRatePerHour = penaltyRatePerHour;
    changed = true;
  }

  let shouldNotify = false;
  if (!booking.lateReturnNotifiedAt) {
    booking.lateReturnNotifiedAt = now;
    shouldNotify = true;
    changed = true;
  }

  if (!changed) return false;
  await booking.save();

  if (shouldNotify) {
    eventBus.emit(NOTIFICATION_EVENTS.BOOKING_OVERDUE, {
      booking,
      overdueMinutes,
    });
  }

  return true;
};

const runLifecycleSync = async () => {
  const now = new Date();
  const bookings = await Booking.find({
    status: { $in: ACTIVE_BOOKING_STATUSES },
    returnAt: { $lte: now },
  }).select(
    "_id status returnAt renter owner vehicle driverSelected vehicleDailyRate driverDailyRate rentalRateUnit lateReturnFeeType lateReturnFeeValue lateReturnGraceMinutes lateReturnIsOverdue lateReturnOverdueMinutes lateReturnDetectedAt lateReturnNotifiedAt lateReturnPenaltyRatePerHour lateReturnPenaltyFee actualReturnAt"
  );

  let touched = 0;
  for (const booking of bookings) {
    const changed = await syncOneBookingLifecycle(booking, now);
    if (changed) touched += 1;
  }
  if (touched > 0) {
    console.log(`[booking-lifecycle] Updated ${touched} booking lifecycle records.`);
  }
};

export const startBookingLifecycleJob = () => {
  if (lifecycleTimer) return;

  const run = async () => {
    try {
      await runLifecycleSync();
    } catch (error) {
      console.error("[booking-lifecycle] Failed:", error?.message || error);
    }
  };

  void run();
  lifecycleTimer = setInterval(() => {
    void run();
  }, parseLifecycleInterval());

  if (typeof lifecycleTimer.unref === "function") {
    lifecycleTimer.unref();
  }
};

export const stopBookingLifecycleJob = () => {
  if (!lifecycleTimer) return;
  clearInterval(lifecycleTimer);
  lifecycleTimer = null;
};
