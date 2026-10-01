import {
  getBookingLatePenaltyFee,
  getEffectiveTransactionFee,
  getBookingPayableAmount,
  getBookingPaidAmount,
  getBookingRemainingAmount,
} from "../utils/bookingPayment.js";
import Booking from "../models/Booking.js";
import { getBookingHorizonEnd, BOOKING_HORIZON_MESSAGE } from "../utils/bookingDatePolicy.js";
import Vehicle from "../models/Vehicle.js";
import { findRenterScheduleConflict, getRenterBookingEligibility } from "../services/bookingEligibility.service.js";
import { acquireBookingMutationLock, BookingPolicyError } from "../utils/bookingMutationLock.js";
import eventBus from "../events/eventBus.js";
import { NOTIFICATION_EVENTS } from "../events/notification.events.js";
import { emitToUser } from "../socket/index.js";
import {
  createPayMongoCheckoutSession,
  getPayMongoCheckoutAmountInCentavos,
  getPayMongoCheckoutId,
  getPayMongoCheckoutMetadata,
  getPayMongoCheckoutReferenceNumber,
  getPayMongoCheckoutSession,
  getPayMongoCheckoutUrl,
  getPayMongoPaymentIntentId,
  isPayMongoCheckoutPaid,
} from "../utils/paymongo.js";
import { getTransactionFee } from "../utils/fees.js";
import { syncVehicleAvailabilityByBookingState } from "../utils/vehicleAvailability.js";
import { normalizePhilippineMobile } from "../utils/phone.js";
import {
  createBookingLateReturnPolicySnapshot,
  getBookingLateReturnPenaltyRatePerHour as getBookingLatePenaltyRatePerHour,
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
  getDurationMinutes,
  getLegacyBookingDays,
  getVehicleHourlyRate,
  roundCurrency,
} from "../utils/pricing.js";

const toDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseBookingDateTime = (value) => {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part || 0));
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  if (
    year < 1 || calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day ||
    hour > 23 || minute > 59 || second > 59
  ) return null;
  return toDate(value);
};

const boolFromValue = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
};

const getImageUrl = (req, pathValue) => {
  if (!pathValue) return "";
  if (/^https?:\/\//i.test(pathValue)) return pathValue;
  return `${req.protocol}://${req.get("host")}/${String(pathValue).replace(/\\/g, "/")}`;
};

const normalizeOriginText = (value) => String(value || "").trim().replace(/\/+$/, "");

const getConfiguredFrontendBaseUrl = () => {
  const configuredOrigins = String(process.env.FRONTEND_URL || "")
    .split(",")
    .map((origin) => normalizeOriginText(origin))
    .filter((origin) => /^https?:\/\//i.test(origin))
    .filter((origin) => !origin.includes("*"));

  return configuredOrigins[0] || "";
};

const getOriginFromReferer = (refererValue) => {
  const referer = String(refererValue || "").trim();
  if (!referer) return "";
  try {
    return normalizeOriginText(new URL(referer).origin);
  } catch {
    return "";
  }
};

const frontendBaseUrl = (req) => {
  const originHeader = normalizeOriginText(req?.get?.("origin"));
  if (/^https?:\/\//i.test(originHeader)) return originHeader;

  const refererOrigin = getOriginFromReferer(req?.get?.("referer"));
  if (/^https?:\/\//i.test(refererOrigin)) return refererOrigin;

  const configured = getConfiguredFrontendBaseUrl();
  if (configured) return configured;

  return "http://localhost:5173";
};

const buildPaymentRedirectUrls = (bookingId, req) => {
  const base = frontendBaseUrl(req);
  const id = encodeURIComponent(String(bookingId));
  return {
    successUrl: `${base}/bookings?payment=success&bookingId=${id}`,
    cancelUrl: `${base}/bookings?payment=cancelled&bookingId=${id}`,
  };
};

const buildReferenceNumber = (bookingId) => {
  const suffix = Date.now().toString().slice(-6);
  const shortId = String(bookingId || "").slice(-8).toUpperCase();
  return `BOOK-${shortId}-${suffix}`;
};

const DOWNPAYMENT_RATE = 0.3;
const MIN_SAME_DAY_RENTAL_MS = 60 * 60 * 1000;
const PAYMENT_AMOUNT_EPSILON = 0.01;
const PAYMENT_SCOPES = new Set(["downpayment", "full"]);
const PAYMENT_CHANNELS = new Set(["ewallet", "card"]);
const PAYMENT_CHANNEL_METHOD_TYPES = {
  ewallet: ["gcash", "paymaya"],
  card: ["card"],
};
const WALK_IN_PAYMENT_STATUSES = new Set(["none", "requested", "approved", "rejected", "completed"]);
const ACTIVE_WALK_IN_SETTLEMENT_STATUSES = new Set(["requested", "approved"]);
const ACTIVE_BOOKING_STATUSES = new Set(["confirmed", "extended"]);
const ACTIVE_OVERLAP_STATUSES = ["pending", "confirmed", "extended"];
const PAYMENT_ALLOWED_STATUSES = new Set(["confirmed", "extended", "completed"]);
const EXTENSION_STATUSES = new Set(["none", "requested", "approved", "rejected"]);
const CANCELLATION_STATUSES = new Set(["none", "requested", "approved", "rejected"]);
const RETURN_STATUSES = new Set(["none", "requested", "confirmed", "declined"]);
const LATE_RETURN_ACTIONS = new Set(["none", "extend_requested", "proceed_late_return", "return_confirmed"]);

const resolvePaymentScope = (value, fallback = "downpayment") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (PAYMENT_SCOPES.has(normalized)) return normalized;
  return fallback;
};

const resolvePaymentChannel = (value, fallback = "ewallet") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (PAYMENT_CHANNELS.has(normalized)) return normalized;
  return fallback;
};

const buildRenterName = (user = {}, renterProfile = {}) => {
  const directName = String(user?.name || renterProfile?.name || "").trim();
  if (directName) return directName;
  const firstName = String(user?.firstName || renterProfile?.firstName || "").trim();
  const lastName = String(user?.lastName || renterProfile?.lastName || "").trim();
  const combined = `${firstName} ${lastName}`.trim();
  return combined || "Renter";
};

const normalizePayMongoPhone = (phoneValue) => {
  return normalizePhilippineMobile(phoneValue);
};

const logPayMongoError = (context, error) => {
  console.error(`[PayMongo] ${context}`, {
    message: error?.message,
    code: error?.code,
    statusCode: error?.statusCode,
    stack: error?.stack,
  });
};

const getBookingReturnBoundaryWithGrace = (booking, graceMinutes = 0) => {
  const returnAt = toDate(booking?.returnAt);
  if (!returnAt) return null;
  const grace = Math.max(0, Math.floor(Number(graceMinutes || 0)));
  if (grace <= 0) return returnAt;
  return new Date(returnAt.getTime() + grace * 60 * 1000);
};

const getBookingOverdueMinutes = (booking, now = new Date(), graceMinutes = 0) => {
  const boundaryAt = getBookingReturnBoundaryWithGrace(booking, graceMinutes);
  const current = toDate(now);
  if (!boundaryAt || !current) return 0;
  if (current.getTime() <= boundaryAt.getTime()) return 0;
  return Math.max(0, getDurationMinutes(boundaryAt, current));
};

const recalculateBookingAmountsForRange = (booking, nextReturnAt) => {
  const pickupAt = toDate(booking?.pickupAt);
  const returnAt = toDate(nextReturnAt);
  if (!pickupAt || !returnAt || returnAt.getTime() <= pickupAt.getTime()) {
    return null;
  }

  const bookingDurationMinutes = getDurationMinutes(pickupAt, returnAt);
  const bookingDurationHours = getDurationHoursFromMinutes(bookingDurationMinutes);
  const bookingDays = getLegacyBookingDays(bookingDurationMinutes);
  if (bookingDurationMinutes <= 0 || bookingDurationHours <= 0) {
    return null;
  }

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

const syncBookingPaymentSnapshot = (booking) => {
  const totalPayable = getBookingPayableAmount(booking);
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

const normalizeWalkInStatus = (value, fallback = "none") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (WALK_IN_PAYMENT_STATUSES.has(normalized)) return normalized;
  return fallback;
};

export const isOnlineBalancePaymentBlockedByWalkIn = (booking) =>
  String(booking?.paymentStatus || "").trim().toLowerCase() === "partial" &&
  ACTIVE_WALK_IN_SETTLEMENT_STATUSES.has(normalizeWalkInStatus(booking?.walkInPaymentStatus, "none"));

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

const normalizeLateReturnAction = (value, fallback = "none") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (LATE_RETURN_ACTIONS.has(normalized)) return normalized;
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

const normalizeIdText = (value) => String(value || "").trim();

const getVerifiedCheckoutIds = (booking) => {
  const ids = Array.isArray(booking?.paymongoVerifiedCheckoutIds)
    ? booking.paymongoVerifiedCheckoutIds
    : [];
  return [...new Set(ids.map((id) => normalizeIdText(id)).filter(Boolean))];
};

const hasVerifiedCheckoutId = (booking, checkoutId) => {
  const normalizedId = normalizeIdText(checkoutId);
  if (!normalizedId) return false;
  return getVerifiedCheckoutIds(booking).includes(normalizedId);
};

const appendVerifiedCheckoutId = (booking, checkoutId) => {
  const normalizedId = normalizeIdText(checkoutId);
  if (!normalizedId) return;
  const existing = getVerifiedCheckoutIds(booking);
  if (existing.includes(normalizedId)) {
    booking.paymongoVerifiedCheckoutIds = existing;
    return;
  }
  booking.paymongoVerifiedCheckoutIds = [...existing, normalizedId];
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
  const penaltyFee = roundCurrency(Number(booking?.lateReturnPenaltyFee || 0));
  return {
    isOverdue: Boolean(booking?.lateReturnIsOverdue),
    overdueMinutes,
    detectedAt: booking?.lateReturnDetectedAt || null,
    notifiedAt: booking?.lateReturnNotifiedAt || null,
    penaltyRatePerHour: getBookingLatePenaltyRatePerHour(booking),
    penaltyFee,
    estimatedPenaltyFee: getEstimatedLateReturnPenaltyFee(booking),
    feeType: policy.feeType,
    feeValue: policy.value,
    graceMinutes: policy.graceMinutes,
    action: normalizeLateReturnAction(booking?.lateReturnAction, "none"),
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

const getBookingParties = (booking) => {
  const ownerId = String(booking?.owner?._id || booking?.owner || "");
  const renterId = String(booking?.renter?._id || booking?.renter || "");
  return { ownerId, renterId };
};

const buildBookingAccessQuery = (bookingId, user) => {
  const query = { _id: bookingId };

  if (user?.role === "user") {
    query.renter = user._id;
  } else if (user?.role === "owner") {
    query.owner = user._id;
  }

  return query;
};

const serializeBooking = (req, booking) => {
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
    vehicleDailyRate: vehicleHourlyRate,
    vehicleHourlyRate,
    driverSelected: booking.driverSelected,
    driverDailyRate: driverHourlyRate,
    driverHourlyRate,
    baseAmount: booking.baseAmount,
    driverAmount: booking.driverAmount,
    totalAmount: booking.totalAmount,
    lateReturnPolicy: getBookingLateReturnPolicy(booking),
    lateReturnPenaltyRatePerHour: getBookingLatePenaltyRatePerHour(booking),
    lateReturnPenaltyFee: getBookingLatePenaltyFee(booking),
    transactionFee: getEffectiveTransactionFee(booking),
    amountPayable: getBookingPayableAmount(booking),
    paymentAmountPaid: getBookingPaidAmount(booking),
    paymentAmountDue: getBookingRemainingAmount(booking),
    paymentCheckoutAmount: roundCurrency(Number(booking.paymentCheckoutAmount || 0)),
    paymentScope: booking.paymentScope || null,
    paymentChannel: booking.paymentChannel || null,
    downpaymentRate: DOWNPAYMENT_RATE,
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
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    reviewRating: booking.reviewRating,
    reviewComment: booking.reviewComment,
    reviewCreatedAt: booking.reviewCreatedAt,
    vehicle: booking.vehicle
      ? {
          _id: vehicle._id,
          name: vehicle.name,
          description: vehicle.description,
          location: vehicle.location,
          dailyRentalRate: getVehicleHourlyRate(vehicle, {
            rateField: "dailyRentalRate",
            unitField: "pricingUnit",
          }),
          hourlyRentalRate: getVehicleHourlyRate(vehicle, {
            rateField: "dailyRentalRate",
            unitField: "pricingUnit",
          }),
          pricingUnit: HOURLY_RATE_UNIT,
          driverOptionEnabled: Boolean(vehicle.driverOptionEnabled),
          driverDailyRate: getVehicleHourlyRate(vehicle, {
            rateField: "driverDailyRate",
            unitField: "pricingUnit",
          }),
          driverHourlyRate: getVehicleHourlyRate(vehicle, {
            rateField: "driverDailyRate",
            unitField: "pricingUnit",
          }),
          specs: vehicle.specs || {},
          images,
          imageUrl: getImageUrl(req, vehicle.imageUrl) || images[0],
          coverDisplayMode: vehicle.coverDisplayMode || "auto",
        }
      : null,
    owner: booking.owner || null,
    renter: booking.renter || null,
  };
};

const bookingPopulate = [
  {
    path: "vehicle",
    select:
      "name description location images imageUrl coverDisplayMode dailyRentalRate pricingUnit driverOptionEnabled driverDailyRate specs owner",
  },
  { path: "owner", select: "name email avatar role" },
  { path: "renter", select: "name email avatar role" },
];

// Booking history is an account ledger, not a TTL-managed resource.  These
// list helpers deliberately page results so a long-lived account cannot turn a
// normal page visit into an unbounded database query or response.
const BOOKING_LIST_DEFAULT_LIMIT = 10;
const BOOKING_LIST_MAX_LIMIT = 50;
const LIST_CURRENT_BOOKING_STATUSES = ["pending", "confirmed", "extended"];
const LIST_ACTIVE_BOOKING_STATUSES = ["confirmed", "extended"];
const LIST_PAST_BOOKING_STATUSES = ["completed", "cancelled", "rejected"];

const parseBookingListLimit = (value) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return BOOKING_LIST_DEFAULT_LIMIT;
  return Math.min(parsed, BOOKING_LIST_MAX_LIMIT);
};

const parseBookingListCursor = (value) => {
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

const createBookingListCursor = (booking, sortField) => {
  const sortValue = toDate(booking?.[sortField]);
  if (!sortValue || !booking?._id) return null;
  return Buffer.from(
    JSON.stringify({ at: sortValue.toISOString(), id: String(booking._id) })
  ).toString("base64url");
};

const cursorFilter = (cursor, sortField, direction) => {
  if (!cursor) return {};
  const comparison = direction === "asc" ? "$gt" : "$lt";
  return {
    $or: [
      { [sortField]: { [comparison]: cursor.at } },
      { [sortField]: cursor.at, _id: { [comparison]: cursor.id } },
    ],
  };
};

const buildBookingListDefinition = ({ role, status, view }) => {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const normalizedView = String(view || "").trim().toLowerCase();

  if (normalizedStatus === "cancelled") {
    return { filter: { status: { $in: ["cancelled", "rejected"] } }, sortField: "updatedAt", direction: "desc" };
  }

  if ([...LIST_ACTIVE_BOOKING_STATUSES, ...LIST_PAST_BOOKING_STATUSES].includes(normalizedStatus)) {
    return {
      filter: { status: normalizedStatus },
      sortField: normalizedStatus === "confirmed" || normalizedStatus === "extended" ? "pickupAt" : "updatedAt",
      direction: normalizedStatus === "confirmed" || normalizedStatus === "extended" ? "asc" : "desc",
    };
  }

  if (role === "renter" && normalizedView === "current") {
    return { filter: { status: { $in: LIST_CURRENT_BOOKING_STATUSES } }, sortField: "pickupAt", direction: "asc" };
  }

  if (normalizedView === "active") {
    return { filter: { status: { $in: LIST_ACTIVE_BOOKING_STATUSES } }, sortField: "pickupAt", direction: "asc" };
  }

  if (role === "renter" && normalizedView === "unsettled") {
    return {
      filter: {
        status: { $in: [...LIST_ACTIVE_BOOKING_STATUSES, "completed"] },
        paymentStatus: { $ne: "refunded" },
        $and: [
          {
            $or: [
              { paymentStatus: { $in: ["unpaid", "partial"] } },
              { paymentAmountDue: { $gt: 0 } },
            ],
          },
          {
            $or: [
              { status: "completed" },
              { status: { $in: LIST_ACTIVE_BOOKING_STATUSES }, returnAt: { $lt: new Date() } },
              { walkInPaymentStatus: { $in: ["requested", "approved"] } },
            ],
          },
        ],
      },
      sortField: "updatedAt",
      direction: "desc",
    };
  }

  if (["past", "history"].includes(normalizedView)) {
    return { filter: { status: { $in: LIST_PAST_BOOKING_STATUSES } }, sortField: "updatedAt", direction: "desc" };
  }

  if (role === "owner" && normalizedView === "action") {
    return {
      filter: {
        $or: [
          { status: "pending" },
          { extensionStatus: "requested" },
          { cancellationStatus: "requested" },
          { walkInPaymentStatus: "requested" },
          { returnStatus: "requested" },
          { status: { $in: ["confirmed", "extended"] }, lateReturnIsOverdue: true },
        ],
      },
      sortField: "updatedAt",
      direction: "desc",
    };
  }

  return { filter: {}, sortField: "updatedAt", direction: "desc" };
};

const listBookingsForParty = async ({ req, partyField, role }) => {
  const { filter, sortField, direction } = buildBookingListDefinition({
    role,
    status: req.query.status,
    view: req.query.view,
  });
  const limit = parseBookingListLimit(req.query.limit);
  const cursor = parseBookingListCursor(req.query.cursor);
  const paginationFilter = cursorFilter(cursor, sortField, direction);
  const query = {
    [partyField]: req.user._id,
    $and: [filter, paginationFilter],
  };
  const sortDirection = direction === "asc" ? 1 : -1;

  const documents = await Booking.find(query)
    .populate(bookingPopulate)
    .sort({ [sortField]: sortDirection, _id: sortDirection })
    .limit(limit + 1);

  const hasMore = documents.length > limit;
  const bookings = hasMore ? documents.slice(0, limit) : documents;
  await autoSyncBookingLifecycles(req, bookings);
  const autoSynced = await autoSyncBookingPayments(bookings);
  for (const booking of autoSynced) {
    emitBookingUpdateToParties(req, booking);
  }

  return {
    bookings: bookings.map((booking) => serializeBooking(req, booking)),
    page: {
      hasMore,
      nextCursor: hasMore ? createBookingListCursor(bookings[bookings.length - 1], sortField) : null,
      limit,
    },
  };
};

export const createBooking = async (req, res) => {
  let renterLock;
  let lockAcquired = false;
  let lockedVehicleId = null;
  const releaseVehicleLock = async () => {
    if (!lockAcquired || !lockedVehicleId) return;
    await syncVehicleAvailabilityByBookingState(lockedVehicleId);
    lockAcquired = false;
  };

  try {
    const {
      vehicleId,
      pickupAt: pickupRaw,
      returnAt: returnRaw,
      driverSelected: driverSelectedRaw,
    } = req.body;

    if (!vehicleId || !pickupRaw || !returnRaw) {
      return res.status(400).json({
        success: false,
        message: "vehicleId, pickupAt, and returnAt are required.",
      });
    }

    const pickupAt = parseBookingDateTime(pickupRaw);
    const returnAt = parseBookingDateTime(returnRaw);
    if (!pickupAt || !returnAt) {
      return res.status(400).json({ success: false, message: "Invalid pickup or return date/time." });
    }

    const now = new Date();
    const horizonEnd = getBookingHorizonEnd(now);
    if (pickupAt > horizonEnd || returnAt > horizonEnd) {
      return res.status(400).json({ success: false, message: BOOKING_HORIZON_MESSAGE });
    }
    if (pickupAt < now || returnAt <= pickupAt) {
      return res.status(400).json({
        success: false,
        message: "Pickup must be in the future and return must be after pickup.",
      });
    }

    const isSameDayRental =
      pickupAt.getFullYear() === returnAt.getFullYear() &&
      pickupAt.getMonth() === returnAt.getMonth() &&
      pickupAt.getDate() === returnAt.getDate();
    if (isSameDayRental && returnAt.getTime() - pickupAt.getTime() < MIN_SAME_DAY_RENTAL_MS) {
      return res.status(400).json({
        success: false,
        message: "For same-day rentals, return must be at least 1 hour after pickup.",
      });
    }

    renterLock = await acquireBookingMutationLock(req.user._id);
    const eligibility = await getRenterBookingEligibility(req.user._id, { pickupAt, returnAt });
    if (!eligibility.eligible) {
      return res.status(409).json({
        success: false, code: eligibility.reasons[0].code,
        message: eligibility.reasons[0].message, eligibility,
      });
    }

    const vehicle = await Vehicle.findById(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found." });
    }

    if (String(vehicle.owner) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: "Owners cannot book their own vehicle." });
    }

    // Lock this vehicle so two requests cannot book it at the same time.
    const lockedVehicle = await Vehicle.findOneAndUpdate(
      { _id: vehicle._id, availabilityStatus: "available" },
      { $set: { availabilityStatus: "unavailable" } },
      { new: true }
    );
    if (!lockedVehicle) {
      return res.status(409).json({ success: false, message: "Vehicle is currently unavailable." });
    }
    lockAcquired = true;
    lockedVehicleId = lockedVehicle._id;

    const overlappingBooking = await Booking.findOne({
      vehicle: vehicle._id,
      status: { $in: ACTIVE_OVERLAP_STATUSES },
      pickupAt: { $lt: returnAt },
      returnAt: { $gt: pickupAt },
    });

    if (overlappingBooking) {
      await releaseVehicleLock();
      return res.status(409).json({
        success: false,
        message: "Vehicle already has a booking in the selected schedule.",
      });
    }

    const bookingDurationMinutes = getDurationMinutes(pickupAt, returnAt);
    const bookingDurationHours = getDurationHoursFromMinutes(bookingDurationMinutes);
    const bookingDays = getLegacyBookingDays(bookingDurationMinutes);
    if (bookingDurationMinutes <= 0 || bookingDurationHours <= 0) {
      await releaseVehicleLock();
      return res.status(400).json({
        success: false,
        message: "Invalid booking duration.",
      });
    }
    const driverSelected = boolFromValue(driverSelectedRaw);
    const driverDailyRate =
      driverSelected && lockedVehicle.driverOptionEnabled
        ? getVehicleHourlyRate(lockedVehicle, {
            rateField: "driverDailyRate",
            unitField: "pricingUnit",
          })
        : 0;

    if (driverSelected && !lockedVehicle.driverOptionEnabled) {
      await releaseVehicleLock();
      return res.status(400).json({
        success: false,
        message: "Driver option is not available for this vehicle.",
      });
    }

    const vehicleDailyRate = getVehicleHourlyRate(lockedVehicle, {
      rateField: "dailyRentalRate",
      unitField: "pricingUnit",
    });
    const baseAmount = roundCurrency(vehicleDailyRate * bookingDurationHours);
    const driverAmount = roundCurrency(driverDailyRate * bookingDurationHours);
    const totalAmount = roundCurrency(baseAmount + driverAmount);
    const transactionFee = getTransactionFee();
    const paymentAmountDue = roundCurrency(totalAmount + transactionFee);
    const lateReturnPolicySnapshot = createBookingLateReturnPolicySnapshot({
      vehicle: lockedVehicle,
      vehicleHourlyRate: vehicleDailyRate,
      driverHourlyRate: driverDailyRate,
      driverSelected,
    });

    let booking;
    await renterLock.renew();
    booking = await Booking.create({
      vehicle: lockedVehicle._id,
      renter: req.user._id,
      owner: lockedVehicle.owner,
      pickupAt,
      returnAt,
      bookingDays,
      bookingDurationMinutes,
      bookingDurationHours,
      rentalRateUnit: HOURLY_RATE_UNIT,
      vehicleDailyRate,
      driverSelected,
      driverDailyRate,
      baseAmount,
      driverAmount,
      totalAmount,
      transactionFee,
      status: "pending",
      paymentStatus: "unpaid",
      paymentAmountPaid: 0,
      paymentAmountDue,
      paymentCheckoutAmount: 0,
      paymentScope: null,
      paymentChannel: null,
      ...lateReturnPolicySnapshot,
      lateReturnPenaltyFee: 0,
      lateReturnIsOverdue: false,
      lateReturnDetectedAt: null,
      lateReturnNotifiedAt: null,
      lateReturnOverdueMinutes: 0,
      lateReturnAction: "none",
      lateReturnResolvedAt: null,
      lateReturnResolvedBy: null,
      extensionStatus: "none",
      extensionRequestedAt: null,
      extensionRequestedBy: null,
      extensionCurrentReturnAt: null,
      extensionRequestedReturnAt: null,
      extensionRequestNote: "",
      extensionReviewedAt: null,
      extensionReviewedBy: null,
      extensionReviewAction: "",
      extensionReviewNote: "",
      autoCompletedAt: null,
      actualReturnAt: null,
      returnStatus: "none",
      returnRequestedAt: null,
      returnRequestedBy: null,
      returnConfirmedAt: null,
      returnConfirmedBy: null,
      returnReviewedAt: null,
      returnReviewedBy: null,
      returnReviewAction: "",
      returnReviewNote: "",
    });
    await releaseVehicleLock();

    eventBus.emit(NOTIFICATION_EVENTS.BOOKING_CREATED, {
      booking,
      actor: req.user,
      vehicle,
    });

    const populated = await Booking.findById(booking._id).populate(bookingPopulate);
    const payload = serializeBooking(req, populated);

    emitToUser(String(vehicle.owner), "booking:updated", payload);
    emitToUser(String(req.user._id), "booking:updated", payload);

    res.status(201).json({
      success: true,
      message: "Booking created successfully.",
      booking: payload,
    });
  } catch (error) {
    try {
      await releaseVehicleLock();
    } catch {
      // Do not hide the original booking error.
    }
    if (error instanceof BookingPolicyError) {
      return res.status(409).json({ success: false, code: error.code, message: error.message });
    }
    res.status(500).json({ success: false, message: "Failed to create booking." });
  } finally {
    await renterLock?.release();
  }
};

export const getMyBookingEligibility = async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const { pickupAt, returnAt } = req.query;
    const hasRange = pickupAt !== undefined || returnAt !== undefined;
    const validRange = typeof pickupAt === "string" && typeof returnAt === "string" &&
      pickupAt && returnAt && parseBookingDateTime(pickupAt) && parseBookingDateTime(returnAt) && toDate(returnAt) > toDate(pickupAt);
    if (hasRange && !validRange) {
      return res.status(400).json({ success: false, message: "Provide a valid pickup and return date range." });
    }
    const horizonEnd = getBookingHorizonEnd();
    if (hasRange && (toDate(pickupAt) > horizonEnd || toDate(returnAt) > horizonEnd)) {
      return res.status(400).json({ success: false, message: BOOKING_HORIZON_MESSAGE });
    }
    const eligibility = await getRenterBookingEligibility(req.user._id, { pickupAt, returnAt });
    return res.json({ success: true, eligibility });
  } catch {
    return res.status(500).json({ success: false, message: "Unable to check booking eligibility. Please try again." });
  }
};

export const getMyBookings = async (req, res) => {
  try {
    const result = await listBookingsForParty({ req, partyField: "renter", role: "renter" });
    res.json({ success: true, ...result });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch bookings." });
  }
};

export const getOwnerBookings = async (req, res) => {
  try {
    const result = await listBookingsForParty({ req, partyField: "owner", role: "owner" });
    res.json({ success: true, ...result });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch owner bookings." });
  }
};

export const getBookingById = async (req, res) => {
  try {
    const booking = await Booking.findOne(buildBookingAccessQuery(req.params.id, req.user)).populate(
      bookingPopulate
    );

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    const lifecycleSync = await syncBookingLifecycleState(req, booking, { emitUpdate: false });
    const autoSync = await autoSyncBookingPaymentFromPayMongo(booking);
    if (lifecycleSync.updated || autoSync.updated) {
      emitBookingUpdateToParties(req, booking);
    }

    return res.json({
      success: true,
      booking: serializeBooking(req, booking),
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch booking." });
  }
};

export const cancelMyBooking = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, renter: req.user._id }).populate(bookingPopulate);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    await syncBookingLifecycleState(req, booking, { emitUpdate: false });

    const normalizedStatus = String(booking.status || "").trim().toLowerCase();
    if (!["pending", "confirmed", "extended"].includes(normalizedStatus)) {
      return res.status(400).json({ success: false, message: "Booking can no longer be cancelled." });
    }

    if (normalizeReturnStatus(booking.returnStatus, "none") === "requested") {
      return res.status(409).json({
        success: false,
        message: "A vehicle return is waiting for owner confirmation and can no longer be cancelled.",
      });
    }

    if (normalizedStatus !== "pending") {
      const cancellationStatus = normalizeCancellationStatus(booking.cancellationStatus, "none");
      if (cancellationStatus === "requested") {
        return res.status(409).json({
          success: false,
          message: "A cancellation request is already waiting for owner approval.",
        });
      }

      const now = new Date();
      booking.cancellationStatus = "requested";
      booking.cancellationRequestedAt = now;
      booking.cancellationRequestedBy = req.user._id;
      booking.cancellationRequestNote = toOptionalText(req.body?.note, 500);
      booking.cancellationReviewedAt = null;
      booking.cancellationReviewedBy = null;
      booking.cancellationReviewAction = "";
      booking.cancellationReviewNote = "";
      await booking.save();

      eventBus.emit(NOTIFICATION_EVENTS.CANCELLATION_REQUESTED, {
        booking,
        actor: req.user,
        status: normalizedStatus,
      });

      const refreshed = await Booking.findById(booking._id).populate(bookingPopulate);
      const payload = serializeBooking(req, refreshed);
      const { ownerId, renterId } = getBookingParties(refreshed);
      emitToUser(ownerId, "booking:updated", payload);
      emitToUser(renterId, "booking:updated", payload);

      return res.json({
        success: true,
        message: "Cancellation request submitted. Waiting for owner approval.",
        booking: payload,
      });
    }

    booking.status = "cancelled";
    booking.cancellationStatus = "none";
    booking.cancellationRequestedAt = null;
    booking.cancellationRequestedBy = null;
    booking.cancellationRequestNote = "";
    booking.cancellationReviewedAt = null;
    booking.cancellationReviewedBy = null;
    booking.cancellationReviewAction = "";
    booking.cancellationReviewNote = "";
    await booking.save();
    await syncVehicleAvailabilityByBookingState(booking.vehicle?._id || booking.vehicle);

    eventBus.emit(NOTIFICATION_EVENTS.BOOKING_CANCELLED, {
      booking,
      actor: req.user,
      cancelledBy: "renter",
    });

    const populated = await Booking.findById(booking._id).populate(bookingPopulate);
    const payload = serializeBooking(req, populated);
    const { ownerId, renterId } = getBookingParties(populated);
    emitToUser(ownerId, "booking:updated", payload);
    emitToUser(renterId, "booking:updated", payload);

    res.json({ success: true, message: "Booking cancelled.", booking: payload });
  } catch {
    res.status(500).json({ success: false, message: "Failed to cancel booking." });
  }
};

export const requestBookingExtension = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, renter: req.user._id }).populate(bookingPopulate);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    await syncBookingLifecycleState(req, booking, { emitUpdate: false });

    const normalizedStatus = String(booking.status || "").trim().toLowerCase();
    if (["cancelled", "rejected", "completed"].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: "This booking can no longer be extended.",
      });
    }
    if (!ACTIVE_BOOKING_STATUSES.has(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: "Only active approved bookings can be extended.",
      });
    }

    if (normalizeReturnStatus(booking.returnStatus, "none") === "requested") {
      return res.status(409).json({
        success: false,
        message: "A vehicle return is already waiting for owner confirmation.",
      });
    }

    const extensionStatus = normalizeExtensionStatus(booking.extensionStatus, "none");
    if (extensionStatus === "requested") {
      return res.status(409).json({
        success: false,
        message: "An extension request is already pending owner approval.",
      });
    }

    const requestedReturnAt = parseBookingDateTime(req.body?.newReturnAt);
    if (!requestedReturnAt) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid new return date and time.",
      });
    }
    if (requestedReturnAt > getBookingHorizonEnd()) {
      return res.status(400).json({ success: false, message: BOOKING_HORIZON_MESSAGE });
    }

    const currentReturnAt = toDate(booking.returnAt);
    if (!currentReturnAt || requestedReturnAt.getTime() <= currentReturnAt.getTime()) {
      return res.status(400).json({
        success: false,
        message: "New return date/time must be later than the current return schedule.",
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
        message: "Cannot request extension because the selected schedule overlaps another booking.",
      });
    }

    if (await findRenterScheduleConflict(booking, requestedReturnAt)) {
      return res.status(409).json({
        success: false, code: "RENTER_SCHEDULE_CONFLICT",
        message: "This extension overlaps another one of your bookings. Choose an earlier return time or resolve the conflicting booking first.",
      });
    }

    const requestNote = toOptionalText(req.body?.note, 500);
    const now = new Date();
    booking.extensionStatus = "requested";
    booking.extensionRequestedAt = now;
    booking.extensionRequestedBy = req.user._id;
    booking.extensionCurrentReturnAt = currentReturnAt;
    booking.extensionRequestedReturnAt = requestedReturnAt;
    booking.extensionRequestNote = requestNote;
    booking.extensionReviewedAt = null;
    booking.extensionReviewedBy = null;
    booking.extensionReviewAction = "";
    booking.extensionReviewNote = "";
    booking.lateReturnAction = "extend_requested";
    booking.paymentUpdatedAt = now;
    await booking.save();

    eventBus.emit(NOTIFICATION_EVENTS.EXTENSION_REQUESTED, {
      booking,
      actor: req.user,
      requestedReturnAt,
    });

    const refreshed = await Booking.findById(booking._id).populate(bookingPopulate);
    const payload = serializeBooking(req, refreshed);
    const { ownerId, renterId } = getBookingParties(refreshed);
    emitToUser(ownerId, "booking:updated", payload);
    emitToUser(renterId, "booking:updated", payload);

    return res.json({
      success: true,
      message: "Extension request submitted. Waiting for owner approval.",
      booking: payload,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to request extension." });
  }
};

export const requestBookingReturn = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, renter: req.user._id }).populate(bookingPopulate);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    await syncBookingLifecycleState(req, booking, { emitUpdate: false });

    const normalizedStatus = String(booking.status || "").trim().toLowerCase();
    if (["cancelled", "rejected", "completed"].includes(normalizedStatus)) {
      if (
        normalizedStatus === "completed" &&
        normalizeReturnStatus(booking.returnStatus, "none") === "confirmed"
      ) {
        return res.json({
          success: true,
          message: "The owner has already confirmed this vehicle return.",
          booking: serializeBooking(req, booking),
        });
      }
      return res.status(400).json({
        success: false,
        message: "This booking can no longer request a vehicle return.",
      });
    }
    if (!ACTIVE_BOOKING_STATUSES.has(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: "Only active approved bookings can request a vehicle return.",
      });
    }

    const pickupAt = toDate(booking.pickupAt);
    const now = new Date();
    if (!pickupAt || now.getTime() < pickupAt.getTime()) {
      return res.status(400).json({
        success: false,
        message: "Vehicle return can only be requested after the rental has started.",
      });
    }

    if (normalizeReturnStatus(booking.returnStatus, "none") === "requested") {
      return res.json({
        success: true,
        message: "Vehicle return has already been requested. Waiting for owner confirmation.",
        booking: serializeBooking(req, booking),
      });
    }

    if (normalizeExtensionStatus(booking.extensionStatus, "none") === "requested") {
      return res.status(409).json({
        success: false,
        message: "An extension request is pending. Please wait for owner review first.",
      });
    }

    booking.returnStatus = "requested";
    booking.returnRequestedAt = now;
    booking.returnRequestedBy = req.user._id;
    booking.returnConfirmedAt = null;
    booking.returnConfirmedBy = null;
    booking.returnReviewedAt = null;
    booking.returnReviewedBy = null;
    booking.returnReviewAction = "";
    booking.returnReviewNote = "";

    await booking.save();
    await Vehicle.updateOne(
      { _id: booking.vehicle?._id || booking.vehicle },
      { $set: { availabilityStatus: "unavailable" } }
    );

    eventBus.emit(NOTIFICATION_EVENTS.VEHICLE_RETURN_REQUESTED, {
      booking,
      actor: req.user,
    });

    const refreshed = await Booking.findById(booking._id).populate(bookingPopulate);
    const payload = serializeBooking(req, refreshed);
    const { ownerId, renterId } = getBookingParties(refreshed);
    emitToUser(ownerId, "booking:updated", payload);
    emitToUser(renterId, "booking:updated", payload);

    return res.json({
      success: true,
      message: "Vehicle return requested. The vehicle remains unavailable until the owner confirms receipt and completes inspection.",
      booking: payload,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to request vehicle return." });
  }
};

// Backward-compatible handler for older clients. This route now starts the
// physical-return workflow and never completes a booking by itself.
export const proceedBookingLateReturn = requestBookingReturn;

export const createBookingPayment = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, renter: req.user._id }).populate(
      bookingPopulate
    );
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }
    await syncBookingLifecycleState(req, booking, { emitUpdate: false });
    const normalizedPaymentStatus = String(booking.paymentStatus || "").toLowerCase();
    if (!["unpaid", "partial"].includes(normalizedPaymentStatus)) {
      return res.status(400).json({
        success: false,
        message: "Only unpaid or partially paid bookings can start a payment checkout.",
        booking: serializeBooking(req, booking),
      });
    }
    if (["cancelled", "rejected"].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: "Cancelled bookings cannot be paid.",
      });
    }
    const normalizedBookingStatus = String(booking.status || "").trim().toLowerCase();
    if (!PAYMENT_ALLOWED_STATUSES.has(normalizedBookingStatus)) {
      return res.status(400).json({
        success: false,
        message: "Booking payment is only available for approved, extended, or completed bookings.",
        booking: serializeBooking(req, booking),
      });
    }
    if (isOnlineBalancePaymentBlockedByWalkIn(booking)) {
      const walkInStatus = normalizeWalkInStatus(booking.walkInPaymentStatus, "none");
      return res.status(409).json({
        success: false,
        code: "WALK_IN_BALANCE_IN_PROGRESS",
        message:
          walkInStatus === "approved"
            ? "Your walk-in payment request has been approved. Please pay the remaining balance directly to the owner."
            : "Walk-in payment approval is still pending. Online checkout is unavailable until the owner reviews the request.",
        booking: serializeBooking(req, booking),
      });
    }

    const effectiveTransactionFee = getEffectiveTransactionFee(booking);
    const persistedTransactionFee = Number(booking.transactionFee);
    if (
      (!Number.isFinite(persistedTransactionFee) || persistedTransactionFee < effectiveTransactionFee) &&
      effectiveTransactionFee > 0
    ) {
      booking.transactionFee = effectiveTransactionFee;
    }

    const totalPayable = getBookingPayableAmount(booking);
    const paidAmount = getBookingPaidAmount(booking);
    const remainingAmount = getBookingRemainingAmount(booking);
    if (!Number.isFinite(totalPayable) || totalPayable <= 0) {
      return res.status(400).json({
        success: false,
        message: "Booking amount is invalid for payment.",
      });
    }
    if (!Number.isFinite(remainingAmount) || remainingAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "This booking is already fully paid.",
        booking: serializeBooking(req, booking),
      });
    }

    const defaultScope = normalizedPaymentStatus === "partial" ? "full" : "downpayment";
    const requestedScope = resolvePaymentScope(req.body?.paymentScope, defaultScope);
    if (normalizedPaymentStatus === "partial" && requestedScope !== "full") {
      return res.status(400).json({
        success: false,
        message: "Remaining balance must be paid in full.",
      });
    }

    const requestedChannel = resolvePaymentChannel(req.body?.paymentChannel, "ewallet");
    const methodTypes = PAYMENT_CHANNEL_METHOD_TYPES[requestedChannel] || PAYMENT_CHANNEL_METHOD_TYPES.ewallet;

    let effectiveScope = requestedScope;
    let amountToCharge = remainingAmount;
    if (normalizedPaymentStatus === "unpaid" && requestedScope === "downpayment") {
      amountToCharge = roundCurrency(totalPayable * DOWNPAYMENT_RATE);
      if (amountToCharge <= 0 || amountToCharge >= remainingAmount) {
        amountToCharge = remainingAmount;
        effectiveScope = "full";
      }
    } else {
      amountToCharge = remainingAmount;
      effectiveScope = "full";
    }

    if (!Number.isFinite(amountToCharge) || amountToCharge <= 0) {
      return res.status(400).json({
        success: false,
        message: "Payment amount is invalid for checkout.",
      });
    }

    const referenceNumber = buildReferenceNumber(booking._id);
    const amountInCentavos = Math.round(amountToCharge * 100);
    const { successUrl, cancelUrl } = buildPaymentRedirectUrls(booking._id, req);
    const renterProfile = booking?.renter || {};
    const renterName = buildRenterName(req.user, renterProfile);
    const vehicleName = booking.vehicle?.name || "vehicle rental";
    const description = `Booking ${effectiveScope} payment for ${vehicleName} (Renter: ${renterName})`;
    const lineItemBaseName = booking.vehicle?.name || "Vehicle Booking";
    const itemName = renterName ? `${lineItemBaseName} - ${renterName}` : lineItemBaseName;
    const renterEmail = String(req.user?.email || renterProfile.email || "").trim();
    const renterPhone = normalizePayMongoPhone(
      req.user?.phone || renterProfile.phone || renterProfile.mobile || renterProfile.phoneNumber
    );
    if (!renterPhone) {
      return res.status(400).json({
        success: false,
        message:
          "A valid mobile number is required before checkout. Please update your profile with a 10-digit Philippine mobile number starting with 9.",
      });
    }
    const billing = {
      name: renterName,
      email: renterEmail,
      phone: renterPhone,
    };

    const checkoutSession = await createPayMongoCheckoutSession({
      amountInCentavos,
      itemName,
      description,
      referenceNumber,
      successUrl,
      cancelUrl,
      billing,
      paymentMethodTypes: methodTypes,
      metadata: {
        bookingId: String(booking._id),
        renterId: String(req.user._id),
        renterName,
        renterEmail: billing.email,
        ownerId: String(booking.owner?._id || booking.owner || ""),
        paymentScope: effectiveScope,
        paymentChannel: requestedChannel,
        paymentAmount: amountToCharge,
        totalPayable,
        remainingAmount,
        transactionFee: Number(getEffectiveTransactionFee(booking) || 0),
      },
    });

    const checkoutId = getPayMongoCheckoutId(checkoutSession);
    const checkoutUrl = getPayMongoCheckoutUrl(checkoutSession);
    if (!checkoutId || !checkoutUrl) {
      return res.status(502).json({
        success: false,
        message: "Failed to create payment checkout URL.",
      });
    }

    booking.paymentMethod = "PayMongo";
    resetWalkInPaymentState(booking);
    booking.paymongoReference = getPayMongoCheckoutReferenceNumber(checkoutSession) || referenceNumber;
    booking.paymongoCheckoutId = checkoutId;
    booking.paymentIntentId = getPayMongoPaymentIntentId(checkoutSession) || booking.paymentIntentId;
    booking.paymentScope = effectiveScope;
    booking.paymentChannel = requestedChannel;
    booking.paymentCheckoutAmount = amountToCharge;
    booking.paymentAmountPaid = paidAmount;
    booking.paymentAmountDue = remainingAmount;
    booking.paymentRequestedAt = new Date();
    booking.paymentUpdatedAt = new Date();
    await booking.save();

    const refreshed = await Booking.findById(booking._id).populate(bookingPopulate);
    const payload = serializeBooking(req, refreshed);
    const { ownerId, renterId } = getBookingParties(refreshed);

    emitToUser(ownerId, "booking:updated", payload);
    emitToUser(renterId, "booking:updated", payload);

    return res.json({
      success: true,
      message: "Payment checkout created.",
      checkoutUrl,
      checkoutId,
      referenceNumber: payload.paymongoReference,
      payment: {
        scope: effectiveScope,
        channel: requestedChannel,
        amountToCharge,
        totalPayable,
        amountPaid: paidAmount,
        amountRemainingAfterThis: roundCurrency(Math.max(remainingAmount - amountToCharge, 0)),
      },
      booking: payload,
    });
  } catch (error) {
    if (error?.isPayMongoError) {
      logPayMongoError("Checkout session creation failed", error);
      const statusCode = error?.statusCode >= 400 && error?.statusCode < 600 ? error.statusCode : 502;
      return res.status(statusCode).json({
        success: false,
        message: "We could not start the payment. Please try again later.",
      });
    }
    console.error("[Booking Payment] Checkout session creation failed", error);
    return res.status(500).json({ success: false, message: "Failed to create booking payment." });
  }
};

const shouldAutoSyncBookingPayment = (booking) => {
  if (!booking) return false;

  const bookingStatus = String(booking?.status || "").trim().toLowerCase();
  if (!PAYMENT_ALLOWED_STATUSES.has(bookingStatus)) return false;

  const paymentStatus = String(booking?.paymentStatus || "").trim().toLowerCase();
  if (!["unpaid", "partial"].includes(paymentStatus)) return false;

  const checkoutId = normalizeIdText(booking?.paymongoCheckoutId);
  if (!checkoutId) return false;

  if (paymentStatus === "partial") {
    const checkoutAmount = roundCurrency(Number(booking?.paymentCheckoutAmount || 0));
    if (!(checkoutAmount > 0)) return false;
  }

  return true;
};

const doesCheckoutMetadataMatchBooking = (booking, metadata = {}) => {
  const expectedBookingId = normalizeIdText(booking?._id);
  const expectedRenterId = normalizeIdText(booking?.renter?._id || booking?.renter);
  const expectedOwnerId = normalizeIdText(booking?.owner?._id || booking?.owner);

  const metadataBookingId = normalizeIdText(metadata?.bookingId);
  const metadataRenterId = normalizeIdText(metadata?.renterId);
  const metadataOwnerId = normalizeIdText(metadata?.ownerId);

  if (metadataBookingId && metadataBookingId !== expectedBookingId) return false;
  if (metadataRenterId && metadataRenterId !== expectedRenterId) return false;
  if (metadataOwnerId && metadataOwnerId !== expectedOwnerId) return false;

  return true;
};

const autoSyncBookingPaymentFromPayMongo = async (booking) => {
  if (!shouldAutoSyncBookingPayment(booking)) {
    return { updated: false, paymentStatus: String(booking?.paymentStatus || "").toLowerCase() };
  }

  const checkoutId = normalizeIdText(booking?.paymongoCheckoutId);
  if (!checkoutId) {
    return { updated: false, paymentStatus: String(booking?.paymentStatus || "").toLowerCase() };
  }

  try {
    const checkoutSession = await getPayMongoCheckoutSession(checkoutId);
    const sessionCheckoutId = getPayMongoCheckoutId(checkoutSession) || checkoutId;
    const sessionReferenceNumber = getPayMongoCheckoutReferenceNumber(checkoutSession);
    const sessionMetadata = getPayMongoCheckoutMetadata(checkoutSession);

    if (!doesCheckoutMetadataMatchBooking(booking, sessionMetadata)) {
      return { updated: false, paymentStatus: String(booking?.paymentStatus || "").toLowerCase() };
    }

    if (!isPayMongoCheckoutPaid(checkoutSession) || hasVerifiedCheckoutId(booking, sessionCheckoutId)) {
      return { updated: false, paymentStatus: String(booking?.paymentStatus || "").toLowerCase() };
    }

    const sessionAmountInCentavos = getPayMongoCheckoutAmountInCentavos(checkoutSession);
    const sessionAmount = roundCurrency(Number(sessionAmountInCentavos) / 100);
    if (
      !Number.isFinite(sessionAmountInCentavos) ||
      sessionAmountInCentavos <= 0 ||
      !Number.isFinite(sessionAmount) ||
      sessionAmount <= 0
    ) {
      return { updated: false, paymentStatus: String(booking?.paymentStatus || "").toLowerCase() };
    }

    const totalPayable = getBookingPayableAmount(booking);
    const paidBefore = getBookingPaidAmount(booking);
    const remainingBefore = roundCurrency(Math.max(totalPayable - paidBefore, 0));
    if (sessionAmount > roundCurrency(remainingBefore + PAYMENT_AMOUNT_EPSILON)) {
      return { updated: false, paymentStatus: String(booking?.paymentStatus || "").toLowerCase() };
    }

    const paidAfter = Math.min(totalPayable, roundCurrency(paidBefore + sessionAmount));
    const remainingAfter = roundCurrency(Math.max(totalPayable - paidAfter, 0));

    booking.paymentMethod = "PayMongo";
    booking.paymongoCheckoutId = sessionCheckoutId;
    booking.paymongoReference = sessionReferenceNumber || booking.paymongoReference;
    booking.paymentIntentId = getPayMongoPaymentIntentId(checkoutSession) || booking.paymentIntentId;
    booking.paymentAmountPaid = paidAfter;
    booking.paymentAmountDue = remainingAfter;
    booking.paymentCheckoutAmount = 0;
    booking.paymentUpdatedAt = new Date();

    if (remainingAfter <= 0) {
      booking.paymentStatus = "paid";
      booking.paidAt = booking.paidAt || new Date();
    } else {
      booking.paymentStatus = "partial";
      booking.paidAt = null;
    }

    resetWalkInPaymentState(booking);
    appendVerifiedCheckoutId(booking, sessionCheckoutId);

    await booking.save();

    return { updated: true, paymentStatus: String(booking.paymentStatus || "").toLowerCase() };
  } catch (error) {
    if (error?.isPayMongoError) {
      logPayMongoError("Automatic payment sync failed", error);
      return { updated: false, paymentStatus: String(booking?.paymentStatus || "").toLowerCase() };
    }
    return { updated: false, paymentStatus: String(booking?.paymentStatus || "").toLowerCase() };
  }
};

const emitBookingUpdateToParties = (req, booking) => {
  if (!booking?._id) return;
  const payload = serializeBooking(req, booking);
  const { ownerId, renterId } = getBookingParties(booking);
  if (ownerId) emitToUser(ownerId, "booking:updated", payload);
  if (renterId) emitToUser(renterId, "booking:updated", payload);
};

const syncBookingLifecycleState = async (req, booking, { emitUpdate = false } = {}) => {
  if (!booking?._id) return { updated: false };

  const now = new Date();
  const lateReturnPolicy = getBookingLateReturnPolicy(booking);
  const normalizedStatus = String(booking?.status || "").trim().toLowerCase();
  const isActiveStatus = ACTIVE_BOOKING_STATUSES.has(normalizedStatus);
  const returnAt = toDate(booking?.returnAt);
  if (!returnAt) return { updated: false };

  if (!isActiveStatus) {
    return { updated: false };
  }

  if (now.getTime() < returnAt.getTime()) {
    return { updated: false };
  }

  const overdueMinutes = getBookingOverdueMinutes(booking, now, lateReturnPolicy.graceMinutes);
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
  const penaltyRatePerHour = getBookingLatePenaltyRatePerHour(booking);
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

  if ((changed || shouldNotifyOverdue) && emitUpdate) {
    emitBookingUpdateToParties(req, booking);
  }

  return { updated: changed || shouldNotifyOverdue, status: String(booking.status || "").toLowerCase() };
};

const autoSyncBookingLifecycles = async (req, bookings = []) => {
  const updatedBookings = [];
  for (const booking of bookings) {
    const result = await syncBookingLifecycleState(req, booking, { emitUpdate: true });
    if (result.updated) {
      updatedBookings.push(booking);
    }
  }
  return updatedBookings;
};

const autoSyncBookingPayments = async (bookings = []) => {
  const updatedBookings = [];
  const candidates = bookings.filter((booking) => shouldAutoSyncBookingPayment(booking)).slice(0, 5);
  for (const booking of candidates) {
    const result = await autoSyncBookingPaymentFromPayMongo(booking);
    if (result.updated) {
      updatedBookings.push(booking);
    }
  }
  return updatedBookings;
};

export const setBookingBalancePaymentMethod = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, renter: req.user._id }).populate(
      bookingPopulate
    );
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }
    await syncBookingLifecycleState(req, booking, { emitUpdate: false });
    if (["cancelled", "rejected"].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: "Cancelled bookings cannot be updated for payment.",
      });
    }
    if (!PAYMENT_ALLOWED_STATUSES.has(String(booking.status || "").trim().toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Booking must be approved, extended, or completed before setting payment options.",
      });
    }

    const normalizedPaymentStatus = String(booking.paymentStatus || "").toLowerCase();
    if (normalizedPaymentStatus !== "partial") {
      return res.status(400).json({
        success: false,
        message: "Walk-in payment is only available after the downpayment is recorded.",
      });
    }

    const remainingAmount = getBookingRemainingAmount(booking);
    if (!Number.isFinite(remainingAmount) || remainingAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "This booking has no remaining balance.",
      });
    }

    const requestedMethod = String(req.body?.method || "").trim().toLowerCase();
    if (!["walkin", "walk-in", "on_return", "on-return", "manual"].includes(requestedMethod)) {
      return res.status(400).json({
        success: false,
        message: "Invalid balance payment method.",
      });
    }

    const currentWalkInStatus = normalizeWalkInStatus(booking.walkInPaymentStatus, "none");
    if (currentWalkInStatus === "requested") {
      return res.status(409).json({
        success: false,
        message: "Walk-in payment approval is already pending.",
      });
    }
    if (currentWalkInStatus === "approved") {
      return res.status(409).json({
        success: false,
        message: "Walk-in payment has already been approved by the owner.",
      });
    }
    if (currentWalkInStatus === "completed") {
      return res.status(400).json({
        success: false,
        message: "Walk-in payment has already been confirmed.",
      });
    }

    const requestNote = toOptionalText(req.body?.note, 500);
    booking.balancePaymentMethod = "Walk-in";
    booking.walkInPaymentStatus = "requested";
    booking.walkInRequestedAt = new Date();
    booking.walkInRequestedBy = req.user._id;
    booking.walkInRequestNote = requestNote;
    booking.walkInReviewedAt = null;
    booking.walkInReviewedBy = null;
    booking.walkInReviewNote = "";
    booking.walkInConfirmedAt = null;
    booking.walkInConfirmedBy = null;
    booking.walkInConfirmationNote = "";
    booking.paymentUpdatedAt = new Date();
    await booking.save();

    const refreshed = await Booking.findById(booking._id).populate(bookingPopulate);
    const payload = serializeBooking(req, refreshed);
    const { ownerId, renterId } = getBookingParties(refreshed);

    eventBus.emit(NOTIFICATION_EVENTS.WALKIN_PAYMENT_REQUESTED, {
      booking: refreshed,
      actor: req.user,
      ownerId,
      renterId,
    });

    emitToUser(ownerId, "booking:updated", payload);
    emitToUser(renterId, "booking:updated", payload);

    return res.json({
      success: true,
      message: "Walk-in payment request submitted. Waiting for owner approval.",
      booking: payload,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update payment method." });
  }
};

export const verifyBookingPayment = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, renter: req.user._id }).populate(
      bookingPopulate
    );
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }
    await syncBookingLifecycleState(req, booking, { emitUpdate: false });
    if (["cancelled", "rejected"].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: "Cancelled bookings cannot be verified for payment.",
      });
    }
    const wasPaid = booking.paymentStatus === "paid";
    if (!wasPaid && !PAYMENT_ALLOWED_STATUSES.has(String(booking.status || "").trim().toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Booking payment can only be verified for approved, extended, or completed bookings.",
      });
    }
    let isPaid = wasPaid;
    let checkoutStatus = "";
    let verificationApplied = false;

    if (!wasPaid) {
      const checkoutIdInput = String(req.body?.checkoutId || "").trim();
      const storedCheckoutId = String(booking.paymongoCheckoutId || "").trim();
      const checkoutId = checkoutIdInput || storedCheckoutId;
      if (!checkoutId) {
        return res.status(400).json({
          success: false,
          message: "No PayMongo checkout reference found for this booking.",
        });
      }

      const checkoutSession = await getPayMongoCheckoutSession(checkoutId);
      checkoutStatus = String(checkoutSession?.attributes?.status || "").toLowerCase();
      const sessionCheckoutId = getPayMongoCheckoutId(checkoutSession);
      const sessionReferenceNumber = getPayMongoCheckoutReferenceNumber(checkoutSession);
      const sessionMetadata = getPayMongoCheckoutMetadata(checkoutSession);
      const sessionAmountInCentavos = getPayMongoCheckoutAmountInCentavos(checkoutSession);

      const expectedBookingId = String(booking._id || "");
      const expectedRenterId = String(booking.renter?._id || booking.renter || "");
      const expectedOwnerId = String(booking.owner?._id || booking.owner || "");
      const metadataBookingId = String(sessionMetadata?.bookingId || "");
      const metadataRenterId = String(sessionMetadata?.renterId || "");
      const metadataOwnerId = String(sessionMetadata?.ownerId || "");
      const metadataMatchesBooking = metadataBookingId && metadataBookingId === expectedBookingId;
      const metadataMatchesRenter = !metadataRenterId || metadataRenterId === expectedRenterId;
      const metadataMatchesOwner = !metadataOwnerId || metadataOwnerId === expectedOwnerId;
      const metadataMatchesExpected = metadataMatchesBooking && metadataMatchesRenter && metadataMatchesOwner;

      if (!metadataMatchesRenter || !metadataMatchesOwner || (metadataBookingId && !metadataMatchesBooking)) {
        return res.status(400).json({
          success: false,
          message: "Payment metadata does not match this booking.",
        });
      }

      const storedReferenceNumber = String(booking.paymongoReference || "").trim();
      const matchesStoredCheckout = Boolean(
        storedCheckoutId &&
          ((sessionCheckoutId && sessionCheckoutId === storedCheckoutId) || checkoutId === storedCheckoutId)
      );
      const matchesStoredReference = Boolean(
        storedReferenceNumber && sessionReferenceNumber && sessionReferenceNumber === storedReferenceNumber
      );

      if (!metadataMatchesExpected && !matchesStoredCheckout && !matchesStoredReference) {
        return res.status(400).json({
          success: false,
          message: "Payment checkout session does not belong to this booking.",
        });
      }

      isPaid = isPayMongoCheckoutPaid(checkoutSession);
      const normalizedSessionCheckoutId = sessionCheckoutId || checkoutId;
      const alreadyVerifiedCheckout = hasVerifiedCheckoutId(booking, normalizedSessionCheckoutId);

      booking.paymentMethod = "PayMongo";
      booking.paymongoCheckoutId = normalizedSessionCheckoutId || booking.paymongoCheckoutId;
      booking.paymongoReference = sessionReferenceNumber || booking.paymongoReference;
      booking.paymentIntentId = getPayMongoPaymentIntentId(checkoutSession) || booking.paymentIntentId;
      booking.paymentUpdatedAt = new Date();

      if (isPaid && !alreadyVerifiedCheckout) {
        const configuredCheckoutAmount = roundCurrency(Number(booking.paymentCheckoutAmount || 0));
        const metadataPaymentAmount = roundCurrency(Number(sessionMetadata?.paymentAmount || 0));
        const fallbackCheckoutAmount =
          String(booking.paymentStatus || "").toLowerCase() === "partial"
            ? getBookingRemainingAmount(booking)
            : getBookingPayableAmount(booking);
        const candidateAmounts = [configuredCheckoutAmount, metadataPaymentAmount, fallbackCheckoutAmount].filter(
          (amount) => Number.isFinite(amount) && amount > 0
        );
        const sessionAmount = roundCurrency(Number(sessionAmountInCentavos) / 100);
        let resolvedCheckoutAmount = candidateAmounts.find(
          (amount) => Math.abs(amount - sessionAmount) <= PAYMENT_AMOUNT_EPSILON
        );
        if (!resolvedCheckoutAmount && metadataMatchesExpected) {
          resolvedCheckoutAmount = sessionAmount;
        }

        if (
          !Number.isFinite(sessionAmountInCentavos) ||
          sessionAmountInCentavos <= 0 ||
          !Number.isFinite(sessionAmount) ||
          sessionAmount <= 0 ||
          !resolvedCheckoutAmount
        ) {
          return res.status(400).json({
            success: false,
            message: "Payment amount does not match this booking.",
          });
        }

        const totalPayable = getBookingPayableAmount(booking);
        const paidBefore = getBookingPaidAmount(booking);
        const remainingBefore = roundCurrency(Math.max(totalPayable - paidBefore, 0));
        if (sessionAmount > roundCurrency(remainingBefore + PAYMENT_AMOUNT_EPSILON)) {
          return res.status(409).json({
            success: false,
            message: "This payment has already been applied or exceeds the remaining balance.",
          });
        }

        const paidAfter = Math.min(totalPayable, roundCurrency(paidBefore + resolvedCheckoutAmount));
        const remainingAfter = roundCurrency(Math.max(totalPayable - paidAfter, 0));

        booking.paymentAmountPaid = paidAfter;
        booking.paymentAmountDue = remainingAfter;
        booking.paymentCheckoutAmount = 0;

        if (remainingAfter <= 0) {
          booking.paymentStatus = "paid";
          booking.paidAt = booking.paidAt || new Date();
        } else {
          booking.paymentStatus = "partial";
          booking.paidAt = null;
        }
        resetWalkInPaymentState(booking);
        appendVerifiedCheckoutId(booking, normalizedSessionCheckoutId);
        verificationApplied = true;
      }

      await booking.save();
    }

    const refreshed = await Booking.findById(booking._id).populate(bookingPopulate);
    const payload = serializeBooking(req, refreshed);
    const { ownerId, renterId } = getBookingParties(refreshed);

    if (verificationApplied) {
      eventBus.emit(NOTIFICATION_EVENTS.PAYMENT_RECEIVED, {
        booking: refreshed,
        actor: req.user,
        ownerId,
        renterId,
        paymentStatus: payload.paymentStatus,
      });
    }

    emitToUser(ownerId, "booking:updated", payload);
    emitToUser(renterId, "booking:updated", payload);

    let message = "Payment is not completed yet.";

    if (payload.paymentStatus === "paid") {
      message = wasPaid ? "Payment already verified." : "Payment verified successfully.";
    } else if (payload.paymentStatus === "partial") {
      const remaining = Number(payload.paymentAmountDue || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      message = `Downpayment verified successfully. Remaining balance: \u20b1${remaining}.`;
    }

    return res.json({
      success: true,
      paid: payload.paymentStatus === "paid",
      paymentCaptured: isPaid,
      checkoutStatus,
      paymentStatus: payload.paymentStatus,
      checkoutId: payload.paymongoCheckoutId,
      referenceNumber: payload.paymongoReference,
      booking: payload,
      message,
    });
  } catch (error) {
    if (error?.isPayMongoError) {
      logPayMongoError("Payment verification failed", error);
      const statusCode = error?.statusCode >= 400 && error?.statusCode < 600 ? error.statusCode : 502;
      return res.status(statusCode).json({
        success: false,
        message: "We could not verify the payment right now. Please try again later.",
      });
    }
    console.error("[Booking Payment] Payment verification failed", error);
    return res.status(500).json({ success: false, message: "Failed to verify booking payment." });
  }
};

export const addBookingReview = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const numericRating = Number(rating);

    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ success: false, message: "Choose a whole-star rating from 1 to 5." });
    }
    if (comment != null && typeof comment !== "string") {
      return res.status(400).json({ success: false, message: "Review text must be a message." });
    }
    const reviewComment = String(comment || "").trim();
    if (comment && !reviewComment) {
      return res.status(400).json({ success: false, message: "Write a review or leave this field blank." });
    }
    if (reviewComment.length > 1200) {
      return res.status(400).json({ success: false, message: "Keep your review to 1,200 characters or fewer." });
    }
    if (reviewComment && (
      /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}\u20E3]|\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(reviewComment) ||
      !/^[\p{L}\p{Nd}][\p{L}\p{M}\p{Nd}]*(?: [\p{L}\p{Nd}][\p{L}\p{M}\p{Nd}]*)*$/u.test(reviewComment)
    )) {
      return res.status(400).json({ success: false, message: "Use letters, numbers, and single spaces only." });
    }

    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.id, renter: req.user._id, status: "completed", reviewRating: null },
      { $set: { reviewRating: numericRating, reviewComment, reviewCreatedAt: new Date() } },
      { new: true, runValidators: true }
    );
    if (!booking) {
      const current = await Booking.findOne({ _id: req.params.id, renter: req.user._id });
      if (!current) return res.status(404).json({ success: false, message: "Booking not found." });
      if (current.status !== "completed") {
        return res.status(400).json({ success: false, message: "Only completed bookings can be reviewed." });
      }
      return res.status(409).json({ success: false, message: "You already reviewed this rental." });
    }

    eventBus.emit(NOTIFICATION_EVENTS.REVIEW_CREATED, {
      booking,
      actor: req.user,
      rating: booking.reviewRating,
    });

    const populated = await Booking.findById(booking._id).populate(bookingPopulate);
    res.json({ success: true, booking: serializeBooking(req, populated) });
  } catch {
    res.status(500).json({ success: false, message: "Failed to submit review." });
  }
};
