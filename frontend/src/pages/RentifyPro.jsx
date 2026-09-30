import React, { useEffect, useRef, useState } from "react";
import {
  Bike,
  CarFront,
  Search,
  Truck,
  Van,
  ArrowRight,
  CalendarCheck,
  KeyRound,
} from "lucide-react";
import Navbar from "../components/Navbar";
import ChatWidget from "../components/ChatWidget";
import VehiclePreviewModal from "../components/VehiclePreviewModal";
import API from "../utils/api";
import {
  formatDateInput,
  getMinPickupDateTime,
  formatTimeInput,
} from "../utils/dateUtils";
import LocationSearchInput from "../components/LocationSearchInput";
import VehicleCard from "../components/VehicleCard";
import { DelayedSkeleton, VehicleGridSkeleton } from "../components/LoadingSkeletons";
import VehicleTypeCarousel from "../components/VehicleTypeCarousel";
import { DEFAULT_VEHICLE_IMAGE } from "../utils/media";
import { formatVehicleTypeLabel } from "../utils/vehicleText";
import { normalizeLocationSearch, validateLocationSearch } from "../utils/locationSearch";

const categories = [
  {
    id: "premium-cars",
    title: "Cars",
    icon: CarFront,
    image: "/cars-optimized.jpg",
    tags: ["Sedan", "Hatchback", "SUV", "Luxury"],
    description: "For city drives, family outings, and weekend escapes.",
    vehicleType: "car",
  },
  {
    id: "motorcycles",
    title: "Motorcycles",
    icon: Bike,
    image: "/motor-optimized.jpg",
    tags: ["Scooter", "Sport Bike", "Cruiser"],
    description: "For daily commutes, solo trips, and exploring the city.",
    vehicleType: "motorcycle",
  },
  {
    id: "vans",
    title: "Vans",
    icon: Van,
    image: "/van-optimized.jpg",
    tags: ["Passenger", "Mini Van", "Cargo", "Luxury"],
    description: "Room for group trips, family getaways, and extra luggage.",
    vehicleType: "van",
  },
  {
    id: "trucks",
    title: "Trucks",
    icon: Truck,
    image: "/trucks-optimized.jpg",
    tags: ["Pick-up", "Cargo", "Refrigerated", "Flat Bed"],
    description: "For moving cargo, making deliveries, and bigger jobs.",
    vehicleType: "truck",
  },
];

const pickRandom = (list, count) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
};

const normalizeFeaturedVehicle = (vehicle) => ({
  id: vehicle._id,
  _id: vehicle._id,
  name: vehicle.name,
  location: vehicle.location,
  coverImageUrl: vehicle.coverImageUrl || vehicle.imageUrl || vehicle.images?.[0] || DEFAULT_VEHICLE_IMAGE,
  image: vehicle.coverImageUrl || vehicle.imageUrl || vehicle.images?.[0] || DEFAULT_VEHICLE_IMAGE,
  coverDisplayMode: vehicle.coverDisplayMode || "auto",
  category: vehicle.specs?.subType
    ? formatVehicleTypeLabel(vehicle.specs?.type, vehicle.specs.subType, { separator: " · " })
    : "Owner-listed Vehicle",
  seats: vehicle.specs?.seats || 4,
  transmission: vehicle.specs?.transmission || "Automatic",
  fuel: vehicle.specs?.fuel || "Gasoline",
  price: Number((vehicle.hourlyRentalRate ?? vehicle.dailyRentalRate) || 0),
  rating: Number.isFinite(Number(vehicle.averageRating ?? vehicle.rating))
    ? Number(Number(vehicle.averageRating ?? vehicle.rating).toFixed(1))
    : 0,
  reviewCount: Number.isFinite(Number(vehicle.reviewCount)) ? Number(vehicle.reviewCount) : 0,
  available: vehicle.availabilityStatus === "available",
  description: vehicle.description || "",
  owner: {
    _id: vehicle.owner?._id || "",
    name: vehicle.owner?.name || "Vehicle Owner",
    email: vehicle.owner?.email || "",
    avatar: vehicle.owner?.avatar || "",
    verified: vehicle.owner?.verified !== false,
  },
  codingDay: "",
});

const featureItems = [
  {
    image: "/ai powered suggestions.jpg",
    title: "AI-Powered Suggestions",
    description: "Get smarter recommendations based on your preferred routes and vehicle types.",
  },
  {
    image: "/secure booking flow.jpg",
    title: "Secure Booking Flow",
    description: "Transparent booking updates with secure data handling for every reservation.",
  },
  {
    image: "/online rentals.jpg",
    title: "Fast Online Rentals",
    description: "Compare, reserve, and confirm vehicles in minutes with a clean booking process.",
  },
];

const aboutValues = [
  {
    title: "Quality Vehicles",
    description: "All vehicles are inspected and maintained for safety and reliability.",
    image: "/about-quality-vehicles.png",
  },
  {
    title: "Customer Experience",
    description: "Simple booking flow and responsive support across every trip stage.",
    image: "/about-customer-experience.png",
  },
  {
    title: "Trust & Transparency",
    description: "Clear rates, honest policies, and transparent booking updates.",
    image: "/about-trust-transparency.png",
  },
];

const processSteps = [
  {
    number: "01",
    icon: Search,
    title: "Find a Vehicle",
    description: "Search available vehicles by location, category, schedule, or keywords.",
  },
  {
    number: "02",
    icon: CalendarCheck,
    title: "Book Securely",
    description: "Choose your rental schedule and complete your booking using RentifyPro's supported payment options.",
  },
  {
    number: "03",
    icon: KeyRound,
    title: "Pick Up & Drive",
    description: "Coordinate with the vehicle owner, start your rental, and manage your booking directly through RentifyPro.",
  },
];

const getDefaultSearchDates = () => {
  const minPickupDateTime = getMinPickupDateTime();
  const pickupDate = formatDateInput(minPickupDateTime);
  const pickupTime = formatTimeInput(minPickupDateTime);

  const nextDay = new Date(`${pickupDate}T00:00:00`);
  nextDay.setDate(nextDay.getDate() + 1);
  const returnDate = formatDateInput(nextDay);

  return {
    pickupDate,
    pickupTime,
    returnDate,
    returnTime: pickupTime,
  };
};

const normalizeVehicleType = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "motor") return "motorcycle";
  return normalized;
};

const mapSearchPayload = (location, vehicleType) => ({
  location: String(location || "").trim(),
  vehicleType: normalizeVehicleType(vehicleType),
  ...getDefaultSearchDates(),
});

export default function RentifyPro({
  onNavigateToHome,
  onNavigateToSignIn,
  onSignInToBook,
  onNavigateToVehicles,
  onNavigateToRegister,
  onNavigateToAbout,
  onNavigateToContacts,
  onNavigateToChat,
  onNavigateToNotifications,
  onSearch,
  onViewDetails,
  onNavigateToBookingHistory,
  onNavigateToAccountSettings,
  onNavigateToReports,
  onNavigateToPrivacyPolicy,
  onNavigateToTermsAndConditions,
  onOpenNotificationsModal,
  isLoggedIn,
  user,
  onLogout,
}) {
  const [featuredVehicles, setFeaturedVehicles] = useState([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [featuredError, setFeaturedError] = useState("");
  const [location, setLocation] = useState("");
  const [locationError, setLocationError] = useState("");
  const locationInputRef = useRef(null);
  const [vehicleType, setVehicleType] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState(categories[0].id);
  const [showAI, setShowAI] = useState(false);
  const [previewVehicle, setPreviewVehicle] = useState(null);
  const homeRef = useRef(null);
  const featuredCarouselRef = useRef(null);

  const selectVehicleCategory = (category) => {
    setActiveCategoryId(category.id);
    setVehicleType(category.vehicleType);
  };

  const handleSearch = (typeOverride = vehicleType) => {
    const error = validateLocationSearch(location);
    setLocationError(error);
    if (error) {
      locationInputRef.current?.focus();
      return;
    }
    onSearch(mapSearchPayload(normalizeLocationSearch(location), typeOverride));
  };

  useEffect(() => {
    let active = true;
    const loadFeatured = async () => {
      setFeaturedLoading(true);
      setFeaturedError("");
      try {
        const response = await API.getPublicVehicles({ page: 1, limit: 24 });
        if (!active) return;
        const availableVehicles = (response.vehicles || [])
          .map(normalizeFeaturedVehicle)
          .filter((vehicle) => vehicle.available);
        setFeaturedVehicles(pickRandom(availableVehicles, 4));
      } catch (err) {
        if (!active) return;
        setFeaturedError(err.message || "Failed to load featured vehicles.");
      } finally {
        if (active) setFeaturedLoading(false);
      }
    };

    loadFeatured();
    return () => {
      active = false;
    };
  }, []);



  useEffect(() => {
    const landing = homeRef.current;
    if (!landing) return undefined;

    const targets = Array.from(landing.querySelectorAll("[data-rp-reveal]"))
      .filter((element) => !element.classList.contains("is-visible"));

    if (targets.length === 0) return undefined;

    const reveal = (element) => element.classList.add("is-visible");
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion || !("IntersectionObserver" in window)) {
      targets.forEach(reveal);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          reveal(entry.target);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [featuredVehicles.length]);

  const openVehiclePreview = (vehicle) => {
    setPreviewVehicle(vehicle);
  };

  const closeVehiclePreview = () => {
    setPreviewVehicle(null);
  };

  const handleFeaturedBookNow = (vehicle) => {
    if (!vehicle) return;
    if (!isLoggedIn) {
      onSignInToBook?.(vehicle);
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
    <div ref={homeRef} id="home" className="rp-renter-home min-h-screen">
      <Navbar
        activePage="home"
        isLoggedIn={isLoggedIn}
        user={user}
        isAIOpen={showAI}
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
        onShowAI={() => setShowAI(true)}
        onLogout={onLogout}
      />

      <section className="relative mx-auto max-w-7xl overflow-hidden pt-28 sm:rounded-b-3xl sm:pt-36 pb-28">
        <img
          src="/hero-car1-optimized.jpg"
          alt="RentifyPro Hero"
          className="rp-home-hero-image rp-hero-parallax absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#020617]/80 via-[#0f172a]/60 to-[#0B75E7]/50" />

        <div className="relative z-10 mx-auto max-w-7xl px-5 sm:px-8">
          <div className="max-w-3xl rp-hero-motion">
            <span className="rp-hero-motion__eyebrow rp-chip bg-white/18 text-white border border-white/30">
              Premium Mobility Marketplace
            </span>
            <h1 className="rp-hero-motion__title text-white mt-5 text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight">
              Rent Smarter.
              <br />
              Drive Better.
            </h1>
            <p className="rp-hero-motion__copy text-blue-100 mt-5 max-w-2xl text-base sm:text-lg">
              Discover cars, motorcycles, vans, and trucks with a modern booking experience built
              for convenience and confidence.
            </p>

            <div className="rp-hero-motion__actions mt-8 flex flex-wrap items-center gap-3">
              <span className="rp-hero-motion__action">
                <button onClick={onNavigateToVehicles} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-3 text-sm font-semibold text-white underline underline-offset-4 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white sm:text-base">
                  Browse Vehicles
                </button>
              </span>
              <span className="rp-hero-motion__action">
                <button onClick={onNavigateToAbout} className="rp-btn-secondary px-6 py-3 text-sm sm:text-base">
                  Learn More
                </button>
              </span>
            </div>
          </div>

        </div>
      </section>

      <section aria-labelledby="home-search-heading" className="rp-hero-search relative z-20 mx-auto -mt-16 max-w-6xl px-4 sm:-mt-20 sm:px-6">
        <form role="search" aria-labelledby="home-search-heading" onSubmit={(event) => { event.preventDefault(); handleSearch(); }} className="rounded-2xl bg-white p-5 shadow-lg shadow-slate-900/10 sm:p-6">
          <h2 id="home-search-heading" className="mb-4 text-lg font-semibold text-slate-900">Find a vehicle for your next trip</h2>
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
            <LocationSearchInput
              value={location} onChange={setLocation} vehicleType={vehicleType}
              error={locationError} onError={setLocationError} inputRef={locationInputRef}
            />

            <div>
              <label htmlFor="home-search-type" className="text-xs font-semibold text-slate-600">Vehicle type</label>
              <div className="mt-1.5">
                <select
                  id="home-search-type"
                  name="vehicleType"
                  className="rp-input cursor-pointer"
                  value={vehicleType}
                  onChange={(event) => {
                    const nextVehicleType = event.target.value;
                    setVehicleType(nextVehicleType);
                    const matchingCategory = categories.find((category) => (
                      category.vehicleType === nextVehicleType
                    ));
                    if (matchingCategory) selectVehicleCategory(matchingCategory);
                  }}
                >
                  <option value="">All Vehicles</option>
                  <option value="car">Car</option>
                  <option value="motorcycle">Motorcycle</option>
                  <option value="van">Van</option>
                  <option value="truck">Truck</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              className="rp-btn-primary md:mt-[30px] min-h-12 w-full justify-center px-6 py-3 text-sm sm:text-base flex items-center gap-2 md:w-auto"
            >
              <Search size={18} aria-hidden="true" />
              Find vehicles
            </button>
          </div>
        </form>
      </section>

      <section id="categories" className="rp-home-section mx-auto max-w-7xl scroll-mt-24 px-5 py-16 sm:px-8 sm:py-20">
        <div
          className="mb-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between rp-scroll-reveal rp-reveal-up"
          data-rp-reveal=""
        >
          <div className="rp-section-heading max-w-2xl">
            <span className="rp-page-eyebrow">Browse by vehicle type</span>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
              The right vehicle for <span className="text-[#0B75E7]">every plan</span>
            </h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-slate-600 sm:text-base">
            Explore cars, motorcycles, vans, and trucks for daily travel, group trips, or moving cargo.
          </p>
        </div>

        <div className="rp-scroll-reveal rp-reveal-card" data-rp-reveal="">
          <VehicleTypeCarousel
            categories={categories}
            activeCategoryId={activeCategoryId}
            onSelect={selectVehicleCategory}
            onBrowse={handleSearch}
          />
        </div>
      </section>

      <section id="featured" className="rp-featured-section scroll-mt-24 py-16 sm:py-20">
        <div className="rp-featured-section__content mx-auto max-w-7xl px-5 sm:px-8">
          <div
            className="mb-10 rp-section-heading rp-scroll-reveal rp-reveal-up"
            data-rp-reveal=""
          >
            <span className="rp-page-eyebrow">Available near you</span>
            <div className="mt-3 flex items-center justify-between gap-3">
              <h2 className="min-w-0 text-3xl font-bold sm:text-4xl">
                Featured <span className="text-[#0B75E7]">vehicles</span>
              </h2>
              <button type="button" onClick={onNavigateToVehicles} className="rp-btn-secondary max-w-[46%] shrink-0 px-3 py-2.5 text-sm sm:max-w-none sm:px-4">
                <span>View all vehicles</span>
                <ArrowRight size={16} className="shrink-0" aria-hidden="true" />
              </button>
            </div>
            <p className="mt-3 max-w-2xl text-slate-600">A small selection of verified listings ready to book.</p>
          </div>

          {featuredError && (
            <div className="rp-surface p-6 text-sm text-rose-600">{featuredError}</div>
          )}
          {featuredLoading && (
            <div className="min-h-[27rem]">
              <DelayedSkeleton>
                <VehicleGridSkeleton label="Loading featured vehicles" count={4} className="rp-featured-carousel" />
              </DelayedSkeleton>
            </div>
          )}
          {!featuredLoading && !featuredError && featuredVehicles.length === 0 && (
            <div className="rp-surface p-6 text-sm text-slate-600">
              No available vehicles to feature right now.
            </div>
          )}

          {!featuredLoading && !featuredError && featuredVehicles.length > 0 && (
            <>
              {featuredVehicles.length > 1 && (
                <p id="featured-carousel-hint" className="mt-4 flex items-center gap-1 text-sm font-medium text-slate-600 sm:hidden">
                  Swipe for more vehicles <ArrowRight size={16} aria-hidden="true" />
                </p>
              )}
              <div
                ref={featuredCarouselRef}
                className="rp-featured-carousel"
                role="region"
                aria-label="Featured vehicles"
                aria-describedby={featuredVehicles.length > 1 ? "featured-carousel-hint" : undefined}
                tabIndex="0"
              >
                {featuredVehicles.map((vehicle, index) => (
                  <VehicleCard
                    key={vehicle.id}
                    vehicle={vehicle}
                    onPreview={openVehiclePreview}
                    onBookNow={handleFeaturedBookNow}
                    className="rp-scroll-reveal rp-reveal-card"
                    imageClassName="rp-reveal-media-image"
                    data-rp-reveal=""
                    data-featured-card=""
                    style={{ "--rp-reveal-delay": `${index * 90}ms` }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <section id="how-it-works" className="rp-how-it-works scroll-mt-24" aria-labelledby="how-it-works-heading">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div
            className="rp-how-it-works__heading rp-scroll-reveal rp-reveal-up"
            data-rp-reveal=""
          >
            <span className="rp-page-eyebrow">A simple way to rent</span>
            <h2 id="how-it-works-heading">How RentifyPro Works</h2>
            <p>
              From your first search to the moment you drive away, every step stays clear and in your control.
            </p>
          </div>

          <ol className="rp-process-steps" role="list">
            {processSteps.map((step, index) => {
              const StepIcon = step.icon;
              return (
                <li
                  key={step.number}
                  className="rp-process-step rp-scroll-reveal rp-reveal-up"
                  data-rp-reveal=""
                  style={{ "--rp-reveal-delay": `${index * 90}ms` }}
                >
                  <div className="rp-process-step__icon" aria-hidden="true">
                    <StepIcon size={28} strokeWidth={1.75} />
                  </div>
                  <div className="rp-process-step__content">
                    <span className="rp-process-step__number">
                      <span className="sr-only">Step </span>{step.number}
                    </span>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section id="about" className="rp-home-section mx-auto max-w-7xl scroll-mt-28 px-5 py-16 sm:px-8 sm:py-20">
        <div
          className="rp-section-heading mb-10 text-center rp-scroll-reveal rp-reveal-up"
          data-rp-reveal=""
        >
          <span className="rp-page-eyebrow">Built for better journeys</span>
          <h2 className="text-3xl sm:text-4xl font-bold">
            About <span className="text-[#0B75E7]">RentifyPro</span>
          </h2>
          <p className="text-slate-600 mt-3">
            Your trusted partner for vehicle rentals in the Philippines.
          </p>
        </div>

        <article
          className="rp-surface rp-scroll-reveal rp-reveal-from-left p-6 sm:p-8 mb-8"
          data-rp-reveal=""
          style={{ "--rp-reveal-delay": "80ms" }}
        >
          <h3 className="text-2xl font-bold mb-4">
            Our <span className="text-[#0B75E7]">Story</span>
          </h3>
          <p className="text-slate-600 mb-4">
            RentifyPro started with one goal: make vehicle rentals easy, reliable, and accessible.
            From a small local fleet, we have grown into a platform that helps renters and owners
            connect with confidence.
          </p>
          <p className="text-slate-600 mb-4">
            Whether it is for business, family trips, or daily transport, we focus on a smooth
            booking experience with practical tools and secure transactions.
          </p>
          <p className="text-slate-600">
            We continue improving the platform to deliver better mobility options for more users.
          </p>
        </article>

        <div className="grid gap-5 md:grid-cols-12 md:auto-rows-fr">
          {aboutValues.map((item, index) => (
            <article
              key={item.title}
              className={`group rp-surface rp-hover-lift rp-scroll-reveal rp-reveal-card overflow-hidden ${
                index === 1 ? "rp-reveal-from-right" : index === 2 ? "rp-reveal-from-left" : ""
              } ${
                index === 0
                  ? "md:col-span-5 md:row-span-2"
                  : "sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:col-span-7"
              }`}
              data-rp-reveal=""
              style={{ "--rp-reveal-delay": `${index * 100}ms` }}
            >
              <div
                className={`overflow-hidden bg-[#edf6ff] ${
                  index === 0 ? "aspect-[16/9]" : "h-52 sm:h-full sm:min-h-44"
                }`}
              >
                <img
                  src={item.image}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  className="rp-reveal-media-image h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                />
              </div>

              <div className={`flex flex-col justify-center ${index === 0 ? "p-7" : "p-6 sm:p-7"}`}>
                <div className="mb-4 h-1 w-10 rounded-full bg-[#0B75E7]" />
                <h3 className="text-xl font-bold tracking-tight text-slate-950">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rp-home-section mx-auto max-w-7xl px-5 pb-16 pt-12 sm:px-8 sm:pb-20">
        <div
          className="rp-section-heading mb-10 text-center rp-scroll-reveal rp-reveal-up"
          data-rp-reveal=""
        >
          <span className="rp-page-eyebrow">Simple, secure, dependable</span>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
            Why Choose <span className="text-[#0B75E7]">RentifyPro</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {featureItems.map((item, index) => (
            <article
              key={item.title}
              className="group rp-surface rp-hover-lift rp-scroll-reveal rp-reveal-card flex h-full flex-col overflow-hidden text-left"
              data-rp-reveal=""
              style={{ "--rp-reveal-delay": `${index * 100}ms` }}
            >
              <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
                <img
                  src={item.image}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  className="rp-reveal-media-image h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                />
              </div>

              <div className="flex flex-1 flex-col p-6 sm:p-7">
                <h3 className="text-xl font-bold tracking-tight text-slate-950">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer
        id="contacts"
        className="mx-auto mt-8 max-w-7xl overflow-hidden bg-gradient-to-r from-[#045FC3] to-[#0B75E7] py-14 text-white sm:rounded-t-3xl"
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="rp-scroll-reveal rp-reveal-up" data-rp-reveal="">
              <h3 className="text-2xl font-bold">RentifyPro</h3>
              <p className="text-blue-100 mt-3 text-sm">
                Your trusted partner for vehicle rentals in the Philippines.
              </p>
            </div>

            <div
              className="rp-scroll-reveal rp-reveal-up"
              data-rp-reveal=""
              style={{ "--rp-reveal-delay": "80ms" }}
            >
              <h4 className="font-bold mb-3">Quick Links</h4>
              <ul className="space-y-2 text-blue-100 text-sm">
                <li>
                  <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
                    Home
                  </button>
                </li>
                <li>
                  <button onClick={onNavigateToVehicles}>Vehicles</button>
                </li>
                <li>
                  <button onClick={onNavigateToBookingHistory}>Bookings</button>
                </li>
                <li>
                  <button onClick={onNavigateToAbout}>About</button>
                </li>
              </ul>
            </div>

            <div
              className="rp-scroll-reveal rp-reveal-up"
              data-rp-reveal=""
              style={{ "--rp-reveal-delay": "160ms" }}
            >
              <h4 className="font-bold mb-3">Vehicle Categories</h4>
              <ul className="space-y-2 text-blue-100 text-sm">
                <li>Cars</li>
                <li>Motorcycles</li>
                <li>Vans</li>
                <li>Trucks</li>
              </ul>
            </div>

            <div
              className="rp-scroll-reveal rp-reveal-up"
              data-rp-reveal=""
              style={{ "--rp-reveal-delay": "240ms" }}
            >
              <h4 className="font-bold mb-3">Contact</h4>
              <ul className="space-y-2 text-blue-100 text-sm">
                <li>+63 912 324 5678</li>
                <li>rentifypro.official@gmail.com</li>
                <li>Dagupan, Pangasinan</li>
                <li>Philippines</li>
              </ul>
            </div>
          </div>

          <div
            className="border-t border-blue-400/50 mt-10 pt-5 flex flex-col sm:flex-row items-center justify-between text-blue-100 text-sm gap-2 rp-scroll-reveal rp-reveal-up"
            data-rp-reveal=""
            style={{ "--rp-reveal-delay": "300ms" }}
          >
            <p>Copyright 2026 RentifyPro. All rights reserved.</p>
            <div className="flex gap-5">
              <button onClick={onNavigateToPrivacyPolicy}>Privacy Policy</button>
              <button onClick={onNavigateToTermsAndConditions}>Terms and Conditions</button>
            </div>
          </div>
        </div>
      </footer>

      <ChatWidget
        isOpen={showAI}
        onOpen={() => setShowAI(true)}
        onClose={() => setShowAI(false)}
        onViewAvailableVehicles={onNavigateToVehicles}
      />
      <VehiclePreviewModal
        isOpen={Boolean(previewVehicle)}
        vehicle={previewVehicle}
        onClose={closeVehiclePreview}
        onBookNow={() => {
          if (!previewVehicle) return;
          closeVehiclePreview();
          handleFeaturedBookNow(previewVehicle);
        }}
        onChatOwner={() => {
          if (!previewVehicle) return;
          closeVehiclePreview();
          handleChatOwner(previewVehicle);
        }}
        disableChat={disablePreviewChat}
      />
    </div>
  );
}
