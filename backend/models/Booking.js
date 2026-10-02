import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema(
  {
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    renter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    pickupAt: {
      type: Date,
      required: true,
    },
    returnAt: {
      type: Date,
      required: true,
    },
    vehicleDailyRate: {
      type: Number,
      required: true,
      min: 0,
    },
    rentalRateUnit: {
      type: String,
      enum: ["hourly", "daily"],
      default: "hourly",
    },
    driverSelected: {
      type: Boolean,
      default: false,
    },
    driverDailyRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    bookingDays: {
      type: Number,
      required: true,
      min: 1,
    },
    bookingDurationMinutes: {
      type: Number,
      min: 1,
      default: null,
    },
    bookingDurationHours: {
      type: Number,
      min: 0,
      default: null,
    },
    baseAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    driverAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    lateReturnPenaltyRatePerHour: {
      type: Number,
      default: 0,
      min: 0,
    },
    lateReturnFeeType: {
      type: String,
      enum: ["percentage", "fixed_hourly", null],
      default: null,
    },
    lateReturnFeeValue: {
      type: Number,
      default: null,
      min: 0,
    },
    lateReturnGraceMinutes: {
      type: Number,
      default: null,
      min: 0,
      max: 1440,
    },
    lateReturnPenaltyFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    transactionFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "extended", "completed", "cancelled", "rejected"],
      default: "pending",
      index: true,
    },
    autoCompletedAt: {
      type: Date,
      default: null,
    },
    actualReturnAt: {
      type: Date,
      default: null,
    },
    returnStatus: {
      type: String,
      enum: ["none", "requested", "confirmed", "declined"],
      default: "none",
      index: true,
    },
    returnRequestedAt: {
      type: Date,
      default: null,
    },
    returnRequestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    returnConfirmedAt: {
      type: Date,
      default: null,
    },
    returnConfirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    returnReviewedAt: {
      type: Date,
      default: null,
    },
    returnReviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    returnReviewAction: {
      type: String,
      enum: ["", "confirm", "decline"],
      default: "",
    },
    returnReviewNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    lateReturnIsOverdue: {
      type: Boolean,
      default: false,
      index: true,
    },
    lateReturnDetectedAt: {
      type: Date,
      default: null,
    },
    lateReturnNotifiedAt: {
      type: Date,
      default: null,
    },
    lateReturnOverdueMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    lateReturnAction: {
      type: String,
      enum: ["none", "extend_requested", "proceed_late_return", "return_confirmed"],
      default: "none",
    },
    lateReturnResolvedAt: {
      type: Date,
      default: null,
    },
    lateReturnResolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    extensionStatus: {
      type: String,
      enum: ["none", "requested", "approved", "rejected"],
      default: "none",
      index: true,
    },
    extensionRequestedAt: {
      type: Date,
      default: null,
    },
    extensionRequestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    extensionCurrentReturnAt: {
      type: Date,
      default: null,
    },
    extensionRequestedReturnAt: {
      type: Date,
      default: null,
    },
    extensionRequestNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    extensionReviewedAt: {
      type: Date,
      default: null,
    },
    extensionReviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    extensionReviewAction: {
      type: String,
      enum: ["", "approve", "reject"],
      default: "",
    },
    extensionReviewNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    cancellationStatus: {
      type: String,
      enum: ["none", "requested", "approved", "rejected"],
      default: "none",
      index: true,
    },
    cancellationRequestedAt: {
      type: Date,
      default: null,
    },
    cancellationRequestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancellationRequestNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    cancellationReviewedAt: {
      type: Date,
      default: null,
    },
    cancellationReviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancellationReviewAction: {
      type: String,
      enum: ["", "approve", "reject"],
      default: "",
    },
    cancellationReviewNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "partial", "paid", "refunded"],
      default: "unpaid",
      index: true,
    },
    paymentAmountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    paymentAmountDue: {
      type: Number,
      default: 0,
      min: 0,
    },
    paymentCheckoutAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    paymentScope: {
      type: String,
      enum: ["downpayment", "full"],
      default: null,
    },
    paymentChannel: {
      type: String,
      enum: ["ewallet", "card"],
      default: null,
    },
    paymentMethod: {
      type: String,
      trim: true,
      default: null,
    },
    balancePaymentMethod: {
      type: String,
      trim: true,
      default: null,
    },
    walkInPaymentStatus: {
      type: String,
      enum: ["none", "requested", "approved", "rejected", "completed"],
      default: "none",
      index: true,
    },
    walkInRequestedAt: {
      type: Date,
      default: null,
    },
    walkInRequestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    walkInRequestNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    walkInReviewedAt: {
      type: Date,
      default: null,
    },
    walkInReviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    walkInReviewNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    walkInConfirmedAt: {
      type: Date,
      default: null,
    },
    walkInConfirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    walkInConfirmationNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    paymongoReference: {
      type: String,
      trim: true,
      default: null,
      index: true,
      sparse: true,
    },
    paymongoCheckoutId: {
      type: String,
      trim: true,
      default: null,
      index: true,
      sparse: true,
    },
    paymongoVerifiedCheckoutIds: {
      type: [String],
      default: [],
    },
    paymentCheckoutAttempt: {
      type: new mongoose.Schema({
        key: { type: String, required: true },
        request: { type: mongoose.Schema.Types.Mixed, required: true },
        createdAt: { type: Date, required: true },
      }, { _id: false }),
      default: null,
      select: false,
    },
    paymentRevision: { type: Number, default: 0 },
    paymentMutationToken: { type: String, select: false },
    paymentMutationUntil: { type: Date, select: false },
    paymentLastCheckedAt: { type: Date, default: null },
    paymentCheckoutClosedAt: { type: Date, default: null },
    paymentIntentId: {
      type: String,
      trim: true,
      default: null,
      index: true,
      sparse: true,
    },
    paymentRequestedAt: {
      type: Date,
      default: null,
    },
    paymentUpdatedAt: {
      type: Date,
      default: null,
    },
    manualPaymentUpdatedAt: { type: Date, default: null },
    manualPaymentUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    manualPaymentStatus: { type: String, enum: ["unpaid", "partial", "paid", "refunded", null], default: null },
    manualPaymentRevision: { type: Number, default: 0 },
    paidAt: {
      type: Date,
      default: null,
    },
    reviewRating: {
      type: Number,
      min: 1,
      max: 5,
    },
    reviewComment: {
      type: String,
      trim: true,
      maxlength: 1200,
    },
    reviewCreatedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// A checkout/return loaded before an owner's manual correction must not save
// its old payment snapshot over the correction after an asynchronous operation.
bookingSchema.post("init", function (booking) {
  booking.$locals.manualPaymentRevisionOnRead = Number(booking.manualPaymentRevision || 0);
  booking.$locals.paymentRevisionOnRead = Number(booking.paymentRevision || 0);
});
bookingSchema.pre("save", function () {
  if (this.isNew) return;
  const paymentFields = [
    "paymentStatus", "paymentAmountPaid", "paymentAmountDue", "paymentCheckoutAmount",
    "paymentMethod", "balancePaymentMethod", "walkInPaymentStatus", "totalAmount", "lateReturnPenaltyFee",
  ];
  if (!paymentFields.some((field) => this.isModified(field))) return;
  const revision = this.$locals.manualPaymentRevisionOnRead ?? Number(this.manualPaymentRevision || 0);
  this.$where = { ...this.$where, manualPaymentRevision: revision === 0 ? { $in: [0, null] } : revision };
  const paymentRevision = this.$locals.paymentRevisionOnRead ?? Number(this.paymentRevision || 0);
  this.$where.paymentRevision = paymentRevision === 0 ? { $in: [0, null] } : paymentRevision;
  this.$inc("paymentRevision", 1);
});
bookingSchema.post("save", function (booking) {
  booking.$locals.paymentRevisionOnRead = Number(booking.paymentRevision || 0);
});

bookingSchema.index({ vehicle: 1, pickupAt: 1, returnAt: 1 });
bookingSchema.index({ owner: 1, status: 1, createdAt: -1 });
bookingSchema.index({ renter: 1, createdAt: -1 });
// Tenant-scoped indexes for the paginated renter and owner booking work queues.
// Do not remove legacy indexes during application startup; validate their use in
// production with $indexStats before scheduling a separate migration.
bookingSchema.index({ renter: 1, status: 1, pickupAt: 1 });
bookingSchema.index({ renter: 1, status: 1, updatedAt: -1 });
bookingSchema.index({ owner: 1, status: 1, pickupAt: 1 });
bookingSchema.index({ owner: 1, status: 1, updatedAt: -1 });
bookingSchema.index({ owner: 1, updatedAt: -1 });
bookingSchema.index({ paymentStatus: 1, createdAt: -1 });
bookingSchema.index({ paymentLastCheckedAt: 1, _id: 1 }, {
  name: "payment_reconciliation_queue", partialFilterExpression: { paymongoCheckoutId: { $type: "string" } },
});
bookingSchema.index({ vehicle: 1, status: 1, actualReturnAt: 1 });
bookingSchema.index(
  { vehicle: 1, status: 1, reviewCreatedAt: -1 },
  { partialFilterExpression: { reviewRating: { $exists: true } } }
);

export default mongoose.model("Booking", bookingSchema);
