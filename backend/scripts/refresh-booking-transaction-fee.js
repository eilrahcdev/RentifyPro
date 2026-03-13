import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Booking from "../models/Booking.js";
import { getTransactionFee } from "../utils/fees.js";

dotenv.config();

const roundCurrency = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
};

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

  const vehicleDailyRate = Number(booking?.vehicleDailyRate);
  const bookingDays = Number(booking?.bookingDays || 1);
  if (Number.isFinite(vehicleDailyRate) && vehicleDailyRate > 0 && Number.isFinite(bookingDays) && bookingDays > 0) {
    const driverDailyRate = Number(booking?.driverDailyRate || 0);
    const driverSelected = Boolean(booking?.driverSelected);
    const driverAmountFromRate =
      driverSelected && Number.isFinite(driverDailyRate) && driverDailyRate > 0
        ? driverDailyRate * bookingDays
        : 0;
    return vehicleDailyRate * bookingDays + driverAmountFromRate;
  }

  return 0;
};

const shouldUpdateBooking = (booking, fee) => {
  const status = String(booking?.paymentStatus || "").toLowerCase();
  const persisted = Number(booking?.blockchainGasFee);
  if (!["unpaid", "partial"].includes(status)) return false;
  if (!Number.isFinite(persisted)) return false;
  return persisted > 0 && persisted < fee;
};

const updateBooking = async (booking, fee) => {
  const rentalTotal = getRentalTotal(booking);
  const totalPayable = roundCurrency(Math.max(rentalTotal, 0) + fee);
  const paidAmount = Number(booking?.paymentAmountPaid || 0);
  const safePaid = Number.isFinite(paidAmount) && paidAmount > 0 ? Math.min(paidAmount, totalPayable) : 0;
  const remaining = roundCurrency(Math.max(totalPayable - safePaid, 0));

  booking.blockchainGasFee = fee;
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
    blockchainGasFee: { $gt: 0, $lt: fee },
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
