import mongoose from "mongoose";

const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  vehicleType: { type: String, enum: ["car", "motorcycle", "van", "truck"], required: true },
  key: { type: String, required: true },
  hash: { type: String, required: true },
  status: { type: String, enum: ["processing", "approved", "rejected", "needs_review"], default: "processing", index: true },
  exterior: { type: Boolean, default: false },
  reason: { type: String, maxlength: 500, default: "" },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  reviewedAt: Date,
}, { timestamps: true });
schema.index({ owner: 1, hash: 1, vehicleType: 1 }, { unique: true });
export default mongoose.model("VehiclePhoto", schema);
