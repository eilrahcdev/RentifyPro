import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { getCurrentTime, getTodayDate, getTomorrowDate } from "./utils/dateUtils";

// Main pages
import RentifyPro from "./pages/RentifyPro";
const SignInPage = lazy(() => import("./components/SignInPage"));
const VehiclesPage = lazy(() => import("./pages/VehiclesPage"));
const VehicleDetailsPage = lazy(() => import("./pages/VehicleDetailsPage"));
const BookingsPage = lazy(() => import("./pages/BookingsPage"));
const RealtimeChatPage = lazy(() => import("./pages/RealtimeChatPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const ReportsCenter = lazy(() => import("./components/ReportsCenter"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const TermsAndConditionsPage = lazy(() => import("./pages/TermsAndConditionsPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const AccountSettings = lazy(() => import("./pages/AccountSettings"));
const ProceedVehicleOwner = lazy(() => import("./pages/ProceedVehicleOwner"));
const VehicleOwnerVerification = lazy(() => import("./pages/VehicleOwnerVerification"));
const RegisterPage = lazy(() => import("./components/RegisterPage"));
const RegisterOwnerPage = lazy(() => import("./pages/RegisterOwnerPage"));
const RegisterOTP = lazy(() => import("./verification/RegisterOTP"));
const ForgotPasswordEmail = lazy(() => import("./verification/ForgotPasswordEmail"));
const ForgotPasswordOTP = lazy(() => import("./verification/ForgotPasswordOTP"));
const ResetPassword = lazy(() => import("./verification/ResetPassword"));
const OwnerLayout = lazy(() => import("./owner/OwnerLayout"));
const AdminLayout = lazy(() => import("./admin/AdminLayout"));
const HelpPage = lazy(() => import("./pages/HelpPage"));

// Shared parts
import LogoutModal from "./components/LogoutModal";
import IdleWarningModal from "./components/IdleWarningModal";
import RenterNotificationsModal from "./components/RenterNotificationsModal";
import SessionSkeleton from "./components/SessionSkeleton";
import HelpPanel from "./components/HelpPanel";
import { RouteSkeleton, SignOutProgress } from "./components/LoadingSkeletons";
import { disconnectSocket, getSocket } from "./utils/socket";
import { dismissActionToasts, showActionToast } from "./utils/actionToast";
import API from "./utils/api";
import { getHelpGuide } from "./data/helpContent";
import { HELP_ASK_AI_EVENT, HELP_OPEN_EVENT } from "./utils/helpNavigation";
import {
  SESSION_USER_UPDATED_EVENT,
  clearSessionOwnerProfile,
  clearSessionUser,
  getSessionUser,
  setSessionUser,
} from "./utils/sessionStore";

const ROUTE_TO_PAGE = {
  "/": "home",
  "/vehicles": "vehicles",
  "/vehicle-details": "vehicle-details",
  "/about": "about",
  "/help": "help",
  "/privacy": "privacy-policy",
  "/privacy-policy": "privacy-policy",
  "/terms": "terms-and-conditions",
  "/terms-and-conditions": "terms-and-conditions",
  "/bookings": "booking-history",
  "/signin": "signin",
  "/register": "register",
  "/register-owner": "register-owner",
  "/registerotp": "registerotp",
  "/forgot-email": "forgot-email",
  "/forgot-otp": "forgot-otp",
  "/reset-password": "reset-password",
  "/chat": "realtime-chat",
  "/notifications": "notifications",
  "/reports": "reports",
  "/account-settings": "account-settings",
  "/vehicle-owner-proceed": "vehicle-owner-proceed",
  "/vehicle-owner-verification": "vehicle-owner-verification",
  "/owner-dashboard": "owner-dashboard",
  "/admin-dashboard": "admin-dashboard",
};

const PAGE_TO_ROUTE = Object.entries(ROUTE_TO_PAGE).reduce((map, [route, page]) => {
  map[page] = route;
  return map;
}, {});

const resolvePageFromPath = (pathname) => {
  const raw = String(pathname || "/").toLowerCase();
  const normalized = raw === "/" ? raw : raw.replace(/\/+$/, "");
  if (/^\/help\/[a-z0-9-]+$/.test(normalized)) return "help";
  return ROUTE_TO_PAGE[normalized] || "not-found";
};

const getHelpAudienceFromPath = (pathname) =>
  String(pathname || "").match(/^\/help\/(renter|owner)\/?$/i)?.[1]?.toLowerCase() || "";

const getHelpSlugFromPath = (pathname) =>
  getHelpAudienceFromPath(pathname)
    ? ""
    : String(pathname || "").match(/^\/help\/([a-z0-9-]+)\/?$/i)?.[1]?.toLowerCase() || "";

const getVehicleIdFromSearch = (search) => {
  const params = new URLSearchParams(String(search || ""));
  return String(params.get("vehicleId") || "").trim();
};

const getQueryParam = (search, key) => {
  const params = new URLSearchParams(String(search || ""));
  return String(params.get(key) || "").trim();
};

const buildRouteWithQuery = (path, query = {}) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    const normalized = String(value || "").trim();
    if (normalized) params.set(key, normalized);
  });
  const search = params.toString();
  return search ? `${path}?${search}` : path;
};

const FLOW_STATE_STORAGE_KEY = "rentifypro:flow-state";
const BOOKING_RETURN_STORAGE_KEY = "rentifypro:booking-return";
const SESSION_SKELETON_MIN_MS = 1000;
const SESSION_CHECK_TIMEOUT_MS = 15000;

const readFlowState = () => {
  try {
    const raw = sessionStorage.getItem(FLOW_STATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeFlowState = (nextState = {}) => {
  try {
    const normalized = Object.entries(nextState).reduce((acc, [key, value]) => {
      const text = String(value || "").trim();
      if (text) acc[key] = text;
      return acc;
    }, {});
    if (!Object.keys(normalized).length) {
      sessionStorage.removeItem(FLOW_STATE_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(FLOW_STATE_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage errors.
  }
};

const readBookingReturn = () => {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(BOOKING_RETURN_STORAGE_KEY) || "null");
    if (!/^[a-f\d]{24}$/i.test(String(parsed?.vehicleId || ""))) return null;
    return parsed;
  } catch {
    return null;
  }
};

const clearBookingReturn = () => {
  try {
    sessionStorage.removeItem(BOOKING_RETURN_STORAGE_KEY);
  } catch {
    // Sign-in still works when session storage is unavailable.
  }
};

const getInitialsFromName = (name) => {
  const cleaned = String(name || "").trim();
  if (!cleaned) return "U";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) || "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) || "" : "";
  return `${first}${last}`.toUpperCase() || "U";
};

const normalizeChatNavigationContext = (context = null) => {
  if (!context || typeof context !== "object") return null;

  const partnerId = String(context.partnerId || context.userId || "").trim();
  if (!partnerId) return null;

  const bookingId = String(context.bookingId || "").trim();
  const vehicleId = String(context.vehicleId || "").trim();

  return {
    partnerId,
    partnerName: String(context.partnerName || "").trim(),
    partnerEmail: String(context.partnerEmail || "").trim(),
    partnerAvatar: String(context.partnerAvatar || "").trim(),
    ...(bookingId ? { bookingId } : {}),
    ...(vehicleId ? { vehicleId } : {}),
  };
};

const LEGACY_AUTH_KEYS = ["token"];
const LEGACY_PROFILE_KEYS = ["user", "ownerProfile", "ownerProfilePhoto", "profilePhoto", "profilePhotoUserId"];
const AUTH_PAGES = new Set([
  "signin",
  "register",
  "register-owner",
  "registerotp",
  "forgot-email",
  "forgot-otp",
  "reset-password",
]);
const SESSION_REQUIRED_PAGES = new Set([
  "booking-history",
  "realtime-chat",
  "notifications",
  "reports",
  "account-settings",
  "vehicle-owner-proceed",
  "vehicle-owner-verification",
  "owner-dashboard",
  "admin-dashboard",
]);
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const IDLE_WARNING_SECONDS = 60;
const IDLE_ACTIVITY_EVENTS = ["keydown", "pointerdown", "touchstart", "mousemove", "scroll"];

const hydrateStoredUser = (storedUser = {}) => {
  if (!storedUser || typeof storedUser !== "object") return null;

  const displayName =
    String(storedUser.name || "").trim() ||
    String(storedUser.email || "").split("@")[0] ||
    "User";
  const avatar = String(storedUser.avatar || "").trim();

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
  const [helpGuideSlug, setHelpGuideSlug] = useState(() => getHelpSlugFromPath(window.location.pathname));
  const [helpAudience, setHelpAudience] = useState(() => getHelpAudienceFromPath(window.location.pathname));
  const [helpPanelGuideSlug, setHelpPanelGuideSlug] = useState(null);
  const initialFlowStateRef = useRef(readFlowState());
  const initialFlowState = initialFlowStateRef.current;
  const [bookingData, setBookingData] = useState(getDefaultBookingData());
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const bookingReturnRef = useRef(readBookingReturn());
  const [pendingScrollTarget, setPendingScrollTarget] = useState("");
  const [chatNavigationContext, setChatNavigationContext] = useState(null);

  const beginBookingSignIn = (vehicle) => {
    const vehicleId = String(vehicle?._id || vehicle?.id || "").trim();
    bookingReturnRef.current = null;
    clearBookingReturn();
    if (/^[a-f\d]{24}$/i.test(vehicleId)) {
      const bookingReturn = {
        vehicleId,
        pickupDate: bookingData.pickupDate,
        pickupTime: bookingData.pickupTime,
        returnDate: bookingData.returnDate,
        returnTime: bookingData.returnTime,
      };
      bookingReturnRef.current = bookingReturn;
      try {
        sessionStorage.setItem(BOOKING_RETURN_STORAGE_KEY, JSON.stringify(bookingReturn));
      } catch {
        // The in-memory return still works for this tab.
      }
      setSelectedVehicle(vehicle);
    }
    setCurrentPage("signin");
  };

  const restoreBookingAfterSignIn = useCallback(() => {
    const bookingReturn = bookingReturnRef.current || readBookingReturn();
    bookingReturnRef.current = null;
    clearBookingReturn();
    if (!bookingReturn) return false;
    setBookingData((current) => ({
      ...current,
      pickupDate: bookingReturn.pickupDate || current.pickupDate,
      pickupTime: bookingReturn.pickupTime || current.pickupTime,
      returnDate: bookingReturn.returnDate || current.returnDate,
      returnTime: bookingReturn.returnTime || current.returnTime,
    }));
    setSelectedVehicle((current) =>
      String(current?._id || current?.id || "") === bookingReturn.vehicleId
        ? current
        : { _id: bookingReturn.vehicleId }
    );
    setCurrentPage("vehicle-details");
    return true;
  }, []);

  const [registeredEmail, setRegisteredEmail] = useState(() =>
    String(initialFlowState.registeredEmail || "").trim()
  );
  const [registeredPhone, setRegisteredPhone] = useState(() =>
    String(initialFlowState.registeredPhone || "").trim()
  );
  const [registeredName, setRegisteredName] = useState(() =>
    String(initialFlowState.registeredName || "").trim()
  );
  const [registerRole, setRegisterRole] = useState(() =>
    String(initialFlowState.registerRole || "").trim().toLowerCase() === "owner" ? "owner" : "user"
  );

  const [forgotEmail, setForgotEmail] = useState(() =>
    String(initialFlowState.forgotEmail || "").trim()
  );
  const [forgotResetToken, setForgotResetToken] = useState(() =>
    String(initialFlowState.forgotResetToken || "").trim()
  );

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isOwnerLoggedIn, setIsOwnerLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [isSessionBootstrapping, setIsSessionBootstrapping] = useState(true);
  const [sessionLoadError, setSessionLoadError] = useState("");
  const [sessionRetryCount, setSessionRetryCount] = useState(0);
  const [logoutState, setLogoutState] = useState({ status: "idle", redirectPage: "home" });

  // Logout modal state
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showIdleWarningModal, setShowIdleWarningModal] = useState(false);
  const [showRenterNotificationsModal, setShowRenterNotificationsModal] = useState(false);
  const [idleCountdownSeconds, setIdleCountdownSeconds] = useState(0);
  const lastActivityRef = useRef(Date.now());
  const idleDeadlineRef = useRef(0);
  const logoutInProgressRef = useRef(false);
  const logoutRedirectPageRef = useRef("home");
  const idleWarningOpenRef = useRef(false);
  const seenReturnNotificationsRef = useRef(new Set());

  useEffect(() => {
    const purgeLegacyStorage = () => {
      LEGACY_AUTH_KEYS.forEach((key) => {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      });
      LEGACY_PROFILE_KEYS.forEach((key) => {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      });
    };

    purgeLegacyStorage();

    let mounted = true;
    const startedAt = performance.now();
    let finishTimer;
    const controller = new AbortController();
    const timeoutTimer = window.setTimeout(() => controller.abort(), SESSION_CHECK_TIMEOUT_MS);

    const bootstrapSession = async () => {
      try {
        const response = await API.getProfile({ signal: controller.signal });
        const profileUser =
          response?.user && typeof response.user === "object" ? response.user : null;
        if (!mounted || !profileUser || profileUser.isVerified !== true) {
          const error = new Error("No active session");
          error.status = 401;
          throw error;
        }

        const hydratedUser = hydrateStoredUser(profileUser);
        setSessionLoadError("");
        setSessionUser(profileUser);
        setUser(hydratedUser);

        const isAdmin = profileUser.role === "admin";
        const isOwner = profileUser.role === "owner";
        const ownerPreference = String(localStorage.getItem("isNewOwner") || "").trim().toLowerCase();
        const ownerMode = isOwner && ownerPreference !== "false";
        if (isAdmin) {
          localStorage.removeItem("isNewOwner");
          setIsOwnerLoggedIn(false);
          setIsLoggedIn(true);
          setCurrentPage("admin-dashboard");
        } else if (ownerMode) {
          localStorage.setItem("isNewOwner", "true");
          setIsOwnerLoggedIn(true);
          setIsLoggedIn(false);
          if (resolvePageFromPath(window.location.pathname) !== "help") {
            setCurrentPage("owner-dashboard");
          }
        } else {
          if (isOwner) localStorage.setItem("isNewOwner", "false");
          setIsOwnerLoggedIn(false);
          setIsLoggedIn(true);
          const pathPage = resolvePageFromPath(window.location.pathname);
          if (pathPage === "signin" && restoreBookingAfterSignIn()) {
            // Return to the selected vehicle after a sign-in page reload.
          } else if (
            AUTH_PAGES.has(pathPage) ||
            pathPage === "owner-dashboard" ||
            pathPage === "admin-dashboard"
          ) {
            setCurrentPage("home");
          }
        }
      } catch (error) {
        if (!mounted) return;
        if (error?.status !== 401 && error?.code !== "EMAIL_VERIFICATION_REQUIRED") {
          setSessionLoadError(
            error?.status === 0 || error?.name === "AbortError"
              ? "We couldn't connect to RentifyPro. Check your connection and try again."
              : "RentifyPro couldn't check your account right now. Please try again."
          );
          return;
        }
        setSessionLoadError("");
        setIsLoggedIn(false);
        setIsOwnerLoggedIn(false);
        setUser(null);
        clearSessionUser();
        clearSessionOwnerProfile();
        purgeLegacyStorage();
        localStorage.removeItem("isNewOwner");
        const pathPage = resolvePageFromPath(window.location.pathname);
        if (pathPage === "owner-dashboard" || pathPage === "admin-dashboard" || pathPage === "reports") {
          setCurrentPage("signin");
        }
      } finally {
        window.clearTimeout(timeoutTimer);
        if (mounted) {
          const remaining = Math.max(0, SESSION_SKELETON_MIN_MS - (performance.now() - startedAt));
          if (remaining > 0) {
            finishTimer = window.setTimeout(() => {
              if (mounted) setIsSessionBootstrapping(false);
            }, remaining);
          } else {
            setIsSessionBootstrapping(false);
          }
        }
      }
    };

    bootstrapSession();

    return () => {
      mounted = false;
      controller.abort();
      window.clearTimeout(timeoutTimer);
      window.clearTimeout(finishTimer);
    };
  }, [sessionRetryCount, restoreBookingAfterSignIn]);

  useEffect(() => {
    if (AUTH_PAGES.has(currentPage) || currentPage === "vehicle-details") return;
    bookingReturnRef.current = null;
    clearBookingReturn();
  }, [currentPage]);

  useEffect(() => {
    if (!sessionLoadError) return undefined;

    const retryWhenAvailable = () => {
      if (navigator.onLine) setSessionRetryCount((count) => count + 1);
    };
    window.addEventListener("online", retryWhenAvailable);
    window.addEventListener("focus", retryWhenAvailable);
    return () => {
      window.removeEventListener("online", retryWhenAvailable);
      window.removeEventListener("focus", retryWhenAvailable);
    };
  }, [sessionLoadError]);

  useEffect(() => {
    const syncUserProfile = (event) => {
      const payloadUser =
        event?.detail && typeof event.detail === "object"
          ? event.detail
          : getSessionUser();

      if (!payloadUser) {
        setUser(null);
        setIsLoggedIn(false);
        setIsOwnerLoggedIn(false);
        return;
      }

      const hydrated = hydrateStoredUser(payloadUser);
      if (!hydrated) return;
      setUser((prev) => (prev ? { ...prev, ...hydrated } : hydrated));
    };

    window.addEventListener("user-profile-updated", syncUserProfile);
    window.addEventListener(SESSION_USER_UPDATED_EVENT, syncUserProfile);

    return () => {
      window.removeEventListener("user-profile-updated", syncUserProfile);
      window.removeEventListener(SESSION_USER_UPDATED_EVENT, syncUserProfile);
    };
  }, []);

  useEffect(() => {
    const selectedVehicleId = String(selectedVehicle?._id || selectedVehicle?.id || "").trim();
    writeFlowState({
      selectedVehicleId,
      registeredEmail,
      registeredPhone,
      registeredName,
      registerRole,
      forgotEmail,
      forgotResetToken,
    });
  }, [
    selectedVehicle?._id,
    selectedVehicle?.id,
    registeredEmail,
    registeredPhone,
    registeredName,
    registerRole,
    forgotEmail,
    forgotResetToken,
  ]);

  useEffect(() => {
    const query = window.location.search;

    if (currentPage === "registerotp") {
      const queryEmail = getQueryParam(query, "email");
      const queryPhone = getQueryParam(query, "phone");
      const queryRole = getQueryParam(query, "role").toLowerCase();

      if (queryEmail && queryEmail !== registeredEmail) {
        setRegisteredEmail(queryEmail);
      }
      if (queryPhone && queryPhone !== registeredPhone) {
        setRegisteredPhone(queryPhone);
      }
      if ((queryRole === "owner" || queryRole === "user") && queryRole !== registerRole) {
        setRegisterRole(queryRole);
      }
      if (!queryEmail && !registeredEmail) {
        setCurrentPage("register");
      }
      return;
    }

    if (currentPage === "forgot-otp" || currentPage === "reset-password") {
      const queryEmail = getQueryParam(query, "email");
      if (queryEmail && queryEmail !== forgotEmail) {
        setForgotEmail(queryEmail);
      }

      const effectiveEmail = queryEmail || forgotEmail;
      if (!effectiveEmail) {
        setCurrentPage("forgot-email");
        return;
      }

      if (currentPage === "reset-password" && !forgotResetToken) {
        setCurrentPage("forgot-otp");
      }
    }
  }, [
    currentPage,
    registeredEmail,
    registeredPhone,
    registerRole,
    forgotEmail,
    forgotResetToken,
  ]);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPage(resolvePageFromPath(window.location.pathname));
      setHelpGuideSlug(getHelpSlugFromPath(window.location.pathname));
      setHelpAudience(getHelpAudienceFromPath(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const handleOpenHelp = (event) => {
      setHelpPanelGuideSlug(String(event?.detail?.guideSlug || ""));
    };
    window.addEventListener(HELP_OPEN_EVENT, handleOpenHelp);
    return () => window.removeEventListener(HELP_OPEN_EVENT, handleOpenHelp);
  }, []);

  const closeHelp = useCallback(() => setHelpPanelGuideSlug(null), []);

  useEffect(() => {
    const baseRoute = PAGE_TO_ROUTE[currentPage];
    if (!baseRoute) return;

    const targetRoute = (() => {
      if (currentPage === "vehicle-details") {
        const queryVehicleId = getVehicleIdFromSearch(window.location.search);
        const selectedVehicleId = String(selectedVehicle?._id || selectedVehicle?.id || "").trim();
        const storedVehicleId = String(readFlowState().selectedVehicleId || "").trim();
        return buildRouteWithQuery(baseRoute, {
          vehicleId: queryVehicleId || selectedVehicleId || storedVehicleId,
        });
      }

      if (currentPage === "registerotp") {
        const queryEmail = getQueryParam(window.location.search, "email");
        const queryPhone = getQueryParam(window.location.search, "phone");
        const queryRole = getQueryParam(window.location.search, "role");
        const role = registerRole === "owner" ? "owner" : queryRole === "owner" ? "owner" : "user";
        return buildRouteWithQuery(baseRoute, {
          email: registeredEmail || queryEmail,
          phone: registeredPhone || queryPhone,
          role,
        });
      }

      if (currentPage === "forgot-otp" || currentPage === "reset-password") {
        const queryEmail = getQueryParam(window.location.search, "email");
        return buildRouteWithQuery(baseRoute, {
          email: forgotEmail || queryEmail,
        });
      }

      if (currentPage === "owner-dashboard") {
        const tab = getQueryParam(window.location.search, "tab");
        return buildRouteWithQuery(baseRoute, { tab });
      }

      if (currentPage === "help") {
        return helpGuideSlug ? `/help/${helpGuideSlug}` : helpAudience ? `/help/${helpAudience}` : "/help";
      }

      if (currentPage === "booking-history") {
        // Keep the provider return reference until BookingsPage verifies it.
        return buildRouteWithQuery(baseRoute, {
          bookingId: getQueryParam(window.location.search, "bookingId"),
          payment: getQueryParam(window.location.search, "payment"),
          checkoutId: getQueryParam(window.location.search, "checkoutId"),
          checkout_session_id: getQueryParam(window.location.search, "checkout_session_id"),
        });
      }

      return baseRoute;
    })();

    const currentRoute = `${window.location.pathname}${window.location.search}`;
    if (currentRoute === targetRoute) return;
    window.history.pushState({ page: currentPage }, "", targetRoute);
  }, [
    currentPage,
    selectedVehicle?._id,
    selectedVehicle?.id,
    registeredEmail,
    registeredPhone,
    registerRole,
    forgotEmail,
    helpGuideSlug,
    helpAudience,
  ]);

  useEffect(() => {
    if (currentPage !== "vehicle-details") return undefined;
    const storedVehicleId = String(readFlowState().selectedVehicleId || "").trim();
    const vehicleIdFromQuery = getVehicleIdFromSearch(window.location.search) || storedVehicleId;
    const selectedVehicleId = String(selectedVehicle?._id || selectedVehicle?.id || "").trim();
    if (selectedVehicle?.name && selectedVehicleId && (!vehicleIdFromQuery || vehicleIdFromQuery === selectedVehicleId)) {
      return undefined;
    }

    if (!vehicleIdFromQuery) {
      setCurrentPage("vehicles");
      return undefined;
    }

    let active = true;
    API.getPublicVehicleById(vehicleIdFromQuery)
      .then((response) => {
        if (!active) return;
        const vehicle = response?.vehicle;
        if (vehicle && (vehicle._id || vehicle.id)) {
          setSelectedVehicle(vehicle);
          return;
        }
        setCurrentPage("vehicles");
      })
      .catch(() => {
        if (!active) return;
        setCurrentPage("vehicles");
      });

    return () => {
      active = false;
    };
  }, [currentPage, selectedVehicle?._id, selectedVehicle?.id, selectedVehicle?.name]);

  useEffect(() => {
    const switchToUser = () => {
      localStorage.setItem("isNewOwner", "false");
      setIsOwnerLoggedIn(false);
      setIsLoggedIn(true);
      setCurrentPage("home");
    };
    window.addEventListener("switch-to-user", switchToUser);
    return () => window.removeEventListener("switch-to-user", switchToUser);
  }, []);

  useEffect(() => {
    if (!isLoggedIn || isOwnerLoggedIn) {
      setShowRenterNotificationsModal(false);
    }
  }, [isLoggedIn, isOwnerLoggedIn]);

  const performLogout = useCallback(async ({ redirectPage = "home" } = {}) => {
    if (logoutInProgressRef.current) return;
    logoutInProgressRef.current = true;
    setLogoutState({ status: "pending", redirectPage });
    setShowLogoutModal(false);
    setShowIdleWarningModal(false);
    setShowRenterNotificationsModal(false);

    try {
      await API.logout();
    } catch {
      setLogoutState({ status: "error", redirectPage });
      logoutInProgressRef.current = false;
      return;
    }

    setShowLogoutModal(false);
    setShowIdleWarningModal(false);
    setShowRenterNotificationsModal(false);
    setIdleCountdownSeconds(0);
    idleWarningOpenRef.current = false;
    setIsLoggedIn(false);
    setIsOwnerLoggedIn(false);
    setUser(null);
    setPendingScrollTarget("");
    disconnectSocket();
    clearSessionOwnerProfile();
    clearSessionUser();
    localStorage.removeItem("isNewOwner");
    LEGACY_AUTH_KEYS.forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
    LEGACY_PROFILE_KEYS.forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });

    lastActivityRef.current = Date.now();
    idleDeadlineRef.current = 0;
    setSelectedVehicle(null);
    bookingReturnRef.current = null;
    clearBookingReturn();
    setRegisteredEmail("");
    setRegisteredPhone("");
    setRegisteredName("");
    setRegisterRole("user");
    setForgotEmail("");
    setForgotResetToken("");
    writeFlowState({});
    // A document navigation also discards page-local account data and caches.
    // Keep the pending screen mounted until the new page takes over.
    window.location.replace(PAGE_TO_ROUTE[redirectPage] || "/");
  }, []);

  const keepSessionActive = useCallback(() => {
    lastActivityRef.current = Date.now();
    idleDeadlineRef.current = 0;
    if (idleWarningOpenRef.current) {
      idleWarningOpenRef.current = false;
      setShowIdleWarningModal(false);
      setIdleCountdownSeconds(0);
    }
  }, []);

  // Open the logout modal
  const requestLogout = (redirectPage = "home") => {
    logoutRedirectPageRef.current = redirectPage === "signin" ? "signin" : "home";
    setShowLogoutModal(true);
  };

  // Finish logout
  const confirmLogout = async () => {
    await performLogout({ redirectPage: logoutRedirectPageRef.current });
  };

  const cancelLogout = () => {
    setShowLogoutModal(false);
  };

  useEffect(() => {
    idleWarningOpenRef.current = showIdleWarningModal;
  }, [showIdleWarningModal]);

  useEffect(() => {
    const sessionActive = isLoggedIn || isOwnerLoggedIn;

    if (!sessionActive || logoutState.status !== "idle") {
      setShowIdleWarningModal(false);
      setIdleCountdownSeconds(0);
      idleDeadlineRef.current = 0;
      idleWarningOpenRef.current = false;
      return undefined;
    }

    keepSessionActive();

    const markActivity = () => {
      if (!(isLoggedIn || isOwnerLoggedIn)) return;
      keepSessionActive();
    };

    const tickIdleState = () => {
      if (logoutInProgressRef.current) return;

      const now = Date.now();
      if (!idleDeadlineRef.current) {
        const idleMs = now - lastActivityRef.current;
        const warningWindowMs = IDLE_WARNING_SECONDS * 1000;
        const warningTriggerMs = Math.max(0, IDLE_TIMEOUT_MS - warningWindowMs);
        if (idleMs >= warningTriggerMs) {
          const remainingMsBeforeLogout = Math.max(0, IDLE_TIMEOUT_MS - idleMs);
          idleDeadlineRef.current = now + remainingMsBeforeLogout;
          setShowIdleWarningModal(true);
          idleWarningOpenRef.current = true;
        } else {
          return;
        }
      }

      const remainingSeconds = Math.max(0, Math.ceil((idleDeadlineRef.current - now) / 1000));
      setIdleCountdownSeconds(remainingSeconds);

      if (remainingSeconds <= 0) {
        performLogout({ redirectPage: "signin" });
      }
    };

    IDLE_ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true });
    });

    tickIdleState();
    const idleTimer = window.setInterval(tickIdleState, 1000);

    return () => {
      window.clearInterval(idleTimer);
      IDLE_ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity);
      });
    };
  }, [isLoggedIn, isOwnerLoggedIn, keepSessionActive, performLogout, logoutState.status]);

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

  useEffect(() => {
    dismissActionToasts();
  }, [user?._id]);

  useEffect(() => {
    seenReturnNotificationsRef.current.clear();
    if (!isLoggedIn || isOwnerLoggedIn || !user?._id || user.role === "admin") return undefined;

    const socket = getSocket();
    const handleReturnDecision = (notification) => {
      const event = String(notification?.event || "");
      if (event !== "vehicle_return.confirmed" && event !== "vehicle_return.declined") return;
      const notificationId = String(notification?._id || "");
      if (!notificationId || seenReturnNotificationsRef.current.has(notificationId)) return;
      seenReturnNotificationsRef.current.add(notificationId);

      const declined = event === "vehicle_return.declined";
      const finalFee = Number(notification?.data?.lateReturnPenaltyFee || 0);
      const message = declined
        ? "Return request declined. Booking stays active."
        : finalFee > 0
          ? "Vehicle return confirmed. A final late-return balance is ready."
          : "The owner confirmed receipt of the vehicle.";
      showActionToast(message, {
        id: `renter-return-${notificationId}`,
        tone: declined ? "warning" : "success",
      });
    };

    socket.on("notification:new", handleReturnDecision);
    return () => socket.off("notification:new", handleReturnDecision);
  }, [isLoggedIn, isOwnerLoggedIn, user?._id, user?.role]);

  const goToRealtimeChat = (context = null) => {
    if (!isLoggedIn) {
      setCurrentPage("signin");
      return;
    }
    setChatNavigationContext(normalizeChatNavigationContext(context));
    setCurrentPage("realtime-chat");
  };

  const clearChatNavigationContext = useCallback(() => {
    setChatNavigationContext(null);
  }, []);

  const goToNotifications = () => {
    if (!isLoggedIn) {
      setCurrentPage("signin");
      return;
    }
    setCurrentPage("notifications");
  };

  const openRenterNotificationsModal = () => {
    if (!isLoggedIn || isOwnerLoggedIn) {
      setCurrentPage("signin");
      return;
    }
    setShowRenterNotificationsModal(true);
  };

  const closeRenterNotificationsModal = () => {
    setShowRenterNotificationsModal(false);
  };

  const handleViewAllRenterNotifications = () => {
    setShowRenterNotificationsModal(false);
    goToNotifications();
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

    if (currentPage === "about") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setPendingScrollTarget("about");
    setCurrentPage("home");
  };

  const navigateToHelp = (slug = "", audience = "") => {
    const safeSlug = /^[a-z0-9-]+$/.test(String(slug)) ? String(slug) : "";
    const guideAudience = getHelpGuide(safeSlug)?.audience;
    const safeAudience = ["renter", "owner"].includes(audience)
      ? audience
      : guideAudience || (isOwnerLoggedIn ? "owner" : isLoggedIn ? "renter" : "");
    const route = safeSlug ? `/help/${safeSlug}` : safeAudience ? `/help/${safeAudience}` : "/help";
    if (window.location.pathname !== route) {
      window.history.pushState({ page: "help" }, "", route);
    }
    setHelpGuideSlug(safeSlug);
    setHelpAudience(safeAudience);
    setCurrentPage("help");
    window.scrollTo(0, 0);
  };

  const goToPrivacyPolicy = () => {
    if (currentPage === "privacy-policy") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setCurrentPage("privacy-policy");
  };

  const goToTermsAndConditions = () => {
    if (currentPage === "terms-and-conditions") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setCurrentPage("terms-and-conditions");
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

  if (logoutState.status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div role="alert">
            <h1 className="text-xl font-bold text-slate-900">Sign-out could not finish</h1>
            <p className="mt-3 text-sm text-slate-600">
              Check your connection and try again to finish signing out securely.
            </p>
          </div>
          <button
            type="button"
            className="rp-btn-primary mt-6 w-full py-3"
            onClick={() => performLogout({ redirectPage: logoutState.redirectPage })}
          >
            Retry sign out
          </button>
        </div>
      </main>
    );
  }

  if (logoutState.status === "pending") {
    return <SignOutProgress />;
  }

  if (isSessionBootstrapping) {
    return <SessionSkeleton page={currentPage} />;
  }

  if (sessionLoadError && SESSION_REQUIRED_PAGES.has(currentPage) && !isLoggedIn && !isOwnerLoggedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
        <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-neutral-50 p-8 text-center">
          <div role="alert">
            <h1 className="text-xl font-bold text-slate-900">Could not check your account</h1>
            <p className="mt-3 text-sm text-slate-700">{sessionLoadError}</p>
          </div>
          <button
            type="button"
            className="rp-btn-primary mt-6 w-full py-3"
            onClick={() => {
              setSessionLoadError("");
              setIsSessionBootstrapping(true);
              setSessionRetryCount((count) => count + 1);
            }}
          >
            Retry account check
          </button>
        </div>
      </main>
    );
  }

  return (
    <>
      {/* logout modal */}
      <LogoutModal
        isOpen={showLogoutModal}
        onCancel={cancelLogout}
        onConfirm={confirmLogout}
      />

      <IdleWarningModal
        isOpen={showIdleWarningModal}
        countdownSeconds={idleCountdownSeconds}
        idleMinutes={15}
        onStaySignedIn={keepSessionActive}
        onSignOut={() => performLogout({ redirectPage: "signin" })}
      />

      <RenterNotificationsModal
        isOpen={showRenterNotificationsModal}
        isLoggedIn={isLoggedIn && !isOwnerLoggedIn}
        onClose={closeRenterNotificationsModal}
        onViewAllNotifications={handleViewAllRenterNotifications}
      />

      {helpPanelGuideSlug !== null && (
        <HelpPanel
          key={helpPanelGuideSlug}
          guideSlug={helpPanelGuideSlug}
          audience={isOwnerLoggedIn ? "owner" : isLoggedIn ? "renter" : ""}
          onClose={closeHelp}
          onAskAI={[
            "home", "vehicles", "booking-history", "account-settings",
          ].includes(currentPage) ? () => {
            closeHelp();
            window.dispatchEvent(new Event(HELP_ASK_AI_EVENT));
          } : undefined}
        />
      )}

      <Suspense fallback={<RouteSkeleton page={currentPage} label="Loading page" />}>

      {currentPage === "help" && (
        <HelpPage
          guideSlug={helpGuideSlug}
          audience={helpAudience}
          isOwner={isOwnerLoggedIn}
          isRenter={isLoggedIn && !isOwnerLoggedIn}
          onSelectGuide={navigateToHelp}
          onReturn={() => setCurrentPage(isOwnerLoggedIn ? "owner-dashboard" : "home")}
        />
      )}

      {/* home */}
      {currentPage === "home" && (
        <RentifyPro
          isLoggedIn={isLoggedIn}
          user={user}
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToSignIn={() => setCurrentPage("signin")}
          onSignInToBook={beginBookingSignIn}
          onNavigateToAccountSettings={() => setCurrentPage("account-settings")}
          onNavigateToReports={() => setCurrentPage("reports")}
          onNavigateToVehicles={() => {
            setBookingData(getDefaultBookingData());
            setCurrentPage("vehicles");
          }}
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
          onOpenNotificationsModal={openRenterNotificationsModal}
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToAbout={navigateToAbout}
          onNavigateToContacts={navigateToContacts}
          onNavigateToPrivacyPolicy={goToPrivacyPolicy}
          onNavigateToTermsAndConditions={goToTermsAndConditions}
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
            setSessionLoadError("");
            setUser(userData);
            setSessionUser(userData);
            setRegisteredEmail("");
            setRegisteredPhone("");
            setRegisteredName("");
            setRegisterRole("user");
            setForgotEmail("");
            setForgotResetToken("");

            if (userData?.role === "admin") {
              setIsOwnerLoggedIn(false);
              setIsLoggedIn(true);
              localStorage.removeItem("isNewOwner");
              setCurrentPage("admin-dashboard");
            } else if (userData?.role === "owner") {
              setIsOwnerLoggedIn(true);
              setIsLoggedIn(false);
              localStorage.setItem("isNewOwner", "true");
              setCurrentPage("owner-dashboard");
            } else {
              setIsLoggedIn(true);
              setIsOwnerLoggedIn(false);
              if (!restoreBookingAfterSignIn()) setCurrentPage("home");
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
          onSignInToBook={beginBookingSignIn}
          onNavigateToVehicles={() => setCurrentPage("vehicles")}
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
          onOpenNotificationsModal={openRenterNotificationsModal}
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToAbout={navigateToAbout}
          onNavigateToContacts={navigateToContacts}
          onNavigateToAccountSettings={() => setCurrentPage("account-settings")}
          onNavigateToReports={() => setCurrentPage("reports")}
          onViewDetails={(vehicle) => {
            setSelectedVehicle(vehicle);
            setCurrentPage("vehicle-details");
          }}
          onLogout={requestLogout}
        />
      )}

      {/* vehicle details */}
      {currentPage === "vehicle-details" && !selectedVehicle?.name && (
        <RouteSkeleton page="vehicle-details" label="Loading selected vehicle" />
      )}
      {currentPage === "vehicle-details" && selectedVehicle?.name && (
        <VehicleDetailsPage
          vehicle={selectedVehicle}
          bookingData={bookingData}
          setBookingData={setBookingData}
          isLoggedIn={isLoggedIn}
          user={user}
          onBack={() => setCurrentPage("vehicles")}
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToSignIn={() => setCurrentPage("signin")}
          onSignInToBook={beginBookingSignIn}
          onNavigateToRegister={() => setCurrentPage("register")}
          onNavigateToVehicles={() => setCurrentPage("vehicles")}
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToChat={goToRealtimeChat}
          onNavigateToNotifications={goToNotifications}
          onNavigateToAbout={navigateToAbout}
          onNavigateToContacts={navigateToContacts}
          onNavigateToAccountSettings={() => setCurrentPage("account-settings")}
          onNavigateToReports={() => setCurrentPage("reports")}
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
            setSessionLoadError("");
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

            setRegisteredEmail("");
            setRegisteredPhone("");
            setRegisteredName("");
            setRegisterRole("user");

            if (role === "owner") {
              setIsOwnerLoggedIn(true);
              setIsLoggedIn(false);
              localStorage.setItem("isNewOwner", "true");
              setUser(userData);
              setSessionUser(userData);
              setCurrentPage("owner-dashboard");
            } else {
              setIsLoggedIn(true);
              setIsOwnerLoggedIn(false);
              setUser(userData);
              setSessionUser(userData);
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
          onNavigateToReports={() => setCurrentPage("reports")}
          onOpenOwnerDashboard={() => {
            localStorage.setItem("isNewOwner", "true");
            setIsOwnerLoggedIn(true);
            setIsLoggedIn(false);
            setCurrentPage("owner-dashboard");
          }}
          onNavigateToAbout={navigateToAbout}
          onLogout={requestLogout}
        />
      )}

      {currentPage === "about" && (
        <AboutPage
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
          onNavigateToReports={() => setCurrentPage("reports")}
          onNavigateToPrivacyPolicy={goToPrivacyPolicy}
          onNavigateToTermsAndConditions={goToTermsAndConditions}
          onLogout={requestLogout}
        />
      )}

      {currentPage === "privacy-policy" && (
        <PrivacyPolicyPage
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
          onNavigateToReports={() => setCurrentPage("reports")}
          onNavigateToTermsAndConditions={goToTermsAndConditions}
          onLogout={requestLogout}
        />
      )}

      {currentPage === "terms-and-conditions" && (
        <TermsAndConditionsPage
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
          onNavigateToReports={() => setCurrentPage("reports")}
          onNavigateToPrivacyPolicy={goToPrivacyPolicy}
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
          onOpenNotificationsModal={openRenterNotificationsModal}
          onNavigateToBookingHistory={goToBookingHistory}
          onNavigateToAccountSettings={() => setCurrentPage("account-settings")}
          onNavigateToReports={() => setCurrentPage("reports")}
          onLogout={requestLogout}
        />
      )}

      {currentPage === "reports" && isLoggedIn && (
        <ReportsCenter onBack={goToBookingHistory} />
      )}

      {currentPage === "realtime-chat" && (
        <RealtimeChatPage
          isLoggedIn={isLoggedIn}
          user={user}
          initialChatContext={chatNavigationContext}
          onChatContextHandled={clearChatNavigationContext}
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
          onNavigateToReports={() => setCurrentPage("reports")}
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
          onNavigateToReports={() => setCurrentPage("reports")}
          onLogout={requestLogout}
        />
      )}

      {currentPage === "not-found" && (
        <NotFoundPage
          onNavigateToHome={() => setCurrentPage("home")}
          onNavigateToVehicles={() => setCurrentPage("vehicles")}
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
      {currentPage === "owner-dashboard" && isOwnerLoggedIn && (
        <OwnerLayout onLogout={() => requestLogout("signin")} />
      )}

      {/* admin dashboard */}
      {currentPage === "admin-dashboard" && isLoggedIn && user?.role === "admin" && (
        <AdminLayout user={user} onLogout={requestLogout} />
      )}
      </Suspense>
    </>
  );
};

export default App;

