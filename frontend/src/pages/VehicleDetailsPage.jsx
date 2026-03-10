<<<<<<< HEAD
import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  CarFront,
  ChevronLeft,
  ChevronRight,
  Fuel,
  MapPin,
  Settings,
  ShieldCheck,
  Star,
  Users,
} from "lucide-react";
import API from "../utils/api";
import Navbar from "../components/Navbar";
import {
  formatDisplayName,
  getCurrentTime,
  getDateTime,
  getTodayDate,
  getTomorrowDate,
  getInitialsFromName,
  sanitizeBookingRange,
} from "../utils/dateUtils";
import { resolveAssetUrl } from "../utils/media";

=======
<<<<<<< HEAD
import React, { useState, useEffect } from "react";
import { Bot, Users, Settings, Fuel, Car, Wallet, Receipt, Camera, Bell, MessageCircle, BadgeCheck } from "lucide-react";

const VehicleDetailsPage = ({
vehicle,
=======
import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  CarFront,
  ChevronLeft,
  ChevronRight,
  Fuel,
  MapPin,
  Settings,
  ShieldCheck,
  Star,
  Users,
} from "lucide-react";
import API from "../utils/api";
import Navbar from "../components/Navbar";
import {
  formatDisplayName,
  getCurrentTime,
  getDateTime,
  getTodayDate,
  getTomorrowDate,
  getInitialsFromName,
  sanitizeBookingRange,
} from "../utils/dateUtils";
import { resolveAssetUrl } from "../utils/media";

>>>>>>> 8422a2f (fixed bugs and updates)
const DEFAULT_IMAGE = "/bmw-x5.png";
const DOWNPAYMENT_RATE = 0.3;
const money = (value) => `P${Number(value || 0).toLocaleString()}`;

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
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  bookingData,
  setBookingData,
  onBack,
  onNavigateToHome,
  onNavigateToSignIn,
  onNavigateToRegister,
<<<<<<< HEAD
  onNavigateToVehicles,
=======
<<<<<<< HEAD
>>>>>>> 8422a2f (fixed bugs and updates)
  onNavigateToBookingHistory,
  onNavigateToChat,
  onNavigateToNotifications,
  onNavigateToAbout,
<<<<<<< HEAD
  onNavigateToContacts,
=======
=======
  onNavigateToVehicles,
  onNavigateToBookingHistory,
  onNavigateToChat,
  onNavigateToNotifications,
  onNavigateToAbout,
  onNavigateToContacts,
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  onNavigateToAccountSettings,
  isLoggedIn,
  user,
  onLogout,
<<<<<<< HEAD
}) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [showReviewsModal, setShowReviewsModal] = useState(false);
  const [sortOption, setSortOption] = useState("recent");
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [bookingSuccess, setBookingSuccess] = useState("");
  const [driverSelected, setDriverSelected] = useState(false);
  const [vehicleData, setVehicleData] = useState(vehicle || null);
  const vehicleId = vehicleData?._id || vehicleData?.id || vehicle?._id || vehicle?.id;
  const currentVehicle = vehicleData || vehicle || {};
=======
<<<<<<< HEAD
}) => {
>>>>>>> 8422a2f (fixed bugs and updates)

  const { pickupDate, pickupTime, returnDate, returnTime } = bookingData;

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

  const galleryImages = useMemo(() => {
    const candidates = [
      ...(Array.isArray(currentVehicle?.images) ? currentVehicle.images : []),
      currentVehicle?.imageUrl,
      currentVehicle?.image,
    ]
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);

    const unique = [...new Set(candidates)];
    return unique.length ? unique : [DEFAULT_IMAGE];
  }, [currentVehicle]);

  useEffect(() => {
    if (activeImageIndex >= galleryImages.length) setActiveImageIndex(0);
  }, [activeImageIndex, galleryImages.length]);

  const availabilityStatus = normalizeAvailability(currentVehicle);
  const isAvailable = availabilityStatus === "available";
  const reviews = normalizeReviews(currentVehicle);
  const dailyRate = Number(currentVehicle?.dailyRentalRate ?? currentVehicle?.price ?? 0);
  const driverOptionEnabled = Boolean(currentVehicle?.driverOptionEnabled);
  const driverDailyRate = Number(currentVehicle?.driverDailyRate || 0);

  useEffect(() => {
    if (!driverOptionEnabled && driverSelected) setDriverSelected(false);
  }, [driverOptionEnabled, driverSelected]);

  const durationDays = useMemo(() => {
    const start = getDateTime(pickupDate, pickupTime);
    const end = getDateTime(returnDate, returnTime);
    if (!start || !end || end <= start) return 1;
    return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  }, [pickupDate, pickupTime, returnDate, returnTime]);

  const vehicleCost = durationDays * dailyRate;
  const driverCost = driverSelected ? durationDays * driverDailyRate : 0;
  const estimatedTotal = vehicleCost + driverCost;
  const downpaymentFee = Math.round(estimatedTotal * DOWNPAYMENT_RATE);

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

  const validateBookingRange = () => {
    const now = new Date();
    now.setSeconds(0, 0);
    const pickup = getDateTime(pickupDate, pickupTime);
    const dropoff = getDateTime(returnDate, returnTime);

    if (!pickup || !dropoff) {
      return "Please provide valid pickup and return date/time.";
    }
    if (pickup < now) {
      return "Pickup must be in the future.";
    }
    if (dropoff <= pickup) {
      return "Return must be after pickup.";
    }
    return "";
  };

  const handleContinueBooking = async () => {
    setBookingError("");
    setBookingSuccess("");

    if (!isLoggedIn) {
      onNavigateToSignIn?.();
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
      await API.createBooking({
        vehicleId,
        pickupAt: `${pickupDate}T${pickupTime}`,
        returnAt: `${returnDate}T${returnTime}`,
        driverSelected,
      });
      setBookingSuccess("Booking submitted successfully. Redirecting to booking history...");
      setTimeout(() => onNavigateToBookingHistory?.(), 900);
    } catch (error) {
      setBookingError(error.message || "Failed to submit booking.");
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

  const vehicleType = currentVehicle?.specs?.type || currentVehicle?.type || "Vehicle";
  const vehicleSubType = currentVehicle?.specs?.subType || currentVehicle?.subType || "Standard";
  const seats = currentVehicle?.specs?.seats || currentVehicle?.seats || 4;
  const transmission = currentVehicle?.specs?.transmission || currentVehicle?.transmission || "Automatic";
  const fuel = currentVehicle?.specs?.fuel || currentVehicle?.fuel || "Gasoline";
  const plateNumber = currentVehicle?.specs?.plateNumber || currentVehicle?.plateNumber || "-";
  const ownerName = currentVehicle?.owner?.name || "Vehicle Owner";
  const ownerInitials = getInitialsFromName(ownerName);
  const ownerEmail = currentVehicle?.owner?.email || "";
  const ownerVerified = currentVehicle?.owner?.verified !== false;
  const updateBookingRange = (patch) => {
    setBookingData((prev) => {
      const merged = { ...prev, ...patch };
      return { ...merged, ...sanitizeBookingRange(merged) };
    });
  };

  return (
    <div className="min-h-screen">
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
        onLogout={onLogout}
      />

      <main className="pt-24 sm:pt-28 max-w-[1380px] mx-auto px-4 sm:px-6 pb-16 space-y-6">
        <section className="rp-surface p-5 sm:p-6">
          <button
            onClick={onBack}
            className="rp-btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
          >
            <ArrowLeft size={16} />
            Back to Vehicles
          </button>

          <div className="mt-4 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-3xl sm:text-4xl font-bold text-slate-900">
                  {currentVehicle?.name || "Vehicle"}
                </h1>
                <span
                  className={`rp-chip ${
                    isAvailable ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {isAvailable ? "Available" : "Unavailable"}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600 flex items-center gap-1">
                <MapPin size={14} className="text-[#0B75E7]" />
                {currentVehicle?.location || "Location not provided"}
              </p>
            </div>

            <div className="text-left lg:text-right">
              <p className="text-sm text-slate-500">Starting price</p>
              <p className="text-3xl font-extrabold text-[#0B75E7]">
                {money(dailyRate)}
                <span className="text-sm font-semibold text-slate-500"> / day</span>
              </p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-[1.65fr_1fr] gap-6">
          <div className="space-y-6">
            <section className="rp-surface p-4 sm:p-5">
              <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                <img
                  src={galleryImages[activeImageIndex]}
                  alt={currentVehicle?.name || "Vehicle"}
                  className="w-full h-[250px] sm:h-[360px] lg:h-[440px] object-cover"
                  onError={(event) => {
                    event.currentTarget.src = DEFAULT_IMAGE;
                  }}
                />

                {galleryImages.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={goPrevImage}
                      aria-label="Previous image"
                      className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-xl bg-white/90 text-slate-700 shadow-md hover:bg-white"
                    >
                      <ChevronLeft size={18} className="mx-auto" />
                    </button>
                    <button
                      type="button"
                      onClick={goNextImage}
                      aria-label="Next image"
                      className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-xl bg-white/90 text-slate-700 shadow-md hover:bg-white"
                    >
                      <ChevronRight size={18} className="mx-auto" />
                    </button>
                  </>
                )}
              </div>

              {galleryImages.length > 1 && (
                <div className="mt-3 grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {galleryImages.map((image, index) => (
                    <button
                      key={`${image}-${index}`}
                      type="button"
                      onClick={() => setActiveImageIndex(index)}
                      className={`overflow-hidden rounded-xl border transition ${
                        index === activeImageIndex
                          ? "border-[#0B75E7] ring-2 ring-blue-100"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <img
                        src={image}
                        alt={`Vehicle preview ${index + 1}`}
                        className="h-16 w-full object-cover"
                        onError={(event) => {
                          event.currentTarget.src = DEFAULT_IMAGE;
                        }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="rp-surface p-5">
              <h2 className="text-xl font-bold text-slate-900">Vehicle Specifications</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
                <SpecItem icon={CarFront} label="Type" value={`${vehicleType} / ${vehicleSubType}`} />
                <SpecItem icon={Users} label="Seats" value={`${seats}`} />
                <SpecItem icon={Settings} label="Transmission" value={transmission} />
                <SpecItem icon={Fuel} label="Fuel" value={fuel} />
                <SpecItem icon={ShieldCheck} label="Plate Number" value={plateNumber} />
                <SpecItem
                  icon={BadgeCheck}
                  label="Driver Option"
                  value={driverOptionEnabled ? "With driver available" : "Self-drive only"}
                />
              </div>
            </section>

            <section className="rp-surface p-5">
              <h2 className="text-xl font-bold text-slate-900">About This Vehicle</h2>
              <p className="mt-3 text-slate-600 leading-relaxed">
                {currentVehicle?.description || "No additional description provided by the owner."}
              </p>
            </section>

            <section className="rp-surface p-5">
              <h2 className="text-xl font-bold text-slate-900">Owner Information</h2>
              <div className="mt-4 flex items-center gap-4">
                <div className="w-14 h-14 rounded-full border border-slate-200 bg-[#0B75E7] text-white flex items-center justify-center font-bold">
                  {ownerInitials}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900">{ownerName}</p>
                    {ownerVerified && <BadgeCheck size={18} className="text-[#0B75E7]" />}
                  </div>
                  <p className="text-sm text-slate-500">{ownerEmail || "Verified RentifyPro owner"}</p>
                </div>
              </div>
            </section>

            <section className="rp-surface p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-slate-900">Reviews</h2>
                <span className="rp-chip bg-amber-100 text-amber-700">
                  <Star size={13} className="fill-current" />
                  {reviews.length > 0 ? averageRating : "No reviews"}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {sortedReviews.length > 0 ? (
                  sortedReviews.slice(0, 3).map((review) => (
                    <article key={review.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <ReviewerAvatar name={review.name} avatar={review.avatar} sizeClass="w-9 h-9" />
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{review.name}</p>
                            <p className="text-xs text-slate-500">{new Date(review.date).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="rp-chip bg-amber-50 text-amber-700">
                          <Star size={12} className="fill-current" />
                          {review.rating}
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{review.comment}</p>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">
                    No reviews yet for this vehicle.
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowReviewsModal(true)}
                className="rp-btn-secondary mt-4 w-full py-2.5 text-sm"
              >
                View all reviews
              </button>
            </section>
          </div>

          <aside className="xl:sticky xl:top-24 h-fit space-y-5">
            <section className="rp-surface p-5">
              <h2 className="text-xl font-bold text-slate-900">Book This Vehicle</h2>
              <p className="text-sm text-slate-500 mt-1">
                Choose your dates and review the total before confirming your booking.
              </p>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-2">Pickup Date & Time</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={pickupDate || ""}
                      min={getTodayDate()}
                      onChange={(event) => updateBookingRange({ pickupDate: event.target.value })}
                      className="rp-input text-sm"
                    />
                    <input
                      type="time"
                      min={pickupDate === getTodayDate() ? getCurrentTime() : undefined}
                      value={pickupTime || ""}
                      onChange={(event) => updateBookingRange({ pickupTime: event.target.value })}
                      className="rp-input text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-2">Return Date & Time</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={returnDate || ""}
                      min={pickupDate || getTodayDate()}
                      onChange={(event) => updateBookingRange({ returnDate: event.target.value })}
                      className="rp-input text-sm"
                    />
                    <input
                      type="time"
                      min={returnDate === pickupDate ? pickupTime : undefined}
                      value={returnTime || ""}
                      onChange={(event) => updateBookingRange({ returnTime: event.target.value })}
                      className="rp-input text-sm"
                    />
                  </div>
                </div>

                {driverOptionEnabled && (
                  <div>
                    <label className="text-sm font-semibold text-slate-700 block mb-2">Driver Option</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setDriverSelected(false)}
                        className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
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
                        className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                          driverSelected
                            ? "border-[#0B75E7] bg-blue-50 text-[#0B75E7]"
                            : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        With driver
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      Driver rate: {money(driverDailyRate)} / day
                    </p>
                  </div>
                )}

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-sm">
                  <SummaryRow label="Daily vehicle rate" value={money(dailyRate)} />
                  <SummaryRow
                    label="Duration"
                    value={`${durationDays} ${durationDays > 1 ? "days" : "day"}`}
                  />
                  <SummaryRow label="Vehicle subtotal" value={money(vehicleCost)} />
                  <SummaryRow label="Driver subtotal" value={money(driverCost)} />
                  <SummaryRow label="Downpayment (30%)" value={money(downpaymentFee)} muted />
                  <div className="h-px bg-slate-200 my-2" />
                  <SummaryRow label="Estimated total" value={money(estimatedTotal)} strong />
                </div>

                <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700 flex items-start gap-2">
                  <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" />
                  <span>
                    Booking requests are validated with date/time checks and linked to your authenticated account.
                  </span>
                </div>

                {bookingError && (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {bookingError}
                  </p>
                )}
                {bookingSuccess && (
                  <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    {bookingSuccess}
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleContinueBooking}
                  disabled={bookingLoading || !isAvailable}
                  className="rp-btn-primary w-full py-3.5 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {bookingLoading
                    ? "Submitting..."
                    : !isAvailable
                    ? "Currently Unavailable"
                    : isLoggedIn
                    ? "Book Now"
                    : "Sign In to Book"}
                </button>
              </div>
            </section>
          </aside>
        </div>
<<<<<<< HEAD
=======
=======
}) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [showReviewsModal, setShowReviewsModal] = useState(false);
  const [sortOption, setSortOption] = useState("recent");
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [bookingSuccess, setBookingSuccess] = useState("");
  const [driverSelected, setDriverSelected] = useState(false);
  const [vehicleData, setVehicleData] = useState(vehicle || null);
  const vehicleId = vehicleData?._id || vehicleData?.id || vehicle?._id || vehicle?.id;
  const currentVehicle = vehicleData || vehicle || {};

  const { pickupDate, pickupTime, returnDate, returnTime } = bookingData;

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

  const galleryImages = useMemo(() => {
    const candidates = [
      ...(Array.isArray(currentVehicle?.images) ? currentVehicle.images : []),
      currentVehicle?.imageUrl,
      currentVehicle?.image,
    ]
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);

    const unique = [...new Set(candidates)];
    return unique.length ? unique : [DEFAULT_IMAGE];
  }, [currentVehicle]);

  useEffect(() => {
    if (activeImageIndex >= galleryImages.length) setActiveImageIndex(0);
  }, [activeImageIndex, galleryImages.length]);

  const availabilityStatus = normalizeAvailability(currentVehicle);
  const isAvailable = availabilityStatus === "available";
  const reviews = normalizeReviews(currentVehicle);
  const dailyRate = Number(currentVehicle?.dailyRentalRate ?? currentVehicle?.price ?? 0);
  const driverOptionEnabled = Boolean(currentVehicle?.driverOptionEnabled);
  const driverDailyRate = Number(currentVehicle?.driverDailyRate || 0);

  useEffect(() => {
    if (!driverOptionEnabled && driverSelected) setDriverSelected(false);
  }, [driverOptionEnabled, driverSelected]);

  const durationDays = useMemo(() => {
    const start = getDateTime(pickupDate, pickupTime);
    const end = getDateTime(returnDate, returnTime);
    if (!start || !end || end <= start) return 1;
    return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  }, [pickupDate, pickupTime, returnDate, returnTime]);

  const vehicleCost = durationDays * dailyRate;
  const driverCost = driverSelected ? durationDays * driverDailyRate : 0;
  const estimatedTotal = vehicleCost + driverCost;
  const downpaymentFee = Math.round(estimatedTotal * DOWNPAYMENT_RATE);

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

  const validateBookingRange = () => {
    const now = new Date();
    now.setSeconds(0, 0);
    const pickup = getDateTime(pickupDate, pickupTime);
    const dropoff = getDateTime(returnDate, returnTime);

    if (!pickup || !dropoff) {
      return "Please provide valid pickup and return date/time.";
    }
    if (pickup < now) {
      return "Pickup must be in the future.";
    }
    if (dropoff <= pickup) {
      return "Return must be after pickup.";
    }
    return "";
  };

  const handleContinueBooking = async () => {
    setBookingError("");
    setBookingSuccess("");

    if (!isLoggedIn) {
      onNavigateToSignIn?.();
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
      await API.createBooking({
        vehicleId,
        pickupAt: `${pickupDate}T${pickupTime}`,
        returnAt: `${returnDate}T${returnTime}`,
        driverSelected,
      });
      setBookingSuccess("Booking submitted successfully. Redirecting to booking history...");
      setTimeout(() => onNavigateToBookingHistory?.(), 900);
    } catch (error) {
      setBookingError(error.message || "Failed to submit booking.");
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

  const vehicleType = currentVehicle?.specs?.type || currentVehicle?.type || "Vehicle";
  const vehicleSubType = currentVehicle?.specs?.subType || currentVehicle?.subType || "Standard";
  const seats = currentVehicle?.specs?.seats || currentVehicle?.seats || 4;
  const transmission = currentVehicle?.specs?.transmission || currentVehicle?.transmission || "Automatic";
  const fuel = currentVehicle?.specs?.fuel || currentVehicle?.fuel || "Gasoline";
  const plateNumber = currentVehicle?.specs?.plateNumber || currentVehicle?.plateNumber || "-";
  const ownerName = currentVehicle?.owner?.name || "Vehicle Owner";
  const ownerInitials = getInitialsFromName(ownerName);
  const ownerEmail = currentVehicle?.owner?.email || "";
  const ownerVerified = currentVehicle?.owner?.verified !== false;
  const updateBookingRange = (patch) => {
    setBookingData((prev) => {
      const merged = { ...prev, ...patch };
      return { ...merged, ...sanitizeBookingRange(merged) };
    });
  };

  return (
    <div className="min-h-screen">
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
        onLogout={onLogout}
      />

      <main className="pt-24 sm:pt-28 max-w-[1380px] mx-auto px-4 sm:px-6 pb-16 space-y-6">
        <section className="rp-surface p-5 sm:p-6">
          <button
            onClick={onBack}
            className="rp-btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
          >
            <ArrowLeft size={16} />
            Back to Vehicles
          </button>

          <div className="mt-4 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-3xl sm:text-4xl font-bold text-slate-900">
                  {currentVehicle?.name || "Vehicle"}
                </h1>
                <span
                  className={`rp-chip ${
                    isAvailable ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {isAvailable ? "Available" : "Unavailable"}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600 flex items-center gap-1">
                <MapPin size={14} className="text-[#0B75E7]" />
                {currentVehicle?.location || "Location not provided"}
              </p>
            </div>

            <div className="text-left lg:text-right">
              <p className="text-sm text-slate-500">Starting price</p>
              <p className="text-3xl font-extrabold text-[#0B75E7]">
                {money(dailyRate)}
                <span className="text-sm font-semibold text-slate-500"> / day</span>
              </p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-[1.65fr_1fr] gap-6">
          <div className="space-y-6">
            <section className="rp-surface p-4 sm:p-5">
              <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                <img
                  src={galleryImages[activeImageIndex]}
                  alt={currentVehicle?.name || "Vehicle"}
                  className="w-full h-[250px] sm:h-[360px] lg:h-[440px] object-cover"
                  onError={(event) => {
                    event.currentTarget.src = DEFAULT_IMAGE;
                  }}
                />

                {galleryImages.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={goPrevImage}
                      aria-label="Previous image"
                      className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-xl bg-white/90 text-slate-700 shadow-md hover:bg-white"
                    >
                      <ChevronLeft size={18} className="mx-auto" />
                    </button>
                    <button
                      type="button"
                      onClick={goNextImage}
                      aria-label="Next image"
                      className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-xl bg-white/90 text-slate-700 shadow-md hover:bg-white"
                    >
                      <ChevronRight size={18} className="mx-auto" />
                    </button>
                  </>
                )}
              </div>

              {galleryImages.length > 1 && (
                <div className="mt-3 grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {galleryImages.map((image, index) => (
                    <button
                      key={`${image}-${index}`}
                      type="button"
                      onClick={() => setActiveImageIndex(index)}
                      className={`overflow-hidden rounded-xl border transition ${
                        index === activeImageIndex
                          ? "border-[#0B75E7] ring-2 ring-blue-100"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <img
                        src={image}
                        alt={`Vehicle preview ${index + 1}`}
                        className="h-16 w-full object-cover"
                        onError={(event) => {
                          event.currentTarget.src = DEFAULT_IMAGE;
                        }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="rp-surface p-5">
              <h2 className="text-xl font-bold text-slate-900">Vehicle Specifications</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
                <SpecItem icon={CarFront} label="Type" value={`${vehicleType} / ${vehicleSubType}`} />
                <SpecItem icon={Users} label="Seats" value={`${seats}`} />
                <SpecItem icon={Settings} label="Transmission" value={transmission} />
                <SpecItem icon={Fuel} label="Fuel" value={fuel} />
                <SpecItem icon={ShieldCheck} label="Plate Number" value={plateNumber} />
                <SpecItem
                  icon={BadgeCheck}
                  label="Driver Option"
                  value={driverOptionEnabled ? "With driver available" : "Self-drive only"}
                />
              </div>
            </section>

            <section className="rp-surface p-5">
              <h2 className="text-xl font-bold text-slate-900">About This Vehicle</h2>
              <p className="mt-3 text-slate-600 leading-relaxed">
                {currentVehicle?.description || "No additional description provided by the owner."}
              </p>
            </section>

            <section className="rp-surface p-5">
              <h2 className="text-xl font-bold text-slate-900">Owner Information</h2>
              <div className="mt-4 flex items-center gap-4">
                <div className="w-14 h-14 rounded-full border border-slate-200 bg-[#0B75E7] text-white flex items-center justify-center font-bold">
                  {ownerInitials}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900">{ownerName}</p>
                    {ownerVerified && <BadgeCheck size={18} className="text-[#0B75E7]" />}
                  </div>
                  <p className="text-sm text-slate-500">{ownerEmail || "Verified RentifyPro owner"}</p>
                </div>
              </div>
            </section>

            <section className="rp-surface p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-slate-900">Reviews</h2>
                <span className="rp-chip bg-amber-100 text-amber-700">
                  <Star size={13} className="fill-current" />
                  {reviews.length > 0 ? averageRating : "No reviews"}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {sortedReviews.length > 0 ? (
                  sortedReviews.slice(0, 3).map((review) => (
                    <article key={review.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <ReviewerAvatar name={review.name} avatar={review.avatar} sizeClass="w-9 h-9" />
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{review.name}</p>
                            <p className="text-xs text-slate-500">{new Date(review.date).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="rp-chip bg-amber-50 text-amber-700">
                          <Star size={12} className="fill-current" />
                          {review.rating}
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{review.comment}</p>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">
                    No reviews yet for this vehicle.
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowReviewsModal(true)}
                className="rp-btn-secondary mt-4 w-full py-2.5 text-sm"
              >
                View all reviews
              </button>
            </section>
          </div>

          <aside className="xl:sticky xl:top-24 h-fit space-y-5">
            <section className="rp-surface p-5">
              <h2 className="text-xl font-bold text-slate-900">Book This Vehicle</h2>
              <p className="text-sm text-slate-500 mt-1">
                Choose your dates and review the total before confirming your booking.
              </p>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-2">Pickup Date & Time</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={pickupDate || ""}
                      min={getTodayDate()}
                      onChange={(event) => updateBookingRange({ pickupDate: event.target.value })}
                      className="rp-input text-sm"
                    />
                    <input
                      type="time"
                      min={pickupDate === getTodayDate() ? getCurrentTime() : undefined}
                      value={pickupTime || ""}
                      onChange={(event) => updateBookingRange({ pickupTime: event.target.value })}
                      className="rp-input text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-2">Return Date & Time</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={returnDate || ""}
                      min={pickupDate || getTodayDate()}
                      onChange={(event) => updateBookingRange({ returnDate: event.target.value })}
                      className="rp-input text-sm"
                    />
                    <input
                      type="time"
                      min={returnDate === pickupDate ? pickupTime : undefined}
                      value={returnTime || ""}
                      onChange={(event) => updateBookingRange({ returnTime: event.target.value })}
                      className="rp-input text-sm"
                    />
                  </div>
                </div>

                {driverOptionEnabled && (
                  <div>
                    <label className="text-sm font-semibold text-slate-700 block mb-2">Driver Option</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setDriverSelected(false)}
                        className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
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
                        className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                          driverSelected
                            ? "border-[#0B75E7] bg-blue-50 text-[#0B75E7]"
                            : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        With driver
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      Driver rate: {money(driverDailyRate)} / day
                    </p>
                  </div>
                )}

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-sm">
                  <SummaryRow label="Daily vehicle rate" value={money(dailyRate)} />
                  <SummaryRow
                    label="Duration"
                    value={`${durationDays} ${durationDays > 1 ? "days" : "day"}`}
                  />
                  <SummaryRow label="Vehicle subtotal" value={money(vehicleCost)} />
                  <SummaryRow label="Driver subtotal" value={money(driverCost)} />
                  <SummaryRow label="Downpayment (30%)" value={money(downpaymentFee)} muted />
                  <div className="h-px bg-slate-200 my-2" />
                  <SummaryRow label="Estimated total" value={money(estimatedTotal)} strong />
                </div>

                <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700 flex items-start gap-2">
                  <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" />
                  <span>
                    Booking requests are validated with date/time checks and linked to your authenticated account.
                  </span>
                </div>

                {bookingError && (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {bookingError}
                  </p>
                )}
                {bookingSuccess && (
                  <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    {bookingSuccess}
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleContinueBooking}
                  disabled={bookingLoading || !isAvailable}
                  className="rp-btn-primary w-full py-3.5 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {bookingLoading
                    ? "Submitting..."
                    : !isAvailable
                    ? "Currently Unavailable"
                    : isLoggedIn
                    ? "Book Now"
                    : "Sign In to Book"}
                </button>
              </div>
            </section>
          </aside>
        </div>
>>>>>>> 8422a2f (fixed bugs and updates)
      </main>

      {showReviewsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center px-4 py-6">
          <div className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold">All Reviews</h3>
                <p className="text-sm text-slate-500 mt-1">
                  <span className="inline-flex items-center gap-1 text-amber-600 font-semibold">
                    <Star size={13} className="fill-current" />
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

            <div className="p-5 max-h-[65vh] overflow-y-auto space-y-3">
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
                        <Star size={12} className="fill-current" />
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
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
        </div>
      )}
    </div>
  );
<<<<<<< HEAD
=======
<<<<<<< HEAD
};
export default VehicleDetailsPage;
=======
>>>>>>> 8422a2f (fixed bugs and updates)
}

function SpecItem({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold flex items-center gap-1">
        <Icon size={13} className="text-[#0B75E7]" />
        {label}
      </p>
      <p className="text-sm font-semibold text-slate-900 mt-1">{value}</p>
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
    <div className="flex items-center justify-between">
      <span className={`text-sm ${muted ? "text-slate-500" : "text-slate-600"}`}>{label}</span>
      <span className={`text-sm ${strong ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>
        {value}
      </span>
    </div>
  );
}
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
