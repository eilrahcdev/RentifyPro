import { getDurationHoursFromMinutes, getDurationMinutes, getVehicleHourlyRate, roundCurrency } from "./pricing.js";

export const RENTAL_ENTITY_KEYS = ["duration_value", "duration_unit", "sort_by", "quote_requested",
  "driver_requested", "listing_id", "requested_date", "requested_return_date", "pickup_time", "return_time"];

export const isPublicListingId = (value) => typeof value === "string" && /^[a-f0-9]{24}$/u.test(value);

export function validRentalEntities(value) {
  const amount = value.duration_value;
  const unit = value.duration_unit;
  if ((amount === undefined) !== (unit === undefined)) return false;
  if (amount !== undefined && (typeof amount !== "number" || !Number.isFinite(amount)
    || !["day", "hour"].includes(unit) || amount <= 0 || amount > (unit === "day" ? 365 : 8760)
    || !Number.isInteger(amount * (unit === "day" ? 1440 : 60)))) return false;
  if (value.sort_by !== undefined && value.sort_by !== "lowest_price") return false;
  for (const key of ["quote_requested", "driver_requested"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") return false;
  }
  if (value.listing_id !== undefined && !isPublicListingId(value.listing_id)) return false;
  for (const key of ["requested_date", "requested_return_date"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value[key])
      || !Number.isFinite(Date.parse(value[key])) || new Date(value[key]).toISOString().slice(0, 10) !== value[key])) return false;
  }
  for (const key of ["pickup_time", "return_time"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value[key]))) return false;
  }
  return true;
}

export function getChatbotQuoteDurationMinutes(entities) {
  if (!validRentalEntities(entities)) return 0;
  const explicit = entities.duration_value ? entities.duration_value * (entities.duration_unit === "day" ? 1440 : 60) : 0;
  const hasSchedule = entities.requested_date && entities.requested_return_date && entities.pickup_time && entities.return_time;
  const scheduled = hasSchedule
    ? getDurationMinutes(`${entities.requested_date}T${entities.pickup_time}:00+08:00`, `${entities.requested_return_date}T${entities.return_time}:00+08:00`) : 0;
  if (hasSchedule && (scheduled <= 0 || (explicit && explicit !== scheduled))) return 0;
  const minutes = explicit || scheduled;
  return minutes > 0 && minutes <= 365 * 1440 ? minutes : 0;
}

export function getChatbotScheduleRange(entities) {
  if (!validRentalEntities(entities) || !entities.requested_date || !entities.requested_return_date
    || !entities.pickup_time || !entities.return_time || !getChatbotQuoteDurationMinutes(entities)) return null;
  return { pickupAt: new Date(`${entities.requested_date}T${entities.pickup_time}:00+08:00`),
    returnAt: new Date(`${entities.requested_return_date}T${entities.return_time}:00+08:00`) };
}

export function getChatbotRentalQuote(vehicle, entities) {
  const durationMinutes = getChatbotQuoteDurationMinutes(entities);
  if (!durationMinutes) return null;
  if (typeof vehicle.dailyRentalRate !== "number" || !Number.isFinite(vehicle.dailyRentalRate)
    || vehicle.dailyRentalRate < 0 || !["hourly", "daily"].includes(vehicle.pricingUnit)) return null;
  if (entities.driver_requested && (vehicle.driverOptionEnabled !== true
    || typeof vehicle.driverDailyRate !== "number" || !Number.isFinite(vehicle.driverDailyRate)
    || vehicle.driverDailyRate < 0)) return null;
  const durationHours = getDurationHoursFromMinutes(durationMinutes);
  // Booking creation rounds the hourly rate before multiplying the rental hours.
  const baseRental = roundCurrency(getVehicleHourlyRate(vehicle) * durationHours);
  const driverCharge = entities.driver_requested
    ? roundCurrency(getVehicleHourlyRate(vehicle, { rateField: "driverDailyRate" }) * durationHours) : 0;
  return { durationHours, baseRental, driverCharge, rentalSubtotal: roundCurrency(baseRental + driverCharge) };
}
