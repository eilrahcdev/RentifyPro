import {
  getBookingDriverHourlyRate,
  getBookingVehicleHourlyRate,
  getDurationMinutes,
  roundCurrency,
} from "./pricing.js";

export const LATE_RETURN_FEE_TYPES = Object.freeze({
  PERCENTAGE: "percentage",
  FIXED_HOURLY: "fixed_hourly",
});

export const DEFAULT_LATE_RETURN_PERCENTAGE = 0;
export const DEFAULT_LATE_RETURN_GRACE_MINUTES = 0;
export const MAX_LATE_RETURN_PERCENTAGE = 100;
export const MAX_LATE_RETURN_FIXED_HOURLY = 100000;
export const MAX_LATE_RETURN_GRACE_MINUTES = 1440;
export const BOOKING_POLICY_VERSION = 2;

const validFeeTypes = new Set(Object.values(LATE_RETURN_FEE_TYPES));

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const configuredDefaultGraceMinutes = () => {
  const minutes = finiteNumber(process.env.BOOKING_OVERDUE_GRACE_MINUTES);
  if (minutes === null || minutes < 0) return DEFAULT_LATE_RETURN_GRACE_MINUTES;
  return Math.min(Math.floor(minutes), MAX_LATE_RETURN_GRACE_MINUTES);
};

export const normalizeLateReturnFeeType = (value, fallback = LATE_RETURN_FEE_TYPES.PERCENTAGE) => {
  const normalized = String(value || "").trim().toLowerCase();
  return validFeeTypes.has(normalized) ? normalized : fallback;
};

export const getVehicleLateReturnPolicy = (vehicle = {}) => {
  const feeType = normalizeLateReturnFeeType(vehicle?.lateReturnFeeType);
  const configuredValue = finiteNumber(vehicle?.lateReturnFeeValue);
  const value = configuredValue !== null && configuredValue >= 0 ? roundCurrency(configuredValue) : 0;
  const configuredGrace = finiteNumber(vehicle?.lateReturnGraceMinutes);
  const graceMinutes =
    configuredGrace !== null && configuredGrace >= 0
      ? Math.min(Math.floor(configuredGrace), MAX_LATE_RETURN_GRACE_MINUTES)
      : configuredDefaultGraceMinutes();

  return { feeType, value, graceMinutes };
};

export const calculateLateReturnPenaltyRatePerHour = ({
  feeType,
  value,
  vehicleHourlyRate = 0,
  driverHourlyRate = 0,
  driverSelected = false,
} = {}) => {
  const normalizedType = normalizeLateReturnFeeType(feeType);
  const normalizedValue = Math.max(0, finiteNumber(value) ?? 0);
  if (normalizedType === LATE_RETURN_FEE_TYPES.FIXED_HOURLY) {
    return roundCurrency(normalizedValue);
  }

  const baseHourlyRate =
    Math.max(0, Number(vehicleHourlyRate || 0)) +
    (driverSelected ? Math.max(0, Number(driverHourlyRate || 0)) : 0);
  return roundCurrency(baseHourlyRate * (normalizedValue / 100));
};

export const createBookingLateReturnPolicySnapshot = ({
  vehicle = {},
  vehicleHourlyRate = 0,
  driverHourlyRate = 0,
  driverSelected = false,
} = {}) => {
  const policy = getVehicleLateReturnPolicy(vehicle);
  return {
    lateReturnFeeType: policy.feeType,
    lateReturnFeeValue: policy.value,
    lateReturnGraceMinutes: policy.graceMinutes,
    lateReturnPenaltyRatePerHour: calculateLateReturnPenaltyRatePerHour({
      feeType: policy.feeType,
      value: policy.value,
      vehicleHourlyRate,
      driverHourlyRate,
      driverSelected,
    }),
  };
};

export const getBookingLateReturnPolicy = (booking = {}) => {
  const hasSnapshot =
    validFeeTypes.has(String(booking?.lateReturnFeeType || "").trim().toLowerCase()) &&
    finiteNumber(booking?.lateReturnFeeValue) !== null;
  const feeType = hasSnapshot
    ? normalizeLateReturnFeeType(booking.lateReturnFeeType)
    : LATE_RETURN_FEE_TYPES.PERCENTAGE;
  const value = hasSnapshot
    ? Math.max(0, roundCurrency(booking.lateReturnFeeValue))
    : DEFAULT_LATE_RETURN_PERCENTAGE;
  const snapshottedGrace = finiteNumber(booking?.lateReturnGraceMinutes);
  const graceMinutes =
    snapshottedGrace !== null && snapshottedGrace >= 0
      ? Math.min(Math.floor(snapshottedGrace), MAX_LATE_RETURN_GRACE_MINUTES)
      : configuredDefaultGraceMinutes();

  return { feeType, value, graceMinutes, isSnapshot: hasSnapshot };
};

export const getBookingLateReturnPenaltyRatePerHour = (booking = {}) => {
  const persistedRate = finiteNumber(booking?.lateReturnPenaltyRatePerHour);
  const policy = getBookingLateReturnPolicy(booking);
  if (policy.isSnapshot && persistedRate !== null && persistedRate >= 0) {
    return roundCurrency(persistedRate);
  }
  if (!policy.isSnapshot && persistedRate !== null && persistedRate > 0) {
    return roundCurrency(persistedRate);
  }

  return calculateLateReturnPenaltyRatePerHour({
    feeType: policy.feeType,
    value: policy.value,
    vehicleHourlyRate: getBookingVehicleHourlyRate(booking),
    driverHourlyRate: getBookingDriverHourlyRate(booking),
    driverSelected: Boolean(booking?.driverSelected),
  });
};

export const getEstimatedLateReturnPenaltyFee = (booking = {}) => {
  const finalFee = finiteNumber(booking?.lateReturnPenaltyFee);
  if (finalFee !== null && finalFee > 0) return roundCurrency(finalFee);
  if (["cancelled", "rejected"].includes(String(booking?.status || "").trim().toLowerCase())) return 0;
  if (usesSeparatedExtensionBilling(booking)) {
    return calculateBookingLateReturn(booking).estimatedPenaltyFee;
  }
  if (!booking?.lateReturnIsOverdue) return 0;

  const overdueMinutes = Math.max(0, Math.round(finiteNumber(booking?.lateReturnOverdueMinutes) ?? 0));
  const ratePerHour = getBookingLateReturnPenaltyRatePerHour(booking);
  return roundCurrency(ratePerHour * (overdueMinutes / 60));
};

const policyDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const parseBookingHandoverTime = (value) => {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part || 0));
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (year < 1 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  return policyDate(value);
};

export const usesSeparatedExtensionBilling = (booking) => Number(booking?.bookingPolicyVersion) === BOOKING_POLICY_VERSION;

export const calculateBookingLateReturn = (booking = {}, now = new Date()) => {
  if (["cancelled", "rejected"].includes(String(booking.status || "").trim().toLowerCase())) {
    return {
      isOverdue: false, accruedOverdueMinutes: 0, currentOverdueMinutes: 0,
      overdueMinutes: Math.max(0, Math.round(finiteNumber(booking.lateReturnOverdueMinutes) ?? 0)),
      estimatedPenaltyFee: roundCurrency(Math.max(0, finiteNumber(booking.lateReturnPenaltyFee) ?? 0)),
      asOf: policyDate(booking.actualReturnAt),
    };
  }
  const cutoff = policyDate(booking.actualReturnAt) || policyDate(now);
  const graceMs = getBookingLateReturnPolicy(booking).graceMinutes * 60_000;
  let deadline = policyDate(usesSeparatedExtensionBilling(booking) ? booking.originalReturnAt : booking.returnAt)
    || policyDate(booking.returnAt);
  let accruedOverdueMinutes = 0;
  const minutesAfter = (dueAt, end) => {
    if (!dueAt || !cutoff || !end) return 0;
    return getDurationMinutes(new Date(dueAt.getTime() + graceMs), new Date(Math.min(cutoff.getTime(), end.getTime())));
  };
  if (usesSeparatedExtensionBilling(booking)) {
    for (const extension of booking.extensionHistory || []) {
      if (extension.status !== "approved") continue;
      const start = policyDate(extension.billingStartAt);
      const end = policyDate(extension.requestedReturnAt);
      if (!start || !end || end <= start || !deadline || start < deadline) continue;
      accruedOverdueMinutes += minutesAfter(deadline, start);
      if (!cutoff || cutoff <= start) {
        return {
          isOverdue: accruedOverdueMinutes > 0, accruedOverdueMinutes: 0,
          currentOverdueMinutes: accruedOverdueMinutes, overdueMinutes: accruedOverdueMinutes,
          estimatedPenaltyFee: roundCurrency(getBookingLateReturnPenaltyRatePerHour(booking) * accruedOverdueMinutes / 60),
          asOf: cutoff,
        };
      }
      deadline = end;
    }
  }
  const currentOverdueMinutes = minutesAfter(deadline, cutoff);
  const overdueMinutes = accruedOverdueMinutes + currentOverdueMinutes;
  return {
    isOverdue: Boolean(deadline && cutoff && cutoff.getTime() > deadline.getTime() + graceMs), accruedOverdueMinutes, currentOverdueMinutes, overdueMinutes,
    estimatedPenaltyFee: roundCurrency(getBookingLateReturnPenaltyRatePerHour(booking) * overdueMinutes / 60),
    asOf: cutoff,
  };
};

export const quoteBookingExtension = (booking, requestedReturnAt, requestedAt = new Date()) => {
  const deadline = policyDate(booking.returnAt);
  const end = policyDate(requestedReturnAt);
  const request = policyDate(requestedAt);
  if (!deadline || !end || !request || end <= deadline || end <= request) return null;
  const billingStartAt = usesSeparatedExtensionBilling(booking)
    ? new Date(Math.max(deadline.getTime(), request.getTime())) : deadline;
  const durationMinutes = getDurationMinutes(billingStartAt, end);
  if (durationMinutes <= 0) return null;
  const baseAmount = roundCurrency(getBookingVehicleHourlyRate(booking) * durationMinutes / 60);
  const driverAmount = booking.driverSelected
    ? roundCurrency(getBookingDriverHourlyRate(booking) * durationMinutes / 60) : 0;
  return { billingStartAt, durationMinutes, baseAmount, driverAmount, totalAmount: roundCurrency(baseAmount + driverAmount) };
};

export const finishBookingExtensionRequest = (booking, status, now = new Date(), actor = null, note = "") => {
  const entry = [...(booking.extensionHistory || [])].reverse().find((item) =>
    item.status === "requested" && policyDate(item.requestedAt)?.getTime() === policyDate(booking.extensionRequestedAt)?.getTime());
  if (entry) Object.assign(entry, { status, reviewedAt: now, reviewedBy: actor, reviewNote: note });
  booking.extensionStatus = status;
  booking.extensionReviewedAt = now;
  booking.extensionReviewedBy = actor;
  booking.extensionReviewAction = ({ approved: "approve", rejected: "reject", withdrawn: "withdraw", expired: "expire" })[status];
  booking.extensionReviewNote = note;
  if (booking.lateReturnAction === "extend_requested") booking.lateReturnAction = "none";
};

export const expireBookingExtensionRequest = (booking, now = new Date()) => {
  const end = policyDate(booking.extensionRequestedReturnAt);
  if (booking.extensionStatus !== "requested" || !end || end > now) return false;
  finishBookingExtensionRequest(booking, "expired", now);
  return true;
};

export const updateBookingLateReturnState = (booking, now = new Date()) => {
  const summary = calculateBookingLateReturn(booking, now);
  let changed = false;
  const set = (field, value) => {
    if (booking[field] !== value) { booking[field] = value; changed = true; }
  };
  set("lateReturnIsOverdue", summary.isOverdue);
  set("lateReturnOverdueMinutes", summary.overdueMinutes);
  set("lateReturnPenaltyRatePerHour", getBookingLateReturnPenaltyRatePerHour(booking));
  if (summary.isOverdue && !booking.lateReturnDetectedAt) set("lateReturnDetectedAt", now);
  if (!summary.isOverdue && booking.lateReturnDetectedAt) set("lateReturnDetectedAt", null);
  const shouldNotify = summary.isOverdue && !booking.lateReturnNotifiedAt;
  if (shouldNotify) set("lateReturnNotifiedAt", now);
  return { changed, shouldNotify, ...summary };
};

export const serializeBookingPolicy = (booking) => ({
  version: Number(booking.bookingPolicyVersion || 1),
  originalReturnAt: booking.originalReturnAt || booking.returnAt,
  extensionHistory: (booking.extensionHistory || []).map((entry) => ({
    status: entry.status, requestedAt: entry.requestedAt, currentReturnAt: entry.currentReturnAt,
    requestedReturnAt: entry.requestedReturnAt, billingStartAt: entry.billingStartAt,
    durationMinutes: entry.durationMinutes, baseAmount: entry.baseAmount, driverAmount: entry.driverAmount,
    totalAmount: entry.totalAmount, reviewedAt: entry.reviewedAt, reviewNote: entry.reviewNote,
  })),
});
