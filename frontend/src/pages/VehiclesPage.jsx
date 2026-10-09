import useResponsiveList from "../hooks/useResponsiveList";
import ListRevealControls from "../components/ListRevealControls";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CarFront,
  RefreshCw,
  X,
} from "lucide-react";
import API from "../utils/api";
import Navbar from "../components/Navbar";
import ChatWidget from "../components/ChatWidget";
import HelpLink from "../components/HelpLink";
import BookingAccessModal from "../components/BookingAccessModal";
import VehiclePreviewModal from "../components/VehiclePreviewModal";
import { sanitizeBookingRange } from "../utils/dateUtils";
import VehicleCard from "../components/VehicleCard";
import VehicleSearchInput from "../components/VehicleSearchInput";
import { DelayedSkeleton, VehicleGridSkeleton } from "../components/LoadingSkeletons";
import { DEFAULT_VEHICLE_IMAGE } from "../utils/media";
import { matchesLocationSearch, validateLocationSearch } from "../utils/locationSearch";

const normalizeVehicleType = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "motor") return "motorcycle";
  return normalized;
};

const VEHICLE_TYPE_FILTERS = [
  { label: "All vehicles", value: "" },
  { label: "Cars", value: "car" },
  { label: "Motorcycles", value: "motorcycle" },
  { label: "Vans", value: "van" },
  { label: "Trucks", value: "truck" },
];

const MAX_VEHICLE_SEARCH_LENGTH = 100;
const ALLOWED_VEHICLE_SEARCH_PATTERN = /^[\p{L}\p{N} -]*$/u;

const filterVehicleSearch = (value = "") => String(value || "")
  .normalize("NFKC")
  .replace(/[^\p{L}\p{N} -]/gu, "")
  .replace(/ {2,}/g, " ")
  .replace(/-{2,}/g, "-")
  .replace(/^ +/, "")
  .slice(0, MAX_VEHICLE_SEARCH_LENGTH);

const validateVehicleSearch = (value = "") => {
  const search = String(value || "");
  if (search.length > MAX_VEHICLE_SEARCH_LENGTH) {
    return `Search must be ${MAX_VEHICLE_SEARCH_LENGTH} characters or fewer.`;
  }
  if (!ALLOWED_VEHICLE_SEARCH_PATTERN.test(search)) {
    return "Use letters, numbers, spaces, and hyphens only.";
  }
  if (search.startsWith(" ") || search.includes("  ")) {
    return "Use only one space between search terms.";
  }
  if (search.includes("--")) {
    return "Use only one hyphen at a time.";
  }
  return "";
};

const normalizeVehicle = (vehicle) => ({
  id: vehicle._id,
  _id: vehicle._id,
  name: vehicle.name,
  location: vehicle.location,
  coverImageUrl: vehicle.coverImageUrl || vehicle.imageUrl || vehicle.images?.[0] || DEFAULT_VEHICLE_IMAGE,
  image: vehicle.coverImageUrl || vehicle.imageUrl || vehicle.images?.[0] || DEFAULT_VEHICLE_IMAGE,
  images: vehicle.images || [],
  coverDisplayMode: vehicle.coverDisplayMode || "auto",
  type: normalizeVehicleType(vehicle.specs?.type || "car"),
  subType: vehicle.specs?.subType || "Standard",
  category: "Owner-listed Vehicle",
  seats: vehicle.specs?.seats || 4,
  transmission: vehicle.specs?.transmission || "Automatic",
  fuel: vehicle.specs?.fuel || "Gasoline",
  plateNumber: vehicle.specs?.plateNumber || "",
  price: Number((vehicle.hourlyRentalRate ?? vehicle.dailyRentalRate) || 0),
  driverOptionEnabled: Boolean(vehicle.driverOptionEnabled),
  driverDailyRate: Number((vehicle.driverHourlyRate ?? vehicle.driverDailyRate) || 0),
  rating: Number.isFinite(Number(vehicle.averageRating ?? vehicle.rating))
    ? Number(Number(vehicle.averageRating ?? vehicle.rating).toFixed(1))
    : 0,
  reviewCount: Number.isFinite(Number(vehicle.reviewCount)) ? Number(vehicle.reviewCount) : 0,
  available: vehicle.availabilityStatus === "available",
  description: vehicle.description || "",
  specs: vehicle.specs || {},
  owner: {
    _id: vehicle.owner?._id || "",
    name: vehicle.owner?.name || "Vehicle Owner",
    email: vehicle.owner?.email || "",
    avatar: vehicle.owner?.avatar || "",
    verified: vehicle.owner?.verified !== false,
  },
});

export default function VehiclesPage({
  bookingData,
  setBookingData,
  isLoggedIn,
  user,
  onLogout,
  onNavigateToHome,
  onNavigateToSignIn,
  onSignInToBook,
  onNavigateToRegister,
  onNavigateToVehicles,
  onViewDetails,
  onNavigateToBookingHistory,
  onNavigateToAbout,
  onNavigateToContacts,
  onNavigateToChat,
  onNavigateToNotifications,
  onOpenNotificationsModal,
  onNavigateToAccountSettings,
  onNavigateToReports,
}) {
  const [vehicles, setVehicles] = useState([]);
  const [reloadSignal, setReloadSignal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [loadedQueryKey, setLoadedQueryKey] = useState(null);
  const loadedQueryRef = useRef({ key: null, count: 0 });
  const [showAI, setShowAI] = useState(false);
  const [showBookingAccessModal, setShowBookingAccessModal] = useState(false);
  const [bookingVehicle, setBookingVehicle] = useState(null);
  const [previewVehicle, setPreviewVehicle] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [locationFilter, setLocationFilter] = useState(() => String(bookingData.location || "").trim());
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState(
    normalizeVehicleType(bookingData.vehicleType || "")
  );

  useEffect(() => {
    setBookingData((prev) => {
      const normalized = sanitizeBookingRange(prev);
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

  const searchValidationError = useMemo(
    () => validateVehicleSearch(searchQuery),
    [searchQuery]
  );
  const combinedSearch = useMemo(() => searchQuery.trim(), [searchQuery]);
  const queryKey = useMemo(
    () => JSON.stringify([combinedSearch, locationFilter, vehicleTypeFilter]),
    [combinedSearch, locationFilter, vehicleTypeFilter]
  );
  const showingCurrentResults = loadedQueryKey === queryKey;
  const visibleVehicles = useResponsiveList(vehicles, queryKey);

  useEffect(() => {
    const refreshExisting = reloadSignal > 0 &&
      loadedQueryRef.current.key === queryKey && loadedQueryRef.current.count > 0;
    if (!refreshExisting) {
      loadedQueryRef.current = { key: null, count: 0 };
      setLoadedQueryKey(null);
      setVehicles([]);
    }
    const locationError = validateLocationSearch(locationFilter);
    if (searchValidationError || locationError) {
      setError(locationError || searchValidationError);
      setLoading(false);
      setRefreshing(false);
      return undefined;
    }
    setLoading(!refreshExisting);
    setRefreshing(refreshExisting);
    setError("");
    let isActive = true;
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await API.getPublicVehicles({
          search: combinedSearch,
          location: locationFilter,
          vehicleType: vehicleTypeFilter,
          page: 1,
          limit: 24,
        });

        if (!isActive) return;
        const availableVehicles = (response.vehicles || [])
          .map(normalizeVehicle)
          .filter((vehicle) => vehicle.available && matchesLocationSearch(vehicle.location, locationFilter));
        loadedQueryRef.current = { key: queryKey, count: availableVehicles.length };
        setLoadedQueryKey(queryKey);
        setVehicles(availableVehicles);
      } catch (err) {
        if (!isActive) return;
        setError(err.message || "Failed to load available vehicles.");
      } finally {
        if (isActive) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }, 300);

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
    };
  }, [combinedSearch, locationFilter, queryKey, searchValidationError, vehicleTypeFilter, reloadSignal]);

  const clearLocationFilter = () => {
    setLocationFilter("");
    setBookingData((prev) => ({ ...prev, location: "" }));
  };

  const clearVehicleSearch = () => {
    setSearchQuery("");
    setVehicleTypeFilter("");
    clearLocationFilter();
  };

  const closeBookingAccessModal = () => setShowBookingAccessModal(false);
  const handleBookingModalSignIn = () => {
    setShowBookingAccessModal(false);
    if (bookingVehicle) onSignInToBook?.(bookingVehicle);
    else onNavigateToSignIn();
  };
  const handleBookingModalRegister = () => {
    setShowBookingAccessModal(false);
    onNavigateToRegister();
  };
  const handleBookingModalBrowseVehicles = () => {
    setShowBookingAccessModal(false);
    onNavigateToVehicles();
  };

  const openVehiclePreview = (vehicle) => {
    setPreviewVehicle(vehicle);
  };

  const openSuggestedVehicle = async (entry) => {
    try {
      const response = await API.getPublicVehicleById(entry.id);
      const vehicle = normalizeVehicle(response.vehicle);
      if (!vehicle.available) {
        setReloadSignal((value) => value + 1);
        return "This vehicle is no longer available. Try another suggestion.";
      }
      openVehiclePreview(vehicle);
      return "";
    } catch {
      return "Could not open this vehicle. Try again or use the results below.";
    }
  };

  const closeVehiclePreview = () => {
    setPreviewVehicle(null);
  };

  const handleBookNow = (vehicle) => {
    if (!vehicle?.available) return;
    if (!isLoggedIn) {
      setBookingVehicle(vehicle);
      setShowBookingAccessModal(true);
      return;
    }
    onViewDetails(vehicle);
  };

  const handleChatOwner = (vehicle) => {
    if (!vehicle) return;

    const ownerId = String(vehicle.owner?._id || "");
    const viewerId = String(user?._id || "");
    const vehicleId = String(vehicle._id || vehicle.id || "");

    if (!ownerId || ownerId === viewerId) return;
    if (!isLoggedIn) {
      onNavigateToSignIn?.();
      return;
    }

    onNavigateToChat?.({
      partnerId: ownerId,
      partnerName: vehicle.owner?.name || "Vehicle Owner",
      partnerEmail: vehicle.owner?.email || "",
      partnerAvatar: vehicle.owner?.avatar || "",
      ...(vehicleId ? { vehicleId } : {}),
    });
  };

  const previewOwnerId = String(previewVehicle?.owner?._id || "");
  const disablePreviewChat = Boolean(previewVehicle) && (
    !previewOwnerId || previewOwnerId === String(user?._id || "")
  );

  return (
      <div className="rp-renter-page min-h-screen">
        <Navbar
          activePage="vehicles"
          isLoggedIn={isLoggedIn}
          user={user}
          onNavigateToHome={onNavigateToHome}
          onNavigateToVehicles={onNavigateToVehicles}
          onNavigateToBookingHistory={onNavigateToBookingHistory}
          onNavigateToAbout={onNavigateToAbout}
          onNavigateToContacts={onNavigateToContacts}
          onNavigateToChat={onNavigateToChat}
          onNavigateToNotifications={onNavigateToNotifications}
          onOpenNotificationsModal={onOpenNotificationsModal}
          onNavigateToSignIn={onNavigateToSignIn}
          onNavigateToRegister={onNavigateToRegister}
          onNavigateToAccountSettings={onNavigateToAccountSettings}
          onNavigateToReports={onNavigateToReports}
          isAIOpen={showAI}
          onShowAI={() => setShowAI(true)}
          onLogout={onLogout}
        />

        <main className="rp-page-shell mx-auto max-w-[1440px] px-4 pb-16 pt-24 sm:px-6">
          <section className="rp-fleet-results" aria-labelledby="vehicle-results-heading">
              <header className="rp-page-header rp-bookings-page-header mb-6">
                  <h1 id="vehicle-results-heading" className="rp-bookings-page-header__title text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Available vehicles</h1>
                  <p role="status" className="rp-bookings-page-header__description text-sm text-slate-500">
                    {loading || (!showingCurrentResults && !error)
                      ? "Checking the latest listings..."
                      : refreshing
                        ? "Updating the latest listings..."
                      : `${vehicles.length} ${vehicles.length === 1 ? "vehicle" : "vehicles"} match your search`}
                  </p>
                  <div className="rp-bookings-page-header__help">
                    <HelpLink guide="request-booking">Need help choosing?</HelpLink>
                  </div>
                  <button
                    type="button"
                    disabled={loading || refreshing}
                    onClick={() => setReloadSignal((value) => value + 1)}
                    className="rp-bookings-page-header__refresh inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold disabled:opacity-50"
                    aria-label={refreshing ? "Refreshing vehicles" : "Refresh vehicles"}
                  >
                    <RefreshCw size={16} strokeWidth={2} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
                    <span className="rp-bookings-page-header__refresh-label">{refreshing ? "Refreshing..." : "Refresh"}</span>
                  </button>
              </header>

              <div className="rp-results-toolbar">
                <div className="rp-quick-filters" role="group" aria-label="Quick vehicle type filters">
                  {VEHICLE_TYPE_FILTERS.map((filter) => (
                    <button
                      key={filter.value || "all"}
                      type="button"
                      aria-pressed={vehicleTypeFilter === filter.value}
                      className={vehicleTypeFilter === filter.value ? "is-active" : ""}
                      onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
                      onClick={() => setVehicleTypeFilter(filter.value)}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
                <VehicleSearchInput
                  value={searchQuery}
                  onChange={(value) => setSearchQuery(filterVehicleSearch(value))}
                  onSelectVehicle={openSuggestedVehicle}
                  location={locationFilter}
                  vehicleType={vehicleTypeFilter}
                  error={searchValidationError}
                  maxLength={MAX_VEHICLE_SEARCH_LENGTH}
                />
              </div>

              {locationFilter && (
                <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span>Location:</span>
                  <button type="button" onClick={clearLocationFilter} aria-label={`Remove location filter: ${locationFilter}`} className="rp-btn-secondary max-w-full px-3 py-2 text-sm">
                    <span className="min-w-0 break-words">{locationFilter}</span>
                    <X size={16} className="shrink-0" aria-hidden="true" />
                  </button>
                </div>
              )}

              {loading && (
                <div className="min-h-[27rem]">
                  <DelayedSkeleton delay={500}>
                    <VehicleGridSkeleton label="Loading available vehicles" count={4} />
                  </DelayedSkeleton>
                </div>
              )}

              {refreshing && showingCurrentResults && <p role="status" className="mb-3 text-sm text-slate-600">Updating listings...</p>}

              {!loading && error && (
                <div role="alert" className="rp-results-status rp-results-status--error"><span>{error}</span><button type="button" onClick={() => setReloadSignal((value) => value + 1)} className="rounded-lg border border-current px-4 py-2 font-semibold focus-visible:outline focus-visible:outline-2">Retry</button></div>
              )}

              {!loading && !error && showingCurrentResults && vehicles.length === 0 && (
                <div className="rp-results-status">
                  <CarFront size={24} />
                  <strong>{locationFilter ? `No available vehicles found in ${locationFilter}` : "No vehicles match your search"}</strong>
                  <span>Try another location, search term, or vehicle type.</span>
                  {(combinedSearch || locationFilter || vehicleTypeFilter) && (
                    <button type="button" onClick={clearVehicleSearch}>Clear search</button>
                  )}
                </div>
              )}

              {!loading && !error && showingCurrentResults && vehicles.length > 0 && (
                <div className="rp-market-grid">
                  {visibleVehicles.items.map((vehicle) => (
                    <VehicleCard
                      key={vehicle.id}
                      vehicle={vehicle}
                      onPreview={openVehiclePreview}
                      onBookNow={handleBookNow}
                      compactSpecs
                    />
                  ))}
                </div>
              )}
              {!loading && !error && showingCurrentResults && <ListRevealControls list={visibleVehicles} />}
          </section>
        </main>
        <VehiclePreviewModal
          isOpen={Boolean(previewVehicle)}
          vehicle={previewVehicle}
          onClose={closeVehiclePreview}
          onBookNow={() => {
            if (!previewVehicle) return;
            closeVehiclePreview();
            handleBookNow(previewVehicle);
          }}
          onChatOwner={() => {
            if (!previewVehicle) return;
            closeVehiclePreview();
            handleChatOwner(previewVehicle);
          }}
          disableChat={disablePreviewChat}
        />
        <BookingAccessModal
          isOpen={showBookingAccessModal}
          onClose={closeBookingAccessModal}
          onSignIn={handleBookingModalSignIn}
          onRegister={handleBookingModalRegister}
          onBrowseVehicles={handleBookingModalBrowseVehicles}
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
