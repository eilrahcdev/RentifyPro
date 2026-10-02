import { getTransactionFee } from "./fees.js";
import { getBookingDurationHours, getBookingVehicleHourlyRate, getBookingDriverHourlyRate, roundCurrency } from "./pricing.js";

const shouldApplyConfiguredFeeFallback = (booking) => {
  const paymentStatus = String(booking?.paymentStatus || "unpaid").toLowerCase();
  return paymentStatus === "unpaid" || paymentStatus === "partial";
};

export const getBookingLatePenaltyFee = (booking) => {
  const persisted = Number(booking?.lateReturnPenaltyFee || 0);
  if (Number.isFinite(persisted) && persisted > 0) return roundCurrency(persisted);
  return 0;
};

const getBookingRentalAmountForPayment = (booking) => {
  const directTotal = Number(booking?.totalAmount);
  if (Number.isFinite(directTotal) && directTotal > 0) {
    return roundCurrency(directTotal + getBookingLatePenaltyFee(booking));
  }

  const baseAmount = Number(booking?.baseAmount);
  const driverAmount = Number(booking?.driverAmount);
  if (Number.isFinite(baseAmount) && Number.isFinite(driverAmount) && baseAmount + driverAmount > 0) {
    return roundCurrency(baseAmount + driverAmount + getBookingLatePenaltyFee(booking));
  }

  const durationHours = getBookingDurationHours(booking);
  const vehicleHourlyRate = getBookingVehicleHourlyRate(booking);
  if (Number.isFinite(vehicleHourlyRate) && vehicleHourlyRate > 0 && Number.isFinite(durationHours) && durationHours > 0) {
    const driverHourlyRate = getBookingDriverHourlyRate(booking);
    const driverSelected = Boolean(booking?.driverSelected);
    const driverAmountFromRate =
      driverSelected && Number.isFinite(driverHourlyRate) && driverHourlyRate > 0
        ? driverHourlyRate * durationHours
        : 0;
    return roundCurrency(vehicleHourlyRate * durationHours + driverAmountFromRate + getBookingLatePenaltyFee(booking));
  }

  return roundCurrency(getBookingLatePenaltyFee(booking));
};

export const getEffectiveTransactionFee = (booking) => {
  const configured = getTransactionFee();
  const persisted = Number(booking?.transactionFee);
  let effective = Number.isFinite(persisted) && persisted > 0 ? roundCurrency(persisted) : 0;

  // Preserve historical payment totals when older records do not have the
  // generic transactionFee field yet.
  if (effective <= 0) {
    const paid = Number(booking?.paymentAmountPaid || 0);
    const due = Number(booking?.paymentAmountDue || 0);
    const trackedTotal = paid + due;
    const inferred = trackedTotal - getBookingRentalAmountForPayment(booking);
    if (Number.isFinite(inferred) && inferred > 0) effective = roundCurrency(inferred);
  }

  if (!shouldApplyConfiguredFeeFallback(booking)) return effective;
  return roundCurrency(Math.max(effective, configured));
};

export const getBookingPayableAmount = (booking) => {
  const rentalAmount = getBookingRentalAmountForPayment(booking);
  const transactionFee = getEffectiveTransactionFee(booking);
  const safeRentalAmount = Number.isFinite(rentalAmount) && rentalAmount > 0 ? rentalAmount : 0;
  const safeTransactionFee = Number.isFinite(transactionFee) && transactionFee >= 0 ? transactionFee : 0;
  return roundCurrency(safeRentalAmount + safeTransactionFee);
};

export const getBookingPaidAmount = (booking) => {
  const totalPayable = getBookingPayableAmount(booking);
  const persistedPaid = Number(booking?.paymentAmountPaid || 0);
  if (Number.isFinite(persistedPaid) && persistedPaid > 0) {
    return Math.min(roundCurrency(persistedPaid), totalPayable);
  }
  if (String(booking?.paymentStatus || "").toLowerCase() === "paid") {
    return totalPayable;
  }
  return 0;
};

export const getBookingRemainingAmount = (booking) => {
  const totalPayable = getBookingPayableAmount(booking);
  const paidAmount = getBookingPaidAmount(booking);
  return roundCurrency(Math.max(totalPayable - paidAmount, 0));
};

