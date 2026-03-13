import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";
import { createNotification } from "../utils/notification.js";
import { emitToUser } from "../socket/index.js";
import {
  createPayMongoCheckoutSession,
  getPayMongoCheckoutAmountInCentavos,
  getPayMongoCheckoutId,
  getPayMongoCheckoutMetadata,
  getPayMongoCheckoutReferenceNumber,
  getPayMongoCheckoutSession,
  getPayMongoCheckoutUrl,
  getPayMongoPaymentIntentId,
  isPayMongoCheckoutPaid,
} from "../utils/paymongo.js";
import { getTransactionFee } from "../utils/fees.js";
import { syncVehicleAvailabilityByBookingState } from "../utils/vehicleAvailability.js";
import {
  applyLedgerRecordToBooking,
  getBookingLedgerEligibility,
  getSepoliaTxUrl,
  recordBookingTransactionOnChain as recordBookingTransactionOnLedger,
} from "../utils/blockchainBooking.js";

const toDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const calculateDays = (pickupAt, returnAt) => {
  const ms = returnAt.getTime() - pickupAt.getTime();
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
};

const boolFromValue = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
};

const getImageUrl = (req, pathValue) => {
  if (!pathValue) return "";
  if (/^https?:\/\//i.test(pathValue)) return pathValue;
  return `${req.protocol}://${req.get("host")}/${String(pathValue).replace(/\\/g, "/")}`;
};

const frontendBaseUrl = () =>
  (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

const buildPaymentRedirectUrls = (bookingId) => {
  const base = frontendBaseUrl();
  const id = encodeURIComponent(String(bookingId));
  return {
    successUrl: `${base}/bookings?payment=success&bookingId=${id}`,
    cancelUrl: `${base}/bookings?payment=cancelled&bookingId=${id}`,
  };
};

const buildReferenceNumber = (bookingId) => {
  const suffix = Date.now().toString().slice(-6);
  const shortId = String(bookingId || "").slice(-8).toUpperCase();
  return `BOOK-${shortId}-${suffix}`;
};

const getBlockchainRecordingFee = () => getTransactionFee();

const DOWNPAYMENT_RATE = 0.3;
const PAYMENT_SCOPES = new Set(["downpayment", "full"]);
const PAYMENT_CHANNELS = new Set(["ewallet", "card"]);
const PAYMENT_CHANNEL_METHOD_TYPES = {
  ewallet: ["gcash", "paymaya"],
  card: ["card"],
};
const WALK_IN_PAYMENT_STATUSES = new Set(["none", "requested", "approved", "rejected", "completed"]);

const roundCurrency = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
};

const resolvePaymentScope = (value, fallback = "downpayment") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (PAYMENT_SCOPES.has(normalized)) return normalized;
  return fallback;
};

const resolvePaymentChannel = (value, fallback = "ewallet") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (PAYMENT_CHANNELS.has(normalized)) return normalized;
  return fallback;
};

const buildRenterName = (user = {}, renterProfile = {}) => {
  const directName = String(user?.name || renterProfile?.name || "").trim();
  if (directName) return directName;
  const firstName = String(user?.firstName || renterProfile?.firstName || "").trim();
  const lastName = String(user?.lastName || renterProfile?.lastName || "").trim();
  const combined = `${firstName} ${lastName}`.trim();
  return combined || "Renter";
};

const normalizePayMongoPhone = (phoneValue) => {
  const raw = String(phoneValue || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("63")) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.startsWith("9") && digits.length === 10) return `+63${digits}`;
  if (raw.startsWith("+")) return raw;
  return `+${digits}`;
};

const logPayMongoError = (context, error) => {
  console.error(`[PayMongo] ${context}`, {
    message: error?.message,
    code: error?.code,
    statusCode: error?.statusCode,
    stack: error?.stack,
  });
};

const shouldApplyConfiguredFeeFallback = (booking) => {
  const paymentStatus = String(booking?.paymentStatus || "unpaid").toLowerCase();
  return paymentStatus === "unpaid" || paymentStatus === "partial";
};

const getEffectiveBlockchainGasFee = (booking) => {
  const configured = getBlockchainRecordingFee();
  const persisted = Number(booking?.blockchainGasFee);
  if (Number.isFinite(persisted) && persisted > 0) {
    const roundedPersisted = Math.round(persisted * 100) / 100;
    if (!shouldApplyConfiguredFeeFallback(booking)) {
      return roundedPersisted;
    }
    return Math.round(Math.max(roundedPersisted, configured) * 100) / 100;
  }
  if (!shouldApplyConfiguredFeeFallback(booking)) {
    return 0;
  }
  return configured;
};

const getBookingRentalAmountForPayment = (booking) => {
  const directTotal = Number(booking?.totalAmount);
  if (Number.isFinite(directTotal) && directTotal > 0) {
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

const getBookingPayableAmount = (booking) => {
  const rentalAmount = getBookingRentalAmountForPayment(booking);
  const gasFee = getEffectiveBlockchainGasFee(booking);
  const safeRentalAmount = Number.isFinite(rentalAmount) && rentalAmount > 0 ? rentalAmount : 0;
  const safeGasFee = Number.isFinite(gasFee) && gasFee >= 0 ? gasFee : 0;
  return roundCurrency(safeRentalAmount + safeGasFee);
};

const getBookingPaidAmount = (booking) => {
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

const getBookingRemainingAmount = (booking) => {
  const totalPayable = getBookingPayableAmount(booking);
  const paidAmount = getBookingPaidAmount(booking);
  return roundCurrency(Math.max(totalPayable - paidAmount, 0));
};

const normalizeWalkInStatus = (value, fallback = "none") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (WALK_IN_PAYMENT_STATUSES.has(normalized)) return normalized;
  return fallback;
};

const toOptionalText = (value, maxLength = 500) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.slice(0, maxLength);
};

const toIdString = (value) => {
  const raw = value?._id || value;
  const normalized = String(raw || "").trim();
  return normalized || null;
};

const resetWalkInPaymentState = (booking, { clearBalancePaymentMethod = true } = {}) => {
  if (!booking) return;
  if (clearBalancePaymentMethod) {
    booking.balancePaymentMethod = null;
  }
  booking.walkInPaymentStatus = "none";
  booking.walkInRequestedAt = null;
  booking.walkInRequestedBy = null;
  booking.walkInRequestNote = "";
  booking.walkInReviewedAt = null;
  booking.walkInReviewedBy = null;
  booking.walkInReviewNote = "";
  booking.walkInConfirmedAt = null;
  booking.walkInConfirmedBy = null;
  booking.walkInConfirmationNote = "";
};

const serializeWalkInPayment = (booking) => ({
  status: normalizeWalkInStatus(booking?.walkInPaymentStatus, "none"),
  requestedAt: booking?.walkInRequestedAt || null,
  requestedBy: toIdString(booking?.walkInRequestedBy),
  requestNote: toOptionalText(booking?.walkInRequestNote),
  reviewedAt: booking?.walkInReviewedAt || null,
  reviewedBy: toIdString(booking?.walkInReviewedBy),
  reviewNote: toOptionalText(booking?.walkInReviewNote),
  confirmedAt: booking?.walkInConfirmedAt || null,
  confirmedBy: toIdString(booking?.walkInConfirmedBy),
  confirmationNote: toOptionalText(booking?.walkInConfirmationNote),
});

const getBookingParties = (booking) => {
  const ownerId = String(booking?.owner?._id || booking?.owner || "");
  const renterId = String(booking?.renter?._id || booking?.renter || "");
  return { ownerId, renterId };
};

const buildBookingAccessQuery = (bookingId, user) => {
  const query = { _id: bookingId };

  if (user?.role === "user") {
    query.renter = user._id;
  } else if (user?.role === "owner") {
    query.owner = user._id;
  }

  return query;
};

const mapEligibilityReasonToMessage = (reason) => {
  if (reason === "booking_cancelled") {
    return "Cancelled bookings cannot be recorded on-chain.";
  }
  if (reason === "payment_not_completed") {
    return "Booking can only be recorded on-chain after payment is completed.";
  }
  return "Booking is not eligible for blockchain recording yet.";
};

const recordBookingOnChainIfEligible = async (booking) => {
  if (!booking || booking.blockchainTxHash) {
    return {
      attempted: false,
      recorded: Boolean(booking?.blockchainTxHash),
      warning: null,
      reason: booking?.blockchainTxHash ? "already_linked" : null,
    };
  }

  const eligibility = getBookingLedgerEligibility(booking);
  if (!eligibility.eligible) {
    return {
      attempted: false,
      recorded: false,
      warning: null,
      reason: eligibility.reason,
    };
  }

  try {
    const ledgerRecord = await recordBookingTransactionOnLedger({ booking });
    applyLedgerRecordToBooking(booking, ledgerRecord);
    await booking.save();
    return {
      attempted: true,
      recorded: true,
      warning: null,
      reason: null,
    };
  } catch (error) {
    return {
      attempted: true,
      recorded: false,
      warning: "Blockchain recording is temporarily unavailable.",
      reason: "record_failed",
    };
  }
};

const serializeBooking = (req, booking) => {
  const vehicle = booking.vehicle || {};
  const rawImages = Array.isArray(vehicle.images) ? vehicle.images : [];
  const images = rawImages.map((pathValue) => getImageUrl(req, pathValue));

  return {
    _id: booking._id,
    pickupAt: booking.pickupAt,
    returnAt: booking.returnAt,
    bookingDays: booking.bookingDays,
    vehicleDailyRate: booking.vehicleDailyRate,
    driverSelected: booking.driverSelected,
    driverDailyRate: booking.driverDailyRate,
    baseAmount: booking.baseAmount,
    driverAmount: booking.driverAmount,
    totalAmount: booking.totalAmount,
    blockchainGasFee: getEffectiveBlockchainGasFee(booking),
    amountPayable: getBookingPayableAmount(booking),
    paymentAmountPaid: getBookingPaidAmount(booking),
    paymentAmountDue: getBookingRemainingAmount(booking),
    paymentCheckoutAmount: roundCurrency(Number(booking.paymentCheckoutAmount || 0)),
    paymentScope: booking.paymentScope || null,
    paymentChannel: booking.paymentChannel || null,
    downpaymentRate: DOWNPAYMENT_RATE,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    payment_status: booking.paymentStatus,
    paymentMethod: booking.paymentMethod || null,
    payment_method: booking.paymentMethod || null,
    balancePaymentMethod: booking.balancePaymentMethod || null,
    balance_payment_method: booking.balancePaymentMethod || null,
    walkInPayment: serializeWalkInPayment(booking),
    walk_in_payment: serializeWalkInPayment(booking),
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
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    reviewRating: booking.reviewRating,
    reviewComment: booking.reviewComment,
    reviewCreatedAt: booking.reviewCreatedAt,
    vehicle: booking.vehicle
      ? {
          _id: vehicle._id,
          name: vehicle.name,
          description: vehicle.description,
          location: vehicle.location,
          dailyRentalRate: vehicle.dailyRentalRate,
          driverOptionEnabled: Boolean(vehicle.driverOptionEnabled),
          driverDailyRate: vehicle.driverDailyRate || 0,
          specs: vehicle.specs || {},
          images,
          imageUrl: images[0] || getImageUrl(req, vehicle.imageUrl),
        }
      : null,
    owner: booking.owner || null,
    renter: booking.renter || null,
  };
};

const bookingPopulate = [
  {
    path: "vehicle",
    select:
      "name description location images imageUrl dailyRentalRate driverOptionEnabled driverDailyRate specs owner",
  },
  { path: "owner", select: "name email avatar role walletAddress" },
  { path: "renter", select: "name email avatar role walletAddress" },
];

export const createBooking = async (req, res) => {
  let lockAcquired = false;
  let lockedVehicleId = null;
  const releaseVehicleLock = async () => {
    if (!lockAcquired || !lockedVehicleId) return;
    await syncVehicleAvailabilityByBookingState(lockedVehicleId);
    lockAcquired = false;
  };

  try {
    const {
      vehicleId,
      pickupAt: pickupRaw,
      returnAt: returnRaw,
      driverSelected: driverSelectedRaw,
    } = req.body;

    if (!vehicleId || !pickupRaw || !returnRaw) {
      return res.status(400).json({
        success: false,
        message: "vehicleId, pickupAt, and returnAt are required.",
      });
    }

    const pickupAt = toDate(pickupRaw);
    const returnAt = toDate(returnRaw);
    if (!pickupAt || !returnAt) {
      return res.status(400).json({ success: false, message: "Invalid pickup or return date/time." });
    }

    const now = new Date();
    if (pickupAt < now || returnAt <= pickupAt) {
      return res.status(400).json({
        success: false,
        message: "Pickup must be in the future and return must be after pickup.",
      });
    }

    const vehicle = await Vehicle.findById(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found." });
    }

    if (String(vehicle.owner) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: "Owners cannot book their own vehicle." });
    }

    // Lock this vehicle so two requests cannot book it at the same time.
    const lockedVehicle = await Vehicle.findOneAndUpdate(
      { _id: vehicle._id, availabilityStatus: "available" },
      { $set: { availabilityStatus: "unavailable" } },
      { new: true }
    );
    if (!lockedVehicle) {
      return res.status(409).json({ success: false, message: "Vehicle is currently unavailable." });
    }
    lockAcquired = true;
    lockedVehicleId = lockedVehicle._id;

    const overlappingBooking = await Booking.findOne({
      vehicle: vehicle._id,
      status: { $in: ["pending", "confirmed"] },
      pickupAt: { $lt: returnAt },
      returnAt: { $gt: pickupAt },
    });

    if (overlappingBooking) {
      await releaseVehicleLock();
      return res.status(409).json({
        success: false,
        message: "Vehicle already has a booking in the selected schedule.",
      });
    }

    const bookingDays = calculateDays(pickupAt, returnAt);
    const driverSelected = boolFromValue(driverSelectedRaw);
    const driverDailyRate =
      driverSelected && lockedVehicle.driverOptionEnabled ? Number(lockedVehicle.driverDailyRate || 0) : 0;

    if (driverSelected && !lockedVehicle.driverOptionEnabled) {
      await releaseVehicleLock();
      return res.status(400).json({
        success: false,
        message: "Driver option is not available for this vehicle.",
      });
    }

    const vehicleDailyRate = Number(lockedVehicle.dailyRentalRate || 0);
    const baseAmount = vehicleDailyRate * bookingDays;
    const driverAmount = driverDailyRate * bookingDays;
    const totalAmount = baseAmount + driverAmount;
    const blockchainGasFee = getBlockchainRecordingFee();
    const paymentAmountDue = roundCurrency(totalAmount + blockchainGasFee);

    let booking;
    booking = await Booking.create({
      vehicle: lockedVehicle._id,
      renter: req.user._id,
      owner: lockedVehicle.owner,
      pickupAt,
      returnAt,
      bookingDays,
      vehicleDailyRate,
      driverSelected,
      driverDailyRate,
      baseAmount,
      driverAmount,
      totalAmount,
      blockchainGasFee,
      status: "pending",
      paymentStatus: "unpaid",
      paymentAmountPaid: 0,
      paymentAmountDue,
      paymentCheckoutAmount: 0,
      paymentScope: null,
      paymentChannel: null,
    });
    await releaseVehicleLock();

    await createNotification({
      user: vehicle.owner,
      type: "booking_status",
      title: "New booking request",
      message: `${req.user.name || "A renter"} requested to book ${vehicle.name}.`,
      data: { bookingId: booking._id, vehicleId: vehicle._id, status: "pending" },
    });

    const populated = await Booking.findById(booking._id).populate(bookingPopulate);
    const payload = serializeBooking(req, populated);

    emitToUser(String(vehicle.owner), "booking:updated", payload);
    emitToUser(String(req.user._id), "booking:updated", payload);

    res.status(201).json({
      success: true,
      message: "Booking created successfully.",
      booking: payload,
    });
  } catch {
    try {
      await releaseVehicleLock();
    } catch {
      // Do not hide the original booking error.
    }
    res.status(500).json({ success: false, message: "Failed to create booking." });
  }
};

export const getMyBookings = async (req, res) => {
  try {
    const status = req.query.status;
    const query = { renter: req.user._id };
    if (status === "cancelled") {
      query.status = { $in: ["cancelled", "rejected"] };
    } else if (status && status !== "all") {
      query.status = status;
    }

    const bookings = await Booking.find(query).populate(bookingPopulate).sort({ createdAt: -1 });
    res.json({ success: true, bookings: bookings.map((booking) => serializeBooking(req, booking)) });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch bookings." });
  }
};

export const getOwnerBookings = async (req, res) => {
  try {
    const status = req.query.status;
    const query = { owner: req.user._id };
    if (status === "cancelled") {
      query.status = { $in: ["cancelled", "rejected"] };
    } else if (status && status !== "all") {
      query.status = status;
    }

    const bookings = await Booking.find(query).populate(bookingPopulate).sort({ createdAt: -1 });
    res.json({ success: true, bookings: bookings.map((booking) => serializeBooking(req, booking)) });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch owner bookings." });
  }
};

export const getBookingById = async (req, res) => {
  try {
    const booking = await Booking.findOne(buildBookingAccessQuery(req.params.id, req.user)).populate(
      bookingPopulate
    );

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    return res.json({
      success: true,
      booking: serializeBooking(req, booking),
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch booking." });
  }
};

export const cancelMyBooking = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, renter: req.user._id });
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }
    if (!["pending", "confirmed"].includes(booking.status)) {
      return res.status(400).json({ success: false, message: "Booking can no longer be cancelled." });
    }

    booking.status = "cancelled";
    await booking.save();
    await syncVehicleAvailabilityByBookingState(booking.vehicle);

    await createNotification({
      user: booking.owner,
      type: "booking_status",
      title: "Booking cancelled",
      message: "A renter cancelled a booking.",
      data: { bookingId: booking._id, status: "cancelled" },
    });

    const populated = await Booking.findById(booking._id).populate(bookingPopulate);
    const payload = serializeBooking(req, populated);
    emitToUser(String(booking.owner), "booking:updated", payload);
    emitToUser(String(booking.renter), "booking:updated", payload);

    res.json({ success: true, booking: payload });
  } catch {
    res.status(500).json({ success: false, message: "Failed to cancel booking." });
  }
};

export const createBookingPayment = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, renter: req.user._id }).populate(
      bookingPopulate
    );
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }
    const normalizedPaymentStatus = String(booking.paymentStatus || "").toLowerCase();
    if (!["unpaid", "partial"].includes(normalizedPaymentStatus)) {
      return res.status(400).json({
        success: false,
        message: "Only unpaid or partially paid bookings can start a payment checkout.",
        booking: serializeBooking(req, booking),
      });
    }
    if (["cancelled", "rejected"].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: "Cancelled bookings cannot be paid.",
      });
    }
    if (booking.status !== "confirmed") {
      return res.status(400).json({
        success: false,
        message: "Booking payment is only available after owner approval.",
        booking: serializeBooking(req, booking),
      });
    }

    const effectiveBlockchainGasFee = getEffectiveBlockchainGasFee(booking);
    const persistedGasFee = Number(booking.blockchainGasFee);
    if (
      (!Number.isFinite(persistedGasFee) || persistedGasFee < effectiveBlockchainGasFee) &&
      effectiveBlockchainGasFee > 0
    ) {
      booking.blockchainGasFee = effectiveBlockchainGasFee;
    }

    const totalPayable = getBookingPayableAmount(booking);
    const paidAmount = getBookingPaidAmount(booking);
    const remainingAmount = getBookingRemainingAmount(booking);
    if (!Number.isFinite(totalPayable) || totalPayable <= 0) {
      return res.status(400).json({
        success: false,
        message: "Booking amount is invalid for payment.",
      });
    }
    if (!Number.isFinite(remainingAmount) || remainingAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "This booking is already fully paid.",
        booking: serializeBooking(req, booking),
      });
    }

    const defaultScope = normalizedPaymentStatus === "partial" ? "full" : "downpayment";
    const requestedScope = resolvePaymentScope(req.body?.paymentScope, defaultScope);
    if (normalizedPaymentStatus === "partial" && requestedScope !== "full") {
      return res.status(400).json({
        success: false,
        message: "Remaining balance must be paid in full.",
      });
    }

    const requestedChannel = resolvePaymentChannel(req.body?.paymentChannel, "ewallet");
    const methodTypes = PAYMENT_CHANNEL_METHOD_TYPES[requestedChannel] || PAYMENT_CHANNEL_METHOD_TYPES.ewallet;

    let effectiveScope = requestedScope;
    let amountToCharge = remainingAmount;
    if (normalizedPaymentStatus === "unpaid" && requestedScope === "downpayment") {
      amountToCharge = roundCurrency(totalPayable * DOWNPAYMENT_RATE);
      if (amountToCharge <= 0 || amountToCharge >= remainingAmount) {
        amountToCharge = remainingAmount;
        effectiveScope = "full";
      }
    } else {
      amountToCharge = remainingAmount;
      effectiveScope = "full";
    }

    if (!Number.isFinite(amountToCharge) || amountToCharge <= 0) {
      return res.status(400).json({
        success: false,
        message: "Payment amount is invalid for checkout.",
      });
    }

    const referenceNumber = buildReferenceNumber(booking._id);
    const amountInCentavos = Math.round(amountToCharge * 100);
    const { successUrl, cancelUrl } = buildPaymentRedirectUrls(booking._id);
    const renterProfile = booking?.renter || {};
    const renterName = buildRenterName(req.user, renterProfile);
    const vehicleName = booking.vehicle?.name || "vehicle rental";
    const description = `Booking ${effectiveScope} payment for ${vehicleName} (Renter: ${renterName})`;
    const lineItemBaseName = booking.vehicle?.name || "Vehicle Booking";
    const itemName = renterName ? `${lineItemBaseName} - ${renterName}` : lineItemBaseName;
    const renterEmail = String(req.user?.email || renterProfile.email || "").trim();
    const renterPhone = normalizePayMongoPhone(
      req.user?.phone || renterProfile.phone || renterProfile.mobile || renterProfile.phoneNumber
    );
    const billing = {
      name: renterName,
      email: renterEmail,
      phone: renterPhone,
    };

    const checkoutSession = await createPayMongoCheckoutSession({
      amountInCentavos,
      itemName,
      description,
      referenceNumber,
      successUrl,
      cancelUrl,
      billing,
      paymentMethodTypes: methodTypes,
      metadata: {
        bookingId: String(booking._id),
        renterId: String(req.user._id),
        renterName,
        renterEmail: billing.email,
        ownerId: String(booking.owner?._id || booking.owner || ""),
        paymentScope: effectiveScope,
        paymentChannel: requestedChannel,
        paymentAmount: amountToCharge,
        totalPayable,
        remainingAmount,
        blockchainGasFee: Number(getEffectiveBlockchainGasFee(booking) || 0),
      },
    });

    const checkoutId = getPayMongoCheckoutId(checkoutSession);
    const checkoutUrl = getPayMongoCheckoutUrl(checkoutSession);
    if (!checkoutId || !checkoutUrl) {
      return res.status(502).json({
        success: false,
        message: "Failed to create payment checkout URL.",
      });
    }

    booking.paymentMethod = "PayMongo";
    resetWalkInPaymentState(booking);
    booking.paymongoReference = getPayMongoCheckoutReferenceNumber(checkoutSession) || referenceNumber;
    booking.paymongoCheckoutId = checkoutId;
    booking.paymentIntentId = getPayMongoPaymentIntentId(checkoutSession) || booking.paymentIntentId;
    booking.paymentScope = effectiveScope;
    booking.paymentChannel = requestedChannel;
    booking.paymentCheckoutAmount = amountToCharge;
    booking.paymentAmountPaid = paidAmount;
    booking.paymentAmountDue = remainingAmount;
    booking.paymentRequestedAt = new Date();
    booking.paymentUpdatedAt = new Date();
    await booking.save();

    const refreshed = await Booking.findById(booking._id).populate(bookingPopulate);
    const payload = serializeBooking(req, refreshed);
    const { ownerId, renterId } = getBookingParties(refreshed);

    emitToUser(ownerId, "booking:updated", payload);
    emitToUser(renterId, "booking:updated", payload);

    return res.json({
      success: true,
      message: "Payment checkout created.",
      checkoutUrl,
      checkoutId,
      referenceNumber: payload.paymongoReference,
      payment: {
        scope: effectiveScope,
        channel: requestedChannel,
        amountToCharge,
        totalPayable,
        amountPaid: paidAmount,
        amountRemainingAfterThis: roundCurrency(Math.max(remainingAmount - amountToCharge, 0)),
      },
      booking: payload,
    });
  } catch (error) {
    if (error?.isPayMongoError) {
      logPayMongoError("Checkout session creation failed", error);
      const statusCode = error?.statusCode >= 400 && error?.statusCode < 600 ? error.statusCode : 502;
      return res.status(statusCode).json({
        success: false,
        message: "We could not start the payment. Please try again later.",
      });
    }
    console.error("[Booking Payment] Checkout session creation failed", error);
    return res.status(500).json({ success: false, message: "Failed to create booking payment." });
  }
};

export const setBookingBalancePaymentMethod = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, renter: req.user._id }).populate(
      bookingPopulate
    );
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }
    if (["cancelled", "rejected"].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: "Cancelled bookings cannot be updated for payment.",
      });
    }
    if (booking.status !== "confirmed") {
      return res.status(400).json({
        success: false,
        message: "Booking must be confirmed before setting payment options.",
      });
    }

    const normalizedPaymentStatus = String(booking.paymentStatus || "").toLowerCase();
    if (normalizedPaymentStatus !== "partial") {
      return res.status(400).json({
        success: false,
        message: "Walk-in payment is only available after the downpayment is recorded.",
      });
    }

    const remainingAmount = getBookingRemainingAmount(booking);
    if (!Number.isFinite(remainingAmount) || remainingAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "This booking has no remaining balance.",
      });
    }

    const requestedMethod = String(req.body?.method || "").trim().toLowerCase();
    if (!["walkin", "walk-in", "on_return", "on-return", "manual"].includes(requestedMethod)) {
      return res.status(400).json({
        success: false,
        message: "Invalid balance payment method.",
      });
    }

    const currentWalkInStatus = normalizeWalkInStatus(booking.walkInPaymentStatus, "none");
    if (currentWalkInStatus === "requested") {
      return res.status(409).json({
        success: false,
        message: "Walk-in payment approval is already pending.",
      });
    }
    if (currentWalkInStatus === "approved") {
      return res.status(409).json({
        success: false,
        message: "Walk-in payment has already been approved by the owner.",
      });
    }
    if (currentWalkInStatus === "completed") {
      return res.status(400).json({
        success: false,
        message: "Walk-in payment has already been confirmed.",
      });
    }

    const requestNote = toOptionalText(req.body?.note, 500);
    booking.balancePaymentMethod = "Walk-in";
    booking.walkInPaymentStatus = "requested";
    booking.walkInRequestedAt = new Date();
    booking.walkInRequestedBy = req.user._id;
    booking.walkInRequestNote = requestNote;
    booking.walkInReviewedAt = null;
    booking.walkInReviewedBy = null;
    booking.walkInReviewNote = "";
    booking.walkInConfirmedAt = null;
    booking.walkInConfirmedBy = null;
    booking.walkInConfirmationNote = "";
    booking.paymentUpdatedAt = new Date();
    await booking.save();

    const refreshed = await Booking.findById(booking._id).populate(bookingPopulate);
    const payload = serializeBooking(req, refreshed);
    const { ownerId, renterId } = getBookingParties(refreshed);

    await createNotification({
      user: ownerId,
      type: "booking_payment",
      title: "Walk-in payment requested",
      message: `${req.user.name || "Your renter"} requested walk-in payment approval for ${
        refreshed.vehicle?.name || "a booking"
      }.`,
      data: { bookingId: refreshed._id, walkInPaymentStatus: "requested" },
    });
    await createNotification({
      user: renterId,
      type: "booking_payment",
      title: "Walk-in payment request sent",
      message: "Your request is now waiting for owner approval.",
      data: { bookingId: refreshed._id, walkInPaymentStatus: "requested" },
    });

    emitToUser(ownerId, "booking:updated", payload);
    emitToUser(renterId, "booking:updated", payload);

    return res.json({
      success: true,
      message: "Walk-in payment request submitted. Waiting for owner approval.",
      booking: payload,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update payment method." });
  }
};

export const verifyBookingPayment = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, renter: req.user._id }).populate(
      bookingPopulate
    );
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }
    if (["cancelled", "rejected"].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: "Cancelled bookings cannot be verified for payment.",
      });
    }
    const wasPaid = booking.paymentStatus === "paid";
    if (!wasPaid && booking.status !== "confirmed") {
      return res.status(400).json({
        success: false,
        message: "Booking payment can only be verified after owner approval.",
      });
    }
    let isPaid = wasPaid;

    if (!wasPaid) {
      const checkoutIdInput = String(req.body?.checkoutId || "").trim();
      const storedCheckoutId = String(booking.paymongoCheckoutId || "").trim();
      if (checkoutIdInput && storedCheckoutId && checkoutIdInput !== storedCheckoutId) {
        return res.status(400).json({
          success: false,
          message: "Checkout reference does not match this booking.",
        });
      }

      const checkoutId = storedCheckoutId || checkoutIdInput;
      if (!checkoutId) {
        return res.status(400).json({
          success: false,
          message: "No PayMongo checkout reference found for this booking.",
        });
      }

      const checkoutSession = await getPayMongoCheckoutSession(checkoutId);
      const sessionCheckoutId = getPayMongoCheckoutId(checkoutSession);
      const sessionReferenceNumber = getPayMongoCheckoutReferenceNumber(checkoutSession);
      const sessionMetadata = getPayMongoCheckoutMetadata(checkoutSession);
      const sessionAmountInCentavos = getPayMongoCheckoutAmountInCentavos(checkoutSession);

      if (storedCheckoutId && sessionCheckoutId && sessionCheckoutId !== storedCheckoutId) {
        return res.status(400).json({
          success: false,
          message: "Payment checkout session does not belong to this booking.",
        });
      }

      const storedReferenceNumber = String(booking.paymongoReference || "").trim();
      if (storedReferenceNumber && sessionReferenceNumber && sessionReferenceNumber !== storedReferenceNumber) {
        return res.status(400).json({
          success: false,
          message: "Payment reference does not match this booking.",
        });
      }

      const configuredCheckoutAmount = roundCurrency(Number(booking.paymentCheckoutAmount || 0));
      const expectedCheckoutAmount =
        configuredCheckoutAmount > 0
          ? configuredCheckoutAmount
          : String(booking.paymentStatus || "").toLowerCase() === "partial"
            ? getBookingRemainingAmount(booking)
            : getBookingPayableAmount(booking);
      const expectedAmountInCentavos = Math.round(expectedCheckoutAmount * 100);
      if (
        !Number.isFinite(expectedAmountInCentavos) ||
        expectedAmountInCentavos <= 0 ||
        sessionAmountInCentavos !== expectedAmountInCentavos
      ) {
        return res.status(400).json({
          success: false,
          message: "Payment amount does not match this booking.",
        });
      }

      const expectedBookingId = String(booking._id || "");
      const expectedRenterId = String(booking.renter?._id || booking.renter || "");
      const expectedOwnerId = String(booking.owner?._id || booking.owner || "");
      const metadataBookingId = String(sessionMetadata?.bookingId || "");
      const metadataRenterId = String(sessionMetadata?.renterId || "");
      const metadataOwnerId = String(sessionMetadata?.ownerId || "");

      if (
        (metadataBookingId && metadataBookingId !== expectedBookingId) ||
        (metadataRenterId && metadataRenterId !== expectedRenterId) ||
        (metadataOwnerId && metadataOwnerId !== expectedOwnerId)
      ) {
        return res.status(400).json({
          success: false,
          message: "Payment metadata does not match this booking.",
        });
      }

      isPaid = isPayMongoCheckoutPaid(checkoutSession);

      booking.paymentMethod = "PayMongo";
      booking.paymongoCheckoutId = getPayMongoCheckoutId(checkoutSession) || checkoutId;
      booking.paymongoReference =
        getPayMongoCheckoutReferenceNumber(checkoutSession) || booking.paymongoReference;
      booking.paymentIntentId = getPayMongoPaymentIntentId(checkoutSession) || booking.paymentIntentId;
      booking.paymentUpdatedAt = new Date();

      if (isPaid) {
        const totalPayable = getBookingPayableAmount(booking);
        const paidBefore = getBookingPaidAmount(booking);
        const paidAfter = Math.min(totalPayable, roundCurrency(paidBefore + expectedCheckoutAmount));
        const remainingAfter = roundCurrency(Math.max(totalPayable - paidAfter, 0));

        booking.paymentAmountPaid = paidAfter;
        booking.paymentAmountDue = remainingAfter;
        booking.paymentCheckoutAmount = 0;

        if (remainingAfter <= 0) {
          booking.paymentStatus = "paid";
          booking.paidAt = booking.paidAt || new Date();
        } else {
          booking.paymentStatus = "partial";
          booking.paidAt = null;
        }
        resetWalkInPaymentState(booking);
      }

      await booking.save();
    }

    const blockchainResult = await recordBookingOnChainIfEligible(booking);

    const refreshed = await Booking.findById(booking._id).populate(bookingPopulate);
    const payload = serializeBooking(req, refreshed);
    const { ownerId, renterId } = getBookingParties(refreshed);

    if (isPaid && !wasPaid) {
      const isNowPaidInFull = payload.paymentStatus === "paid";
      await createNotification({
        user: ownerId,
        type: "booking_payment",
        title: isNowPaidInFull ? "Booking paid" : "Downpayment received",
        message: isNowPaidInFull
          ? `${req.user.name || "A renter"} completed payment for ${
              refreshed.vehicle?.name || "a booking"
            }.`
          : `${req.user.name || "A renter"} paid a downpayment for ${
              refreshed.vehicle?.name || "a booking"
            }.`,
        data: { bookingId: refreshed._id, paymentStatus: payload.paymentStatus },
      });
      await createNotification({
        user: renterId,
        type: "booking_payment",
        title: isNowPaidInFull ? "Payment successful" : "Downpayment successful",
        message: isNowPaidInFull
          ? `Your payment for ${refreshed.vehicle?.name || "your booking"} was successful.`
          : `Your downpayment for ${refreshed.vehicle?.name || "your booking"} was successful.`,
        data: { bookingId: refreshed._id, paymentStatus: payload.paymentStatus },
      });
    }

    emitToUser(ownerId, "booking:updated", payload);
    emitToUser(renterId, "booking:updated", payload);

    const hasTxHash = Boolean(payload.blockchainTxHash);
    const blockchainWarning = blockchainResult?.warning || null;
    let message = "Payment is not completed yet.";

    if (payload.paymentStatus === "paid") {
      if (hasTxHash && wasPaid) {
        message = "Payment already verified. Booking is recorded on blockchain.";
      } else if (hasTxHash) {
        message = "Payment verified successfully. Booking was automatically recorded on blockchain.";
      } else if (blockchainWarning) {
        message = `Payment verified successfully. Blockchain recording is pending: ${blockchainWarning}`;
      } else {
        message = "Payment verified successfully. Blockchain recording is pending.";
      }
    } else if (payload.paymentStatus === "partial") {
      const remaining = Number(payload.paymentAmountDue || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      message = `Downpayment verified successfully. Remaining balance: \u20b1${remaining}.`;
    }

    return res.json({
      success: true,
      paid: payload.paymentStatus === "paid",
      paymentCaptured: isPaid,
      paymentStatus: payload.paymentStatus,
      checkoutId: payload.paymongoCheckoutId,
      referenceNumber: payload.paymongoReference,
      booking: payload,
      blockchain: {
        recorded: hasTxHash,
        pending: payload.paymentStatus === "paid" && !hasTxHash,
        warning: blockchainWarning,
      },
      message,
    });
  } catch (error) {
    if (error?.isPayMongoError) {
      logPayMongoError("Payment verification failed", error);
      const statusCode = error?.statusCode >= 400 && error?.statusCode < 600 ? error.statusCode : 502;
      return res.status(statusCode).json({
        success: false,
        message: "We could not verify the payment right now. Please try again later.",
      });
    }
    console.error("[Booking Payment] Payment verification failed", error);
    return res.status(500).json({ success: false, message: "Failed to verify booking payment." });
  }
};

export const recordBookingTransactionOnChain = async (req, res) => {
  try {
    const booking = await Booking.findOne(buildBookingAccessQuery(req.params.id, req.user)).populate(
      bookingPopulate
    );
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    if (booking.blockchainTxHash) {
      return res.json({
        success: true,
        message: "Booking is already recorded on-chain.",
        booking: serializeBooking(req, booking),
      });
    }

    const eligibility = getBookingLedgerEligibility(booking);
    if (!eligibility.eligible) {
      return res.status(400).json({
        success: false,
        message: mapEligibilityReasonToMessage(eligibility.reason),
      });
    }

    const blockchainResult = await recordBookingOnChainIfEligible(booking);
    if (!blockchainResult.recorded) {
      return res.status(503).json({
        success: false,
        message: "Blockchain recording is temporarily unavailable.",
      });
    }

    const refreshed = await Booking.findById(booking._id).populate(bookingPopulate);
    const payload = serializeBooking(req, refreshed);
    const { ownerId: normalizedOwnerId, renterId } = getBookingParties(refreshed);

    emitToUser(normalizedOwnerId, "booking:updated", payload);
    emitToUser(renterId, "booking:updated", payload);

    return res.json({
      success: true,
      message: "Booking transaction was recorded on blockchain.",
      booking: payload,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to record booking on blockchain.",
    });
  }
};

export const addBookingReview = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const numericRating = Number(rating);

    if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ success: false, message: "Rating must be between 1 and 5." });
    }

    const booking = await Booking.findOne({ _id: req.params.id, renter: req.user._id });
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }
    if (booking.status !== "completed") {
      return res.status(400).json({ success: false, message: "Only completed bookings can be reviewed." });
    }

    booking.reviewRating = numericRating;
    booking.reviewComment = String(comment || "").trim();
    booking.reviewCreatedAt = new Date();
    await booking.save();

    await createNotification({
      user: booking.owner,
      type: "system",
      title: "New vehicle review",
      message: "A renter left a review on a completed booking.",
      data: { bookingId: booking._id, rating: booking.reviewRating },
    });

    const populated = await Booking.findById(booking._id).populate(bookingPopulate);
    res.json({ success: true, booking: serializeBooking(req, populated) });
  } catch {
    res.status(500).json({ success: false, message: "Failed to submit review." });
  }
};
