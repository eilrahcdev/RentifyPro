import VehicleThumbnail from "../components/VehicleThumbnail";
import BookingDetails, { BookingInfo as Info } from "../components/BookingDetails";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RequestFeedback from "../components/RequestFeedback";
import { BookingListSkeleton } from "../components/LoadingSkeletons";
import { bookingStatusLabel, bookingGuidance } from "../utils/workflowStatus";
import {
  CalendarDays,
  CarFront,
  CircleCheck,
  Clock3,
  Flag,
  History,
  MapPin,
  MessageCircle,
  EllipsisVertical,
  Pencil,
  RefreshCw,
  Send,
  Star,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import API from "../utils/api";
import { getSocket } from "../utils/socket";
import Navbar from "../components/Navbar";
import HelpLink from "../components/HelpLink";
import BookingAccessModal from "../components/BookingAccessModal";
import BookingReviewModal from "../components/BookingReviewModal";
import ChatWidget from "../components/ChatWidget";
import { requestLiveCountersRefresh } from "../utils/liveCounters";
import { getTransactionFee } from "../utils/fees";
import { getSessionUser } from "../utils/sessionStore";
import {
  formatDateInput,
  formatDurationMinutes,
  formatTimeInput,
  getMaxBookingDate,
  getInitialsFromName,
  getDateTime,
  getDurationHoursFromMinutes,
  getDurationMinutesBetween,
} from "../utils/dateUtils";
import { resolveAssetUrl } from "../utils/media";
import ReportIssueModal from "../components/ReportIssueModal";
import MessageReportModal from "../components/MessageReportModal";
import ChatMessageInput from "../components/ChatMessageInput";
import AutoResizeTextarea from "../components/AutoResizeTextarea";
import ModalPortal from "../components/ModalPortal";
import PaymentSuccessToast from "../components/PaymentSuccessToast";
import { showActionToast } from "../utils/actionToast";

const statusStyles = {
  pending: "bg-amber-100 text-amber-800 border border-amber-200",
  confirmed: "bg-blue-100 text-blue-800 border border-blue-200",
  extended: "bg-violet-100 text-violet-800 border border-violet-200",
  completed: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  cancelled: "bg-rose-100 text-rose-800 border border-rose-200",
  rejected: "bg-rose-100 text-rose-800 border border-rose-200",
};

const DOWNPAYMENT_RATE = 0.3;
const CURRENT_BOOKING_STATUSES = ["pending", "confirmed", "extended"];
const ACTIVE_BOOKING_STATUSES = ["confirmed", "extended"];
const PAST_BOOKING_STATUSES = ["completed", "cancelled", "rejected"];
const BOOKING_NAVIGATION_STORAGE_KEY = "rentifypro:booking-navigation";
const REVIEW_PROMPT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const reviewPromptKey = (userId, bookingId) => `rentifypro:review-prompt:${userId}:${bookingId}`;

const isRecentReturnedBooking = (booking) => {
  if (booking?.status !== "completed" || booking?.reviewRating || !booking?.actualReturnAt) return false;
  const returnedAt = new Date(booking.actualReturnAt).getTime();
  const age = Date.now() - returnedAt;
  return Number.isFinite(age) && age >= 0 && age <= REVIEW_PROMPT_WINDOW_MS &&
    getOutstandingBalance(booking) <= 0 &&
    !["requested", "approved"].includes(getWalkInStatus(booking));
};

const getInitialBookingView = () => {
  try {
    const value = JSON.parse(sessionStorage.getItem(BOOKING_NAVIGATION_STORAGE_KEY) || "{}");
    sessionStorage.removeItem(BOOKING_NAVIGATION_STORAGE_KEY);
    const requestedView = value?.view === "current" ? "active" : value?.view;
    return ["active", "unsettled", "history", "all"].includes(requestedView) ? requestedView : "active";
  } catch {
    return "active";
  }
};

const bookingMatchesView = (booking, view) => {
  const status = String(booking?.status || "").toLowerCase();
  if (view === "current") return CURRENT_BOOKING_STATUSES.includes(status);
  if (view === "active") return ACTIVE_BOOKING_STATUSES.includes(status);
  if (view === "unsettled") return isBookingUnsettled(booking);
  if (view === "history") return PAST_BOOKING_STATUSES.includes(status);
  if (view === "all") return true;
  return status === view;
};

const getBookingDisplayState = (booking, { unsettled = false } = {}) => {
  const status = String(booking?.status || "").trim().toLowerCase();
  const payment = String(booking?.paymentStatus || "").trim().toLowerCase();
  const isOverdue = Boolean(booking?.lateReturn?.isOverdue || booking?.late_return?.isOverdue);
  const bookingLabel = bookingStatusLabel(status);

  if (isOverdue && ["confirmed", "extended"].includes(status)) {
    return { label: `${bookingLabel} · Overdue`, tone: "overdue" };
  }

  if (unsettled) return { label: bookingLabel, tone: status };

  const paymentLabel = {
    unpaid: "Unpaid",
    partial: "Partial payment",
    paid: "Paid",
    refunded: "Refunded",
  }[payment];

  return {
    label: paymentLabel ? `${bookingLabel} · ${paymentLabel}` : bookingLabel,
    tone: status,
  };
};

const renterViewMeta = {
  current: { label: "Current bookings", description: "Your pending, upcoming, and active rentals", icon: CalendarDays },
  active: { label: "Active bookings", description: "Your approved and ongoing rentals", icon: CalendarDays },
  unsettled: { label: "Unsettled bookings", description: "Balances that are due or awaiting walk-in settlement", icon: WalletCards },
  history: { label: "Booking history", description: "Your completed, cancelled, and declined rentals", icon: History },
  all: { label: "All bookings", description: "Every reservation in one place", icon: CarFront },
  pending: { label: "Awaiting approval", description: "Reservations waiting on the owner", icon: Clock3 },
  confirmed: { label: "Confirmed trips", description: "Ready for your next drive", icon: CircleCheck },
  extended: { label: "Extended trips", description: "Rentals with an updated return time", icon: Clock3 },
  completed: { label: "Completed trips", description: "Trips you have already finished", icon: CircleCheck },
  cancelled: { label: "Cancelled trips", description: "Cancelled or declined reservations", icon: History },
};

const money = (value) =>
  `\u20b1${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
const moneyWithCents = (value) =>
  `\u20b1${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const formatDate = (value) => (value ? new Date(value).toLocaleString() : "-");
const toTitleCase = (value = "") =>
  String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
const getOwnerDisplayName = (booking) => {
  const owner = booking?.owner || {};
  return String(owner.name || owner.email || "").trim() || "Owner";
};
const appendUniqueMessage = (list, message) =>
  list.some((item) => item._id === message._id) ? list : [...list, message];
const replaceMessageById = (list, message) =>
  list.map((item) => (item._id === message._id ? { ...item, ...message } : item));
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

const getLateReturnPenaltyFee = (booking) => {
  const latePenaltyFee = Number(
    booking?.lateReturnPenaltyFee ?? booking?.lateReturn?.penaltyFee ?? booking?.late_return?.penaltyFee ?? 0
  );
  return Number.isFinite(latePenaltyFee) && latePenaltyFee > 0 ? roundCurrency(latePenaltyFee) : 0;
};

const getBookingTransactionFee = (booking) => {
  const persistedFee = Number(booking?.transactionFee);
  return Number.isFinite(persistedFee) && persistedFee >= 0
    ? roundCurrency(persistedFee)
    : getTransactionFee();
};

const getBaseRentalTotal = (booking) => {
  const latePenaltyFee = getLateReturnPenaltyFee(booking);

  const total = Number(booking?.totalAmount);
  if (Number.isFinite(total) && total >= 0) return roundCurrency(total);

  const baseAmount = Number(booking?.baseAmount);
  const driverAmount = Number(booking?.driverAmount);
  if (Number.isFinite(baseAmount) && Number.isFinite(driverAmount) && baseAmount + driverAmount > 0) {
    return roundCurrency(baseAmount + driverAmount);
  }

  const durationHours = getDurationHoursFromMinutes(getBookingDurationMinutesForPricing(booking));
  const vehicleHourlyRate = Number((booking?.vehicleHourlyRate ?? booking?.vehicleDailyRate) || 0);
  if (Number.isFinite(vehicleHourlyRate) && vehicleHourlyRate > 0 && Number.isFinite(durationHours) && durationHours > 0) {
    const driverHourlyRate = Number((booking?.driverHourlyRate ?? booking?.driverDailyRate) || 0);
    const driverSelected = Boolean(booking?.driverSelected);
    const driverAmountFromRate =
      driverSelected && Number.isFinite(driverHourlyRate) && driverHourlyRate > 0
        ? driverHourlyRate * durationHours
        : 0;
    return roundCurrency(vehicleHourlyRate * durationHours + driverAmountFromRate);
  }

  const payable = Number(booking?.amountPayable);
  if (Number.isFinite(payable) && payable >= 0) {
    return Math.max(roundCurrency(payable - getBookingTransactionFee(booking) - latePenaltyFee), 0);
  }

  return 0;
};

const getRentalTotal = (booking) =>
  roundCurrency(getBaseRentalTotal(booking) + getLateReturnPenaltyFee(booking));

const getAmountPayable = (booking) => getRentalTotal(booking) + getBookingTransactionFee(booking);

const roundCurrency = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
};

const getPaymentPaidAmount = (booking) => {
  const totalPayable = getAmountPayable(booking);
  const paid = Number(booking?.paymentAmountPaid);
  if (Number.isFinite(paid) && paid > 0) {
    return Math.min(roundCurrency(paid), totalPayable);
  }
  if (String(booking?.paymentStatus || "").toLowerCase() === "paid") {
    return totalPayable;
  }
  return 0;
};

const getPaymentRemainingAmount = (booking) => {
  const totalPayable = getAmountPayable(booking);
  return roundCurrency(Math.max(totalPayable - getPaymentPaidAmount(booking), 0));
};

const getOutstandingBalance = (booking) => {
  if (String(booking?.paymentStatus || "").toLowerCase() === "refunded") return 0;
  const storedDue = Number(booking?.paymentAmountDue || 0);
  const calculatedDue = getPaymentRemainingAmount(booking);
  return roundCurrency(Math.max(Number.isFinite(storedDue) ? storedDue : 0, calculatedDue));
};

const getWalkInStatus = (booking) =>
  String(booking?.walkInPayment?.status || booking?.walk_in_payment?.status || "none")
    .trim()
    .toLowerCase();

function isBookingUnsettled(booking, currentTimeMs = Date.now()) {
  const status = String(booking?.status || "").trim().toLowerCase();
  if (!["confirmed", "extended", "completed"].includes(status)) return false;
  if (getOutstandingBalance(booking) <= 0) return false;

  const walkInStatus = getWalkInStatus(booking);
  if (["requested", "approved"].includes(walkInStatus)) return true;

  const returnStatus = String(
    booking?.returnStatus || booking?.returnRequest?.status || booking?.return_request?.status || ""
  ).trim().toLowerCase();
  const returned = status === "completed" || Boolean(booking?.actualReturnAt) || returnStatus === "confirmed";
  if (returned) return true;

  const returnAtMs = booking?.returnAt ? new Date(booking.returnAt).getTime() : Number.NaN;
  return Number.isFinite(returnAtMs) && currentTimeMs > returnAtMs;
}

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
    penaltyFee: Number.isFinite(penaltyFee) && penaltyFee > 0 ? roundCurrency(penaltyFee) : 0,
    estimatedPenaltyFee:
      Number.isFinite(estimatedPenaltyFee) && estimatedPenaltyFee > 0 ? roundCurrency(estimatedPenaltyFee) : 0,
    penaltyRatePerHour:
      Number.isFinite(penaltyRatePerHour) && penaltyRatePerHour > 0 ? roundCurrency(penaltyRatePerHour) : 0,
    action: String(lateReturn?.action || "none").trim().toLowerCase(),
  };
};

const getExtensionRequestInfo = (booking) => {
  const extension = booking?.extensionRequest || booking?.extension_request || {};
  return {
    status: String(extension?.status || "none").trim().toLowerCase(),
    currentReturnAt: extension?.currentReturnAt || null,
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

const getWalkInStatusMessage = (booking) => {
  const status = getWalkInStatus(booking);
  if (status === "requested") {
    return "Walk-in request pending owner approval.";
  }
  if (status === "approved") {
    return "Your walk-in payment request has been approved. Please pay the remaining balance directly to the owner.";
  }
  if (status === "rejected") {
    return "Walk-in request was rejected by owner. You can request again or pay online.";
  }
  if (status === "completed") {
    return "Walk-in payment confirmed by owner.";
  }
  return "";
};

export default function BookingsPage({
  isLoggedIn,
  user,
  onNavigateToHome,
  onNavigateToSignIn,
  onNavigateToRegister,
  onNavigateToVehicles,
  onNavigateToAbout,
  onNavigateToContacts,
  onNavigateToChat,
  onNavigateToNotifications,
  onOpenNotificationsModal,
  onNavigateToBookingHistory,
  onNavigateToAccountSettings,
  onNavigateToReports,
  onLogout,
}) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const requestSequence = useRef(0);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState(getInitialBookingView);
  const [bookingClock, setBookingClock] = useState(() => Date.now());
  const [bookingPage, setBookingPage] = useState({ hasMore: false, nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [reviewPromptCandidates, setReviewPromptCandidates] = useState([]);
  const [reviewPromptBooking, setReviewPromptBooking] = useState(null);
  const seenReviewPromptKeys = useRef(new Set());
  const autoReviewPromptShownForUser = useRef("");
  const [reportBooking, setReportBooking] = useState(null);
  const [reportNotice, setReportNotice] = useState("");
  const [chatReportMessage, setChatReportMessage] = useState(null);
  const [chatBooking, setChatBooking] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState("");
  const [chatError, setChatError] = useState("");
  const [editingChatMessageId, setEditingChatMessageId] = useState("");
  const [editingChatText, setEditingChatText] = useState("");
  const [savingChatEdit, setSavingChatEdit] = useState(false);
  const [deletingChatMessageId, setDeletingChatMessageId] = useState("");
  const [confirmDeleteChatMessageId, setConfirmDeleteChatMessageId] = useState("");
  const [activeChatMessageActionId, setActiveChatMessageActionId] = useState("");
  const [showDeleteChatConversationConfirm, setShowDeleteChatConversationConfirm] = useState(false);
  const [deletingChatConversation, setDeletingChatConversation] = useState(false);
  const [showAuthPrompt, setShowAuthPrompt] = useState(!isLoggedIn);
  const [payingBookingId, setPayingBookingId] = useState("");
  const [verifyingBookingId, setVerifyingBookingId] = useState("");
  const [paymentRecovery, setPaymentRecovery] = useState(null);
  const [paymentRetrySignal, setPaymentRetrySignal] = useState(0);
  const [paymentErrors, setPaymentErrors] = useState({});
  const [paymentSuccessToast, setPaymentSuccessToast] = useState(null);
  const arrivedFromPayment = useRef(Boolean(new URLSearchParams(window.location.search).get("payment")));
  const toastedCheckoutIds = useRef(new Set());
  const [approvalModalBooking, setApprovalModalBooking] = useState(null);
  const [paymentConfirmBooking, setPaymentConfirmBooking] = useState(null);
  const [extensionModalBooking, setExtensionModalBooking] = useState(null);
  const [cancellationModalBooking, setCancellationModalBooking] = useState(null);
  const [cancellingBookingId, setCancellingBookingId] = useState("");
  const [extensionForm, setExtensionForm] = useState({
    newReturnDate: "",
    newReturnTime: "",
    note: "",
  });
  const [extensionSubmitting, setExtensionSubmitting] = useState(false);
  const [returnRequestSubmittingId, setReturnRequestSubmittingId] = useState("");
  const [paymentPreferences, setPaymentPreferences] = useState({
    scope: "downpayment",
    channel: "",
  });
  const [showAI, setShowAI] = useState(false);
  const currentUserId = user?._id || getSessionUser()?._id || "";

  const hasSeenReviewPrompt = useCallback((bookingId) => {
    const key = reviewPromptKey(currentUserId, bookingId);
    if (seenReviewPromptKeys.current.has(key)) return true;
    try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
  }, [currentUserId]);

  const markReviewPromptSeen = useCallback((bookingId) => {
    const key = reviewPromptKey(currentUserId, bookingId);
    seenReviewPromptKeys.current.add(key);
    try { window.localStorage.setItem(key, "1"); } catch { /* The card action remains available. */ }
  }, [currentUserId]);

  useEffect(() => {
    const timer = window.setInterval(() => setBookingClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async ({ cursor = null, append = false, background = false } = {}) => {
    const sequence = ++requestSequence.current;
    if (append) setLoadingMore(true);
    else if (background) setRefreshing(true);
    else setLoading(true);
    setLoadError("");
    try {
      const bookingResponse = await API.getMyBookings({
        view: statusFilter,
        limit: window.matchMedia("(max-width: 767px)").matches ? 5 : 10,
        ...(cursor ? { cursor } : {}),
      });
      if (sequence !== requestSequence.current) return;
      const normalized = bookingResponse.bookings || [];
      setBookings((previous) => (append ? [...previous, ...normalized] : normalized));
      setBookingPage(bookingResponse.page || { hasMore: false, nextCursor: null });
      requestLiveCountersRefresh();
    } catch (err) {
      if (sequence === requestSequence.current) setLoadError(err.message || "Could not load bookings. Try again in a moment.");
    } finally {
      if (sequence === requestSequence.current) {
        setLoadingMore(false);
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [statusFilter]);

  useEffect(() => {
    if (!isLoggedIn || !currentUserId) return undefined;
    let active = true;
    API.getMyBookings({ view: "history", limit: 10 })
      .then((response) => { if (active) setReviewPromptCandidates(response.bookings || []); })
      .catch(() => { if (active) setReviewPromptCandidates([]); });
    return () => { active = false; };
  }, [isLoggedIn, currentUserId]);

  const upsertBooking = (incomingBooking) => {
    if (!incomingBooking?._id) return;
    const normalized = incomingBooking;
    setBookings((prev) => {
      const exists = prev.some((item) => item._id === normalized._id);
      if (exists) {
        return prev.map((item) => (item._id === normalized._id ? normalized : item));
      }
      return [normalized, ...prev];
    });
  };

  useEffect(() => {
    if (!isLoggedIn) {
      setBookings([]);
      setBookingPage({ hasMore: false, nextCursor: null });
      setChatBooking(null);
      setChatMessages([]);
      setEditingChatMessageId("");
      setEditingChatText("");
      setConfirmDeleteChatMessageId("");
      setActiveChatMessageActionId("");
      setLoading(false);
      setError("");
      setShowAuthPrompt(true);
      return;
    }

    setShowAuthPrompt(false);
    load();
    return () => { requestSequence.current += 1; };
  }, [isLoggedIn, load]);

  useEffect(() => {
    if (!isLoggedIn) return undefined;

    const socket = getSocket();
    if (!socket) return;

    const handleBookingUpdate = (booking) => {
      upsertBooking(booking);
    };

    const handleIncomingMessage = (message) => {
      if (!chatBooking) return;
      const ownerId = String(chatBooking.owner?._id || "");
      const bookingId = String(chatBooking._id || "");
      const messageBookingId = String(message.booking?._id || message.booking || "");
      const senderId = String(message.sender?._id || message.sender);
      const receiverId = String(message.receiver?._id || message.receiver);

      if ([senderId, receiverId].includes(ownerId) && messageBookingId === bookingId) {
        setChatMessages((prev) => appendUniqueMessage(prev, message));
      }
    };

    const handleMessageUpdate = (message) => {
      if (!chatBooking) return;
      const ownerId = String(chatBooking.owner?._id || "");
      const bookingId = String(chatBooking._id || "");
      const senderId = String(message.sender?._id || message.sender);
      const receiverId = String(message.receiver?._id || message.receiver);
      const messageBookingId = String(message.booking?._id || message.booking || "");

      if (![senderId, receiverId].includes(ownerId) || messageBookingId !== bookingId) {
        return;
      }

      setChatMessages((prev) => replaceMessageById(prev, message));
      if (message.isDeleted) {
        setActiveChatMessageActionId((prev) => (prev === String(message._id) ? "" : prev));
        setConfirmDeleteChatMessageId((prev) => (prev === String(message._id) ? "" : prev));
      }
    };

    const handleConversationDeleted = (payload = {}) => {
      if (!chatBooking) return;

      const partnerId = String(payload.partnerId || "");
      const bookingId = String(payload.bookingId || "");
      const activeOwnerId = String(chatBooking.owner?._id || "");
      const activeBookingId = String(chatBooking._id || "");

      if (partnerId !== activeOwnerId) return;
      if (bookingId && bookingId !== activeBookingId) return;

      setChatMessages([]);
      setEditingChatMessageId("");
      setEditingChatText("");
      setConfirmDeleteChatMessageId("");
      setActiveChatMessageActionId("");
    };

    socket.on("booking:updated", handleBookingUpdate);
    socket.on("chat:message", handleIncomingMessage);
    socket.on("chat:message:update", handleMessageUpdate);
    socket.on("chat:conversation:deleted", handleConversationDeleted);
    return () => {
      socket.off("booking:updated", handleBookingUpdate);
      socket.off("chat:message", handleIncomingMessage);
      socket.off("chat:message:update", handleMessageUpdate);
      socket.off("chat:conversation:deleted", handleConversationDeleted);
    };
  }, [isLoggedIn, chatBooking]);

  const filteredBookings = useMemo(
    () =>
      bookings.filter((booking) => bookingMatchesView(booking, statusFilter)),
    [bookings, statusFilter]
  );
  const recoveryBookingPaid = Boolean(
    paymentRecovery && bookings.some((booking) =>
      booking._id === paymentRecovery.bookingId &&
      String(booking.paymentStatus || "").toLowerCase() === "paid"
    )
  );
  const activePaymentRecovery = recoveryBookingPaid ? null : paymentRecovery;

  useEffect(() => {
    if (!isLoggedIn || !currentUserId || loading || loadError || reviewPromptBooking ||
      autoReviewPromptShownForUser.current === currentUserId ||
      arrivedFromPayment.current || activePaymentRecovery || paymentSuccessToast ||
      paymentConfirmBooking || payingBookingId || verifyingBookingId ||
      approvalModalBooking || cancellationModalBooking || extensionModalBooking ||
      reportBooking || chatReportMessage || chatBooking || showAI) return;

    const byId = new Map(reviewPromptCandidates.map((booking) => [String(booking._id), booking]));
    bookings.forEach((booking) => byId.set(String(booking._id), booking));
    const candidate = [...byId.values()]
      .filter((booking) => isRecentReturnedBooking(booking) && !hasSeenReviewPrompt(booking._id))
      .sort((a, b) => new Date(b.actualReturnAt) - new Date(a.actualReturnAt))[0];
    if (!candidate) return;
    autoReviewPromptShownForUser.current = currentUserId;
    markReviewPromptSeen(candidate._id);
    setReviewPromptBooking(candidate);
  }, [isLoggedIn, currentUserId, loading, loadError, reviewPromptBooking, activePaymentRecovery,
    paymentSuccessToast,
    paymentConfirmBooking, payingBookingId, verifyingBookingId, approvalModalBooking,
    cancellationModalBooking, extensionModalBooking, reportBooking, chatReportMessage,
    chatBooking, showAI, bookings, reviewPromptCandidates, hasSeenReviewPrompt, markReviewPromptSeen]);

  useEffect(() => {
    if (!recoveryBookingPaid || !paymentRecovery) return;
    setPaymentRecovery(null);
    setPaymentSuccessToast((current) => current?.kind === "retry" ? null : current);
    setPaymentErrors((previous) => ({ ...previous, [paymentRecovery.bookingId]: "" }));
    const params = new URLSearchParams(window.location.search);
    if (params.get("bookingId") === paymentRecovery.bookingId && params.get("payment") === "success") {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.hash}`);
    }
  }, [recoveryBookingPaid, paymentRecovery]);

  const activeView = renterViewMeta[statusFilter] || renterViewMeta.all;
  const ActiveViewIcon = activeView.icon;

  const confirmCancellation = async () => {
    const bookingId = cancellationModalBooking?._id;
    if (!bookingId || cancellingBookingId) return;

    try {
      setCancellingBookingId(bookingId);
      const response = await API.cancelBooking(bookingId);
      if (response?.success === false) throw new Error(response.message || "Failed to cancel booking.");
      setBookings((prev) =>
        prev.map((booking) => (booking._id === bookingId ? response.booking : booking))
      );
      setCancellationModalBooking(null);
      showActionToast("Booking cancelled.", { id: `renter-booking-${bookingId}` });
    } catch (err) {
      setError(err.message || "Failed to cancel booking.");
    } finally {
      setCancellingBookingId("");
    }
  };

  const openExtensionModal = (booking) => {
    if (!booking?._id) return;
    const currentReturn = booking?.returnAt ? new Date(booking.returnAt) : null;
    const fallback = new Date(Date.now() + 60 * 60 * 1000);
    const suggested = currentReturn && !Number.isNaN(currentReturn.getTime())
      ? new Date(currentReturn.getTime() + 60 * 60 * 1000)
      : fallback;

    setExtensionForm({
      newReturnDate: formatDateInput(suggested),
      newReturnTime: formatTimeInput(suggested),
      note: "",
    });
    setExtensionModalBooking(booking);
  };

  const submitExtensionRequest = async () => {
    const booking = extensionModalBooking;
    if (!booking?._id) return;

    const newReturnAt = getDateTime(extensionForm.newReturnDate, extensionForm.newReturnTime);
    const currentReturnAt = booking?.returnAt ? new Date(booking.returnAt) : null;
    if (!newReturnAt || Number.isNaN(newReturnAt.getTime())) {
      setError("Please provide a valid new return date and time.");
      return;
    }
    if (!currentReturnAt || Number.isNaN(currentReturnAt.getTime())) {
      setError("Current return schedule is invalid for this booking.");
      return;
    }
    if (extensionForm.newReturnDate > getMaxBookingDate()) {
      setError("The extended return must be within 6 months from today.");
      return;
    }
    if (newReturnAt.getTime() <= currentReturnAt.getTime()) {
      setError("New return date/time must be later than the current return schedule.");
      return;
    }

    try {
      setExtensionSubmitting(true);
      setError("");
      const response = await API.requestBookingExtension(booking._id, {
        newReturnAt: newReturnAt.toISOString(),
        note: extensionForm.note || "",
      });
      if (response?.success === false) throw new Error(response.message || "Failed to request booking extension.");
      if (response.booking) {
        upsertBooking(response.booking);
      }
      showActionToast("Extension request sent. Waiting for owner approval.", { id: `renter-booking-${booking._id}`, tone: "info" });
      setExtensionModalBooking(null);
    } catch (err) {
      setError(err.message || "Failed to request booking extension.");
    } finally {
      setExtensionSubmitting(false);
    }
  };

  const handleRequestVehicleReturn = async (booking) => {
    if (!booking?._id) return;
    try {
      setReturnRequestSubmittingId(booking._id);
      setError("");
      const response = await API.requestBookingReturn(booking._id);
      if (response?.success === false) throw new Error(response.message || "Failed to request vehicle return.");
      if (response.booking) {
        upsertBooking(response.booking);
      }
      showActionToast("Vehicle return request sent. Waiting for owner confirmation.", { id: `renter-booking-${booking._id}`, tone: "info" });
    } catch (err) {
      setError(err.message || "Failed to request vehicle return.");
    } finally {
      setReturnRequestSubmittingId("");
    }
  };

  const openChat = async (booking) => {
    if (!booking?.owner?._id) return;
    setChatBooking(booking);
    setChatError("");
    setChatText("");
    setEditingChatMessageId("");
    setEditingChatText("");
    setConfirmDeleteChatMessageId("");
    setActiveChatMessageActionId("");
    setShowDeleteChatConversationConfirm(false);
    try {
      const response = await API.getMessagesWithUser(booking.owner._id, booking._id);
      setChatMessages(response.messages || []);
      await API.markMessagesAsRead(booking.owner._id, { bookingId: booking._id });
      requestLiveCountersRefresh();
    } catch (err) {
      setChatError(err.message || "Failed to load chat.");
    }
  };

  const sendChatMessage = async () => {
    const nextText = chatText.trim();
    if (!chatBooking?.owner?._id || !nextText) return;

    // Do not let this request clear a newer follow-up draft when it resolves.
    setChatText("");
    setChatError("");
    try {
      const response = await API.sendMessageToUser(chatBooking.owner._id, {
        text: nextText,
        bookingId: chatBooking._id,
      });
      setChatMessages((prev) => appendUniqueMessage(prev, response.message));
    } catch (err) {
      setChatText((currentDraft) => currentDraft || nextText);
      setChatError(err.message || "Failed to send message.");
    }
  };

  const startEditChatMessage = (message) => {
    if (!message?._id || message.isDeleted) return;
    setEditingChatMessageId(message._id);
    setEditingChatText(String(message.text || ""));
    setActiveChatMessageActionId("");
  };

  const cancelEditChatMessage = () => {
    setEditingChatMessageId("");
    setEditingChatText("");
  };

  const saveEditedChatMessage = async () => {
    if (!editingChatMessageId) return;
    const nextText = editingChatText.trim();
    if (!nextText) {
      setChatError("Message text is required.");
      return;
    }

    try {
      setSavingChatEdit(true);
      setChatError("");
      const response = await API.editChatMessage(editingChatMessageId, { text: nextText });
      setChatMessages((prev) => replaceMessageById(prev, response.message));
      cancelEditChatMessage();
    } catch (err) {
      setChatError(err.message || "Failed to edit message.");
    } finally {
      setSavingChatEdit(false);
    }
  };

  const openDeleteChatMessageConfirm = (message) => {
    if (!message?._id || deletingChatMessageId) return;
    setConfirmDeleteChatMessageId(String(message._id));
    setActiveChatMessageActionId("");
  };

  const deleteOwnChatMessage = async () => {
    const messageId = String(confirmDeleteChatMessageId || "");
    if (!messageId || deletingChatMessageId) return;

    try {
      setDeletingChatMessageId(messageId);
      setChatError("");
      const response = await API.deleteChatMessage(messageId);
      setChatMessages((prev) => replaceMessageById(prev, response.message));
      if (editingChatMessageId === messageId) {
        cancelEditChatMessage();
      }
      setActiveChatMessageActionId((prev) => (prev === messageId ? "" : prev));
      setConfirmDeleteChatMessageId("");
    } catch (err) {
      setChatError(err.message || "Failed to delete message.");
    } finally {
      setDeletingChatMessageId("");
    }
  };

  const confirmDeleteChatConversation = async () => {
    if (!chatBooking?.owner?._id || deletingChatConversation) return;

    try {
      setDeletingChatConversation(true);
      setChatError("");
      await API.deleteConversation(chatBooking.owner._id, { bookingId: chatBooking._id });
      setChatMessages([]);
      cancelEditChatMessage();
      setShowDeleteChatConversationConfirm(false);
      requestLiveCountersRefresh();
    } catch (err) {
      setChatError(err.message || "Failed to delete conversation.");
    } finally {
      setDeletingChatConversation(false);
    }
  };

  const closeChatModal = () => {
    setChatBooking(null);
    setChatMessages([]);
    setChatText("");
    setChatError("");
    setEditingChatMessageId("");
    setEditingChatText("");
    setConfirmDeleteChatMessageId("");
    setActiveChatMessageActionId("");
    setShowDeleteChatConversationConfirm(false);
  };

  const startPayment = async (bookingId, options = {}) => {
    if (!bookingId) return;
    setPaymentSuccessToast(null);
    setPaymentErrors((prev) => ({ ...prev, [bookingId]: "" }));
    setPayingBookingId(bookingId);
    try {
      const response = await API.payBooking(bookingId, options);
      if (response.booking) {
        upsertBooking(response.booking);
      }

      const checkoutUrl = String(response.checkoutUrl || "").trim();
      if (!checkoutUrl) {
        throw new Error("Payment URL was not returned by the server.");
      }
      window.location.assign(checkoutUrl);
    } catch (err) {
      setPaymentErrors((prev) => ({
        ...prev,
        [bookingId]: err.message || "Failed to start payment.",
      }));
    } finally {
      setPayingBookingId("");
    }
  };

  const setWalkInPayment = async (bookingId) => {
    if (!bookingId) return;
    setPaymentErrors((prev) => ({ ...prev, [bookingId]: "" }));
    setPayingBookingId(bookingId);
    try {
      const response = await API.requestWalkInPayment(bookingId, { method: "walkin" });
      if (response?.success === false) throw new Error(response.message || "Failed to request walk-in payment.");
      if (response.booking) {
        upsertBooking(response.booking);
      }
      showActionToast("Walk-in payment request sent. Waiting for owner approval.", { id: `renter-booking-${bookingId}`, tone: "info" });
    } catch (err) {
      setPaymentErrors((prev) => ({
        ...prev,
        [bookingId]: err.message || "Failed to request walk-in payment.",
      }));
    } finally {
      setPayingBookingId("");
    }
  };

  const handlePayNow = (booking) => {
    if (!booking?._id) return;
    const canPayForStatus = ["confirmed", "extended", "completed"].includes(
      String(booking.status || "").toLowerCase()
    );
    if (!canPayForStatus) {
      setApprovalModalBooking(booking);
      return;
    }
    const isPartial = String(booking.paymentStatus || "").toLowerCase() === "partial";
    const walkInStatus = getWalkInStatus(booking);
    if (isPartial && ["requested", "approved"].includes(walkInStatus)) {
      showActionToast(getWalkInStatusMessage(booking), { id: `renter-booking-${booking._id}`, tone: "info" });
      return;
    }
    setPaymentPreferences({
      scope: isPartial ? "full" : "downpayment",
      channel: "",
    });
    setPaymentConfirmBooking(booking);
  };

  const confirmAndStartPayment = async () => {
    const bookingId = paymentConfirmBooking?._id;
    if (!bookingId) return;
    const isPartial = String(paymentConfirmBooking?.paymentStatus || "").toLowerCase() === "partial";
    const walkInStatus = getWalkInStatus(paymentConfirmBooking);
    const channel = paymentPreferences.channel;
    if (
      !["ewallet", "card"].includes(channel) &&
      !(isPartial && channel === "walkin")
    ) return;
    if (isPartial && channel === "walkin") {
      setPaymentConfirmBooking(null);
      if (walkInStatus === "requested") {
        showActionToast("Walk-in request is already pending owner approval.", { id: `renter-booking-${bookingId}`, tone: "info" });
        return;
      }
      if (walkInStatus === "approved") {
        showActionToast("Your walk-in payment request has already been approved. Please pay the remaining balance directly to the owner.", { id: `renter-booking-${bookingId}`, tone: "info" });
        return;
      }
      if (walkInStatus === "completed") {
        showActionToast("Walk-in payment is already confirmed for this booking.", { id: `renter-booking-${bookingId}`, tone: "info" });
        return;
      }
      await setWalkInPayment(bookingId);
      return;
    }
    const scope = isPartial ? "full" : paymentPreferences.scope;
    setPaymentConfirmBooking(null);
    startPayment(bookingId, {
      paymentScope: scope,
      paymentChannel: channel,
    });
  };

  useEffect(() => {
    if (!isLoggedIn) return undefined;

    const params = new URLSearchParams(window.location.search);
    const bookingId = String(params.get("bookingId") || "").trim();
    const paymentResult = String(params.get("payment") || "").trim().toLowerCase();
    const checkoutId =
      String(params.get("checkoutId") || "").trim() ||
      String(params.get("checkout_session_id") || "").trim();

    if (!bookingId || !paymentResult) return undefined;

    const clearQuery = () => {
      const cleanUrl = `${window.location.pathname}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", cleanUrl);
    };

    if (paymentResult === "cancelled") {
      setPaymentSuccessToast(null);
      showActionToast("Payment was cancelled.", { id: `renter-checkout-${bookingId}`, tone: "info" });
      clearQuery();
      return undefined;
    }

    if (paymentResult !== "success") {
      clearQuery();
      return undefined;
    }

    let isActive = true;
    const wait = (ms) =>
      new Promise((resolve) => {
        window.setTimeout(resolve, ms);
      });

    const verifyPayment = async () => {
      setPaymentRecovery({ bookingId, checkoutId, stage: "checking" });
      setPaymentSuccessToast(null);
      setVerifyingBookingId(bookingId);
      setPaymentErrors((prev) => ({ ...prev, [bookingId]: "" }));
      try {
        const maxAttempts = 8;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const response = await API.verifyBookingPayment(bookingId, checkoutId);
          if (!isActive) return;

          if (response.booking) {
            upsertBooking(response.booking);
          }

          const paymentCaptured = Boolean(response.paymentCaptured);
          const paymentRecorded = paymentCaptured && ["paid", "partial"].includes(
            String(response.booking?.paymentStatus || "").toLowerCase()
          );
          if (!paymentCaptured && ["expired", "cancelled", "canceled"].includes(response.checkoutStatus)) {
            setPaymentRecovery(null);
            clearQuery();
            showActionToast("This checkout has ended without a completed payment. You can start a new checkout from your booking.", { id: `renter-checkout-${bookingId}`, tone: "info" });
            return;
          }

          if (paymentRecorded) {
            setPaymentRecovery(null);
            clearQuery();
            requestLiveCountersRefresh();
            const verifiedCheckoutId = String(checkoutId || response.checkoutId || "").trim();
            if (!verifiedCheckoutId || !toastedCheckoutIds.current.has(verifiedCheckoutId)) {
              if (verifiedCheckoutId) toastedCheckoutIds.current.add(verifiedCheckoutId);
              setPaymentSuccessToast((current) => ({
                id: (current?.id || 0) + 1,
                message: "Payment successful.",
              }));
            }
            return;
          }

          if (attempt < maxAttempts) {
            await wait(2000);
          }
        }

        setPaymentRecovery({ bookingId, checkoutId, stage: "retry" });
        setPaymentSuccessToast((current) => ({
          id: (current?.id || 0) + 1,
          kind: "retry",
          message: `This checkout for booking #${bookingId.slice(-6).toUpperCase()} is not confirmed yet. Retry verification before paying again.`,
        }));
      } catch {
        if (!isActive) return;
        setPaymentRecovery({ bookingId, checkoutId, stage: "retry" });
        setPaymentSuccessToast((current) => ({
          id: (current?.id || 0) + 1,
          kind: "retry",
          message: `Payment verification is unavailable for booking #${bookingId.slice(-6).toUpperCase()}. Retry verification before paying again.`,
        }));
      } finally {
        if (isActive) {
          setVerifyingBookingId("");
        }
      }
    };

    verifyPayment();
    return () => {
      isActive = false;
    };
  }, [isLoggedIn, paymentRetrySignal]);

  const confirmIsPartial =
    String(paymentConfirmBooking?.paymentStatus || "").trim().toLowerCase() === "partial";
  const confirmWalkInStatus = getWalkInStatus(paymentConfirmBooking);
  const confirmCanRequestWalkIn =
    confirmIsPartial && (confirmWalkInStatus === "none" || confirmWalkInStatus === "rejected");
  const confirmIsWalkIn = confirmIsPartial && paymentPreferences.channel === "walkin";
  const confirmHasPaymentMethod =
    ["ewallet", "card"].includes(paymentPreferences.channel) ||
    (confirmIsWalkIn && confirmCanRequestWalkIn);
  const confirmTotalPayable = paymentConfirmBooking ? getAmountPayable(paymentConfirmBooking) : 0;
  const confirmBaseRentalAmount = paymentConfirmBooking ? getBaseRentalTotal(paymentConfirmBooking) : 0;
  const confirmLateReturnInfo = paymentConfirmBooking ? getLateReturnInfo(paymentConfirmBooking) : null;
  const confirmLateReturnFee = paymentConfirmBooking ? getLateReturnPenaltyFee(paymentConfirmBooking) : 0;
  const confirmHasLateReturnFee = confirmLateReturnFee > 0;
  const confirmPaidAmount = paymentConfirmBooking ? getPaymentPaidAmount(paymentConfirmBooking) : 0;
  const confirmRemainingAmount = paymentConfirmBooking
    ? getPaymentRemainingAmount(paymentConfirmBooking)
    : 0;
  const confirmScope = confirmIsPartial ? "full" : paymentPreferences.scope;
  const confirmChargeAmount = paymentConfirmBooking
    ? confirmIsWalkIn
      ? confirmCanRequestWalkIn
        ? 0
        : confirmRemainingAmount
      : confirmScope === "downpayment"
        ? roundCurrency(confirmTotalPayable * DOWNPAYMENT_RATE)
        : confirmRemainingAmount
    : 0;
  const confirmRemainingAfterPayment = paymentConfirmBooking
    ? confirmIsWalkIn
      ? confirmCanRequestWalkIn
        ? confirmRemainingAmount
        : 0
      : roundCurrency(Math.max(confirmRemainingAmount - confirmChargeAmount, 0))
    : 0;

  if (!isLoggedIn) {
    return (
      <div className="rp-renter-page min-h-screen">
        <Navbar
          activePage="bookings"
          isLoggedIn={isLoggedIn}
          user={user}
          onNavigateToHome={onNavigateToHome}
          onNavigateToSignIn={onNavigateToSignIn}
          onNavigateToRegister={onNavigateToRegister}
          onNavigateToVehicles={onNavigateToVehicles}
          onNavigateToBookingHistory={onNavigateToBookingHistory}
          onNavigateToAbout={onNavigateToAbout}
          onNavigateToContacts={onNavigateToContacts}
          onNavigateToChat={onNavigateToChat}
          onNavigateToNotifications={onNavigateToNotifications}
          onOpenNotificationsModal={onOpenNotificationsModal}
          onNavigateToAccountSettings={onNavigateToAccountSettings}
          onNavigateToReports={onNavigateToReports}
          isAIOpen={showAI}
          onShowAI={() => setShowAI(true)}
          onLogout={onLogout}
        />

        <div className="rp-page-shell mx-auto max-w-4xl px-4 pb-16 pt-24 sm:px-6">
          <div className="rp-surface p-8 text-center">
            <h1 className="text-3xl font-bold">Bookings</h1>
            <p className="text-sm text-gray-600 mt-2">
              You are on the bookings page. Sign in or register to view your booking history.
            </p>

            <div className="flex items-center justify-center gap-3 mt-6">
              {!showAuthPrompt && (
                <button
                  onClick={() => setShowAuthPrompt(true)}
                  className="px-5 py-2 rounded-lg bg-[#017FE6] text-white text-sm"
                >
                  Show access message
                </button>
              )}
              <button
                onClick={onNavigateToVehicles}
                className="px-5 py-2 rounded-lg border text-sm text-gray-700 hover:bg-gray-50"
              >
                Continue browsing vehicles
              </button>
            </div>
          </div>
        </div>

        <BookingAccessModal
          isOpen={showAuthPrompt}
          onClose={() => setShowAuthPrompt(false)}
          onSignIn={onNavigateToSignIn}
          onRegister={onNavigateToRegister}
          onBrowseVehicles={onNavigateToVehicles}
        />
        <ChatWidget
          isOpen={showAI}
          onOpen={() => setShowAI(true)}
          onClose={() => setShowAI(false)}
          onViewAvailableVehicles={onNavigateToVehicles}
        />
      </div>
    );
  }

  return (
    <div className="rp-renter-page min-h-screen">
      <Navbar
        activePage="bookings"
        isLoggedIn={isLoggedIn}
        user={user}
        onNavigateToHome={onNavigateToHome}
        onNavigateToSignIn={onNavigateToSignIn}
        onNavigateToRegister={onNavigateToRegister}
        onNavigateToVehicles={onNavigateToVehicles}
        onNavigateToBookingHistory={onNavigateToBookingHistory}
        onNavigateToAbout={onNavigateToAbout}
        onNavigateToContacts={onNavigateToContacts}
        onNavigateToChat={onNavigateToChat}
        onNavigateToNotifications={onNavigateToNotifications}
        onOpenNotificationsModal={onOpenNotificationsModal}
        onNavigateToAccountSettings={onNavigateToAccountSettings}
        onNavigateToReports={onNavigateToReports}
        isAIOpen={showAI}
        onShowAI={() => setShowAI(true)}
        onLogout={onLogout}
      />

      <div className="rp-page-shell mx-auto max-w-7xl space-y-6 px-4 pb-16 pt-24 sm:px-6">
        <div className="rp-page-header rp-bookings-page-header">
          <h1 className="rp-bookings-page-header__title text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">My bookings</h1>
          <p className="rp-bookings-page-header__description text-sm text-slate-500">Manage your reservations, payments, and trip updates.</p>
          <div className="rp-bookings-page-header__help rp-ai-booking-help">
            <HelpLink guide="booking-payments">Need help with payments?</HelpLink>
          </div>
          <button type="button" disabled={loading || refreshing || loadingMore} onClick={() => load({ background: true })} className="rp-bookings-page-header__refresh inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold disabled:opacity-50" aria-label={refreshing ? "Refreshing bookings" : "Refresh bookings"}>
            <RefreshCw size={16} strokeWidth={2} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
            <span className="rp-bookings-page-header__refresh-label">{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>

        <div
          className="flex w-full gap-1.5 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm sm:w-fit"
          role="group"
          aria-label="Booking views"
        >
          {[
            { id: "active", label: "Active" },
            { id: "unsettled", label: "Unsettled" },
            { id: "history", label: "History" },
            { id: "all", label: "All" },
          ].map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setStatusFilter(filter.id)}
              aria-pressed={statusFilter === filter.id}
              className={`shrink-0 rounded-xl px-3 py-2.5 text-sm font-semibold transition sm:px-4 ${
                statusFilter === filter.id
                  ? "bg-[#017FE6] text-white shadow-md shadow-blue-100"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {activePaymentRecovery?.stage === "retry" && !filteredBookings.some((booking) => booking._id === activePaymentRecovery.bookingId) && (
          <button type="button" onClick={() => setPaymentRetrySignal((value) => value + 1)} className="min-h-11 rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
            Retry verification for booking #{activePaymentRecovery.bookingId.slice(-6).toUpperCase()}
          </button>
        )}

        <RequestFeedback loading={refreshing} label="Refreshing bookings..." error={loadError} onRetry={() => load({ background: bookings.length > 0 })} />
        {loading && <BookingListSkeleton />}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {reportNotice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{reportNotice}</p>}

        {!loading && !loadError && filteredBookings.length === 0 && (
          <div className="rp-minimal-card border-dashed p-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-[#017FE6]"><ActiveViewIcon size={24} strokeWidth={2} aria-hidden="true" /></div>
            <h2 className="mt-4 text-lg font-bold text-slate-900">
              {statusFilter === "unsettled" ? "No unsettled balances" : `No ${activeView.label.toLowerCase()} yet`}
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
              {statusFilter === "unsettled"
                ? "You're all caught up. No payments need your attention."
                : `${activeView.description}. Your reservations will appear here as soon as there is activity.`}
            </p>
            {statusFilter === "unsettled" ? (
              <button type="button" onClick={() => setStatusFilter("active")} className="mt-4 rounded-xl bg-[#017FE6] px-4 py-2 text-sm font-semibold text-white">View active bookings</button>
            ) : (
              <button type="button" onClick={onNavigateToVehicles} className="mt-4 rounded-xl bg-[#017FE6] px-4 py-2 text-sm font-semibold text-white">Browse vehicles</button>
            )}
          </div>
        )}

        {!loading && <div className="space-y-4">
          {filteredBookings.map((booking) => {
            const lateReturnInfo = getLateReturnInfo(booking, bookingClock);
            const isEstimatedLatePenalty = lateReturnInfo.penaltyFee <= 0 && lateReturnInfo.estimatedPenaltyFee > 0;
            const displayedLatePenalty =
              lateReturnInfo.penaltyFee > 0 ? lateReturnInfo.penaltyFee : lateReturnInfo.estimatedPenaltyFee;
            const displayedAmountPayable = roundCurrency(
              getAmountPayable(booking) + (isEstimatedLatePenalty ? displayedLatePenalty : 0)
            );
            const extensionInfo = getExtensionRequestInfo(booking);
            const returnRequestInfo = getReturnRequestInfo(booking);
            const walkInStatus = getWalkInStatus(booking);
            const ownerDisplayName = getOwnerDisplayName(booking);
            const unsettled = isBookingUnsettled(booking, bookingClock);
            const outstandingBalance = unsettled ? getOutstandingBalance(booking) : 0;
            const settlementPending = unsettled && ["requested", "approved"].includes(walkInStatus);
            const displayState = getBookingDisplayState(booking, { unsettled });
            const hasActiveWalkInBalanceSettlement =
              String(booking.paymentStatus || "").toLowerCase() === "partial" &&
              ["requested", "approved"].includes(walkInStatus);
            const isPaymentEligibleStatus = ["confirmed", "extended", "completed"].includes(
              String(booking.status || "").toLowerCase()
            );
            const canResolveOverdue =
              lateReturnInfo.isOverdue && ["confirmed", "extended"].includes(String(booking.status || "").toLowerCase());
            const hasSettledLateReturn =
              String(booking.status || "").toLowerCase() === "completed" &&
              String(booking.paymentStatus || "").toLowerCase() === "paid" &&
              getOutstandingBalance(booking) <= 0;
            const pickupAtMs = booking.pickupAt ? new Date(booking.pickupAt).getTime() : Number.NaN;
            const canRequestVehicleReturn =
              ["confirmed", "extended"].includes(String(booking.status || "").toLowerCase()) &&
              Number.isFinite(pickupAtMs) &&
              Date.now() >= pickupAtMs &&
              ["none", "declined"].includes(returnRequestInfo.status);

            return (
            <article key={booking._id} className="rp-booking-card group overflow-hidden p-4 sm:p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 gap-4">
                  <VehicleThumbnail vehicle={booking.vehicle} className="rp-booking-thumbnail h-20 w-24 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-slate-100 to-blue-100 shadow-inner sm:h-24 sm:w-32" imageClassName="transition duration-300 group-hover:scale-105" />
                  <div className="min-w-0 py-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#017FE6]">Rental booking</p>
                    <h2 className="rp-booking-vehicle-title mt-1 font-bold text-slate-900">{booking.vehicle?.name || "Vehicle"}</h2>
                    <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-600"><MapPin size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" /><span className="min-w-0 break-words">{booking.vehicle?.location || "Location to be confirmed"}</span></p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <span
                    className={`inline-flex items-center text-xs font-semibold px-3 py-1 rounded-full ${
                      displayState.tone === "overdue"
                        ? "border border-rose-200 bg-rose-100 text-rose-800"
                        : statusStyles[displayState.tone] || "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {displayState.label}
                  </span>
                  {returnRequestInfo.status === "declined" && (
                    <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-800">Return declined</span>
                  )}
                  {unsettled && (
                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                      settlementPending
                        ? "border-amber-200 bg-amber-100 text-amber-800"
                        : "border-rose-200 bg-rose-100 text-rose-800"
                    }`}>
                      {settlementPending ? "Settlement pending" : "Balance due"} · {moneyWithCents(outstandingBalance)}
                    </span>
                  )}
                  {extensionInfo.status !== "none" && (
                    <span
                      className={`inline-flex items-center text-xs font-semibold px-3 py-1 rounded-full ${
                        extensionInfo.status === "approved"
                          ? "bg-violet-100 text-violet-800 border border-violet-200"
                          : extensionInfo.status === "rejected"
                            ? "bg-rose-100 text-rose-800 border border-rose-200"
                            : "bg-amber-100 text-amber-800 border border-amber-200"
                      }`}
                    >
                      Extension {toTitleCase(extensionInfo.status)}
                    </span>
                  )}
                </div>
              </div>

              <p className="mt-3 text-sm text-slate-600">{bookingGuidance(booking)}</p>
              {booking.status === "rejected" && <button type="button" onClick={onNavigateToVehicles} className="mt-2 text-sm font-semibold text-blue-700 underline">Browse other vehicles</button>}
              <BookingDetails summary={<>
                <Info icon={CalendarDays} title="Pickup" value={formatDate(booking.pickupAt)} />
                <Info icon={CalendarDays} title="Return" value={formatDate(booking.returnAt)} />
                <Info icon={Clock3} title="Duration" value={formatDurationMinutes(getBookingDurationMinutesForPricing(booking))} />
                <Info
                  icon={WalletCards}
                  title={isEstimatedLatePenalty ? "Estimated Amount Payable" : "Amount Payable"}
                  value={moneyWithCents(displayedAmountPayable)}
                />
              </>}>
                <Info
                  title="Vehicle Rate"
                  value={`${money(booking.vehicleHourlyRate ?? booking.vehicleDailyRate)} / hr`}
                />
                <Info
                  title="Driver"
                  value={
                    booking.driverSelected
                      ? `${money(booking.driverHourlyRate ?? booking.driverDailyRate)} / hr`
                      : "No"
                  }
                />
                <Info icon={WalletCards} title="Rental Total" value={money(getBaseRentalTotal(booking))} />
                <Info
                  title={isEstimatedLatePenalty ? "Estimated Late Penalty" : "Late Penalty"}
                  value={moneyWithCents(displayedLatePenalty)}
                />
                <Info title="Transaction Fee" value={moneyWithCents(getBookingTransactionFee(booking))} />
              </BookingDetails>

              {lateReturnInfo.isOverdue && !hasSettledLateReturn && (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  Late return detected: overdue by {formatDurationMinutes(lateReturnInfo.overdueMinutes)}.
                  {lateReturnInfo.penaltyFee > 0
                    ? ` Final late charge: ${moneyWithCents(lateReturnInfo.penaltyFee)}. To settle your remaining balance, select Pay Remaining below and pay online or request walk-in payment.`
                    : lateReturnInfo.estimatedPenaltyFee > 0
                      ? ` Estimated late charge: ${moneyWithCents(lateReturnInfo.estimatedPenaltyFee)} at ${moneyWithCents(lateReturnInfo.penaltyRatePerHour)} per overdue hour. This estimate continues until the owner confirms receipt.`
                      : " This booking has no monetary late charge under its snapshotted policy."}
                </div>
              )}

              {extensionInfo.status === "requested" && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Extension request pending owner approval.
                  {extensionInfo.requestedReturnAt ? ` Requested return: ${formatDate(extensionInfo.requestedReturnAt)}.` : ""}
                </div>
              )}
              {extensionInfo.status === "rejected" && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  Your extension request was rejected. Original return schedule still applies.
                </div>
              )}
              {returnRequestInfo.status === "declined" && returnRequestInfo.reviewNote && (
                <p className="mt-3 text-sm text-slate-600">Owner note: {returnRequestInfo.reviewNote}</p>
              )}

              <div className="rp-booking-actions mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                <div className="rp-booking-contact mr-auto flex min-w-0 max-w-full items-center gap-2">
                  <span className="min-w-0 break-words text-sm text-slate-600">
                    Owner: <span className="font-medium text-slate-900">{ownerDisplayName}</span>
                  </span>
                  <button
                    onClick={() => openChat(booking)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
                  >
                    <MessageCircle size={18} strokeWidth={2} aria-hidden="true" /> Chat owner
                  </button>
                  <button type="button" onClick={() => setReportBooking(booking)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100"><Flag size={18} strokeWidth={2} aria-hidden="true" />Report issue</button>
                </div>

                {["unpaid", "partial"].includes(String(booking.paymentStatus || "").toLowerCase()) &&
                  !hasActiveWalkInBalanceSettlement &&
                  !["cancelled", "rejected"].includes(booking.status) && (
                    <button
                      onClick={() => handlePayNow(booking)}
                      disabled={payingBookingId === booking._id || verifyingBookingId === booking._id || activePaymentRecovery?.bookingId === booking._id}
                      className={`px-3 py-2 rounded-lg text-sm ${
                        payingBookingId === booking._id || verifyingBookingId === booking._id
                          ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                          : isPaymentEligibleStatus
                            ? "bg-[#017FE6] text-white shadow-lg shadow-blue-200 hover:bg-[#006cc3]"
                            : "bg-amber-100 text-amber-800 border border-amber-300"
                      }`}
                    >
                      {payingBookingId === booking._id || verifyingBookingId === booking._id
                        ? "Processing..."
                        : String(booking.paymentStatus || "").toLowerCase() === "partial"
                          ? "Pay Remaining"
                          : "Pay Now"}
                    </button>
                  )}

                {activePaymentRecovery?.stage === "retry" && activePaymentRecovery.bookingId === booking._id && (
                  <button type="button" onClick={() => setPaymentRetrySignal((value) => value + 1)} className="min-h-11 rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                    Retry verification
                  </button>
                )}

                {["unpaid", "partial"].includes(String(booking.paymentStatus || "").toLowerCase()) &&
                  !isPaymentEligibleStatus &&
                  !["cancelled", "rejected"].includes(booking.status) && (
                    <p className="w-full text-xs text-amber-700">
                      Payment is locked until the booking is approved or extended.
                    </p>
                  )}

                {["pending", "confirmed", "extended"].includes(booking.status) && (
                  <button
                    type="button"
                    onClick={() => setCancellationModalBooking(booking)}
                    disabled={returnRequestInfo.status === "requested"}
                    className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel Booking
                  </button>
                )}
                {["pending", "confirmed", "extended"].includes(booking.status) && returnRequestInfo.status === "requested" && (
                  <p className="w-full text-xs text-slate-600">Cancellation becomes available if the owner declines the return request.</p>
                )}

                {canResolveOverdue && returnRequestInfo.status === "none" && (
                    <button
                      onClick={() => openExtensionModal(booking)}
                      disabled={extensionInfo.status === "requested" || returnRequestSubmittingId === booking._id}
                      className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Extend Rental Time
                    </button>
                )}
                {canRequestVehicleReturn && (
                    <button
                      onClick={() => handleRequestVehicleReturn(booking)}
                      disabled={returnRequestSubmittingId === booking._id || extensionInfo.status === "requested"}
                      className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {returnRequestSubmittingId === booking._id ? "Requesting..." : "Request Vehicle Return"}
                    </button>
                )}

                {booking.status === "completed" && !booking.reviewRating && (
                  <button
                    type="button"
                    onClick={() => { markReviewPromptSeen(booking._id); setReviewPromptBooking(booking); }}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#017FE6] px-4 text-sm font-semibold text-white hover:bg-[#006cc3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                  >
                    <Star size={17} strokeWidth={2} aria-hidden="true" /> Rate this rental
                  </button>
                )}

                {booking.reviewRating && (
                  <span className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-emerald-800">
                    <Star size={16} strokeWidth={2} fill="currentColor" aria-hidden="true" /> Your review: {booking.reviewRating}/5
                  </span>
                )}

                {getWalkInStatus(booking) !== "none" && (
                  <p
                    className={`w-full text-xs ${
                      getWalkInStatus(booking) === "approved"
                        ? "text-emerald-700"
                        : getWalkInStatus(booking) === "rejected"
                          ? "text-rose-700"
                          : "text-amber-700"
                    }`}
                  >
                    {getWalkInStatusMessage(booking)}
                  </p>
                )}

                {paymentErrors[booking._id] && (
                  <p className="w-full text-xs text-red-600">{paymentErrors[booking._id]}</p>
                )}
              </div>
            </article>
            );
          })}
        </div>}

        {bookingPage.hasMore && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => load({ cursor: bookingPage.nextCursor, append: true })}
              disabled={loadingMore}
              className="min-h-11 rounded-lg border border-[#017FE6] px-4 py-2 text-sm font-medium text-[#017FE6] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          </div>
        )}
      </div>

      {chatBooking && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-900/45 backdrop-blur-[2px]"
            onClick={closeChatModal}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="flex w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.25)] flex-col">
              <div className="border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <OwnerAvatar owner={chatBooking.owner} />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-base font-semibold text-slate-950">
                          {getOwnerDisplayName(chatBooking)}
                        </p>
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          Owner
                        </span>
                      </div>
                      <p className="truncate text-xs text-slate-500">
                        {chatBooking.vehicle?.name || "Booking conversation"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDeleteChatConversationConfirm(true)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-rose-200 text-rose-600 transition hover:bg-rose-50"
                      aria-label="Delete conversation"
                      title="Delete conversation"
                    >
                      <Trash2 size={18} strokeWidth={2} />
                    </button>
                    <button
                      onClick={closeChatModal}
                      className="rp-icon-button"
                      aria-label="Close chat"
                      title="Close chat"
                    >
                      <X size={18} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              </div>

              <div
                className="flex-1 space-y-4 overflow-y-auto bg-slate-50 px-4 py-5 sm:px-5"
                onClick={() => setActiveChatMessageActionId("")}
              >
                {chatError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {chatError}
                  </div>
                )}
                {!chatMessages.length && (
                  <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-[#017FE6]">
                      <MessageCircle size={24} strokeWidth={2} aria-hidden="true" />
                    </div>
                    <p className="text-sm font-medium text-slate-800">No messages yet</p>
                    <p className="mt-1 max-w-xs text-xs text-slate-500">
                      Start the conversation about this booking with the vehicle owner.
                    </p>
                  </div>
                )}
                {chatMessages.map((message) => {
                  const isMe = String(message.sender?._id || message.sender) === String(currentUserId);
                  const isEditing = isMe && editingChatMessageId === message._id;
                  const showActions =
                    isMe &&
                    !isEditing &&
                    !message.isDeleted &&
                    activeChatMessageActionId === String(message._id);
                  return (
                    <div key={message._id} className={`group flex items-start ${isMe ? "justify-end" : "justify-start"}`}>
                      <div className={`flex min-w-0 max-w-[82%] flex-col sm:max-w-[74%] ${isMe ? "items-end" : "items-start"}`}>
                        <div
                        className={`relative max-w-full rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
                          isMe
                            ? "rounded-br-md bg-[#017FE6] text-white"
                            : "rounded-bl-md border border-slate-200 bg-white text-slate-800"
                        }`}
                        onClick={(event) => {
                          if (!isMe || isEditing || message.isDeleted) return;
                          event.stopPropagation();
                          setActiveChatMessageActionId((prev) =>
                            prev === String(message._id) ? "" : String(message._id)
                          );
                        }}
                      >
                        {isEditing ? (
                          <div className="space-y-2">
                            <input
                              value={editingChatText}
                              onChange={(event) => setEditingChatText(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  saveEditedChatMessage();
                                }
                              }}
                              onClick={(event) => event.stopPropagation()}
                              className="w-full rounded-lg border border-white/30 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-2 ring-transparent transition focus:ring-white/30"
                            />
                            <div className="flex justify-end gap-2 text-[11px]">
                              <button
                                type="button"
                                onClick={cancelEditChatMessage}
                                className="rounded-lg bg-white/20 px-2.5 py-1"
                                disabled={savingChatEdit}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={saveEditedChatMessage}
                                className="rounded-lg bg-white px-2.5 py-1 text-[#017FE6]"
                                disabled={savingChatEdit}
                              >
                                {savingChatEdit ? "Saving..." : "Save"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className={`max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${message.isDeleted ? "italic opacity-85" : ""}`}>
                            {message.text}
                          </p>
                        )}
                        <p className={`mt-1.5 text-[10px] ${isMe ? "text-white/80" : "text-slate-400"}`}>
                          {formatDate(message.createdAt)}
                          {message.isEdited && !message.isDeleted ? " - edited" : ""}
                        </p>
                        {isMe && !isEditing && !message.isDeleted && (
                          <span className="mt-1 inline-flex items-center text-white/75" aria-hidden="true">
                            <EllipsisVertical size={18} strokeWidth={2} />
                          </span>
                        )}
                        {showActions && (
                          <div className="mt-2 flex justify-end gap-1.5 text-[11px] text-white">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                startEditChatMessage(message);
                              }}
                              className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-1 transition hover:bg-white/30"
                            >
                              <Pencil size={16} strokeWidth={2} aria-hidden="true" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openDeleteChatMessageConfirm(message);
                              }}
                              disabled={
                                deletingChatMessageId === message._id || Boolean(confirmDeleteChatMessageId)
                              }
                              className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-1 transition hover:bg-white/30 disabled:opacity-60"
                            >
                              <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                              {deletingChatMessageId === message._id ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        )}
                        </div>
                        {!isMe && !message.isDeleted && (
                          <button
                            type="button"
                            onClick={() => setChatReportMessage(message)}
                            className="mt-1 inline-flex h-7 w-7 self-end items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 shadow-sm transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                            aria-label="Report this message"
                            title="Report message"
                          >
                            <Flag size={16} strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5 focus-within:border-[#0B75E7] focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100">
                  <ChatMessageInput
                    textareaClassName="max-h-28 min-h-10 bg-transparent px-3 pb-4 pt-2 text-sm leading-5 text-slate-900 outline-none placeholder:text-slate-400"
                    containerClassName="min-w-0 flex-1"
                    placeholder="Type your message"
                    value={chatText}
                    onChange={setChatText}
                    onSend={sendChatMessage}
                  />
                  <button
                    onClick={sendChatMessage}
                    disabled={!chatText.trim()}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#017FE6] text-white shadow-sm transition hover:bg-[#0165B8] disabled:cursor-not-allowed disabled:bg-slate-300"
                    aria-label="Send message"
                  >
                    <Send size={18} strokeWidth={2} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {showDeleteChatConversationConfirm && (
            <>
              <div
                className="fixed inset-0 z-[55] bg-slate-900/45 backdrop-blur-[2px]"
                onClick={() => {
                  if (!deletingChatConversation) setShowDeleteChatConversationConfirm(false);
                }}
              />
              <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.25)]">
                  <div className="border-b border-slate-200 px-6 py-4">
                    <h3 className="text-base font-semibold text-slate-900">Delete Conversation</h3>
                  </div>
                  <div className="px-6 py-5">
                    <p className="text-sm text-slate-700">
                      Are you sure you want to delete this conversation? This action cannot be undone.
                    </p>
                    <div className="mt-5 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowDeleteChatConversationConfirm(false)}
                        disabled={deletingChatConversation}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={confirmDeleteChatConversation}
                        disabled={deletingChatConversation}
                        className="rounded-lg bg-rose-600 px-3 py-2 text-sm text-white disabled:opacity-60"
                      >
                        {deletingChatConversation ? "Deleting..." : "Delete Conversation"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {confirmDeleteChatMessageId && (
            <>
              <div
                className="fixed inset-0 z-[55] bg-slate-900/45 backdrop-blur-[2px]"
                onClick={() => {
                  if (!deletingChatMessageId) setConfirmDeleteChatMessageId("");
                }}
              />
              <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.25)]">
                  <div className="border-b border-slate-200 px-6 py-4">
                    <h3 className="text-base font-semibold text-slate-900">Delete Message</h3>
                  </div>
                  <div className="px-6 py-5">
                    <p className="text-sm text-slate-700">Are you sure you want to delete this message?</p>
                    <div className="mt-5 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteChatMessageId("")}
                        disabled={Boolean(deletingChatMessageId)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-60"
                      >
                        No
                      </button>
                      <button
                        type="button"
                        onClick={deleteOwnChatMessage}
                        disabled={Boolean(deletingChatMessageId)}
                        className="rounded-lg bg-rose-600 px-3 py-2 text-sm text-white disabled:opacity-60"
                      >
                        {deletingChatMessageId ? "Deleting..." : "Yes"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {approvalModalBooking && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/45 backdrop-blur-[2px] z-[70]"
            onClick={() => setApprovalModalBooking(null)}
          />
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <div className="rp-booking-dialog relative w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-[0_25px_80px_rgba(15,23,42,0.25)]">
              <div className="px-6 pt-5 pb-4 border-b border-slate-200 bg-gradient-to-r from-[#0B75E7]/10 via-white to-white">
                <h3 className="text-lg font-semibold text-slate-900">Payment Not Available Yet</h3>
                <p className="text-sm text-slate-600 mt-1">
                  You can only pay after the owner approves your booking.
                </p>
              </div>
              <div className="px-6 py-5">
                <p className="text-xs text-slate-500">
                  Current status: {toTitleCase(approvalModalBooking.status || "pending")}
                </p>
                <div className="mt-5 flex justify-end">
                  <button
                    onClick={() => setApprovalModalBooking(null)}
                    className="rp-btn-primary px-4 py-2 text-sm"
                  >
                    I Understand
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {paymentConfirmBooking && (
        <ModalPortal>
          <div
            className="rp-modal-layer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-payment-title"
          >
            <button
              type="button"
              className="rp-modal-backdrop"
              onClick={payingBookingId ? undefined : () => setPaymentConfirmBooking(null)}
              aria-label="Close payment confirmation"
            />
            <section className="rp-payment-dialog relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.3)] sm:rounded-3xl">
              <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-[#017FE6]">
                      <WalletCards size={24} strokeWidth={2} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#017FE6]">
                        {confirmHasLateReturnFee ? "Late-return payment" : "Booking payment"}
                      </p>
                      <h2 id="confirm-payment-title" className="mt-0.5 text-lg font-bold text-slate-900">
                        {confirmHasLateReturnFee ? "Review remaining balance" : "Confirm payment"}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {confirmHasLateReturnFee
                          ? "Review the final late-return fee and payment details."
                          : "Review your payment before continuing."}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPaymentConfirmBooking(null)}
                    disabled={Boolean(payingBookingId)}
                    className="rp-icon-button"
                    aria-label="Close payment confirmation"
                  >
                    <X size={18} />
                  </button>
                </div>
              </header>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50 p-4 sm:p-6">
                <div className={`rounded-2xl border px-4 py-3 text-sm ${confirmHasLateReturnFee ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-200 bg-blue-50 text-blue-900"}`}>
                  {confirmHasLateReturnFee
                    ? "The owner confirmed receipt and finalized this fee. Pay online below, or choose Request Walk-in Payment to ask the owner to accept the remaining balance in person."
                    : "Payment reminder: complete payment within the booked rental duration, or request walk-in settlement upon return."}
                </div>

                <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm" aria-label="Payment breakdown">
                  <Line label="Rental Amount" value={money(confirmBaseRentalAmount)} />
                  {confirmHasLateReturnFee && <Line label="Late-return Fee" value={moneyWithCents(confirmLateReturnFee)} strong />}
                  <Line label="Transaction Fee" value={moneyWithCents(getBookingTransactionFee(paymentConfirmBooking))} />
                  <Line label="Already Paid" value={moneyWithCents(confirmPaidAmount)} />
                  <Line label="Total Amount Payable" value={moneyWithCents(confirmTotalPayable)} strong />
                  <Line label="Remaining Balance" value={moneyWithCents(confirmRemainingAmount)} />
                </section>

                <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p id="booking-payment-method-label" className="text-sm font-semibold text-slate-800">Payment Method</p>
                  <p className="text-sm text-slate-600">Choose a method to continue.</p>
                  <div className="space-y-2" role="radiogroup" aria-labelledby="booking-payment-method-label">
                    <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-blue-300 hover:bg-blue-50/50">
                      <input
                        type="radio"
                        name="booking-payment-method"
                        checked={paymentPreferences.channel === "ewallet"}
                        onChange={() => setPaymentPreferences((prev) => ({ ...prev, channel: "ewallet" }))}
                      />
                      <span className="text-sm text-slate-700">E-wallet (GCash / Maya)</span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-blue-300 hover:bg-blue-50/50">
                      <input
                        type="radio"
                        name="booking-payment-method"
                        checked={paymentPreferences.channel === "card"}
                        onChange={() => setPaymentPreferences((prev) => ({ ...prev, channel: "card" }))}
                      />
                      <span className="text-sm text-slate-700">Credit / Debit Card</span>
                    </label>
                    {confirmIsPartial && (
                      <label
                        className={`flex items-start gap-2 rounded-xl border border-slate-200 px-3 py-2.5 transition ${
                          confirmCanRequestWalkIn
                            ? "cursor-pointer hover:border-blue-300 hover:bg-blue-50/50"
                            : "cursor-not-allowed opacity-70"
                        }`}
                      >
                        <input
                          type="radio"
                          name="booking-payment-method"
                          checked={paymentPreferences.channel === "walkin"}
                          disabled={!confirmCanRequestWalkIn}
                          onChange={() => setPaymentPreferences((prev) => ({ ...prev, channel: "walkin" }))}
                        />
                        <span className="text-sm text-slate-700">
                          Request Walk-in Payment (owner must approve before confirmation)
                        </span>
                      </label>
                    )}
                  </div>
                  {confirmWalkInStatus === "requested" && (
                    <p className="text-xs text-amber-700">Walk-in request is already pending owner approval.</p>
                  )}
                  {confirmWalkInStatus === "approved" && (
                    <p className="text-xs text-emerald-700">
                      Your walk-in payment request has already been approved. Please pay the remaining balance
                      directly to the owner.
                    </p>
                  )}
                  {confirmWalkInStatus === "rejected" && (
                    <p className="text-xs text-rose-700">
                      Your previous walk-in request was rejected. You may submit a new request.
                    </p>
                  )}
                  {confirmIsWalkIn && confirmCanRequestWalkIn && (
                    <p className="text-xs text-amber-700">
                      This will send a walk-in payment request to the owner. No online charge will happen now.
                    </p>
                  )}
                </section>

                {confirmHasLateReturnFee && (
                  <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
                    <p className="pb-1 text-sm font-semibold text-slate-800">Late-return details</p>
                    <Line label="Scheduled Return" value={formatDate(paymentConfirmBooking.returnAt)} />
                    <Line label="Receipt Confirmed" value={formatDate(paymentConfirmBooking.actualReturnAt)} />
                    <Line label="Overdue Duration" value={formatDurationMinutes(confirmLateReturnInfo?.overdueMinutes || 0)} />
                    <Line label="Late Fee Rate" value={`${moneyWithCents(confirmLateReturnInfo?.penaltyRatePerHour || 0)} / hour`} />
                  </section>
                )}

                <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-semibold text-slate-800">Pay Now Option</p>
                  {confirmIsPartial ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                      A downpayment is already recorded. You may pay the remaining balance online or request walk-in
                      payment approval.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-blue-300 hover:bg-blue-50/50">
                        <input
                          type="radio"
                          checked={paymentPreferences.scope === "downpayment"}
                          onChange={() =>
                            setPaymentPreferences((prev) => ({ ...prev, scope: "downpayment" }))
                          }
                        />
                        <span className="text-sm text-slate-700">
                          Downpayment (30%): {moneyWithCents(roundCurrency(confirmTotalPayable * DOWNPAYMENT_RATE))}
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-blue-300 hover:bg-blue-50/50">
                        <input
                          type="radio"
                          checked={paymentPreferences.scope === "full"}
                          onChange={() => setPaymentPreferences((prev) => ({ ...prev, scope: "full" }))}
                        />
                        <span className="text-sm text-slate-700">
                          Full Payment: {moneyWithCents(confirmRemainingAmount)}
                        </span>
                      </label>
                    </div>
                  )}
                </section>

                {confirmHasPaymentMethod && (
                  <section className="space-y-1 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm">
                    <Line label="Amount to Pay Now" value={moneyWithCents(confirmChargeAmount)} strong />
                    <Line
                      label="Balance After This Payment"
                      value={moneyWithCents(confirmRemainingAfterPayment)}
                    />
                  </section>
                )}
              </div>

              <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
                <button
                  type="button"
                  onClick={() => setPaymentConfirmBooking(null)}
                  disabled={Boolean(payingBookingId)}
                  className="rp-btn-secondary px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmAndStartPayment}
                  disabled={Boolean(payingBookingId) || !confirmHasPaymentMethod}
                  className="rp-btn-primary px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {payingBookingId
                    ? "Processing..."
                    : confirmIsWalkIn
                      ? "Request Walk-in Approval"
                      : "Proceed to Pay"}
                </button>
              </footer>
            </section>
          </div>
        </ModalPortal>
      )}

      {extensionModalBooking && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/45 backdrop-blur-[2px] z-[70]"
            onClick={() => {
              if (!extensionSubmitting) setExtensionModalBooking(null);
            }}
          />
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <div className="rp-booking-dialog relative w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-[0_25px_80px_rgba(15,23,42,0.25)]">
              <div className="px-6 pt-5 pb-4 border-b border-slate-200 bg-gradient-to-r from-violet-500/10 via-white to-white">
                <h3 className="text-lg font-semibold text-slate-900">Request Rental Extension</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Current return: {formatDate(extensionModalBooking.returnAt)}
                </p>
              </div>
              <div className="px-6 py-5 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    aria-label="Extended return date"
                    value={extensionForm.newReturnDate}
                    min={formatDateInput(extensionModalBooking.returnAt || new Date())}
                    max={getMaxBookingDate()}
                    onChange={(event) =>
                      setExtensionForm((prev) => ({ ...prev, newReturnDate: event.target.value }))
                    }
                    className="border rounded-lg px-3 py-2 text-sm"
                  />
                  <input
                    type="time"
                    aria-label="Extended return time"
                    value={extensionForm.newReturnTime}
                    onChange={(event) =>
                      setExtensionForm((prev) => ({ ...prev, newReturnTime: event.target.value }))
                    }
                    className="border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <AutoResizeTextarea
                  value={extensionForm.note}
                  onChange={(event) => setExtensionForm((prev) => ({ ...prev, note: event.target.value }))}
                  maxLength={500}
                  aria-label="Optional note to owner"
                  placeholder="Optional note to owner"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setExtensionModalBooking(null)}
                    disabled={extensionSubmitting}
                    className="rp-btn-secondary px-4 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitExtensionRequest}
                    disabled={extensionSubmitting}
                    className="rp-btn-primary px-4 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {extensionSubmitting ? "Submitting..." : "Submit Request"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {cancellationModalBooking && (
        <>
          <div
            className="fixed inset-0 z-[90] bg-slate-950/45 backdrop-blur-sm"
            onClick={() => {
              if (!cancellingBookingId) setCancellationModalBooking(null);
            }}
          />
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="cancel-booking-title">
            <div className="rp-booking-dialog w-full max-w-md rounded-3xl border border-slate-200 bg-white shadow-[0_25px_90px_rgba(15,23,42,0.32)]">
              <div className="border-b border-rose-100 bg-gradient-to-r from-rose-50 via-white to-white px-6 pb-5 pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-600">Cancellation confirmation</p>
                    <h3 id="cancel-booking-title" className="mt-1 text-xl font-bold text-slate-900">Cancel this booking?</h3>
                  </div>
                  <button
                    type="button"
                    aria-label="Close cancellation confirmation"
                    onClick={() => setCancellationModalBooking(null)}
                    disabled={Boolean(cancellingBookingId)}
                    className="rp-icon-button"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>
              <div className="px-6 py-5">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="font-semibold text-slate-900">{cancellationModalBooking.vehicle?.name || "This rental"}</p>
                  <p className="mt-1 text-sm text-slate-500">Pickup: {formatDate(cancellationModalBooking.pickupAt)}</p>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  Are you sure you want to cancel? The owner will be notified, and this booking will no longer be active.
                </p>
                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setCancellationModalBooking(null)}
                    disabled={Boolean(cancellingBookingId)}
                    className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Keep booking
                  </button>
                  <button
                    type="button"
                    onClick={confirmCancellation}
                    disabled={Boolean(cancellingBookingId)}
                    className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-200 transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {cancellingBookingId ? "Cancelling..." : "Yes, cancel booking"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      <ChatWidget
        isOpen={showAI}
        onOpen={() => setShowAI(true)}
        onClose={() => setShowAI(false)}
        onViewAvailableVehicles={onNavigateToVehicles}
      />
      <PaymentSuccessToast
        notice={activePaymentRecovery?.stage === "checking"
          ? {
              id: `${activePaymentRecovery.bookingId}:${activePaymentRecovery.checkoutId}`,
              kind: "processing",
              message: "Processing payment, please wait...",
            }
          : paymentSuccessToast}
      />
      {reviewPromptBooking && (
        <BookingReviewModal
          key={reviewPromptBooking._id}
          booking={reviewPromptBooking}
          onClose={() => setReviewPromptBooking(null)}
          onSubmitted={(reviewedBooking) => {
            setBookings((previous) => previous.map((booking) => booking._id === reviewedBooking._id ? reviewedBooking : booking));
            setReviewPromptCandidates((previous) => previous.map((booking) => booking._id === reviewedBooking._id ? reviewedBooking : booking));
          }}
        />
      )}
      <ReportIssueModal booking={reportBooking} perspective="renter" onClose={() => setReportBooking(null)} onSubmitted={(report) => setReportNotice(`Report ${report.caseReference} was submitted for administrator review.`)} />
      <MessageReportModal
        message={chatReportMessage}
        senderName={chatBooking ? getOwnerDisplayName(chatBooking) : "this owner"}
        onClose={() => setChatReportMessage(null)}
        onReported={(report) => setReportNotice(`Message reported as ${report.caseReference}. Only that message was included.`)}
      />
    </div>
  );
}

function OwnerAvatar({ owner }) {
  const [imageFailed, setImageFailed] = useState(false);
  const name = getOwnerDisplayName({ owner });
  const avatar = resolveAssetUrl(owner?.avatar || "");
  const showImage = Boolean(avatar) && !imageFailed;

  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#017FE6] text-sm font-semibold text-white ring-4 ring-blue-50">
      {showImage ? (
        <img
          src={avatar}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        getInitialsFromName(name || "Owner")
      )}
    </div>
  );
}

function Line({ label, value, strong = false }) {
  return (
    <div className={`rp-payment-line ${strong ? "font-semibold text-gray-900" : "text-gray-700"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
