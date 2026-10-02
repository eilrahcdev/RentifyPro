export const BOOKING_STATUS_LABELS = {
  pending: "Pending", confirmed: "Confirmed", extended: "Extended",
  completed: "Completed", cancelled: "Cancelled", rejected: "Rejected",
};

export const bookingStatusLabel = (status) => BOOKING_STATUS_LABELS[String(status || "").toLowerCase()] || "Booking";

export const DOCUMENT_STATUS_LABELS = {
  queued: "Queued", processing: "Screening", retry_wait: "Retrying",
  pending_review: "Pending Review", verified: "Approved",
  reupload_required: "Needs a New Upload", rejected: "Not Approved",
};

export const documentStatusLabel = (status) => DOCUMENT_STATUS_LABELS[status] || "Not uploaded";

export function bookingGuidance(booking, perspective = "renter") {
  const owner = perspective === "owner";
  const status = String(booking?.status || "").toLowerCase();
  const returnStatus = booking?.returnStatus || booking?.returnRequest?.status || booking?.return_request?.status;
  if (returnStatus === "requested") return owner
    ? "Confirm receipt after the vehicle is returned, or decline the return request with an explanation."
    : "Waiting for the vehicle owner to confirm receipt of the returned vehicle.";
  if (returnStatus === "declined") return owner
    ? "The booking remains active. Review the handover with the renter before confirming a future return."
    : "The booking remains active. You can request return again when the handover is ready.";
  if (status === "pending") return owner
    ? "Review the rental dates, then approve or reject this booking request."
    : "Waiting for the vehicle owner to review your request. Payment becomes available after confirmation.";
  if (status === "rejected") return owner
    ? "You rejected this request. It will remain in booking history."
    : "The vehicle owner rejected this request. You can choose another vehicle or different rental dates.";
  if (status === "cancelled") return "This booking was cancelled. Payment and refund status are shown separately.";
  if (status === "completed") return booking?.paymentStatus === "paid"
    ? owner ? "Vehicle return confirmed and payment received. Complete inspection before making the vehicle available." : "Vehicle return confirmed and payment complete. You can now review your rental."
    : owner ? "Vehicle return confirmed. Check the remaining balance before closing payment follow-up." : "Vehicle return confirmed. Check and settle any remaining balance below.";
  if (["confirmed", "extended"].includes(status)) return booking?.paymentStatus === "unpaid"
    ? owner ? "Booking confirmed. Waiting for the renter to complete payment." : "Your booking is confirmed. Continue to payment below."
    : owner ? "Track payment and the scheduled return. The vehicle stays unavailable until receipt is confirmed." : "Follow your pickup and return schedule. Request a return when you hand the vehicle back.";
  return "";
}
