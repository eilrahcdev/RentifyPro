export const NOTIFICATION_EVENTS = Object.freeze({
  BOOKING_CREATED: "booking.created",
  BOOKING_CANCELLED: "booking.cancelled",
  BOOKING_APPROVED: "booking.approved",
  BOOKING_REJECTED: "booking.rejected",
  BOOKING_STATUS_UPDATED: "booking.status_updated",
  BOOKING_OVERDUE: "booking.overdue",
  BOOKING_COMPLETED: "booking.completed",
  LATE_RETURN_PROCESSED: "late_return.processed",
  VEHICLE_RETURN_REQUESTED: "vehicle_return.requested",
  VEHICLE_RETURN_CONFIRMED: "vehicle_return.confirmed",
  VEHICLE_RETURN_DECLINED: "vehicle_return.declined",

  CANCELLATION_REQUESTED: "cancellation.requested",
  CANCELLATION_APPROVED: "cancellation.approved",
  CANCELLATION_REJECTED: "cancellation.rejected",

  EXTENSION_REQUESTED: "extension.requested",
  EXTENSION_APPROVED: "extension.approved",
  EXTENSION_REJECTED: "extension.rejected",

  PAYMENT_RECEIVED: "payment.received",
  PAYMENT_STATUS_UPDATED: "payment.status_updated",
  WALKIN_PAYMENT_REQUESTED: "walkin_payment.requested",
  WALKIN_PAYMENT_APPROVED: "walkin_payment.approved",
  WALKIN_PAYMENT_REJECTED: "walkin_payment.rejected",
  WALKIN_PAYMENT_CONFIRMED: "walkin_payment.confirmed",

  CHAT_MESSAGE_RECEIVED: "chat.message_received",

  REVIEW_CREATED: "review.created",
});

export default NOTIFICATION_EVENTS;
