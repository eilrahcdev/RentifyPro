import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Booking from "../models/Booking.js";
import { getTransactionFee } from "../utils/fees.js";
import {
  getBookingDriverHourlyRate,
  getBookingDurationHours,
  getBookingVehicleHourlyRate,
  roundCurrency,
} from "../utils/pricing.js";

dotenv.config();

const getRentalTotal = (booking) => {
  const directTotal = Number(booking?.totalAmount);
  if (Number.isFinite(directTotal) && directTotal >= 0) {
    return directTotal;
  }

  const baseAmount = Number(booking?.baseAmount);
  const driverAmount = Number(booking?.driverAmount);
  if (Number.isFinite(baseAmount) && Number.isFinite(driverAmount) && baseAmount + driverAmount > 0) {
    return baseAmount + driverAmount;
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
    return roundCurrency(vehicleHourlyRate * durationHours + driverAmountFromRate);
  }

  return 0;
};

const shouldUpdateBooking = (booking, fee) => {
  const status = String(booking?.paymentStatus || "").toLowerCase();
  const persisted = Number(booking?.transactionFee);
  if (!["unpaid", "partial"].includes(status)) return false;
  return !Number.isFinite(persisted) || persisted < fee;
};

const updateBooking = async (booking, fee) => {
  const rentalTotal = getRentalTotal(booking);
  const totalPayable = roundCurrency(Math.max(rentalTotal, 0) + fee);
  const paidAmount = Number(booking?.paymentAmountPaid || 0);
  const safePaid = Number.isFinite(paidAmount) && paidAmount > 0 ? Math.min(paidAmount, totalPayable) : 0;
  const remaining = roundCurrency(Math.max(totalPayable - safePaid, 0));

  booking.transactionFee = fee;
  booking.paymentAmountDue = remaining;
  await booking.save();
};

const main = async () => {
  await connectDB();

  const fee = getTransactionFee();
  if (!Number.isFinite(fee) || fee <= 0) {
    throw new Error("Configured transaction fee is missing or invalid.");
  }

  const candidates = await Booking.find({
    paymentStatus: { $in: ["unpaid", "partial"] },
    $or: [
      { transactionFee: { $exists: false } },
      { transactionFee: { $lt: fee } },
    ],
  });

  console.log(`Found ${candidates.length} booking(s) to refresh.`);

  let updated = 0;
  for (const booking of candidates) {
    if (!shouldUpdateBooking(booking, fee)) continue;
    await updateBooking(booking, fee);
    updated += 1;
  }

  console.log(`Updated ${updated} booking(s) with transaction fee ${fee}.`);
  await mongoose.connection.close();
};

main().catch(async (error) => {
  console.error("Failed to refresh booking fees:", error.message);
  try {
    await mongoose.connection.close();
  } catch {
    // ignore
  }
  process.exit(1);
});
