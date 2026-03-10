import React, { useEffect, useRef, useState } from "react";
import { getCurrentTime, getTodayDate, getTomorrowDate } from "./utils/dateUtils";

// Main pages
import RentifyPro from "./pages/RentifyPro";
import SignInPage from "./components/SignInPage";
import VehiclesPage from "./pages/VehiclesPage";
import VehicleDetailsPage from "./pages/VehicleDetailsPage";
import BookingsPage from "./pages/BookingsPage";
import RealtimeChatPage from "./pages/RealtimeChatPage";
import NotificationsPage from "./pages/NotificationsPage";
import AccountSettings from "./pages/AccountSettings";
import ProceedVehicleOwner from "./pages/ProceedVehicleOwner";
import VehicleOwnerVerification from "./pages/VehicleOwnerVerification";

// Registration pages
import RegisterPage from "./components/RegisterPage";
import RegisterOwnerPage from "./pages/RegisterOwnerPage";

// Verification pages
import RegisterOTP from "./verification/RegisterOTP";
import ForgotPasswordEmail from "./verification/ForgotPasswordEmail";
import ForgotPasswordOTP from "./verification/ForgotPasswordOTP";
import ResetPassword from "./verification/ResetPassword";

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

  useEffect(() => {
    const switchToUser = () => {
      setIsOwnerLoggedIn(false);
      setCurrentPage("home");
    };
    window.addEventListener("switch-to-user", switchToUser);
    return () => window.removeEventListener("switch-to-user", switchToUser);
  }, []);

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
      {/* logout modal */}
      <LogoutModal
        isOpen={showLogoutModal}
        onCancel={cancelLogout}
        onConfirm={confirmLogout}
      />

      {/* home */}
      {currentPage === "home" && (
        <RentifyPro
          isLoggedIn={isLoggedIn}
          user={user}
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToSignIn={() => setCurrentPage("signin")}
          onNavigateToAccountSettings={() => setCurrentPage("account-settings")}
          onNavigateToVehicles={() => {
            setBookingData(getDefaultBookingData());
            setCurrentPage("vehicles");
          }}
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToAbout={navigateToAbout}
          onNavigateToContacts={navigateToContacts}
          onSearch={(data) => {
            setBookingData(data);
            setCurrentPage("vehicles");
          }}
          onViewDetails={(vehicle) => {
            setSelectedVehicle(vehicle);
            setCurrentPage("vehicle-details");
          }}
          onLogout={requestLogout}
        />
      )}

      {/* sign in */}
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

      {/* forgot password */}
      {currentPage === "forgot-email" && (
        <ForgotPasswordEmail
          onNavigateToOTP={(email) => {
            setForgotEmail(email);
            setForgotResetToken("");
            setCurrentPage("forgot-otp");
          }}
          onNavigateToSignIn={() => setCurrentPage("signin")}
        />
      )}

      {currentPage === "forgot-otp" && (
        <ForgotPasswordOTP
          email={forgotEmail}
          onVerified={(resetToken) => {
            setForgotResetToken(resetToken);
            setCurrentPage("reset-password");
          }}
          onNavigateToForgotPassword={() => setCurrentPage("forgot-email")}
        />
      )}

      {currentPage === "reset-password" && (
        <ResetPassword
          email={forgotEmail}
          token={forgotResetToken}
          onSuccess={() => {
            setForgotEmail("");
            setForgotResetToken("");
            setCurrentPage("signin");
          }}
          onBack={() => setCurrentPage("forgot-otp")}
        />
      )}

      {/* vehicles */}
      {currentPage === "vehicles" && (
        <VehiclesPage
          bookingData={bookingData}
          setBookingData={setBookingData}
          isLoggedIn={isLoggedIn}
          user={user}
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToSignIn={() => setCurrentPage("signin")}
          onNavigateToVehicles={() => setCurrentPage("vehicles")}
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToAbout={navigateToAbout}
          onNavigateToContacts={navigateToContacts}
          onNavigateToAccountSettings={() => setCurrentPage("account-settings")}
          onViewDetails={(vehicle) => {
            setSelectedVehicle(vehicle);
            setCurrentPage("vehicle-details");
          }}
          onLogout={requestLogout}
        />
      )}

      {/* vehicle details */}
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
      {currentPage === "register" && (
        <RegisterPage
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToSignIn={() => setCurrentPage("signin")}
          onNavigateToRegisterOTP={(email, phone, name) => {
            setRegisteredEmail(email);
            setRegisteredPhone(phone);
            setRegisteredName(name || "");
            setRegisterRole("user");
            setCurrentPage("registerotp");
          }}
          onNavigateToOwnerRegister={() => setCurrentPage("register-owner")}
        />
      )}

      {/* owner registration */}
      {currentPage === "register-owner" && (
        <RegisterOwnerPage
          onBack={() => setCurrentPage("register")}
          onNavigateToSignIn={() => setCurrentPage("signin")}
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToRegisterOTP={(email, phone, name) => {
            setRegisteredEmail(email);
            setRegisteredPhone(phone);
            setRegisteredName(name || "");
            setRegisterRole("owner");
            setCurrentPage("registerotp");
          }}
        />
      )}

      {/* OTP verification */}
      {currentPage === "registerotp" && (
        <RegisterOTP
          email={registeredEmail}
          phone={registeredPhone}
          role={registerRole}
          onNavigateToSignIn={() => setCurrentPage("signin")}
          onNavigateToRegister={() => setCurrentPage("register")}
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
      {currentPage === "account-settings" && (
        <AccountSettings
          isLoggedIn={isLoggedIn}
          user={user}
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToVehicles={() => setCurrentPage("vehicles")}
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

      {/* owner dashboard */}
      {currentPage === "owner-dashboard" && isOwnerLoggedIn && <OwnerLayout />}
    </>
  );
};

export default App;

