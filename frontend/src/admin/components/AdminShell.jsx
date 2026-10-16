import { useEffect, useRef, useState } from "react";
import { CalendarCheck2, Car, FileCheck2, Flag, LayoutDashboard, LogOut, Menu, ReceiptText, ScrollText, ShieldCheck, UserRound, Users, X } from "lucide-react";
import LogoutModal from "../../components/LogoutModal";
import useScrollLock from "../../components/useScrollLock";

const groups = [
  { label: "Overview", items: [{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  { label: "Operations", items: [
    { id: "bookings", label: "Bookings", icon: CalendarCheck2 },
    { id: "transactions", label: "Transaction Records", icon: ReceiptText },
  ] },
  { label: "Fleet", items: [{ id: "vehicles", label: "Vehicles", icon: Car }] },
  { label: "Customers", items: [
    { id: "customers", label: "Customers", icon: Users },
    { id: "documents", label: "Documents", icon: FileCheck2 },
  ] },
  { label: "Governance", items: [
    { id: "reports", label: "User Reports", icon: Flag },
    { id: "audit", label: "Audit Logs", icon: ScrollText },
    { id: "security", label: "Security", icon: ShieldCheck },
  ] },
];

export function AdminSidebar({ activeView, displayName, displayEmail, mobileOpen, onClose, onSelect, onLogout }) {
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [desktopNavigation, setDesktopNavigation] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  const closeMenuRef = useRef(null);
  const sidebarHidden = !desktopNavigation && !mobileOpen;
  useScrollLock(!desktopNavigation && mobileOpen);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleChange = (event) => {
      setDesktopNavigation(event.matches);
      if (event.matches) onClose?.();
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [onClose]);

  useEffect(() => {
    if (desktopNavigation || !mobileOpen) return undefined;
    closeMenuRef.current?.focus();
    const trapNavigationFocus = (event) => {
      if (event.key !== "Tab") return;
      const controls = [...closeMenuRef.current.closest("aside").querySelectorAll("button:not([disabled])")].filter((element) => element.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trapNavigationFocus);
    return () => {
      document.removeEventListener("keydown", trapNavigationFocus);
    };
  }, [desktopNavigation, mobileOpen]);

  const openLogoutModal = () => {
    setIsLogoutModalOpen(true);
    onClose?.();
  };

  const confirmLogout = () => {
    setIsLogoutModalOpen(false);
    void onLogout();
  };

  return (
    <>
      <LogoutModal isOpen={isLogoutModalOpen} onCancel={() => setIsLogoutModalOpen(false)} onConfirm={confirmLogout} />
      {mobileOpen ? <button type="button" aria-label="Close navigation" onClick={onClose} className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[2px] lg:hidden" /> : null}
      <aside id="admin-navigation" aria-label="Admin navigation panel" inert={sidebarHidden} aria-hidden={sidebarHidden || undefined} className={`fixed inset-y-0 left-0 z-50 h-dvh w-[260px] border-r border-slate-200 bg-white transition-transform duration-200 lg:w-64 lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-[18px]">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50"><img src="/rentifypro-logo.png" alt="RentifyPro logo" className="h-8 w-8 object-contain" /></span>
            <div className="min-w-0 flex-1"><p className="text-lg font-extrabold tracking-[-0.025em] text-[#171717]">Rentify<span className="text-blue-600">Pro</span></p><p className="text-[11px] font-medium text-slate-400">Admin Control Panel</p></div>
            <button ref={closeMenuRef} type="button" onClick={onClose} aria-label="Close menu" className="admin-icon-button text-slate-500 hover:bg-slate-100 lg:hidden"><X size={18} /></button>
          </div>

          <div className="mx-3 mt-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm"><UserRound size={18} /></div>
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{displayName}</p><p className="truncate text-[11px] text-slate-500" title={displayEmail}>{displayEmail}</p></div>
          </div>

          <nav aria-label="Admin navigation" className="flex-1 overflow-y-auto px-3 py-5">
            <div className="space-y-6">
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="admin-section-label mb-2 px-3 text-slate-500">{group.label}</p>
                  <div className="space-y-1">
                    {group.items.map(({ id, label, icon: Icon }) => {
                      const active = activeView === id;
                      return <button key={id} type="button" aria-current={active ? "page" : undefined} onClick={() => onSelect(id)} className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 ${active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>{active ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-blue-600" /> : null}<Icon size={18} strokeWidth={active ? 2.25 : 1.8} /><span>{label}</span></button>;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </nav>

          <div className="border-t border-slate-100 p-3">
            <button type="button" onClick={openLogoutModal} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><LogOut size={18} />Sign Out</button>
          </div>
        </div>
      </aside>
    </>
  );
}

export function AdminPageHeader({ title, description, onMenuOpen, menuButtonRef, menuOpen, actions, stackActionsOnMobile = false }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-4 sm:px-6 lg:px-7">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-start justify-between gap-3">
        <div className={`flex min-w-0 flex-1 items-start gap-3 ${stackActionsOnMobile ? "basis-full sm:basis-0" : ""}`}>
          <button ref={menuButtonRef} type="button" aria-label="Open navigation" aria-controls="admin-navigation" aria-expanded={menuOpen} onClick={onMenuOpen} className="admin-icon-button border border-slate-300 text-slate-700 hover:bg-slate-50 lg:hidden"><Menu size={20} /></button>
          <div className="min-w-0"><h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl lg:text-[28px]">{title}</h1><p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">{description}</p></div>
        </div>
        {actions ? <div className={`flex shrink-0 flex-wrap gap-3 ${stackActionsOnMobile ? "ml-auto" : ""}`}>{actions}</div> : null}
      </div>
    </header>
  );
}
