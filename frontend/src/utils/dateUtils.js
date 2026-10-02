const pad = (value) => String(value).padStart(2, "0");

export const formatDateInput = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const formatTimeInput = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const getTodayDate = () => formatDateInput(new Date());

export const getMaxBookingDate = (today = new Date()) => {
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 7, 0).getDate();
  return formatDateInput(new Date(today.getFullYear(), today.getMonth() + 6, Math.min(today.getDate(), lastDay)));
};

export const getTomorrowDate = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return formatDateInput(tomorrow);
};

export const getCurrentTime = () => formatTimeInput(new Date());

export const getMinPickupDateTime = (minutes = 10) => {
  const minDateTime = new Date();
  minDateTime.setSeconds(0, 0);
  minDateTime.setMinutes(minDateTime.getMinutes() + minutes);
  return minDateTime;
};

export const getMinPickupDate = (minutes = 10) => formatDateInput(getMinPickupDateTime(minutes));

export const getMinPickupTime = (minutes = 10) => formatTimeInput(getMinPickupDateTime(minutes));

export const getMinReturnDateTime = (pickupDate, pickupTime, minutes = 60) => {
  const pickup = getDateTime(pickupDate, pickupTime);
  if (!pickup) return null;
  const minReturn = new Date(pickup.getTime() + minutes * 60 * 1000);
  minReturn.setSeconds(0, 0);
  return minReturn;
};

export const getMinReturnDate = (pickupDate, pickupTime, minutes = 60) => {
  const minReturn = getMinReturnDateTime(pickupDate, pickupTime, minutes);
  return minReturn ? formatDateInput(minReturn) : "";
};

export const getMinReturnTime = (pickupDate, pickupTime, minutes = 60) => {
  const minReturn = getMinReturnDateTime(pickupDate, pickupTime, minutes);
  return minReturn ? formatTimeInput(minReturn) : "";
};
export const getDateTime = (date, time) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) return null;
  const value = new Date(`${date}T${time}`);
  if (Number.isNaN(value.getTime())) return null;
  // Date parsing can roll February 30 into March or 24:00 into tomorrow.
  if (formatDateInput(value) !== date || formatTimeInput(value) !== time.slice(0, 5)) return null;
  return value;
};

export const getDurationMinutesBetween = (start, end) => {
  if (start === null || start === undefined || end === null || end === undefined) return 0;
  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  const diffMs = endDate.getTime() - startDate.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 0;
  return Math.round(diffMs / (1000 * 60));
};

export const getBookingDurationMinutes = (pickupDate, pickupTime, returnDate, returnTime) => {
  const pickup = getDateTime(pickupDate, pickupTime);
  const dropoff = getDateTime(returnDate, returnTime);
  if (!pickup || !dropoff) return 0;
  return getDurationMinutesBetween(pickup, dropoff);
};

export const getDurationHoursFromMinutes = (minutes) => {
  const numeric = Number(minutes || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round((numeric / 60) * 10000) / 10000;
};

export const formatDurationMinutes = (minutes) => {
  const totalMinutes = Number(minutes || 0);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0m";
  const safeMinutes = Math.round(totalMinutes);
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;
  if (hours <= 0) return `${remainingMinutes}m`;
  if (remainingMinutes <= 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
};

export const sanitizeBookingRange = (bookingData = {}) => {
  const minPickupDateTime = getMinPickupDateTime();
  const minPickupDate = formatDateInput(minPickupDateTime);
  const minPickupTime = formatTimeInput(minPickupDateTime);

  let pickupDate = bookingData.pickupDate || minPickupDate;
  let pickupTime = bookingData.pickupTime || minPickupTime;
  let returnDate = bookingData.returnDate || pickupDate;
  let returnTime = bookingData.returnTime || pickupTime;

  if (pickupDate < minPickupDate) pickupDate = minPickupDate;
  if (pickupDate === minPickupDate && pickupTime < minPickupTime) pickupTime = minPickupTime;

  let pickupDateTime = getDateTime(pickupDate, pickupTime);
  if (!pickupDateTime) {
    pickupDate = minPickupDate;
    pickupTime = minPickupTime;
    pickupDateTime = getDateTime(pickupDate, pickupTime);
  }

  if (returnDate < pickupDate) returnDate = pickupDate;

  const minReturnDateTime = getMinReturnDateTime(pickupDate, pickupTime);
  if (minReturnDateTime) {
    const minReturnDate = formatDateInput(minReturnDateTime);
    const minReturnTime = formatTimeInput(minReturnDateTime);

    if (returnDate < minReturnDate) returnDate = minReturnDate;
    if (returnDate === minReturnDate && returnTime < minReturnTime) returnTime = minReturnTime;

    const returnDateTime = getDateTime(returnDate, returnTime);
    if (!returnDateTime || returnDateTime < minReturnDateTime) {
      returnDate = minReturnDate;
      returnTime = minReturnTime;
    }
  }

  return {
    pickupDate,
    pickupTime,
    returnDate,
    returnTime,
  };
};

export const formatDisplayName = (name = "", fallback = "") => {
  const raw = String(name || "").trim();
  if (!raw) return fallback;

  const normalized = raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || fallback;
};

export const getInitialsFromName = (name = "") => {
  const parts = formatDisplayName(name)
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "O";
  const first = parts[0][0] || "";
  const second = parts[1]?.[0] || parts[0][1] || "";
  return `${first}${second}`.toUpperCase() || "O";
};
