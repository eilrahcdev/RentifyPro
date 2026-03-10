import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed"];

export const hasActiveBookingForVehicle = async (vehicleId) => {
  if (!vehicleId) return false;

  const now = new Date();
  const exists = await Booking.exists({
    vehicle: vehicleId,
    status: { $in: ACTIVE_BOOKING_STATUSES },
    returnAt: { $gt: now },
  });

  return Boolean(exists);
};

export const syncVehicleAvailabilityByBookingState = async (vehicleId) => {
  if (!vehicleId) return null;

  const hasActiveBooking = await hasActiveBookingForVehicle(vehicleId);
  const nextStatus = hasActiveBooking ? "unavailable" : "available";

  const vehicle = await Vehicle.findById(vehicleId).select("_id availabilityStatus");
  if (!vehicle) return null;

  if (vehicle.availabilityStatus !== nextStatus) {
    vehicle.availabilityStatus = nextStatus;
    await vehicle.save();
  }

  return nextStatus;
};

