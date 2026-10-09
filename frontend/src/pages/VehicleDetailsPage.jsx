import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MapPin,
  MessageCircle,
  Star,
} from "lucide-react";
import API from "../utils/api";
import Navbar from "../components/Navbar";
import HelpLink from "../components/HelpLink";
import { showActionToast } from "../utils/actionToast";
import {
  formatDisplayName,
  getCurrentTime,
  getDateTime,
  getBookingDurationMinutes,
  getDurationHoursFromMinutes,
  formatDurationMinutes,
  getMinPickupDate,
  getMaxBookingDate,
  getMinPickupDateTime,
  getMinPickupTime,
  getMinReturnDate,
  getMinReturnDateTime,
  getMinReturnTime,
  getTodayDate,
  getTomorrowDate,
  getInitialsFromName,
  sanitizeBookingRange,
} from "../utils/dateUtils";
import {
  getVehicleGalleryImages,
  resolveAssetUrl,
} from "../utils/media";
import { getTransactionFee } from "../utils/fees";
import { formatVehicleTypeLabel } from "../utils/vehicleText";
import VehicleCover from "../components/VehicleCover";
import VehicleThumbnail from "../components/VehicleThumbnail";
const DOWNPAYMENT_RATE = 0.3;
const money = (value) => `P${Number(value || 0).toLocaleString()}`;
const moneyWithCents = (value) =>
  `P${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const bookingReference = (bookingId) => `#${String(bookingId || "").slice(-6).toUpperCase()}`;
const BALANCE_REASON_CODES = new Set([
  "OVERDUE_BOOKING_BALANCE",
  "UNPAID_LATE_RETURN_PENALTY",
]);
const getCompactEligibilityMessage = (reason) => {
  if (!reason) return "Booking unavailable. Please review your bookings.";

  const reference = bookingReference(reason.bookingId);
  switch (reason.code) {
    case "OVERDUE_VEHICLE_RETURN":
      return `Booking ${reference}: Return overdue. Resolve it or request an extension.`;
    case "UNPAID_LATE_RETURN_PENALTY":
      return `Booking ${reference} · ${moneyWithCents(reason.amountDue)} due, including a late fee`;
    case "OVERDUE_BOOKING_BALANCE":
      return `Booking ${reference} · ${moneyWithCents(reason.amountDue)} due`;
    case "OPEN_BOOKING_LIMIT":
      return "3 open bookings reached. Complete or cancel one to continue.";
    case "PENDING_BOOKING_LIMIT":
      return "2 pending requests reached. Wait or cancel one to continue.";
    case "RENTER_SCHEDULE_CONFLICT":
      return "These dates overlap another booking. Choose different dates.";
    default:
      return reason.message || "Booking unavailable. Please review your bookings.";
  }
};
const roundCurrency = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
};

function normalizeAvailability(vehicle) {
  if (typeof vehicle?.availabilityStatus === "string") return vehicle.availabilityStatus.toLowerCase();
  return vehicle?.available ? "available" : "unavailable";
}

function normalizeReviews(vehicle) {
  if (!Array.isArray(vehicle?.reviews) || vehicle.reviews.length === 0) return [];
  return vehicle.reviews.map((review, index) => ({
    id: review._id || review.id || `review-${index}`,
    name: formatDisplayName(review.user?.name || review.name, "Verified Renter"),
    avatar: resolveAssetUrl(review.user?.avatar || review.avatar),
    rating: Number(review.rating || 0),
    comment: review.comment || "No written comment provided.",
    date: review.date || review.createdAt || new Date().toISOString(),
  }));
}

export default function VehicleDetailsPage({
  vehicle,
  bookingData,
  setBookingData,
  onBack,
  onNavigateToHome,
  onNavigateToSignIn,
  onSignInToBook,
  onNavigateToRegister,
  onNavigateToVehicles,
  onNavigateToBookingHistory,
  onNavigateToChat,
  onNavigateToNotifications,
  onNavigateToAbout,
  onNavigateToContacts,
  onNavigateToAccountSettings,
  onNavigateToReports,
  isLoggedIn,
  user,
  onLogout,
}) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [showReviewsModal, setShowReviewsModal] = useState(false);
  const [sortOption, setSortOption] = useState("recent");
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [eligibilityState, setEligibilityState] = useState(null);
  const [eligibilityRetry, setEligibilityRetry] = useState(0);
  const [bookingRequiresKyc, setBookingRequiresKyc] = useState(false);
  const [chatOwnerError, setChatOwnerError] = useState("");
  const [driverSelected, setDriverSelected] = useState(false);
  const [vehicleData, setVehicleData] = useState(vehicle || null);
  const vehicleId = vehicleData?._id || vehicleData?.id || vehicle?._id || vehicle?.id;
  const currentVehicle = useMemo(() => vehicleData || vehicle || {}, [vehicleData, vehicle]);

  const { pickupDate, pickupTime, returnDate, returnTime } = bookingData;
  const renterId = user?._id || user?.id || "";
  const eligibilityKey = `${isLoggedIn}:${renterId}:${pickupDate}:${pickupTime}:${returnDate}:${returnTime}`;
  const eligibility = eligibilityState?.key === eligibilityKey ? eligibilityState.data : null;
  const eligibilityError = eligibilityState?.key === eligibilityKey ? eligibilityState.error : "";
  const balanceReasons = eligibility?.reasons?.filter((reason) => BALANCE_REASON_CODES.has(reason.code)) || [];
  const firstNonBalanceReason = eligibility?.reasons?.find((reason) => !BALANCE_REASON_CODES.has(reason.code));
  const needsIdentityVerification = isLoggedIn && (
    bookingRequiresKyc || (user?.role !== "admin" && String(user?.kycStatus || "not_started") !== "approved")
  );
  const knownEligibilityBlock = isLoggedIn && eligibility?.eligible === false;
  const changeDatesToBook = knownEligibilityBlock && eligibility.reasons?.length > 0
    && eligibility.reasons.every((reason) => reason.code === "RENTER_SCHEDULE_CONFLICT");
  const resolveInBookings = knownEligibilityBlock && !changeDatesToBook;

  useEffect(() => {
    if (!isLoggedIn) return undefined;
    let active = true;
    const timer = setTimeout(async () => {
      const pickupAt = getDateTime(pickupDate, pickupTime);
      const returnAt = getDateTime(returnDate, returnTime);
      const validRange = pickupAt && returnAt && Number.isFinite(pickupAt.getTime()) && Number.isFinite(returnAt.getTime()) && returnAt > pickupAt && pickupDate <= getMaxBookingDate() && returnDate <= getMaxBookingDate();
      try {
        const response = await API.getBookingEligibility(validRange ? {
          pickupAt: pickupAt.toISOString(), returnAt: returnAt.toISOString(),
        } : {});
        if (active) setEligibilityState({ key: eligibilityKey, data: response.eligibility });
      } catch {
        if (active) setEligibilityState({ key: eligibilityKey, error: "Unable to check your booking limits. Retry or submit to check again." });
      }
    }, 250);
    const refresh = () => setEligibilityRetry((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [isLoggedIn, eligibilityKey, eligibilityRetry, pickupDate, pickupTime, returnDate, returnTime]);

  useEffect(() => {
    setVehicleData(vehicle || null);
  }, [vehicle]);

  useEffect(() => {
    if (!vehicleId) return undefined;
    let isActive = true;

    API.getPublicVehicleById(vehicleId)
      .then((response) => {
        if (!isActive || !response?.vehicle) return;
        setVehicleData((prev) => ({
          ...(prev || {}),
          ...response.vehicle,
        }));
      })
      .catch(() => {
        // Keep the passed vehicle payload if refresh fails.
      });

    return () => {
      isActive = false;
    };
  }, [vehicleId]);

  useEffect(() => {
    setBookingData((prev) => {
      const normalized = sanitizeBookingRange({
        ...prev,
        pickupDate: prev.pickupDate || getTodayDate(),
        pickupTime: prev.pickupTime || getCurrentTime(),
        returnDate: prev.returnDate || getTomorrowDate(),
        returnTime: prev.returnTime || getCurrentTime(),
      });

      if (
        prev.pickupDate === normalized.pickupDate &&
        prev.pickupTime === normalized.pickupTime &&
        prev.returnDate === normalized.returnDate &&
        prev.returnTime === normalized.returnTime
      ) {
        return prev;
      }
      return { ...prev, ...normalized };
    });
  }, [setBookingData]);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [vehicleId]);

  const galleryImages = useMemo(() => {
    return getVehicleGalleryImages(currentVehicle);
  }, [currentVehicle]);

  useEffect(() => {
    if (activeImageIndex >= galleryImages.length) setActiveImageIndex(0);
  }, [activeImageIndex, galleryImages.length]);

  const availabilityStatus = normalizeAvailability(currentVehicle);
  const isAvailable = availabilityStatus === "available";
  const reviews = normalizeReviews(currentVehicle);
  const hourlyRate = Number(currentVehicle?.dailyRentalRate ?? currentVehicle?.hourlyRentalRate ?? currentVehicle?.price ?? 0);
  const driverOptionEnabled = Boolean(currentVehicle?.driverOptionEnabled);
  const driverHourlyRate = Number(currentVehicle?.driverDailyRate || currentVehicle?.driverHourlyRate || 0);
  const lateReturnPolicy = currentVehicle?.lateReturnPolicy || {};
  const lateReturnFeeType = lateReturnPolicy.feeType || currentVehicle?.lateReturnFeeType || "percentage";
  const lateReturnFeeValue = Number(lateReturnPolicy.value ?? currentVehicle?.lateReturnFeeValue ?? 0);

  useEffect(() => {
    if (!driverOptionEnabled && driverSelected) setDriverSelected(false);
  }, [driverOptionEnabled, driverSelected]);

  const durationMinutes = useMemo(() => {
    return getBookingDurationMinutes(pickupDate, pickupTime, returnDate, returnTime);
  }, [pickupDate, pickupTime, returnDate, returnTime]);

  const durationHours = useMemo(() => getDurationHoursFromMinutes(durationMinutes), [durationMinutes]);
  const vehicleCost = roundCurrency(durationHours * hourlyRate);
  const driverCost = roundCurrency(driverSelected ? durationHours * driverHourlyRate : 0);
  const transactionFee = getTransactionFee();
  const estimatedTotal = roundCurrency(vehicleCost + driverCost + transactionFee);
  const downpaymentFee = roundCurrency(estimatedTotal * DOWNPAYMENT_RATE);
  const lateReturnHourlyRate = roundCurrency(
    lateReturnFeeType === "fixed_hourly"
      ? lateReturnFeeValue
      : (hourlyRate + (driverSelected ? driverHourlyRate : 0)) * (lateReturnFeeValue / 100)
  );

  const averageRating = useMemo(() => {
    const fromVehicle = Number(currentVehicle?.averageRating ?? currentVehicle?.rating);
    if (Number.isFinite(fromVehicle) && fromVehicle > 0) {
      return Number(fromVehicle.toFixed(1));
    }
    if (!reviews.length) return 0;
    const total = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
    return Number((total / reviews.length).toFixed(1));
  }, [currentVehicle?.averageRating, currentVehicle?.rating, reviews]);

  const sortedReviews = useMemo(() => {
    if (sortOption === "highest") {
      return [...reviews].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
    }
    if (sortOption === "lowest") {
      return [...reviews].sort((a, b) => Number(a.rating || 0) - Number(b.rating || 0));
    }
    return [...reviews].sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [reviews, sortOption]);

  const minReturnDate = getMinReturnDate(pickupDate, pickupTime);
  const minReturnTime = getMinReturnTime(pickupDate, pickupTime);

  const validateBookingRange = () => {
    const minPickup = getMinPickupDateTime();
    const pickup = getDateTime(pickupDate, pickupTime);
    const dropoff = getDateTime(returnDate, returnTime);

    if (!pickup || !dropoff) {
      return "Please provide valid pickup and return date/time.";
    }
    if (pickupDate > getMaxBookingDate() || returnDate > getMaxBookingDate()) {
      return "Pickup and return must be within 6 months from today.";
    }
    if (pickup < minPickup) {
      return "Pickup must be at least 10 minutes from now.";
    }
    if (dropoff <= pickup) {
      return "Return must be after pickup.";
    }
    if (pickupDate === returnDate) {
      const minReturn = getMinReturnDateTime(pickupDate, pickupTime);
      if (!minReturn || dropoff < minReturn) {
        return "For same-day rentals, return must be at least 1 hour after pickup.";
      }
    }
    return "";
  };

  const handleContinueBooking = async () => {
    setBookingError("");

    if (!isLoggedIn) {
      onSignInToBook?.(currentVehicle);
      return;
    }

    const userRequiresKyc =
      user?.role !== "admin" && String(user?.kycStatus || "not_started") !== "approved";
    if (userRequiresKyc || bookingRequiresKyc) {
      onNavigateToAccountSettings?.();
      return;
    }

    if (!isAvailable) {
      setBookingError("This vehicle is currently unavailable.");
      return;
    }

    if (!vehicleId) {
      setBookingError("Vehicle ID is missing. Please go back and select the vehicle again.");
      return;
    }

    const validationError = validateBookingRange();
    if (validationError) {
      setBookingError(validationError);
      return;
    }

    setBookingLoading(true);
    try {
      const response = await API.createBooking({
        vehicleId,
        pickupAt: `${pickupDate}T${pickupTime}`,
        returnAt: `${returnDate}T${returnTime}`,
        driverSelected,
      });
      if (response?.success === false) throw new Error(response.message || "Booking could not be submitted.");
      showActionToast("Booking request sent. Waiting for owner approval.", { id: `renter-booking-${response?.booking?._id || vehicleId}`, tone: "info" });
      setTimeout(() => onNavigateToBookingHistory?.(), 900);
    } catch (error) {
      if (error?.details?.eligibility) {
        setEligibilityState({ key: eligibilityKey, data: error.details.eligibility });
        // Keep policy errors in the refreshable eligibility panel so a verified
        // payment or date change cannot leave an obsolete submission error.
        return;
      }
      if (error?.details?.code === "IDENTITY_VERIFICATION_REQUIRED") {
        setBookingRequiresKyc(true);
        setBookingError(
          "Complete identity verification in Account Settings before booking. Your session is still active."
        );
      } else {
        setBookingError(error.message || "Failed to submit booking.");
      }
    } finally {
      setBookingLoading(false);
    }
  };

  const goPrevImage = () => {
    setActiveImageIndex((prev) => (prev === 0 ? galleryImages.length - 1 : prev - 1));
  };
  const goNextImage = () => {
    setActiveImageIndex((prev) => (prev + 1) % galleryImages.length);
  };

  const vehicleTypeLabel = formatVehicleTypeLabel(
    currentVehicle?.specs?.type || currentVehicle?.type || "Vehicle",
    currentVehicle?.specs?.subType || currentVehicle?.subType || "Standard"
  );
  const seats = currentVehicle?.specs?.seats || currentVehicle?.seats || 4;
  const transmission = currentVehicle?.specs?.transmission || currentVehicle?.transmission || "Automatic";
  const fuel = currentVehicle?.specs?.fuel || currentVehicle?.fuel || "Gasoline";
  const plateNumber = currentVehicle?.specs?.plateNumber || currentVehicle?.plateNumber || "-";
  const ownerName = currentVehicle?.owner?.name || "Vehicle Owner";
  const ownerInitials = getInitialsFromName(ownerName);
  const ownerEmail = currentVehicle?.owner?.email || "";
  const ownerAvatar = currentVehicle?.owner?.avatar || "";
  const ownerId = String(currentVehicle?.owner?._id || "");
  const ownerVerified = currentVehicle?.owner?.verified !== false;
  const isOwnVehicle = Boolean(ownerId) && String(user?._id || "") === ownerId;

  const handleChatOwner = () => {
    setChatOwnerError("");

    if (!isLoggedIn) {
      onNavigateToSignIn?.();
      return;
    }

    if (!ownerId || !vehicleId) {
      setChatOwnerError("Owner chat is unavailable for this vehicle right now.");
      return;
    }

    if (isOwnVehicle) {
      setChatOwnerError("You cannot chat yourself for your own listing.");
      return;
    }

    onNavigateToChat?.({
      partnerId: ownerId,
      partnerName: ownerName,
      partnerEmail: ownerEmail,
      partnerAvatar: ownerAvatar,
      vehicleId: String(vehicleId),
    });
  };

  const updateBookingRange = (patch) => {
    setBookingError("");
    setBookingData((prev) => {
      const merged = { ...prev, ...patch };
      return { ...merged, ...sanitizeBookingRange(merged) };
    });
  };

  return (
    <div className="rp-vehicle-details rp-renter-page min-h-screen">
      <Navbar
        activePage="vehicles"
        isLoggedIn={isLoggedIn}
        user={user}
        onNavigateToHome={onNavigateToHome}
        onNavigateToSignIn={onNavigateToSignIn}
        onNavigateToRegister={onNavigateToRegister}
        onNavigateToVehicles={onNavigateToVehicles || onBack}
        onNavigateToBookingHistory={onNavigateToBookingHistory}
        onNavigateToAbout={onNavigateToAbout}
        onNavigateToContacts={onNavigateToContacts}
        onNavigateToChat={onNavigateToChat}
        onNavigateToNotifications={onNavigateToNotifications}
        onNavigateToAccountSettings={onNavigateToAccountSettings}
        onNavigateToReports={onNavigateToReports}
        onLogout={onLogout}
      />

      <main className="rp-renter-main mx-auto max-w-[1380px] px-4 pb-16 pt-24 sm:px-6 sm:pt-28">
        <button type="button" onClick={onBack} aria-label="Go back" className="rp-detail-back">
          <ArrowLeft size={18} aria-hidden="true" />Back to vehicles
        </button>
        <div className="rp-vehicle-details-layout">
            <section className="rp-detail-gallery rp-surface p-4" aria-labelledby="vehicle-detail-name">
              <div className="rp-detail-vehicle-summary">
                <div className="min-w-0">
                  <p className="rp-detail-meta">
                    <MapPin size={16} strokeWidth={2} className="shrink-0 text-[#0B75E7]" aria-hidden="true" />
                    <span className="min-w-0 break-words">{currentVehicle?.location || "Location not provided"}</span>
                  </p>
                  <h1 id="vehicle-detail-name" className="rp-detail-vehicle-name">{currentVehicle?.name || "Vehicle"}</h1>
                  <span className={`rp-detail-availability ${isAvailable ? "text-emerald-700" : "text-slate-600"}`}>
                    {isAvailable ? "Available" : "Unavailable"}
                  </span>
                </div>
                <div className="rp-detail-hourly-price">
                  <span className="sr-only">Hourly vehicle rate</span>
                  <p>{money(hourlyRate)}<span> / hour</span></p>
                </div>
              </div>
              <div className="relative">
                <VehicleCover
                  vehicle={currentVehicle}
                  src={galleryImages[activeImageIndex]}
                  alt={currentVehicle?.name || "Vehicle"}
                  variant="listing"
                  className="rp-detail-cover"
                  contentClassName="p-4 sm:p-5"
                />

                {galleryImages.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={goPrevImage}
                      aria-label="Previous image"
                      className="absolute left-2 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-xl bg-white/90 text-slate-700 shadow-md hover:bg-white sm:left-3"
                    >
                      <ChevronLeft size={18} className="mx-auto" />
                    </button>
                    <button
                      type="button"
                      onClick={goNextImage}
                      aria-label="Next image"
                      className="absolute right-2 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-xl bg-white/90 text-slate-700 shadow-md hover:bg-white sm:right-3"
                    >
                      <ChevronRight size={18} className="mx-auto" />
                    </button>
                  </>
                )}
              </div>

              {galleryImages.length > 1 && (
                <div className="rp-detail-thumbnails" aria-label="Vehicle images">
                  {galleryImages.map((image, index) => (
                    <button
                      key={`${image}-${index}`}
                      type="button"
                      onClick={() => setActiveImageIndex(index)}
                      aria-label={`Show vehicle image ${index + 1}`}
                      aria-pressed={index === activeImageIndex}
                      className={`shrink-0 overflow-hidden rounded-xl border transition ${
                        index === activeImageIndex
                          ? "border-[#0B75E7] ring-2 ring-blue-100"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <VehicleThumbnail
                        vehicle={currentVehicle}
                        src={image}
                        alt={`Vehicle preview ${index + 1}`}
                        className="h-12 w-16"
                      />
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section id="booking-form" aria-labelledby="booking-form-title" className="rp-vehicle-booking rp-surface p-4">
              <h2 id="booking-form-title" tabIndex={-1} className="rp-detail-section-title">Book This Vehicle</h2>
              <p className="rp-detail-section-copy mt-1.5">
                Select pickup and return dates within 6 months.
              </p>

              <div className="rp-detail-booking-fields">
                <div className="rp-detail-schedule">
                <div>
                  <p className="rp-detail-form-label">Pickup</p>
                  <div className="rp-detail-date-fields grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <input
                      type="date"
                      aria-label="Pickup date"
                      value={pickupDate || ""}
                      min={getMinPickupDate()}
                      max={getMaxBookingDate()}
                      onChange={(event) => updateBookingRange({ pickupDate: event.target.value })}
                      className="rp-input rp-detail-input"
                    />
                    <input
                      type="time"
                      aria-label="Pickup time"
                      min={pickupDate === getMinPickupDate() ? getMinPickupTime() : undefined}
                      value={pickupTime || ""}
                      onChange={(event) => updateBookingRange({ pickupTime: event.target.value })}
                      className="rp-input rp-detail-input"
                    />
                  </div>
                </div>

                <div>
                  <p className="rp-detail-form-label">Return</p>
                  <div className="rp-detail-date-fields grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <input
                      type="date"
                      aria-label="Return date"
                      value={returnDate || ""}
                      min={minReturnDate || getMinPickupDate()}
                      max={getMaxBookingDate()}
                      onChange={(event) => updateBookingRange({ returnDate: event.target.value })}
                      className="rp-input rp-detail-input"
                    />
                    <input
                      type="time"
                      aria-label="Return time"
                      min={
                        returnDate === minReturnDate && minReturnTime
                          ? minReturnTime
                          : undefined
                      }
                      value={returnTime || ""}
                      onChange={(event) => updateBookingRange({ returnTime: event.target.value })}
                      className="rp-input rp-detail-input"
                    />
                  </div>
                </div>
                </div>

                {driverOptionEnabled && (
                  <div>
                    <label className="rp-detail-form-label">Driver Option</label>
                    <div className="rp-detail-driver-fields grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setDriverSelected(false)}
                        className={`rp-detail-toggle border px-3 py-2.5 transition ${
                          !driverSelected
                            ? "border-[#0B75E7] bg-blue-50 text-[#0B75E7]"
                            : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        Without driver
                      </button>
                      <button
                        type="button"
                        onClick={() => setDriverSelected(true)}
                        className={`rp-detail-toggle border px-3 py-2.5 transition ${
                          driverSelected
                            ? "border-[#0B75E7] bg-blue-50 text-[#0B75E7]"
                            : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        With driver
                      </button>
                    </div>
                    <p className="mt-2.5 text-sm font-medium text-slate-500">
                      Driver rate: {money(driverHourlyRate)} / hour
                    </p>
                  </div>
                )}

                <div className="rp-detail-summary">
                  <SummaryRow label="Hourly vehicle rate" value={money(hourlyRate)} />
                  <SummaryRow label="Duration" value={formatDurationMinutes(durationMinutes)} />
                  <SummaryRow label="Vehicle subtotal" value={money(vehicleCost)} />
                  <SummaryRow label="Late-return rate" value={`${moneyWithCents(lateReturnHourlyRate)} / overdue hour`} muted />
                  <SummaryRow label="Transaction fee" value={moneyWithCents(transactionFee)} />
                  <SummaryRow label="Booking downpayment (30%)" value={moneyWithCents(downpaymentFee)} muted />
                  <div className="h-px bg-slate-200/80" aria-hidden="true" />
                  <SummaryRow label="Estimated total" value={moneyWithCents(estimatedTotal)} strong />
                </div>
                <div className="rp-detail-eligibility" role="status" aria-live="polite" aria-atomic="true">
                  <p className="rp-detail-limits"><span className="font-semibold">Booking limits:</span>{" "}
                    {!isLoggedIn ? "Up to 3 open · Up to 2 pending" : eligibility
                      ? `${eligibility.counts.open}/${eligibility.limits.open} open · ${eligibility.counts.pending}/${eligibility.limits.pending} pending`
                      : eligibilityError ? null : "Checking limits..."}
                  </p>
                  {isLoggedIn && (
                    <div>
                      {eligibility ? (
                        <>
                          {balanceReasons.length > 0 ? (
                            <>
                              <p className="mt-2 font-medium text-amber-950">Pay your remaining balance first.</p>
                              {balanceReasons.map((reason) => (
                                <p key={`${reason.code}-${reason.bookingId}`} className="mt-1 text-amber-900">
                                  {getCompactEligibilityMessage(reason)}
                                </p>
                              ))}
                              <button type="button" onClick={onNavigateToBookingHistory} className="mt-2 font-semibold text-blue-700 underline underline-offset-2">View bookings</button>
                            </>
                          ) : firstNonBalanceReason ? (
                            <>
                              <p className="mt-2 text-amber-900">{getCompactEligibilityMessage(firstNonBalanceReason)}</p>
                              <button type="button" onClick={onNavigateToBookingHistory} className="mt-2 font-semibold text-blue-700 underline underline-offset-2">View bookings</button>
                            </>
                          ) : null}
                        </>
                      ) : eligibilityError ? (
                        <>
                          <p>{eligibilityError}</p>
                          <button type="button" onClick={() => setEligibilityRetry((value) => value + 1)} className="mt-2 font-semibold text-blue-700 underline underline-offset-2">Retry check</button>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>

                {bookingError && !eligibility?.reasons?.some((reason) => reason.message === bookingError) && (
                  <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                    {bookingError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={resolveInBookings ? onNavigateToBookingHistory : handleContinueBooking}
                  disabled={bookingLoading || !isAvailable || changeDatesToBook}
                  className="rp-btn-primary min-h-[3.3rem] w-full px-4 text-[0.97rem] tracking-[0.01em] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bookingLoading
                    ? "Submitting..."
                    : !isAvailable
                    ? "Currently Unavailable"
                    : resolveInBookings
                    ? "View bookings to resolve"
                    : changeDatesToBook
                    ? "Change dates to book"
                    : needsIdentityVerification
                    ? "Verify Identity to Book"
                    : isLoggedIn
                    ? "Book Now"
                    : "Sign In to Book"}
                </button>
                <HelpLink guide="request-booking" className="justify-center self-center">Need help booking?</HelpLink>
              </div>
            </section>

            <div className="rp-detail-information">
              <section className="rp-detail-specifications rp-surface p-4">
                <h2 className="rp-detail-section-title">Vehicle Specifications</h2>
                <dl className="rp-detail-specification-grid">
                  <SpecItem label="Type" value={vehicleTypeLabel} />
                  <SpecItem label="Seats" value={`${seats}`} />
                  <SpecItem label="Transmission" value={transmission} />
                  <SpecItem label="Fuel" value={fuel} />
                  <SpecItem label="Plate number" value={plateNumber} />
                  <SpecItem label="Driver option" value={driverOptionEnabled ? "With driver available" : "Self-drive only"} />
                </dl>
              </section>
              <div className="rp-detail-secondary rp-surface">
              <details key={`${vehicleId}-about`} className="rp-detail-disclosure">
                <summary><h2>About This Vehicle</h2><ChevronDown size={18} aria-hidden="true" /></summary>
                <p className="rp-detail-description">
                  {currentVehicle?.description || "No additional description provided by the owner."}
                </p>
              </details>
              <section className="rp-detail-owner">
                <h2 className="rp-detail-section-title">Owner Information</h2>
                  <div className="rp-detail-owner-row">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0B75E7] text-xs font-bold text-white">{ownerInitials}</div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="break-words text-sm font-semibold text-slate-900">{ownerName}</p>
                          {ownerVerified && <BadgeCheck size={18} className="shrink-0 text-[#0B75E7]" />}
                        </div>
                        <p className="mt-1 break-words text-xs text-slate-600">{ownerEmail || "Verified RentifyPro owner"}</p>
                      </div>
                    </div>
                    <button type="button" onClick={handleChatOwner} disabled={isOwnVehicle} className="rp-btn-secondary inline-flex min-h-11 shrink-0 items-center gap-2 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60">
                      <MessageCircle size={18} strokeWidth={2} aria-hidden="true" />Chat Owner
                    </button>
                  </div>
                {chatOwnerError && <p className="mt-3 text-sm text-red-600">{chatOwnerError}</p>}
              </section>
            <details key={`${vehicleId}-reviews`} className="rp-detail-reviews rp-detail-disclosure">
              <summary>
                <h2>Reviews</h2>
                <span className="rp-detail-review-status">
                  {reviews.length > 0 ? <><Star size={14} strokeWidth={2} className="fill-current text-amber-700" aria-hidden="true" />{averageRating} · {reviews.length} {reviews.length === 1 ? "review" : "reviews"}</> : "No reviews"}
                </span>
                <ChevronDown size={18} aria-hidden="true" />
              </summary>

              <div className="rp-detail-review-body">
                <p className="rp-detail-section-copy mb-3">Recent renter feedback for this vehicle.</p>
                <div className="space-y-3">
                  {sortedReviews.length > 0 ? (
                    sortedReviews.slice(0, 3).map((review) => (
                      <article key={review.id} className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <ReviewerAvatar name={review.name} avatar={review.avatar} sizeClass="w-9 h-9" />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900">{review.name}</p>
                              <p className="text-[0.72rem] text-slate-400">
                                {new Date(review.date).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <div className="rp-chip shrink-0 bg-amber-50 text-amber-700">
                            <Star size={16} strokeWidth={2} className="fill-current" aria-hidden="true" />
                            {review.rating}
                          </div>
                        </div>
                        <p className="mt-2.5 text-sm leading-6 text-slate-600">{review.comment}</p>
                      </article>
                    ))
                  ) : (
                    <p className="text-sm text-slate-600">
                      No reviews yet for this vehicle.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowReviewsModal(true)}
                  className="rp-btn-secondary mt-5 w-full py-3 text-sm"
                >
                  View all reviews
                </button>
              </div>
            </details>
              </div>
            </div>
        </div>
      </main>

      {showReviewsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center px-4 py-6">
          <div className="flex max-h-[calc(100dvh-3rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-xl font-bold">All Reviews</h3>
                <p className="text-sm text-slate-500 mt-1">
                  <span className="inline-flex items-center gap-1 text-amber-600 font-semibold">
                    <Star size={16} strokeWidth={2} className="fill-current" aria-hidden="true" />
                    {averageRating}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={sortOption}
                  onChange={(event) => setSortOption(event.target.value)}
                  className="rp-input text-sm py-2"
                >
                  <option value="recent">Most Recent</option>
                  <option value="highest">Highest Rating</option>
                  <option value="lowest">Lowest Rating</option>
                </select>
                <button
                  type="button"
                  onClick={() => setShowReviewsModal(false)}
                  className="rp-btn-secondary px-3 py-2 text-sm"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-5">
              {sortedReviews.length > 0 ? (
                sortedReviews.map((review) => (
                  <article key={review.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <ReviewerAvatar name={review.name} avatar={review.avatar} sizeClass="w-10 h-10" />
                        <div>
                          <p className="font-semibold text-slate-900">{review.name}</p>
                          <p className="text-xs text-slate-500">
                            {new Date(review.date).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <span className="rp-chip bg-amber-50 text-amber-700">
                        <Star size={16} strokeWidth={2} className="fill-current" aria-hidden="true" />
                        {review.rating}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 mt-3">{review.comment}</p>
                  </article>
                ))
              ) : (
                <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
                  No reviews available yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SpecItem({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ReviewerAvatar({ name, avatar, sizeClass = "w-9 h-9" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const shouldShowImage = Boolean(avatar) && !imageFailed;

  if (shouldShowImage) {
    return (
      <img
        src={avatar}
        alt={name}
        className={`${sizeClass} rounded-full object-cover`}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full bg-[#0B75E7] text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}
      aria-label={name}
    >
      {getInitialsFromName(name)}
    </div>
  );
}

function SummaryRow({ label, value, strong = false, muted = false }) {
  return (
    <div className="rp-detail-summary-row">
      <span className={`rp-detail-summary-label ${muted ? "rp-detail-summary-label--muted" : ""}`}>
        {label}
      </span>
      <span className={`rp-detail-summary-value ${strong ? "rp-detail-summary-value--strong" : ""}`}>
        {value}
      </span>
    </div>
  );
}
