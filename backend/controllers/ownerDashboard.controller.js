import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";
import { findRenterScheduleConflict } from "../services/bookingEligibility.service.js";
import { acquireBookingMutationLock, BookingPolicyError } from "../utils/bookingMutationLock.js";
import eventBus from "../events/eventBus.js";
import { NOTIFICATION_EVENTS } from "../events/notification.events.js";
import { emitToUser } from "../socket/index.js";
import { syncVehicleAvailabilityByBookingState } from "../utils/vehicleAvailability.js";
import { getTransactionFee } from "../utils/fees.js";
import {
  getBookingLateReturnPenaltyRatePerHour as getOwnerBookingLatePenaltyRatePerHour,
  getBookingLateReturnPolicy,
  getEstimatedLateReturnPenaltyFee,
} from "../utils/lateReturnPolicy.js";
import {
  HOURLY_RATE_UNIT,
  getBookingDriverHourlyRate,
  getBookingDurationHours,
  getBookingDurationMinutes,
  getBookingVehicleHourlyRate,
  getDurationHoursFromMinutes,
  roundCurrency,
} from "../utils/pricing.js";
import {
  buildVehicleBookingComparison,
  resolveOwnerAnalyticsPeriod,
} from "../utils/ownerAnalytics.js";

const STATUSES = new Set(["pending", "confirmed", "extended", "completed", "cancelled", "rejected"]);
const PAYMENT_STATUSES = new Set(["unpaid", "partial", "paid", "refunded"]);
const WALK_IN_PAYMENT_STATUSES = new Set(["none", "requested", "approved", "rejected", "completed"]);
const WALK_IN_REVIEW_ACTIONS = new Set(["approve", "reject"]);
const EXTENSION_STATUSES = new Set(["none", "requested", "approved", "rejected"]);
const EXTENSION_REVIEW_ACTIONS = new Set(["approve", "reject"]);
const CANCELLATION_STATUSES = new Set(["none", "requested", "approved", "rejected"]);
const RETURN_STATUSES = new Set(["none", "requested", "confirmed", "declined"]);
const CANCELLATION_REVIEW_ACTIONS = new Set(["approve", "reject"]);
const ACTIVE_BOOKING_STATUSES = new Set(["confirmed", "extended"]);
const ACTIVE_OVERLAP_STATUSES = ["pending", "confirmed", "extended"];

const getImageUrl = (req, pathValue) => {
  if (!pathValue) return "";
  if (/^https?:\/\//i.test(pathValue)) return pathValue;
  return `${req.protocol}://${req.get("host")}/${String(pathValue).replace(/\\/g, "/")}`;
};

const shouldUseConfiguredTransactionFeeFallback = (booking) => {
  const paymentStatus = String(booking?.paymentStatus || "").trim().toLowerCase();
  return paymentStatus === "unpaid" || paymentStatus === "partial";
};

const getOwnerBookingLatePenaltyFee = (booking) => {
  const penalty = Number(booking?.lateReturnPenaltyFee || 0);
  if (!Number.isFinite(penalty) || penalty <= 0) return 0;
  return roundCurrency(penalty);
};

const getOwnerBookingTransactionFee = (booking) => {
  const configured = getTransactionFee();
  const persisted = Number(booking?.transactionFee);
  let effective = Number.isFinite(persisted) && persisted > 0 ? roundCurrency(persisted) : 0;

  // Older records can preserve their original payable total without exposing
  // or depending on the removed recording implementation.
  if (effective <= 0) {
    const paid = Number(booking?.paymentAmountPaid || 0);
    const due = Number(booking?.paymentAmountDue || 0);
    const trackedTotal = paid + due;
    const rentalTotal =
      Number(booking?.totalAmount || 0) + getOwnerBookingLatePenaltyFee(booking);
    const inferred = trackedTotal - rentalTotal;
    if (Number.isFinite(inferred) && inferred > 0) effective = roundCurrency(inferred);
  }

  if (!shouldUseConfiguredTransactionFeeFallback(booking)) return effective;
  return roundCurrency(Math.max(effective, configured));
};

const getOwnerBookingPayableAmount = (booking) => {
  const bookingTotal = Number(booking?.totalAmount || 0);
  const total = Number.isFinite(bookingTotal) && bookingTotal > 0 ? bookingTotal : 0;
  return roundCurrency(
    total + getOwnerBookingLatePenaltyFee(booking) + getOwnerBookingTransactionFee(booking)
  );
};

const toDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const OWNER_BOOKING_LIST_DEFAULT_LIMIT = 10;
const OWNER_BOOKING_LIST_MAX_LIMIT = 100;

const parseOwnerBookingListLimit = (value) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return OWNER_BOOKING_LIST_DEFAULT_LIMIT;
  return Math.min(parsed, OWNER_BOOKING_LIST_MAX_LIMIT);
};

const parseOwnerBookingListCursor = (value) => {
  if (!value || typeof value !== "string") return null;

  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const timestamp = toDate(decoded?.at);
    const id = String(decoded?.id || "");
    if (!timestamp || !Booking.base.Types.ObjectId.isValid(id)) return null;
    return { at: timestamp, id };
  } catch {
    return null;
  }
};

const createOwnerBookingListCursor = (booking, sortField) => {
  const sortValue = toDate(booking?.[sortField]);
  if (!sortValue || !booking?._id) return null;
  return Buffer.from(
    JSON.stringify({ at: sortValue.toISOString(), id: String(booking._id) })
  ).toString("base64url");
};

const ownerBookingCursorFilter = (cursor, sortField, direction) => {
  if (!cursor) return null;
  const comparison = direction === "asc" ? "$gt" : "$lt";
  return {
    $or: [
      { [sortField]: { [comparison]: cursor.at } },
      { [sortField]: cursor.at, _id: { [comparison]: cursor.id } },
    ],
  };
};

const normalizeWalkInStatus = (value, fallback = "none") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (WALK_IN_PAYMENT_STATUSES.has(normalized)) return normalized;
  return fallback;
};

const normalizeExtensionStatus = (value, fallback = "none") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (EXTENSION_STATUSES.has(normalized)) return normalized;
  return fallback;
};

const normalizeCancellationStatus = (value, fallback = "none") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (CANCELLATION_STATUSES.has(normalized)) return normalized;
  return fallback;
};

const normalizeReturnStatus = (value, fallback = "none") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (RETURN_STATUSES.has(normalized)) return normalized;
  return fallback;
};

const toOptionalText = (value, maxLength = 500) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.slice(0, maxLength);
};

const toIdString = (value) => {
  const raw = value?._id || value;
  const normalized = String(raw || "").trim();
  return normalized || null;
};

const getOwnerBookingPaidAmount = (booking) => {
  const status = String(booking?.paymentStatus || "").trim().toLowerCase();
  if (status === "refunded") return 0;

  const totalPayable = getOwnerBookingPayableAmount(booking);
  const paid = Number(booking?.paymentAmountPaid);
  if (Number.isFinite(paid) && paid > 0) {
    return Math.min(roundCurrency(paid), totalPayable);
  }

  if (status === "paid") return totalPayable;
  return 0;
};

const getOwnerBookingRemainingAmount = (booking) => {
  const totalPayable = getOwnerBookingPayableAmount(booking);
  const paidAmount = getOwnerBookingPaidAmount(booking);
  return roundCurrency(Math.max(totalPayable - paidAmount, 0));
};

const getOwnerBookingReturnBoundaryWithGrace = (booking, graceMinutes = 0) => {
  const returnAt = toDate(booking?.returnAt);
  if (!returnAt) return null;
  const grace = Math.max(0, Math.floor(Number(graceMinutes || 0)));
  if (grace <= 0) return returnAt;
  return new Date(returnAt.getTime() + grace * 60 * 1000);
};

const getOwnerBookingOverdueMinutes = (booking, now = new Date(), graceMinutes = 0) => {
  const overdueBoundary = getOwnerBookingReturnBoundaryWithGrace(booking, graceMinutes);
  const current = toDate(now);
  if (!overdueBoundary || !current) return 0;
  if (current.getTime() <= overdueBoundary.getTime()) return 0;
  const diffMs = current.getTime() - overdueBoundary.getTime();
  return Math.max(0, Math.round(diffMs / (1000 * 60)));
};

const recalculateOwnerBookingAmountsForRange = (booking, nextReturnAt) => {
  const pickupAt = toDate(booking?.pickupAt);
  const returnAt = toDate(nextReturnAt);
  if (!pickupAt || !returnAt || returnAt.getTime() <= pickupAt.getTime()) {
    return null;
  }

  const diffMs = returnAt.getTime() - pickupAt.getTime();
  const bookingDurationMinutes = Math.max(0, Math.round(diffMs / (1000 * 60)));
  const bookingDurationHours = getBookingDurationHours({
    pickupAt,
    returnAt,
    bookingDurationMinutes,
    bookingDurationHours: Number(bookingDurationMinutes || 0) / 60,
  });
  const bookingDays = Math.max(1, Math.ceil(bookingDurationMinutes / (24 * 60)));
  if (!(bookingDurationMinutes > 0) || !(bookingDurationHours > 0)) return null;

  const vehicleHourlyRate = getBookingVehicleHourlyRate(booking);
  const driverHourlyRate = Boolean(booking?.driverSelected) ? getBookingDriverHourlyRate(booking) : 0;
  const baseAmount = roundCurrency(vehicleHourlyRate * bookingDurationHours);
  const driverAmount = roundCurrency(driverHourlyRate * bookingDurationHours);
  const totalAmount = roundCurrency(baseAmount + driverAmount);

  booking.returnAt = returnAt;
  booking.bookingDays = bookingDays;
  booking.bookingDurationMinutes = bookingDurationMinutes;
  booking.bookingDurationHours = bookingDurationHours;
  booking.baseAmount = baseAmount;
  booking.driverAmount = driverAmount;
  booking.totalAmount = totalAmount;
  booking.rentalRateUnit = HOURLY_RATE_UNIT;

  return {
    bookingDurationMinutes,
    bookingDurationHours,
    bookingDays,
    baseAmount,
    driverAmount,
    totalAmount,
  };
};

const syncOwnerBookingPaymentSnapshot = (booking) => {
  const totalPayable = getOwnerBookingPayableAmount(booking);
  const existingPaidAmount = Number(booking?.paymentAmountPaid || 0);
  const normalizedPaidAmount = Number.isFinite(existingPaidAmount) && existingPaidAmount > 0
    ? Math.min(roundCurrency(existingPaidAmount), totalPayable)
    : 0;
  const remainingAmount = roundCurrency(Math.max(totalPayable - normalizedPaidAmount, 0));

  booking.paymentAmountPaid = normalizedPaidAmount;
  booking.paymentAmountDue = remainingAmount;
  if (remainingAmount <= 0) {
    booking.paymentStatus = "paid";
    booking.paidAt = booking.paidAt || new Date();
    booking.paymentCheckoutAmount = 0;
    booking.paymentScope = "full";
  } else if (normalizedPaidAmount > 0) {
    booking.paymentStatus = "partial";
    booking.paidAt = null;
  } else {
    booking.paymentStatus = "unpaid";
    booking.paidAt = null;
  }
};

const resetWalkInPaymentState = (booking, { clearBalancePaymentMethod = true } = {}) => {
  if (!booking) return;
  if (clearBalancePaymentMethod) {
    booking.balancePaymentMethod = null;
  }
  booking.walkInPaymentStatus = "none";
  booking.walkInRequestedAt = null;
  booking.walkInRequestedBy = null;
  booking.walkInRequestNote = "";
  booking.walkInReviewedAt = null;
  booking.walkInReviewedBy = null;
  booking.walkInReviewNote = "";
  booking.walkInConfirmedAt = null;
  booking.walkInConfirmedBy = null;
  booking.walkInConfirmationNote = "";
};

const serializeWalkInPayment = (booking) => ({
  status: normalizeWalkInStatus(booking?.walkInPaymentStatus, "none"),
  requestedAt: booking?.walkInRequestedAt || null,
  requestedBy: toIdString(booking?.walkInRequestedBy),
  requestNote: toOptionalText(booking?.walkInRequestNote),
  reviewedAt: booking?.walkInReviewedAt || null,
  reviewedBy: toIdString(booking?.walkInReviewedBy),
  reviewNote: toOptionalText(booking?.walkInReviewNote),
  confirmedAt: booking?.walkInConfirmedAt || null,
  confirmedBy: toIdString(booking?.walkInConfirmedBy),
  confirmationNote: toOptionalText(booking?.walkInConfirmationNote),
});

const serializeLateReturn = (booking) => {
  const overdueMinutes = Math.max(0, Math.round(Number(booking?.lateReturnOverdueMinutes || 0)));
  const policy = getBookingLateReturnPolicy(booking);
  return {
    isOverdue: Boolean(booking?.lateReturnIsOverdue),
    overdueMinutes,
    detectedAt: booking?.lateReturnDetectedAt || null,
    notifiedAt: booking?.lateReturnNotifiedAt || null,
    penaltyRatePerHour: getOwnerBookingLatePenaltyRatePerHour(booking),
    penaltyFee: getOwnerBookingLatePenaltyFee(booking),
    estimatedPenaltyFee: getEstimatedLateReturnPenaltyFee(booking),
    feeType: policy.feeType,
    feeValue: policy.value,
    graceMinutes: policy.graceMinutes,
    action: String(booking?.lateReturnAction || "").trim().toLowerCase() || "none",
    resolvedAt: booking?.lateReturnResolvedAt || null,
    resolvedBy: toIdString(booking?.lateReturnResolvedBy),
  };
};

const serializeReturnRequest = (booking) => ({
  status: normalizeReturnStatus(booking?.returnStatus, "none"),
  requestedAt: booking?.returnRequestedAt || null,
  requestedBy: toIdString(booking?.returnRequestedBy),
  confirmedAt: booking?.returnConfirmedAt || booking?.actualReturnAt || null,
  confirmedBy: toIdString(booking?.returnConfirmedBy),
  reviewedAt: booking?.returnReviewedAt || null,
  reviewedBy: toIdString(booking?.returnReviewedBy),
  reviewAction: String(booking?.returnReviewAction || "").trim().toLowerCase() || null,
  reviewNote: toOptionalText(booking?.returnReviewNote),
});

const serializeExtensionRequest = (booking) => ({
  status: normalizeExtensionStatus(booking?.extensionStatus, "none"),
  requestedAt: booking?.extensionRequestedAt || null,
  requestedBy: toIdString(booking?.extensionRequestedBy),
  currentReturnAt: booking?.extensionCurrentReturnAt || null,
  requestedReturnAt: booking?.extensionRequestedReturnAt || null,
  requestNote: toOptionalText(booking?.extensionRequestNote),
  reviewedAt: booking?.extensionReviewedAt || null,
  reviewedBy: toIdString(booking?.extensionReviewedBy),
  reviewAction: String(booking?.extensionReviewAction || "").trim().toLowerCase() || null,
  reviewNote: toOptionalText(booking?.extensionReviewNote),
});

const serializeCancellationRequest = (booking) => ({
  status: normalizeCancellationStatus(booking?.cancellationStatus, "none"),
  requestedAt: booking?.cancellationRequestedAt || null,
  requestedBy: toIdString(booking?.cancellationRequestedBy),
  requestNote: toOptionalText(booking?.cancellationRequestNote),
  reviewedAt: booking?.cancellationReviewedAt || null,
  reviewedBy: toIdString(booking?.cancellationReviewedBy),
  reviewAction: String(booking?.cancellationReviewAction || "").trim().toLowerCase() || null,
  reviewNote: toOptionalText(booking?.cancellationReviewNote),
});

const getOwnerBookingEarnedAt = (booking) => {
  const status = String(booking?.paymentStatus || "").trim().toLowerCase();
  if (status === "paid") {
    return toDate(booking?.paidAt || booking?.paymentUpdatedAt || booking?.updatedAt);
  }
  if (status === "partial") {
    return toDate(booking?.paymentUpdatedAt || booking?.updatedAt);
  }
  return null;
};

const getOwnerBookingEarningsBreakdown = (booking) => {
  const amountPayable = getOwnerBookingPayableAmount(booking);
  const amountEarned = getOwnerBookingPaidAmount(booking);
  const ratio = amountPayable > 0 ? Math.min(amountEarned / amountPayable, 1) : 0;

  const baseAmount = Number(booking?.baseAmount);
  const driverAmount = Number(booking?.driverAmount);
  const safeBase = Number.isFinite(baseAmount) ? baseAmount : 0;
  const safeDriver = Number.isFinite(driverAmount) ? driverAmount : 0;

  return {
    amountPayable,
    amountEarned: roundCurrency(amountEarned),
    vehicleIncome: roundCurrency(safeBase * ratio),
    driverIncome: roundCurrency(safeDriver * ratio),
  };
};

const serializeOwnerBooking = (req, booking) => {
  const vehicle = booking.vehicle || {};
  const rawImages = Array.isArray(vehicle.images) ? vehicle.images : [];
  const images = rawImages.map((pathValue) => getImageUrl(req, pathValue));
  const bookingDurationMinutes = getBookingDurationMinutes(booking);
  const bookingDurationHours = getBookingDurationHours(booking);
  const vehicleHourlyRate = getBookingVehicleHourlyRate(booking);
  const driverHourlyRate = getBookingDriverHourlyRate(booking);

  return {
    _id: booking._id,
    pickupAt: booking.pickupAt,
    returnAt: booking.returnAt,
    bookingDays: booking.bookingDays,
    bookingDurationMinutes,
    bookingDurationHours,
    rentalRateUnit: HOURLY_RATE_UNIT,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    payment_status: booking.paymentStatus,
    paymentMethod: booking.paymentMethod || null,
    payment_method: booking.paymentMethod || null,
    balancePaymentMethod: booking.balancePaymentMethod || null,
    balance_payment_method: booking.balancePaymentMethod || null,
    autoCompletedAt: booking.autoCompletedAt || null,
    actualReturnAt: booking.actualReturnAt || null,
    returnRequest: serializeReturnRequest(booking),
    return_request: serializeReturnRequest(booking),
    lateReturn: serializeLateReturn(booking),
    late_return: serializeLateReturn(booking),
    extensionRequest: serializeExtensionRequest(booking),
    extension_request: serializeExtensionRequest(booking),
    cancellationRequest: serializeCancellationRequest(booking),
    cancellation_request: serializeCancellationRequest(booking),
    walkInPayment: serializeWalkInPayment(booking),
    walk_in_payment: serializeWalkInPayment(booking),
    paymongoReference: booking.paymongoReference || null,
    paymongo_reference: booking.paymongoReference || null,
    paymongoCheckoutId: booking.paymongoCheckoutId || null,
    paymentIntentId: booking.paymentIntentId || null,
    payment_intent_id: booking.paymentIntentId || null,
    paymentRequestedAt: booking.paymentRequestedAt || null,
    paymentUpdatedAt: booking.paymentUpdatedAt || null,
    paidAt: booking.paidAt || null,
    vehicleDailyRate: vehicleHourlyRate,
    vehicleHourlyRate,
    driverSelected: booking.driverSelected,
    driverDailyRate: driverHourlyRate,
    driverHourlyRate,
    baseAmount: booking.baseAmount,
    driverAmount: booking.driverAmount,
    totalAmount: booking.totalAmount,
    lateReturnPolicy: getBookingLateReturnPolicy(booking),
    lateReturnPenaltyRatePerHour: getOwnerBookingLatePenaltyRatePerHour(booking),
    lateReturnPenaltyFee: getOwnerBookingLatePenaltyFee(booking),
    transactionFee: getOwnerBookingTransactionFee(booking),
    amountPayable: getOwnerBookingPayableAmount(booking),
    paymentAmountPaid: getOwnerBookingPaidAmount(booking),
    paymentAmountDue: getOwnerBookingRemainingAmount(booking),
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    renter: booking.renter || null,
    owner: booking.owner || null,
    vehicle: booking.vehicle
      ? {
          _id: vehicle._id,
          name: vehicle.name,
          location: vehicle.location,
          specs: vehicle.specs || {},
          imageUrl: getImageUrl(req, vehicle.imageUrl) || images[0],
          coverDisplayMode: vehicle.coverDisplayMode || "auto",
          images,
        }
      : null,
  };
};

const populateFields = [
  { path: "renter", select: "name email avatar" },
  { path: "owner", select: "name email avatar" },
  {
    path: "vehicle",
    select:
      "name location specs images imageUrl coverDisplayMode dailyRentalRate pricingUnit driverOptionEnabled driverDailyRate",
  },
];

const syncOwnerBookingLifecycleState = async (booking) => {
  if (!booking?._id) return { updated: false };

  const now = new Date();
  const lateReturnPolicy = getBookingLateReturnPolicy(booking);
  const normalizedStatus = String(booking?.status || "").trim().toLowerCase();
  if (!ACTIVE_BOOKING_STATUSES.has(normalizedStatus)) {
    return { updated: false };
  }

  const returnAt = toDate(booking?.returnAt);
  if (!returnAt || now.getTime() < returnAt.getTime()) {
    return { updated: false };
  }

  const overdueMinutes = getOwnerBookingOverdueMinutes(booking, now, lateReturnPolicy.graceMinutes);
  if (overdueMinutes <= 0) {
    return { updated: false };
  }
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
  const penaltyRatePerHour = getOwnerBookingLatePenaltyRatePerHour(booking);
  if (roundCurrency(Number(booking.lateReturnPenaltyRatePerHour || 0)) !== penaltyRatePerHour) {
    booking.lateReturnPenaltyRatePerHour = penaltyRatePerHour;
    changed = true;
  }

  let shouldNotifyOverdue = false;
  if (!booking.lateReturnNotifiedAt) {
    booking.lateReturnNotifiedAt = now;
    shouldNotifyOverdue = true;
    changed = true;
  }

  if (changed) {
    await booking.save();
  }

  if (shouldNotifyOverdue) {
    eventBus.emit(NOTIFICATION_EVENTS.BOOKING_OVERDUE, {
      booking,
      overdueMinutes,
    });
  }

  return { updated: changed || shouldNotifyOverdue, status: String(booking.status || "").toLowerCase() };
};

const autoSyncOwnerBookingLifecycles = async (bookings = []) => {
  const updated = [];
  for (const booking of bookings) {
    const result = await syncOwnerBookingLifecycleState(booking);
    if (result.updated) {
      updated.push(booking);
    }
  }
  return updated;
};

export const getOwnerBookings = async (req, res) => {
  try {
    const status = String(req.query.status || "all").trim().toLowerCase();
    const view = String(req.query.view || "").trim().toLowerCase();
    const query = { owner: req.user._id };
    let sortField = "updatedAt";
    let direction = "desc";

    if (status === "cancelled") {
      query.status = { $in: ["cancelled", "rejected"] };
    } else if (status !== "all" && STATUSES.has(status)) {
      query.status = status;
      if (["confirmed", "extended"].includes(status)) {
        sortField = "pickupAt";
        direction = "asc";
      }
    } else if (view === "action") {
      query.$or = [
        { status: "pending" },
        { extensionStatus: "requested" },
        { cancellationStatus: "requested" },
        { walkInPaymentStatus: "requested" },
        { returnStatus: "requested" },
        { status: { $in: ["confirmed", "extended"] }, lateReturnIsOverdue: true },
      ];
    } else if (view === "active") {
      query.status = { $in: ["confirmed", "extended"] };
      sortField = "pickupAt";
      direction = "asc";
    } else if (["past", "history"].includes(view)) {
      query.status = { $in: ["completed", "cancelled", "rejected"] };
    }

    const limit = parseOwnerBookingListLimit(req.query.limit);
    const cursor = parseOwnerBookingListCursor(req.query.cursor);
    const paginationFilter = ownerBookingCursorFilter(cursor, sortField, direction);
    if (paginationFilter) query.$and = [...(query.$and || []), paginationFilter];

    const sortDirection = direction === "asc" ? 1 : -1;
    const documents = await Booking.find(query)
      .populate(populateFields)
      .sort({ [sortField]: sortDirection, _id: sortDirection })
      .limit(limit + 1);
    const hasMore = documents.length > limit;
    const bookings = hasMore ? documents.slice(0, limit) : documents;
    const autoSynced = await autoSyncOwnerBookingLifecycles(bookings);
    for (const booking of autoSynced) {
      const payload = serializeOwnerBooking(req, booking);
      emitToUser(String(booking.renter?._id || booking.renter), "booking:updated", payload);
      emitToUser(String(booking.owner?._id || booking.owner), "booking:updated", payload);
    }
    res.json({
      success: true,
      bookings: bookings.map((booking) => serializeOwnerBooking(req, booking)),
      page: {
        hasMore,
        nextCursor: hasMore ? createOwnerBookingListCursor(bookings[bookings.length - 1], sortField) : null,
        limit,
      },
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch owner bookings." });
  }
};

export const updateOwnerBookingStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const booking = await Booking.findOne({ _id: req.params.id, owner: req.user._id }).populate(populateFields);

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    await syncOwnerBookingLifecycleState(booking);

    if (String(status || "").trim().toLowerCase() === "extended") {
      return res.status(400).json({
        success: false,
        message: "Use extension approval flow to set status to extended.",
      });
    }

    if (String(status || "").trim().toLowerCase() === "completed") {
      return res.status(400).json({
        success: false,
        message: "Use vehicle return confirmation to complete an active rental.",
      });
    }

    const currentStatus = String(booking.status || "").trim().toLowerCase();
    const requestedStatus = String(status || "").trim().toLowerCase();
    if (currentStatus === requestedStatus) {
      return res.json({ success: true, booking: serializeOwnerBooking(req, booking) });
    }
    if (
      normalizeReturnStatus(booking.returnStatus, "none") === "requested" &&
      requestedStatus === "cancelled"
    ) {
      return res.status(409).json({
        success: false,
        message: "Confirm the pending vehicle return instead of cancelling the active rental.",
      });
    }
    const allowedTransitions = {
      pending: new Set(["confirmed", "rejected", "cancelled"]),
      confirmed: new Set(["cancelled"]),
      extended: new Set(["cancelled"]),
    };
    if (!allowedTransitions[currentStatus]?.has(requestedStatus)) {
      return res.status(409).json({
        success: false,
        message: `Booking cannot move from ${currentStatus || "its current state"} to ${requestedStatus}.`,
      });
    }

    if (status === "confirmed") {
      if (await findRenterScheduleConflict(booking, booking.returnAt)) {
        return res.status(409).json({
          success: false, code: "RENTER_SCHEDULE_CONFLICT",
          message: "The renter has another booking that overlaps this schedule. Ask them to resolve the conflicting booking first.",
        });
      }
      const vehicleId = booking.vehicle?._id || booking.vehicle;
      const conflictingBooking = await Booking.findOne({
        _id: { $ne: booking._id },
        vehicle: vehicleId,
        status: { $in: ACTIVE_OVERLAP_STATUSES },
        pickupAt: { $lt: booking.returnAt },
        returnAt: { $gt: booking.pickupAt },
      }).select("_id");

      if (conflictingBooking) {
        return res.status(409).json({
          success: false,
          message: "Cannot confirm booking because the schedule conflicts with another active booking.",
        });
      }
    }

    const transition = await Booking.updateOne(
      { _id: booking._id, owner: req.user._id, status: currentStatus, updatedAt: booking.updatedAt },
      { $set: { status: requestedStatus } },
    );
    if (!transition.modifiedCount) {
      return res.status(409).json({ success: false, message: "This booking changed while you were reviewing it. Refresh bookings to see its latest status." });
    }
    booking.status = requestedStatus;
    await syncVehicleAvailabilityByBookingState(booking.vehicle?._id || booking.vehicle);

    const statusNotificationEvent =
      status === "confirmed"
        ? NOTIFICATION_EVENTS.BOOKING_APPROVED
        : status === "rejected"
          ? NOTIFICATION_EVENTS.BOOKING_REJECTED
          : status === "cancelled"
            ? NOTIFICATION_EVENTS.BOOKING_CANCELLED
            : NOTIFICATION_EVENTS.BOOKING_STATUS_UPDATED;

    eventBus.emit(statusNotificationEvent, {
      booking,
      actor: req.user,
      status,
      cancelledBy: status === "cancelled" ? "owner" : "",
      recipientId: booking.renter?._id || booking.renter,
    });

    const payload = serializeOwnerBooking(req, booking);
    emitToUser(String(booking.renter._id), "booking:updated", payload);
    emitToUser(String(booking.owner._id), "booking:updated", payload);

    res.json({ success: true, booking: payload });
  } catch {
    res.status(500).json({ success: false, message: "Failed to update booking status." });
  }
};

export const updateOwnerBookingPaymentStatus = async (req, res) => {
  try {
    const requestedPaymentStatus = String(req.body?.paymentStatus || "").trim().toLowerCase();
    if (!PAYMENT_STATUSES.has(requestedPaymentStatus)) {
      return res.status(400).json({ success: false, message: "Invalid payment status." });
    }
    const booking = await Booking.findOne({ _id: req.params.id, owner: req.user._id }).populate(populateFields);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }
    // The status and amounts are one update. Compare the version the owner saw
    // as well as the current database version so stale tabs cannot silently
    // overwrite a payment, final late fee, or another owner's decision.
    const expectedUpdatedAt = req.body?.expectedUpdatedAt;
    if (expectedUpdatedAt !== undefined &&
        (typeof expectedUpdatedAt !== "string" || !toDate(expectedUpdatedAt))) {
      return res.status(400).json({ success: false, message: "Invalid booking version. Refresh the booking and try again." });
    }
    if (expectedUpdatedAt && toDate(expectedUpdatedAt).getTime() !== toDate(booking.updatedAt)?.getTime()) {
      return res.status(409).json({
        success: false, code: "BOOKING_PAYMENT_CHANGED",
        message: "This booking changed. Review its latest payment status and try again.",
        booking: serializeOwnerBooking(req, booking),
      });
    }

    // Calculate before switching status: older unpaid records can still need
    // the configured transaction-fee fallback, which must be preserved on Paid.
    const transactionFee = getOwnerBookingTransactionFee(booking);
    const totalPayable = getOwnerBookingPayableAmount(booking);
    const now = new Date();
    const changes = {
      paymentStatus: requestedPaymentStatus,
      transactionFee,
      paymentUpdatedAt: now,
      manualPaymentUpdatedAt: now,
      manualPaymentUpdatedBy: req.user._id,
      manualPaymentStatus: requestedPaymentStatus,
      paymentCheckoutAmount: 0,
      paymentChannel: null,
    };
    if (requestedPaymentStatus === "partial") {
      const rawAmount = req.body?.paymentAmountPaid ?? booking.paymentAmountPaid;
      const amount = ["number", "string"].includes(typeof rawAmount) && String(rawAmount).trim() !== ""
        ? Number(rawAmount) : NaN;
      if (!Number.isFinite(amount) || roundCurrency(amount) <= 0 || roundCurrency(amount) >= totalPayable) {
        return res.status(400).json({
          success: false,
          message: "For Partial, enter the total amount received so far. It must be greater than zero and less than the full amount payable.",
        });
      }
      changes.paymentAmountPaid = roundCurrency(amount);
      changes.paymentAmountDue = roundCurrency(totalPayable - changes.paymentAmountPaid);
      changes.paymentScope = "downpayment";
      changes.paidAt = null;
    } else if (requestedPaymentStatus === "paid") {
      if (!(totalPayable > 0)) {
        return res.status(400).json({ success: false, message: "This booking has no valid amount to mark as paid." });
      }
      changes.paymentAmountPaid = totalPayable;
      changes.paymentAmountDue = 0;
      changes.paymentScope = "full";
      changes.paidAt = booking.paidAt || now;
      changes.paymentMethod = booking.paymentMethod || "Owner-confirmed";
      changes.balancePaymentMethod = "Owner-confirmed";
    } else {
      changes.paymentAmountPaid = 0;
      changes.paymentAmountDue = totalPayable;
      changes.paymentScope = null;
      changes.paidAt = null;
    }

    const walkInState = {};
    resetWalkInPaymentState(walkInState);
    if (requestedPaymentStatus === "paid") {
      // A manually confirmed balance settles an outstanding walk-in request too.
      if (["requested", "approved"].includes(normalizeWalkInStatus(booking.walkInPaymentStatus))) {
        Object.assign(walkInState, {
          balancePaymentMethod: "Walk-in", walkInPaymentStatus: "completed",
          walkInRequestedAt: booking.walkInRequestedAt, walkInRequestedBy: booking.walkInRequestedBy,
          walkInRequestNote: booking.walkInRequestNote,
          walkInReviewedAt: booking.walkInReviewedAt || now, walkInReviewedBy: booking.walkInReviewedBy || req.user._id,
          walkInReviewNote: booking.walkInReviewNote,
          walkInConfirmedAt: now, walkInConfirmedBy: req.user._id,
          walkInConfirmationNote: "Payment recorded as paid by the owner.",
        });
      } else {
        // Preserve a completed walk-in receipt when Paid is selected again.
        if (normalizeWalkInStatus(booking.walkInPaymentStatus) === "completed") {
          for (const key of Object.keys(walkInState)) walkInState[key] = booking[key];
        } else walkInState.balancePaymentMethod = "Owner-confirmed";
      }
    }
    Object.assign(changes, walkInState);

    const updated = await Booking.findOneAndUpdate(
      {
        _id: booking._id, owner: req.user._id, updatedAt: booking.updatedAt,
        manualPaymentRevision: booking.manualPaymentRevision || { $in: [0, null] },
        paymentRevision: booking.paymentRevision || { $in: [0, null] },
      },
      { $set: changes, $inc: { manualPaymentRevision: 1, paymentRevision: 1 } },
      { new: true, runValidators: true }
    ).populate(populateFields);
    if (!updated) {
      const latest = await Booking.findOne({ _id: booking._id, owner: req.user._id }).populate(populateFields);
      return res.status(409).json({
        success: false, code: "BOOKING_PAYMENT_CHANGED",
        message: "This booking changed. Review its latest payment status and try again.",
        ...(latest ? { booking: serializeOwnerBooking(req, latest) } : {}),
      });
    }

    eventBus.emit(NOTIFICATION_EVENTS.PAYMENT_STATUS_UPDATED, {
      booking: updated,
      actor: req.user,
      paymentStatus: requestedPaymentStatus,
    });

    const payload = serializeOwnerBooking(req, updated);
    emitToUser(String(updated.renter?._id || updated.renter), "booking:updated", payload);
    emitToUser(String(updated.owner?._id || updated.owner), "booking:updated", payload);

    res.json({
      success: true,
      message: "Payment status updated.",
      booking: payload,
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to update payment status." });
  }
};

export const confirmOwnerVehicleReturn = async (req, res) => {
  try {
    const action = String(req.body?.action || "confirm").trim().toLowerCase();
    if (!["confirm", "decline"].includes(action)) {
      return res.status(400).json({ success: false, message: "Invalid vehicle return review action." });
    }

    const booking = await Booking.findOne({ _id: req.params.id, owner: req.user._id }).populate(populateFields);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    await syncOwnerBookingLifecycleState(booking);

    const returnStatus = normalizeReturnStatus(booking.returnStatus, "none");
    if (action === "decline") {
      if (returnStatus === "declined") {
        return res.json({
          success: true,
          message: "Vehicle return request was already declined.",
          booking: serializeOwnerBooking(req, booking),
        });
      }
      if (returnStatus !== "requested") {
        return res.status(409).json({
          success: false,
          message: "No pending vehicle return request was found.",
        });
      }

      const now = new Date();
      booking.returnStatus = "declined";
      booking.returnReviewedAt = now;
      booking.returnReviewedBy = req.user._id;
      booking.returnReviewAction = "decline";
      booking.returnReviewNote = toOptionalText(req.body?.note, 500);
      await booking.save();

      eventBus.emit(NOTIFICATION_EVENTS.VEHICLE_RETURN_DECLINED, {
        booking,
        actor: req.user,
      });

      const refreshed = await Booking.findById(booking._id).populate(populateFields);
      const payload = serializeOwnerBooking(req, refreshed);
      emitToUser(String(refreshed.renter?._id || refreshed.renter), "booking:updated", payload);
      emitToUser(String(refreshed.owner?._id || refreshed.owner), "booking:updated", payload);

      return res.json({
        success: true,
        message: "Vehicle return request declined. The booking remains active and the vehicle remains unavailable.",
        booking: payload,
      });
    }

    if (String(booking.status || "").toLowerCase() === "completed" && returnStatus === "confirmed") {
      return res.json({
        success: true,
        message: "Vehicle return was already confirmed.",
        booking: serializeOwnerBooking(req, booking),
      });
    }

    const normalizedStatus = String(booking.status || "").trim().toLowerCase();
    if (!ACTIVE_BOOKING_STATUSES.has(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: "Only active approved bookings can be confirmed as returned.",
      });
    }
    if (returnStatus !== "requested") {
      return res.status(409).json({
        success: false,
        message: "No pending vehicle return request was found.",
      });
    }
    const pickupAt = toDate(booking.pickupAt);
    if (!pickupAt || Date.now() < pickupAt.getTime()) {
      return res.status(400).json({
        success: false,
        message: "Vehicle return can only be confirmed after the rental has started.",
      });
    }

    if (normalizeExtensionStatus(booking.extensionStatus, "none") === "requested") {
      return res.status(409).json({
        success: false,
        message: "Review the pending extension request before confirming the vehicle return.",
      });
    }

    const now = new Date();
    const lateReturnPolicy = getBookingLateReturnPolicy(booking);
    const overdueMinutes = getOwnerBookingOverdueMinutes(booking, now, lateReturnPolicy.graceMinutes);
    const penaltyRatePerHour = getOwnerBookingLatePenaltyRatePerHour(booking);
    const lateReturnPenaltyFee = roundCurrency(
      penaltyRatePerHour * getDurationHoursFromMinutes(overdueMinutes)
    );

    booking.status = "completed";
    booking.actualReturnAt = now;
    booking.returnStatus = "confirmed";
    booking.returnConfirmedAt = now;
    booking.returnConfirmedBy = req.user._id;
    booking.returnReviewedAt = now;
    booking.returnReviewedBy = req.user._id;
    booking.returnReviewAction = "confirm";
    booking.returnReviewNote = toOptionalText(req.body?.note, 500);
    booking.autoCompletedAt = null;
    booking.lateReturnIsOverdue = overdueMinutes > 0;
    booking.lateReturnDetectedAt = overdueMinutes > 0 ? booking.lateReturnDetectedAt || now : null;
    booking.lateReturnOverdueMinutes = overdueMinutes;
    booking.lateReturnPenaltyRatePerHour = penaltyRatePerHour;
    booking.lateReturnPenaltyFee = lateReturnPenaltyFee;
    booking.lateReturnAction = "return_confirmed";
    booking.lateReturnResolvedAt = now;
    booking.lateReturnResolvedBy = req.user._id;
    booking.paymentUpdatedAt = now;
    syncOwnerBookingPaymentSnapshot(booking);

    await booking.save();

    const vehicleId = booking.vehicle?._id || booking.vehicle;
    await Vehicle.updateOne(
      { _id: vehicleId },
      { $set: { availabilityStatus: "unavailable", availabilityHoldReason: "inspection" } }
    );

    eventBus.emit(NOTIFICATION_EVENTS.VEHICLE_RETURN_CONFIRMED, {
      booking,
      actor: req.user,
      overdueMinutes,
      lateReturnPenaltyFee,
    });

    const refreshed = await Booking.findById(booking._id).populate(populateFields);
    const payload = serializeOwnerBooking(req, refreshed);
    emitToUser(String(refreshed.renter?._id || refreshed.renter), "booking:updated", payload);
    emitToUser(String(refreshed.owner?._id || refreshed.owner), "booking:updated", payload);

    return res.json({
      success: true,
      message:
        lateReturnPenaltyFee > 0
          ? "Vehicle return confirmed and the final late fee was applied. The vehicle is now under inspection/maintenance."
          : "Vehicle return confirmed. The vehicle remains under inspection/maintenance until you mark it available.",
      booking: payload,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to confirm vehicle return." });
  }
};

export const reviewOwnerBookingExtensionRequest = async (req, res) => {
  let renterLock;
  try {
    const action = String(req.body?.action || "").trim().toLowerCase();
    if (!EXTENSION_REVIEW_ACTIONS.has(action)) {
      return res.status(400).json({ success: false, message: "Invalid extension review action." });
    }

    let booking = await Booking.findOne({ _id: req.params.id, owner: req.user._id }).populate(populateFields);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    renterLock = await acquireBookingMutationLock(booking.renter?._id || booking.renter);
    // Read again under the lease: a concurrent review may already have changed
    // the request while this owner was acquiring the renter's schedule lock.
    booking = await Booking.findOne({ _id: req.params.id, owner: req.user._id }).populate(populateFields);
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });

    await syncOwnerBookingLifecycleState(booking);

    const normalizedStatus = String(booking.status || "").trim().toLowerCase();
    if (["cancelled", "rejected", "completed"].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: "This booking can no longer process extension requests.",
      });
    }

    if (normalizeReturnStatus(booking.returnStatus, "none") === "requested") {
      return res.status(409).json({
        success: false,
        message: "Confirm the pending vehicle return instead of changing the rental schedule.",
      });
    }

    const extensionStatus = normalizeExtensionStatus(booking.extensionStatus, "none");
    if (extensionStatus !== "requested") {
      return res.status(409).json({
        success: false,
        message: "No pending extension request found for this booking.",
      });
    }

    const now = new Date();
    const note = toOptionalText(req.body?.note, 500);

    if (action === "approve") {
      const requestedReturnAt = toDate(booking.extensionRequestedReturnAt);
      const currentReturnAt = toDate(booking.returnAt);
      if (!requestedReturnAt || !currentReturnAt || requestedReturnAt.getTime() <= currentReturnAt.getTime()) {
        return res.status(400).json({
          success: false,
          message: "Requested extension schedule is invalid.",
        });
      }

      const vehicleId = booking.vehicle?._id || booking.vehicle;
      const conflictingBooking = await Booking.findOne({
        _id: { $ne: booking._id },
        vehicle: vehicleId,
        status: { $in: ACTIVE_OVERLAP_STATUSES },
        pickupAt: { $lt: requestedReturnAt },
        returnAt: { $gt: booking.pickupAt },
      }).select("_id");
      if (conflictingBooking) {
        return res.status(409).json({
          success: false,
          message: "Cannot approve extension because it conflicts with another booking schedule.",
        });
      }

      if (await findRenterScheduleConflict(booking, requestedReturnAt)) {
        return res.status(409).json({
          success: false, code: "RENTER_SCHEDULE_CONFLICT",
          message: "This extension overlaps another booking held by the renter. Ask them to resolve that booking or request a different return time.",
        });
      }

      const recalculated = recalculateOwnerBookingAmountsForRange(booking, requestedReturnAt);
      if (!recalculated) {
        return res.status(400).json({
          success: false,
          message: "Failed to apply extension because the updated duration is invalid.",
        });
      }

      booking.status = "extended";
      booking.extensionStatus = "approved";
      booking.extensionReviewedAt = now;
      booking.extensionReviewedBy = req.user._id;
      booking.extensionReviewAction = "approve";
      booking.extensionReviewNote = note;
      booking.lateReturnIsOverdue = false;
      booking.lateReturnDetectedAt = null;
      booking.lateReturnNotifiedAt = null;
      booking.lateReturnOverdueMinutes = 0;
      booking.lateReturnPenaltyFee = 0;
      booking.lateReturnAction = "none";
      booking.lateReturnResolvedAt = null;
      booking.lateReturnResolvedBy = null;
      booking.actualReturnAt = null;
      booking.paymentUpdatedAt = now;
      syncOwnerBookingPaymentSnapshot(booking);
      await renterLock.renew();
      await booking.save();
      await syncVehicleAvailabilityByBookingState(vehicleId);

      const refreshed = await Booking.findById(booking._id).populate(populateFields);
      const payload = serializeOwnerBooking(req, refreshed);

      eventBus.emit(NOTIFICATION_EVENTS.EXTENSION_APPROVED, {
        booking: refreshed,
        actor: req.user,
      });

      emitToUser(String(refreshed.renter?._id || refreshed.renter), "booking:updated", payload);
      emitToUser(String(refreshed.owner?._id || refreshed.owner), "booking:updated", payload);

      return res.json({
        success: true,
        message: "Extension request approved. Booking schedule and pricing were updated.",
        booking: payload,
      });
    }

    booking.extensionStatus = "rejected";
    booking.extensionReviewedAt = now;
    booking.extensionReviewedBy = req.user._id;
    booking.extensionReviewAction = "reject";
    booking.extensionReviewNote = note;
    booking.lateReturnAction = "none";
    booking.paymentUpdatedAt = now;
    await renterLock.renew();
    await booking.save();

    const refreshed = await Booking.findById(booking._id).populate(populateFields);
    const payload = serializeOwnerBooking(req, refreshed);

    eventBus.emit(NOTIFICATION_EVENTS.EXTENSION_REJECTED, {
      booking: refreshed,
      actor: req.user,
    });

    emitToUser(String(refreshed.renter?._id || refreshed.renter), "booking:updated", payload);
    emitToUser(String(refreshed.owner?._id || refreshed.owner), "booking:updated", payload);

    return res.json({
      success: true,
      message: "Extension request rejected.",
      booking: payload,
    });
  } catch (error) {
    if (error instanceof BookingPolicyError) {
      return res.status(409).json({ success: false, code: error.code, message: error.message });
    }
    return res.status(500).json({ success: false, message: "Failed to review extension request." });
  } finally {
    await renterLock?.release();
  }
};

export const reviewOwnerBookingCancellationRequest = async (req, res) => {
  try {
    const action = String(req.body?.action || "").trim().toLowerCase();
    if (!CANCELLATION_REVIEW_ACTIONS.has(action)) {
      return res.status(400).json({ success: false, message: "Invalid cancellation review action." });
    }

    const booking = await Booking.findOne({ _id: req.params.id, owner: req.user._id }).populate(populateFields);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    await syncOwnerBookingLifecycleState(booking);

    const normalizedStatus = String(booking.status || "").trim().toLowerCase();
    if (["cancelled", "rejected", "completed"].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: "This booking can no longer process cancellation requests.",
      });
    }

    const cancellationStatus = normalizeCancellationStatus(booking.cancellationStatus, "none");
    if (cancellationStatus !== "requested") {
      return res.status(409).json({
        success: false,
        message: "No pending cancellation request found for this booking.",
      });
    }

    const now = new Date();
    const note = toOptionalText(req.body?.note, 500);

    if (action === "approve") {
      booking.status = "cancelled";
      booking.cancellationStatus = "approved";
      booking.cancellationReviewedAt = now;
      booking.cancellationReviewedBy = req.user._id;
      booking.cancellationReviewAction = "approve";
      booking.cancellationReviewNote = note;
      await booking.save();

      const vehicleId = booking.vehicle?._id || booking.vehicle;
      await syncVehicleAvailabilityByBookingState(vehicleId);

      const refreshed = await Booking.findById(booking._id).populate(populateFields);
      const payload = serializeOwnerBooking(req, refreshed);

      eventBus.emit(NOTIFICATION_EVENTS.CANCELLATION_APPROVED, {
        booking: refreshed,
        actor: req.user,
      });

      emitToUser(String(refreshed.renter?._id || refreshed.renter), "booking:updated", payload);
      emitToUser(String(refreshed.owner?._id || refreshed.owner), "booking:updated", payload);

      return res.json({
        success: true,
        message: "Cancellation request approved. Booking is now cancelled.",
        booking: payload,
      });
    }

    booking.cancellationStatus = "rejected";
    booking.cancellationReviewedAt = now;
    booking.cancellationReviewedBy = req.user._id;
    booking.cancellationReviewAction = "reject";
    booking.cancellationReviewNote = note;
    await booking.save();

    const refreshed = await Booking.findById(booking._id).populate(populateFields);
    const payload = serializeOwnerBooking(req, refreshed);

    eventBus.emit(NOTIFICATION_EVENTS.CANCELLATION_REJECTED, {
      booking: refreshed,
      actor: req.user,
    });

    emitToUser(String(refreshed.renter?._id || refreshed.renter), "booking:updated", payload);
    emitToUser(String(refreshed.owner?._id || refreshed.owner), "booking:updated", payload);

    return res.json({
      success: true,
      message: "Cancellation request rejected. Booking remains active.",
      booking: payload,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to review cancellation request." });
  }
};

export const reviewOwnerWalkInPaymentRequest = async (req, res) => {
  try {
    const action = String(req.body?.action || "").trim().toLowerCase();
    if (!WALK_IN_REVIEW_ACTIONS.has(action)) {
      return res.status(400).json({ success: false, message: "Invalid walk-in review action." });
    }

    const booking = await Booking.findOne({ _id: req.params.id, owner: req.user._id }).populate(populateFields);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }
    await syncOwnerBookingLifecycleState(booking);

    if (["cancelled", "rejected"].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: "Cancelled bookings cannot be updated for walk-in payment.",
      });
    }
    if (!["confirmed", "extended"].includes(String(booking.status || "").trim().toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Booking must be approved or extended before reviewing walk-in payment.",
      });
    }

    const normalizedPaymentStatus = String(booking.paymentStatus || "").trim().toLowerCase();
    if (normalizedPaymentStatus !== "partial") {
      return res.status(400).json({
        success: false,
        message: "Walk-in payment review is only available after downpayment.",
      });
    }

    const remainingAmount = getOwnerBookingRemainingAmount(booking);
    if (!Number.isFinite(remainingAmount) || remainingAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "This booking has no remaining walk-in balance.",
      });
    }

    const walkInStatus = normalizeWalkInStatus(booking.walkInPaymentStatus, "none");
    if (walkInStatus !== "requested") {
      return res.status(409).json({
        success: false,
        message: "No pending walk-in payment request was found for this booking.",
      });
    }

    const note = toOptionalText(req.body?.note, 500);
    booking.walkInPaymentStatus = action === "approve" ? "approved" : "rejected";
    booking.walkInReviewedAt = new Date();
    booking.walkInReviewedBy = req.user._id;
    booking.walkInReviewNote = note;
    booking.walkInConfirmedAt = null;
    booking.walkInConfirmedBy = null;
    booking.walkInConfirmationNote = "";
    booking.balancePaymentMethod = action === "approve" ? "Walk-in" : null;
    booking.paymentUpdatedAt = new Date();
    await booking.save();

    const refreshed = await Booking.findById(booking._id).populate(populateFields);
    const payload = serializeOwnerBooking(req, refreshed);
    const walkInLabel = action === "approve" ? "approved" : "rejected";

    eventBus.emit(
      action === "approve"
        ? NOTIFICATION_EVENTS.WALKIN_PAYMENT_APPROVED
        : NOTIFICATION_EVENTS.WALKIN_PAYMENT_REJECTED,
      {
        booking: refreshed,
        actor: req.user,
        walkInPaymentStatus: walkInLabel,
      }
    );

    emitToUser(String(refreshed.renter?._id || refreshed.renter), "booking:updated", payload);
    emitToUser(String(refreshed.owner?._id || refreshed.owner), "booking:updated", payload);

    return res.json({
      success: true,
      message:
        action === "approve"
          ? "Walk-in payment request approved."
          : "Walk-in payment request rejected.",
      booking: payload,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to review walk-in payment request." });
  }
};

export const confirmOwnerWalkInPayment = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, owner: req.user._id }).populate(populateFields);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }
    await syncOwnerBookingLifecycleState(booking);

    if (["cancelled", "rejected"].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: "Cancelled bookings cannot be settled via walk-in payment.",
      });
    }
    if (!["confirmed", "extended", "completed"].includes(String(booking.status || "").trim().toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Only approved, extended, or completed bookings can be settled via walk-in payment.",
      });
    }

    const normalizedPaymentStatus = String(booking.paymentStatus || "").trim().toLowerCase();
    if (normalizedPaymentStatus !== "partial") {
      return res.status(400).json({
        success: false,
        message: "Walk-in confirmation is only available for partially paid bookings.",
      });
    }

    const walkInStatus = normalizeWalkInStatus(booking.walkInPaymentStatus, "none");
    if (walkInStatus !== "approved") {
      return res.status(409).json({
        success: false,
        message: "Walk-in payment must be approved before confirmation.",
      });
    }

    const remainingAmount = getOwnerBookingRemainingAmount(booking);
    if (!Number.isFinite(remainingAmount) || remainingAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "This booking has no remaining balance.",
      });
    }

    const note = toOptionalText(req.body?.note, 500);
    const totalPayable = getOwnerBookingPayableAmount(booking);

    booking.paymentStatus = "paid";
    booking.paymentAmountPaid = totalPayable;
    booking.paymentAmountDue = 0;
    booking.paymentCheckoutAmount = 0;
    booking.paymentScope = "full";
    booking.paymentChannel = null;
    booking.paidAt = booking.paidAt || new Date();
    booking.paymentUpdatedAt = new Date();
    booking.balancePaymentMethod = "Walk-in";
    booking.walkInPaymentStatus = "completed";
    booking.walkInConfirmedAt = new Date();
    booking.walkInConfirmedBy = req.user._id;
    booking.walkInConfirmationNote = note;
    await booking.save();

    const refreshed = await Booking.findById(booking._id).populate(populateFields);
    const payload = serializeOwnerBooking(req, refreshed);

    eventBus.emit(NOTIFICATION_EVENTS.WALKIN_PAYMENT_CONFIRMED, {
      booking: refreshed,
      actor: req.user,
    });

    emitToUser(String(refreshed.renter?._id || refreshed.renter), "booking:updated", payload);
    emitToUser(String(refreshed.owner?._id || refreshed.owner), "booking:updated", payload);

    return res.json({
      success: true,
      message: "Walk-in payment confirmed successfully.",
      booking: payload,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to confirm walk-in payment." });
  }
};

export const getOwnerReviews = async (req, res) => {
  try {
    const reviews = await Booking.find({
      owner: req.user._id,
      reviewRating: { $exists: true },
      reviewCreatedAt: { $exists: true },
    })
      .populate("renter", "name avatar")
      .populate("vehicle", "name")
      .sort({ reviewCreatedAt: -1 })
      .lean();

    res.json({
      success: true,
      reviews: reviews.map((review) => ({
        _id: review._id,
        rating: review.reviewRating,
        comment: review.reviewComment || "",
        createdAt: review.reviewCreatedAt,
        renter: review.renter || null,
        vehicle: review.vehicle || null,
      })),
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch reviews." });
  }
};

export const getOwnerEarnings = async (req, res) => {
  try {
    const paidBookings = await Booking.find({
      owner: req.user._id,
      paymentStatus: { $in: ["partial", "paid"] },
    })
      .populate("vehicle", "name")
      .populate("renter", "name email")
      .sort({ paymentUpdatedAt: -1, updatedAt: -1 })
      .lean();

    const bookings = paidBookings.map((booking) => {
      const earnings = getOwnerBookingEarningsBreakdown(booking);
      const earnedAt = getOwnerBookingEarnedAt(booking);
      const bookingDurationMinutes = getBookingDurationMinutes(booking);
      const bookingDurationHours = getBookingDurationHours(booking);
      const vehicleHourlyRate = getBookingVehicleHourlyRate(booking);
      const driverHourlyRate = getBookingDriverHourlyRate(booking);

      return {
        _id: booking._id,
        vehicle: booking.vehicle || null,
        renter: booking.renter || null,
        bookingDays: booking.bookingDays,
        bookingDurationMinutes,
        bookingDurationHours,
        rentalRateUnit: HOURLY_RATE_UNIT,
        vehicleDailyRate: vehicleHourlyRate,
        vehicleHourlyRate,
        driverSelected: booking.driverSelected,
        driverDailyRate: driverHourlyRate,
        driverHourlyRate,
        baseAmount: booking.baseAmount,
        driverAmount: booking.driverAmount,
        totalAmount: booking.totalAmount,
        transactionFee: getOwnerBookingTransactionFee(booking),
        amountPayable: earnings.amountPayable,
        amountEarned: earnings.amountEarned,
        vehicleIncome: earnings.vehicleIncome,
        driverIncome: earnings.driverIncome,
        paymentStatus: booking.paymentStatus,
        paymentAmountPaid: booking.paymentAmountPaid,
        paymentAmountDue: booking.paymentAmountDue,
        earnedAt,
        completedAt: earnedAt || booking.updatedAt,
      };
    });

    const totals = bookings.reduce(
      (acc, booking) => {
        acc.totalEarnings += booking.amountEarned || 0;
        acc.vehicleIncome += booking.vehicleIncome || 0;
        acc.driverIncome += booking.driverIncome || 0;
        return acc;
      },
      { totalEarnings: 0, vehicleIncome: 0, driverIncome: 0 }
    );

    const monthlyMap = new Map();
    bookings.forEach((booking) => {
      const earnedAt = toDate(booking.earnedAt);
      if (!earnedAt) return;

      const year = earnedAt.getFullYear();
      const month = earnedAt.getMonth() + 1;
      const key = `${year}-${month}`;

      const entry =
        monthlyMap.get(key) || {
          _id: { year, month },
          totalEarnings: 0,
          vehicleIncome: 0,
          driverIncome: 0,
          bookings: 0,
        };

      entry.totalEarnings += booking.amountEarned || 0;
      entry.vehicleIncome += booking.vehicleIncome || 0;
      entry.driverIncome += booking.driverIncome || 0;
      entry.bookings += 1;

      monthlyMap.set(key, entry);
    });

    const monthlyEarnings = Array.from(monthlyMap.values())
      .map((entry) => ({
        ...entry,
        totalEarnings: roundCurrency(entry.totalEarnings),
        vehicleIncome: roundCurrency(entry.vehicleIncome),
        driverIncome: roundCurrency(entry.driverIncome),
      }))
      .sort((a, b) => {
        if (a._id.year !== b._id.year) return b._id.year - a._id.year;
        return b._id.month - a._id.month;
      })
      .slice(0, 12);

    res.json({
      success: true,
      totals: {
        totalEarnings: roundCurrency(totals.totalEarnings),
        vehicleIncome: roundCurrency(totals.vehicleIncome),
        driverIncome: roundCurrency(totals.driverIncome),
      },
      monthlyEarnings,
      bookings,
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch earnings." });
  }
};

export const getOwnerAnalytics = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const analyticsPeriod = resolveOwnerAnalyticsPeriod(req.query?.period);

    const monthlyEarningsPromise = Booking.aggregate([
      { $match: { owner: ownerId, status: "completed" } },
      {
        $group: {
          _id: {
            year: { $year: "$updatedAt" },
            month: { $month: "$updatedAt" },
          },
          totalEarnings: {
            $sum: {
              $cond: [
                { $gt: [{ $ifNull: ["$paymentAmountPaid", 0] }, 0] },
                { $ifNull: ["$paymentAmountPaid", 0] },
                {
                  $add: [
                    { $ifNull: ["$totalAmount", 0] },
                    { $ifNull: ["$transactionFee", 0] },
                  ],
                },
              ],
            },
          },
          driverIncome: { $sum: "$driverAmount" },
          vehicleIncome: { $sum: "$baseAmount" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    const bookingTrendPromise = Booking.aggregate([
      { $match: { owner: ownerId } },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          totalBookings: { $sum: 1 },
          pending: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          confirmed: {
            $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] },
          },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          cancelled: {
            $sum: {
              $cond: [{ $in: ["$status", ["cancelled", "rejected"]] }, 1, 0],
            },
          },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    const mostBookedVehiclesPromise = Booking.aggregate([
      { $match: { owner: ownerId } },
      {
        $group: {
          _id: "$vehicle",
          bookings: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [
                { $gt: [{ $ifNull: ["$paymentAmountPaid", 0] }, 0] },
                { $ifNull: ["$paymentAmountPaid", 0] },
                {
                  $add: [
                    { $ifNull: ["$totalAmount", 0] },
                    { $ifNull: ["$transactionFee", 0] },
                  ],
                },
              ],
            },
          },
          completedBookings: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
        },
      },
      { $sort: { bookings: -1, revenue: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: Vehicle.collection.name,
          localField: "_id",
          foreignField: "_id",
          as: "vehicle",
        },
      },
      { $unwind: { path: "$vehicle", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          vehicleId: "$_id",
          vehicleName: "$vehicle.name",
          bookings: 1,
          revenue: 1,
          completedBookings: 1,
        },
      },
    ]);

    const ownerVehiclesPromise = Vehicle.find({ owner: ownerId })
      .select("name specs.type availabilityStatus createdAt")
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    const comparativeBookingActivityPromise = Booking.aggregate([
      {
        $match: {
          owner: ownerId,
          createdAt: { $gte: analyticsPeriod.previousStart, $lt: analyticsPeriod.end },
        },
      },
      {
        $group: {
          _id: "$vehicle",
          bookings: {
            $sum: { $cond: [{ $gte: ["$createdAt", analyticsPeriod.start] }, 1, 0] },
          },
          previousBookings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$createdAt", analyticsPeriod.previousStart] },
                    { $lt: ["$createdAt", analyticsPeriod.start] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          pendingBookings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$createdAt", analyticsPeriod.start] },
                    { $eq: ["$status", "pending"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          approvedBookings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$createdAt", analyticsPeriod.start] },
                    { $in: ["$status", ["confirmed", "extended", "completed"]] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          completedBookings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$createdAt", analyticsPeriod.start] },
                    { $eq: ["$status", "completed"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          declinedBookings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$createdAt", analyticsPeriod.start] },
                    { $in: ["$status", ["cancelled", "rejected"]] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const [
      monthlyEarningsTrend,
      bookingTrend,
      mostBookedVehicles,
      ownerVehicles,
      comparativeBookingActivity,
    ] = await Promise.all([
      monthlyEarningsPromise,
      bookingTrendPromise,
      mostBookedVehiclesPromise,
      ownerVehiclesPromise,
      comparativeBookingActivityPromise,
    ]);

    const vehicleComparison = buildVehicleBookingComparison({
      vehicles: ownerVehicles,
      bookingActivity: comparativeBookingActivity,
      period: analyticsPeriod,
    });

    res.json({
      success: true,
      monthlyEarningsTrend,
      bookingTrend,
      mostBookedVehicles,
      ...vehicleComparison,
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch analytics." });
  }
};
