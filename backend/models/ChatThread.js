import mongoose from "mongoose";

const chatThreadSchema = new mongoose.Schema(
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
    pinned: {
      type: Boolean,
      default: false,
      index: true,
    },
    pinnedAt: {
      type: Date,
      default: null,
    },
    lastOpenedAt: {
      type: Date,
      default: null,
    },
    archivedFor: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],
  },
  { timestamps: true }
);

chatThreadSchema.index({ owner: 1, renter: 1 }, { unique: true });
chatThreadSchema.index({ owner: 1, pinned: 1, pinnedAt: -1 });

export default mongoose.model("ChatThread", chatThreadSchema);
