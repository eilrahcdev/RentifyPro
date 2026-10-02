import eventBus from "../events/eventBus.js";
import { NOTIFICATION_EVENTS } from "../events/notification.events.js";
import NotificationService from "../services/notification.service.js";
import {
  getBookingLateReturnPenaltyRatePerHour,
  getBookingLateReturnPolicy,
  getEstimatedLateReturnPenaltyFee,
} from "../utils/lateReturnPolicy.js";
import { roundCurrency } from "../utils/pricing.js";

let registered = false;

const toIdString = (value) => {
  if (!value) return "";
  return String(value?._id || value);
};

const toOptionalText = (value) => String(value || "").trim();

const displayName = (value, fallback = "Someone") =>
  toOptionalText(value?.name || value?.fullName || value?.email) || fallback;

const statusLabel = (value) => toOptionalText(value).replace(/_/g, " ") || "updated";

const getBooking = (payload = {}) => payload.booking || {};
const getBookingId = (payload = {}) => toIdString(payload.bookingId || getBooking(payload)._id);
const getVehicleId = (payload = {}) =>
  toIdString(payload.vehicleId || payload.vehicle?._id || getBooking(payload).vehicle?._id || getBooking(payload).vehicle);
const getVehicleName = (payload = {}) =>
  toOptionalText(payload.vehicleName || payload.vehicle?.name || getBooking(payload).vehicle?.name) || "a vehicle";
const getOwnerId = (payload = {}) =>
  toIdString(payload.ownerId || getBooking(payload).owner?._id || getBooking(payload).owner);
const getRenterId = (payload = {}) =>
  toIdString(payload.renterId || getBooking(payload).renter?._id || getBooking(payload).renter);

const peso = (value) =>
  `₱${Math.max(0, Number(value || 0)).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const durationLabel = (value) => {
  const minutes = Math.max(0, Math.round(Number(value || 0)));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours && remainder) return `${hours}h ${remainder}m`;
  if (hours) return `${hours}h`;
  return `${remainder}m`;
};

const getLateReturnPaymentData = (payload = {}, { final = false } = {}) => {
  const booking = getBooking(payload);
  const overdueMinutes = Math.max(
    0,
    Math.round(Number(payload.overdueMinutes ?? booking.lateReturnOverdueMinutes ?? 0))
  );
  const penaltyRatePerHour = getBookingLateReturnPenaltyRatePerHour(booking);
  const lateReturnPenaltyFee = final
    ? roundCurrency(Number(payload.lateReturnPenaltyFee ?? booking.lateReturnPenaltyFee ?? 0))
    : getEstimatedLateReturnPenaltyFee(booking);
  const lateReturnPolicy = getBookingLateReturnPolicy(booking);
  const rentalAmount = roundCurrency(Math.max(0, Number(booking.totalAmount || 0)));
  const transactionFee = roundCurrency(Math.max(0, Number(booking.transactionFee || 0)));
  const totalAmountPayable = roundCurrency(rentalAmount + Math.max(0, lateReturnPenaltyFee) + transactionFee);
  const paymentAmountPaid = roundCurrency(Math.max(0, Number(booking.paymentAmountPaid || 0)));
  const persistedDue = Number(booking.paymentAmountDue);
  const remainingBalance = final && Number.isFinite(persistedDue)
    ? roundCurrency(Math.max(0, persistedDue))
    : roundCurrency(Math.max(0, totalAmountPayable - paymentAmountPaid));

  return {
    vehicleName: getVehicleName(payload),
    scheduledReturnAt: booking.returnAt || null,
    actualReturnAt: booking.actualReturnAt || null,
    overdueMinutes,
    graceMinutes: lateReturnPolicy.graceMinutes,
    lateReturnPenaltyRatePerHour: penaltyRatePerHour,
    ...(final
      ? { lateReturnPenaltyFee: Math.max(0, lateReturnPenaltyFee) }
      : { estimatedLateReturnPenaltyFee: Math.max(0, lateReturnPenaltyFee) }),
    feeStatus: final ? "final" : "estimated",
    rentalAmount,
    transactionFee,
    totalAmountPayable,
    paymentAmountPaid,
    remainingBalance,
    paymentStatus: String(booking.paymentStatus || "unpaid").trim().toLowerCase(),
    paymentLocation: "My Bookings",
    paymentAction: final ? "Pay Remaining" : "Pay Remaining after the owner confirms receipt",
  };
};

const notificationKey = (recipientId, eventName, entityId, suffix = "") => {
  const recipient = toIdString(recipientId);
  const entity = toIdString(entityId);
  if (!recipient || !eventName || !entity) return "";
  return [recipient, eventName, entity, suffix].filter(Boolean).join(":");
};

const bookingData = (payload = {}, extra = {}) => ({
  bookingId: getBookingId(payload),
  vehicleId: getVehicleId(payload) || null,
  ...extra,
});

const sendBookingNotification = (payload, recipientId, eventName, notification) => {
  const bookingId = getBookingId(payload);
  return NotificationService.send({
    user: recipientId,
    type: "booking_status",
    category: "booking",
    event: eventName,
    entityType: "booking",
    entityId: bookingId,
    dedupeKey: notificationKey(recipientId, eventName, bookingId, notification.dedupeSuffix),
    ...notification,
  });
};

const sendPaymentNotification = (payload, recipientId, eventName, notification) => {
  const bookingId = getBookingId(payload);
  return NotificationService.send({
    user: recipientId,
    type: "booking_payment",
    category: "payment",
    event: eventName,
    priority: "important",
    entityType: "booking",
    entityId: bookingId,
    dedupeKey: notificationKey(recipientId, eventName, bookingId, notification.dedupeSuffix),
    ...notification,
  });
};

const subscribe = (eventName, handler) => {
  eventBus.on(eventName, (payload) => {
    Promise.resolve(handler(payload)).catch((error) => {
      console.error(`[notification-handler] ${eventName} failed:`, error?.message || error);
    });
  });
};

const handleBookingCreated = async (payload = {}) => {
  const ownerId = getOwnerId(payload);
  const actorName = displayName(payload.actor || payload.renter, "A renter");

  await sendBookingNotification(payload, ownerId, NOTIFICATION_EVENTS.BOOKING_CREATED, {
    title: "New booking request",
    message: `${actorName} requested to book ${getVehicleName(payload)}.`,
    data: bookingData(payload, { status: "pending" }),
  });
};

const handleBookingCancelled = async (payload = {}) => {
  const cancelledBy = toOptionalText(payload.cancelledBy).toLowerCase();
  const recipientId = toIdString(payload.recipientId) || (cancelledBy === "owner" ? getRenterId(payload) : getOwnerId(payload));
  const message =
    cancelledBy === "owner" ? "Your booking was cancelled by the owner." : "A renter cancelled a booking.";

  await sendBookingNotification(payload, recipientId, NOTIFICATION_EVENTS.BOOKING_CANCELLED, {
    title: "Booking cancelled",
    message,
    data: bookingData(payload, { status: "cancelled", cancelledBy: cancelledBy || "renter" }),
  });
};

const handleCancellationRequested = async (payload = {}) => {
  const actorName = displayName(payload.actor || payload.renter, "A renter");
  await sendBookingNotification(payload, getOwnerId(payload), NOTIFICATION_EVENTS.CANCELLATION_REQUESTED, {
    title: "Cancellation request received",
    message: `${actorName} requested to cancel a booking for ${getVehicleName(payload)}.`,
    data: bookingData(payload, {
      status: payload.status || getBooking(payload).status,
      cancellationStatus: "requested",
    }),
  });
};

const handleCancellationApproved = async (payload = {}) => {
  await sendBookingNotification(payload, getRenterId(payload), NOTIFICATION_EVENTS.CANCELLATION_APPROVED, {
    title: "Cancellation approved",
    message: "The owner approved your cancellation request. Your booking is now cancelled.",
    data: bookingData(payload, {
      status: "cancelled",
      cancellationStatus: "approved",
    }),
  });
};

const handleCancellationRejected = async (payload = {}) => {
  await sendBookingNotification(payload, getRenterId(payload), NOTIFICATION_EVENTS.CANCELLATION_REJECTED, {
    title: "Cancellation request rejected",
    message: "The owner did not approve your cancellation request. Your booking remains active.",
    data: bookingData(payload, {
      status: payload.status || getBooking(payload).status,
      cancellationStatus: "rejected",
    }),
  });
};

const handleBookingApproved = async (payload = {}) => {
  await sendBookingNotification(payload, getRenterId(payload), NOTIFICATION_EVENTS.BOOKING_APPROVED, {
    title: "Booking approved",
    message: "Your booking request was approved.",
    data: bookingData(payload, { status: "confirmed" }),
  });
};

const handleBookingRejected = async (payload = {}) => {
  await sendBookingNotification(payload, getRenterId(payload), NOTIFICATION_EVENTS.BOOKING_REJECTED, {
    title: "Booking rejected",
    message: "Your booking request was rejected.",
    data: bookingData(payload, { status: "rejected" }),
  });
};

const handleBookingStatusUpdated = async (payload = {}) => {
  const status = statusLabel(payload.status || getBooking(payload).status);
  await sendBookingNotification(payload, toIdString(payload.recipientId) || getRenterId(payload), NOTIFICATION_EVENTS.BOOKING_STATUS_UPDATED, {
    title: "Booking status updated",
    message: `Your booking is now ${status}.`,
    dedupeSuffix: status,
    data: bookingData(payload, { status: payload.status || getBooking(payload).status }),
  });
};

const handleBookingOverdue = async (payload = {}) => {
  const lateReturnData = getLateReturnPaymentData(payload);
  const { overdueMinutes, lateReturnPenaltyRatePerHour, estimatedLateReturnPenaltyFee, vehicleName } = lateReturnData;
  const data = bookingData(payload, {
    status: payload.status || getBooking(payload).status,
    isOverdue: true,
    ...lateReturnData,
  });

  await NotificationService.sendMany([
    {
      user: getRenterId(payload),
      type: "booking_status",
      category: "booking",
      event: NOTIFICATION_EVENTS.BOOKING_OVERDUE,
      priority: "urgent",
      title: "Late return detected",
      message: `Your ${vehicleName} booking is overdue by ${durationLabel(overdueMinutes)}. The current estimated late fee is ${peso(estimatedLateReturnPenaltyFee)} at ${peso(lateReturnPenaltyRatePerHour)} per overdue hour. The estimate continues until the owner confirms receipt. Open My Bookings to request an extension or vehicle return; any final balance can be paid there using Pay Remaining.`,
      entityType: "booking",
      entityId: getBookingId(payload),
      dedupeKey: notificationKey(getRenterId(payload), NOTIFICATION_EVENTS.BOOKING_OVERDUE, getBookingId(payload)),
      data: { ...data, actions: ["extend_rental", "request_vehicle_return"] },
    },
    {
      user: getOwnerId(payload),
      type: "booking_status",
      category: "booking",
      event: NOTIFICATION_EVENTS.BOOKING_OVERDUE,
      priority: "urgent",
      title: "Vehicle return is overdue",
      message: `${vehicleName} is overdue by ${durationLabel(overdueMinutes)}. The current estimated late fee is ${peso(estimatedLateReturnPenaltyFee)} at ${peso(lateReturnPenaltyRatePerHour)} per overdue hour and continues until receipt is confirmed.`,
      entityType: "booking",
      entityId: getBookingId(payload),
      dedupeKey: notificationKey(getOwnerId(payload), NOTIFICATION_EVENTS.BOOKING_OVERDUE, getBookingId(payload)),
      data,
    },
  ]);
};

const handleBookingCompleted = async (payload = {}) => {
  const data = bookingData(payload, {
    status: "completed",
    autoCompleted: Boolean(payload.autoCompleted),
  });

  await NotificationService.sendMany([
    {
      user: getRenterId(payload),
      type: "booking_status",
      category: "booking",
      event: NOTIFICATION_EVENTS.BOOKING_COMPLETED,
      title: payload.autoCompleted ? "Booking completed automatically" : "Booking completed",
      message: payload.autoCompleted
        ? "Your rental duration ended and the booking status was updated to completed."
        : "Your booking was marked as completed.",
      entityType: "booking",
      entityId: getBookingId(payload),
      dedupeKey: notificationKey(getRenterId(payload), NOTIFICATION_EVENTS.BOOKING_COMPLETED, getBookingId(payload)),
      data,
    },
    {
      user: getOwnerId(payload),
      type: "booking_status",
      category: "booking",
      event: NOTIFICATION_EVENTS.BOOKING_COMPLETED,
      title: payload.autoCompleted ? "Booking completed automatically" : "Booking completed",
      message: payload.autoCompleted
        ? "A rental duration ended and the booking was auto-completed."
        : "A booking was marked as completed.",
      entityType: "booking",
      entityId: getBookingId(payload),
      dedupeKey: notificationKey(getOwnerId(payload), NOTIFICATION_EVENTS.BOOKING_COMPLETED, getBookingId(payload)),
      data,
    },
  ]);
};

const handleLateReturnProcessed = async (payload = {}) => {
  const lateReturnData = getLateReturnPaymentData(payload, { final: true });
  const { overdueMinutes, lateReturnPenaltyFee, remainingBalance, vehicleName } = lateReturnData;
  const actorName = displayName(payload.actor || payload.renter, "Your renter");
  const data = bookingData(payload, {
    status: payload.status || getBooking(payload).status || "completed",
    ...lateReturnData,
  });

  await NotificationService.sendMany([
    {
      user: getOwnerId(payload),
      type: "booking_status",
      category: "booking",
      event: NOTIFICATION_EVENTS.LATE_RETURN_PROCESSED,
      title: "Late return processed",
      message:
        lateReturnPenaltyFee > 0
          ? `${actorName} completed the late return for ${vehicleName}. A final fee of ${peso(lateReturnPenaltyFee)} was added; the booking has ${peso(remainingBalance)} remaining.`
          : `${actorName} confirmed vehicle return.`,
      entityType: "booking",
      entityId: getBookingId(payload),
      dedupeKey: notificationKey(getOwnerId(payload), NOTIFICATION_EVENTS.LATE_RETURN_PROCESSED, getBookingId(payload)),
      data,
    },
    {
      user: getRenterId(payload),
      type: "booking_status",
      category: "booking",
      event: NOTIFICATION_EVENTS.LATE_RETURN_PROCESSED,
      title: "Late return confirmed",
      message:
        lateReturnPenaltyFee > 0
          ? `Your ${vehicleName} late return was finalized with a ${peso(lateReturnPenaltyFee)} fee. Your remaining booking balance is ${peso(remainingBalance)}. Pay online from My Bookings using Pay Remaining, or request walk-in payment there for owner approval.`
          : "Your return was confirmed successfully.",
      entityType: "booking",
      entityId: getBookingId(payload),
      dedupeKey: notificationKey(getRenterId(payload), NOTIFICATION_EVENTS.LATE_RETURN_PROCESSED, getBookingId(payload)),
      data,
    },
  ]);
};

const handleVehicleReturnRequested = async (payload = {}) => {
  const actorName = displayName(payload.actor || payload.renter, "A renter");
  const occurrence = toOptionalText(getBooking(payload).returnRequestedAt);
  await sendBookingNotification(
    payload,
    getOwnerId(payload),
    NOTIFICATION_EVENTS.VEHICLE_RETURN_REQUESTED,
    {
      title: "Vehicle return requested",
      message: `${actorName} reported that the vehicle is ready to be returned. Confirm only after receiving it.`,
      dedupeSuffix: occurrence,
      data: bookingData(payload, {
        status: payload.status || getBooking(payload).status,
        returnStatus: "requested",
        returnRequestedAt: getBooking(payload).returnRequestedAt,
      }),
    }
  );
};

const handleVehicleReturnConfirmed = async (payload = {}) => {
  const lateReturnData = getLateReturnPaymentData(payload, { final: true });
  const { overdueMinutes, lateReturnPenaltyFee, remainingBalance, vehicleName } = lateReturnData;
  const occurrence = toOptionalText(getBooking(payload).returnRequestedAt);
  await NotificationService.sendMany([
    {
      user: getRenterId(payload),
      type: lateReturnPenaltyFee > 0 ? "booking_payment" : "booking_status",
      category: lateReturnPenaltyFee > 0 ? "payment" : "booking",
      event: NOTIFICATION_EVENTS.VEHICLE_RETURN_CONFIRMED,
      priority: lateReturnPenaltyFee > 0 ? "important" : "normal",
      title: lateReturnPenaltyFee > 0 ? "Late-return fee ready for payment" : "Vehicle return confirmed",
      message:
        lateReturnPenaltyFee > 0
          ? `The owner confirmed receipt of ${vehicleName}. Your final late-return fee is ${peso(lateReturnPenaltyFee)} and your remaining booking balance is ${peso(remainingBalance)}. Open My Bookings and select Pay Remaining to pay online, or request walk-in payment for owner approval.`
          : "The owner confirmed receipt of the vehicle.",
      entityType: "booking",
      entityId: getBookingId(payload),
      dedupeKey: notificationKey(getRenterId(payload), NOTIFICATION_EVENTS.VEHICLE_RETURN_CONFIRMED, getBookingId(payload), occurrence),
      data: bookingData(payload, {
        status: "completed",
        returnStatus: "confirmed",
        ...lateReturnData,
      }),
    },
    {
      user: getOwnerId(payload),
      type: "booking_status",
      category: "booking",
      event: NOTIFICATION_EVENTS.VEHICLE_RETURN_CONFIRMED,
      title: "Vehicle under inspection/maintenance",
      message:
        lateReturnPenaltyFee > 0
          ? `${vehicleName} was returned ${durationLabel(overdueMinutes)} late. The final late-return fee is ${peso(lateReturnPenaltyFee)}, and the renter has ${peso(remainingBalance)} remaining. Inspect or service the vehicle, then mark it available when rental-ready.`
          : "The return is complete. Inspect or service the vehicle, then mark it available when it is rental-ready.",
      entityType: "booking",
      entityId: getBookingId(payload),
      dedupeKey: notificationKey(getOwnerId(payload), NOTIFICATION_EVENTS.VEHICLE_RETURN_CONFIRMED, getBookingId(payload), occurrence),
      data: bookingData(payload, {
        status: "completed",
        returnStatus: "confirmed",
        ...lateReturnData,
      }),
    },
  ]);
};

const handleVehicleReturnDeclined = async (payload = {}) => {
  const occurrence = toOptionalText(getBooking(payload).returnRequestedAt);
  await NotificationService.sendMany([
    {
      user: getRenterId(payload),
      type: "booking_status",
      category: "booking",
      event: NOTIFICATION_EVENTS.VEHICLE_RETURN_DECLINED,
      priority: "important",
      title: "Vehicle return request declined",
      message: "The owner has not confirmed receipt of the vehicle. Your booking remains active and you may request return again when the handover is ready.",
      entityType: "booking",
      entityId: getBookingId(payload),
      dedupeKey: notificationKey(getRenterId(payload), NOTIFICATION_EVENTS.VEHICLE_RETURN_DECLINED, getBookingId(payload), occurrence),
      data: bookingData(payload, {
        status: getBooking(payload).status,
        returnStatus: "declined",
      }),
    },
    {
      user: getOwnerId(payload),
      type: "booking_status",
      category: "booking",
      event: NOTIFICATION_EVENTS.VEHICLE_RETURN_DECLINED,
      title: "Vehicle return request declined",
      message: "The return request was declined and the rental remains active.",
      entityType: "booking",
      entityId: getBookingId(payload),
      dedupeKey: notificationKey(getOwnerId(payload), NOTIFICATION_EVENTS.VEHICLE_RETURN_DECLINED, getBookingId(payload), occurrence),
      data: bookingData(payload, {
        status: getBooking(payload).status,
        returnStatus: "declined",
      }),
    },
  ]);
};

const handleExtensionRequested = async (payload = {}) => {
  const actorName = displayName(payload.actor || payload.renter, "A renter");
  await sendBookingNotification(payload, getOwnerId(payload), NOTIFICATION_EVENTS.EXTENSION_REQUESTED, {
    title: "Extension request received",
    message: `${actorName} requested to extend the booking schedule.`,
    data: bookingData(payload, {
      status: payload.status || getBooking(payload).status,
      extensionStatus: "requested",
      requestedReturnAt: payload.requestedReturnAt || getBooking(payload).extensionRequestedReturnAt,
    }),
  });
};

const handleExtensionApproved = async (payload = {}) => {
  await sendBookingNotification(payload, getRenterId(payload), NOTIFICATION_EVENTS.EXTENSION_APPROVED, {
    title: "Extension approved",
    message: "Your extension request was approved. Booking schedule and price were updated.",
    data: bookingData(payload, {
      status: payload.status || getBooking(payload).status,
      extensionStatus: "approved",
      returnAt: payload.returnAt || getBooking(payload).returnAt,
    }),
  });
};

const handleExtensionRejected = async (payload = {}) => {
  await sendBookingNotification(payload, getRenterId(payload), NOTIFICATION_EVENTS.EXTENSION_REJECTED, {
    title: "Extension rejected",
    message: "Your extension request was rejected. The original booking schedule remains in effect.",
    data: bookingData(payload, {
      status: payload.status || getBooking(payload).status,
      extensionStatus: "rejected",
    }),
  });
};

const handlePaymentReceived = async (payload = {}) => {
  const paymentStatus = toOptionalText(payload.paymentStatus || getBooking(payload).paymentStatus);
  const isNowPaidInFull = paymentStatus === "paid";
  const actorName = displayName(payload.actor || payload.renter, "A renter");
  const vehicleName = getVehicleName(payload);

  await NotificationService.sendMany([
    {
      user: getOwnerId(payload),
      type: "booking_payment",
      category: "payment",
      event: NOTIFICATION_EVENTS.PAYMENT_RECEIVED,
      priority: "important",
      title: isNowPaidInFull ? "Booking paid" : "Downpayment received",
      message: isNowPaidInFull
        ? `${actorName} completed payment for ${vehicleName}.`
        : `${actorName} paid a downpayment for ${vehicleName}.`,
      entityType: "booking",
      entityId: getBookingId(payload),
      dedupeKey: notificationKey(getOwnerId(payload), NOTIFICATION_EVENTS.PAYMENT_RECEIVED, getBookingId(payload), paymentStatus),
      data: bookingData(payload, { paymentStatus }),
    },
    {
      user: getRenterId(payload),
      type: "booking_payment",
      category: "payment",
      event: NOTIFICATION_EVENTS.PAYMENT_RECEIVED,
      priority: "important",
      title: isNowPaidInFull ? "Payment successful" : "Downpayment successful",
      message: isNowPaidInFull
        ? `Your payment for ${vehicleName || "your booking"} was successful.`
        : `Your downpayment for ${vehicleName || "your booking"} was successful.`,
      entityType: "booking",
      entityId: getBookingId(payload),
      dedupeKey: notificationKey(getRenterId(payload), NOTIFICATION_EVENTS.PAYMENT_RECEIVED, getBookingId(payload), paymentStatus),
      data: bookingData(payload, { paymentStatus }),
    },
  ]);
};

const handlePaymentStatusUpdated = async (payload = {}) => {
  const paymentStatus = toOptionalText(payload.paymentStatus || getBooking(payload).paymentStatus);
  await sendPaymentNotification(payload, getRenterId(payload), NOTIFICATION_EVENTS.PAYMENT_STATUS_UPDATED, {
    title: "Payment status updated",
    message: `Payment status is now ${paymentStatus}.`,
    dedupeSuffix: paymentStatus,
    data: bookingData(payload, { paymentStatus }),
  });
};

const handleWalkInPaymentRequested = async (payload = {}) => {
  const actorName = displayName(payload.actor || payload.renter, "Your renter");
  const vehicleName = getVehicleName(payload);

  await NotificationService.sendMany([
    {
      user: getOwnerId(payload),
      type: "booking_payment",
      category: "payment",
      event: NOTIFICATION_EVENTS.WALKIN_PAYMENT_REQUESTED,
      priority: "important",
      title: "Walk-in payment requested",
      message: `${actorName} requested walk-in payment approval for ${vehicleName}.`,
      entityType: "booking",
      entityId: getBookingId(payload),
      dedupeKey: notificationKey(getOwnerId(payload), NOTIFICATION_EVENTS.WALKIN_PAYMENT_REQUESTED, getBookingId(payload)),
      data: bookingData(payload, { walkInPaymentStatus: "requested" }),
    },
    {
      user: getRenterId(payload),
      type: "booking_payment",
      category: "payment",
      event: NOTIFICATION_EVENTS.WALKIN_PAYMENT_REQUESTED,
      priority: "important",
      title: "Walk-in payment request sent",
      message: "Your request is now waiting for owner approval.",
      entityType: "booking",
      entityId: getBookingId(payload),
      dedupeKey: notificationKey(getRenterId(payload), NOTIFICATION_EVENTS.WALKIN_PAYMENT_REQUESTED, getBookingId(payload)),
      data: bookingData(payload, { walkInPaymentStatus: "requested" }),
    },
  ]);
};

const handleWalkInPaymentReviewed = (action) => async (payload = {}) => {
  const approved = action === "approved";
  await sendPaymentNotification(
    payload,
    getRenterId(payload),
    approved ? NOTIFICATION_EVENTS.WALKIN_PAYMENT_APPROVED : NOTIFICATION_EVENTS.WALKIN_PAYMENT_REJECTED,
    {
      title: approved ? "Walk-in payment approved" : "Walk-in payment rejected",
      message: approved
        ? "Your walk-in payment request was approved by the owner."
        : "Your walk-in payment request was rejected by the owner.",
      data: bookingData(payload, { walkInPaymentStatus: action }),
    }
  );
};

const handleWalkInPaymentConfirmed = async (payload = {}) => {
  await sendPaymentNotification(payload, getRenterId(payload), NOTIFICATION_EVENTS.WALKIN_PAYMENT_CONFIRMED, {
    title: "Walk-in payment confirmed",
    message: "The owner confirmed your remaining balance payment.",
    data: bookingData(payload, { paymentStatus: "paid", walkInPaymentStatus: "completed" }),
  });
};

const handleChatMessageReceived = async (payload = {}) => {
  const receiverId = toIdString(payload.receiverId || payload.receiver?._id || payload.receiver);
  const senderId = toIdString(payload.senderId || payload.sender?._id || payload.sender);
  const messageId = toIdString(payload.messageId || payload.message?._id || payload.message);
  const conversationId = [receiverId, senderId, getBookingId(payload) || getVehicleId(payload) || "general"].sort().join(":");

  await NotificationService.send({
    user: receiverId,
    type: "chat_message",
    category: "chat",
    event: NOTIFICATION_EVENTS.CHAT_MESSAGE_RECEIVED,
    title: "New message",
    message: `${displayName(payload.actor || payload.sender, "Someone")} sent you a message.`,
    entityType: "conversation",
    entityId: conversationId,
    dedupeKey: notificationKey(receiverId, NOTIFICATION_EVENTS.CHAT_MESSAGE_RECEIVED, conversationId),
    coalesce: true,
    data: {
      senderId,
      bookingId: getBookingId(payload) || null,
      vehicleId: getVehicleId(payload) || null,
      messageId: messageId || null,
      conversationId,
    },
  });
};

const handleReviewCreated = async (payload = {}) => {
  await sendBookingNotification(payload, getOwnerId(payload), NOTIFICATION_EVENTS.REVIEW_CREATED, {
    type: "system",
    category: "system",
    title: "New vehicle review",
    message: "A renter left a review on a completed booking.",
    data: bookingData(payload, { rating: payload.rating || getBooking(payload).reviewRating }),
  });
};

export const registerNotificationHandlers = () => {
  if (registered) return;
  registered = true;

  subscribe(NOTIFICATION_EVENTS.BOOKING_CREATED, handleBookingCreated);
  subscribe(NOTIFICATION_EVENTS.BOOKING_CANCELLED, handleBookingCancelled);
  subscribe(NOTIFICATION_EVENTS.BOOKING_APPROVED, handleBookingApproved);
  subscribe(NOTIFICATION_EVENTS.BOOKING_REJECTED, handleBookingRejected);
  subscribe(NOTIFICATION_EVENTS.BOOKING_STATUS_UPDATED, handleBookingStatusUpdated);
  subscribe(NOTIFICATION_EVENTS.BOOKING_OVERDUE, handleBookingOverdue);
  subscribe(NOTIFICATION_EVENTS.BOOKING_COMPLETED, handleBookingCompleted);
  subscribe(NOTIFICATION_EVENTS.LATE_RETURN_PROCESSED, handleLateReturnProcessed);
  subscribe(NOTIFICATION_EVENTS.VEHICLE_RETURN_REQUESTED, handleVehicleReturnRequested);
  subscribe(NOTIFICATION_EVENTS.VEHICLE_RETURN_CONFIRMED, handleVehicleReturnConfirmed);
  subscribe(NOTIFICATION_EVENTS.VEHICLE_RETURN_DECLINED, handleVehicleReturnDeclined);

  subscribe(NOTIFICATION_EVENTS.CANCELLATION_REQUESTED, handleCancellationRequested);
  subscribe(NOTIFICATION_EVENTS.CANCELLATION_APPROVED, handleCancellationApproved);
  subscribe(NOTIFICATION_EVENTS.CANCELLATION_REJECTED, handleCancellationRejected);

  subscribe(NOTIFICATION_EVENTS.EXTENSION_REQUESTED, handleExtensionRequested);
  subscribe(NOTIFICATION_EVENTS.EXTENSION_APPROVED, handleExtensionApproved);
  subscribe(NOTIFICATION_EVENTS.EXTENSION_REJECTED, handleExtensionRejected);

  subscribe(NOTIFICATION_EVENTS.PAYMENT_RECEIVED, handlePaymentReceived);
  subscribe(NOTIFICATION_EVENTS.PAYMENT_STATUS_UPDATED, handlePaymentStatusUpdated);
  subscribe(NOTIFICATION_EVENTS.WALKIN_PAYMENT_REQUESTED, handleWalkInPaymentRequested);
  subscribe(NOTIFICATION_EVENTS.WALKIN_PAYMENT_APPROVED, handleWalkInPaymentReviewed("approved"));
  subscribe(NOTIFICATION_EVENTS.WALKIN_PAYMENT_REJECTED, handleWalkInPaymentReviewed("rejected"));
  subscribe(NOTIFICATION_EVENTS.WALKIN_PAYMENT_CONFIRMED, handleWalkInPaymentConfirmed);

  subscribe(NOTIFICATION_EVENTS.CHAT_MESSAGE_RECEIVED, handleChatMessageReceived);

  subscribe(NOTIFICATION_EVENTS.REVIEW_CREATED, handleReviewCreated);
};

export default registerNotificationHandlers;
