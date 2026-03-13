  import React, { useEffect, useMemo, useState } from "react";
  import { CarFront, Fuel, Search, Settings, Users } from "lucide-react";
  import API from "../utils/api";
  import Navbar from "../components/Navbar";
  import ChatWidget from "../components/ChatWidget";
  import {
    sanitizeBookingRange,
  } from "../utils/dateUtils";

  const normalizeVehicle = (vehicle) => ({
    id: vehicle._id,
    _id: vehicle._id,
    name: vehicle.name,
    location: vehicle.location,
    image: vehicle.imageUrl || vehicle.images?.[0] || "/bmw-x5.png",
    images: vehicle.images || [],
    type: vehicle.specs?.type || "car",
    subType: vehicle.specs?.subType || "Standard",
    category: "Owner-listed Vehicle",
    seats: vehicle.specs?.seats || 4,
    transmission: vehicle.specs?.transmission || "Automatic",
    fuel: vehicle.specs?.fuel || "Gasoline",
    plateNumber: vehicle.specs?.plateNumber || "",
    price: Number(vehicle.dailyRentalRate || 0),
    driverOptionEnabled: Boolean(vehicle.driverOptionEnabled),
    driverDailyRate: Number(vehicle.driverDailyRate || 0),
    rating: Number.isFinite(Number(vehicle.averageRating ?? vehicle.rating))
      ? Number(Number(vehicle.averageRating ?? vehicle.rating).toFixed(1))
      : 0,
    reviewCount: Number.isFinite(Number(vehicle.reviewCount)) ? Number(vehicle.reviewCount) : 0,
    available: vehicle.availabilityStatus === "available",
    description: vehicle.description || "",
    specs: vehicle.specs || {},
    owner: {
      name: vehicle.owner?.name || "Vehicle Owner",
      email: vehicle.owner?.email || "",
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
    onNavigateToRegister,
    onNavigateToVehicles,
    onViewDetails,
    onNavigateToBookingHistory,
    onNavigateToAbout,
    onNavigateToContacts,
    onNavigateToChat,
    onNavigateToNotifications,
    onNavigateToAccountSettings,
  }) {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAI, setShowAI] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [vehicleTypeFilter, setVehicleTypeFilter] = useState(bookingData.vehicleType || "");
    const [pagination, setPagination] = useState({ page: 1, limit: 24, total: 0, totalPages: 1 });

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

    const combinedSearch = useMemo(() => searchQuery.trim(), [searchQuery]);

    useEffect(() => {
      let isActive = true;
      const timeoutId = window.setTimeout(async () => {
        setLoading(true);
        setError("");

        try {
          const response = await API.getPublicVehicles({
            search: combinedSearch,
            page: 1,
            limit: 24,
          });

          if (!isActive) return;
          setVehicles((response.vehicles || []).map(normalizeVehicle));
          setPagination(response.pagination || { page: 1, limit: 24, total: 0, totalPages: 1 });
        } catch (err) {
          if (!isActive) return;
          setError(err.message || "Failed to load available vehicles.");
        } finally {
          if (isActive) setLoading(false);
        }
      }, 300);

      return () => {
        isActive = false;
        window.clearTimeout(timeoutId);
      };
    }, [combinedSearch]);

    const filteredVehicles = useMemo(() => {
      return vehicles.filter((vehicle) => {
        if (!vehicleTypeFilter) return true;
        return String(vehicle.type || "").toLowerCase() === vehicleTypeFilter.toLowerCase();
      });
    }, [vehicles, vehicleTypeFilter]);

  const availableCount = useMemo(
    () => filteredVehicles.filter((vehicle) => vehicle.available).length,
    [filteredVehicles]
  );

  return (
      <div className="min-h-screen">
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
          onNavigateToSignIn={onNavigateToSignIn}
          onNavigateToRegister={onNavigateToRegister}
          onNavigateToAccountSettings={onNavigateToAccountSettings}
          isAIOpen={showAI}
          onShowAI={() => setShowAI(true)}
          onLogout={onLogout}
        />

        <div className="pt-24 sm:pt-28 max-w-[1380px] mx-auto px-4 sm:px-6 pb-16">
          <div className="rp-surface p-5 sm:p-6 mb-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div>
                <h1 className="text-3xl sm:text-4xl font-bold">Browse Vehicles</h1>
                <p className="text-slate-600 mt-2">
                  Explore verified listings with flexible schedules and transparent pricing.
                </p>
              </div>
              <div className="rp-chip bg-[#0B75E7]/10 text-[#0B75E7] text-sm font-bold">
                {availableCount} available now
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
            <aside className="rp-surface rp-glass p-5 h-fit sticky top-24 space-y-4">
              <h2 className="text-lg font-bold">Filters</h2>

              <div>
                <label className="text-sm font-medium mb-1 block text-slate-600">Search</label>
                <div className="relative">
                  <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    className="rp-input pr-9 text-sm"
                    placeholder="Name, details, plate number"
                    maxLength={100}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block text-slate-600">Vehicle Type</label>
                <select
                  className="rp-input text-sm"
                  value={vehicleTypeFilter}
                  onChange={(event) => setVehicleTypeFilter(event.target.value)}
                >
                  <option value="">All types</option>
                  <option value="car">Car</option>
                  <option value="motorcycle">Motorcycle</option>
                  <option value="van">Van</option>
                  <option value="truck">Truck</option>
                </select>
              </div>
            </aside>

            <section>
              {loading && <p className="text-sm text-slate-600">Loading vehicles...</p>}
              {error && <p className="text-sm text-red-600">{error}</p>}
              {!loading && !error && pagination.total > 0 && (
                <p className="mb-3 text-sm text-slate-500">
                  Showing {filteredVehicles.length} of {pagination.total} vehicles
                </p>
              )}

              {!loading && !error && filteredVehicles.length === 0 && (
                <div className="rp-surface p-6 text-slate-600 text-sm">
                  No vehicles match your filters.
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredVehicles.map((vehicle) => (
                  <article key={vehicle.id} className="rp-surface rp-hover-lift overflow-hidden flex flex-col">
                  <div className="px-4 pt-4">
                    <div className="relative h-48 bg-gradient-to-br from-slate-50 to-slate-200 flex items-center justify-center overflow-hidden rp-image-frame">
                      <img
                        src={vehicle.image}
                        alt={vehicle.name}
                        className="relative z-0 h-full w-full object-cover object-center drop-shadow-sm"
                      />
                      <span
                        className={`absolute top-3 left-3 z-10 rp-chip ${
                          vehicle.available
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {vehicle.available ? "Available" : "Unavailable"}
                      </span>
                      <span className="absolute top-3 right-3 z-10 rp-chip bg-slate-900 text-white">
                        {vehicle.reviewCount > 0 ? vehicle.rating.toFixed(1) : "No reviews"}
                      </span>
                    </div>
                  </div>

                    <div className="p-5 flex flex-col gap-2 flex-1">
                      <h3 className="text-lg font-bold">{vehicle.name}</h3>
                      <p className="text-sm text-slate-600 line-clamp-2">{vehicle.description}</p>

                      <div className="flex items-center gap-1 text-sm text-slate-500">
                        <CarFront size={14} className="text-[#0B75E7]" />
                        <span className="capitalize">{vehicle.type}</span>
                      </div>

                      <div className="flex gap-4 text-sm text-slate-600">
                        <span className="flex items-center gap-1">
                          <Users size={14} className="text-[#0B75E7]" />
                          {vehicle.seats}
                        </span>
                        <span className="flex items-center gap-1">
                          <Settings size={14} className="text-[#0B75E7]" />
                          {vehicle.transmission}
                        </span>
                        <span className="flex items-center gap-1">
                          <Fuel size={14} className="text-[#0B75E7]" />
                          {vehicle.fuel}
                        </span>
                      </div>

                      {vehicle.driverOptionEnabled && (
                        <p className="text-sm text-blue-700">
                          Driver available
                        </p>
                      )}

                      <div className="text-xl font-bold text-[#0B75E7]">
                        P{vehicle.price.toLocaleString()}
                        <span className="text-sm text-slate-500 font-medium"> / day</span>
                      </div>

                      <div className="pt-4 mt-auto">
                        <button
                          onClick={() => {
                            if (!vehicle.available) return;
                            if (!isLoggedIn) {
                              onNavigateToSignIn();
                              return;
                            }
                            onViewDetails(vehicle);
                          }}
                          disabled={!vehicle.available}
                          className={`py-2 text-sm w-full rounded-xl font-semibold transition ${
                            vehicle.available
                              ? "rp-btn-primary"
                              : "bg-slate-200 text-slate-600 cursor-not-allowed"
                          }`}
                        >
                          {vehicle.available ? "Book Now" : "Unavailable"}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>
        <ChatWidget isOpen={showAI} onClose={() => setShowAI(false)} />
      </div>
    );
  }
