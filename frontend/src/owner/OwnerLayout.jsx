import { useCallback, useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import Dashboard from "./pages/Dashboard";
import Vehicles from "./pages/Vehicles";
import Bookings from "./pages/Bookings";
import Messages from "./pages/Messages";
import Notifications from "./pages/Notifications";
import Reviews from "./pages/Reviews";
import Earnings from "./pages/Earnings";
import Analytics from "./pages/Analytics";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import ReportsCenter from "../components/ReportsCenter";
import API from "../utils/api";
import { normalizeOwnerProfile, persistOwnerProfile } from "./utils/ownerProfile";

const OWNER_ACTIVE_PAGE_STORAGE_KEY = "rentifypro:owner-active-page";
const OWNER_PAGES = new Set([
  "Dashboard",
  "Vehicles",
  "Bookings",
  "Messages",
  "Notifications",
  "Reviews",
  "Earnings",
  "Analytics",
  "Settings",
  "Profile",
  "Reports",
]);

const normalizeOwnerPage = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized || !OWNER_PAGES.has(normalized)) return "Dashboard";
  return normalized;
};

export default function OwnerLayout({ onLogout }) {
  const [activePage, setActivePage] = useState(() => {
    const tabFromUrl = new URLSearchParams(window.location.search).get("tab");
    if (tabFromUrl) return normalizeOwnerPage(tabFromUrl);
    const tabFromStorage = sessionStorage.getItem(OWNER_ACTIVE_PAGE_STORAGE_KEY);
    return normalizeOwnerPage(tabFromStorage);
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setIsSidebarOpen(false), []);
  const navigateToPage = (page) => {
    setActivePage(normalizeOwnerPage(page));
    setIsSidebarOpen(false);
  };

  useEffect(() => {
    const handler = (event) => {
      const page = event?.detail;
      if (typeof page === "string") {
        setActivePage(normalizeOwnerPage(page));
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener("navigate", handler);
    return () => window.removeEventListener("navigate", handler);
  }, []);

  useEffect(() => {
    let mounted = true;

    const syncOwnerProfile = async () => {
      try {
        const response = await API.getProfile();
        if (!mounted || !response?.user || response.user.role !== "owner") return;
        const normalized = normalizeOwnerProfile(response.user, response.user);
        persistOwnerProfile(normalized);
        window.dispatchEvent(new Event("owner-profile-updated"));
      } catch {
        // Keep local profile data if sync fails.
      }
    };

    syncOwnerProfile();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsSidebarOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(OWNER_ACTIVE_PAGE_STORAGE_KEY, activePage);
    } catch {
      // Ignore storage errors.
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === activePage) return;
    params.set("tab", activePage);
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [activePage]);

  return (
    <div className="rp-owner-workspace relative flex min-h-dvh bg-[#f6f9fc] lg:h-dvh">
      {isSidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/45 lg:hidden"
        />
      )}

      {/* sidebar */}
      <Sidebar
        activePage={activePage}
        setActivePage={navigateToPage}
        isMobileOpen={isSidebarOpen}
        onCloseMobile={closeSidebar}
        onLogout={onLogout}
      />

      {/* main area */}
      <div inert={isSidebarOpen} className="flex min-h-dvh min-w-0 flex-1 flex-col overflow-hidden lg:h-dvh">
        {/* top bar */}
        <Topbar
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          onNavigateToNotifications={() => navigateToPage("Notifications")}
        />

        {/* page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-5 lg:p-6">
          {activePage === "Dashboard" && <Dashboard />}
          {activePage === "Vehicles" && <Vehicles />}
          {activePage === "Bookings" && <Bookings />}
          {activePage === "Messages" && <Messages />}
          {activePage === "Notifications" && <Notifications />}
          {activePage === "Reviews" && <Reviews />}
          {activePage === "Earnings" && <Earnings />}
          {activePage === "Analytics" && <Analytics />}
          {activePage === "Settings" && <Settings />}
          {activePage === "Profile" && <Profile />}
          {activePage === "Reports" && <ReportsCenter embedded ownerHeader />}
        </main>
      </div>
    </div>
  );
}
