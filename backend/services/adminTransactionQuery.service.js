const number = (field, fallback = 0) => ({ $convert: { input: field, to: "double", onError: fallback, onNull: 0 } });
const money = value => ({ $divide: [{ $floor: { $add: [{ $multiply: [{ $add: [value, Number.EPSILON] }, 100] }, 0.5] } }, 100] });
const nonnegative = field => ({ $max: [number(field), 0] });
const sumIf = status => ({ $sum: { $cond: [{ $eq: ["$_adminPaymentStatus", status] }, 1, 0] } });
const join = (collection, field, target, projection) => ({ $lookup: { from: collection, localField: field,
  foreignField: "_id", pipeline: [{ $project: projection }], as: target } });

export function buildTransactionPipeline({ paymentStatus, search, offset, limit, months, outstandingOnly = false }) {
  const page = [];
  if (outstandingOnly) page.push({ $match: { _adminActionableDue: { $gt: 0 } } });
  if (paymentStatus !== "all") page.push({ $match: { _adminPaymentStatus: paymentStatus } });
  page.push(join("users", "renter", "_adminRenter", { name: 1, email: 1 }),
    join("users", "owner", "_adminOwner", { name: 1, email: 1 }),
    join("vehicles", "vehicle", "_adminVehicle", { name: 1, location: 1 }));
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    page.push({ $match: { $or: ["_adminId", "paymongoReference", "paymongoCheckoutId", "paymentIntentId",
      "_adminVehicle.name", "_adminVehicle.location", "_adminRenter.name", "_adminRenter.email", "_adminOwner.name", "_adminOwner.email"]
      .map(field => ({ [field]: { $regex: escaped, $options: "i" } })) } });
  }
  page.push({ $sort: { createdAt: -1, _id: -1 } }, { $skip: offset }, { $limit: limit + 1 });
  const firstMonth = new Date(`${months[0].key}-01T00:00:00Z`);
  const nextMonth = new Date(`${months.at(-1).key}-01T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  return [
    { $project: { vehicle: 1, renter: 1, owner: 1, status: 1, paymentStatus: 1, paymentMethod: 1, paymentChannel: 1,
      balancePaymentMethod: 1, paymongoReference: 1, paymongoCheckoutId: 1, paymentIntentId: 1, totalAmount: 1,
      lateReturnPenaltyFee: 1, transactionFee: 1, paymentAmountPaid: 1, paymentAmountDue: 1, paymentRequestedAt: 1,
      paymentUpdatedAt: 1, paidAt: 1, createdAt: 1, updatedAt: 1 } },
    { $set: { _adminRental: money({ $add: [nonnegative("$totalAmount"), nonnegative("$lateReturnPenaltyFee")] }),
      _adminPaidValue: nonnegative("$paymentAmountPaid"), _adminDueValue: nonnegative("$paymentAmountDue"),
      _adminPersistedDue: { $cond: [{ $eq: [{ $type: "$paymentAmountDue" }, "missing"] }, null, number("$paymentAmountDue", null)] },
      _adminFeeValue: number("$transactionFee"), _adminId: { $toString: "$_id" },
      _adminPaymentStatus: { $let: { vars: { status: { $trim: { input: { $ifNull: ["$paymentStatus", ""] } } } },
        in: { $toLower: { $cond: [{ $eq: ["$$status", ""] }, "unpaid", "$$status"] } } } },
      _adminBookingStatus: { $toLower: { $trim: { input: { $ifNull: ["$status", ""] } } } },
      _adminCreated: { $convert: { input: "$createdAt", to: "date", onError: null, onNull: null } } } },
    { $set: { _adminInferredFee: { $subtract: [{ $add: ["$_adminPaidValue", "$_adminDueValue"] }, "$_adminRental"] } } },
    { $set: { _adminFee: money({ $cond: [{ $gt: ["$_adminFeeValue", 0] }, "$_adminFeeValue", { $max: ["$_adminInferredFee", 0] }] }) } },
    { $set: { _adminPayable: money({ $add: ["$_adminRental", "$_adminFee"] }) } },
    { $set: { _adminPaid: money({ $cond: [{ $gt: ["$_adminPaidValue", 0] }, { $min: ["$_adminPaidValue", "$_adminPayable"] },
      { $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$_adminPayable", 0] }] }) } },
    { $set: { _adminDue: money({ $cond: [{ $and: [{ $ne: ["$_adminPersistedDue", null] }, { $gte: ["$_adminPersistedDue", 0] }] },
      "$_adminPersistedDue", { $max: [{ $subtract: ["$_adminPayable", "$_adminPaid"] }, 0] }] }) } },
    { $set: { _adminActionableDue: { $cond: [{ $and: [
      { $not: [{ $in: ["$_adminBookingStatus", ["cancelled", "rejected"]] }] },
      { $ne: ["$_adminPaymentStatus", "refunded"] },
    ] }, "$_adminDue", 0] } } },
    { $facet: {
      rows: page,
      totals: [{ $group: { _id: null, totalRecords: { $sum: 1 }, paidBookings: sumIf("paid"), partialPayments: sumIf("partial"),
        unpaidBookings: sumIf("unpaid"), refundedBookings: sumIf("refunded"), totalCollected: { $sum: "$_adminPaid" },
        totalOutstanding: { $sum: "$_adminDue" }, totalPayable: { $sum: "$_adminPayable" }, totalTransactionFees: { $sum: "$_adminFee" },
        totalActionableOutstanding: { $sum: "$_adminActionableDue" },
        trendStartDate: { $min: "$_adminCreated" } } }],
      monthlyTrend: [{ $match: { _adminCreated: { $gte: firstMonth, $lt: nextMonth } } },
        { $group: { _id: { $dateToString: { date: "$_adminCreated", format: "%Y-%m", timezone: "UTC" } },
          collected: { $sum: "$_adminPaid" }, outstanding: { $sum: "$_adminDue" }, fees: { $sum: "$_adminFee" }, records: { $sum: 1 } } }],
    } },
  ];
}
