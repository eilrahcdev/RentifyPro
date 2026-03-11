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

export const getDateTime = (date, time) => {
  if (!date || !time) return null;
  const value = new Date(`${date}T${time}`);
  return Number.isNaN(value.getTime()) ? null : value;
};

export const sanitizeBookingRange = (bookingData = {}) => {
  const today = getTodayDate();
  const nowTime = getCurrentTime();

  let pickupDate = bookingData.pickupDate || today;
  let pickupTime = bookingData.pickupTime || nowTime;
  let returnDate = bookingData.returnDate || pickupDate;
  let returnTime = bookingData.returnTime || pickupTime;

  if (pickupDate < today) pickupDate = today;
  if (pickupDate === today && pickupTime < nowTime) pickupTime = nowTime;

  let pickupDateTime = getDateTime(pickupDate, pickupTime);
  if (!pickupDateTime) {
    pickupDate = today;
    pickupTime = nowTime;
    pickupDateTime = getDateTime(pickupDate, pickupTime);
  }

  if (returnDate < pickupDate) returnDate = pickupDate;

  const returnDateTime = getDateTime(returnDate, returnTime);
  if (!returnDateTime || returnDateTime <= pickupDateTime) {
    const minimumReturn = new Date(pickupDateTime.getTime() + 60 * 60 * 1000);
    returnDate = formatDateInput(minimumReturn);
    returnTime = formatTimeInput(minimumReturn);
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
