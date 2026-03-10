import mongoose from "mongoose";

<<<<<<< HEAD
=======
<<<<<<< HEAD
const vehicleSchema = new mongoose.Schema({
  name: String,
  type: String,
  pricePerDay: Number,
  available: { type: Boolean, default: true },
}, { timestamps: true });
=======
>>>>>>> 8422a2f (fixed bugs and updates)
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
      required: [true, "Daily rental rate is required."],
      min: [0, "Daily rental rate must be zero or greater."],
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
    images: {
      type: [String],
      default: [],
    },
    imageUrl: {
      type: String,
      trim: true,
      default: "",
    },
    driverOptionEnabled: {
      type: Boolean,
      default: false,
    },
    driverDailyRate: {
      type: Number,
      min: [0, "Driver daily rate must be zero or greater."],
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
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)

export default mongoose.model("Vehicle", vehicleSchema);
