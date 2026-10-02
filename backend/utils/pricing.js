const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;

export const HOURLY_RATE_UNIT = "hourly";
export const DAILY_RATE_UNIT = "daily";

const VALID_RATE_UNITS = new Set([HOURLY_RATE_UNIT, DAILY_RATE_UNIT]);

export const roundCurrency = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
};

export const normalizeRateUnit = (value, fallback = DAILY_RATE_UNIT) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (VALID_RATE_UNITS.has(normalized)) return normalized;
  return fallback;
};

export const convertRateToHourly = (value, unit = DAILY_RATE_UNIT) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  const normalizedUnit = normalizeRateUnit(unit, DAILY_RATE_UNIT);
  if (normalizedUnit === HOURLY_RATE_UNIT) return numeric;
  return numeric / HOURS_PER_DAY;
};

export const getVehicleHourlyRate = (
  source = {},
  { rateField = "dailyRentalRate", unitField = "pricingUnit", fallbackUnit = DAILY_RATE_UNIT } = {}
) => {
  const rate = Number(source?.[rateField]);
  const unit = normalizeRateUnit(source?.[unitField], fallbackUnit);
  return roundCurrency(convertRateToHourly(rate, unit));
};

const toDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

export const getDurationMinutes = (pickupAt, returnAt) => {
  const pickup = toDate(pickupAt);
  const dropoff = toDate(returnAt);
  if (!pickup || !dropoff) return 0;
  const diffMs = dropoff.getTime() - pickup.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 0;
  return Math.round(diffMs / (1000 * 60));
};

export const getDurationHoursFromMinutes = (minutes) => {
  const numeric = Number(minutes || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round((numeric / MINUTES_PER_HOUR) * 10000) / 10000;
};

export const getDurationHours = (pickupAt, returnAt) =>
  getDurationHoursFromMinutes(getDurationMinutes(pickupAt, returnAt));

export const getLegacyBookingDays = (durationMinutes) => {
  const numeric = Number(durationMinutes || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return Math.max(1, Math.ceil(numeric / MINUTES_PER_DAY));
};

export const getBookingDurationMinutes = (booking = {}) => {
  const directMinutes = Number(booking?.bookingDurationMinutes);
  if (Number.isFinite(directMinutes) && directMinutes > 0) return Math.round(directMinutes);

  const fromDateRange = getDurationMinutes(booking?.pickupAt, booking?.returnAt);
  if (fromDateRange > 0) return fromDateRange;

  const directHours = Number(booking?.bookingDurationHours);
  if (Number.isFinite(directHours) && directHours > 0) {
    return Math.round(directHours * MINUTES_PER_HOUR);
  }

  const bookingDays = Number(booking?.bookingDays);
  if (Number.isFinite(bookingDays) && bookingDays > 0) {
    return Math.round(bookingDays * MINUTES_PER_DAY);
  }

  return 0;
};

export const getBookingDurationHours = (booking = {}) =>
  getDurationHoursFromMinutes(getBookingDurationMinutes(booking));

const getBookingRateUnit = (booking = {}) => {
  const explicitRateUnit = booking?.rentalRateUnit ?? booking?.rateUnit;
  return normalizeRateUnit(explicitRateUnit, DAILY_RATE_UNIT);
};

export const getBookingVehicleHourlyRate = (booking = {}) =>
  roundCurrency(convertRateToHourly(Number(booking?.vehicleDailyRate || 0), getBookingRateUnit(booking)));

export const getBookingDriverHourlyRate = (booking = {}) =>
  roundCurrency(convertRateToHourly(Number(booking?.driverDailyRate || 0), getBookingRateUnit(booking)));

