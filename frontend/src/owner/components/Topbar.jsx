import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  CarFront,
  CircleHelp,
  Menu,
  Plus,
} from "lucide-react";
import API from "../../utils/api";
import { getSocket } from "../../utils/socket";
import { LIVE_COUNTERS_REFRESH_EVENT } from "../../utils/liveCounters";
import { getOwnerProfileFromStorage } from "../utils/ownerProfile";
import {
  SESSION_OWNER_PROFILE_UPDATED_EVENT,
} from "../../utils/sessionStore";
import { openHelp } from "../../utils/helpNavigation";

const isNotificationRead = (notification) =>
  Boolean(notification?.readAt);

const getGreetingPrefix = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
};

export default function Topbar({ onNavigateToNotifications, onToggleSidebar, isSidebarOpen = false }) {
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [owner, setOwner] = useState(() => getOwnerProfileFromStorage());

  useEffect(() => {
    const syncOwner = () => setOwner(getOwnerProfileFromStorage());
    window.addEventListener("owner-profile-updated", syncOwner);
    window.addEventListener(SESSION_OWNER_PROFILE_UPDATED_EVENT, syncOwner);
    return () => {
      window.removeEventListener("owner-profile-updated", syncOwner);
      window.removeEventListener(SESSION_OWNER_PROFILE_UPDATED_EVENT, syncOwner);
    };
  }, []);

  const syncUnreadNotifications = useCallback(async () => {
    try {
      const response = await API.getUnreadNotificationCount();
      setUnreadNotifications(Number(response.unreadCount || 0));
    } catch {
      // Keep current badge value when sync fails.
    }
  }, []);

  useEffect(() => {
    const initialSyncTimer = window.setTimeout(syncUnreadNotifications, 0);

    const refresh = () => syncUnreadNotifications();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncUnreadNotifications();
      }
    };

    window.addEventListener(LIVE_COUNTERS_REFRESH_EVENT, refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearTimeout(initialSyncTimer);
      window.removeEventListener(LIVE_COUNTERS_REFRESH_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [syncUnreadNotifications]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    const handleNotification = (notification) => {
      if (isNotificationRead(notification)) return;
      setUnreadNotifications((prev) => prev + 1);
    };

    socket.on("notification:new", handleNotification);
    return () => socket.off("notification:new", handleNotification);
  }, []);

  const displayFirstName = owner.firstName || owner.name?.split(/\s+/)?.[0] || "there";
  const greeting = `${getGreetingPrefix()}, ${displayFirstName}!`;

  return (
    <header
      className="sticky top-0 z-30 border-b border-white/20 bg-[linear-gradient(90deg,#056ed9_0%,#017fe6_58%,#0787ee_100%)]"
    >
      {/* top bar */}
      <div className="rp-owner-topbar min-h-16 px-3 py-2 sm:px-4 sm:py-0 sm:h-20 lg:px-6 flex items-center justify-between gap-2 sm:gap-6">

        {/* left side */}
        <div className="min-w-0 flex flex-1 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/15 text-white transition hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:hidden"
            aria-label={isSidebarOpen ? "Close menu" : "Open menu"}
            aria-expanded={isSidebarOpen}
            aria-controls="owner-navigation"
          >
            <Menu size={18} aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white leading-tight truncate" aria-label={greeting} title={greeting}>
              <span className="min-[480px]:hidden" aria-hidden="true">Hi, {displayFirstName}!</span>
              <span className="hidden min-[480px]:inline" aria-hidden="true">{greeting}</span>
            </h1>
            <p className="hidden md:block truncate text-sm text-white/80">
              Here&apos;s what&apos;s happening with your rentals today.
            </p>
          </div>
        </div>

        {/* right side */}
        <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-3">

          <button
            type="button"
            onClick={() => openHelp()}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-white/15 text-white transition hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            title="Help"
            aria-label="Help"
          >
            <CircleHelp size={18} aria-hidden="true" />
          </button>

          {/* notifications */}
          <button
            type="button"
            onClick={() => {
              if (onNavigateToNotifications) {
                onNavigateToNotifications();
                return;
              }
              window.dispatchEvent(new CustomEvent("navigate", { detail: "Notifications" }));
            }}
            className="
              relative h-11 w-11 shrink-0 rounded-xl
              bg-white/15 border border-white/20
              hover:bg-white/25 transition
              flex items-center justify-center
              focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white
            "
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell size={18} className="text-white" aria-hidden="true" />
            {unreadNotifications > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] min-w-[18px] h-[18px] flex items-center justify-center rounded-full font-semibold">
                {unreadNotifications > 99 ? "99+" : unreadNotifications}
              </span>
            )}
          </button>

          {/* add vehicle */}
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("navigate", { detail: "Vehicles" })
              );
              setTimeout(() => {
                window.dispatchEvent(new Event("open-add-vehicle"));
              }, 0);
            }}
            className="
              h-11 w-11 shrink-0 p-0 md:w-auto md:px-4 rounded-xl
              bg-white text-[#017FE6]
              font-semibold
              hover:bg-white/90 transition
              flex items-center justify-center gap-2
              focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white
            "
            style={{
              boxShadow: "0 10px 22px rgba(0,0,0,0.18)",
            }}
            aria-label="Add vehicle"
            title="Add vehicle"
          >
            <span className="relative h-6 w-6 md:hidden" aria-hidden="true">
              <CarFront size={20} className="absolute bottom-0 left-0" />
              <Plus size={12} strokeWidth={2.5} className="absolute right-0 top-0 rounded-full bg-white" />
            </span>
            <span className="hidden md:inline">Add Vehicle</span>
          </button>
        </div>
      </div>
    </header>
  );
}
