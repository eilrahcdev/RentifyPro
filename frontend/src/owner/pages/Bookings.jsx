import VehicleThumbnail from "../../components/VehicleThumbnail";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CarFront, Clock3, CreditCard, Flag, MapPin, RefreshCw, Users } from "lucide-react";
import API from "../../utils/api";
import { getSocket } from "../../utils/socket";
import { getTransactionFee } from "../../utils/fees";
import { formatDurationMinutes, getDurationHoursFromMinutes, getDurationMinutesBetween } from "../../utils/dateUtils";
import ReportIssueModal from "../../components/ReportIssueModal";
import PaymentSuccessToast from "../../components/PaymentSuccessToast";
import { showActionToast } from "../../utils/actionToast";
import OwnerPageHeader from "../components/OwnerPageHeader";
import ReturnReviewModal from "../components/ReturnReviewModal";
import HelpLink from "../../components/HelpLink";
import RequestFeedback from "../../components/RequestFeedback";
import { BookingListSkeleton } from "../../components/LoadingSkeletons";
import { bookingStatusLabel, bookingGuidance } from "../../utils/workflowStatus";

const statusFilters = [
  { id: "action", label: "Needs Action" },
  { id: "active", label: "Upcoming & Active" },
  { id: "past", label: "History" },
  { id: "all", label: "All" },
];
const statusStyles = {
  pending: "bg-yellow-100 text-yellow-700",
  confirmed: "bg-blue-100 text-blue-700",
  extended: "bg-violet-100 text-violet-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
  rejected: "bg-red-100 text-red-700",
};
const paymentStyles = {
  unpaid: "bg-gray-200 text-gray-700",
  partial: "bg-orange-100 text-orange-700",
  paid: "bg-green-100 text-green-700",
  refunded: "bg-blue-100 text-blue-700",
};

const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : "-");
const money = (value) =>
  `\u20b1${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
const toTitleCase = (value = "") =>
  String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
const normalizeBookingStatus = (booking) => ({
  ...booking,
  paymentStatus: String(booking.paymentStatus || booking.payment_status || "unpaid").trim().toLowerCase(),
});
const latestBooking = (current, incoming) => {
  const normalized = normalizeBookingStatus(incoming);
  return current && new Date(current.updatedAt).getTime() > new Date(normalized.updatedAt).getTime()
    ? current : normalized;
};
const ACTIVE_BOOKING_STATUSES = ["confirmed", "extended"];
const PAST_BOOKING_STATUSES = ["completed", "cancelled", "rejected"];
const bookingNeedsOwnerAction = (booking) => {
  const status = String(booking?.status || "").toLowerCase();
  return (
    status === "pending" ||
    String(booking?.extensionStatus || booking?.extension_request?.status || "").toLowerCase() === "requested" ||
    String(booking?.cancellationStatus || booking?.cancellation_request?.status || "").toLowerCase() === "requested" ||
    String(booking?.returnStatus || booking?.returnRequest?.status || booking?.return_request?.status || "").toLowerCase() === "requested" ||
    getWalkInStatus(booking) === "requested" ||
    (Boolean(booking?.lateReturn?.isOverdue || booking?.late_return?.isOverdue) &&
      ["confirmed", "extended"].includes(status))
  );
};
const bookingMatchesView = (booking, view) => {
  const status = String(booking?.status || "").toLowerCase();
  if (view === "action") return bookingNeedsOwnerAction(booking);
  if (view === "active") return ACTIVE_BOOKING_STATUSES.includes(status);
  if (view === "past") return PAST_BOOKING_STATUSES.includes(status);
  return true;
};
const getWalkInStatus = (booking) =>
  String(booking?.walkInPayment?.status || booking?.walk_in_payment?.status || "none")
    .trim()
    .toLowerCase();

const getLateReturnInfo = (booking, currentTimeMs = Date.now()) => {
  const lateReturn = booking?.lateReturn || booking?.late_return || {};
  const storedOverdueMinutes = Number(lateReturn?.overdueMinutes || 0);
  const returnAtMs = booking?.returnAt ? new Date(booking.returnAt).getTime() : Number.NaN;
  const graceMinutes = Number(lateReturn?.graceMinutes ?? booking?.lateReturnPolicy?.graceMinutes ?? 0);
  const isFinal =
    String(lateReturn?.action || "").toLowerCase() === "return_confirmed" ||
    String(booking?.status || "").toLowerCase() === "completed" ||
    String(booking?.returnRequest?.status || booking?.return_request?.status || "").toLowerCase() === "confirmed";
  const liveOverdueMinutes =
    Boolean(lateReturn?.isOverdue) && !isFinal && Number.isFinite(returnAtMs)
      ? Math.max(0, Math.round((currentTimeMs - returnAtMs - Math.max(0, graceMinutes) * 60000) / 60000))
      : 0;
  const overdueMinutes = Math.max(
    Number.isFinite(storedOverdueMinutes) ? storedOverdueMinutes : 0,
    liveOverdueMinutes
  );
  const penaltyFee = Number(lateReturn?.penaltyFee || booking?.lateReturnPenaltyFee || 0);
  const penaltyRatePerHour = Number(lateReturn?.penaltyRatePerHour || booking?.lateReturnPenaltyRatePerHour || 0);
  const providedEstimate = Number(lateReturn?.estimatedPenaltyFee);
  const estimatedPenaltyFee =
    !isFinal && penaltyRatePerHour > 0
      ? penaltyRatePerHour * (Math.max(0, overdueMinutes) / 60)
      : Number.isFinite(providedEstimate) && providedEstimate >= 0
      ? providedEstimate
      : penaltyRatePerHour * (Math.max(0, overdueMinutes) / 60);
  return {
    isOverdue: Boolean(lateReturn?.isOverdue),
    overdueMinutes: Number.isFinite(overdueMinutes) && overdueMinutes > 0 ? Math.round(overdueMinutes) : 0,
    penaltyFee: Number.isFinite(penaltyFee) && penaltyFee > 0 ? penaltyFee : 0,
    estimatedPenaltyFee: Number.isFinite(estimatedPenaltyFee) && estimatedPenaltyFee > 0 ? estimatedPenaltyFee : 0,
    penaltyRatePerHour: Number.isFinite(penaltyRatePerHour) && penaltyRatePerHour > 0 ? penaltyRatePerHour : 0,
  };
};

const getExtensionRequestInfo = (booking) => {
  const extension = booking?.extensionRequest || booking?.extension_request || {};
  return {
    status: String(extension?.status || "none").trim().toLowerCase(),
    requestedReturnAt: extension?.requestedReturnAt || null,
    requestNote: String(extension?.requestNote || "").trim(),
    reviewNote: String(extension?.reviewNote || "").trim(),
  };
};
const getReturnRequestInfo = (booking) => {
  const vehicleReturn = booking?.returnRequest || booking?.return_request || {};
  return {
    status: String(vehicleReturn?.status || "none").trim().toLowerCase(),
    requestedAt: vehicleReturn?.requestedAt || null,
    confirmedAt: vehicleReturn?.confirmedAt || booking?.actualReturnAt || null,
    reviewNote: String(vehicleReturn?.reviewNote || "").trim(),
  };
};
const getCancellationRequestInfo = (booking) => {
  const cancellation = booking?.cancellationRequest || booking?.cancellation_request || {};
  return {
    status: String(cancellation?.status || "none").trim().toLowerCase(),
    requestNote: String(cancellation?.requestNote || "").trim(),
    reviewNote: String(cancellation?.reviewNote || "").trim(),
  };
};
const getBookingDurationMinutesForPricing = (booking) => {
  const directMinutes = Number(booking?.bookingDurationMinutes);
  if (Number.isFinite(directMinutes) && directMinutes > 0) return Math.round(directMinutes);

  if (booking?.pickupAt && booking?.returnAt) {
    const rangeMinutes = getDurationMinutesBetween(booking.pickupAt, booking.returnAt);
    if (rangeMinutes > 0) return rangeMinutes;
  }

  const directHours = Number(booking?.bookingDurationHours);
  if (Number.isFinite(directHours) && directHours > 0) return Math.round(directHours * 60);

  const bookingDays = Number(booking?.bookingDays || 0);
  if (Number.isFinite(bookingDays) && bookingDays > 0) return Math.round(bookingDays * 24 * 60);

  return 0;
};

const getRentalTotal = (booking) => {
  const latePenalty = Number(
    booking?.lateReturnPenaltyFee ?? booking?.lateReturn?.penaltyFee ?? booking?.late_return?.penaltyFee ?? 0
  );
  const safeLatePenalty = Number.isFinite(latePenalty) && latePenalty > 0 ? latePenalty : 0;

  const total = Number(booking?.totalAmount);
  if (Number.isFinite(total) && total >= 0) return total + safeLatePenalty;

  const baseAmount = Number(booking?.baseAmount);
  const driverAmount = Number(booking?.driverAmount);
  if (Number.isFinite(baseAmount) && Number.isFinite(driverAmount) && baseAmount + driverAmount >= 0) {
    return baseAmount + driverAmount + safeLatePenalty;
  }

  const durationHours = getDurationHoursFromMinutes(getBookingDurationMinutesForPricing(booking));
  const hourlyRate = Number((booking?.vehicleHourlyRate ?? booking?.vehicleDailyRate) || 0);
  if (Number.isFinite(hourlyRate) && hourlyRate >= 0 && Number.isFinite(durationHours) && durationHours > 0) {
    const driverHourlyRate = Number((booking?.driverHourlyRate ?? booking?.driverDailyRate) || 0);
    const driverSelected = Boolean(booking?.driverSelected);
    const computedDriverAmount =
      driverSelected && Number.isFinite(driverHourlyRate) && driverHourlyRate > 0
        ? driverHourlyRate * durationHours
        : 0;
    return hourlyRate * durationHours + computedDriverAmount + safeLatePenalty;
  }

  const payable = Number(booking?.amountPayable);
  if (Number.isFinite(payable) && payable >= 0) return payable;

  return safeLatePenalty;
};

const getPayableAmount = (booking) => {
  if (booking.amountPayable != null && Number.isFinite(Number(booking.amountPayable))) return Number(booking.amountPayable);
  return getRentalTotal(booking) + Number(booking.transactionFee ?? getTransactionFee());
};

export default function Bookings() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [bookingActions, setBookingActions] = useState({});
  const [actionErrors, setActionErrors] = useState({});
  const actionLocks = useRef(new Set());
  const requestSequence = useRef(0);
  const [statusFilter, setStatusFilter] = useState("action");
  const [bookingClock, setBookingClock] = useState(() => Date.now());
  const [bookingPage, setBookingPage] = useState({ hasMore: false, nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [reportBooking, setReportBooking] = useState(null);
  const [reportNotice, setReportNotice] = useState("");
  const [paymentSuccessToast, setPaymentSuccessToast] = useState(null);
  const [returnReview, setReturnReview] = useState(null);
  const [returnReviewNote, setReturnReviewNote] = useState("");
  const [partialPaymentDraft, setPartialPaymentDraft] = useState(null);

  useEffect(() => {
    const timer = window.setInterval(() => setBookingClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const loadBookings = useCallback(async ({ cursor = null, append = false, background = false } = {}) => {
    const sequence = ++requestSequence.current;
    if (append) setLoadingMore(true);
    else if (background) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await API.getOwnerBookings({
        view: statusFilter,
        limit: 10,
        ...(cursor ? { cursor } : {}),
      });
      const mapped = (response.bookings || []).map(normalizeBookingStatus);
      if (sequence !== requestSequence.current) return;
      setBookings((previous) => {
        const current = new Map(previous.map((booking) => [booking._id, booking]));
        const incoming = mapped.map((booking) => latestBooking(current.get(booking._id), booking));
        return append ? [...previous.filter((booking) => !incoming.some((item) => item._id === booking._id)), ...incoming] : incoming;
      });
      setBookingPage(response.page || { hasMore: false, nextCursor: null });
    } catch (err) {
      if (sequence !== requestSequence.current) return;
      setError(err.message || "Failed to load bookings.");
    } finally {
      if (sequence === requestSequence.current) {
        setLoadingMore(false);
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [statusFilter]);

  useEffect(() => {
    loadBookings();
    return () => { requestSequence.current += 1; };
  }, [loadBookings]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleBookingUpdate = (booking) => {
      setBookings((prev) => {
        const normalized = normalizeBookingStatus(booking);
        const exists = prev.some((item) => item._id === normalized._id);
        if (exists) {
          return prev.map((item) => (item._id === normalized._id ? latestBooking(item, normalized) : item));
        }
        return [normalized, ...prev];
      });
    };

    socket.on("booking:updated", handleBookingUpdate);
    return () => socket.off("booking:updated", handleBookingUpdate);
  }, []);

  const filteredBookings = useMemo(
    () =>
      bookings.filter((booking) => bookingMatchesView(booking, statusFilter)),
    [bookings, statusFilter]
  );

  const runBookingAction = async (bookingId, action, label, fallback, onSuccess) => {
    if (actionLocks.current.has(bookingId)) return false;
    actionLocks.current.add(bookingId);
    setBookingActions((previous) => ({ ...previous, [bookingId]: label }));
    setActionErrors((previous) => ({ ...previous, [bookingId]: "" }));
    setReportNotice("");
    try {
      const response = await action();
      if (response?.success === false) throw new Error(response.message || "The update could not be completed.");
      if (response.booking) setBookings((previous) => previous.map((booking) => booking._id === bookingId ? latestBooking(booking, response.booking) : booking));
      if (onSuccess) onSuccess(response);
      else showActionToast(fallback, { id: `owner-booking-${bookingId}` });
      return true;
    } catch (error) {
      if (error?.details?.booking) {
        setBookings((previous) => previous.map((booking) => booking._id === bookingId ? latestBooking(booking, error.details.booking) : booking));
      }
      setActionErrors((previous) => ({ ...previous, [bookingId]: error.message || "The update could not be completed. Refresh this booking and try again." }));
      return false;
    } finally {
      actionLocks.current.delete(bookingId);
      setBookingActions((previous) => { const next = { ...previous }; delete next[bookingId]; return next; });
    }
  };

  const updateBookingStatus = (id, status) => runBookingAction(id,
    () => API.updateOwnerBookingStatus(id, status),
    status === "confirmed" ? "Approving booking..." : status === "rejected" ? "Rejecting booking..." : "Updating booking...",
    status === "confirmed" ? "Booking approved." : status === "rejected" ? "Booking declined." : "Booking cancelled.");

  const updatePaymentStatus = async (booking, status, paymentAmountPaid) => {
    const saved = await runBookingAction(booking._id,
      () => API.updateOwnerBookingPaymentStatus(booking._id, status, { paymentAmountPaid, expectedUpdatedAt: booking.updatedAt }),
      "Updating payment...", "Payment status updated.");
    if (saved) setPartialPaymentDraft(null);
  };

  const selectPaymentStatus = (booking, status) => {
    if (status === "partial") {
      const paid = Number(booking.paymentAmountPaid || 0);
      setPartialPaymentDraft({ bookingId: booking._id, amount: paid > 0 && paid < getPayableAmount(booking) ? String(paid) : "" });
      return;
    }
    setPartialPaymentDraft(null);
    updatePaymentStatus(booking, status);
  };

  const reviewExtensionRequest = (id, action) => runBookingAction(id,
    () => API.reviewOwnerBookingExtensionRequest(id, action), "Reviewing extension...", action === "approve" ? "Extension approved." : "Extension declined.");

  const reviewCancellationRequest = (id, action) => runBookingAction(id,
    () => API.reviewOwnerBookingCancellationRequest(id, action), "Reviewing cancellation...", action === "approve" ? "Cancellation approved. Booking cancelled." : "Cancellation declined. Booking remains active.");

  const reviewWalkInRequest = (id, action) => runBookingAction(id,
    () => API.reviewOwnerWalkInPaymentRequest(id, action), "Reviewing walk-in payment...", action === "approve" ? "Walk-in request approved. Waiting for renter payment." : "Walk-in request declined.");

  const confirmWalkInPayment = (id) => runBookingAction(id,
    () => API.confirmOwnerWalkInPayment(id), "Confirming payment...", "Walk-in payment confirmed.",
    (response) => {
      if (response.success && response.booking?.paymentStatus === "paid" && getWalkInStatus(response.booking) === "completed") {
        setPaymentSuccessToast((current) => ({
          id: (current?.id || 0) + 1,
          message: "Walk-in payment received.",
        }));
      } else {
        showActionToast(response.message || "Walk-in payment status updated.", { id: `owner-booking-${id}` });
      }
    });

  const openReturnReview = (booking, action) => {
    setReturnReview({ booking, action });
    setReturnReviewNote("");
  };

  const reviewVehicleReturn = async () => {
    const bookingId = returnReview?.booking?._id;
    const action = returnReview?.action;
    if (!bookingId || !["confirm", "decline"].includes(action)) return;
    const saved = await runBookingAction(bookingId,
      () => API.reviewOwnerVehicleReturnRequest(bookingId, action, { note: returnReviewNote }),
      "Saving return decision...", action === "confirm" ? "Vehicle return confirmed." : "Return request declined. Booking remains active.");
    if (saved) { setReturnReview(null); setReturnReviewNote(""); }
  };

  return (
    <div className="space-y-6">
      <OwnerPageHeader
        title="Booking Management"
        description="Review renter requests, active rentals, and payment activity."
        actions={<>
          <HelpLink guide="manage-owner-bookings" className="shrink-0 whitespace-nowrap">
            <span className="xl:hidden">Need help?</span>
            <span className="hidden xl:inline">Need help with booking requests?</span>
          </HelpLink>
          <button type="button" disabled={loading || refreshing || loadingMore} onClick={() => loadBookings({ background: true })} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold disabled:opacity-50"><RefreshCw size={16} strokeWidth={2} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />{refreshing ? "Refreshing..." : "Refresh"}</button>
        </>}
      />

      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {statusFilters.map((status) => (
          <button
            key={status.id}
            onClick={() => setStatusFilter(status.id)}
            className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
              statusFilter === status.id
                ? "bg-[#017FE6] text-white shadow-md shadow-blue-100"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {status.label}
          </button>
        ))}
      </div>

      <RequestFeedback loading={refreshing} label="Refreshing bookings..." error={error} onRetry={() => loadBookings({ background: bookings.length > 0 })} />
      {loading && <BookingListSkeleton />}
      {reportNotice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{reportNotice}</p>}
      {!loading && !error && !filteredBookings.length && (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-[#017FE6]"><CarFront size={24} strokeWidth={2} aria-hidden="true" /></div>
          <h2 className="mt-4 text-lg font-bold text-slate-900">Your queue is clear</h2>
          <p className="mt-1 text-sm text-slate-500">No bookings match this view right now. New renter activity will appear here.</p>
        </div>
      )}

      {!loading && <div className="space-y-4">
        {filteredBookings.map((booking) => {
          const lateReturnInfo = getLateReturnInfo(booking, bookingClock);
          const isEstimatedLatePenalty = lateReturnInfo.penaltyFee <= 0 && lateReturnInfo.estimatedPenaltyFee > 0;
          const displayedLatePenalty =
            lateReturnInfo.penaltyFee > 0 ? lateReturnInfo.penaltyFee : lateReturnInfo.estimatedPenaltyFee;
          const displayedTotalPayment =
            getPayableAmount(booking) + (isEstimatedLatePenalty ? displayedLatePenalty : 0);
          const extensionInfo = getExtensionRequestInfo(booking);
          const returnRequestInfo = getReturnRequestInfo(booking);
          const cancellationInfo = getCancellationRequestInfo(booking);

          return (
          <article key={booking._id} className="group overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-xl hover:shadow-blue-100/70 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 gap-4">
                <VehicleThumbnail vehicle={booking.vehicle} className="h-20 w-24 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-slate-100 to-blue-100 sm:h-24 sm:w-32" imageClassName="transition duration-300 group-hover:scale-105" />
                <div className="min-w-0 py-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#017FE6]">Booking #{String(booking._id || "").slice(-6).toUpperCase()}</p>
                  <h3 className="mt-1 truncate text-xl font-bold text-slate-900">{booking.vehicle?.name || "Vehicle"}</h3>
                  <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-slate-500"><Users size={16} strokeWidth={2} className="text-slate-400" aria-hidden="true" /> {booking.renter?.name || booking.renter?.email || "Renter details unavailable"}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    statusStyles[booking.status] || "bg-gray-100 text-gray-700"
                  }`}
                >
                  {bookingStatusLabel(booking.status)}
                </span>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    paymentStyles[booking.paymentStatus] || "bg-gray-100 text-gray-700"
                  }`}
                >
                  {toTitleCase(booking.paymentStatus)}
                </span>
                {extensionInfo.status !== "none" && (
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      extensionInfo.status === "approved"
                        ? "bg-violet-100 text-violet-700"
                        : extensionInfo.status === "rejected"
                          ? "bg-rose-100 text-rose-700"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    Extension {toTitleCase(extensionInfo.status)}
                  </span>
                )}
                {returnRequestInfo.status !== "none" && (
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    returnRequestInfo.status === "confirmed"
                      ? "bg-emerald-100 text-emerald-700"
                      : returnRequestInfo.status === "declined"
                        ? "bg-rose-100 text-rose-700"
                      : "bg-blue-100 text-blue-700"
                  }`}>
                    Return {toTitleCase(returnRequestInfo.status)}
                  </span>
                )}
                {getWalkInStatus(booking) !== "none" && (
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      getWalkInStatus(booking) === "approved"
                        ? "bg-emerald-100 text-emerald-700"
                        : getWalkInStatus(booking) === "rejected"
                          ? "bg-rose-100 text-rose-700"
                          : getWalkInStatus(booking) === "completed"
                            ? "bg-green-100 text-green-700"
                            : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    Walk-in {toTitleCase(getWalkInStatus(booking))}
                  </span>
                )}
              </div>
            </div>

            <p className="mt-3 text-sm text-slate-600">{bookingGuidance(booking, "owner")}</p>
            <RequestFeedback error={actionErrors[booking._id]} />
            {bookingActions[booking._id] && <p role="status" className="mt-2 text-sm text-blue-700">{bookingActions[booking._id]}</p>}
            <div className="mt-5 grid grid-cols-1 gap-3 border-y border-slate-100 py-4 text-sm md:grid-cols-2 xl:grid-cols-4">
              <Info icon={CalendarDays} title="Pickup" value={formatDateTime(booking.pickupAt)} />
              <Info icon={CalendarDays} title="Return" value={formatDateTime(booking.returnAt)} />
              <Info icon={Clock3} title="Duration" value={formatDurationMinutes(getBookingDurationMinutesForPricing(booking))} />
              <Info icon={MapPin} title="Location" value={booking.vehicle?.location || "-"} />
              <Info title="Vehicle Rate" value={`${money(booking.vehicleHourlyRate ?? booking.vehicleDailyRate)} / hr`} />
              <Info
                title="Driver Option"
                value={
                  booking.driverSelected
                    ? `Yes (${money(booking.driverHourlyRate ?? booking.driverDailyRate)} /hr)`
                    : "No"
                }
              />
              <Info title="Base Amount" value={money(booking.baseAmount)} />
              <Info
                title={isEstimatedLatePenalty ? "Estimated Late Penalty" : "Late Penalty"}
                value={money(displayedLatePenalty)}
              />
              <Info
                icon={CreditCard}
                title={isEstimatedLatePenalty ? "Estimated Total Payment" : "Total Payment"}
                value={money(displayedTotalPayment)}
              />
            </div>

            {lateReturnInfo.isOverdue && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Overdue return notice: renter has not returned the vehicle on time (overdue by{" "}
                {formatDurationMinutes(lateReturnInfo.overdueMinutes)}).
                {lateReturnInfo.penaltyFee > 0
                  ? ` Final late charge: ${money(lateReturnInfo.penaltyFee)}.`
                  : lateReturnInfo.estimatedPenaltyFee > 0
                    ? ` Estimated late charge: ${money(lateReturnInfo.estimatedPenaltyFee)} at ${money(lateReturnInfo.penaltyRatePerHour)} per overdue hour.`
                    : " The snapshotted booking policy has no monetary late charge."}
              </div>
            )}

            {extensionInfo.status === "requested" && (
              <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800">
                Extension request pending review.
                {extensionInfo.requestedReturnAt ? ` Requested return: ${formatDateTime(extensionInfo.requestedReturnAt)}.` : ""}
              </div>
            )}
            {returnRequestInfo.status === "declined" && returnRequestInfo.reviewNote && (
              <p className="mt-3 text-sm text-slate-600">Decline note: {returnRequestInfo.reviewNote}</p>
            )}



            <div className="mt-4 grid min-w-0 grid-cols-1 items-start gap-3 border-t border-slate-100 pt-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <div
                role="group"
                aria-label={`Booking actions for ${booking.vehicle?.name || "vehicle"}. Scroll horizontally for more actions.`}
                tabIndex={0}
                onFocusCapture={(event) => {
                  if (event.target !== event.currentTarget) {
                    event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
                  }
                }}
                className="flex min-w-0 items-center gap-2 overflow-x-auto overscroll-x-contain p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 [&>button]:inline-flex [&>button]:h-11 [&>button]:shrink-0 [&>button]:items-center [&>button]:justify-center [&>button]:whitespace-nowrap [&>button]:focus-visible:outline [&>button]:focus-visible:outline-2 [&>button]:focus-visible:outline-offset-2 [&>button]:focus-visible:outline-blue-600"
              >
                {booking.status === "pending" && (
                  <>
                    <button
                      onClick={() => updateBookingStatus(booking._id, "confirmed")}
                      disabled={Boolean(bookingActions[booking._id])}
                      className="px-3 py-2 rounded-lg bg-green-600 text-white text-sm"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => updateBookingStatus(booking._id, "rejected")}
                      disabled={Boolean(bookingActions[booking._id])}
                      className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm"
                    >
                      Reject
                    </button>
                  </>
                )}
                {returnRequestInfo.status === "requested" && (
                  <>
                    <button
                      onClick={() => openReturnReview(booking, "confirm")}
                      disabled={Boolean(bookingActions[booking._id]) || extensionInfo.status === "requested"}
                      className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Confirm Vehicle Received
                    </button>
                    <button
                      onClick={() => openReturnReview(booking, "decline")}
                      disabled={Boolean(bookingActions[booking._id])}
                      className="px-3 py-2 rounded-lg border border-rose-200 bg-white text-rose-700 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Decline Return Request
                    </button>
                  </>
                )}
                {["pending", "confirmed", "extended"].includes(String(booking.status || "").toLowerCase()) &&
                  returnRequestInfo.status !== "requested" && (
                  <button
                    onClick={() => updateBookingStatus(booking._id, "cancelled")}
                    className="px-3 py-2 rounded-lg bg-gray-700 text-white text-sm"
                  >
                    Cancel
                  </button>
                )}
                {extensionInfo.status === "requested" && (
                  <>
                    <button
                      onClick={() => reviewExtensionRequest(booking._id, "approve")}
                      disabled={Boolean(bookingActions[booking._id])}
                      className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Approve Extension
                    </button>
                    <button
                      onClick={() => reviewExtensionRequest(booking._id, "reject")}
                      disabled={Boolean(bookingActions[booking._id])}
                      className="px-3 py-2 rounded-lg bg-rose-600 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Reject Extension
                    </button>
                  </>
                )}
                {cancellationInfo.status === "requested" && (
                  <>
                    <button
                      onClick={() => reviewCancellationRequest(booking._id, "approve")}
                      disabled={Boolean(bookingActions[booking._id])}
                      className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Approve Cancellation
                    </button>
                    <button
                      onClick={() => reviewCancellationRequest(booking._id, "reject")}
                      disabled={Boolean(bookingActions[booking._id])}
                      className="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Keep Booking
                    </button>
                  </>
                )}

                {getWalkInStatus(booking) === "requested" && (
                  <>
                    <button
                      onClick={() => reviewWalkInRequest(booking._id, "approve")}
                      disabled={Boolean(bookingActions[booking._id])}
                      className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Approve Walk-in
                    </button>
                    <button
                      onClick={() => reviewWalkInRequest(booking._id, "reject")}
                      disabled={Boolean(bookingActions[booking._id])}
                      className="px-3 py-2 rounded-lg bg-rose-600 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Reject Walk-in
                    </button>
                  </>
                )}
                {getWalkInStatus(booking) === "approved" &&
                  String(booking.paymentStatus || "").toLowerCase() === "partial" && (
                    <button
                      onClick={() => confirmWalkInPayment(booking._id)}
                      disabled={Boolean(bookingActions[booking._id])}
                      className="px-3 py-2 rounded-lg bg-[#017FE6] text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Confirm Walk-in Received
                    </button>
                  )}
                <button type="button" onClick={() => setReportBooking(booking)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"><Flag size={18} strokeWidth={2} aria-hidden="true" />Report renter</button>
              </div>

              <div className="flex flex-col gap-2 md:items-end">
                <div className="flex items-center gap-2 p-1">
                <label htmlFor={`payment-status-${booking._id}`} className="text-sm font-medium text-slate-600">Payment</label>
                <select
                  id={`payment-status-${booking._id}`}
                  className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-[#017FE6]"
                  value={booking.paymentStatus}
                  disabled={Boolean(bookingActions[booking._id])}
                  onChange={(e) => selectPaymentStatus(booking, e.target.value)}
                >
                  <option value="unpaid">Unpaid</option>
                  <option value="partial">Partial</option>
                  <option value="paid">Paid</option>
                  <option value="refunded">Refunded</option>
                </select>
                </div>
                {partialPaymentDraft?.bookingId === booking._id && (
                  <form className="w-full max-w-xs space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3" onSubmit={(event) => {
                    event.preventDefault();
                    updatePaymentStatus(booking, "partial", Number(partialPaymentDraft.amount));
                  }}>
                    <label htmlFor={`partial-amount-${booking._id}`} className="block text-sm font-medium text-slate-700">Total amount received so far (PHP)</label>
                    <input id={`partial-amount-${booking._id}`} type="number" inputMode="decimal" min="0.01" max={(getPayableAmount(booking) - 0.01).toFixed(2)} step="0.01" required autoFocus
                      value={partialPaymentDraft.amount} disabled={Boolean(bookingActions[booking._id])}
                      onChange={(event) => setPartialPaymentDraft({ bookingId: booking._id, amount: event.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <p className="text-xs text-slate-600">Full amount payable: {money(getPayableAmount(booking))}. Include earlier payments in the amount received.</p>
                    <div className="flex gap-2">
                      <button type="submit" disabled={Boolean(bookingActions[booking._id])} className="rounded-lg bg-[#017FE6] px-3 py-2 text-sm font-medium text-white disabled:opacity-60">Save partial payment</button>
                      <button type="button" disabled={Boolean(bookingActions[booking._id])} onClick={() => setPartialPaymentDraft(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Cancel</button>
                    </div>
                  </form>
                )}
              </div>
              <div className="space-y-2 empty:hidden md:col-span-2">
                {getWalkInStatus(booking) === "approved" && (
                  <p className="w-full text-xs text-emerald-700">
                    Walk-in request approved. Confirm once remaining balance is received.
                  </p>
                )}
                {extensionInfo.status === "rejected" && extensionInfo.reviewNote && (
                  <p className="w-full text-xs text-slate-600">Extension note: {extensionInfo.reviewNote}</p>
                )}
                {cancellationInfo.status === "rejected" && cancellationInfo.reviewNote && (
                  <p className="w-full text-xs text-slate-600">Cancellation note: {cancellationInfo.reviewNote}</p>
                )}
              </div>
            </div>
          </article>
          );
        })}
      </div>}

      {bookingPage.hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => loadBookings({ cursor: bookingPage.nextCursor, append: true })}
            disabled={loadingMore}
            className="rounded-lg border border-[#017FE6] px-4 py-2 text-sm font-medium text-[#017FE6] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
      <ReportIssueModal booking={reportBooking} perspective="owner" onClose={() => setReportBooking(null)} onSubmitted={(report) => setReportNotice(`Report ${report.caseReference} was submitted for administrator review.`)} />
      <PaymentSuccessToast notice={paymentSuccessToast} />
      <ReturnReviewModal
        review={returnReview}
        note={returnReviewNote}
        error={actionErrors[returnReview?.booking?._id]}
        loading={Boolean(returnReview?.booking?._id) && Boolean(bookingActions[returnReview?.booking?._id])}
        onNoteChange={setReturnReviewNote}
        onClose={() => {
          if (bookingActions[returnReview?.booking?._id]) return;
          setReturnReview(null);
          setReturnReviewNote("");
        }}
        onSubmit={reviewVehicleReturn}
      />
    </div>
  );
}

function Info({ title, value, icon: Icon }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">{Icon && <Icon size={16} strokeWidth={2} className="text-[#017FE6]" aria-hidden="true" />}{title}</p>
      <p className="mt-1 font-semibold text-slate-800">{value}</p>
    </div>
  );
}
