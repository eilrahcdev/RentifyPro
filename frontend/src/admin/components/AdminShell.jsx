import { CalendarDays, CarFront, FileText, LayoutDashboard, LogOut, Menu, ReceiptText, ShieldAlert, User, Users, X } from "lucide-react";

const groups = [
  { label: "Overview", items: [{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  { label: "Operations", items: [
    { id: "bookings", label: "Bookings", icon: CalendarDays },
    { id: "transactions", label: "Transaction Records", icon: ReceiptText },
  ] },
  { label: "Fleet", items: [{ id: "vehicles", label: "Vehicles", icon: CarFront }] },
  { label: "Customers", items: [
    { id: "customers", label: "Customers", icon: Users },
    { id: "documents", label: "Documents", icon: FileText },
    { id: "reports", label: "Reports", icon: ShieldAlert },
  ] },
];

export function AdminSidebar({ activeView, displayName, displayEmail, mobileOpen, onClose, onSelect, onLogout }) {
  return (
    <>
      {mobileOpen ? <button type="button" aria-label="Close navigation" onClick={onClose} className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[1px] lg:hidden" /> : null}
      <aside className={`fixed inset-y-0 left-0 z-50 w-[260px] border-r border-white/10 bg-[#071a33] transition-transform duration-200 lg:fixed lg:top-0 lg:h-screen lg:w-64 lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
            <img src="/rentifypro-logo-optimized.png" alt="RentifyPro logo" className="h-11 w-11 shrink-0 object-contain" />
            <div className="min-w-0 flex-1"><p className="text-lg font-bold text-white">RentifyPro</p><p className="text-xs text-slate-400">Admin Control Panel</p></div>
            <button type="button" onClick={onClose} aria-label="Close menu" className="rp-icon-button lg:!hidden"><X size={18} /></button>
          </div>

          <div className="mx-3 mt-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-slate-200"><User size={20} strokeWidth={2} aria-hidden="true" /></div>
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{displayName}</p><p className="truncate text-xs text-slate-400" title={displayEmail}>{displayEmail}</p></div>
          </div>

          <nav aria-label="Admin navigation" className="flex-1 overflow-y-auto px-3 py-5">
            <div className="space-y-6">
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{group.label}</p>
                  <div className="space-y-1">
                    {group.items.map(({ id, label, icon: Icon }) => {
                      const active = activeView === id;
                      return <button key={id} type="button" aria-current={active ? "page" : undefined} onClick={() => onSelect(id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${active ? "bg-blue-600 text-white shadow-lg shadow-blue-950/25" : "text-slate-300 hover:bg-white/[0.07] hover:text-white"}`}><Icon size={20} strokeWidth={2} aria-hidden="true" /><span>{label}</span></button>;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </nav>

          <div className="border-t border-white/10 p-3">
            <button type="button" onClick={onLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-slate-300 hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"><LogOut size={20} strokeWidth={2} aria-hidden="true" />Sign Out</button>
          </div>
        </div>
      </aside>
    </>
  );
}

export function AdminPageHeader({ title, description, onMenuOpen, actions }) {
  return (
    <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-5 lg:px-5">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <button type="button" aria-label="Open navigation" onClick={onMenuOpen} className="mt-0.5 rounded-xl border border-slate-200 p-2.5 text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 lg:hidden"><Menu size={20} /></button>
          <div><h1 className="text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">{title}</h1><p className="mt-1 text-sm leading-5 text-slate-500">{description}</p></div>
        </div>
        {actions ? <div className="min-w-0 sm:shrink-0">{actions}</div> : null}
      </div>
    </header>
  );
}
