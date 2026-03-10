import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";
import { createNotification } from "../utils/notification.js";
import { emitToUser } from "../socket/index.js";
import { syncVehicleAvailabilityByBookingState } from "../utils/vehicleAvailability.js";
import {
  applyLedgerRecordToBooking,
  getBookingLedgerConfig,
  getBookingLedgerEligibility,
  getSepoliaTxUrl,
  recordBookingTransactionOnChain as recordBookingTransactionOnLedger,
} from "../utils/blockchainBooking.js";

const STATUSES = new Set(["pending", "confirmed", "completed", "cancelled", "rejected"]);
const PAYMENT_STATUSES = new Set(["unpaid", "partial", "paid", "refunded"]);

const getImageUrl = (req, pathValue) => {
  if (!pathValue) return "";
  if (/^https?:\/\//i.test(pathValue)) return pathValue;
  return `${req.protocol}://${req.get("host")}/${String(pathValue).replace(/\\/g, "/")}`;
};

const getConfiguredBlockchainRecordingFee = () => {
  const configured = Number(process.env.BOOKING_BLOCKCHAIN_RECORDING_FEE || 0);
  if (!Number.isFinite(configured) || configured < 0) return 0;
  return Math.round(configured * 100) / 100;
};

const shouldUseConfiguredGasFeeFallback = (booking) => {
  const paymentStatus = String(booking?.paymentStatus || "").trim().toLowerCase();
  return paymentStatus === "unpaid" || paymentStatus === "partial";
};

const getOwnerBookingGasFee = (booking) => {
  const persisted = Number(booking?.blockchainGasFee);
  if (Number.isFinite(persisted) && persisted > 0) {
    return Math.round(persisted * 100) / 100;
  }
  if (shouldUseConfiguredGasFeeFallback(booking)) {
    return getConfiguredBlockchainRecordingFee();
  }
  return 0;
};

const getOwnerBookingPayableAmount = (booking) => {
  const bookingTotal = Number(booking?.totalAmount || 0);
  const total = Number.isFinite(bookingTotal) && bookingTotal > 0 ? bookingTotal : 0;
  return Math.round((total + getOwnerBookingGasFee(booking)) * 100) / 100;
};

const getOwnerBookingBlockchainStatus = (booking) => {
  const config = getBookingLedgerConfig();
  const configured = Boolean(config?.contractAddress && config?.rpcUrl && config?.deployerPrivateKey);
  const txHash = String(booking?.blockchainTxHash || "").trim();
  const eligibility = getBookingLedgerEligibility(booking);
  const blockers = [];

  if (!configured) blockers.push("chain_not_configured");

  let state = "pending";
  let reason = "awaiting_record";

  if (txHash) {
    state = "recorded";
    reason = null;
  } else if (eligibility.reason === "booking_cancelled") {
    state = "not_applicable";
    reason = "booking_cancelled";
  } else if (eligibility.reason === "payment_not_completed") {
    state = "not_ready";
    reason = "payment_not_completed";
  } else if (blockers.length > 0) {
    state = "blocked";
    reason = blockers[0];
  }

  return {
    state,
    reason,
    blockers,
    configured,
    version: config.selectedVersion || null,
    network: config.network || null,
    chainId: config.chainId || null,
    contractAddress: config.contractAddress || null,
  };
};

const serializeOwnerBooking = (req, booking) => {
  const vehicle = booking.vehicle || {};
  const rawImages = Array.isArray(vehicle.images) ? vehicle.images : [];
  const images = rawImages.map((pathValue) => getImageUrl(req, pathValue));

  return {
    _id: booking._id,
    pickupAt: booking.pickupAt,
    returnAt: booking.returnAt,
    bookingDays: booking.bookingDays,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    payment_status: booking.paymentStatus,
    paymentMethod: booking.paymentMethod || null,
    payment_method: booking.paymentMethod || null,
    paymongoReference: booking.paymongoReference || null,
    paymongo_reference: booking.paymongoReference || null,
    paymongoCheckoutId: booking.paymongoCheckoutId || null,
    paymentIntentId: booking.paymentIntentId || null,
    payment_intent_id: booking.paymentIntentId || null,
    paymentRequestedAt: booking.paymentRequestedAt || null,
    paymentUpdatedAt: booking.paymentUpdatedAt || null,
    paidAt: booking.paidAt || null,
    blockchainTxHash: booking.blockchainTxHash || null,
    blockchainRecordedAt: booking.blockchainRecordedAt || null,
    blockchainExplorerUrl: booking.blockchainTxHash ? getSepoliaTxUrl(booking.blockchainTxHash) : null,
    blockchain: booking.blockchain
      ? {
          network: booking.blockchain.network || null,
          chainId: booking.blockchain.chainId || null,
          contractAddress: booking.blockchain.contractAddress || null,
          version: booking.blockchain.version || null,
          bookingKey: booking.blockchain.bookingKey || null,
          bookingHash: booking.blockchain.bookingHash || null,
          renterIdHash: booking.blockchain.renterIdHash || null,
          ownerId: booking.blockchain.ownerId || null,
          amountInCents:
            Number.isFinite(Number(booking.blockchain.amountInCents)) ? booking.blockchain.amountInCents : null,
          paymentStatus: booking.blockchain.paymentStatus || null,
          paymentStatusCode:
            Number.isFinite(Number(booking.blockchain.paymentStatusCode))
              ? booking.blockchain.paymentStatusCode
              : null,
          blockNumber:
            Number.isFinite(Number(booking.blockchain.blockNumber)) ? booking.blockchain.blockNumber : null,
        }
      : null,
    blockchainStatus: getOwnerBookingBlockchainStatus(booking),
    vehicleDailyRate: booking.vehicleDailyRate,
    driverSelected: booking.driverSelected,
    driverDailyRate: booking.driverDailyRate,
    baseAmount: booking.baseAmount,
    driverAmount: booking.driverAmount,
    totalAmount: booking.totalAmount,
    blockchainGasFee: getOwnerBookingGasFee(booking),
    amountPayable: getOwnerBookingPayableAmount(booking),
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    renter: booking.renter || null,
    owner: booking.owner || null,
    vehicle: booking.vehicle
      ? {
          _id: vehicle._id,
          name: vehicle.name,
          location: vehicle.location,
          specs: vehicle.specs || {},
          imageUrl: images[0] || getImageUrl(req, vehicle.imageUrl),
          images,
        }
      : null,
  };
};

const populateFields = [
  { path: "renter", select: "name email avatar" },
  { path: "owner", select: "name email avatar" },
  {
    path: "vehicle",
    select:
      "name location specs images imageUrl dailyRentalRate driverOptionEnabled driverDailyRate",
  },
];

const autoRecordOwnerBookingOnChain = async (booking) => {
  if (!booking || booking.blockchainTxHash) {
    return {
      recorded: Boolean(booking?.blockchainTxHash),
      warning: null,
    };
  }

  const eligibility = getBookingLedgerEligibility(booking);
  if (!eligibility.eligible) {
    return {
      recorded: false,
      warning: null,
    };
  }

  try {
    const ledgerRecord = await recordBookingTransactionOnLedger({ booking });
    applyLedgerRecordToBooking(booking, ledgerRecord);
    await booking.save();
    return {
      recorded: true,
      warning: null,
    };
  } catch (error) {
    return {
      recorded: false,
      warning: String(error?.message || "Failed to record booking on blockchain."),
    };
  }
};

export const getOwnerBookings = async (req, res) => {
  try {
    const status = req.query.status || "all";
    const query = { owner: req.user._id };
    if (status === "cancelled") {
      query.status = { $in: ["cancelled", "rejected"] };
    } else if (status !== "all" && STATUSES.has(status)) {
      query.status = status;
    }

    const bookings = await Booking.find(query).populate(populateFields).sort({ createdAt: -1 });
    res.json({ success: true, bookings: bookings.map((booking) => serializeOwnerBooking(req, booking)) });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch owner bookings." });
  }
};

export const updateOwnerBookingStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const booking = await Booking.findOne({ _id: req.params.id, owner: req.user._id }).populate(populateFields);

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    if (status === "confirmed") {
      const vehicleId = booking.vehicle?._id || booking.vehicle;
      const conflictingBooking = await Booking.findOne({
        _id: { $ne: booking._id },
        vehicle: vehicleId,
        status: { $in: ["pending", "confirmed"] },
        pickupAt: { $lt: booking.returnAt },
        returnAt: { $gt: booking.pickupAt },
      }).select("_id");

      if (conflictingBooking) {
        return res.status(409).json({
          success: false,
          message: "Cannot confirm booking because the schedule conflicts with another active booking.",
        });
      }
    }

    booking.status = status;
    await booking.save();
    await syncVehicleAvailabilityByBookingState(booking.vehicle?._id || booking.vehicle);

    await createNotification({
      user: booking.renter._id,
      type: "booking_status",
      title: "Booking status updated",
      message: `Your booking is now ${status}.`,
      data: { bookingId: booking._id, status },
    });

    const payload = serializeOwnerBooking(req, booking);
    emitToUser(String(booking.renter._id), "booking:updated", payload);
    emitToUser(String(booking.owner._id), "booking:updated", payload);

    res.json({ success: true, booking: payload });
  } catch {
    res.status(500).json({ success: false, message: "Failed to update booking status." });
  }
};

export const updateOwnerBookingPaymentStatus = async (req, res) => {
  try {
    const { paymentStatus } = req.body;
    if (!PAYMENT_STATUSES.has(paymentStatus)) {
      return res.status(400).json({ success: false, message: "Invalid payment status." });
    }

    if (paymentStatus === "paid") {
      return res.status(403).json({
        success: false,
        message: "Manual 'paid' updates are blocked. Payment must be verified server-side via PayMongo.",
      });
    }

    const booking = await Booking.findOne({ _id: req.params.id, owner: req.user._id }).populate(populateFields);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    booking.paymentStatus = paymentStatus;
    booking.paymentUpdatedAt = new Date();
    if (paymentStatus === "paid") {
      booking.paidAt = booking.paidAt || new Date();
    }
    await booking.save();
    const blockchainResult = await autoRecordOwnerBookingOnChain(booking);

    await createNotification({
      user: booking.renter._id,
      type: "booking_payment",
      title: "Payment status updated",
      message: `Payment status is now ${paymentStatus}.`,
      data: { bookingId: booking._id, paymentStatus },
    });

    const payload = serializeOwnerBooking(req, booking);
    emitToUser(String(booking.renter._id), "booking:updated", payload);
    emitToUser(String(booking.owner._id), "booking:updated", payload);

    const message = blockchainResult?.warning
      ? `Payment status updated. Blockchain recording is pending: ${blockchainResult.warning}`
      : "Payment status updated.";

    res.json({
      success: true,
      message,
      blockchainWarning: blockchainResult?.warning || null,
      booking: payload,
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to update payment status." });
  }
};

export const getOwnerReviews = async (req, res) => {
  try {
    const reviews = await Booking.find({
      owner: req.user._id,
      reviewRating: { $exists: true },
      reviewCreatedAt: { $exists: true },
    })
      .populate("renter", "name email avatar")
      .populate("vehicle", "name")
      .sort({ reviewCreatedAt: -1 })
      .lean();

    res.json({
      success: true,
      reviews: reviews.map((review) => ({
        _id: review._id,
        rating: review.reviewRating,
        comment: review.reviewComment || "",
        createdAt: review.reviewCreatedAt,
        renter: review.renter || null,
        vehicle: review.vehicle || null,
      })),
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch reviews." });
  }
};

export const getOwnerEarnings = async (req, res) => {
  try {
    const completedBookings = await Booking.find({
      owner: req.user._id,
      status: "completed",
    })
      .populate("vehicle", "name")
      .populate("renter", "name email")
      .sort({ createdAt: -1 })
      .lean();

    const bookings = completedBookings.map((booking) => ({
      _id: booking._id,
      vehicle: booking.vehicle || null,
      renter: booking.renter || null,
      bookingDays: booking.bookingDays,
      vehicleDailyRate: booking.vehicleDailyRate,
      driverSelected: booking.driverSelected,
      driverDailyRate: booking.driverDailyRate,
      baseAmount: booking.baseAmount,
      driverAmount: booking.driverAmount,
      totalAmount: booking.totalAmount,
      blockchainGasFee: getOwnerBookingGasFee(booking),
      amountPayable: getOwnerBookingPayableAmount(booking),
      paymentStatus: booking.paymentStatus,
      completedAt: booking.updatedAt,
    }));

    const totals = bookings.reduce(
      (acc, booking) => {
        acc.totalEarnings += booking.amountPayable || 0;
        acc.vehicleIncome += booking.baseAmount || 0;
        acc.driverIncome += booking.driverAmount || 0;
        return acc;
      },
      { totalEarnings: 0, vehicleIncome: 0, driverIncome: 0 }
    );

    const monthlyEarnings = await Booking.aggregate([
      { $match: { owner: req.user._id, status: "completed" } },
      {
        $group: {
          _id: {
            year: { $year: "$updatedAt" },
            month: { $month: "$updatedAt" },
          },
          totalEarnings: {
            $sum: {
              $add: [
                { $ifNull: ["$totalAmount", 0] },
                { $ifNull: ["$blockchainGasFee", 0] },
              ],
            },
          },
          vehicleIncome: { $sum: "$baseAmount" },
          driverIncome: { $sum: "$driverAmount" },
          bookings: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": -1, "_id.month": -1 } },
      { $limit: 12 },
    ]);

    res.json({
      success: true,
      totals,
      monthlyEarnings,
      bookings,
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch earnings." });
  }
};

export const getOwnerAnalytics = async (req, res) => {
  try {
    const ownerId = req.user._id;

    const monthlyEarningsTrend = await Booking.aggregate([
      { $match: { owner: ownerId, status: "completed" } },
      {
        $group: {
          _id: {
            year: { $year: "$updatedAt" },
            month: { $month: "$updatedAt" },
          },
          totalEarnings: {
            $sum: {
              $add: [
                { $ifNull: ["$totalAmount", 0] },
                { $ifNull: ["$blockchainGasFee", 0] },
              ],
            },
          },
          driverIncome: { $sum: "$driverAmount" },
          vehicleIncome: { $sum: "$baseAmount" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    const bookingTrend = await Booking.aggregate([
      { $match: { owner: ownerId } },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          totalBookings: { $sum: 1 },
          pending: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          confirmed: {
            $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] },
          },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          cancelled: {
            $sum: {
              $cond: [{ $in: ["$status", ["cancelled", "rejected"]] }, 1, 0],
            },
          },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    const mostBookedVehicles = await Booking.aggregate([
      { $match: { owner: ownerId } },
      {
        $group: {
          _id: "$vehicle",
          bookings: { $sum: 1 },
          revenue: {
            $sum: {
              $add: [
                { $ifNull: ["$totalAmount", 0] },
                { $ifNull: ["$blockchainGasFee", 0] },
              ],
            },
          },
          completedBookings: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
        },
      },
      { $sort: { bookings: -1, revenue: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: Vehicle.collection.name,
          localField: "_id",
          foreignField: "_id",
          as: "vehicle",
        },
      },
      { $unwind: { path: "$vehicle", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          vehicleId: "$_id",
          vehicleName: "$vehicle.name",
          bookings: 1,
          revenue: 1,
          completedBookings: 1,
        },
      },
    ]);

    res.json({
      success: true,
      monthlyEarningsTrend,
      bookingTrend,
      mostBookedVehicles,
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch analytics." });
  }
};
