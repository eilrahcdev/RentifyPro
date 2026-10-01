import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CalendarDays, CircleHelp, Flag, LogOut, Menu, MessageCircle, Settings, X } from "lucide-react";
import API from "../utils/api";
import { getSocket } from "../utils/socket";
import { LIVE_COUNTERS_REFRESH_EVENT } from "../utils/liveCounters";
import { formatDisplayName, getInitialsFromName } from "../utils/dateUtils";
import { getSessionUser } from "../utils/sessionStore";
import { openHelp } from "../utils/helpNavigation";
import ChatLauncher from "./ChatLauncher";

const linkClassName = (activePage, itemKey) =>
  `rp-link-pill whitespace-nowrap ${
    activePage === itemKey ? "text-[#0B75E7]" : "text-slate-700"
  }`;

const formatBadgeCount = (value) => (value > 99 ? "99+" : String(value));
const BRAND_LOGO_SRC = "/rentifypro-logo-optimized.png";
const isNotificationRead = (notification) =>
  Boolean(notification?.readAt);
const getStoredUserId = () => {
  return String(getSessionUser()?._id || "");
};

export default function Navbar({
  activePage = "home",
  isLoggedIn,
  user,
  isAIOpen = false,
  onNavigateToHome,
  onNavigateToSignIn,
  onNavigateToRegister,
  onNavigateToVehicles,
  onNavigateToBookingHistory,
  onNavigateToAbout,
  onNavigateToContacts,
  onNavigateToChat,
  onNavigateToNotifications,
  onOpenNotificationsModal,
  onNavigateToAccountSettings,
  onNavigateToReports,
  onShowAI,
  onLogout,
}) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const currentUserId = String(user?._id || getStoredUserId() || "");
  const mobileUnreadTotal = unreadMessages + unreadNotifications;

  const syncUnreadCounts = useCallback(async () => {
    if (!isLoggedIn) {
      setUnreadMessages(0);
      setUnreadNotifications(0);
      return;
    }

    try {
      const [notificationResult, conversationResult] = await Promise.allSettled([
        API.getUnreadNotificationCount(),
        API.getConversations(),
      ]);

      if (notificationResult.status === "fulfilled") {
        setUnreadNotifications(Number(notificationResult.value.unreadCount || 0));
      }

      if (conversationResult.status === "fulfilled") {
        const conversations = conversationResult.value.conversations || [];
        const messagesUnread = conversations.reduce(
          (sum, conversation) => sum + Number(conversation.unreadCount || 0),
          0
        );
        setUnreadMessages(messagesUnread);
      }
    } catch {
      // Keep the current values if sync fails.
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return undefined;

    const initialSyncTimer = window.setTimeout(() => {
      syncUnreadCounts();
    }, 0);

    const refreshFromServer = () => {
      syncUnreadCounts();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncUnreadCounts();
      }
    };

    window.addEventListener(LIVE_COUNTERS_REFRESH_EVENT, refreshFromServer);
    window.addEventListener("focus", refreshFromServer);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearTimeout(initialSyncTimer);
      window.removeEventListener(LIVE_COUNTERS_REFRESH_EVENT, refreshFromServer);
      window.removeEventListener("focus", refreshFromServer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isLoggedIn, syncUnreadCounts]);

  useEffect(() => {
    if (!isLoggedIn) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;

    const handleConnected = () => {
      syncUnreadCounts();
    };
    const handleNotification = (notification) => {
      if (isNotificationRead(notification)) return;
      setUnreadNotifications((prev) => prev + 1);
    };
    const handleMessage = (message) => {
      const receiverId = String(message?.receiver?._id || message?.receiver || "");
      if (!receiverId || receiverId !== currentUserId) return;
      setUnreadMessages((prev) => prev + 1);
    };

    socket.on("connect", handleConnected);
    socket.on("notification:new", handleNotification);
    socket.on("chat:message", handleMessage);

    return () => {
      socket.off("connect", handleConnected);
      socket.off("notification:new", handleNotification);
      socket.off("chat:message", handleMessage);
    };
  }, [currentUserId, isLoggedIn, syncUnreadCounts]);

  const handleHomeClick = () => {
    if (activePage === "home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    onNavigateToHome?.();
  };

  const handleMobileNavigate = (navigateFn) => {
    setShowMobileMenu(false);
    navigateFn?.();
  };

  const handleNotificationClick = () => {
    if (typeof onOpenNotificationsModal === "function") {
      onOpenNotificationsModal();
      return;
    }
    onNavigateToNotifications?.();
  };

  const isMobileItemActive = (key) => {
    const pathname = typeof window !== "undefined" ? window.location.pathname : "";
    if (key === "home") return activePage === "home" || pathname === "/";
    if (key === "vehicles") return activePage === "vehicles" || pathname === "/vehicles";
    if (key === "bookings") return activePage === "bookings" || pathname === "/bookings";
    if (key === "about") return activePage === "about" || pathname === "/about";
    if (key === "contacts") return activePage === "contacts";
    if (key === "messages") return activePage === "chat" || pathname === "/chat";
    if (key === "notifications") return activePage === "notifications" || pathname === "/notifications";
    return false;
  };

  const mobileNavItems = [
    { key: "home", label: "Home", onClick: () => handleMobileNavigate(handleHomeClick) },
    { key: "vehicles", label: "Vehicles", onClick: () => handleMobileNavigate(onNavigateToVehicles) },
    { key: "bookings", label: "Bookings", onClick: () => handleMobileNavigate(onNavigateToBookingHistory) },
    { key: "about", label: "About", onClick: () => handleMobileNavigate(onNavigateToAbout) },
    { key: "contacts", label: "Contacts", onClick: () => handleMobileNavigate(onNavigateToContacts) },
    { key: "help", label: "Help", onClick: () => handleMobileNavigate(() => openHelp()) },
    { key: "messages", label: "Messages", onClick: () => handleMobileNavigate(onNavigateToChat) },
    {
      key: "notifications",
      label: "Notifications",
      onClick: () => handleMobileNavigate(handleNotificationClick),
    },
    ...(!isLoggedIn
      ? [
          { key: "signin", label: "Sign In", onClick: () => handleMobileNavigate(onNavigateToSignIn) },
          { key: "register", label: "Register", onClick: () => handleMobileNavigate(onNavigateToRegister) },
        ]
      : []),
  ];

  useEffect(() => {
    if (!showMobileMenu) return undefined;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [showMobileMenu]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setShowMobileMenu(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
      <>
      <nav className="rp-site-navbar fixed inset-x-0 top-0 z-50 px-3 sm:px-5 pt-3">
        <div className="rp-glass mx-auto max-w-7xl rounded-3xl border border-white/70 shadow-[0_18px_40px_rgba(2,20,46,0.12)]">
          <div className="rp-site-navbar__bar flex min-h-[4.25rem] items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-6">
            <button
              onClick={handleHomeClick}
              className="rp-site-navbar__brand flex min-w-0 items-center gap-2 text-base font-extrabold tracking-[-0.03em] text-slate-900 transition-opacity hover:opacity-85 sm:gap-3 sm:text-[1.35rem]"
            >
              <img
                src={BRAND_LOGO_SRC}
                alt="RentifyPro logo"
                className="rp-site-navbar__brand-logo h-9 w-9 shrink-0 rounded-full object-cover sm:h-10 sm:w-10"
              />
              <span>
                Rentify<span className="text-[#0B75E7]">Pro</span>
              </span>
            </button>

            <div className="flex-1 hidden lg:flex justify-center px-2">
              <div className="flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/75 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                <button
                  onClick={handleHomeClick}
                  data-active={activePage === "home"}
                  className={linkClassName(activePage, "home")}
                >
                  Home
                </button>
                <button
                  onClick={onNavigateToVehicles}
                  data-active={activePage === "vehicles"}
                  className={linkClassName(activePage, "vehicles")}
                >
                  Vehicles
                </button>
                <button
                  onClick={onNavigateToBookingHistory}
                  data-active={activePage === "bookings"}
                  className={linkClassName(activePage, "bookings")}
                >
                  Bookings
                </button>
                <button
                  onClick={onNavigateToAbout}
                  data-active={activePage === "about"}
                  className={linkClassName(activePage, "about")}
                >
                  About
                </button>
                <button
                  onClick={onNavigateToContacts}
                  data-active={activePage === "contacts"}
                  className={linkClassName(activePage, "contacts")}
                >
                  Contacts
                </button>
              </div>
            </div>

            <div className="rp-site-navbar__actions flex shrink-0 items-center gap-2 sm:gap-3">
              <div className="hidden lg:flex items-center gap-2 sm:gap-3">
                {isLoggedIn && (
                  <button
                    onClick={onNavigateToChat}
                    aria-label="Chatroom"
                    className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/80 text-[#0B75E7] shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-100 hover:bg-blue-50/90"
                  >
                    <MessageCircle size={18} className="text-[#0B75E7]" />
                    {unreadMessages > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold text-white shadow-sm">
                        {formatBadgeCount(unreadMessages)}
                      </span>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openHelp()}
                  aria-label="Help"
                  title="Help"
                  className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/80 text-[#0B75E7] shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-100 hover:bg-blue-50/90"
                >
                  <CircleHelp size={18} className="text-[#0B75E7]" aria-hidden="true" />
                </button>
                {isLoggedIn && (
                  <button
                    onClick={handleNotificationClick}
                    aria-label="Notifications"
                    className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/80 text-[#0B75E7] shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-100 hover:bg-blue-50/90"
                  >
                    <Bell size={18} className="text-[#0B75E7]" />
                    {unreadNotifications > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white shadow-sm">
                        {formatBadgeCount(unreadNotifications)}
                      </span>
                    )}
                  </button>
                )}
              </div>

              {!isLoggedIn ? (
                <>
                  <button
                    onClick={onNavigateToSignIn}
                    className="hidden rounded-2xl px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-white/80 hover:text-slate-900 sm:inline-flex"
                  >
                    Sign In
                  </button>
                  <div className="hidden sm:block">
                    <button
                      onClick={onNavigateToRegister}
                      className="rp-btn-primary px-4 py-2.5 text-sm sm:px-5"
                    >
                      Register
                    </button>
                  </div>
                </>
              ) : (
                <ProfileMenu
                  key={`${user?._id || "user"}-${user?.avatar || "no-avatar"}`}
                  user={user}
                  isOpen={showProfileMenu}
                  onToggle={() => setShowProfileMenu(!showProfileMenu)}
                  onClose={() => setShowProfileMenu(false)}
                  onAccountSettings={() => {
                    setShowProfileMenu(false);
                    onNavigateToAccountSettings?.();
                  }}
                  onBookingHistory={() => {
                    setShowProfileMenu(false);
                    onNavigateToBookingHistory?.();
                  }}
                  onReports={
                    typeof onNavigateToReports === "function"
                      ? () => {
                          setShowProfileMenu(false);
                          onNavigateToReports();
                        }
                      : undefined
                  }
                  onLogout={() => {
                    setShowProfileMenu(false);
                    onLogout?.();
                  }}
                />
              )}

              <button
                type="button"
                onClick={() => setShowMobileMenu((prev) => !prev)}
                className="rp-site-navbar__menu-trigger relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/80 text-[#0B75E7] shadow-sm transition-all hover:border-blue-100 hover:bg-blue-50/90 lg:hidden"
                aria-label={showMobileMenu ? "Close menu" : "Open menu"}
              >
                {showMobileMenu ? <X size={18} /> : <Menu size={18} />}
                {mobileUnreadTotal > 0 && !showMobileMenu && (
                  <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white shadow-sm">
                    {formatBadgeCount(mobileUnreadTotal)}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {showMobileMenu && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            aria-label="Close menu backdrop"
            onClick={() => setShowMobileMenu(false)}
            className="absolute inset-0 bg-slate-900/35 backdrop-blur-[1px]"
          />

          <div className="absolute right-3 top-20 w-[min(92vw,352px)] overflow-hidden rounded-3xl border border-slate-200/90 bg-white/95 shadow-[0_30px_80px_rgba(15,23,42,0.28)] backdrop-blur">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <p className="text-sm font-semibold text-slate-900">Navigation</p>
              <button
                type="button"
                onClick={() => setShowMobileMenu(false)}
                className="rp-icon-button"
                aria-label="Close menu"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            <div className="p-2">
              {mobileNavItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onClick}
                  className={`flex w-full items-center justify-between rounded-2xl px-3.5 py-3 text-left text-sm font-semibold transition ${
                    isMobileItemActive(item.key)
                      ? "bg-[#017FE6]/10 text-[#017FE6]"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span>{item.label}</span>
                  {item.key === "messages" && unreadMessages > 0 && (
                    <span className="min-w-[22px] rounded-full bg-emerald-500 px-1.5 py-0.5 text-center text-[11px] font-semibold text-white">
                      {formatBadgeCount(unreadMessages)}
                    </span>
                  )}
                  {item.key === "notifications" && unreadNotifications > 0 && (
                    <span className="min-w-[22px] rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[11px] font-semibold text-white">
                      {formatBadgeCount(unreadNotifications)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {onShowAI && <ChatLauncher isOpen={isAIOpen} onOpen={onShowAI} />}
    </>
  );
}

function ProfileMenu({
  user,
  isOpen,
  onToggle,
  onClose,
  onAccountSettings,
  onBookingHistory,
  onReports,
  onLogout,
}) {
  const menuRef = useRef(null);
  const displayName = formatDisplayName(user?.name || "", "User");
  const displayInitials = getInitialsFromName(displayName);
  const [avatarError, setAvatarError] = useState(false);
  const avatar = String(user?.avatar || "").trim();

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/75 px-2.5 py-2 shadow-sm transition-all hover:bg-white"
      >
        {avatar && !avatarError ? (
          <img
            src={avatar}
            alt={displayName}
            className="h-8 w-8 shrink-0 rounded-full border border-slate-200 object-cover"
            onError={() => setAvatarError(true)}
          />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0B75E7] to-[#045FC3] text-sm font-bold text-white">
            {displayInitials}
          </div>
        )}
        <span className="text-sm font-semibold hidden sm:block text-slate-800">
          {displayName}
        </span>
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-3 w-72 overflow-hidden rounded-3xl border border-slate-200/90 bg-white/95 shadow-[0_28px_70px_rgba(15,23,42,0.22)] backdrop-blur animate-fadeIn">
          <div className="border-b border-slate-100 bg-slate-50/90 px-4 py-4">
            <div className="flex items-center gap-3">
              {avatar && !avatarError ? (
                <img
                  src={avatar}
                  alt={displayName}
                  className="w-10 h-10 rounded-full object-cover border border-slate-200"
                  onError={() => setAvatarError(true)}
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#0B75E7] to-[#045FC3] text-white flex items-center justify-center text-sm font-bold">
                  {displayInitials}
                </div>
              )}
              <div>
                <p className="font-semibold text-slate-900">{displayName}</p>
                <p className="text-sm text-slate-500">{user?.email || ""}</p>
              </div>
            </div>
          </div>
          <button
            onClick={onAccountSettings}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-[#017FE6]/10"
          >
            <Settings size={18} /> Account Settings
          </button>
          <button
            onClick={onBookingHistory}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-[#017FE6]/10"
          >
            <CalendarDays size={18} strokeWidth={2} aria-hidden="true" /> My Bookings
          </button>
          {onReports && (
            <button
              onClick={onReports}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-[#017FE6]/10"
            >
              <Flag size={18} /> My Reports
            </button>
          )}
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-sm font-medium text-red-500 transition-colors hover:bg-red-50"
          >
            <LogOut size={18} strokeWidth={2} aria-hidden="true" /> Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
