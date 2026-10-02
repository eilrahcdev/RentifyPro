import mongoose from "mongoose";

const sanctionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    report: { type: mongoose.Schema.Types.ObjectId, ref: "Report", required: true, index: true },
    decision: { type: mongoose.Schema.Types.ObjectId, ref: "ModerationDecision", required: true, unique: true },
    type: {
      type: String,
      enum: [
        "warning",
        "booking_restriction",
        "listing_restriction",
        "chat_restriction",
        "temporary_suspension",
        "permanent_ban",
        "kyc_reverification",
        "vehicle_delisting",
      ],
      required: true,
      index: true,
    },
    scope: { type: String, enum: ["account", "renter", "owner", "chat", "vehicle"], required: true },
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", default: null },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    startsAt: { type: Date, default: Date.now },
    endsAt: { type: Date, default: null, index: true },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    revokedAt: { type: Date, default: null, index: true },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    revokeReason: { type: String, trim: true, maxlength: 1000, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

sanctionSchema.index({ user: 1, revokedAt: 1, endsAt: 1 });

export default mongoose.model("Sanction", sanctionSchema);
