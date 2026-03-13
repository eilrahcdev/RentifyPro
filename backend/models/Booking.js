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
    blockchainGasFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "completed", "cancelled", "rejected"],
      default: "pending",
      index: true,
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
    blockchainTxHash: {
      type: String,
      trim: true,
      default: null,
      index: true,
      sparse: true,
    },
    blockchainRecordedAt: {
      type: Date,
      default: null,
    },
    blockchain: {
      network: {
        type: String,
        trim: true,
        default: null,
      },
      chainId: {
        type: Number,
        default: null,
      },
      contractAddress: {
        type: String,
        trim: true,
        lowercase: true,
        default: null,
      },
      version: {
        type: String,
        trim: true,
        default: null,
      },
      bookingKey: {
        type: String,
        trim: true,
        default: null,
      },
      bookingHash: {
        type: String,
        trim: true,
        default: null,
      },
      renterIdHash: {
        type: String,
        trim: true,
        default: null,
      },
      ownerId: {
        type: String,
        trim: true,
        default: null,
      },
      amountInCents: {
        type: Number,
        default: null,
      },
      paymentStatus: {
        type: String,
        trim: true,
        default: null,
      },
      paymentStatusCode: {
        type: Number,
        default: null,
      },
      blockNumber: {
        type: Number,
        default: null,
      },
    },
  },
  { timestamps: true }
);

bookingSchema.index({ vehicle: 1, pickupAt: 1, returnAt: 1 });
bookingSchema.index({ owner: 1, status: 1, createdAt: -1 });
bookingSchema.index({ renter: 1, createdAt: -1 });
bookingSchema.index(
  { vehicle: 1, status: 1, reviewCreatedAt: -1 },
  { partialFilterExpression: { reviewRating: { $exists: true } } }
);

export default mongoose.model("Booking", bookingSchema);
