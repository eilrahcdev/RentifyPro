import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  CircleHelp,
  Plus,
  Menu,
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
      <div className="h-20 px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-3 sm:gap-6">

        {/* left side */}
        <div className="min-w-0 flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/15 text-white transition hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:hidden"
            aria-label={isSidebarOpen ? "Close menu" : "Open menu"}
            aria-expanded={isSidebarOpen}
            aria-controls="owner-navigation"
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-white leading-tight truncate">
              {greeting}
            </h1>
            <p className="hidden sm:block text-sm text-white/80">
              Here&apos;s what&apos;s happening with your rentals today.
            </p>
          </div>
        </div>

        {/* right side */}
        <div className="flex items-center gap-2 sm:gap-3">

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
              relative h-11 w-11 rounded-xl
              bg-white/15 border border-white/20
              hover:bg-white/25 transition
              flex items-center justify-center
            "
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell size={18} className="text-white" />
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
              h-11 px-3 sm:px-4 rounded-xl
              bg-white text-[#017FE6]
              font-semibold
              hover:bg-white/90 transition
              flex items-center gap-2
            "
            style={{
              boxShadow: "0 10px 22px rgba(0,0,0,0.18)",
            }}
            aria-label="Add vehicle"
          >
            <Plus size={18} />
            <span className="hidden sm:inline">Add Vehicle</span>
          </button>
        </div>
      </div>
    </header>
  );
}
