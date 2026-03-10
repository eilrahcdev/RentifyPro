<<<<<<< HEAD
import React, { useEffect, useRef, useState } from "react";
import { getCurrentTime, getTodayDate, getTomorrowDate } from "./utils/dateUtils";

// Main pages
=======
<<<<<<< HEAD
import React, { useEffect, useState } from "react";

// USER PAGES (inside src/pages)
=======
import React, { useEffect, useRef, useState } from "react";
import { getCurrentTime, getTodayDate, getTomorrowDate } from "./utils/dateUtils";

// Main pages
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
import RentifyPro from "./pages/RentifyPro";
import SignInPage from "./components/SignInPage";
import VehiclesPage from "./pages/VehiclesPage";
import VehicleDetailsPage from "./pages/VehicleDetailsPage";
<<<<<<< HEAD
import BookingsPage from "./pages/BookingsPage";
import RealtimeChatPage from "./pages/RealtimeChatPage";
import NotificationsPage from "./pages/NotificationsPage";
=======
<<<<<<< HEAD
import AboutPage from "./pages/AboutPage";
=======
import BookingsPage from "./pages/BookingsPage";
import RealtimeChatPage from "./pages/RealtimeChatPage";
import NotificationsPage from "./pages/NotificationsPage";
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
import AccountSettings from "./pages/AccountSettings";
import ProceedVehicleOwner from "./pages/ProceedVehicleOwner";
import VehicleOwnerVerification from "./pages/VehicleOwnerVerification";

<<<<<<< HEAD
// Registration pages
=======
<<<<<<< HEAD
// REGISTER PAGES (inside src/components in your screenshot)
>>>>>>> 8422a2f (fixed bugs and updates)
import RegisterPage from "./components/RegisterPage";
import RegisterOwnerPage from "./pages/RegisterOwnerPage";

<<<<<<< HEAD
// Verification pages
=======
// VERIFICATION (make sure folder name matches exactly: verification vs Verification)
=======
// Registration pages
import RegisterPage from "./components/RegisterPage";
import RegisterOwnerPage from "./pages/RegisterOwnerPage";

// Verification pages
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
import RegisterOTP from "./verification/RegisterOTP";
import ForgotPasswordEmail from "./verification/ForgotPasswordEmail";
import ForgotPasswordOTP from "./verification/ForgotPasswordOTP";
import ResetPassword from "./verification/ResetPassword";

<<<<<<< HEAD
// Owner pages
=======
<<<<<<< HEAD
// OWNER UI (after moving into src/owner)
>>>>>>> 8422a2f (fixed bugs and updates)
import OwnerLayout from "./owner/OwnerLayout";

// Shared parts
import LogoutModal from "./components/LogoutModal";
import { disconnectSocket } from "./utils/socket";
import API from "./utils/api";

const ROUTE_TO_PAGE = {
  "/": "home",
  "/vehicles": "vehicles",
  "/about": "about",
  "/bookings": "booking-history",
  "/signin": "signin",
  "/register": "register",
  "/chat": "realtime-chat",
  "/notifications": "notifications",
  "/account-settings": "account-settings",
};

const PAGE_TO_ROUTE = Object.entries(ROUTE_TO_PAGE).reduce((map, [route, page]) => {
  map[page] = route;
  return map;
}, {});

const resolvePageFromPath = (pathname) => {
  const normalized = String(pathname || "/").toLowerCase();
  return ROUTE_TO_PAGE[normalized] || "home";
};

const getInitialsFromName = (name) => {
  const cleaned = String(name || "").trim();
  if (!cleaned) return "U";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) || "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) || "" : "";
  return `${first}${last}`.toUpperCase() || "U";
};

const PROFILE_PHOTO_KEY = "profilePhoto";
const PROFILE_PHOTO_USER_KEY = "profilePhotoUserId";
const getScopedProfilePhoto = (storedUser = {}) => {
  const photo = String(localStorage.getItem(PROFILE_PHOTO_KEY) || "").trim();
  if (!photo) return "";

  const owner = String(localStorage.getItem(PROFILE_PHOTO_USER_KEY) || "").trim();
  if (!owner) return photo;

  const userId = String(storedUser?._id || "").trim();
  const email = String(storedUser?.email || "").trim().toLowerCase();
  if (owner === userId) return photo;
  if (email && owner.toLowerCase() === email) return photo;
  return "";
};

const hydrateStoredUser = (storedUser = {}) => {
  if (!storedUser || typeof storedUser !== "object") return null;

  const displayName =
    String(storedUser.name || "").trim() ||
    String(storedUser.email || "").split("@")[0] ||
    "User";
  const profilePhoto = getScopedProfilePhoto(storedUser);
  const avatar = String(storedUser.avatar || profilePhoto || "").trim();

  return {
    ...storedUser,
    _id: storedUser._id,
    name: displayName,
    initials: String(storedUser.initials || "").trim() || getInitialsFromName(displayName),
    avatar,
  };
};

const App = () => {
  const getDefaultBookingData = () => {
    return {
      vehicleType: "",
      location: "",
      pickupDate: getTodayDate(),
      pickupTime: getCurrentTime(),
      returnDate: getTomorrowDate(),
      returnTime: getCurrentTime(),
    };
  };

  const [currentPage, setCurrentPage] = useState(() =>
    resolvePageFromPath(window.location.pathname)
  );
  const [bookingData, setBookingData] = useState(getDefaultBookingData());
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [pendingScrollTarget, setPendingScrollTarget] = useState("");

  const [registeredEmail, setRegisteredEmail] = useState("");
  const [registeredPhone, setRegisteredPhone] = useState("");
  const [registeredName, setRegisteredName] = useState("");
  const [registerRole, setRegisterRole] = useState("user");

  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotResetToken, setForgotResetToken] = useState("");

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isOwnerLoggedIn, setIsOwnerLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const attemptedAvatarBackfillByUserRef = useRef(new Set());

  // Logout modal state
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      setIsOwnerLoggedIn(false);
      localStorage.removeItem("isNewOwner");
    }
  }, []);

<<<<<<< HEAD
=======
  // Allow owner dashboard to switch back to user UI
=======
// Owner pages
import OwnerLayout from "./owner/OwnerLayout";

// Shared parts
import LogoutModal from "./components/LogoutModal";
import { disconnectSocket } from "./utils/socket";
import API from "./utils/api";

const ROUTE_TO_PAGE = {
  "/": "home",
  "/vehicles": "vehicles",
  "/about": "about",
  "/bookings": "booking-history",
  "/signin": "signin",
  "/register": "register",
  "/chat": "realtime-chat",
  "/notifications": "notifications",
  "/account-settings": "account-settings",
};

const PAGE_TO_ROUTE = Object.entries(ROUTE_TO_PAGE).reduce((map, [route, page]) => {
  map[page] = route;
  return map;
}, {});

const resolvePageFromPath = (pathname) => {
  const normalized = String(pathname || "/").toLowerCase();
  return ROUTE_TO_PAGE[normalized] || "home";
};

const getInitialsFromName = (name) => {
  const cleaned = String(name || "").trim();
  if (!cleaned) return "U";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) || "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) || "" : "";
  return `${first}${last}`.toUpperCase() || "U";
};

const PROFILE_PHOTO_KEY = "profilePhoto";
const PROFILE_PHOTO_USER_KEY = "profilePhotoUserId";
const getScopedProfilePhoto = (storedUser = {}) => {
  const photo = String(localStorage.getItem(PROFILE_PHOTO_KEY) || "").trim();
  if (!photo) return "";

  const owner = String(localStorage.getItem(PROFILE_PHOTO_USER_KEY) || "").trim();
  if (!owner) return photo;

  const userId = String(storedUser?._id || "").trim();
  const email = String(storedUser?.email || "").trim().toLowerCase();
  if (owner === userId) return photo;
  if (email && owner.toLowerCase() === email) return photo;
  return "";
};

const hydrateStoredUser = (storedUser = {}) => {
  if (!storedUser || typeof storedUser !== "object") return null;

  const displayName =
    String(storedUser.name || "").trim() ||
    String(storedUser.email || "").split("@")[0] ||
    "User";
  const profilePhoto = getScopedProfilePhoto(storedUser);
  const avatar = String(storedUser.avatar || profilePhoto || "").trim();

  return {
    ...storedUser,
    _id: storedUser._id,
    name: displayName,
    initials: String(storedUser.initials || "").trim() || getInitialsFromName(displayName),
    avatar,
  };
};

const App = () => {
  const getDefaultBookingData = () => {
    return {
      vehicleType: "",
      location: "",
      pickupDate: getTodayDate(),
      pickupTime: getCurrentTime(),
      returnDate: getTomorrowDate(),
      returnTime: getCurrentTime(),
    };
  };

  const [currentPage, setCurrentPage] = useState(() =>
    resolvePageFromPath(window.location.pathname)
  );
  const [bookingData, setBookingData] = useState(getDefaultBookingData());
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [pendingScrollTarget, setPendingScrollTarget] = useState("");

  const [registeredEmail, setRegisteredEmail] = useState("");
  const [registeredPhone, setRegisteredPhone] = useState("");
  const [registeredName, setRegisteredName] = useState("");
  const [registerRole, setRegisterRole] = useState("user");

  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotResetToken, setForgotResetToken] = useState("");

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isOwnerLoggedIn, setIsOwnerLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const attemptedAvatarBackfillByUserRef = useRef(new Set());

  // Logout modal state
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      setIsOwnerLoggedIn(false);
      localStorage.removeItem("isNewOwner");
    }
  }, []);

>>>>>>> 8422a2f (fixed bugs and updates)
  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    const storedUserRaw = localStorage.getItem("user");
    if (!storedToken || !storedUserRaw) return;

    try {
      const storedUser = JSON.parse(storedUserRaw);
      if (!storedUser || typeof storedUser !== "object") return;
      if (storedUser.isVerified !== true) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        return;
      }

      const hydratedUser = hydrateStoredUser(storedUser);

      setUser(hydratedUser);

      const isOwner = storedUser.role === "owner";
      const ownerMode = localStorage.getItem("isNewOwner") === "true";
      if (isOwner && ownerMode) {
        setIsOwnerLoggedIn(true);
        setIsLoggedIn(false);
        setCurrentPage("owner-dashboard");
      } else {
        setIsOwnerLoggedIn(false);
        setIsLoggedIn(true);
      }
    } catch {
      localStorage.removeItem("user");
    }
  }, []);

  useEffect(() => {
    const syncUserProfile = () => {
      const storedUserRaw = localStorage.getItem("user");
      if (!storedUserRaw) return;

      try {
        const storedUser = JSON.parse(storedUserRaw);
        const hydrated = hydrateStoredUser(storedUser);
        if (!hydrated) return;
        setUser((prev) => (prev ? { ...prev, ...hydrated } : hydrated));
      } catch {
        // Ignore malformed storage.
      }
    };

    window.addEventListener("user-profile-updated", syncUserProfile);
    window.addEventListener("storage", syncUserProfile);

    return () => {
      window.removeEventListener("user-profile-updated", syncUserProfile);
      window.removeEventListener("storage", syncUserProfile);
    };
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const storedUserRaw = localStorage.getItem("user");
    if (!token || !storedUserRaw) return;

    let storedUser = null;
    try {
      storedUser = JSON.parse(storedUserRaw);
    } catch {
      return;
    }
    if (!storedUser || typeof storedUser !== "object") return;
    if (String(storedUser.role || "").toLowerCase() !== "user") return;
    const profilePhoto = getScopedProfilePhoto(storedUser);
    if (!profilePhoto) return;

    const userKey = String(storedUser._id || storedUser.email || "");
    if (!userKey) return;
    if (attemptedAvatarBackfillByUserRef.current.has(userKey)) return;
    attemptedAvatarBackfillByUserRef.current.add(userKey);

    const existingAvatar = String(storedUser.avatar || "").trim();
    if (existingAvatar && existingAvatar !== profilePhoto) return;

    const syncAvatarToBackend = async () => {
      try {
        const response = await API.updateProfile({ avatar: profilePhoto });
        const mergedUser =
          response?.user && typeof response.user === "object"
            ? { ...storedUser, ...response.user }
            : { ...storedUser, avatar: profilePhoto };
        localStorage.setItem("user", JSON.stringify(mergedUser));
        setUser(hydrateStoredUser(mergedUser));
        window.dispatchEvent(new Event("user-profile-updated"));
      } catch {
        // Keep local-only photo if profile sync fails.
      }
    };

    syncAvatarToBackend();
  }, [isLoggedIn, isOwnerLoggedIn, user?._id]);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPage(resolvePageFromPath(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const targetRoute = PAGE_TO_ROUTE[currentPage];
    if (!targetRoute) return;
    if (window.location.pathname === targetRoute) return;

    window.history.pushState({ page: currentPage }, "", targetRoute);
  }, [currentPage]);

<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  useEffect(() => {
    const switchToUser = () => {
      setIsOwnerLoggedIn(false);
      setCurrentPage("home");
    };
<<<<<<< HEAD
=======
<<<<<<< HEAD

=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    window.addEventListener("switch-to-user", switchToUser);
    return () => window.removeEventListener("switch-to-user", switchToUser);
  }, []);

<<<<<<< HEAD
  // Open the logout modal
  const requestLogout = () => {
    setShowLogoutModal(true);
  };

  // Finish logout
  const confirmLogout = async () => {
    setShowLogoutModal(false);
    try {
      await API.logout();
    } catch {
      // Local cleanup still runs below.
    }
=======
<<<<<<< HEAD
  const logoutEverywhere = () => {
>>>>>>> 8422a2f (fixed bugs and updates)
    setIsLoggedIn(false);
    setIsOwnerLoggedIn(false);
    setUser(null);
    setPendingScrollTarget("");
    disconnectSocket();
    localStorage.removeItem("isNewOwner");
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem(PROFILE_PHOTO_KEY);
    localStorage.removeItem(PROFILE_PHOTO_USER_KEY);
    setCurrentPage("home");
  };

  const cancelLogout = () => {
    setShowLogoutModal(false);
  };

  // Build initials from the full name
  const buildUserData = (name, email, role) => {
    const parts = name.trim().split(" ");
    const firstName = parts[0] || "";
    const lastName = parts.slice(1).join(" ") || "";
    return {
      name,
      initials: firstName.charAt(0).toUpperCase() + (lastName.charAt(0) || "").toUpperCase(),
      email,
      role,
      isVerified: true,
    };
  };

  const goToBookingHistory = () => {
    setCurrentPage("booking-history");
  };

  const goToRealtimeChat = () => {
    if (!isLoggedIn) {
      setCurrentPage("signin");
      return;
    }
    setCurrentPage("realtime-chat");
  };

  const goToNotifications = () => {
    if (!isLoggedIn) {
      setCurrentPage("signin");
      return;
    }
    setCurrentPage("notifications");
  };

  const navigateToContacts = () => {
    if (currentPage === "home") {
      const contactsSection = document.getElementById("contacts");
      if (contactsSection) {
        contactsSection.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }

    setPendingScrollTarget("contacts");
    setCurrentPage("home");
  };

  const navigateToAbout = () => {
    if (currentPage === "home") {
      const aboutSection = document.getElementById("about");
      if (aboutSection) {
        aboutSection.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }

    setPendingScrollTarget("about");
    setCurrentPage("home");
  };

  useEffect(() => {
    if (!pendingScrollTarget) return undefined;

    const timer = window.setTimeout(() => {
      const target = document.getElementById(pendingScrollTarget);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      setPendingScrollTarget("");
    }, 80);

    return () => window.clearTimeout(timer);
  }, [currentPage, pendingScrollTarget]);

  useEffect(() => {
    if (currentPage !== "about") return;
    setPendingScrollTarget("about");
    setCurrentPage("home");
  }, [currentPage]);

  return (
    <>
<<<<<<< HEAD
=======
      {/* HOME */}
=======
  // Open the logout modal
  const requestLogout = () => {
    setShowLogoutModal(true);
  };

  // Finish logout
  const confirmLogout = async () => {
    setShowLogoutModal(false);
    try {
      await API.logout();
    } catch {
      // Local cleanup still runs below.
    }
    setIsLoggedIn(false);
    setIsOwnerLoggedIn(false);
    setUser(null);
    setPendingScrollTarget("");
    disconnectSocket();
    localStorage.removeItem("isNewOwner");
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem(PROFILE_PHOTO_KEY);
    localStorage.removeItem(PROFILE_PHOTO_USER_KEY);
    setCurrentPage("home");
  };

  const cancelLogout = () => {
    setShowLogoutModal(false);
  };

  // Build initials from the full name
  const buildUserData = (name, email, role) => {
    const parts = name.trim().split(" ");
    const firstName = parts[0] || "";
    const lastName = parts.slice(1).join(" ") || "";
    return {
      name,
      initials: firstName.charAt(0).toUpperCase() + (lastName.charAt(0) || "").toUpperCase(),
      email,
      role,
      isVerified: true,
    };
  };

  const goToBookingHistory = () => {
    setCurrentPage("booking-history");
  };

  const goToRealtimeChat = () => {
    if (!isLoggedIn) {
      setCurrentPage("signin");
      return;
    }
    setCurrentPage("realtime-chat");
  };

  const goToNotifications = () => {
    if (!isLoggedIn) {
      setCurrentPage("signin");
      return;
    }
    setCurrentPage("notifications");
  };

  const navigateToContacts = () => {
    if (currentPage === "home") {
      const contactsSection = document.getElementById("contacts");
      if (contactsSection) {
        contactsSection.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }

    setPendingScrollTarget("contacts");
    setCurrentPage("home");
  };

  const navigateToAbout = () => {
    if (currentPage === "home") {
      const aboutSection = document.getElementById("about");
      if (aboutSection) {
        aboutSection.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }

    setPendingScrollTarget("about");
    setCurrentPage("home");
  };

  useEffect(() => {
    if (!pendingScrollTarget) return undefined;

    const timer = window.setTimeout(() => {
      const target = document.getElementById(pendingScrollTarget);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      setPendingScrollTarget("");
    }, 80);

    return () => window.clearTimeout(timer);
  }, [currentPage, pendingScrollTarget]);

  useEffect(() => {
    if (currentPage !== "about") return;
    setPendingScrollTarget("about");
    setCurrentPage("home");
  }, [currentPage]);

  return (
    <>
>>>>>>> 8422a2f (fixed bugs and updates)
      {/* logout modal */}
      <LogoutModal
        isOpen={showLogoutModal}
        onCancel={cancelLogout}
        onConfirm={confirmLogout}
      />

      {/* home */}
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      {currentPage === "home" && (
        <RentifyPro
          isLoggedIn={isLoggedIn}
          user={user}
<<<<<<< HEAD
          onNavigateToHome={() => setCurrentPage("home")}
=======
<<<<<<< HEAD
=======
          onNavigateToHome={() => setCurrentPage("home")}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
          onNavigateToSignIn={() => setCurrentPage("signin")}
          onNavigateToAccountSettings={() => setCurrentPage("account-settings")}
          onNavigateToVehicles={() => {
            setBookingData(getDefaultBookingData());
            setCurrentPage("vehicles");
          }}
<<<<<<< HEAD
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToAbout={navigateToAbout}
          onNavigateToContacts={navigateToContacts}
=======
<<<<<<< HEAD
          onNavigateToBookingHistory={() => setCurrentPage("signin")}
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToAbout={() => setCurrentPage("about")}
=======
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToAbout={navigateToAbout}
          onNavigateToContacts={navigateToContacts}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
          onSearch={(data) => {
            setBookingData(data);
            setCurrentPage("vehicles");
          }}
          onViewDetails={(vehicle) => {
            setSelectedVehicle(vehicle);
            setCurrentPage("vehicle-details");
          }}
<<<<<<< HEAD
          onLogout={requestLogout}
        />
      )}

      {/* sign in */}
=======
<<<<<<< HEAD
          onLogout={logoutEverywhere}
        />
      )}

      {/* SIGN IN */}
=======
          onLogout={requestLogout}
        />
      )}

      {/* sign in */}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      {currentPage === "signin" && (
        <SignInPage
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToForgotPassword={() => setCurrentPage("forgot-email")}
          onLoginSuccess={(userData) => {
            setUser(userData);

            if (userData?.role === "owner") {
              setIsOwnerLoggedIn(true);
              setIsLoggedIn(false);
              localStorage.setItem("isNewOwner", "true");
              setCurrentPage("owner-dashboard");
            } else {
              setIsLoggedIn(true);
              setIsOwnerLoggedIn(false);
              setCurrentPage("home");
            }
          }}
        />
      )}

<<<<<<< HEAD
      {/* forgot password */}
=======
<<<<<<< HEAD
      {/* FORGOT PASSWORD FLOW */}
=======
      {/* forgot password */}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      {currentPage === "forgot-email" && (
        <ForgotPasswordEmail
          onNavigateToOTP={(email) => {
            setForgotEmail(email);
<<<<<<< HEAD
            setForgotResetToken("");
=======
<<<<<<< HEAD
=======
            setForgotResetToken("");
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
            setCurrentPage("forgot-otp");
          }}
          onNavigateToSignIn={() => setCurrentPage("signin")}
        />
      )}

      {currentPage === "forgot-otp" && (
        <ForgotPasswordOTP
          email={forgotEmail}
<<<<<<< HEAD
=======
<<<<<<< HEAD
          onVerified={() => setCurrentPage("reset-password")}
=======
>>>>>>> 8422a2f (fixed bugs and updates)
          onVerified={(resetToken) => {
            setForgotResetToken(resetToken);
            setCurrentPage("reset-password");
          }}
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
          onNavigateToForgotPassword={() => setCurrentPage("forgot-email")}
        />
      )}

      {currentPage === "reset-password" && (
        <ResetPassword
<<<<<<< HEAD
=======
<<<<<<< HEAD
          onSuccess={() => setCurrentPage("signin")}
=======
>>>>>>> 8422a2f (fixed bugs and updates)
          email={forgotEmail}
          token={forgotResetToken}
          onSuccess={() => {
            setForgotEmail("");
            setForgotResetToken("");
            setCurrentPage("signin");
          }}
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
          onBack={() => setCurrentPage("forgot-otp")}
        />
      )}

<<<<<<< HEAD
      {/* vehicles */}
=======
<<<<<<< HEAD
      {/* VEHICLES */}
=======
      {/* vehicles */}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      {currentPage === "vehicles" && (
        <VehiclesPage
          bookingData={bookingData}
          setBookingData={setBookingData}
          isLoggedIn={isLoggedIn}
          user={user}
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToSignIn={() => setCurrentPage("signin")}
<<<<<<< HEAD
          onNavigateToVehicles={() => setCurrentPage("vehicles")}
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToAbout={navigateToAbout}
          onNavigateToContacts={navigateToContacts}
=======
<<<<<<< HEAD
          onNavigateToBookingHistory={() => setCurrentPage("signin")}
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToAbout={() => setCurrentPage("about")}
=======
          onNavigateToVehicles={() => setCurrentPage("vehicles")}
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToAbout={navigateToAbout}
          onNavigateToContacts={navigateToContacts}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
          onNavigateToAccountSettings={() => setCurrentPage("account-settings")}
          onViewDetails={(vehicle) => {
            setSelectedVehicle(vehicle);
            setCurrentPage("vehicle-details");
          }}
<<<<<<< HEAD
          onLogout={requestLogout}
        />
      )}

      {/* vehicle details */}
=======
<<<<<<< HEAD
          onLogout={logoutEverywhere}
        />
      )}

      {/* VEHICLE DETAILS */}
=======
          onLogout={requestLogout}
        />
      )}

      {/* vehicle details */}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      {currentPage === "vehicle-details" && selectedVehicle && (
        <VehicleDetailsPage
          vehicle={selectedVehicle}
          bookingData={bookingData}
          setBookingData={setBookingData}
          isLoggedIn={isLoggedIn}
          user={user}
          onBack={() => setCurrentPage("vehicles")}
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToSignIn={() => setCurrentPage("signin")}
<<<<<<< HEAD
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToVehicles={() => setCurrentPage("vehicles")}
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
          onNavigateToAbout={navigateToAbout}
          onNavigateToContacts={navigateToContacts}
=======
<<<<<<< HEAD
          onNavigateToAbout={() => setCurrentPage("about")}
>>>>>>> 8422a2f (fixed bugs and updates)
          onNavigateToAccountSettings={() => setCurrentPage("account-settings")}
          onLogout={requestLogout}
        />
      )}

<<<<<<< HEAD
      {/* user registration */}
=======
      {/* REGISTER USER */}
=======
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToVehicles={() => setCurrentPage("vehicles")}
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
          onNavigateToAbout={navigateToAbout}
          onNavigateToContacts={navigateToContacts}
          onNavigateToAccountSettings={() => setCurrentPage("account-settings")}
          onLogout={requestLogout}
        />
      )}

      {/* user registration */}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      {currentPage === "register" && (
        <RegisterPage
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToSignIn={() => setCurrentPage("signin")}
<<<<<<< HEAD
          onNavigateToRegisterOTP={(email, phone, name) => {
            setRegisteredEmail(email);
            setRegisteredPhone(phone);
            setRegisteredName(name || "");
=======
<<<<<<< HEAD
          onNavigateToRegisterOTP={(email, phone) => {
            setRegisteredEmail(email);
            setRegisteredPhone(phone);
=======
          onNavigateToRegisterOTP={(email, phone, name) => {
            setRegisteredEmail(email);
            setRegisteredPhone(phone);
            setRegisteredName(name || "");
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
            setRegisterRole("user");
            setCurrentPage("registerotp");
          }}
          onNavigateToOwnerRegister={() => setCurrentPage("register-owner")}
        />
      )}

<<<<<<< HEAD
      {/* owner registration */}
=======
<<<<<<< HEAD
      {/* REGISTER OWNER */}
=======
      {/* owner registration */}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      {currentPage === "register-owner" && (
        <RegisterOwnerPage
          onBack={() => setCurrentPage("register")}
          onNavigateToSignIn={() => setCurrentPage("signin")}
<<<<<<< HEAD
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToRegisterOTP={(email, phone, name) => {
            setRegisteredEmail(email);
            setRegisteredPhone(phone);
            setRegisteredName(name || "");
=======
<<<<<<< HEAD
          onNavigateToRegisterOTP={(email, phone) => {
            setRegisteredEmail(email);
            setRegisteredPhone(phone);
=======
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToRegisterOTP={(email, phone, name) => {
            setRegisteredEmail(email);
            setRegisteredPhone(phone);
            setRegisteredName(name || "");
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
            setRegisterRole("owner");
            setCurrentPage("registerotp");
          }}
        />
      )}

<<<<<<< HEAD
      {/* OTP verification */}
=======
<<<<<<< HEAD
      {/* REGISTER OTP */}
=======
      {/* OTP verification */}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      {currentPage === "registerotp" && (
        <RegisterOTP
          email={registeredEmail}
          phone={registeredPhone}
          role={registerRole}
          onNavigateToSignIn={() => setCurrentPage("signin")}
          onNavigateToRegister={() => setCurrentPage("register")}
<<<<<<< HEAD
          onVerificationSuccess={(role, verifiedUser) => {
            const fallbackUser = buildUserData(
              registeredName || registeredEmail,
              registeredEmail,
              role
            );
            const userData = verifiedUser
              ? {
                  ...verifiedUser,
                  initials:
                    String(verifiedUser.initials || "").trim() ||
                    getInitialsFromName(verifiedUser.name || verifiedUser.email),
                }
              : fallbackUser;
=======
<<<<<<< HEAD
        />
      )}
>>>>>>> 8422a2f (fixed bugs and updates)

            if (role === "owner") {
              setIsOwnerLoggedIn(true);
              setIsLoggedIn(false);
              localStorage.setItem("isNewOwner", "true");
              setUser(userData);
              setCurrentPage("owner-dashboard");
            } else {
              setIsLoggedIn(true);
              setIsOwnerLoggedIn(false);
              setUser(userData);
              setCurrentPage("home");
            }
          }}
        />
      )}

<<<<<<< HEAD
      {/* account settings */}
=======
      {/* ACCOUNT SETTINGS */}
=======
          onVerificationSuccess={(role, verifiedUser) => {
            const fallbackUser = buildUserData(
              registeredName || registeredEmail,
              registeredEmail,
              role
            );
            const userData = verifiedUser
              ? {
                  ...verifiedUser,
                  initials:
                    String(verifiedUser.initials || "").trim() ||
                    getInitialsFromName(verifiedUser.name || verifiedUser.email),
                }
              : fallbackUser;

            if (role === "owner") {
              setIsOwnerLoggedIn(true);
              setIsLoggedIn(false);
              localStorage.setItem("isNewOwner", "true");
              setUser(userData);
              setCurrentPage("owner-dashboard");
            } else {
              setIsLoggedIn(true);
              setIsOwnerLoggedIn(false);
              setUser(userData);
              setCurrentPage("home");
            }
          }}
        />
      )}

      {/* account settings */}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      {currentPage === "account-settings" && (
        <AccountSettings
          isLoggedIn={isLoggedIn}
          user={user}
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToVehicles={() => setCurrentPage("vehicles")}
<<<<<<< HEAD
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
=======
<<<<<<< HEAD
          onNavigateToBookingHistory={() => setCurrentPage("signin")}
>>>>>>> 8422a2f (fixed bugs and updates)
          onNavigateToSignIn={() => setCurrentPage("signin")}
          onNavigateToAccountSettings={() => setCurrentPage("account-settings")}
          onNavigateToVehicleOwnerProceed={() => setCurrentPage("vehicle-owner-proceed")}
          onNavigateToAbout={navigateToAbout}
          onLogout={requestLogout}
        />
      )}

<<<<<<< HEAD
=======
      {/* VEHICLE OWNER UPGRADE FLOW */}
=======
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
          onNavigateToSignIn={() => setCurrentPage("signin")}
          onNavigateToAccountSettings={() => setCurrentPage("account-settings")}
          onNavigateToVehicleOwnerProceed={() => setCurrentPage("vehicle-owner-proceed")}
          onNavigateToAbout={navigateToAbout}
          onLogout={requestLogout}
        />
      )}

>>>>>>> 8422a2f (fixed bugs and updates)
      {currentPage === "booking-history" && (
        <BookingsPage
          isLoggedIn={isLoggedIn}
          user={user}
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToSignIn={() => setCurrentPage("signin")}
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToVehicles={() => setCurrentPage("vehicles")}
          onNavigateToAbout={navigateToAbout}
          onNavigateToContacts={navigateToContacts}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToAccountSettings={() => setCurrentPage("account-settings")}
          onLogout={requestLogout}
        />
      )}

      {currentPage === "realtime-chat" && (
        <RealtimeChatPage
          isLoggedIn={isLoggedIn}
          user={user}
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToSignIn={() => setCurrentPage("signin")}
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToVehicles={() => setCurrentPage("vehicles")}
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToAbout={navigateToAbout}
          onNavigateToContacts={navigateToContacts}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
          onNavigateToAccountSettings={() => setCurrentPage("account-settings")}
          onLogout={requestLogout}
        />
      )}

      {currentPage === "notifications" && (
        <NotificationsPage
          isLoggedIn={isLoggedIn}
          user={user}
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToSignIn={() => setCurrentPage("signin")}
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToVehicles={() => setCurrentPage("vehicles")}
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToAbout={navigateToAbout}
          onNavigateToContacts={navigateToContacts}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
          onNavigateToAccountSettings={() => setCurrentPage("account-settings")}
          onLogout={requestLogout}
        />
      )}

      {/* owner upgrade */}
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      {currentPage === "vehicle-owner-proceed" && (
        <ProceedVehicleOwner
          onBack={() => setCurrentPage("account-settings")}
          onDoLater={() => setCurrentPage("account-settings")}
          onProceed={() => setCurrentPage("vehicle-owner-verification")}
          onNavigateToHome={() => setCurrentPage("home")}
        />
      )}

      {currentPage === "vehicle-owner-verification" && (
        <VehicleOwnerVerification
          onNavigateToHome={() => setCurrentPage("home")}
          onBack={() => setCurrentPage("vehicle-owner-proceed")}
          onSubmit={() => {
            localStorage.setItem("isNewOwner", "true");
            setIsOwnerLoggedIn(true);
            setIsLoggedIn(false);
            setCurrentPage("owner-dashboard");
          }}
        />
      )}

<<<<<<< HEAD
      {/* owner dashboard */}
=======
<<<<<<< HEAD
      {/* OWNER DASHBOARD */}
=======
      {/* owner dashboard */}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      {currentPage === "owner-dashboard" && isOwnerLoggedIn && <OwnerLayout />}
    </>
  );
};

export default App;
<<<<<<< HEAD

=======
<<<<<<< HEAD
=======

>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
