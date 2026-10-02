import crypto from "node:crypto";
import mongoose from "mongoose";

export const BOOKING_OWNER_REPORT_CATEGORIES = [
  "vehicle_misrepresented",
  "unsafe_vehicle",
  "booking_not_honored",
  "no_show",
  "undisclosed_charges",
  "payment_dispute",
  "off_platform_payment",
  "fraud",
  "harassment",
  "discrimination",
  "dangerous_conduct",
  "other",
];

export const BOOKING_RENTER_REPORT_CATEGORIES = [
  "no_show",
  "late_or_unreturned_vehicle",
  "vehicle_damage",
  "reckless_use",
  "prohibited_activity",
  "unauthorized_driver",
  "excessive_cleaning",
  "payment_dispute",
  "false_payment_evidence",
  "off_platform_payment",
  "fraud",
  "harassment",
  "dangerous_conduct",
  "other",
];

export const CHAT_MESSAGE_REPORT_CATEGORIES = [
  "harassment",
  "fraud",
  "discrimination",
  "identity_concern",
  "dangerous_conduct",
  "off_platform_payment",
  "spam",
  "sexual_content",
  "privacy_violation",
  "other",
];

export const REPORT_CATEGORIES = [
  ...new Set([
    ...BOOKING_OWNER_REPORT_CATEGORIES,
    ...BOOKING_RENTER_REPORT_CATEGORIES,
    ...CHAT_MESSAGE_REPORT_CATEGORIES,
  ]),
];

const evidenceSchema = new mongoose.Schema(
  {
    storageKey: { type: String, required: true, trim: true },
    originalName: { type: String, required: true, trim: true, maxlength: 180 },
    mimeType: { type: String, required: true, trim: true },
    size: { type: Number, required: true, min: 1 },
    sha256: { type: String, required: true, trim: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const activitySchema = new mongoose.Schema(
  {
    action: { type: String, required: true, trim: true, maxlength: 80 },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, trim: true, maxlength: 1000, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const informationResponseSchema = new mongoose.Schema(
  {
    statement: { type: String, required: true, trim: true, minlength: 20, maxlength: 2000 },
    evidenceIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    submittedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const reportSchema = new mongoose.Schema(
  {
    caseReference: { type: String, unique: true, index: true, trim: true },
    sourceType: { type: String, enum: ["booking", "chat_message"], default: "booking", index: true },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    reporterRole: { type: String, enum: ["user", "owner"], required: true },
    reportedRole: { type: String, enum: ["user", "owner"], required: true },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
      index: true,
      required() { return this.sourceType === "booking"; },
    },
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", default: null, index: true },
    reportedMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatMessage",
      default: null,
      index: true,
      required() { return this.sourceType === "chat_message"; },
    },
    messageSnapshot: {
      text: { type: String, trim: true, maxlength: 2000, default: "" },
      sentAt: { type: Date, default: null },
      editedAt: { type: Date, default: null },
      sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    category: { type: String, enum: REPORT_CATEGORIES, required: true, index: true },
    description: { type: String, required: true, trim: true, minlength: 20, maxlength: 3000 },
    evidence: { type: [evidenceSchema], default: [] },
    status: {
      type: String,
      enum: ["open", "investigating", "awaiting_information", "actioned", "dismissed", "appealed", "closed"],
      default: "open",
      index: true,
    },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal", index: true },
    priorityRank: { type: Number, min: 1, max: 4, default: 2, index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    currentDecision: { type: mongoose.Schema.Types.ObjectId, ref: "ModerationDecision", default: null },
    appeal: {
      submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      statement: { type: String, trim: true, maxlength: 2000, default: "" },
      submittedAt: { type: Date, default: null },
    },
    activity: { type: [activitySchema], default: [] },
    informationResponses: { type: [informationResponseSchema], default: [] },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

reportSchema.pre("validate", function () {
  if (!this.caseReference) {
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    this.caseReference = `RPT-${date}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  }
  this.priorityRank = { low: 1, normal: 2, high: 3, urgent: 4 }[this.priority] || 2;
});

reportSchema.index(
  { reporter: 1, booking: 1 },
  { unique: true, partialFilterExpression: { sourceType: "booking" }, name: "unique_booking_report" }
);
reportSchema.index(
  { reporter: 1, reportedMessage: 1 },
  { unique: true, partialFilterExpression: { sourceType: "chat_message" }, name: "unique_message_report" }
);
reportSchema.index({ status: 1, priorityRank: -1, createdAt: -1 });
reportSchema.index({ reportedUser: 1, createdAt: -1 });

export default mongoose.model("Report", reportSchema);
