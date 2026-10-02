import mongoose from "mongoose";

const vehicleSpecsSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      trim: true,
      default: "",
    },
    subType: {
      type: String,
      trim: true,
      default: "",
    },
    seats: {
      type: Number,
      min: 1,
      default: 4,
    },
    transmission: {
      type: String,
      trim: true,
      default: "Automatic",
    },
    fuel: {
      type: String,
      trim: true,
      default: "Gasoline",
    },
    plateNumber: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false }
);

const vehicleSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Vehicle name is required."],
      trim: true,
      maxlength: [120, "Vehicle name must be at most 120 characters."],
    },
    description: {
      type: String,
      required: [true, "Description is required."],
      trim: true,
      maxlength: [2000, "Description must be at most 2000 characters."],
    },
    dailyRentalRate: {
      type: Number,
      required: [true, "Hourly rental rate is required."],
      min: [0, "Hourly rental rate must be zero or greater."],
    },
    pricingUnit: {
      type: String,
      enum: ["hourly", "daily"],
      default: "hourly",
    },
    lateReturnFeeType: {
      type: String,
      enum: ["percentage", "fixed_hourly"],
      default: "percentage",
    },
    lateReturnFeeValue: {
      type: Number,
      min: [0, "Late-return fee value must be zero or greater."],
      default: 25,
    },
    lateReturnGraceMinutes: {
      type: Number,
      min: [0, "Late-return grace period must be zero or greater."],
      max: [1440, "Late-return grace period cannot exceed 1,440 minutes."],
      default: 0,
    },
    location: {
      type: String,
      required: [true, "Location is required."],
      trim: true,
      maxlength: [180, "Location must be at most 180 characters."],
    },
    availabilityStatus: {
      type: String,
      enum: ["available", "unavailable"],
      default: "available",
      index: true,
    },
    availabilityHoldReason: {
      type: String,
      enum: ["none", "manual", "inspection"],
      default: "none",
    },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (images) =>
          Array.isArray(images) &&
          images.length <= 8 &&
          images.every((image) => typeof image === "string" && image.length > 0 && image.length <= 2048),
        message: "Vehicles require between one and eight valid image references.",
      },
    },
    imageUrl: {
      type: String,
      trim: true,
      default: "",
    },
    imageReviews: {
      type: [{ path: String, exterior: Boolean, vehicleType: String, sourceId: mongoose.Schema.Types.ObjectId }],
      default: [],
    },
    coverDisplayMode: {
      type: String,
      enum: ["auto", "photo", "cutout"],
      default: "auto",
    },
    driverOptionEnabled: {
      type: Boolean,
      default: false,
    },
    driverDailyRate: {
      type: Number,
      min: [0, "Driver hourly rate must be zero or greater."],
      default: 0,
    },
    specs: {
      type: vehicleSpecsSchema,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

vehicleSchema.index({ owner: 1, createdAt: -1 });
vehicleSchema.index({ availabilityStatus: 1, createdAt: -1 });
vehicleSchema.index({ name: 1, createdAt: -1 });
vehicleSchema.index({ location: 1, createdAt: -1 });
vehicleSchema.index({ "specs.plateNumber": 1 });

export default mongoose.model("Vehicle", vehicleSchema);
