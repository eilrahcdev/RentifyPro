import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "extended"];

const hasUnreturnedBooking = async (vehicleId) => {
  const exists = await Booking.exists({
    vehicle: vehicleId,
    status: { $in: ACTIVE_BOOKING_STATUSES },
    actualReturnAt: null,
  });

  return Boolean(exists);
};

const isUnreturnedBooking = (booking) =>
  ACTIVE_BOOKING_STATUSES.includes(booking.status) && !booking.actualReturnAt;

export const hasActiveBookingForVehicle = async (vehicleId) => {
  if (!vehicleId) return false;
  if (await hasUnreturnedBooking(vehicleId)) return true;

  const vehicle = await Vehicle.findById(vehicleId).select("+bookingReservationId");
  if (!vehicle?.bookingReservationId) return false;
  const reservedBooking = await Booking.findById(vehicle.bookingReservationId).select("status actualReturnAt");
  return !reservedBooking || isUnreturnedBooking(reservedBooking);
};

export const syncVehicleAvailabilityByBookingState = async (vehicleId, { releaseReservationId = null } = {}) => {
  if (!vehicleId) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    // Read the reservation before checking bookings, then match it again on write.
    // A booking that has not been saved yet must still keep the vehicle reserved.
    const vehicle = await Vehicle.findById(vehicleId).select(
      "_id availabilityStatus availabilityHoldReason +bookingReservationId"
    );
    if (!vehicle) return null;

    const reservationId = vehicle.bookingReservationId || null;
    const hasActiveBooking = await hasUnreturnedBooking(vehicleId);
    const reservedBooking = reservationId
      ? await Booking.findById(reservationId).select("status actualReturnAt")
      : null;
    const releaseReservation = Boolean(reservationId) && (
      reservedBooking
        ? !isUnreturnedBooking(reservedBooking)
        : String(reservationId) === String(releaseReservationId)
    );
    const holdReason = vehicle.availabilityHoldReason || "none";
    const hasOwnerOrInspectionHold = ["manual", "inspection"].includes(holdReason);
    const nextStatus = hasActiveBooking || (reservationId && !releaseReservation) || hasOwnerOrInspectionHold
      ? "unavailable"
      : "available";

    if (vehicle.availabilityStatus === nextStatus && !releaseReservation) return nextStatus;

    const result = await Vehicle.updateOne(
      {
        _id: vehicleId,
        bookingReservationId: reservationId,
        availabilityStatus: vehicle.availabilityStatus,
        availabilityHoldReason: holdReason === "none" ? { $in: [null, "none"] } : holdReason,
      },
      {
        $set: { availabilityStatus: nextStatus },
        ...(releaseReservation ? { $unset: { bookingReservationId: "" } } : {}),
      }
    );
    if (result.matchedCount) return nextStatus;
  }

  return null;
};

