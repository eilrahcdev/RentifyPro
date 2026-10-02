// Six calendar months, including the whole final day. Clamp month-end dates.
export const getBookingHorizonEnd = (today = new Date()) => {
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 7, 0).getDate();
  return new Date(today.getFullYear(), today.getMonth() + 6, Math.min(today.getDate(), lastDay), 23, 59, 59, 999);
};

export const BOOKING_HORIZON_MESSAGE = "Pickup and return must be within 6 months from today.";
