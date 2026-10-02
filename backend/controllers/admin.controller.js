import Booking from "../models/Booking.js";
import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import { roundCurrency } from "../utils/pricing.js";

const PAYMENT_STATUSES = new Set(["unpaid", "partial", "paid", "refunded"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const parseLimit = (value) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
};

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseCursor = (value) => {
  if (!value || typeof value !== "string") return null;

  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const createdAt = new Date(decoded?.createdAt);
    const id = String(decoded?.id || "").trim();
    if (Number.isNaN(createdAt.getTime()) || !Booking.base.Types.ObjectId.isValid(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
};

const createCursor = (booking) => {
  if (!booking?._id || !booking?.createdAt) return null;
  return Buffer.from(
    JSON.stringify({ createdAt: new Date(booking.createdAt).toISOString(), id: String(booking._id) })
  ).toString("base64url");
};

const getRentalAmount = (booking) => {
  const rental = Number(booking?.totalAmount || 0);
  const lateFee = Number(booking?.lateReturnPenaltyFee || 0);
  return roundCurrency(
    (Number.isFinite(rental) ? Math.max(rental, 0) : 0) +
      (Number.isFinite(lateFee) ? Math.max(lateFee, 0) : 0)
  );
};

const getTransactionFee = (booking) => {
  const persisted = Number(booking?.transactionFee);
  if (Number.isFinite(persisted) && persisted > 0) return roundCurrency(persisted);

  const paid = Number(booking?.paymentAmountPaid || 0);
  const due = Number(booking?.paymentAmountDue || 0);
  const inferred = paid + due - getRentalAmount(booking);
  return Number.isFinite(inferred) && inferred > 0 ? roundCurrency(inferred) : 0;
};

const getPayableAmount = (booking) => roundCurrency(getRentalAmount(booking) + getTransactionFee(booking));

const getPaidAmount = (booking) => {
  const payable = getPayableAmount(booking);
  const paid = Number(booking?.paymentAmountPaid);
  if (Number.isFinite(paid) && paid > 0) return roundCurrency(Math.min(paid, payable));
  return booking?.paymentStatus === "paid" ? payable : 0;
};

const serializeTransaction = (booking) => {
  const payableAmount = getPayableAmount(booking);
  const paidAmount = getPaidAmount(booking);
  const persistedDue = Number(booking?.paymentAmountDue);
  const dueAmount =
    Number.isFinite(persistedDue) && persistedDue >= 0
      ? roundCurrency(persistedDue)
      : roundCurrency(Math.max(payableAmount - paidAmount, 0));

  return {
    _id: booking._id,
    bookingStatus: booking.status,
    paymentStatus: booking.paymentStatus,
    paymentMethod: booking.paymentMethod || null,
    paymentChannel: booking.paymentChannel || null,
    balancePaymentMethod: booking.balancePaymentMethod || null,
    paymongoReference: booking.paymongoReference || null,
    paymongoCheckoutId: booking.paymongoCheckoutId || null,
    paymentIntentId: booking.paymentIntentId || null,
    rentalAmount: getRentalAmount(booking),
    transactionFee: getTransactionFee(booking),
    amountPayable: payableAmount,
    paymentAmountPaid: paidAmount,
    paymentAmountDue: dueAmount,
    paymentRequestedAt: booking.paymentRequestedAt || null,
    paymentUpdatedAt: booking.paymentUpdatedAt || null,
    paidAt: booking.paidAt || null,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    vehicle: booking.vehicle
      ? {
          _id: booking.vehicle._id,
          name: booking.vehicle.name || "",
          location: booking.vehicle.location || "",
        }
      : null,
    renter: booking.renter
      ? {
          _id: booking.renter._id,
          name: booking.renter.name || "",
          email: booking.renter.email || "",
        }
      : null,
    owner: booking.owner
      ? {
          _id: booking.owner._id,
          name: booking.owner.name || "",
          email: booking.owner.email || "",
        }
      : null,
  };
};

const buildSearchFilter = async (rawSearch) => {
  const search = String(rawSearch || "").trim().slice(0, 100);
  if (!search) return null;

  const regex = new RegExp(escapeRegex(search), "i");
  const [users, vehicles] = await Promise.all([
    User.find({ $or: [{ name: regex }, { email: regex }] }).select("_id").limit(100).lean(),
    Vehicle.find({ name: regex }).select("_id").limit(100).lean(),
  ]);

  const clauses = [
    { paymongoReference: regex },
    { paymongoCheckoutId: regex },
    { paymentIntentId: regex },
  ];

  if (Booking.base.Types.ObjectId.isValid(search)) clauses.push({ _id: search });
  if (users.length) {
    const userIds = users.map((user) => user._id);
    clauses.push({ renter: { $in: userIds } }, { owner: { $in: userIds } });
  }
  if (vehicles.length) clauses.push({ vehicle: { $in: vehicles.map((vehicle) => vehicle._id) } });

  return { $or: clauses };
};

const getTransactionSummary = async () => {
  const [summary] = await Booking.aggregate([
    {
      $group: {
        _id: null,
        totalRecords: { $sum: 1 },
        paidBookings: { $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0] } },
        partialPayments: { $sum: { $cond: [{ $eq: ["$paymentStatus", "partial"] }, 1, 0] } },
        unpaidBookings: { $sum: { $cond: [{ $eq: ["$paymentStatus", "unpaid"] }, 1, 0] } },
        refundedBookings: { $sum: { $cond: [{ $eq: ["$paymentStatus", "refunded"] }, 1, 0] } },
        totalCollected: {
          $sum: {
            $cond: [
              { $gt: [{ $ifNull: ["$paymentAmountPaid", 0] }, 0] },
              { $ifNull: ["$paymentAmountPaid", 0] },
              {
                $cond: [
                  { $eq: ["$paymentStatus", "paid"] },
                  {
                    $add: [
                      { $ifNull: ["$totalAmount", 0] },
                      { $ifNull: ["$lateReturnPenaltyFee", 0] },
                      { $ifNull: ["$transactionFee", 0] },
                    ],
                  },
                  0,
                ],
              },
            ],
          },
        },
      },
    },
  ]);

  return {
    totalRecords: Number(summary?.totalRecords || 0),
    paidBookings: Number(summary?.paidBookings || 0),
    partialPayments: Number(summary?.partialPayments || 0),
    unpaidBookings: Number(summary?.unpaidBookings || 0),
    refundedBookings: Number(summary?.refundedBookings || 0),
    totalCollected: roundCurrency(Number(summary?.totalCollected || 0)),
  };
};

export const getAdminTransactions = async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const paymentStatus = String(req.query.paymentStatus || "all").trim().toLowerCase();
    const cursor = parseCursor(req.query.cursor);
    const filter = {};

    if (paymentStatus !== "all") {
      if (!PAYMENT_STATUSES.has(paymentStatus)) {
        return res.status(400).json({ success: false, message: "Invalid payment status filter." });
      }
      filter.paymentStatus = paymentStatus;
    }

    const searchFilter = await buildSearchFilter(req.query.search);
    if (searchFilter) Object.assign(filter, searchFilter);

    if (cursor) {
      const cursorFilter = {
        $or: [
          { createdAt: { $lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
        ],
      };

      if (filter.$or) {
        const searchClauses = filter.$or;
        delete filter.$or;
        filter.$and = [{ $or: searchClauses }, cursorFilter];
      } else {
        Object.assign(filter, cursorFilter);
      }
    }

    const [documents, summary] = await Promise.all([
      Booking.find(filter)
        .populate({ path: "vehicle", select: "name location" })
        .populate({ path: "renter", select: "name email" })
        .populate({ path: "owner", select: "name email" })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1),
      getTransactionSummary(),
    ]);

    const hasMore = documents.length > limit;
    const bookings = hasMore ? documents.slice(0, limit) : documents;

    return res.json({
      success: true,
      transactions: bookings.map(serializeTransaction),
      summary,
      page: {
        hasMore,
        nextCursor: hasMore ? createCursor(bookings[bookings.length - 1]) : null,
        limit,
      },
    });
  } catch (error) {
    console.error("[Admin] Failed to fetch transaction records", error);
    return res.status(500).json({ success: false, message: "Failed to fetch transaction records." });
  }
};
