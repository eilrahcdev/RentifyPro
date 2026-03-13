import { useEffect, useState } from "react";
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
import Blockchain from "./pages/Blockchain";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import API from "../utils/api";
import { normalizeOwnerProfile, persistOwnerProfile } from "./utils/ownerProfile";

export default function OwnerLayout() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    const handler = (event) => {
      const page = event?.detail;
      if (typeof page === "string") setActivePage(page);
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
    setIsSidebarOpen(false);
  }, [activePage]);

  return (
    <div className="relative flex min-h-screen bg-gray-100 lg:h-screen">
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
        setActivePage={setActivePage}
        isMobileOpen={isSidebarOpen}
        onCloseMobile={() => setIsSidebarOpen(false)}
      />

      {/* main area */}
      <div className="flex min-h-screen flex-1 flex-col overflow-hidden lg:h-screen">
        {/* top bar */}
        <Topbar
          title={activePage}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          onNavigateToNotifications={() => setActivePage("Notifications")}
        />

        {/* page content */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
          {activePage === "Dashboard" && <Dashboard />}
          {activePage === "Vehicles" && <Vehicles />}
          {activePage === "Bookings" && <Bookings />}
          {activePage === "Messages" && <Messages />}
          {activePage === "Notifications" && <Notifications />}
          {activePage === "Reviews" && <Reviews />}
          {activePage === "Earnings" && <Earnings />}
          {activePage === "Analytics" && <Analytics />}
          {activePage === "Blockchain" && <Blockchain />}
          {activePage === "Settings" && <Settings />}
          {activePage === "Profile" && <Profile />}
        </main>
      </div>
    </div>
  );
}
