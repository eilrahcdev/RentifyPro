import { useEffect, useMemo, useState } from "react";
import API from "../utils/api";
import { getSocket } from "../utils/socket";
import Navbar from "../components/Navbar";
import BookingAccessModal from "../components/BookingAccessModal";
import ChatWidget from "../components/ChatWidget";
import { requestLiveCountersRefresh } from "../utils/liveCounters";
import { getTransactionFee } from "../utils/fees";

const statusStyles = {
  pending: "bg-amber-100 text-amber-800 border border-amber-200",
  confirmed: "bg-blue-100 text-blue-800 border border-blue-200",
  completed: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  cancelled: "bg-rose-100 text-rose-800 border border-rose-200",
  rejected: "bg-rose-100 text-rose-800 border border-rose-200",
};

const paymentStyles = {
  unpaid: "bg-rose-100 text-rose-800 border border-rose-200",
  partial: "bg-orange-100 text-orange-800 border border-orange-200",
  paid: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  refunded: "bg-cyan-100 text-cyan-800 border border-cyan-200",
};
const DOWNPAYMENT_RATE = 0.3;

const money = (value) =>
  `\u20b1${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
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
const appendUniqueMessage = (list, message) =>
  list.some((item) => item._id === message._id) ? list : [...list, message];
const getRentalTotal = (booking) => {
  const total = Number(booking?.totalAmount);
  if (Number.isFinite(total) && total >= 0) return total;

  const baseAmount = Number(booking?.baseAmount);
  const driverAmount = Number(booking?.driverAmount);
  if (Number.isFinite(baseAmount) && Number.isFinite(driverAmount) && baseAmount + driverAmount > 0) {
    return baseAmount + driverAmount;
  }

  const vehicleDailyRate = Number(booking?.vehicleDailyRate);
  const bookingDays = Number(booking?.bookingDays || 1);
  if (Number.isFinite(vehicleDailyRate) && vehicleDailyRate > 0 && Number.isFinite(bookingDays) && bookingDays > 0) {
    const driverDailyRate = Number(booking?.driverDailyRate || 0);
    const driverSelected = Boolean(booking?.driverSelected);
    const driverAmountFromRate =
      driverSelected && Number.isFinite(driverDailyRate) && driverDailyRate > 0
        ? driverDailyRate * bookingDays
        : 0;
    return vehicleDailyRate * bookingDays + driverAmountFromRate;
  }

  const payable = Number(booking?.amountPayable);
  if (Number.isFinite(payable) && payable >= 0) {
    return Math.max(payable - getTransactionFee(), 0);
  }

  return 0;
};

const getVehicleRateForPayment = (booking) => getRentalTotal(booking);

const getAmountPayable = (booking) => getRentalTotal(booking) + getTransactionFee();

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
  onNavigateToBookingHistory,
  onNavigateToAccountSettings,
  onLogout,
}) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [chatBooking, setChatBooking] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState("");
  const [chatError, setChatError] = useState("");
  const [showAuthPrompt, setShowAuthPrompt] = useState(!isLoggedIn);
  const [payingBookingId, setPayingBookingId] = useState("");
  const [verifyingBookingId, setVerifyingBookingId] = useState("");
  const [paymentErrors, setPaymentErrors] = useState({});
  const [paymentNotice, setPaymentNotice] = useState("");
  const [approvalModalBooking, setApprovalModalBooking] = useState(null);
  const [paymentConfirmBooking, setPaymentConfirmBooking] = useState(null);
  const [paymentPreferences, setPaymentPreferences] = useState({
    scope: "downpayment",
    channel: "ewallet",
  });
  const [showAI, setShowAI] = useState(false);
  const currentUserId = user?._id || JSON.parse(localStorage.getItem("user") || "{}")._id || "";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const bookingResponse = await API.getMyBookings(statusFilter);
      const normalized = (bookingResponse.bookings || []).map((booking) =>
        booking.status === "rejected" ? { ...booking, status: "cancelled" } : booking
      );
      setBookings(normalized);
      requestLiveCountersRefresh();
    } catch (err) {
      setError(err.message || "Failed to load booking history.");
    } finally {
      setLoading(false);
    }
  };

  const upsertBooking = (incomingBooking) => {
    if (!incomingBooking?._id) return;
    const normalized =
      incomingBooking.status === "rejected"
        ? { ...incomingBooking, status: "cancelled" }
        : incomingBooking;
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
      setChatBooking(null);
      setChatMessages([]);
      setLoading(false);
      setError("");
      setShowAuthPrompt(true);
      return;
    }

    setShowAuthPrompt(false);
    load();
  }, [isLoggedIn, statusFilter]);

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
      const senderId = String(message.sender?._id || message.sender);
      const receiverId = String(message.receiver?._id || message.receiver);

      if ([senderId, receiverId].includes(ownerId)) {
        setChatMessages((prev) => appendUniqueMessage(prev, message));
      }
    };

    socket.on("booking:updated", handleBookingUpdate);
    socket.on("chat:message", handleIncomingMessage);
    return () => {
      socket.off("booking:updated", handleBookingUpdate);
      socket.off("chat:message", handleIncomingMessage);
    };
  }, [isLoggedIn, chatBooking]);

  const filteredBookings = useMemo(
    () =>
      statusFilter === "all"
        ? bookings
        : bookings.filter((booking) => booking.status === statusFilter),
    [bookings, statusFilter]
  );

  const cancelBooking = async (bookingId) => {
    try {
      const response = await API.cancelBooking(bookingId);
      setBookings((prev) =>
        prev.map((booking) => (booking._id === bookingId ? response.booking : booking))
      );
    } catch (err) {
      setError(err.message || "Failed to cancel booking.");
    }
  };

  const submitReview = async (bookingId) => {
    const draft = reviewDrafts[bookingId];
    if (!draft || !draft.rating) return;

    try {
      const response = await API.reviewBooking(bookingId, {
        rating: Number(draft.rating),
        comment: draft.comment || "",
      });
      setBookings((prev) =>
        prev.map((booking) => (booking._id === bookingId ? response.booking : booking))
      );
    } catch (err) {
      setError(err.message || "Failed to submit review.");
    }
  };

  const openChat = async (booking) => {
    if (!booking?.owner?._id) return;
    setChatBooking(booking);
    setChatError("");
    setChatText("");
    try {
      const response = await API.getMessagesWithUser(booking.owner._id, booking._id);
      setChatMessages(response.messages || []);
      await API.markMessagesAsRead(booking.owner._id);
      requestLiveCountersRefresh();
    } catch (err) {
      setChatError(err.message || "Failed to load chat.");
    }
  };

  const sendChatMessage = async () => {
    if (!chatBooking?.owner?._id || !chatText.trim()) return;
    try {
      const response = await API.sendMessageToUser(chatBooking.owner._id, {
        text: chatText.trim(),
        bookingId: chatBooking._id,
      });
      setChatMessages((prev) => appendUniqueMessage(prev, response.message));
      setChatText("");
    } catch (err) {
      setChatError(err.message || "Failed to send message.");
    }
  };

  const startPayment = async (bookingId, options = {}) => {
    if (!bookingId) return;
    setPaymentNotice("");
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

  const handlePayNow = (booking) => {
    if (!booking?._id) return;
    if (booking.status !== "confirmed") {
      setApprovalModalBooking(booking);
      return;
    }
    const isPartial = String(booking.paymentStatus || "").toLowerCase() === "partial";
    setPaymentPreferences({
      scope: isPartial ? "full" : "downpayment",
      channel: "ewallet",
    });
    setPaymentConfirmBooking(booking);
  };

  const confirmAndStartPayment = () => {
    const bookingId = paymentConfirmBooking?._id;
    if (!bookingId) return;
    const isPartial = String(paymentConfirmBooking?.paymentStatus || "").toLowerCase() === "partial";
    const scope = isPartial ? "full" : paymentPreferences.scope;
    const channel = paymentPreferences.channel;
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
      setPaymentNotice("Payment was cancelled.");
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
      setVerifyingBookingId(bookingId);
      setPaymentErrors((prev) => ({ ...prev, [bookingId]: "" }));
      try {
        const maxAttempts = 4;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const response = await API.verifyBookingPayment(bookingId, checkoutId);
          if (!isActive) return;

          if (response.booking) {
            upsertBooking(response.booking);
          }

          const paymentStatus = String(
            response.paymentStatus || response.booking?.paymentStatus || ""
          ).toLowerCase();
          const paymentCaptured =
            Boolean(response.paymentCaptured) || paymentStatus === "paid" || paymentStatus === "partial";

          if (paymentCaptured) {
            requestLiveCountersRefresh();
            const paidBooking = response.booking || null;
            const blockchainWarning = response?.blockchain?.warning || "";
            if (paymentStatus === "partial") {
              const remaining = paidBooking
                ? moneyWithCents(getPaymentRemainingAmount(paidBooking))
                : moneyWithCents(0);
              setPaymentNotice(`Downpayment successful. Remaining balance: ${remaining}.`);
            } else if (paidBooking?.blockchainTxHash) {
              setPaymentNotice("Payment successful. Booking has been recorded on blockchain.");
            } else if (blockchainWarning) {
              setPaymentNotice(`Payment successful. Blockchain recording is pending: ${blockchainWarning}`);
            } else {
              setPaymentNotice("Payment successful. Blockchain recording is being processed automatically.");
            }
            return;
          }

          if (attempt < maxAttempts) {
            await wait(1500);
          }
        }

        setPaymentNotice("Payment is still processing. Please check again in a moment.");
      } catch (err) {
        if (!isActive) return;
        setPaymentErrors((prev) => ({
          ...prev,
          [bookingId]: err.message || "Failed to verify payment.",
        }));
      } finally {
        if (isActive) {
          setVerifyingBookingId("");
          clearQuery();
        }
      }
    };

    verifyPayment();
    return () => {
      isActive = false;
    };
  }, [isLoggedIn]);

  const confirmIsPartial =
    String(paymentConfirmBooking?.paymentStatus || "").trim().toLowerCase() === "partial";
  const confirmTotalPayable = paymentConfirmBooking ? getAmountPayable(paymentConfirmBooking) : 0;
  const confirmPaidAmount = paymentConfirmBooking ? getPaymentPaidAmount(paymentConfirmBooking) : 0;
  const confirmRemainingAmount = paymentConfirmBooking
    ? getPaymentRemainingAmount(paymentConfirmBooking)
    : 0;
  const confirmScope = confirmIsPartial ? "full" : paymentPreferences.scope;
  const confirmChargeAmount = paymentConfirmBooking
    ? confirmScope === "downpayment"
      ? roundCurrency(confirmTotalPayable * DOWNPAYMENT_RATE)
      : confirmRemainingAmount
    : 0;
  const confirmRemainingAfterPayment = paymentConfirmBooking
    ? roundCurrency(Math.max(confirmRemainingAmount - confirmChargeAmount, 0))
    : 0;

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gray-50">
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
          onNavigateToAccountSettings={onNavigateToAccountSettings}
          isAIOpen={showAI}
          onShowAI={() => setShowAI(true)}
          onLogout={onLogout}
        />

        <div className="max-w-4xl mx-auto px-6 pt-24 pb-16">
          <div className="bg-white border rounded-2xl p-8 text-center">
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
        <ChatWidget isOpen={showAI} onClose={() => setShowAI(false)} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
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
        onNavigateToAccountSettings={onNavigateToAccountSettings}
        isAIOpen={showAI}
        onShowAI={() => setShowAI(true)}
        onLogout={onLogout}
      />

      <div className="max-w-7xl mx-auto px-6 pt-24 pb-16 space-y-6">
        <div className="flex justify-between items-start gap-4">
          <div>
            <h1 className="text-3xl font-bold">My Bookings</h1>
            <p className="text-sm text-gray-600">Real-time booking updates and notifications.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {loading && <p className="text-sm text-gray-600">Loading bookings...</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {paymentNotice && <p className="text-sm text-emerald-700">{paymentNotice}</p>}

        {!loading && !error && filteredBookings.length === 0 && (
          <div className="bg-white border rounded-xl p-6 text-sm text-gray-600">
            No bookings found.
          </div>
        )}

        <div className="space-y-4">
          {filteredBookings.map((booking) => (
            <article key={booking._id} className="bg-white border rounded-xl p-5">
              <div className="flex flex-col md:flex-row md:justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{booking.vehicle?.name || "Vehicle"}</h2>
                  <p className="text-sm text-gray-500">{booking.vehicle?.location || "-"}</p>
                </div>
                <div className="flex gap-2">
                  <span
                    className={`inline-flex items-center text-xs font-semibold px-3 py-1 rounded-full ${
                      statusStyles[booking.status] || "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {toTitleCase(booking.status)}
                  </span>
                  <span
                    className={`inline-flex items-center text-xs font-semibold px-3 py-1 rounded-full ${
                      paymentStyles[booking.paymentStatus] || "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {toTitleCase(booking.paymentStatus)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-4 text-sm">
                <Info title="Pickup" value={formatDate(booking.pickupAt)} />
                <Info title="Return" value={formatDate(booking.returnAt)} />
                <Info title="Duration" value={`${booking.bookingDays} day(s)`} />
                <Info title="Vehicle Rate" value={money(booking.vehicleDailyRate)} />
                <Info title="Driver" value={booking.driverSelected ? money(booking.driverDailyRate) : "No"} />
                <Info title="Rental Total" value={money(booking.totalAmount)} />
                <Info title="Transaction Fee" value={moneyWithCents(getTransactionFee())} />
                <Info title="Amount Payable" value={moneyWithCents(getAmountPayable(booking))} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => openChat(booking)}
                  className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm"
                >
                  Chat Owner
                </button>

                {["unpaid", "partial"].includes(String(booking.paymentStatus || "").toLowerCase()) &&
                  !["cancelled", "rejected"].includes(booking.status) && (
                    <button
                      onClick={() => handlePayNow(booking)}
                      disabled={payingBookingId === booking._id || verifyingBookingId === booking._id}
                      className={`px-3 py-2 rounded-lg text-sm ${
                        payingBookingId === booking._id || verifyingBookingId === booking._id
                          ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                          : booking.status === "confirmed"
                            ? "bg-[#017FE6] text-white"
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

                {["unpaid", "partial"].includes(String(booking.paymentStatus || "").toLowerCase()) &&
                  booking.status !== "confirmed" &&
                  !["cancelled", "rejected"].includes(booking.status) && (
                    <p className="w-full text-xs text-amber-700">
                      Payment is locked until the owner approves this booking.
                    </p>
                  )}

                {["pending", "confirmed"].includes(booking.status) && (
                  <button
                    onClick={() => cancelBooking(booking._id)}
                    className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm"
                  >
                    Cancel Booking
                  </button>
                )}

                {booking.status === "completed" && !booking.reviewRating && (
                  <>
                    <select
                      className="border rounded-lg px-2 py-2 text-sm"
                      value={reviewDrafts[booking._id]?.rating || ""}
                      onChange={(e) =>
                        setReviewDrafts((prev) => ({
                          ...prev,
                          [booking._id]: {
                            ...prev[booking._id],
                            rating: e.target.value,
                          },
                        }))
                      }
                    >
                      <option value="">Rating</option>
                      {[5, 4, 3, 2, 1].map((rating) => (
                        <option key={rating} value={rating}>
                          {rating}
                        </option>
                      ))}
                    </select>
                    <input
                      className="border rounded-lg px-3 py-2 text-sm min-w-[220px]"
                      placeholder="Leave a review"
                      value={reviewDrafts[booking._id]?.comment || ""}
                      onChange={(e) =>
                        setReviewDrafts((prev) => ({
                          ...prev,
                          [booking._id]: {
                            ...prev[booking._id],
                            comment: e.target.value,
                          },
                        }))
                      }
                    />
                    <button
                      onClick={() => submitReview(booking._id)}
                      className="px-3 py-2 rounded-lg bg-[#017FE6] text-white text-sm"
                    >
                      Submit Review
                    </button>
                  </>
                )}

                {booking.reviewRating && (
                  <span className="text-sm text-green-700">
                    Review submitted: {booking.reviewRating}/5
                  </span>
                )}

                {paymentErrors[booking._id] && (
                  <p className="w-full text-xs text-red-600">{paymentErrors[booking._id]}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      {chatBooking && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-900/45 backdrop-blur-[2px]"
            onClick={() => setChatBooking(null)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.25)] flex flex-col max-h-[80vh]">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-[#0B75E7]/10 via-white to-white">
                <div>
                  <p className="font-semibold text-slate-900">Chat with {chatBooking.owner?.name || "Owner"}</p>
                  <p className="text-xs text-slate-500">{chatBooking.vehicle?.name}</p>
                </div>
                <button
                  onClick={() => setChatBooking(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200"
                  aria-label="Close chat"
                >
                  ×
                </button>
              </div>

              <div className="p-4 overflow-y-auto flex-1 space-y-2 bg-slate-50">
                {chatError && <p className="text-sm text-red-600">{chatError}</p>}
                {!chatMessages.length && (
                  <p className="text-sm text-slate-500">No messages yet.</p>
                )}
                {chatMessages.map((message) => {
                  const isMe = String(message.sender?._id || message.sender) === String(currentUserId);
                  return (
                    <div key={message._id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                          isMe ? "bg-[#017FE6] text-white" : "bg-white border"
                        }`}
                      >
                        <p>{message.text}</p>
                        <p className={`text-[10px] mt-1 ${isMe ? "text-white/80" : "text-gray-500"}`}>
                          {formatDate(message.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-slate-200 p-3 flex gap-2">
                <input
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#0B75E7] focus:outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder="Type your message"
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                />
                <button
                  onClick={sendChatMessage}
                  className="rp-btn-primary px-4 py-2 text-sm"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {approvalModalBooking && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/45 backdrop-blur-[2px] z-[70]"
            onClick={() => setApprovalModalBooking(null)}
          />
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-[0_25px_80px_rgba(15,23,42,0.25)]">
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
        <>
          <div
            className="fixed inset-0 bg-slate-900/45 backdrop-blur-[2px] z-[70]"
            onClick={() => {
              if (!payingBookingId) setPaymentConfirmBooking(null);
            }}
          />
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-[0_25px_80px_rgba(15,23,42,0.25)]">
              <div className="px-6 pt-5 pb-4 border-b border-slate-200 bg-gradient-to-r from-[#0B75E7]/10 via-white to-white">
                <h3 className="text-lg font-semibold text-slate-900">Confirm Payment</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Review your payment before continuing.
                </p>
              </div>

              <div className="px-6 py-5">
              <div className="rounded-xl border p-4 space-y-2 text-sm">
                <Line label="Vehicle Rate" value={money(getVehicleRateForPayment(paymentConfirmBooking))} />
                <Line label="Transaction Fee" value={moneyWithCents(getTransactionFee())} />
                <Line label="Already Paid" value={moneyWithCents(confirmPaidAmount)} />
                <Line
                  label="Total Amount Payable"
                  value={moneyWithCents(confirmTotalPayable)}
                  strong
                />
                <Line label="Remaining Balance" value={moneyWithCents(confirmRemainingAmount)} />
              </div>

              <div className="mt-4 space-y-3">
                <p className="text-sm font-semibold text-gray-800">Pay Now Option</p>
                {confirmIsPartial ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    A downpayment is already recorded. Please pay the remaining balance in full.
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={paymentPreferences.scope === "downpayment"}
                        onChange={() =>
                          setPaymentPreferences((prev) => ({ ...prev, scope: "downpayment" }))
                        }
                      />
                      <span className="text-sm text-gray-700">
                        Downpayment (30%): {moneyWithCents(roundCurrency(confirmTotalPayable * DOWNPAYMENT_RATE))}
                      </span>
                    </label>
                    <label className="flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={paymentPreferences.scope === "full"}
                        onChange={() => setPaymentPreferences((prev) => ({ ...prev, scope: "full" }))}
                      />
                      <span className="text-sm text-gray-700">
                        Full Payment: {moneyWithCents(confirmRemainingAmount)}
                      </span>
                    </label>
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-3">
                <p className="text-sm font-semibold text-gray-800">Payment Method</p>
                <div className="space-y-2">
                  <label className="flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={paymentPreferences.channel === "ewallet"}
                      onChange={() => setPaymentPreferences((prev) => ({ ...prev, channel: "ewallet" }))}
                    />
                    <span className="text-sm text-gray-700">E-wallet (GCash / Maya)</span>
                  </label>
                  <label className="flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={paymentPreferences.channel === "card"}
                      onChange={() => setPaymentPreferences((prev) => ({ ...prev, channel: "card" }))}
                    />
                    <span className="text-sm text-gray-700">Credit / Debit Card</span>
                  </label>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm space-y-1">
                <Line label="Amount to Charge Now" value={moneyWithCents(confirmChargeAmount)} strong />
                <Line
                  label="Balance After This Payment"
                  value={moneyWithCents(confirmRemainingAfterPayment)}
                />
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => setPaymentConfirmBooking(null)}
                  disabled={Boolean(payingBookingId)}
                  className="rp-btn-secondary px-4 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmAndStartPayment}
                  disabled={Boolean(payingBookingId)}
                  className="rp-btn-primary px-4 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {payingBookingId ? "Processing..." : "Proceed to Pay"}
                </button>
              </div>
              </div>
            </div>
          </div>
        </>
      )}
      <ChatWidget isOpen={showAI} onClose={() => setShowAI(false)} />
    </div>
  );
}

function Info({ title, value }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-gray-500">{title}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function Line({ label, value, strong = false }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold text-gray-900" : "text-gray-700"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
