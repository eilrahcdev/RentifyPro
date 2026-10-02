import {
  getBookingDriverHourlyRate,
  getBookingVehicleHourlyRate,
  roundCurrency,
} from "./pricing.js";

export const LATE_RETURN_FEE_TYPES = Object.freeze({
  PERCENTAGE: "percentage",
  FIXED_HOURLY: "fixed_hourly",
});

export const DEFAULT_LATE_RETURN_PERCENTAGE = 25;
export const DEFAULT_LATE_RETURN_GRACE_MINUTES = 0;
export const MAX_LATE_RETURN_PERCENTAGE = 100;
export const MAX_LATE_RETURN_FIXED_HOURLY = 100000;
export const MAX_LATE_RETURN_GRACE_MINUTES = 1440;

const validFeeTypes = new Set(Object.values(LATE_RETURN_FEE_TYPES));

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const configuredDefaultPercentage = () => {
  const multiplier = finiteNumber(process.env.LATE_RETURN_PENALTY_MULTIPLIER);
  if (multiplier === null || multiplier < 0) return DEFAULT_LATE_RETURN_PERCENTAGE;
  return roundCurrency(multiplier * 100);
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
  const defaultValue = feeType === LATE_RETURN_FEE_TYPES.PERCENTAGE ? configuredDefaultPercentage() : 0;
  const value = configuredValue !== null && configuredValue >= 0 ? roundCurrency(configuredValue) : defaultValue;
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
    : configuredDefaultPercentage();
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
  if (!booking?.lateReturnIsOverdue) return 0;

  const overdueMinutes = Math.max(0, Math.round(finiteNumber(booking?.lateReturnOverdueMinutes) ?? 0));
  const ratePerHour = getBookingLateReturnPenaltyRatePerHour(booking);
  return roundCurrency(ratePerHour * (overdueMinutes / 60));
};
