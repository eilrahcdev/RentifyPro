import Booking from "../models/Booking.js";
import eventBus from "../events/eventBus.js";
import { NOTIFICATION_EVENTS } from "../events/notification.events.js";
import {
  expireBookingExtensionRequest,
  updateBookingLateReturnState,
} from "../utils/lateReturnPolicy.js";

const ACTIVE_BOOKING_STATUSES = ["confirmed", "extended"];
const DEFAULT_LIFECYCLE_INTERVAL_MS = 60 * 1000;

let lifecycleTimer = null;

const parseLifecycleInterval = () => {
  const raw = Number(process.env.BOOKING_LIFECYCLE_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LIFECYCLE_INTERVAL_MS;
  return Math.floor(raw);
};

export const syncOneBookingLifecycle = async (booking, now = new Date()) => {
  const returnAt = booking?.returnAt ? new Date(booking.returnAt) : null;
  if (!returnAt || Number.isNaN(returnAt.getTime()) || booking.actualReturnAt || !ACTIVE_BOOKING_STATUSES.includes(booking.status)) return false;
  const expired = expireBookingExtensionRequest(booking, now);
  if (now < returnAt && !expired && !booking.lateReturnIsOverdue) return false;
  const { changed, shouldNotify, overdueMinutes } = updateBookingLateReturnState(booking, now);
  if (!changed && !expired) return false;
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
    "_id status returnAt renter owner vehicle driverSelected vehicleDailyRate driverDailyRate rentalRateUnit lateReturnFeeType lateReturnFeeValue lateReturnGraceMinutes lateReturnIsOverdue lateReturnOverdueMinutes lateReturnDetectedAt lateReturnNotifiedAt lateReturnPenaltyRatePerHour lateReturnPenaltyFee actualReturnAt bookingPolicyVersion originalReturnAt extensionHistory bookingWorkflowRevision extensionStatus extensionRequestedAt extensionRequestedReturnAt extensionReviewedAt extensionReviewedBy extensionReviewAction extensionReviewNote lateReturnAction"
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
