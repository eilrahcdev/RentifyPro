import { useCallback, useEffect, useState } from "react";
import {
  Search,
  Bell,
  Plus,
} from "lucide-react";
import API from "../../utils/api";
import { getSocket } from "../../utils/socket";
import { LIVE_COUNTERS_REFRESH_EVENT } from "../../utils/liveCounters";

export default function Topbar({ title, onNavigateToNotifications }) {
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const syncUnreadNotifications = useCallback(async () => {
    try {
      const response = await API.getNotifications();
      const unread = (response.notifications || []).reduce(
        (count, notification) => count + (notification.readAt ? 0 : 1),
        0
      );
      setUnreadNotifications(unread);
    } catch {
      // Keep current badge value when sync fails.
    }
  }, []);

  useEffect(() => {
    syncUnreadNotifications();

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
      window.removeEventListener(LIVE_COUNTERS_REFRESH_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [syncUnreadNotifications]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    const handleNotification = (notification) => {
      if (notification?.readAt) return;
      setUnreadNotifications((prev) => prev + 1);
    };

    socket.on("notification:new", handleNotification);
    return () => socket.off("notification:new", handleNotification);
  }, []);

  return (
    <header
  className="sticky top-0 z-40 bg-[#017FE6] border-b border-white/20"
      style={{
        background: "#017FE6",
        borderBottom: "1px solid rgba(255,255,255,0.20)",
      }}
    >
      {/* top bar */}
      <div className="h-20 px-6 flex items-center justify-between gap-6">

        {/* left side */}
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white leading-tight">
            {title}
          </h1>
          <p className="text-sm text-white/80">
            Welcome back! Here's what's happening today.
          </p>
        </div>

        {/* right side */}
        <div className="flex items-center gap-3">

          {/* search */}
          <div className="relative hidden md:block">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-white/70"
            />
            <input
              placeholder="Search..."
              className="
                w-72 h-10 rounded-xl
                bg-white/15 border border-white/20
                pl-10 pr-4 text-sm
                text-white placeholder:text-white/60
                outline-none
                focus:ring-2 focus:ring-white/25
              "
            />
          </div>

          {/* notifications */}
          <button
            onClick={() => {
              if (onNavigateToNotifications) {
                onNavigateToNotifications();
                return;
              }
              window.dispatchEvent(new CustomEvent("navigate", { detail: "Notifications" }));
            }}
            className="
              relative w-10 h-10 rounded-xl
              bg-white/15 border border-white/20
              hover:bg-white/25 transition
              flex items-center justify-center
            "
            title="Notifications"
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
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("navigate", { detail: "Vehicles" })
              );
              setTimeout(() => {
                window.dispatchEvent(new Event("open-add-vehicle"));
              }, 0);
            }}
            className="
              h-10 px-4 rounded-xl
              bg-white text-[#017FE6]
              font-semibold
              hover:bg-white/90 transition
              flex items-center gap-2
            "
            style={{
              boxShadow: "0 10px 22px rgba(0,0,0,0.18)",
            }}
          >
            <Plus size={18} />
            Add Vehicle
          </button>
        </div>
      </div>
    </header>
  );
}

