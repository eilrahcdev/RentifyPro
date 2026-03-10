import mongoose from "mongoose";

const vehicleSchema = new mongoose.Schema({
  name: String,
  type: String,
  pricePerDay: Number,
  available: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model("Vehicle", vehicleSchema);
