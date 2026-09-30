import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  LayoutDashboard,
  CarFront,
  CalendarDays,
  MessageCircle,
  Star,
  Wallet,
  BarChart3,
  ShieldAlert,
  LogOut,
  ChevronRight,
  X,
} from "lucide-react";
import { getOwnerProfileFromStorage } from "../utils/ownerProfile";
import API from "../../utils/api";
import { getSocket } from "../../utils/socket";
import {
  SESSION_OWNER_PROFILE_UPDATED_EVENT,
} from "../../utils/sessionStore";
import { LIVE_COUNTERS_REFRESH_EVENT } from "../../utils/liveCounters";
import "./Sidebar.css";

const BRAND_LOGO_SRC = "/rentifypro-logo-optimized.png";

function Sidebar({
  activePage,
  setActivePage,
  isMobileOpen = false,
  onCloseMobile,
  onLogout,
}) {
  const [owner, setOwner] = useState(() => getOwnerProfileFromStorage());
  const [unreadMessages, setUnreadMessages] = useState(0);
  const sidebarRef = useRef(null);

  useEffect(() => {
    if (!isMobileOpen) return undefined;

    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector("button")?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseMobile?.();
      }
      if (event.key !== "Tab") return;
      const buttons = [...sidebarRef.current.querySelectorAll("button:not(:disabled)")];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isMobileOpen, onCloseMobile]);

  useEffect(() => {
    const syncOwner = () => {
      setOwner(getOwnerProfileFromStorage());
    };

    window.addEventListener("owner-profile-updated", syncOwner);
    window.addEventListener(SESSION_OWNER_PROFILE_UPDATED_EVENT, syncOwner);

    return () => {
      window.removeEventListener("owner-profile-updated", syncOwner);
      window.removeEventListener(SESSION_OWNER_PROFILE_UPDATED_EVENT, syncOwner);
    };
  }, []);

  /* ── badge counters ─────────────────────────────────── */
  const syncBadges = useCallback(async () => {
    try {
      const threadsRes = await API.getOwnerRenterThreads().catch(() => ({ renters: [] }));

      const totalUnreadMessages = (threadsRes.renters || []).reduce(
        (sum, t) => sum + Number(t.unreadCount || 0),
        0
      );
      setUnreadMessages(totalUnreadMessages);
    } catch {
      // Keep current badge values when sync fails.
    }
  }, []);

  useEffect(() => {
    const initialSyncTimer = window.setTimeout(syncBadges, 0);

    const refresh = () => syncBadges();
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncBadges();
    };

    window.addEventListener(LIVE_COUNTERS_REFRESH_EVENT, refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearTimeout(initialSyncTimer);
      window.removeEventListener(LIVE_COUNTERS_REFRESH_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [syncBadges]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    const onNewMessage = () => setUnreadMessages((p) => p + 1);

    socket.on("message:new", onNewMessage);

    return () => {
      socket.off("message:new", onNewMessage);
    };
  }, []);

  const getInitials = (first, last) =>
    `${first?.[0] || ""}${last?.[0] || ""}`.toUpperCase();

  const displayName =
    `${owner.firstName || ""} ${owner.lastName || ""}`.trim() ||
    owner.name ||
    "Owner";
  const displayEmail = owner.email || "Manage your profile";

  const menuItems = [
    { id: "Dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "Vehicles", label: "My Vehicles", icon: CarFront },
    { id: "Bookings", label: "Bookings", icon: CalendarDays },
    { id: "Messages", label: "Messages", icon: MessageCircle, badge: unreadMessages },
    { id: "Reviews", label: "Reviews", icon: Star },
    { id: "Earnings", label: "Earnings", icon: Wallet },
    { id: "Analytics", label: "Analytics", icon: BarChart3 },
    { id: "Reports", label: "Reports", icon: ShieldAlert },
  ];
  const menuGroups = [
    { label: "Workspace", items: menuItems.slice(0, 4) },
    { label: "Business", items: menuItems.slice(4) },
  ];

  const openLogoutModal = () => {
    onCloseMobile?.();
    onLogout?.();
  };

  return (
    <>
      <aside
        ref={sidebarRef}
        id="owner-navigation"
        aria-label="Owner workspace"
        role={isMobileOpen ? "dialog" : undefined}
        aria-modal={isMobileOpen ? true : undefined}
        className={`rp-owner-sidebar${isMobileOpen ? " rp-owner-sidebar--open" : ""}`}
      >
        <div className="rp-owner-sidebar__brand">
          <img
            src={BRAND_LOGO_SRC}
            alt=""
            className="rp-owner-sidebar__logo"
          />
          <div className="rp-owner-sidebar__brand-copy">
            <p className="rp-owner-sidebar__brand-name">Rentify<span>Pro</span></p>
            <p className="rp-owner-sidebar__brand-caption">Owner workspace</p>
          </div>
          <button type="button" className="rp-icon-button rp-owner-sidebar__close" onClick={onCloseMobile} aria-label="Close menu">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="rp-owner-sidebar__profile-wrap">
          <button
            type="button"
            onClick={() => {
              setActivePage("Profile");
              onCloseMobile?.();
            }}
            className="rp-owner-sidebar__profile"
            aria-current={activePage === "Profile" ? "page" : undefined}
            aria-label={`Edit profile for ${displayName}`}
          >
            <span className="rp-owner-sidebar__avatar">
              {owner.avatar ? (
                <img
                  src={owner.avatar}
                  alt=""
                />
              ) : (
                getInitials(owner.firstName, owner.lastName) || "O"
              )}
            </span>
            <span className="rp-owner-sidebar__profile-copy">
              <span className="rp-owner-sidebar__profile-name" title={displayName}>{displayName}</span>
              <span className="rp-owner-sidebar__profile-email" title={owner.email || undefined}>{displayEmail}</span>
              <span className="rp-owner-sidebar__profile-action">Edit profile</span>
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>

        <nav className="rp-owner-sidebar__nav" aria-label="Owner navigation">
          {menuGroups.map((group) => (
            <div className="rp-owner-sidebar__group" key={group.label}>
              <p className="rp-owner-sidebar__group-label" id={`owner-nav-${group.label.toLowerCase()}`}>{group.label}</p>
              <ul aria-labelledby={`owner-nav-${group.label.toLowerCase()}`}>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActivePage(item.id);
                        onCloseMobile?.();
                      }}
                      className="rp-owner-sidebar__link"
                      aria-current={activePage === item.id ? "page" : undefined}
                    >
                      <span className="rp-owner-sidebar__icon"><item.icon size={19} strokeWidth={1.8} aria-hidden="true" /></span>
                      <span className="rp-owner-sidebar__link-label">{item.label}</span>
                      {item.badge > 0 && (
                        <span
                          className="rp-owner-sidebar__badge"
                          aria-label={`${item.badge} unread messages`}
                        >
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="rp-owner-sidebar__footer">
          <button
            type="button"
            onClick={openLogoutModal}
            className="rp-owner-sidebar__logout"
          >
            <LogOut size={19} strokeWidth={1.8} aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
