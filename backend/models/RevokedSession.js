import mongoose from "mongoose";

const revokedSessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

revokedSessionSchema.index({ tokenHash: 1 });
revokedSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("RevokedSession", revokedSessionSchema);
