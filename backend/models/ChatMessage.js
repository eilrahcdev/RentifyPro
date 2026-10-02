import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    renter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
      index: true,
    },
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      default: null,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    attachments: {
      type: [String],
      default: [],
    },
    editedAt: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    hiddenFor: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [],
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

chatMessageSchema.index({ owner: 1, renter: 1, createdAt: -1 });
chatMessageSchema.index({ owner: 1, renter: 1, vehicle: 1, createdAt: -1 });
chatMessageSchema.index({ owner: 1, renter: 1, booking: 1, createdAt: -1 });
chatMessageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });

export default mongoose.model("ChatMessage", chatMessageSchema);

