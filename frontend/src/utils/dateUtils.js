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
  if (!date || !time) return null;
  const value = new Date(`${date}T${time}`);
  return Number.isNaN(value.getTime()) ? null : value;
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
    if (returnDate > minReturnDate && returnTime < minReturnTime) returnTime = minReturnTime;

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
