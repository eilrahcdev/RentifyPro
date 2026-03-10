<<<<<<< HEAD
import React, { useEffect, useMemo, useState } from "react";
import {
  Bike,
  Car,
  Fuel,
  MapPin,
  Radio,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  Van,
  Wrench,
} from "lucide-react";
import Navbar from "../components/Navbar";
import ChatWidget from "../components/ChatWidget";
import {
  formatDateInput,
  getCurrentTime,
  getDateTime,
  getTodayDate,
  getTomorrowDate,
} from "../utils/dateUtils";
import InfoModal from "../components/InfoModal";

const categories = [
=======
<<<<<<< HEAD
import React, { useState, useEffect } from "react";
import { MapPin, Car, Bike, Truck, Van, Sparkles, Shield, Radio, Bot, Search, Users, Settings, Fuel, Bell, MessageCircle, BadgeCheck } from "lucide-react";

const getTodayDate = () => {
  const d = new Date();
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD (LOCAL time)
};

const getTomorrowDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD
};

const getCurrentTime = () => {
  const d = new Date();
  return d.toTimeString().slice(0, 5); // HH:mm
};

const normalize = (str = "") =>
  str.toLowerCase().replace(/\s+/g, " ").trim();




const RentifyPro = ({
  onNavigateToSignIn, 
  onNavigateToVehicles, 
  onNavigateToRegister, 
  onNavigateToAbout, 
  onSearch, 
  onViewDetails, 
  onNavigateToBookingHistory,  
   onNavigateToAccountSettings,
  isLoggedIn, 
  user, 
  onLogout,
}) => {

  const [location, setLocation] = useState("");
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [vehicleType, setVehicleType] = useState("");
  const [showAI, setShowAI] = useState(false);
  const [userMessage, setUserMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const getInitials = (firstName, lastName) => {
  if (!firstName || !lastName) return "";
  return `${firstName[0]}${lastName[0]}`.toUpperCase();

};

{/* AI MESSAGE PAG CLICK NG BOT */}
    useEffect(() => {
      if (showAI) {
        setMessages([
          {
            sender: "ai",
            text: "Hi! 👋 This is RentifyPro AI. How can I assist you today?"
          }
        ]);
      }
    }, [showAI]);

    const [profilePhoto, setProfilePhoto] = useState(
      localStorage.getItem("profilePhoto") || null
    );
    
    const handlePhotoUpload = (e) => {
      const file = e.target.files[0];
      if (!file) return;
    
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfilePhoto(reader.result);
        localStorage.setItem("profilePhoto", reader.result);
      };
      reader.readAsDataURL(file);
    };
    
    const handleRemovePhoto = () => {
      setProfilePhoto(null);
      localStorage.removeItem("profilePhoto");
    };

    const locations = [
      "Urdaneta City, Pangasinan",
      "Dagupan City, Pangasinan",
      "Calasiao, Pangasinan",
      "Lingayen, Pangasinan",
      "Mangaldan, Pangasinan",
      "University of Pangasinan",
      "San Carlos City, Pangasinan",
      "Sta Barbara, Pangasinan",
      "SM Dagupan",
      "Robinsons Place Pangasinan",
    ];

  
    {/* DEFAULT DATE AND TIME */}

    {/* PICKUP NOW */}
  // DEFAULT PICKUP
const [pickupDate, setPickupDate] = useState(() => getTodayDate());
const [pickupTime, setPickupTime] = useState(() => getCurrentTime());

// DEFAULT RETURN (always +1 day, same time)
const [returnDate, setReturnDate] = useState(() => getTomorrowDate());
const [returnTime, setReturnTime] = useState(() => getCurrentTime());


 useEffect(() => {
  if (returnDate <= pickupDate) {
    const nextDay = new Date(pickupDate);
    nextDay.setDate(nextDay.getDate() + 1);
    setReturnDate(nextDay.toISOString().split("T")[0]);
  }
}, [pickupDate]);

useEffect(() => {
  const today = getTodayDate();
  const now = getCurrentTime();

  if (pickupDate === today) {
    if (pickupTime < now) {
      setPickupTime(now);
    }
  }
}, [pickupDate, pickupTime]);

const isValidDateTime = () => {
  const now = new Date();
  now.setSeconds(0, 0);

  const pickup = new Date(`${pickupDate}T${pickupTime}`);
  const dropoff = new Date(`${returnDate}T${returnTime}`);

  if (pickup < now) return false;        // pickup in past
  if (dropoff <= pickup) return false;   // return not after pickup

  return true;
};




  {/* VEHICLE CTAGEORIES */}

  const categories = [
=======
import React, { useEffect, useMemo, useState } from "react";
import {
  Bike,
  Car,
  Fuel,
  MapPin,
  Radio,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  Van,
  Wrench,
} from "lucide-react";
import Navbar from "../components/Navbar";
import ChatWidget from "../components/ChatWidget";
import {
  formatDateInput,
  getCurrentTime,
  getDateTime,
  getTodayDate,
  getTomorrowDate,
} from "../utils/dateUtils";
import InfoModal from "../components/InfoModal";

const categories = [
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  {
    id: "premium-cars",
    title: "Premium Cars",
    icon: Car,
    image: "/cars.png",
    tags: ["Sedan", "Hatchback", "SUV", "Luxury"],
<<<<<<< HEAD
    description: "Ideal for family trips, business meetings, and city drives.",
    price: "P500/day",
    vehicleType: "car",
=======
<<<<<<< HEAD
    description: "Perfect for family trips, business meetings, or special occasions.",
    price: "₱500/day",
=======
    description: "Ideal for family trips, business meetings, and city drives.",
    price: "P500/day",
    vehicleType: "car",
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  },
  {
    id: "motorcycles",
    title: "Motorcycles",
    icon: Bike,
    image: "/motor.png",
<<<<<<< HEAD
=======
<<<<<<< HEAD
    tags: ["Scooter", "Sports Bike", "Cruiser"],
    description: "Ideal for quick commutes, exploring the city, or weekend adventures.",
    price: "₱300/day",
=======
>>>>>>> 8422a2f (fixed bugs and updates)
    tags: ["Scooter", "Sport Bike", "Cruiser"],
    description: "Great for fast commutes and flexible urban travel.",
    price: "P300/day",
    vehicleType: "motor",
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  },
  {
    id: "vans",
    title: "Vans",
    icon: Van,
    image: "/van.png",
    tags: ["Passenger", "Mini Van", "Cargo", "Luxury"],
<<<<<<< HEAD
    description: "Spacious and reliable for group trips and transport runs.",
    price: "P1,500/day",
    vehicleType: "van",
=======
<<<<<<< HEAD
    description: "Spacious rides designed for all your plans and occasions.",
    price: "₱1,500/day",
=======
    description: "Spacious and reliable for group trips and transport runs.",
    price: "P1,500/day",
    vehicleType: "van",
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  },
  {
    id: "trucks",
    title: "Trucks",
    icon: Truck,
    image: "/trucks.png",
<<<<<<< HEAD
    tags: ["Pick-up", "Cargo", "Refrigerated", "Flat Bed"],
    description: "Built for heavy-duty tasks and dependable hauling.",
    price: "P2,000/day",
    vehicleType: "truck",
  },
];

=======
<<<<<<< HEAD
    tags: ["Pick-up", "Cargo", "Refrigerated", "Flat bed"],
    description: "Built for work, designed to carry cargo safely and comfortably.",
    price: "₱2,000/day",
  },
];

{/* BASTA FEATURED TO */}
=======
    tags: ["Pick-up", "Cargo", "Refrigerated", "Flat Bed"],
    description: "Built for heavy-duty tasks and dependable hauling.",
    price: "P2,000/day",
    vehicleType: "truck",
  },
];

>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
const featuredVehicles = [
  {
    id: 1,
    name: "BMW X5",
    location: "Dagupan City, Pangasinan",
    image: "/bmw-x5.png",
<<<<<<< HEAD
    category: "BMW - SUV",
=======
<<<<<<< HEAD
    type: "car",
    subType: "SUV",
    category: "BMW • SUV",
=======
    category: "BMW - SUV",
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    seats: 7,
    transmission: "Automatic",
    fuel: "Gasoline",
    price: 5500,
    rating: 4.8,
    available: true,
    codingDay: "Wednesday",
<<<<<<< HEAD
=======
<<<<<<< HEAD

    owner: {
      name: "Anya Forger",
      avatar: "/owner-profile.png",
      verified: true,
      rating: 4.8,
      rentals: 204,
      vehicles: 40,
    }
    
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  },
  {
    id: 2,
    name: "Yamaha R3",
    location: "Lingayen, Pangasinan",
    image: "/yamaha-r3.png",
<<<<<<< HEAD
    category: "Yamaha - Sport",
=======
<<<<<<< HEAD
    type: "motor",
    subType: "Sport",
    category: "Yamaha • Sport",
=======
    category: "Yamaha - Sport",
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    seats: 2,
    transmission: "Manual",
    fuel: "Gasoline",
    price: 1200,
    rating: 4.6,
    available: true,
    codingDay: "Thursday",
<<<<<<< HEAD
  },
=======
<<<<<<< HEAD

    owner: {
      name: "Anya Forger",
      avatar: "/owner-profile.png",
      verified: true,
      rating: 4.8,
      rentals: 204,
      vehicles: 40,
      
    }
    
  },

=======
  },
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  {
    id: 3,
    name: "Toyota HiAce",
    location: "San Carlos City, Pangasinan",
    image: "/toyota-hiAce.png",
<<<<<<< HEAD
    category: "Toyota - Van",
=======
<<<<<<< HEAD
    type: "van",
    subType: "Passenger",
    category: "Toyota • Van",
=======
    category: "Toyota - Van",
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    seats: 12,
    transmission: "Manual",
    fuel: "Diesel",
    price: 4800,
    rating: 4.7,
    available: true,
    codingDay: "Saturday",
<<<<<<< HEAD
=======
<<<<<<< HEAD

    owner: {
      name: "Anya Forger",
      avatar: "/owner-profile.png",
      verified: true,
      rating: 4.8,
      rentals: 204,
      vehicles: 40,
    }
>>>>>>> 8422a2f (fixed bugs and updates)
  },
];

const featureItems = [
  {
    icon: Sparkles,
    title: "AI-Powered Suggestions",
    description: "Get smarter recommendations based on your preferred routes and vehicle types.",
  },
  {
    icon: Shield,
    title: "Secure Booking Flow",
    description: "Transparent booking updates with secure data handling for every reservation.",
  },
  {
    icon: Radio,
    title: "Fast Online Rentals",
    description: "Compare, reserve, and confirm vehicles in minutes with a clean booking process.",
  },
];

const aboutValues = [
  {
    title: "Quality Vehicles",
    description: "All vehicles are inspected and maintained for safety and reliability.",
    icon: Wrench,
  },
  {
    title: "Customer Experience",
    description: "Simple booking flow and responsive support across every trip stage.",
    icon: Users,
  },
  {
    title: "Trust & Transparency",
    description: "Clear rates, honest policies, and transparent booking updates.",
    icon: ShieldCheck,
  },
];

const locations = [
  "Urdaneta City, Pangasinan",
  "Dagupan City, Pangasinan",
  "Calasiao, Pangasinan",
  "Lingayen, Pangasinan",
  "Mangaldan, Pangasinan",
  "University of Pangasinan",
  "San Carlos City, Pangasinan",
  "Sta Barbara, Pangasinan",
  "SM Dagupan",
  "Robinsons Place Pangasinan",
];

const formatCoding = (day) => (day ? `Coding every ${day}` : "");

const mapSearchPayload = (
  location,
  vehicleType,
  pickupDate,
  pickupTime,
  returnDate,
  returnTime
) => ({
  location,
  vehicleType,
  pickupDate,
  pickupTime,
  returnDate,
  returnTime,
});

export default function RentifyPro({
  onNavigateToHome,
  onNavigateToSignIn,
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
  isLoggedIn,
  user,
  onLogout,
}) {
  const [location, setLocation] = useState("");
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [vehicleType, setVehicleType] = useState("");
  const [showAI, setShowAI] = useState(false);
  const [validationModalMessage, setValidationModalMessage] = useState("");
  const [pickupDate, setPickupDate] = useState(() => getTodayDate());
  const [pickupTime, setPickupTime] = useState(() => getCurrentTime());
  const [returnDate, setReturnDate] = useState(() => getTomorrowDate());
  const [returnTime, setReturnTime] = useState(() => getCurrentTime());

  useEffect(() => {
    if (returnDate <= pickupDate) {
      const nextDay = new Date(`${pickupDate}T00:00:00`);
      nextDay.setDate(nextDay.getDate() + 1);
      setReturnDate(formatDateInput(nextDay));
    }
  }, [pickupDate, returnDate]);

  useEffect(() => {
    const today = getTodayDate();
    const now = getCurrentTime();
    if (pickupDate === today && pickupTime < now) {
      setPickupTime(now);
    }
  }, [pickupDate, pickupTime]);

  const filteredLocations = useMemo(
    () =>
      locations.filter((entry) =>
        entry.toLowerCase().includes(location.trim().toLowerCase())
      ),
    [location]
  );

  const isValidDateTime = () => {
    const now = new Date();
    now.setSeconds(0, 0);

    const pickup = getDateTime(pickupDate, pickupTime);
    const dropoff = getDateTime(returnDate, returnTime);

    if (!pickup || !dropoff) return false;
    if (pickup < now) return false;
    if (dropoff <= pickup) return false;
    return true;
  };

  const handleSearch = (typeOverride = vehicleType) => {
    if (!isValidDateTime()) {
      setValidationModalMessage("Pickup must be in the future and return must be after pickup.");
      return;
    }

    onSearch(
      mapSearchPayload(location, typeOverride, pickupDate, pickupTime, returnDate, returnTime)
    );
  };

  return (
    <div id="home" className="min-h-screen">
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
        onNavigateToSignIn={onNavigateToSignIn}
        onNavigateToRegister={onNavigateToRegister}
        onNavigateToAccountSettings={onNavigateToAccountSettings}
        onShowAI={() => setShowAI(true)}
        onLogout={onLogout}
      />

      <section className="relative pt-28 sm:pt-36 pb-28 overflow-hidden">
        <img
          src="/hero-car1.png"
          alt="RentifyPro Hero"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#020617]/80 via-[#0f172a]/60 to-[#0B75E7]/50" />

        <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8">
          <div className="max-w-3xl rp-animate-fade-up">
            <span className="rp-chip bg-white/18 text-white border border-white/30">
              Premium Mobility Marketplace
            </span>
            <h1 className="text-white mt-5 text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight">
              Rent Smarter.
              <br />
              Drive Better.
            </h1>
            <p className="text-blue-100 mt-5 max-w-2xl text-base sm:text-lg">
              Discover cars, motorcycles, vans, and trucks with a modern booking experience built
              for convenience and confidence.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button onClick={onNavigateToVehicles} className="rp-btn-primary px-6 py-3 text-sm sm:text-base">
                Browse Vehicles
              </button>
              <button onClick={onNavigateToAbout} className="rp-btn-secondary px-6 py-3 text-sm sm:text-base">
                Learn More
              </button>
            </div>
          </div>

        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 -mt-16 sm:-mt-20 relative z-20">
        <div className="rp-surface p-5 sm:p-7">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4">
            <div className="sm:col-span-2 relative">
              <label className="text-xs font-semibold text-slate-500">Location</label>
              <div className="relative mt-1.5">
                <MapPin
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0B75E7]"
                />
                <input
                  value={location}
                  onChange={(event) => {
                    setLocation(event.target.value);
                    setShowLocationSuggestions(true);
                  }}
                  onFocus={() => setShowLocationSuggestions(true)}
                  onBlur={() => {
                    window.setTimeout(() => setShowLocationSuggestions(false), 120);
                  }}
                  className="rp-input pr-9"
                  placeholder="Search location"
                />
              </div>

              {showLocationSuggestions && location && filteredLocations.length > 0 && (
                <div className="absolute left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-30 max-h-56 overflow-y-auto">
                  {filteredLocations.map((entry) => (
                    <button
                      key={entry}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setLocation(entry);
                        setShowLocationSuggestions(false);
                      }}
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#0B75E7]/10 flex items-center gap-2"
                    >
                      <MapPin size={14} className="text-[#0B75E7]" />
                      {entry}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500">Vehicle Type</label>
              <select
                className="rp-input mt-1.5"
                value={vehicleType}
<<<<<<< HEAD
                onChange={(event) => setVehicleType(event.target.value)}
=======
                onChange={(e) => setVehicleType(e.target.value)}
=======
  },
];

const featureItems = [
  {
    icon: Sparkles,
    title: "AI-Powered Suggestions",
    description: "Get smarter recommendations based on your preferred routes and vehicle types.",
  },
  {
    icon: Shield,
    title: "Secure Booking Flow",
    description: "Transparent booking updates with secure data handling for every reservation.",
  },
  {
    icon: Radio,
    title: "Fast Online Rentals",
    description: "Compare, reserve, and confirm vehicles in minutes with a clean booking process.",
  },
];

const aboutValues = [
  {
    title: "Quality Vehicles",
    description: "All vehicles are inspected and maintained for safety and reliability.",
    icon: Wrench,
  },
  {
    title: "Customer Experience",
    description: "Simple booking flow and responsive support across every trip stage.",
    icon: Users,
  },
  {
    title: "Trust & Transparency",
    description: "Clear rates, honest policies, and transparent booking updates.",
    icon: ShieldCheck,
  },
];

const locations = [
  "Urdaneta City, Pangasinan",
  "Dagupan City, Pangasinan",
  "Calasiao, Pangasinan",
  "Lingayen, Pangasinan",
  "Mangaldan, Pangasinan",
  "University of Pangasinan",
  "San Carlos City, Pangasinan",
  "Sta Barbara, Pangasinan",
  "SM Dagupan",
  "Robinsons Place Pangasinan",
];

const formatCoding = (day) => (day ? `Coding every ${day}` : "");

const mapSearchPayload = (
  location,
  vehicleType,
  pickupDate,
  pickupTime,
  returnDate,
  returnTime
) => ({
  location,
  vehicleType,
  pickupDate,
  pickupTime,
  returnDate,
  returnTime,
});

export default function RentifyPro({
  onNavigateToHome,
  onNavigateToSignIn,
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
  isLoggedIn,
  user,
  onLogout,
}) {
  const [location, setLocation] = useState("");
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [vehicleType, setVehicleType] = useState("");
  const [showAI, setShowAI] = useState(false);
  const [validationModalMessage, setValidationModalMessage] = useState("");
  const [pickupDate, setPickupDate] = useState(() => getTodayDate());
  const [pickupTime, setPickupTime] = useState(() => getCurrentTime());
  const [returnDate, setReturnDate] = useState(() => getTomorrowDate());
  const [returnTime, setReturnTime] = useState(() => getCurrentTime());

  useEffect(() => {
    if (returnDate <= pickupDate) {
      const nextDay = new Date(`${pickupDate}T00:00:00`);
      nextDay.setDate(nextDay.getDate() + 1);
      setReturnDate(formatDateInput(nextDay));
    }
  }, [pickupDate, returnDate]);

  useEffect(() => {
    const today = getTodayDate();
    const now = getCurrentTime();
    if (pickupDate === today && pickupTime < now) {
      setPickupTime(now);
    }
  }, [pickupDate, pickupTime]);

  const filteredLocations = useMemo(
    () =>
      locations.filter((entry) =>
        entry.toLowerCase().includes(location.trim().toLowerCase())
      ),
    [location]
  );

  const isValidDateTime = () => {
    const now = new Date();
    now.setSeconds(0, 0);

    const pickup = getDateTime(pickupDate, pickupTime);
    const dropoff = getDateTime(returnDate, returnTime);

    if (!pickup || !dropoff) return false;
    if (pickup < now) return false;
    if (dropoff <= pickup) return false;
    return true;
  };

  const handleSearch = (typeOverride = vehicleType) => {
    if (!isValidDateTime()) {
      setValidationModalMessage("Pickup must be in the future and return must be after pickup.");
      return;
    }

    onSearch(
      mapSearchPayload(location, typeOverride, pickupDate, pickupTime, returnDate, returnTime)
    );
  };

  return (
    <div id="home" className="min-h-screen">
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
        onNavigateToSignIn={onNavigateToSignIn}
        onNavigateToRegister={onNavigateToRegister}
        onNavigateToAccountSettings={onNavigateToAccountSettings}
        onShowAI={() => setShowAI(true)}
        onLogout={onLogout}
      />

      <section className="relative pt-28 sm:pt-36 pb-28 overflow-hidden">
        <img
          src="/hero-car1.png"
          alt="RentifyPro Hero"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#020617]/80 via-[#0f172a]/60 to-[#0B75E7]/50" />

        <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8">
          <div className="max-w-3xl rp-animate-fade-up">
            <span className="rp-chip bg-white/18 text-white border border-white/30">
              Premium Mobility Marketplace
            </span>
            <h1 className="text-white mt-5 text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight">
              Rent Smarter.
              <br />
              Drive Better.
            </h1>
            <p className="text-blue-100 mt-5 max-w-2xl text-base sm:text-lg">
              Discover cars, motorcycles, vans, and trucks with a modern booking experience built
              for convenience and confidence.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button onClick={onNavigateToVehicles} className="rp-btn-primary px-6 py-3 text-sm sm:text-base">
                Browse Vehicles
              </button>
              <button onClick={onNavigateToAbout} className="rp-btn-secondary px-6 py-3 text-sm sm:text-base">
                Learn More
              </button>
            </div>
          </div>

        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 -mt-16 sm:-mt-20 relative z-20">
        <div className="rp-surface p-5 sm:p-7">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4">
            <div className="sm:col-span-2 relative">
              <label className="text-xs font-semibold text-slate-500">Location</label>
              <div className="relative mt-1.5">
                <MapPin
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0B75E7]"
                />
                <input
                  value={location}
                  onChange={(event) => {
                    setLocation(event.target.value);
                    setShowLocationSuggestions(true);
                  }}
                  onFocus={() => setShowLocationSuggestions(true)}
                  onBlur={() => {
                    window.setTimeout(() => setShowLocationSuggestions(false), 120);
                  }}
                  className="rp-input pr-9"
                  placeholder="Search location"
                />
              </div>

              {showLocationSuggestions && location && filteredLocations.length > 0 && (
                <div className="absolute left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-30 max-h-56 overflow-y-auto">
                  {filteredLocations.map((entry) => (
                    <button
                      key={entry}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setLocation(entry);
                        setShowLocationSuggestions(false);
                      }}
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#0B75E7]/10 flex items-center gap-2"
                    >
                      <MapPin size={14} className="text-[#0B75E7]" />
                      {entry}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500">Vehicle Type</label>
              <select
                className="rp-input mt-1.5"
                value={vehicleType}
                onChange={(event) => setVehicleType(event.target.value)}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
              >
                <option value="">Select type</option>
                <option value="car">Car</option>
                <option value="motor">Motorcycle</option>
                <option value="van">Van</option>
                <option value="truck">Truck</option>
              </select>
            </div>

<<<<<<< HEAD
=======
<<<<<<< HEAD

>>>>>>> 8422a2f (fixed bugs and updates)
            <div>
              <label className="text-xs font-semibold text-slate-500">Pick-up Date</label>
              <input
                type="date"
                min={getTodayDate()}
                value={pickupDate}
                onChange={(event) => setPickupDate(event.target.value)}
                className="rp-input mt-1.5"
              />
            </div>

            <div>
<<<<<<< HEAD
              <label className="text-xs font-semibold text-slate-500">Pick-up Time</label>
=======
              <label className="block text-[#017FE6] font-semibold mb-2">Pick-up Time</label>
=======
            <div>
              <label className="text-xs font-semibold text-slate-500">Pick-up Date</label>
              <input
                type="date"
                min={getTodayDate()}
                value={pickupDate}
                onChange={(event) => setPickupDate(event.target.value)}
                className="rp-input mt-1.5"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500">Pick-up Time</label>
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
              <input
                type="time"
                value={pickupTime}
                min={pickupDate === getTodayDate() ? getCurrentTime() : undefined}
<<<<<<< HEAD
                onChange={(event) => setPickupTime(event.target.value)}
                className="rp-input mt-1.5"
=======
<<<<<<< HEAD
                onChange={(e) => setPickupTime(e.target.value)}
                className="
                    w-full h-[52px]
                    border border-gray-300 rounded-lg
                    px-4
                    text-sm
                    leading-[52px]
                    focus:outline-none focus:ring-2 focus:ring-[#017FE6]
                  "
                />

            </div>
            <div>
              <label className="block text-[#017FE6] font-semibold mb-2">Return Date</label>
              <input
                type="date"
                value={returnDate}
                min={(() => {
    const d = new Date(pickupDate);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  })()}
                onChange={(e) => setReturnDate(e.target.value)}
              className="
                  w-full h-[52px]
                  border border-gray-300 rounded-lg
                  px-4
                  text-sm
                  leading-[52px]
                  focus:outline-none focus:ring-2 focus:ring-[#017FE6]
                "
>>>>>>> 8422a2f (fixed bugs and updates)
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500">Return Date</label>
              <input
                  type="date"
                  value={returnDate}
                  min={(() => {
                    const date = new Date(`${pickupDate}T00:00:00`);
                    date.setDate(date.getDate() + 1);
                    return formatDateInput(date);
                  })()}
                  onChange={(event) => setReturnDate(event.target.value)}
                  className="rp-input mt-1.5"
                />
            </div>
          </div>

          <div className="mt-5 flex justify-center">
            <button
              onClick={() => handleSearch()}
              className="rp-btn-primary px-8 py-3 text-sm sm:text-base flex items-center gap-2"
            >
              <Search size={18} />
              Search Available Vehicles
            </button>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold">
            Select Your <span className="text-[#0B75E7]">Vehicle Category</span>
          </h2>
          <p className="text-slate-600 mt-3">
            Filter fast and jump directly into the right vehicle type for your next trip.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => handleSearch(category.vehicleType)}
              className="rp-surface rp-hover-lift overflow-hidden text-left"
            >
              <div className="h-52 bg-slate-100">
                <img
                  src={category.image}
                  alt={category.title}
                  className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                />
              </div>
              <div className="p-5">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <category.icon className="w-5 h-5 text-[#0B75E7]" />
                  {category.title}
                </h3>
                <div className="flex flex-wrap gap-2 mt-3">
                  {category.tags.map((tag) => (
                    <span key={tag} className="rp-chip bg-[#0B75E7]/10 text-[#0B75E7]">
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="text-sm text-slate-600 mt-3">{category.description}</p>
                <p className="text-[#0B75E7] font-bold mt-4">Starting from {category.price}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="py-16 sm:py-20 bg-slate-100/70">
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <h2 className="text-3xl sm:text-4xl font-bold mb-10">
            <span className="text-[#0B75E7]">Featured</span> Vehicles
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {featuredVehicles.map((vehicle) => (
              <article key={vehicle.id} className="rp-surface rp-hover-lift overflow-hidden">
                <div className="relative h-52 bg-slate-100">
                  <img src={vehicle.image} alt={vehicle.name} className="w-full h-full object-contain p-4" />
                  {vehicle.available && (
                    <span className="absolute top-3 left-3 rp-chip bg-emerald-100 text-emerald-700">
                      Available
                    </span>
                  )}
                  <span className="absolute top-3 right-3 rp-chip bg-slate-900 text-white">
                    {vehicle.rating}
                  </span>
                </div>

                <div className="p-5">
                  <h3 className="text-xl font-bold">{vehicle.name}</h3>
                  <p className="text-sm text-slate-500">{vehicle.category}</p>

                  <div className="flex items-center gap-1 mt-2 text-sm text-slate-600">
                    <MapPin size={14} className="text-[#0B75E7]" />
                    {vehicle.location}
                  </div>

                  <div className="mt-2">
                    <span className="rp-chip bg-slate-100 text-slate-600">
                      {formatCoding(vehicle.codingDay)}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 mt-4 text-sm text-slate-600">
                    <span className="flex items-center gap-1">
                      <Users size={14} className="text-[#0B75E7]" />
                      {vehicle.seats} seats
                    </span>
                    <span className="flex items-center gap-1">
                      <Settings size={14} className="text-[#0B75E7]" />
                      {vehicle.transmission}
                    </span>
                    <span className="flex items-center gap-1">
<<<<<<< HEAD
                      <Fuel size={14} className="text-[#0B75E7]" />
=======
                      <Fuel size={16} className="text-[#017FE6]" />
=======
                onChange={(event) => setPickupTime(event.target.value)}
                className="rp-input mt-1.5"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500">Return Date</label>
              <input
                  type="date"
                  value={returnDate}
                  min={(() => {
                    const date = new Date(`${pickupDate}T00:00:00`);
                    date.setDate(date.getDate() + 1);
                    return formatDateInput(date);
                  })()}
                  onChange={(event) => setReturnDate(event.target.value)}
                  className="rp-input mt-1.5"
                />
            </div>
          </div>

          <div className="mt-5 flex justify-center">
            <button
              onClick={() => handleSearch()}
              className="rp-btn-primary px-8 py-3 text-sm sm:text-base flex items-center gap-2"
            >
              <Search size={18} />
              Search Available Vehicles
            </button>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold">
            Select Your <span className="text-[#0B75E7]">Vehicle Category</span>
          </h2>
          <p className="text-slate-600 mt-3">
            Filter fast and jump directly into the right vehicle type for your next trip.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => handleSearch(category.vehicleType)}
              className="rp-surface rp-hover-lift overflow-hidden text-left"
            >
              <div className="h-52 bg-slate-100">
                <img
                  src={category.image}
                  alt={category.title}
                  className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                />
              </div>
              <div className="p-5">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <category.icon className="w-5 h-5 text-[#0B75E7]" />
                  {category.title}
                </h3>
                <div className="flex flex-wrap gap-2 mt-3">
                  {category.tags.map((tag) => (
                    <span key={tag} className="rp-chip bg-[#0B75E7]/10 text-[#0B75E7]">
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="text-sm text-slate-600 mt-3">{category.description}</p>
                <p className="text-[#0B75E7] font-bold mt-4">Starting from {category.price}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="py-16 sm:py-20 bg-slate-100/70">
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <h2 className="text-3xl sm:text-4xl font-bold mb-10">
            <span className="text-[#0B75E7]">Featured</span> Vehicles
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {featuredVehicles.map((vehicle) => (
              <article key={vehicle.id} className="rp-surface rp-hover-lift overflow-hidden">
                <div className="relative h-52 bg-slate-100">
                  <img src={vehicle.image} alt={vehicle.name} className="w-full h-full object-contain p-4" />
                  {vehicle.available && (
                    <span className="absolute top-3 left-3 rp-chip bg-emerald-100 text-emerald-700">
                      Available
                    </span>
                  )}
                  <span className="absolute top-3 right-3 rp-chip bg-slate-900 text-white">
                    {vehicle.rating}
                  </span>
                </div>

                <div className="p-5">
                  <h3 className="text-xl font-bold">{vehicle.name}</h3>
                  <p className="text-sm text-slate-500">{vehicle.category}</p>

                  <div className="flex items-center gap-1 mt-2 text-sm text-slate-600">
                    <MapPin size={14} className="text-[#0B75E7]" />
                    {vehicle.location}
                  </div>

                  <div className="mt-2">
                    <span className="rp-chip bg-slate-100 text-slate-600">
                      {formatCoding(vehicle.codingDay)}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 mt-4 text-sm text-slate-600">
                    <span className="flex items-center gap-1">
                      <Users size={14} className="text-[#0B75E7]" />
                      {vehicle.seats} seats
                    </span>
                    <span className="flex items-center gap-1">
                      <Settings size={14} className="text-[#0B75E7]" />
                      {vehicle.transmission}
                    </span>
                    <span className="flex items-center gap-1">
                      <Fuel size={14} className="text-[#0B75E7]" />
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
                      {vehicle.fuel}
                    </span>
                  </div>

<<<<<<< HEAD
                  <p className="text-[#0B75E7] text-2xl font-bold mt-4">
                    P{vehicle.price.toLocaleString()}
                    <span className="text-sm text-slate-500 font-medium"> / day</span>
                  </p>
=======
<<<<<<< HEAD
>>>>>>> 8422a2f (fixed bugs and updates)

                  <div className="mt-4">
                    <button
                      onClick={() => (isLoggedIn ? onViewDetails(vehicle) : onNavigateToSignIn())}
                      className="rp-btn-primary py-2 text-sm w-full"
                    >
                      Book Now
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="scroll-mt-28 max-w-7xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold">
            About <span className="text-[#0B75E7]">RentifyPro</span>
          </h2>
          <p className="text-slate-600 mt-3">
            Your trusted partner for vehicle rentals in the Philippines.
          </p>
        </div>

        <article className="rp-surface p-6 sm:p-8 mb-8">
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {aboutValues.map((item) => (
            <article key={item.title} className="rp-surface rp-hover-lift p-6 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#0B75E7]/10 text-[#0B75E7] flex items-center justify-center">
                <item.icon size={24} />
              </div>
              <h3 className="mt-4 text-lg font-bold">{item.title}</h3>
              <p className="text-sm text-slate-600 mt-2">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-5 sm:px-8 pb-16 sm:pb-20">
        <h2 className="text-3xl sm:text-4xl font-bold text-center mb-10">
          Why Choose <span className="text-[#0B75E7]">RentifyPro</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {featureItems.map((item) => (
            <article key={item.title} className="rp-surface rp-hover-lift p-6 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#0B75E7]/10 text-[#0B75E7] flex items-center justify-center">
                <item.icon size={24} />
              </div>
              <h3 className="mt-4 text-lg font-bold">{item.title}</h3>
              <p className="text-sm text-slate-600 mt-2">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer
        id="contacts"
        className="bg-gradient-to-r from-[#045FC3] to-[#0B75E7] text-white py-14 mt-8"
      >
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <h3 className="text-2xl font-bold">RentifyPro</h3>
              <p className="text-blue-100 mt-3 text-sm">
                Your trusted partner for vehicle rentals in the Philippines.
              </p>
            </div>

            <div>
<<<<<<< HEAD
=======
              <h4 className="font-bold mb-4">Vehicle Categories</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-blue-100 hover:text-white">Cars</a></li>
                <li><a href="#" className="text-blue-100 hover:text-white">Motorcycles</a></li>
                <li><a href="#" className="text-blue-100 hover:text-white">Vans</a></li>
                <li><a href="#" className="text-blue-100 hover:text-white">Trucks</a></li>
=======
                  <p className="text-[#0B75E7] text-2xl font-bold mt-4">
                    P{vehicle.price.toLocaleString()}
                    <span className="text-sm text-slate-500 font-medium"> / day</span>
                  </p>

                  <div className="mt-4">
                    <button
                      onClick={() => (isLoggedIn ? onViewDetails(vehicle) : onNavigateToSignIn())}
                      className="rp-btn-primary py-2 text-sm w-full"
                    >
                      Book Now
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="scroll-mt-28 max-w-7xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold">
            About <span className="text-[#0B75E7]">RentifyPro</span>
          </h2>
          <p className="text-slate-600 mt-3">
            Your trusted partner for vehicle rentals in the Philippines.
          </p>
        </div>

        <article className="rp-surface p-6 sm:p-8 mb-8">
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {aboutValues.map((item) => (
            <article key={item.title} className="rp-surface rp-hover-lift p-6 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#0B75E7]/10 text-[#0B75E7] flex items-center justify-center">
                <item.icon size={24} />
              </div>
              <h3 className="mt-4 text-lg font-bold">{item.title}</h3>
              <p className="text-sm text-slate-600 mt-2">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-5 sm:px-8 pb-16 sm:pb-20">
        <h2 className="text-3xl sm:text-4xl font-bold text-center mb-10">
          Why Choose <span className="text-[#0B75E7]">RentifyPro</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {featureItems.map((item) => (
            <article key={item.title} className="rp-surface rp-hover-lift p-6 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#0B75E7]/10 text-[#0B75E7] flex items-center justify-center">
                <item.icon size={24} />
              </div>
              <h3 className="mt-4 text-lg font-bold">{item.title}</h3>
              <p className="text-sm text-slate-600 mt-2">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer
        id="contacts"
        className="bg-gradient-to-r from-[#045FC3] to-[#0B75E7] text-white py-14 mt-8"
      >
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <h3 className="text-2xl font-bold">RentifyPro</h3>
              <p className="text-blue-100 mt-3 text-sm">
                Your trusted partner for vehicle rentals in the Philippines.
              </p>
            </div>

            <div>
>>>>>>> 8422a2f (fixed bugs and updates)
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
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
              </ul>
            </div>

            <div>
<<<<<<< HEAD
              <h4 className="font-bold mb-3">Vehicle Categories</h4>
              <ul className="space-y-2 text-blue-100 text-sm">
                <li>Cars</li>
                <li>Motorcycles</li>
                <li>Vans</li>
                <li>Trucks</li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold mb-3">Contact</h4>
              <ul className="space-y-2 text-blue-100 text-sm">
                <li>+63 912 324 5678</li>
                <li>message@rentifypro.com</li>
                <li>Dagupan, Pangasinan</li>
=======
<<<<<<< HEAD
              <h4 className="font-bold mb-4">Contacts</h4>
              <ul className="space-y-2 text-blue-100">
                <li>+63 912 324 5678</li>
                <li>message@rentifypro.com</li>
                <li>Dagupan, Pangasinan,</li>
=======
              <h4 className="font-bold mb-3">Vehicle Categories</h4>
              <ul className="space-y-2 text-blue-100 text-sm">
                <li>Cars</li>
                <li>Motorcycles</li>
                <li>Vans</li>
                <li>Trucks</li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold mb-3">Contact</h4>
              <ul className="space-y-2 text-blue-100 text-sm">
                <li>+63 912 324 5678</li>
                <li>message@rentifypro.com</li>
                <li>Dagupan, Pangasinan</li>
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
                <li>Philippines</li>
              </ul>
            </div>
          </div>

<<<<<<< HEAD
=======
<<<<<<< HEAD
          <div className="border-t border-blue-500 mt-8 pt-8 flex flex-col md:flex-row justify-between items-center">
            <p className="text-blue-100">© 2026 RentifyPro. All rights reserved</p>
            <div className="flex space-x-6 mt-4 md:mt-0">
              <a href="#" className="text-blue-100 hover:text-white">Privacy Policy</a>
              <a href="#" className="text-blue-100 hover:text-white">Terms and Condition</a>
=======
>>>>>>> 8422a2f (fixed bugs and updates)
          <div className="border-t border-blue-400/50 mt-10 pt-5 flex flex-col sm:flex-row items-center justify-between text-blue-100 text-sm gap-2">
            <p>Copyright 2026 RentifyPro. All rights reserved.</p>
            <div className="flex gap-5">
              <button>Privacy Policy</button>
              <button>Terms and Conditions</button>
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
            </div>
          </div>
        </div>
      </footer>

<<<<<<< HEAD
      <ChatWidget isOpen={showAI} onClose={() => setShowAI(false)} />
      <InfoModal
        isOpen={Boolean(validationModalMessage)}
        title="RentifyPro says"
        message={validationModalMessage}
        onClose={() => setValidationModalMessage("")}
=======
<<<<<<< HEAD
      {showAI && (
        <div className="
          fixed bottom-4 right-4
          w-[95vw] sm:w-[400px]
          h-[70vh] sm:h-[450px]
          bg-white rounded-2xl shadow-2xl
          z-50 overflow-hidden
          flex flex-col
        ">

          {/* HEADER */}
          <div className="bg-[#017FE6] text-white px-4 py-3 flex justify-between items-center">
            <div>
              <h3 className="font-semibold text-sm">RentifyPro AI</h3>
              <p className="text-xs opacity-80">Online • Ready to help</p>
            </div>
            <button onClick={() => setShowAI(false)}>✕</button>
          </div>

          {/* BODY */}
          <div className="p-4 flex-1 overflow-y-auto bg-gray-50 space-y-4">


      {messages.map((msg, index) => (
        <div
          key={index}
          className={`flex items-end gap-2 ${
            msg.sender === "user" ? "justify-end" : "justify-start"
          }`}
        >
          {msg.sender === "ai" && (
            <img src="/robot-ai.png" className="w-8 h-8 rounded-full" />
          )}

          <div
            className={`px-4 py-2 rounded-2xl text-sm max-w-[75%] shadow ${
              msg.sender === "user"
                ? "bg-[#017FE6] text-white rounded-br-sm"
                : "bg-white text-gray-800 rounded-bl-sm"
            }`}
          >
            {msg.text}
          </div>

          {msg.sender === "user" && (
            <div className="w-8 h-8 rounded-full bg-[#017FE6] text-white flex items-center justify-center text-xs">
              U
            </div>
          )}
        </div>
      ))}

      {isTyping && (
        <div className="flex items-center gap-2">
          <img src="/robot-ai.png" className="w-8 h-8 rounded-full" />
          <div className="bg-white px-4 py-2 rounded-2xl shadow text-sm text-gray-500 flex gap-1">
            <span className="animate-bounce">.</span>
            <span className="animate-bounce delay-150">.</span>
            <span className="animate-bounce delay-300">.</span>
          </div>
        </div>
      )}
    </div>

    {/* INPUT */}
    <div className="border-t bg-white px-3 py-2 flex items-center gap-2">
      <input
        value={userMessage}
        onChange={(e) => setUserMessage(e.target.value)}
        placeholder="Ask me about vehicles, bookings..."
        className="flex-1 border rounded-full px-4 py-2 text-sm focus:ring-2 focus:ring-[#017FE6]"
>>>>>>> 8422a2f (fixed bugs and updates)
      />
    </div>
  );
<<<<<<< HEAD
}
=======
};

export default RentifyPro;
=======
      <ChatWidget isOpen={showAI} onClose={() => setShowAI(false)} />
      <InfoModal
        isOpen={Boolean(validationModalMessage)}
        title="RentifyPro says"
        message={validationModalMessage}
        onClose={() => setValidationModalMessage("")}
      />
    </div>
  );
}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
