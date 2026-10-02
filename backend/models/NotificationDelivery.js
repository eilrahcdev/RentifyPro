import mongoose from "mongoose";

const notificationDeliverySchema = new mongoose.Schema(
  {
    notification: { type: mongoose.Schema.Types.ObjectId, ref: "Notification", required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    channel: { type: String, enum: ["email"], required: true, default: "email" },
    status: { type: String, enum: ["pending", "processing", "sent", "failed", "skipped"], default: "pending", index: true },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lockedUntil: { type: Date, default: null, index: true },
    sentAt: { type: Date, default: null },
    lastError: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: true }
);

notificationDeliverySchema.index({ status: 1, nextAttemptAt: 1, lockedUntil: 1 });

export default mongoose.model("NotificationDelivery", notificationDeliverySchema);
