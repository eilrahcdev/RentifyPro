import mongoose from "mongoose";

const loginActivitySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true }
);

loginActivitySchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("LoginActivity", loginActivitySchema);
