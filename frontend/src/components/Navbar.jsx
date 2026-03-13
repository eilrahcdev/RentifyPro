import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Bot, Car, Menu, MessageCircle, Settings, X } from "lucide-react";
import API from "../utils/api";
import { getSocket } from "../utils/socket";
import { LIVE_COUNTERS_REFRESH_EVENT } from "../utils/liveCounters";
import { formatDisplayName, getInitialsFromName } from "../utils/dateUtils";
import { getSessionUser } from "../utils/sessionStore";

const linkClassName = (activePage, itemKey) =>
  `rp-link-pill whitespace-nowrap ${
    activePage === itemKey ? "text-[#0B75E7]" : "text-slate-700"
  }`;

const formatBadgeCount = (value) => (value > 99 ? "99+" : String(value));
const BRAND_LOGO_SRC = "/rentifypro%20logo.png";
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
  onNavigateToAccountSettings,
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
        API.getNotifications(),
        API.getConversations(),
      ]);

      if (notificationResult.status === "fulfilled") {
        const notifications = notificationResult.value.notifications || [];
        const notificationsUnread = notifications.reduce(
          (sum, notification) => sum + (notification.readAt ? 0 : 1),
          0
        );
        setUnreadNotifications(notificationsUnread);
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
      if (notification?.readAt) return;
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
    { key: "messages", label: "Messages", onClick: () => handleMobileNavigate(onNavigateToChat) },
    {
      key: "notifications",
      label: "Notifications",
      onClick: () => handleMobileNavigate(onNavigateToNotifications),
    },
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
    setShowMobileMenu(false);
  }, [activePage]);

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
      <nav className="fixed inset-x-0 top-0 z-50 px-3 sm:px-5 pt-3">
        <div className="rp-glass max-w-7xl mx-auto h-16 rounded-2xl border shadow-[0_10px_28px_rgba(2,20,46,0.12)]">
          <div className="h-full px-4 sm:px-6 flex items-center justify-between gap-4">
            <button
              onClick={handleHomeClick}
              className="flex items-center gap-2.5 text-xl sm:text-2xl font-extrabold hover:opacity-85 transition-opacity text-slate-900"
            >
              <img
                src={BRAND_LOGO_SRC}
                alt="RentifyPro logo"
                className="w-9 h-9 rounded-xl object-cover"
              />
              <span>
                Rentify<span className="text-[#0B75E7]">Pro</span>
              </span>
            </button>

            <div className="flex-1 hidden lg:flex justify-center px-2">
              <div className="flex items-center gap-1 bg-slate-50/90 border border-slate-200 rounded-full px-2 py-1">
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

            <div className="flex items-center gap-2 sm:gap-3">
              {isLoggedIn && (
                <div className="hidden lg:flex items-center gap-2 sm:gap-3">
                  <button
                    onClick={onNavigateToChat}
                    aria-label="Chatroom"
                    className="relative w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-[#DCEEFF] transition-all hover:-translate-y-0.5"
                  >
                    <MessageCircle size={18} className="text-[#0B75E7]" />
                    {unreadMessages > 0 && (
                      <span className="absolute -top-1 -right-1 bg-emerald-500 text-white text-[10px] min-w-[18px] h-[18px] flex items-center justify-center rounded-full font-semibold">
                        {formatBadgeCount(unreadMessages)}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={onNavigateToNotifications}
                    aria-label="Notifications"
                    className="relative w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-[#DCEEFF] transition-all hover:-translate-y-0.5"
                  >
                    <Bell size={18} className="text-[#0B75E7]" />
                    {unreadNotifications > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] min-w-[18px] h-[18px] flex items-center justify-center rounded-full font-semibold">
                        {formatBadgeCount(unreadNotifications)}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {!isLoggedIn ? (
                <>
                  <button
                    onClick={onNavigateToSignIn}
                    className="hidden sm:block px-3 py-2 rounded-xl text-slate-700 hover:bg-slate-100 transition"
                  >
                    Sign In
                  </button>
                  <button
                    onClick={onNavigateToRegister}
                    className="rp-btn-primary px-4 sm:px-5 py-2 text-sm"
                  >
                    Register
                  </button>
                </>
              ) : (
                <ProfileMenu
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
                  onLogout={() => {
                    setShowProfileMenu(false);
                    onLogout?.();
                  }}
                />
              )}

              <button
                type="button"
                onClick={() => setShowMobileMenu((prev) => !prev)}
                className="lg:hidden relative w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-[#DCEEFF] transition-all text-[#0B75E7]"
                aria-label={showMobileMenu ? "Close menu" : "Open menu"}
              >
                {showMobileMenu ? <X size={18} /> : <Menu size={18} />}
                {mobileUnreadTotal > 0 && !showMobileMenu && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] min-w-[18px] h-[18px] flex items-center justify-center rounded-full font-semibold">
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

          <div className="absolute right-3 top-20 w-[min(92vw,340px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.30)]">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">Navigation</p>
              <button
                type="button"
                onClick={() => setShowMobileMenu(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                aria-label="Close menu"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-2">
              {mobileNavItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onClick}
                  className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
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

      {onShowAI && !isAIOpen && (
        <button
          onClick={onShowAI}
          aria-label="AI Assistant"
          className="fixed bottom-6 right-6 z-[70] w-14 h-14 flex items-center justify-center rounded-2xl bg-gradient-to-br from-[#0B75E7] to-[#045FC3] hover:opacity-95 text-white shadow-2xl transition-all duration-300 hover:scale-105"
        >
          <Bot size={22} />
          <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-white" />
        </button>
      )}
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
  onLogout,
}) {
  const menuRef = useRef(null);
  const displayName = formatDisplayName(user?.name || "", "User");
  const displayInitials = getInitialsFromName(displayName);
  const [avatarError, setAvatarError] = useState(false);
  const avatar = String(user?.avatar || "").trim();

  useEffect(() => {
    setAvatarError(false);
  }, [avatar]);

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
        className="flex items-center gap-2 bg-slate-100 px-2.5 py-1.5 rounded-xl hover:bg-slate-200 transition-all"
      >
        {avatar && !avatarError ? (
          <img
            src={avatar}
            alt={displayName}
            className="w-8 h-8 rounded-lg object-cover border border-slate-200"
            onError={() => setAvatarError(true)}
          />
        ) : (
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#0B75E7] to-[#045FC3] text-white flex items-center justify-center text-sm font-bold">
            {displayInitials}
          </div>
        )}
        <span className="text-sm font-semibold hidden sm:block text-slate-800">
          {displayName}
        </span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-3 w-72 bg-white rounded-2xl shadow-2xl z-50 animate-fadeIn border border-slate-100 overflow-hidden">
          <div className="px-4 py-4 border-b border-slate-100 bg-slate-50">
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
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#017FE6]/10 transition-colors text-slate-700"
          >
            <Settings size={18} /> Account Settings
          </button>
          <button
            onClick={onBookingHistory}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#017FE6]/10 transition-colors text-slate-700"
          >
            <Car size={18} /> My Bookings
          </button>
          <button
            onClick={onLogout}
            className="w-full px-4 py-3 text-red-500 hover:bg-red-50 transition-colors flex items-center gap-3"
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
