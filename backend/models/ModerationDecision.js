import mongoose from "mongoose";

const moderationDecisionSchema = new mongoose.Schema(
  {
    report: { type: mongoose.Schema.Types.ObjectId, ref: "Report", required: true, index: true },
    sequence: { type: Number, required: true, min: 1 },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    outcome: { type: String, enum: ["dismissed", "violation_confirmed"], required: true },
    action: {
      type: String,
      enum: [
        "none",
        "warning",
        "booking_restriction",
        "listing_restriction",
        "chat_restriction",
        "temporary_suspension",
        "permanent_ban",
        "kyc_reverification",
        "vehicle_delisting",
      ],
      default: "none",
    },
    policyReason: { type: String, required: true, trim: true, maxlength: 1000 },
    userVisibleReason: { type: String, required: true, trim: true, maxlength: 1000 },
    internalNote: { type: String, trim: true, maxlength: 2000, default: "" },
    durationDays: { type: Number, min: 1, max: 365, default: null },
  },
  { timestamps: true }
);

moderationDecisionSchema.index({ report: 1, sequence: 1 }, { unique: true });

export default mongoose.model("ModerationDecision", moderationDecisionSchema);
