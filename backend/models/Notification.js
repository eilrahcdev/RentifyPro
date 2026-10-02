import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["booking_status", "booking_payment", "chat_message", "system"],
      default: "system",
      index: true,
    },
    category: {
      type: String,
      enum: ["booking", "payment", "chat", "system"],
      default: "system",
      index: true,
    },
    event: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "normal", "important", "urgent"],
      default: "normal",
      index: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    entityType: {
      type: String,
      trim: true,
      maxlength: 60,
      default: "",
    },
    entityId: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
      index: true,
    },
    actionUrl: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    dedupeKey: {
      type: String,
      trim: true,
      maxlength: 220,
      default: "",
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    readAt: {
      type: Date,
      default: null,
    },
    archived_at: {
      type: Date,
      default: null,
      index: true,
    },
    lastOccurredAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, archived_at: 1, lastOccurredAt: -1, _id: -1 });
notificationSchema.index({ user: 1, archived_at: 1, readAt: 1, lastOccurredAt: -1 });
notificationSchema.index(
  { user: 1, dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupeKey: { $exists: true, $gt: "" } },
  }
);
notificationSchema.index({ user: 1, category: 1, readAt: 1, lastOccurredAt: -1 });
notificationSchema.index({ entityType: 1, entityId: 1, lastOccurredAt: -1 });

export default mongoose.model("Notification", notificationSchema);

