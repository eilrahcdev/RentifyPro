const money = (value) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;
export const formatHandoverInput = (value = new Date()) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export const getBookingLateReturnInfo = (booking, currentTimeMs = Date.now()) => {
  const late = booking?.lateReturn || booking?.late_return || {};
  const status = String(booking?.status || "").trim().toLowerCase();
  const cancelled = ["cancelled", "rejected"].includes(status);
  const isFinal = status === "completed" || late.action === "return_confirmed" ||
    (booking?.returnRequest || booking?.return_request)?.status === "confirmed";
  const rate = money(late.penaltyRatePerHour ?? booking?.lateReturnPenaltyRatePerHour);
  const grace = Math.max(0, Number(late.graceMinutes ?? booking?.lateReturnPolicy?.graceMinutes) || 0);
  const deadline = new Date(booking?.returnAt).getTime();
  const active = ["confirmed", "extended"].includes(status);
  const currentOverdueMinutes = !isFinal && active && Number.isFinite(deadline)
    ? Math.max(0, Math.round((currentTimeMs - deadline - grace * 60_000) / 60_000)) : 0;
  const accruedOverdueMinutes = cancelled ? 0 : Math.max(0, Number(late.accruedOverdueMinutes) || 0);
  const stored = Math.max(0, Number(late.overdueMinutes) || 0);
  const overdueMinutes = cancelled || isFinal ? stored : Number(booking?.bookingPolicy?.version) === 2
    ? accruedOverdueMinutes + currentOverdueMinutes : Math.max(stored, currentOverdueMinutes);
  const penaltyFee = money(late.penaltyFee ?? booking?.lateReturnPenaltyFee);
  return {
    isFinal, isOverdue: !cancelled && (isFinal ? Boolean(late.isOverdue) : active && currentOverdueMinutes > 0),
    accruedOverdueMinutes, currentOverdueMinutes, overdueMinutes, penaltyFee,
    penaltyRatePerHour: rate, estimatedPenaltyFee: cancelled || isFinal ? penaltyFee : money(rate * overdueMinutes / 60),
    action: String(late.action || "none").toLowerCase(),
  };
};

export const getBookingExtensionQuote = (booking, requestedReturnAt, currentTimeMs = Date.now()) => {
  const end = new Date(requestedReturnAt).getTime();
  const deadline = new Date(booking?.returnAt).getTime();
  if (!Number.isFinite(end) || !Number.isFinite(deadline) || end <= Math.max(deadline, currentTimeMs)) return null;
  const start = Number(booking?.bookingPolicy?.version) === 2 ? Math.max(deadline, currentTimeMs) : deadline;
  const durationMinutes = Math.round((end - start) / 60_000);
  const vehicleRate = Number(booking?.vehicleHourlyRate ?? booking?.vehicleDailyRate) || 0;
  const driverRate = booking?.driverSelected ? Number(booking?.driverHourlyRate ?? booking?.driverDailyRate) || 0 : 0;
  return {
    billingStartAt: new Date(start), durationMinutes,
    totalAmount: money(money(vehicleRate * durationMinutes / 60) + money(driverRate * durationMinutes / 60)),
  };
};
