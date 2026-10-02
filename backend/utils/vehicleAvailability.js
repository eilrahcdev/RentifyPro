import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "extended"];

export const hasActiveBookingForVehicle = async (vehicleId) => {
  if (!vehicleId) return false;

  const exists = await Booking.exists({
    vehicle: vehicleId,
    status: { $in: ACTIVE_BOOKING_STATUSES },
    actualReturnAt: null,
  });

  return Boolean(exists);
};

export const syncVehicleAvailabilityByBookingState = async (vehicleId) => {
  if (!vehicleId) return null;

  const hasActiveBooking = await hasActiveBookingForVehicle(vehicleId);
  const vehicle = await Vehicle.findById(vehicleId).select("_id availabilityStatus availabilityHoldReason");
  if (!vehicle) return null;

  const hasOwnerOrInspectionHold = ["manual", "inspection"].includes(
    String(vehicle.availabilityHoldReason || "none").toLowerCase()
  );
  const nextStatus = hasActiveBooking || hasOwnerOrInspectionHold ? "unavailable" : "available";

  if (vehicle.availabilityStatus !== nextStatus) {
    vehicle.availabilityStatus = nextStatus;
    await vehicle.save();
  }

  return nextStatus;
};

