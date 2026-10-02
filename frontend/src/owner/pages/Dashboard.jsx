import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BadgeCheck,
  Ban,
  CalendarDays,
  CalendarRange,
  CarFront,
  CircleCheck,
  CircleX,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  Clock3,
  Eye,
  EyeOff,
  Flame,
  History,
  Inbox,
  ListTodo,
  Wallet,
  X,
} from "lucide-react";
import API from "../../utils/api";
import { OwnerDashboardSkeleton } from "../../components/LoadingSkeletons";
import VehicleThumbnail from "../../components/VehicleThumbnail";
import { getSocket } from "../../utils/socket";
import {
  formatDisplayName,
  getDurationHoursFromMinutes,
  getDurationMinutesBetween,
} from "../../utils/dateUtils";
import { resolveAssetUrl } from "../../utils/media";
import { formatVehicleTypeLabel } from "../../utils/vehicleText";
import ModalPortal from "../../components/ModalPortal";
import { showActionToast } from "../../utils/actionToast";
import ReturnReviewModal from "../components/ReturnReviewModal";

const money = (value) =>
  `\u20b1${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

const normalizeBookingStatus = (booking) =>
  booking?.status === "rejected" ? { ...booking, status: "cancelled" } : booking;

const toDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toDayKey = (value) => {
  const date = toDate(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const startOfDay = (value) => {
  const date = toDate(value);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const sameDay = (left, right) => toDayKey(left) && toDayKey(left) === toDayKey(right);

const formatDateTime = (value) => {
  const date = toDate(value);
  return date ? date.toLocaleString() : "-";
};

const formatShortDate = (value) => {
  const date = toDate(value);
  return date ? date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "-";
};

const formatLongDate = (value) => {
  const date = toDate(value);
  return date
    ? date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "-";
};

const formatShortTime = (value) => {
  const date = toDate(value);
  return date ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "-";
};

const formatScheduleDate = (value) => {
  const date = toDate(value);
  return date
    ? date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })
    : "-";
};

const formatRelativeActivityTime = (value) => {
  const date = toDate(value);
  if (!date) return "-";
  const now = new Date();
  const isToday = sameDay(date, now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = sameDay(date, yesterday);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today, ${time}`;
  if (isYesterday) return `Yesterday, ${time}`;
  return `${formatShortDate(date)}, ${time}`;
};

const isCancellationRequested = (booking) =>
  booking?.cancellationRequest?.status === "requested" || booking?.cancellation_request?.status === "requested";

const isExtensionRequested = (booking) =>
  String(booking?.extensionStatus || booking?.extensionRequest?.status || booking?.extension_request?.status || "")
    .trim()
    .toLowerCase() === "requested";

const getReturnRequestInfo = (booking) => {
  const vehicleReturn = booking?.returnRequest || booking?.return_request || {};
  return {
    status: String(vehicleReturn?.status || booking?.returnStatus || "none").trim().toLowerCase(),
    requestedAt: vehicleReturn?.requestedAt || booking?.returnRequestedAt || null,
    reviewNote: String(vehicleReturn?.reviewNote || booking?.returnReviewNote || "").trim(),
  };
};

const getCancellationRequestedAt = (booking) => {
  const dateStr = booking?.cancellationRequest?.requestedAt || booking?.cancellation_request?.requestedAt;
  return dateStr ? new Date(dateStr) : null;
};

const getExtensionRequestInfo = (booking) => {
  const extension = booking?.extensionRequest || booking?.extension_request || {};
  return {
    status: String(extension?.status || booking?.extensionStatus || "none").trim().toLowerCase(),
    currentReturnAt: extension?.currentReturnAt || booking?.returnAt || null,
    requestedReturnAt: extension?.requestedReturnAt || booking?.extensionRequestedReturnAt || null,
    requestNote: String(extension?.requestNote || booking?.extensionRequestNote || "").trim(),
    reviewNote: String(extension?.reviewNote || booking?.extensionReviewNote || "").trim(),
    requestedAt: extension?.requestedAt || booking?.extensionRequestedAt || null,
  };
};

const getCancellationRequestInfo = (booking) => {
  const cancellation = booking?.cancellationRequest || booking?.cancellation_request || {};
  return {
    status: String(cancellation?.status || booking?.cancellationStatus || "none").trim().toLowerCase(),
    requestedAt: cancellation?.requestedAt || booking?.cancellationRequestedAt || null,
    requestNote: String(cancellation?.requestNote || booking?.cancellationRequestNote || "").trim(),
  };
};

const getWalkInPaymentInfo = (booking) => {
  const payment = booking?.walkInPayment || booking?.walk_in_payment || {};
  return {
    status: String(payment?.status || booking?.walkInPaymentStatus || "none").trim().toLowerCase(),
    requestedAt: payment?.requestedAt || booking?.walkInRequestedAt || null,
    requestNote: String(payment?.requestNote || booking?.walkInRequestNote || "").trim(),
  };
};

const getLateReturnInfo = (booking) => {
  const lateReturn = booking?.lateReturn || booking?.late_return || {};
  const overdueMinutes = Number(lateReturn?.overdueMinutes || booking?.lateReturnOverdueMinutes || 0);
  const penaltyFee = Number(lateReturn?.penaltyFee || booking?.lateReturnPenaltyFee || 0);

  return {
    isOverdue:
      Boolean(lateReturn?.isOverdue) || Boolean(booking?.lateReturnIsOverdue) || overdueMinutes > 0,
    overdueMinutes: Number.isFinite(overdueMinutes) && overdueMinutes > 0 ? Math.round(overdueMinutes) : 0,
    penaltyFee: Number.isFinite(penaltyFee) && penaltyFee > 0 ? penaltyFee : 0,
  };
};

const getBookingAmountPayable = (booking) => {
  const payable = Number(booking?.amountPayable);
  if (Number.isFinite(payable) && payable >= 0) return payable;

  const total = Number(booking?.totalAmount);
  const transactionFee = Number(booking?.transactionFee);
  if (Number.isFinite(total) && total >= 0) {
    return total + (Number.isFinite(transactionFee) ? transactionFee : 0);
  }

  const baseAmount = Number(booking?.baseAmount);
  const driverAmount = Number(booking?.driverAmount);
  if (Number.isFinite(baseAmount) && Number.isFinite(driverAmount) && baseAmount + driverAmount >= 0) {
    return baseAmount + driverAmount + (Number.isFinite(transactionFee) ? transactionFee : 0);
  }

  const directMinutes = Number(booking?.bookingDurationMinutes);
  const durationMinutes =
    Number.isFinite(directMinutes) && directMinutes > 0
      ? Math.round(directMinutes)
      : booking?.pickupAt && booking?.returnAt
        ? getDurationMinutesBetween(booking.pickupAt, booking.returnAt)
        : Number.isFinite(Number(booking?.bookingDays))
          ? Math.round(Number(booking.bookingDays) * 24 * 60)
          : 0;
  const durationHours = getDurationHoursFromMinutes(durationMinutes);
  const hourlyRate = Number((booking?.vehicleHourlyRate ?? booking?.vehicleDailyRate) || 0);
  if (Number.isFinite(hourlyRate) && hourlyRate >= 0 && Number.isFinite(durationHours) && durationHours > 0) {
    const driverHourlyRate = Number((booking?.driverHourlyRate ?? booking?.driverDailyRate) || 0);
    const driverSelected = Boolean(booking?.driverSelected);
    const computedDriverAmount =
      driverSelected && Number.isFinite(driverHourlyRate) && driverHourlyRate > 0
        ? driverHourlyRate * durationHours
        : 0;
    return hourlyRate * durationHours + computedDriverAmount +
      (Number.isFinite(transactionFee) ? transactionFee : 0);
  }

  return 0;
};

const getBookingAmountEarned = (booking) => {
  const directEarned = Number(booking?.amountEarned);
  if (Number.isFinite(directEarned) && directEarned >= 0) return directEarned;

  const totalPayable = getBookingAmountPayable(booking);
  const paid = Number(booking?.paymentAmountPaid);
  const status = String(booking?.paymentStatus || "").trim().toLowerCase();
  if (status === "refunded") return 0;
  if (Number.isFinite(paid) && paid > 0) return Math.min(paid, totalPayable);
  if (status === "paid") return totalPayable;
  return 0;
};

const getBookingEarnedAt = (booking) =>
  toDate(
    booking?.earnedAt ||
      booking?.paymentUpdatedAt ||
      booking?.paidAt ||
      booking?.updatedAt ||
      booking?.createdAt
  );

const getRenterProfile = (renter) => {
  const name = formatDisplayName(renter?.name || "", "");
  const email = String(renter?.email || "").trim();
  const displayName = name || email || "Renter";
  const initialsSource = name || email || "R";
  const initials =
    initialsSource
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "R";

  return {
    displayName,
    email,
    avatar: resolveAssetUrl(renter?.avatar),
    initials,
  };
};

const getBookingSortTime = (booking) =>
  toDate(
    booking?.pickupAt ||
      booking?.extensionRequestedReturnAt ||
      booking?.returnAt ||
      booking?.cancellationRequest?.requestedAt ||
      booking?.updatedAt ||
      booking?.createdAt
  )?.getTime() || 0;

const activeBookingStatuses = new Set(["confirmed", "extended"]);

const getBookingDayFlags = (booking, day) => {
  const flags = [];
  const bookingStatus = String(booking?.status || "").trim().toLowerCase();
  const pickupAt = toDate(booking?.pickupAt);
  const returnAt = toDate(booking?.returnAt);
  const extension = getExtensionRequestInfo(booking);
  const lateReturn = getLateReturnInfo(booking);

  if (pickupAt && sameDay(pickupAt, day) && activeBookingStatuses.has(bookingStatus)) {
    flags.push("pickup");
  }

  if (returnAt && sameDay(returnAt, day) && activeBookingStatuses.has(bookingStatus)) {
    flags.push("return");
  }

  if (
    pickupAt &&
    returnAt &&
    bookingStatus === "confirmed" &&
    !sameDay(pickupAt, day) &&
    !sameDay(returnAt, day) &&
    startOfDay(day) >= startOfDay(pickupAt) &&
    startOfDay(day) <= startOfDay(returnAt)
  ) {
    flags.push("active");
  }

  if (
    extension.status === "requested" &&
    extension.requestedReturnAt &&
    sameDay(extension.requestedReturnAt, day)
  ) {
    flags.push("extension");
  }

  if (
    lateReturn.isOverdue &&
    sameDay(day, new Date()) &&
    activeBookingStatuses.has(bookingStatus)
  ) {
    flags.push("overdue");
  }

  if (
    isCancellationRequested(booking) &&
    getCancellationRequestedAt(booking) &&
    sameDay(getCancellationRequestedAt(booking), day)
  ) {
    flags.push("cancelled");
  }

  if (bookingStatus === "cancelled" && pickupAt && sameDay(pickupAt, day)) {
    flags.push("cancelled");
  }

  return [...new Set(flags)];
};

const getBookingDayPriority = (booking, day) => {
  const flags = getBookingDayFlags(booking, day);
  if (flags.includes("overdue")) return 0;
  if (flags.includes("extension")) return 1;
  if (flags.includes("pickup")) return 2;
  if (flags.includes("return")) return 3;
  if (flags.includes("active")) return 4;
  if (flags.includes("cancelled")) return 5;
  return 6;
};

const getBookingStatusTone = (booking) => {
  const extension = getExtensionRequestInfo(booking);
  const lateReturn = getLateReturnInfo(booking);
  const cancellation = isCancellationRequested(booking);
  const status = String(booking?.status || "").trim().toLowerCase();

  if (lateReturn.isOverdue) return { label: "Overdue", className: "bg-rose-100 text-rose-700", icon: Flame };
  if (extension.status === "requested") return { label: "Extension Request", className: "bg-violet-100 text-violet-700", icon: CircleDot };
  if (cancellation) return { label: "Cancellation Request", className: "bg-slate-200 text-slate-700", icon: Ban };
  if (status === "pending") return { label: "Pending", className: "bg-amber-100 text-amber-700", icon: Circle };
  if (status === "confirmed") return { label: "Active Rental", className: "bg-blue-100 text-blue-700", icon: CircleDot };
  if (status === "extended") return { label: "Extended", className: "bg-indigo-100 text-indigo-700", icon: CalendarRange };
  if (status === "completed") return { label: "Completed", className: "bg-emerald-100 text-emerald-700", icon: BadgeCheck };
  if (status === "cancelled" || status === "rejected") return { label: "Cancelled", className: "bg-slate-200 text-slate-700", icon: Ban };
  return { label: status || "Scheduled", className: "bg-slate-100 text-slate-600", icon: CalendarDays };
};

const getActionableTasks = (bookings) => {
  const today = new Date();

  const tasks = [];
  bookings.forEach((booking) => {
    const bookingStatus = String(booking?.status || "").trim().toLowerCase();
    const pickupAt = toDate(booking?.pickupAt);
    const returnAt = toDate(booking?.returnAt);
    const extension = getExtensionRequestInfo(booking);
    const lateReturn = getLateReturnInfo(booking);

    if (pickupAt && sameDay(pickupAt, today) && activeBookingStatuses.has(bookingStatus)) {
      tasks.push({
        type: "pickup",
        booking,
        label: "Pickup",
        value: formatShortTime(pickupAt),
        tone: "bg-emerald-100 text-emerald-700",
        icon: ArrowRight,
      });
    }

    if (returnAt && sameDay(returnAt, today) && activeBookingStatuses.has(bookingStatus)) {
      tasks.push({
        type: "return",
        booking,
        label: "Return",
        value: formatShortTime(returnAt),
        tone: "bg-rose-100 text-rose-700",
        icon: ArrowRight,
      });
    }

    if (extension.status === "requested") {
      const requestedReturnAt = toDate(extension.requestedReturnAt);
      if (requestedReturnAt && sameDay(requestedReturnAt, today)) {
        tasks.push({
          type: "extension",
          booking,
          label: "Extension Request",
          value: "Review",
          tone: "bg-violet-100 text-violet-700",
          icon: Clock3,
        });
      }
    }

    if (lateReturn.isOverdue && activeBookingStatuses.has(bookingStatus)) {
      tasks.push({
        type: "overdue",
        booking,
        label: "Overdue Vehicle",
        value: `${Math.max(1, Math.ceil(lateReturn.overdueMinutes / (24 * 60)))} Days Late`,
        tone: "bg-rose-100 text-rose-700",
        icon: Flame,
      });
    }
  });

  return tasks
    .sort((left, right) => {
      const priority = { overdue: 0, extension: 1, pickup: 2, return: 3 };
      const priorityDiff = (priority[left.type] ?? 9) - (priority[right.type] ?? 9);
      if (priorityDiff !== 0) return priorityDiff;
      return getBookingSortTime(left.booking) - getBookingSortTime(right.booking);
    });
};

const getRenterRequests = (bookings) =>
  bookings
    .flatMap((booking) => {
      const requests = [];
      const bookingStatus = String(booking?.status || "").trim().toLowerCase();
      const extension = getExtensionRequestInfo(booking);
      const cancellation = getCancellationRequestInfo(booking);
      const walkInPayment = getWalkInPaymentInfo(booking);
      const vehicleReturn = getReturnRequestInfo(booking);

      if (bookingStatus === "pending") {
        requests.push({
          key: `${booking._id}-booking`,
          type: "booking",
          booking,
          label: "Booking Request",
          detail: booking?.pickupAt ? `Pickup ${formatShortDate(booking.pickupAt)}` : "Awaiting review",
          requestedAt: booking?.createdAt || booking?.updatedAt || null,
          requestNote: "",
          tone: "bg-amber-100 text-amber-700",
          icon: CalendarRange,
        });
      }

      if (extension.status === "requested") {
        requests.push({
          key: `${booking._id}-extension`,
          type: "extension",
          booking,
          label: "Extension Request",
          detail: extension.requestedReturnAt ? `Return ${formatShortDate(extension.requestedReturnAt)}` : "Awaiting review",
          requestedAt: extension.requestedAt || booking?.updatedAt || booking?.createdAt || null,
          requestNote: extension.requestNote,
          tone: "bg-violet-100 text-violet-700",
          icon: Clock3,
        });
      }

      if (cancellation.status === "requested") {
        requests.push({
          key: `${booking._id}-cancellation`,
          type: "cancellation",
          booking,
          label: "Cancellation Request",
          detail: "Awaiting review",
          requestedAt: cancellation.requestedAt || booking?.updatedAt || booking?.createdAt || null,
          requestNote: cancellation.requestNote,
          tone: "bg-slate-200 text-slate-700",
          icon: Ban,
        });
      }

      if (walkInPayment.status === "requested") {
        requests.push({
          key: `${booking._id}-walk-in`,
          type: "walk-in",
          booking,
          label: "Walk-in Payment Request",
          detail: "Awaiting review",
          requestedAt: walkInPayment.requestedAt || booking?.updatedAt || booking?.createdAt || null,
          requestNote: walkInPayment.requestNote,
          tone: "bg-emerald-100 text-emerald-700",
          icon: Wallet,
        });
      }

      if (vehicleReturn.status === "requested") {
        requests.push({
          key: `${booking._id}-return`,
          type: "return",
          booking,
          label: "Vehicle Return Request",
          detail: "Confirm after physically receiving the vehicle",
          requestedAt: vehicleReturn.requestedAt || booking?.updatedAt || booking?.createdAt || null,
          requestNote: "",
          tone: "bg-blue-100 text-blue-700",
          icon: CarFront,
        });
      }

      return requests;
    })
    .sort((left, right) => new Date(right.requestedAt || 0) - new Date(left.requestedAt || 0));

const getRecentActivity = (bookings) => {
  return [...bookings]
    .map((booking) => {
      const extension = getExtensionRequestInfo(booking);
      const lateReturn = getLateReturnInfo(booking);
      const status = String(booking?.status || "").trim().toLowerCase();
      const paymentStatus = String(booking?.paymentStatus || "").trim().toLowerCase();

      let description = "Booking Updated";
      let icon = CalendarDays;
      let tone = "text-slate-600 bg-slate-100";

      if (extension.status === "approved") {
        description = "Extension Approved";
        icon = CircleCheck;
        tone = "text-emerald-700 bg-emerald-100";
      } else if (extension.status === "rejected") {
        description = "Extension Declined";
        icon = CircleX;
        tone = "text-rose-700 bg-rose-100";
      } else if (extension.status === "requested") {
        description = "Extension request";
        icon = Clock3;
        tone = "text-violet-700 bg-violet-100";
      } else if (lateReturn.isOverdue) {
        description = "Overdue Vehicle";
        icon = Flame;
        tone = "text-rose-700 bg-rose-100";
      } else if (status === "completed") {
        description = "was returned";
        icon = BadgeCheck;
        tone = "text-emerald-700 bg-emerald-100";
      } else if (status === "cancelled" || status === "rejected") {
        description = "Booking Cancelled";
        icon = Ban;
        tone = "text-slate-700 bg-slate-200";
      } else if (status === "confirmed") {
        description = "Booking approved";
        icon = CircleCheck;
        tone = "text-blue-700 bg-blue-100";
      } else if (status === "pending") {
        description = "New booking request";
        icon = Circle;
        tone = "text-blue-700 bg-blue-100";
      } else if (paymentStatus === "paid") {
        description = "Payment received";
        icon = Wallet;
        tone = "text-emerald-700 bg-emerald-100";
      }

      const eventTime =
        extension.status === "approved" || extension.status === "rejected"
          ? extension.requestedAt || booking.updatedAt || booking.createdAt
          : lateReturn.isOverdue
            ? booking.lateReturnDetectedAt || booking.updatedAt || booking.createdAt
            : status === "completed"
              ? booking.actualReturnAt || booking.updatedAt || booking.createdAt
              : status === "confirmed"
                ? booking.updatedAt || booking.createdAt
                : paymentStatus === "paid"
                  ? booking.paidAt || booking.paymentUpdatedAt || booking.updatedAt || booking.createdAt
                  : booking.updatedAt || booking.createdAt;

      return {
        booking,
        description,
        icon,
        tone,
        time: eventTime,
      };
    })
    .sort((left, right) => new Date(right.time || 0) - new Date(left.time || 0))
    .slice(0, 5);
};

const getCalendarCells = (anchorDate) => {
  const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const monthEnd = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
  const firstDayOffset = (monthStart.getDay() + 6) % 7;
  const startDate = new Date(monthStart);
  startDate.setDate(startDate.getDate() - firstDayOffset);

  const lastDayOffset = (6 - monthEnd.getDay() + 7) % 7;
  const endDate = new Date(monthEnd);
  endDate.setDate(endDate.getDate() + lastDayOffset);

  const cells = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    cells.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return cells;
};

const getDateSummary = (date, bookings) => {
  return bookings
    .filter((booking) => {
      const pickupAt = toDate(booking?.pickupAt);
      const returnAt = toDate(booking?.returnAt);
      const extension = getExtensionRequestInfo(booking);
      const lateReturn = getLateReturnInfo(booking);
      const status = String(booking?.status || "").trim().toLowerCase();

      if (pickupAt && sameDay(pickupAt, date) && activeBookingStatuses.has(status)) return true;
      if (returnAt && sameDay(returnAt, date) && activeBookingStatuses.has(status)) return true;
      if (
        pickupAt &&
        returnAt &&
        activeBookingStatuses.has(status) &&
        startOfDay(date) >= startOfDay(pickupAt) &&
        startOfDay(date) <= startOfDay(returnAt)
      ) {
        return true;
      }
      if (extension.status === "requested" && extension.requestedReturnAt && sameDay(extension.requestedReturnAt, date)) {
        return true;
      }
      if (lateReturn.isOverdue && sameDay(date, new Date())) return true;
      if (isCancellationRequested(booking) && getCancellationRequestedAt(booking) && sameDay(getCancellationRequestedAt(booking), date)) return true;
      return false;
    })
    .sort((left, right) => getBookingDayPriority(left, date) - getBookingDayPriority(right, date));
};

const getTodayDate = () => new Date();

const itemColorMap = {
  pickup: "bg-emerald-500",
  return: "bg-rose-500",
  active: "bg-blue-500",
  extension: "bg-violet-500",
  cancelled: "bg-slate-500",
  overdue: "bg-amber-500",
};

const taskIconOverrides = {
  pickup: ArrowUp,
  return: ArrowDown,
  extension: Clock3,
  overdue: Flame,
};

const getScheduleEventInfo = (booking, date) => {
  const flags = getBookingDayFlags(booking, date);
  if (flags.includes("overdue")) {
    return { label: "Overdue Vehicle", time: null, Icon: Flame, tone: "text-rose-600 bg-rose-100" };
  }
  if (flags.includes("cancelled")) {
    return { label: "Cancelled Booking", time: null, Icon: Ban, tone: "text-slate-600 bg-slate-200" };
  }
  if (flags.includes("extension")) {
    return { label: "Extension Request", time: null, Icon: Clock3, tone: "text-violet-600 bg-violet-100" };
  }
  if (flags.includes("pickup")) {
    return { label: "Pickup", time: formatShortTime(booking.pickupAt), Icon: ArrowUp, tone: "text-emerald-600 bg-emerald-100" };
  }
  if (flags.includes("return")) {
    return { label: "Return", time: formatShortTime(booking.returnAt), Icon: ArrowDown, tone: "text-rose-600 bg-rose-100" };
  }
  if (flags.includes("active")) {
    return { label: "Active Rental", time: null, Icon: CarFront, tone: "text-blue-600 bg-blue-100" };
  }
  return { label: "Scheduled", time: null, Icon: CarFront, tone: "text-slate-600 bg-slate-100" };
};

const formatExtensionFee = (booking, extension) => {
  const currentReturnAt = toDate(extension?.currentReturnAt || booking?.returnAt);
  const requestedReturnAt = toDate(extension?.requestedReturnAt);
  const pickupAt = toDate(booking?.pickupAt);
  if (!currentReturnAt || !requestedReturnAt || !pickupAt) return "-";

  const currentDurationMinutes = Math.max(0, Math.round((currentReturnAt.getTime() - pickupAt.getTime()) / 60000));
  const requestedDurationMinutes = Math.max(0, Math.round((requestedReturnAt.getTime() - pickupAt.getTime()) / 60000));
  const currentHours = getDurationHoursFromMinutes(currentDurationMinutes);
  const requestedHours = getDurationHoursFromMinutes(requestedDurationMinutes);
  const vehicleHourlyRate = Number((booking?.vehicleHourlyRate ?? booking?.vehicleDailyRate) || 0);
  const driverHourlyRate = Number((booking?.driverHourlyRate ?? booking?.driverDailyRate) || 0);
  const driverSelected = Boolean(booking?.driverSelected);
  const currentFee = (vehicleHourlyRate * currentHours) + (driverSelected ? driverHourlyRate * currentHours : 0);
  const requestedFee = (vehicleHourlyRate * requestedHours) + (driverSelected ? driverHourlyRate * requestedHours : 0);
  return money(Math.max(requestedFee - currentFee, 0));
};

/* ═══════════════════════════════════════════════════════
   Dashboard Component
   ═══════════════════════════════════════════════════════ */

export default function Dashboard() {
  const [vehicles, setVehicles] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [earningsBookings, setEarningsBookings] = useState([]);
  const [isRevenueVisible, setIsRevenueVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [updatingBookingId, setUpdatingBookingId] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [dayModalOpen, setDayModalOpen] = useState(false);
  const [extensionReviewBooking, setExtensionReviewBooking] = useState(null);
  const [reviewingExtensionId, setReviewingExtensionId] = useState("");
  const [renterRequestReview, setRenterRequestReview] = useState(null);
  const [returnDeclineRequest, setReturnDeclineRequest] = useState(null);
  const [returnReviewNote, setReturnReviewNote] = useState("");
  const [reviewingRenterRequestKey, setReviewingRenterRequestKey] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [viewAllModal, setViewAllModal] = useState("");

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setSyncing(true);
    } else {
      setLoading(true);
    }

    try {
      const [vehiclesResponse, activeBookingsResponse, actionBookingsResponse, earningsResponse] = await Promise.all([
        API.getOwnerVehicles(),
        // The dashboard is operational: it needs upcoming/current rentals, not
        // an account's complete financial history. History remains available
        // through the paginated Bookings page and earnings report.
        API.getOwnerBookings({ view: "active", limit: 100 }),
        API.getOwnerBookings({ view: "action", limit: 100 }),
        API.getOwnerEarnings(),
      ]);

      setVehicles(vehiclesResponse.vehicles || []);
      const dashboardBookings = [
        ...(activeBookingsResponse.bookings || []),
        ...(actionBookingsResponse.bookings || []),
      ];
      setBookings(
        Array.from(new Map(dashboardBookings.map((booking) => [booking._id, booking])).values()).map(
          normalizeBookingStatus
        )
      );
      setEarningsBookings(earningsResponse.bookings || []);
      setLastUpdated(new Date().toISOString());
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load owner dashboard.");
    } finally {
      if (silent) {
        setSyncing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    const syncDashboard = () => loadDashboard({ silent: true });
    socket.on("booking:updated", syncDashboard);
    socket.on("notification:new", syncDashboard);

    return () => {
      socket.off("booking:updated", syncDashboard);
      socket.off("notification:new", syncDashboard);
    };
  }, [loadDashboard]);

  const stats = useMemo(
    () => ({
      myVehicles: vehicles.length,
      activeRentals: bookings.filter((booking) => ["confirmed", "extended"].includes(String(booking.status || "").toLowerCase())).length,
      pendingRequests: bookings.filter(
        (booking) =>
          String(booking.status || "").toLowerCase() === "pending" ||
          isCancellationRequested(booking) ||
          isExtensionRequested(booking) ||
          getReturnRequestInfo(booking).status === "requested" ||
          getWalkInPaymentInfo(booking).status === "requested"
      ).length,
    }),
    [vehicles, bookings]
  );

  const calendarCells = useMemo(() => getCalendarCells(visibleMonth), [visibleMonth]);
  const today = useMemo(() => getTodayDate(), []);
  const todayTasks = useMemo(() => getActionableTasks(bookings), [bookings]);
  const recentActivity = useMemo(() => getRecentActivity(bookings), [bookings]);
  const selectedDateBookings = useMemo(() => getDateSummary(selectedDate, bookings), [selectedDate, bookings]);
  const monthTitle = visibleMonth.toLocaleDateString([], { month: "long", year: "numeric" });
  const renterRequests = useMemo(() => getRenterRequests(bookings), [bookings]);

  const todayRevenue = useMemo(() => {
    return earningsBookings.reduce((sum, booking) => {
      const earnedAt = getBookingEarnedAt(booking);
      if (!earnedAt || !sameDay(earnedAt, today)) return sum;
      return sum + getBookingAmountEarned(booking);
    }, 0);
  }, [earningsBookings, today]);

  const visibleMonthTasks = useMemo(() => {
    return calendarCells.map((date) => ({
      date,
      summary: getDateSummary(date, bookings),
    }));
  }, [bookings, calendarCells]);

  const updateBookingStatus = async (bookingId, nextStatus) => {
    setUpdatingBookingId(bookingId);
    setError("");
    try {
      const response = await API.updateOwnerBookingStatus(bookingId, nextStatus);
      if (response?.success === false) throw new Error(response.message || "Failed to update booking.");
      const updated = normalizeBookingStatus(response.booking);

      setBookings((prev) => {
        const exists = prev.some((booking) => booking._id === bookingId);
        if (!exists) return [updated, ...prev];
        return prev.map((booking) => (booking._id === bookingId ? updated : booking));
      });

      setLastUpdated(new Date().toISOString());
      loadDashboard({ silent: true });
      showActionToast(nextStatus === "confirmed" ? "Booking approved." : nextStatus === "rejected" ? "Booking declined." : "Booking updated.", { id: `owner-booking-${bookingId}` });
    } catch (err) {
      setError(err.message || "Failed to update booking.");
    } finally {
      setUpdatingBookingId("");
    }
  };

  const reviewExtensionRequest = async (booking, action) => {
    if (!booking?._id) return;
    setReviewingExtensionId(booking._id);
    setReviewError("");
    try {
      const response = await API.reviewOwnerBookingExtensionRequest(booking._id, action);
      if (response?.success === false) throw new Error(response.message || "Failed to review extension request.");
      const updated = normalizeBookingStatus(response.booking);

      setBookings((prev) => prev.map((item) => (item._id === booking._id ? updated : item)));
      setExtensionReviewBooking(null);
      setLastUpdated(new Date().toISOString());
      loadDashboard({ silent: true });
      showActionToast(action === "approve" ? "Extension approved." : "Extension declined.", { id: `owner-booking-${booking._id}` });
    } catch (err) {
      setReviewError(err.message || "Failed to review extension request.");
    } finally {
      setReviewingExtensionId("");
    }
  };

  const openRenterRequestReview = (request) => {
    setViewAllModal("");
    setReviewError("");

    if (request?.type === "extension") {
      setDayModalOpen(false);
      setExtensionReviewBooking(request.booking);
      return;
    }

    setRenterRequestReview(request);
  };

  const reviewRenterRequest = async (request, action, note = "") => {
    if (!request?.booking?._id) return;

    setReviewingRenterRequestKey(request.key);
    setReviewError("");
    try {
      let response;
      if (request.type === "booking") {
        response = await API.updateOwnerBookingStatus(
          request.booking._id,
          action === "approve" ? "confirmed" : "rejected"
        );
      } else if (request.type === "cancellation") {
        response = await API.reviewOwnerBookingCancellationRequest(request.booking._id, action);
      } else if (request.type === "walk-in") {
        response = await API.reviewOwnerWalkInPaymentRequest(request.booking._id, action);
      } else if (request.type === "return") {
        response = await API.reviewOwnerVehicleReturnRequest(
          request.booking._id,
          action === "approve" ? "confirm" : "decline",
          action === "reject" ? { note } : {}
        );
      } else {
        return;
      }
      if (response?.success === false) throw new Error(response.message || "Failed to review request.");

      const updated = normalizeBookingStatus(response.booking);
      setBookings((prev) => {
        const exists = prev.some((booking) => booking._id === request.booking._id);
        if (!exists) return [updated, ...prev];
        return prev.map((booking) => (booking._id === request.booking._id ? updated : booking));
      });
      setRenterRequestReview(null);
      setReturnDeclineRequest(null);
      setReturnReviewNote("");
      setLastUpdated(new Date().toISOString());
      loadDashboard({ silent: true });
      const decisionMessage = request.type === "booking"
        ? action === "approve" ? "Booking approved." : "Booking declined."
        : request.type === "cancellation"
          ? action === "approve" ? "Cancellation approved. Booking cancelled." : "Cancellation declined. Booking remains active."
          : request.type === "return"
            ? action === "approve" ? "Vehicle return confirmed." : "Return request declined. Booking remains active."
            : action === "approve" ? "Walk-in request approved. Waiting for renter payment." : "Walk-in request declined.";
      showActionToast(decisionMessage, { id: `owner-booking-${request.booking._id}` });
    } catch (err) {
      setReviewError(err.message || `Failed to review ${request.label.toLowerCase()}.`);
    } finally {
      setReviewingRenterRequestKey("");
    }
  };

  const openBookingTab = () => {
    window.dispatchEvent(new CustomEvent("navigate", { detail: "Bookings" }));
  };

  const openViewAllModal = (section) => {
    setViewAllModal(section);
  };

  const openOwnerPage = (page) => {
    window.dispatchEvent(new CustomEvent("navigate", { detail: page }));
  };

  if (loading) return <OwnerDashboardSkeleton />;

  /* ── Render ───────────────────────────────────────── */

  return (
    <div className="space-y-5">
      {error && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

      {/* ── Summary Cards ─────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <SummaryCard
          title="Vehicles"
          value={stats.myVehicles}
          subtitle="View all vehicles"
          icon={CarFront}
          iconClassName="bg-blue-50 text-[#017FE6]"
          onAction={() => openViewAllModal("vehicles")}
        />
        <SummaryCard
          title="Active Rentals"
          value={stats.activeRentals}
          subtitle="View rentals"
          icon={CalendarRange}
          iconClassName="bg-emerald-50 text-emerald-600"
          onAction={() => openViewAllModal("rentals")}
        />
        <SummaryCard
          title="Pending Requests"
          value={stats.pendingRequests}
          subtitle="View requests"
          icon={Clock3}
          iconClassName="bg-amber-50 text-amber-600"
          onAction={() => openViewAllModal("requests")}
        />
        <SummaryCard
          title="Revenue Today"
          value={isRevenueVisible ? money(todayRevenue) : "\u20b1\u2022\u2022\u2022\u2022\u2022\u2022"}
          subtitle="View earnings"
          icon={Wallet}
          iconClassName="bg-violet-50 text-violet-600"
          onAction={() => openViewAllModal("earnings")}
          isValueVisible={isRevenueVisible}
          onToggleValueVisibility={() => setIsRevenueVisible((visible) => !visible)}
        />
      </section>

      {/* ── Calendar + Tasks & Requests ───────────────── */}
      <p className="sr-only" aria-live="polite">
        {syncing ? "Syncing live updates..." : loading ? "Loading dashboard..." : `Last updated: ${formatDateTime(lastUpdated)}`}
      </p>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.9fr)_minmax(320px,0.92fr)]">
        {/* Calendar */}
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-slate-200/80 pb-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <CalendarDays size={20} strokeWidth={2} className="text-[#017FE6]" aria-hidden="true" />
              Rental Calendar
            </div>
            <p className="ml-auto max-w-md text-right text-xs leading-5 text-slate-500">
              Tip: Click any date on the calendar to see schedules and manage bookings easily.
            </p>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setVisibleMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-[#017FE6]"
                aria-label="Previous month"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => setVisibleMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-[#017FE6]"
                aria-label="Next month"
              >
                <ChevronRight size={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                  setSelectedDate(now);
                }}
                className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:text-[#017FE6]"
              >
                Today
              </button>
            </div>

            <span className="text-sm font-semibold text-slate-800 lg:justify-self-center">
              {monthTitle}
            </span>

            <div className="flex flex-wrap gap-3 text-xs text-slate-600 lg:justify-self-end">
              <LegendDot color="bg-emerald-500" label="Pickup" />
              <LegendDot color="bg-rose-500" label="Return" />
              <LegendDot color="bg-blue-500" label="Active" />
              <LegendDot color="bg-violet-500" label="Extension" />
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                <div key={day} className="px-1 py-2.5 sm:py-3">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {visibleMonthTasks.map(({ date, summary }) => {
                const inCurrentMonth = date.getMonth() === visibleMonth.getMonth();
                const selected = sameDay(date, selectedDate);
                const todayMatch = sameDay(date, today);

                const bookingDots = summary.slice(0, 4).map((booking) => {
                  const flags = getBookingDayFlags(booking, date);
                  const primaryFlag = flags[0] || "active";
                  return { id: booking._id, color: itemColorMap[primaryFlag] || "bg-slate-400" };
                });

                return (
                  <button
                    type="button"
                    key={toDayKey(date)}
                    onClick={() => {
                      setSelectedDate(date);
                      setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
                      setExtensionReviewBooking(null);
                    }}
                    className={`min-h-[52px] border-r border-b border-slate-100 p-1.5 text-left transition hover:bg-blue-50/40 sm:min-h-[58px] sm:p-2 xl:h-[2.75cm] xl:min-h-[2.75cm] ${
                      selected ? "ring-2 ring-inset ring-[#017FE6] rounded-lg" : ""
                    } ${inCurrentMonth ? "bg-white" : "bg-slate-50/70 text-slate-400"}`}
                  >
                    <span
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                        todayMatch ? "bg-[#017FE6] text-white" : "text-slate-700"
                      }`}
                    >
                      {date.getDate()}
                    </span>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {bookingDots.map((dot, index) => (
                        <span key={`${dot.id}-${index}`} className={`h-2 w-2 rounded-full ${dot.color}`} />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Panel>

        <aside className="flex h-full min-h-0 flex-col gap-5">
          {/* Today's Tasks */}
          <Panel className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-slate-200/80 pb-4 text-sm font-semibold text-slate-800">
              <ListTodo size={16} className="text-[#017FE6]" />
              Today&apos;s Tasks
            </div>

            <div className={`mt-4 min-h-0 flex-1 overflow-y-auto pr-1 ${todayTasks.length === 0 ? "mb-4 flex" : "space-y-3"}`}>
              {todayTasks.length === 0 ? (
                <EmptyState message="No scheduled tasks today." icon={ListTodo} compact fill />
              ) : (
                todayTasks.slice(0, 3).map((task) => {
                  const renter = getRenterProfile(task.booking.renter);
                  const TaskIcon = taskIconOverrides[task.type] || task.icon;
                  return (
                    <DashboardActionRow
                      key={`${task.type}-${task.booking._id}`}
                      onClick={openBookingTab}
                      icon={TaskIcon}
                      tone={task.tone}
                      label={task.label}
                      vehicleName={task.booking.vehicle?.name || "Vehicle"}
                      renterName={renter.displayName}
                      actionLabel={task.value}
                      actionIsBadge={task.value === "Review"}
                    />
                  );
                })
              )}
            </div>

            <SectionViewAllFooter label="View all tasks" onClick={() => openViewAllModal("tasks")} pushToBottom />
          </Panel>

          {/* Renter Requests */}
          <Panel className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-slate-200/80 pb-4 text-sm font-semibold text-slate-800">
              <Inbox size={16} className="text-[#017FE6]" />
              Renter Requests
            </div>

            <div className={`mt-4 min-h-0 flex-1 overflow-y-auto pr-1 ${renterRequests.length === 0 ? "mb-4 flex" : "space-y-3"}`}>
              {renterRequests.length === 0 ? (
                <EmptyState message="No renter requests right now." icon={Inbox} compact fill />
              ) : (
                renterRequests.slice(0, 3).map((request) => {
                  const renter = getRenterProfile(request.booking.renter);
                  const RequestIcon = request.icon;

                  return (
                    <DashboardActionRow
                      key={request.key}
                      onClick={() => openRenterRequestReview(request)}
                      icon={RequestIcon}
                      tone={request.tone}
                      label={request.label}
                      vehicleName={request.booking.vehicle?.name || "Vehicle"}
                      renterName={renter.displayName}
                      actionLabel="Review"
                      actionIsBadge
                    />
                  );
                })
              )}
            </div>

            <SectionViewAllFooter label="View all requests" onClick={() => openViewAllModal("requests")} pushToBottom />
          </Panel>
        </aside>
      </section>

      {/* ── Schedule + Recent Activity ────────────────── */}
      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Schedule for selected date */}
        <Panel className="flex h-full flex-col">
          <div className="flex min-w-0 items-center gap-2 border-b border-slate-200/80 pb-4 text-sm font-semibold text-slate-800">
            <CalendarDays size={16} className="shrink-0 text-[#017FE6]" />
            <span className="truncate">Schedule for {formatScheduleDate(selectedDate)}</span>
          </div>

          <div className="mt-4 space-y-2">
            {selectedDateBookings.length === 0 ? (
              <EmptyState message="No schedules found for this date." icon={CalendarRange} compact />
            ) : (
              selectedDateBookings.map((booking) => {
                const renter = getRenterProfile(booking.renter);
                const extension = getExtensionRequestInfo(booking);
                const event = getScheduleEventInfo(booking, selectedDate);
                const showExtensionActions = extension.status === "requested";

                return (
                  <div
                    key={booking._id}
                    className="flex flex-col gap-2 rounded-xl bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${event.tone}`}>
                      <event.Icon size={16} />
                    </div>
                    {event.time && (
                      <span className="text-sm font-semibold text-slate-500 sm:w-20">{event.time}</span>
                    )}
                    <span className="text-sm font-bold text-slate-800 sm:w-36">{event.label}</span>
                    <span className="truncate text-sm font-medium text-slate-700 sm:flex-1">{booking.vehicle?.name || "Vehicle"}</span>
                    <span className="truncate text-sm text-slate-500">{renter.displayName}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      {showExtensionActions ? (
                        <>
                          <button
                            type="button"
                            disabled={reviewingExtensionId === booking._id}
                            onClick={() => reviewExtensionRequest(booking, "approve")}
                            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-60"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={reviewingExtensionId === booking._id}
                            onClick={() => reviewExtensionRequest(booking, "reject")}
                            className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-600 disabled:opacity-60"
                          >
                            Decline
                          </button>
                        </>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                          Confirmed
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
              )}
            </div>

          <SectionViewAllFooter
            label="View full day details"
            onClick={() => setDayModalOpen(true)}
            pushToBottom
          />
        </Panel>

        {/* Recent Activity */}
        <Panel>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 border-b border-slate-200/80 pb-4">
            <History size={16} className="text-[#017FE6]" />
            Recent Activity
          </div>

          <div className="mt-4 space-y-4">
            {recentActivity.length === 0 ? (
              <EmptyState message="No recent activity yet." icon={BadgeCheck} compact />
            ) : (
              recentActivity.map((activity) => {
                const renter = getRenterProfile(activity.booking.renter);
                const vehicleName = activity.booking.vehicle?.name || "Vehicle";
                const Icon = activity.icon;

                return (
                  <div key={activity.booking._id} className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${activity.tone}`}>
                      <Icon size={16} strokeWidth={2} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-900">
                        <ActivityDescription description={activity.description} vehicleName={vehicleName} />
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {renter.displayName} &bull; {formatRelativeActivityTime(activity.time)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Panel>
      </section>

      {/* ── Day Modal ────────────────────────────────── */}
      {viewAllModal && (
        <ViewAllDashboardModal
          section={viewAllModal}
          onClose={() => setViewAllModal("")}
          onNavigate={openOwnerPage}
          onReviewRequest={openRenterRequestReview}
          vehicles={vehicles}
          bookings={bookings}
          earningsBookings={earningsBookings}
          isRevenueVisible={isRevenueVisible}
          today={today}
          tasks={todayTasks}
          renterRequests={renterRequests}
        />
      )}

      {dayModalOpen && (
        <Modal onClose={() => setDayModalOpen(false)} title={formatLongDate(selectedDate)}>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Selected Day</p>
                <p className="text-sm text-slate-500">{formatLongDate(selectedDate)}</p>
              </div>
              <button
                type="button"
                onClick={openBookingTab}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              >
                Open Bookings
                <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-3">
              {selectedDateBookings.length === 0 ? (
                <EmptyState message="No schedules found for this date." icon={CalendarDays} compact />
              ) : (
                selectedDateBookings.map((booking) => {
                  const renter = getRenterProfile(booking.renter);
                  const tone = getBookingStatusTone(booking);
                  const extension = getExtensionRequestInfo(booking);
                  const lateReturn = getLateReturnInfo(booking);

                  return (
                    <div key={booking._id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start gap-3">
                        <DashboardVehicleThumbnail vehicle={booking.vehicle} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-base font-semibold text-slate-900">{booking.vehicle?.name || "Vehicle"}</p>
                              <p className="truncate text-sm text-slate-500">{renter.displayName}</p>
                            </div>
                            <StatusChip tone={tone} />
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-3 text-sm text-slate-700 sm:grid-cols-2">
                            <InfoLine label="Pickup" value={`${formatShortDate(booking.pickupAt)} • ${formatShortTime(booking.pickupAt)}`} />
                            <InfoLine label="Return" value={`${formatShortDate(booking.returnAt)} • ${formatShortTime(booking.returnAt)}`} />
                            <InfoLine label="Renter" value={renter.email || "No email provided"} />
                            <InfoLine label="Status" value={tone.label} />
                          </div>

                          {extension.status === "requested" && (
                            <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-4">
                              <div className="grid grid-cols-1 gap-3 text-sm text-slate-700 sm:grid-cols-2">
                                <InfoLine label="Current Return Date" value={formatShortDate(extension.currentReturnAt)} />
                                <InfoLine label="Requested Return Date" value={formatShortDate(extension.requestedReturnAt)} />
                                <InfoLine label="Additional Rental Fee" value={formatExtensionFee(booking, extension)} />
                                <InfoLine label="Status" value="Pending" />
                              </div>
                              {extension.requestNote && (
                                <p className="mt-3 text-sm text-slate-600">
                                  <span className="font-semibold text-slate-800">Reason:</span> {extension.requestNote}
                                </p>
                              )}
                              <div className="mt-4 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={reviewingExtensionId === booking._id}
                                  onClick={() => reviewExtensionRequest(booking, "approve")}
                                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                                >
                                  <CircleCheck size={18} strokeWidth={2} aria-hidden="true" />
                                  Approve Extension
                                </button>
                                <button
                                  type="button"
                                  disabled={reviewingExtensionId === booking._id}
                                  onClick={() => reviewExtensionRequest(booking, "reject")}
                                  className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                                >
                                  <CircleX size={18} strokeWidth={2} aria-hidden="true" />
                                  Decline Extension
                                </button>
                              </div>
                            </div>
                          )}

                          {lateReturn.isOverdue && (
                            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                              This vehicle is overdue by {Math.max(1, Math.ceil(lateReturn.overdueMinutes / (24 * 60)))} day(s).
                            </div>
                          )}

                          {extension.status === "none" && String(booking.status || "").toLowerCase() === "pending" && (
                            <div className="mt-4 flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={updatingBookingId === booking._id}
                                onClick={() => updateBookingStatus(booking._id, "confirmed")}
                                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                              >
                                <CircleCheck size={18} strokeWidth={2} aria-hidden="true" />
                                Approve Booking
                              </button>
                              <button
                                type="button"
                                disabled={updatingBookingId === booking._id}
                                onClick={() => updateBookingStatus(booking._id, "rejected")}
                                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                              >
                                <CircleX size={18} strokeWidth={2} aria-hidden="true" />
                                Decline Booking
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* ── Extension Review Modal ───────────────────── */}
      {extensionReviewBooking && (
        <Modal onClose={() => { setExtensionReviewBooking(null); setReviewError(""); }} title="Review Extension Request">
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <DashboardVehicleThumbnail vehicle={extensionReviewBooking.vehicle} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-slate-900">{extensionReviewBooking.vehicle?.name || "Vehicle"}</p>
                <p className="truncate text-sm text-slate-500">{getRenterProfile(extensionReviewBooking.renter).displayName}</p>
                <p className="mt-2 text-sm text-slate-600">
                  Status: <span className="font-semibold text-violet-700">Pending</span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-slate-700 sm:grid-cols-2">
              <InfoLine label="Vehicle Name" value={extensionReviewBooking.vehicle?.name || "Vehicle"} />
              <InfoLine label="Current Return Date" value={formatShortDate(getExtensionRequestInfo(extensionReviewBooking).currentReturnAt)} />
              <InfoLine label="Requested Return Date" value={formatShortDate(getExtensionRequestInfo(extensionReviewBooking).requestedReturnAt)} />
              <InfoLine label="Additional Rental Fee" value={formatExtensionFee(extensionReviewBooking, getExtensionRequestInfo(extensionReviewBooking))} />
            </div>

            {getExtensionRequestInfo(extensionReviewBooking).requestNote && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                <span className="font-semibold text-slate-800">Reason:</span> {getExtensionRequestInfo(extensionReviewBooking).requestNote}
              </div>
            )}

            {reviewError && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{reviewError}</p>}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={reviewingExtensionId === extensionReviewBooking._id}
                onClick={() => reviewExtensionRequest(extensionReviewBooking, "approve")}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                <CircleCheck size={18} strokeWidth={2} aria-hidden="true" />
                Approve Extension
              </button>
              <button
                type="button"
                disabled={reviewingExtensionId === extensionReviewBooking._id}
                onClick={() => reviewExtensionRequest(extensionReviewBooking, "reject")}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
              >
                <CircleX size={18} strokeWidth={2} aria-hidden="true" />
                Decline Extension
              </button>
            </div>
          </div>
        </Modal>
      )}

      {renterRequestReview && (
        <Modal onClose={() => { setRenterRequestReview(null); setReviewError(""); }} title={`Review ${renterRequestReview.label}`}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <DashboardVehicleThumbnail vehicle={renterRequestReview.booking.vehicle} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-slate-900">
                  {renterRequestReview.booking.vehicle?.name || "Vehicle"}
                </p>
                <p className="truncate text-sm text-slate-500">
                  {getRenterProfile(renterRequestReview.booking.renter).displayName}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  Status: <span className="font-semibold text-[#017FE6]">Pending review</span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 text-sm text-slate-700 sm:grid-cols-2">
              <InfoLine label="Request" value={renterRequestReview.label} />
              <InfoLine label="Requested" value={formatDateTime(renterRequestReview.requestedAt)} />
              <InfoLine label="Details" value={renterRequestReview.detail} />
              <InfoLine
                label="Booking Status"
                value={String(renterRequestReview.booking.status || "pending").replace(/\b\w/g, (letter) => letter.toUpperCase())}
              />
            </div>

            {renterRequestReview.requestNote && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                <span className="font-semibold text-slate-800">Renter note:</span> {renterRequestReview.requestNote}
              </div>
            )}

            {reviewError && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{reviewError}</p>}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={reviewingRenterRequestKey === renterRequestReview.key}
                onClick={() => reviewRenterRequest(renterRequestReview, "approve")}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                <CircleCheck size={18} strokeWidth={2} aria-hidden="true" />
                {renterRequestReview.type === "booking"
                  ? "Approve Booking"
                  : renterRequestReview.type === "cancellation"
                    ? "Approve Cancellation"
                    : renterRequestReview.type === "return"
                      ? "Confirm Vehicle Received"
                      : "Approve Walk-in"}
              </button>
              <button
                type="button"
                disabled={reviewingRenterRequestKey === renterRequestReview.key}
                onClick={() => {
                  if (renterRequestReview.type === "return") {
                    setReturnReviewNote("");
                    setReviewError("");
                    setReturnDeclineRequest(renterRequestReview);
                    setRenterRequestReview(null);
                  } else {
                    reviewRenterRequest(renterRequestReview, "reject");
                  }
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
              >
                <CircleX size={18} strokeWidth={2} aria-hidden="true" />
                {renterRequestReview.type === "booking"
                  ? "Decline Booking"
                  : renterRequestReview.type === "cancellation"
                    ? "Decline Cancellation"
                    : renterRequestReview.type === "return"
                      ? "Decline Return Request"
                      : "Decline Walk-in"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <ReturnReviewModal
        review={returnDeclineRequest && { booking: returnDeclineRequest.booking, action: "decline" }}
        note={returnReviewNote}
        error={returnDeclineRequest ? reviewError : ""}
        loading={Boolean(returnDeclineRequest) && reviewingRenterRequestKey === returnDeclineRequest.key}
        onNoteChange={setReturnReviewNote}
        onClose={() => {
          if (reviewingRenterRequestKey === returnDeclineRequest?.key) return;
          setReturnDeclineRequest(null);
          setReturnReviewNote("");
          setReviewError("");
        }}
        onSubmit={() => reviewRenterRequest(returnDeclineRequest, "reject", returnReviewNote)}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Sub-Components
   ═══════════════════════════════════════════════════════ */

function Panel({ children, className = "" }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.055)] sm:p-5 ${className}`}>
      {children}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  subtitle,
  icon,
  iconClassName = "",
  onAction,
  isValueVisible,
  onToggleValueVisibility,
}) {
  const SummaryIcon = icon;
  const hasVisibilityToggle = typeof onToggleValueVisibility === "function";

  return (
    <Panel className="h-full !p-3 sm:!p-4">
      <div className="relative flex h-full flex-col gap-3 sm:flex-row sm:items-start xl:gap-2">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10 ${iconClassName}`}>
          <SummaryIcon className="h-4 w-4 sm:h-[18px] sm:w-[18px] min-[1400px]:h-5 min-[1400px]:w-5" strokeWidth={2} aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2">
            <p className={`text-sm font-bold leading-5 text-slate-900 sm:text-base sm:leading-6 min-[1400px]:text-lg ${hasVisibilityToggle ? "sm:pr-11" : ""}`}>{title}</p>
            {hasVisibilityToggle && (
              <button
                type="button"
                onClick={onToggleValueVisibility}
                className="absolute right-0 top-0 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#017FE6]/40"
                aria-label={isValueVisible ? `Hide ${title}` : `Show ${title}`}
                title={isValueVisible ? `Hide ${title}` : `Show ${title}`}
              >
                {isValueVisible ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            )}
          </div>
          <p className={`mt-1 break-words font-semibold tracking-tight text-slate-900 ${hasVisibilityToggle ? "text-lg sm:pr-12 sm:text-2xl xl:text-lg min-[1400px]:text-2xl" : "text-xl sm:text-2xl"}`}>{value}</p>
          {subtitle && (
            <button
              type="button"
              onClick={onAction}
              className="mt-auto inline-flex min-h-11 items-center justify-between gap-1 pt-3 text-left text-xs font-semibold leading-4 text-[#017FE6] transition hover:text-[#0168be] sm:justify-start sm:pt-2"
              aria-label={subtitle}
            >
              {subtitle}
              <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}

function SectionViewAllFooter({ label, onClick, pushToBottom = false }) {
  return (
    <div className={`${pushToBottom ? "mt-auto" : "mt-4"} border-t border-slate-200/80 pt-4`}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 text-sm font-semibold text-[#017FE6] transition hover:text-[#0168be]"
      >
        {label}
        <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

function DashboardActionRow({
  icon,
  tone = "bg-slate-100 text-slate-600",
  label,
  vehicleName,
  renterName,
  actionLabel,
  actionIsBadge = false,
  onClick,
}) {
  const ActionIcon = icon;
  const actionTextClass = tone.split(" ").find((className) => className.startsWith("text-")) || "text-[#017FE6]";

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/30"
    >
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tone}`}>
        <ActionIcon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-900">{label}</p>
        <p className="truncate text-sm font-semibold text-slate-700">{vehicleName}</p>
        <p className="truncate text-xs text-slate-500">{renterName}</p>
      </div>
      {actionLabel && (
        <span
          className={
            actionIsBadge
              ? `shrink-0 rounded-lg px-3 py-1 text-xs font-semibold ${tone}`
              : `shrink-0 text-sm font-semibold ${actionTextClass}`
          }
        >
          {actionLabel}
        </span>
      )}
      <ChevronRight size={16} className="shrink-0 text-slate-500" />
    </button>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function EmptyState({ message, icon, compact = false, fill = false }) {
  const EmptyIcon = icon;

  return (
    <div className={`flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center ${compact ? "px-4 py-6" : "px-6 py-10"} ${fill ? "min-h-0 flex-1" : ""}`}>
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm">
        <EmptyIcon size={18} />
      </div>
      <p className="mt-3 text-sm text-slate-500">{message}</p>
    </div>
  );
}

function StatusChip({ tone }) {
  const Icon = tone.icon;
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${tone.className}`}>
      <Icon size={16} strokeWidth={2} aria-hidden="true" />
      {tone.label}
    </span>
  );
}

function InfoLine({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm text-slate-900">{value}</p>
    </div>
  );
}

function DashboardVehicleThumbnail({ vehicle }) {
  return (
    <VehicleThumbnail
      vehicle={vehicle}
      className="h-16 w-24 shrink-0 overflow-hidden rounded-xl sm:h-20 sm:w-32"
    />
  );
}

function ActivityDescription({ description, vehicleName }) {
  switch (description) {
    case "was returned":
      return <><span className="font-bold">{vehicleName}</span> was returned</>;
    case "Extension request":
      return <>Extension request for <span className="font-bold">{vehicleName}</span></>;
    case "Extension Approved":
      return <>Extension approved for <span className="font-bold">{vehicleName}</span></>;
    case "Extension Declined":
      return <>Extension declined for <span className="font-bold">{vehicleName}</span></>;
    case "Overdue Vehicle":
      return <><span className="font-bold">{vehicleName}</span> is overdue</>;
    case "Booking Cancelled":
      return <>Booking cancelled for <span className="font-bold">{vehicleName}</span></>;
    case "Booking approved":
      return <>Booking approved for <span className="font-bold">{vehicleName}</span></>;
    case "New booking request":
      return <>New booking request for <span className="font-bold">{vehicleName}</span></>;
    case "Payment received":
      return <>Payment received</>;
    default:
      return <>{description} for <span className="font-bold">{vehicleName}</span></>;
  }
}

function Modal({ title, description = "Simple, readable booking details.", children, onClose }) {
  return (
    <ModalPortal>
    <div className="rp-modal-layer">
      <button type="button" className="rp-modal-backdrop" onClick={onClose} aria-label="Close dashboard dialog" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.3)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <p className="text-lg font-semibold text-slate-900">{title}</p>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rp-icon-button"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[calc(92vh-76px)] overflow-y-auto p-5 sm:p-6">{children}</div>
      </div>
    </div>
    </ModalPortal>
  );
}

function ViewAllDashboardModal({
  section,
  onClose,
  onNavigate,
  onReviewRequest,
  vehicles,
  bookings,
  earningsBookings,
  isRevenueVisible,
  today,
  tasks,
  renterRequests,
}) {
  const activeRentals = bookings.filter((booking) =>
    ["confirmed", "extended"].includes(String(booking?.status || "").toLowerCase())
  );
  const todayEarnings = earningsBookings.filter((booking) => {
    const earnedAt = getBookingEarnedAt(booking);
    return earnedAt && sameDay(earnedAt, today);
  });

  const itemsBySection = {
    vehicles,
    rentals: activeRentals,
    requests: renterRequests,
    earnings: todayEarnings,
    tasks,
  };
  const detailsBySection = {
    vehicles: {
      title: "All Vehicles",
      description: "Review every vehicle in your fleet.",
      emptyMessage: "No vehicles found.",
      emptyIcon: CarFront,
      itemName: "vehicle",
      page: "Vehicles",
      actionLabel: "Open vehicle management",
    },
    rentals: {
      title: "Active Rentals",
      description: "Review all vehicles that are currently out on rental.",
      emptyMessage: "No active rentals right now.",
      emptyIcon: CalendarRange,
      itemName: "active rental",
      page: "Bookings",
      actionLabel: "Open bookings",
    },
    requests: {
      title: "Renter Requests",
      description: "Review every pending renter request from one place.",
      emptyMessage: "No renter requests right now.",
      emptyIcon: Inbox,
      itemName: "renter request",
      page: "Bookings",
      actionLabel: "Open bookings",
    },
    earnings: {
      title: "Revenue Today",
      description: "Review payments recorded today.",
      emptyMessage: "No payments have been recorded today.",
      emptyIcon: Wallet,
      itemName: "payment",
      page: "Earnings",
      actionLabel: "Open earnings",
    },
    tasks: {
      title: "Today's Tasks",
      description: "Review every task that needs attention today.",
      emptyMessage: "No scheduled tasks today.",
      emptyIcon: ListTodo,
      itemName: "task",
      page: "Bookings",
      actionLabel: "Open bookings",
    },
  };

  const details = detailsBySection[section];
  const items = itemsBySection[section] || [];
  if (!details) return null;

  let cards = null;
  if (section === "vehicles") {
    cards = items.map((vehicle, index) => (
      <DashboardVehicleCard key={vehicle?._id || `vehicle-${index}`} vehicle={vehicle} />
    ));
  } else if (section === "rentals") {
    cards = items.map((booking, index) => (
      <DashboardBookingCard key={booking?._id || `rental-${index}`} booking={booking} />
    ));
  } else if (section === "requests") {
    cards = items.map((request) => (
      <DashboardRequestCard key={request.key} request={request} onReviewRequest={onReviewRequest} />
    ));
  } else if (section === "earnings") {
    cards = items.map((booking, index) => (
      <DashboardEarningsCard
        key={booking?._id || `earning-${index}`}
        booking={booking}
        isRevenueVisible={isRevenueVisible}
      />
    ));
  } else if (section === "tasks") {
    cards = items.map((task, index) => (
      <DashboardTaskCard key={`${task.type}-${task.booking?._id || index}`} task={task} />
    ));
  }

  const itemLabel = `${items.length} ${items.length === 1 ? details.itemName : `${details.itemName}s`}`;

  return (
    <Modal title={details.title} description={details.description} onClose={onClose}>
      <div className="space-y-3">
        {items.length === 0 ? <EmptyState message={details.emptyMessage} icon={details.emptyIcon} /> : cards}
      </div>

      <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-slate-600">{itemLabel}</p>
        <button
          type="button"
          onClick={() => {
            onClose();
            onNavigate(details.page);
          }}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-[#017FE6] transition hover:border-blue-200 hover:bg-blue-50"
        >
          {details.actionLabel}
          <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </Modal>
  );
}

function DashboardVehicleCard({ vehicle }) {
  const availability = String(vehicle?.availabilityStatus || "available").toLowerCase();
  const isAvailable = availability === "available";
  const vehicleType = formatVehicleTypeLabel(vehicle?.specs?.type, vehicle?.specs?.subType, {
    separator: " • ",
    fallback: "",
  });
  const details = [vehicleType || "Vehicle", vehicle?.location].filter(Boolean).join(" • ");
  const rate = Number(vehicle?.dailyRentalRate || 0);
  const rateUnit = vehicle?.pricingUnit === "daily" ? "day" : "hour";

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
      <DashboardVehicleThumbnail vehicle={vehicle} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-slate-900">{vehicle?.name || "Vehicle"}</p>
        <p className="mt-1 truncate text-sm text-slate-500">{details || "Vehicle details unavailable"}</p>
      </div>
      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            isAvailable ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
          }`}
        >
          {isAvailable ? "Available" : "Unavailable"}
        </span>
        <p className="text-sm font-semibold text-slate-700">
          {money(rate)}/{rateUnit}
        </p>
      </div>
    </article>
  );
}

function DashboardBookingCard({ booking }) {
  const renter = getRenterProfile(booking?.renter);
  const tone = getBookingStatusTone(booking);

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
      <DashboardVehicleThumbnail vehicle={booking?.vehicle} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-slate-900">{booking?.vehicle?.name || "Vehicle"}</p>
        <p className="mt-1 truncate text-sm text-slate-500">{renter.displayName}</p>
        <p className="mt-1 text-xs font-medium text-slate-500">
          Return: {formatShortDate(booking?.returnAt)} • {formatShortTime(booking?.returnAt)}
        </p>
      </div>
      <StatusChip tone={tone} />
    </article>
  );
}

function DashboardTaskCard({ task }) {
  const renter = getRenterProfile(task?.booking?.renter);
  const TaskIcon = taskIconOverrides[task?.type] || task?.icon || CalendarDays;

  return (
    <article className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${task?.tone || "bg-slate-100 text-slate-600"}`}>
        <TaskIcon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-900">{task?.label || "Scheduled task"}</p>
        <p className="truncate text-sm font-semibold text-slate-700">{task?.booking?.vehicle?.name || "Vehicle"}</p>
        <p className="truncate text-xs text-slate-500">{renter.displayName}</p>
      </div>
      <span className="shrink-0 text-sm font-semibold text-[#017FE6]">{task?.value || "Review"}</span>
    </article>
  );
}

function DashboardRequestCard({ request, onReviewRequest }) {
  const renter = getRenterProfile(request?.booking?.renter);
  const RequestIcon = request?.icon || CircleDot;

  return (
    <button
      type="button"
      onClick={() => onReviewRequest(request)}
      className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/30"
    >
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${request?.tone || "bg-slate-100 text-slate-600"}`}>
        <RequestIcon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-900">{request?.label || "Renter Request"}</p>
        <p className="truncate text-sm font-semibold text-slate-700">{request?.booking?.vehicle?.name || "Vehicle"}</p>
        <p className="truncate text-xs text-slate-500">
          {renter.displayName} • {formatRelativeActivityTime(request?.requestedAt)}
        </p>
      </div>
      <span className="shrink-0 text-sm font-semibold text-[#017FE6]">Review</span>
      <ChevronRight size={16} className="shrink-0 text-slate-400" />
    </button>
  );
}

function DashboardEarningsCard({ booking, isRevenueVisible }) {
  const renter = getRenterProfile(booking?.renter);
  const earnedAt = getBookingEarnedAt(booking);
  const paymentStatus = String(booking?.paymentStatus || "paid").replace(/\b\w/g, (letter) => letter.toUpperCase());

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
      <DashboardVehicleThumbnail vehicle={booking?.vehicle} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-slate-900">{booking?.vehicle?.name || "Vehicle"}</p>
        <p className="mt-1 truncate text-sm text-slate-500">{renter.displayName}</p>
        <p className="mt-1 text-xs font-medium text-slate-500">{formatRelativeActivityTime(earnedAt)}</p>
      </div>
      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
        <p className="text-base font-semibold text-emerald-700">
          {isRevenueVisible ? money(getBookingAmountEarned(booking)) : "\u20b1\u2022\u2022\u2022\u2022\u2022\u2022"}
        </p>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">{paymentStatus}</span>
      </div>
    </article>
  );
}
