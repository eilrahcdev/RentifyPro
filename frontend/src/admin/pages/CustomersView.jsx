import { Activity, AlertTriangle, BadgeCheck, Eye, LoaderCircle, MoreVertical, Pencil, Power, PowerOff, Trash2, UserRound, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { percentage } from "../adminAnalytics";
import { currentMonthKey, monthLabel, monthOptions } from "../analyticsPeriods";
import { AnalyticsPanel, DistributionList, MetricTile, ProgressRing, TrendBars } from "../components/AdminAnalytics";
import { EmptyState, FilterSelect, SearchField, StatCard, StatusBadge, PaginationFooter } from "../components/AdminUI";
import { useTablePage } from "../useTablePage";
import PasswordInput from "../components/PasswordInput";
import AdminModal from "../components/AdminModal";

const avatarTones = ["bg-blue-50 text-blue-600", "bg-orange-50 text-orange-600", "bg-violet-50 text-violet-600", "bg-cyan-50 text-cyan-700"];

export default function CustomersView({
  customers,
  adminEmail,
  initialRole = "All Roles",
  initialStatus = "All Statuses",
  onView,
  onEdit,
  onToggleDisabled,
  onDelete,
}) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState(initialRole);
  const [status, setStatus] = useState(initialStatus);
  const [joined, setJoined] = useState("");
  const [growthPeriod, setGrowthPeriod] = useState(currentMonthKey);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [actionMenu, setActionMenu] = useState(null);
  const actionMenuTriggerRef = useRef(null);
  const visibleCustomers = useMemo(
    () => customers.filter((customer) => customer.role !== "Admin" && String(customer.email || "").toLowerCase() !== String(adminEmail || "").toLowerCase()),
    [adminEmail, customers],
  );
  const active = visibleCustomers.filter((customer) => customer.status === "Active").length;
  const pending = visibleCustomers.filter((customer) => customer.status === "Pending Verification").length;
  const inactive = visibleCustomers.filter((customer) => ["Inactive", "Suspended"].includes(customer.status)).length;
  const growthPeriodOptions = monthOptions(visibleCustomers.map((customer) => customer.createdAt || customer.created));
  const growthTrend = buildCustomerTrend(visibleCustomers, growthPeriod);
  const renters = visibleCustomers.filter((customer) => customer.role === "Renter").length;
  const operators = visibleCustomers.filter((customer) => customer.role === "Operator").length;
  const activationRate = percentage(active, visibleCustomers.length);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return visibleCustomers.filter((customer) => {
      const matchesSearch = !query || [customer.name, customer.email, customer.phone].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesRole = role === "All Roles" || customer.role === role;
      const matchesStatus = status === "All Statuses" || customer.status === status;
      const matchesJoined = !joined || customer.created >= joined;
      return matchesSearch && matchesRole && matchesStatus && matchesJoined;
    });
  }, [joined, role, search, status, visibleCustomers]);
  const pagination = useTablePage(filtered);

  const clearFilters = () => { setSearch(""); setRole("All Roles"); setStatus("All Statuses"); setJoined(""); };

  useEffect(() => {
    if (!actionMenu) return undefined;
    const focusFrame = window.requestAnimationFrame(() => document.querySelector('[data-customer-action-menu][role="menu"] button')?.focus({ preventScroll: true }));
    const closeMenu = (event) => {
      if (event.type === "keydown") {
        const controls = [...document.querySelectorAll('[data-customer-action-menu][role="menu"] button')];
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const index = controls.indexOf(document.activeElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
          controls[next]?.focus();
          return;
        }
        if (!["Escape", "Tab"].includes(event.key)) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
        actionMenuTriggerRef.current?.focus({ preventScroll: true });
      }
      if (event.type === "pointerdown" && event.target.closest?.("[data-customer-action-menu]")) return;
      setActionMenu(null);
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [actionMenu]);

  const openActionMenu = (event, customer) => {
    actionMenuTriggerRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    const menuHeight = 164;
    const belowTop = rect.bottom + 6;
    setActionMenu((current) => current?.customer.id === customer.id ? null : {
      customer,
      top: belowTop + menuHeight > window.innerHeight ? Math.max(8, rect.top - menuHeight - 6) : belowTop,
      left: Math.max(8, rect.right - 184),
    });
  };

  return (
    <div className="space-y-5">
      <CustomerEditDialog
        customer={editingCustomer}
        returnFocusRef={actionMenuTriggerRef}
        onClose={() => setEditingCustomer(null)}
        onSave={async (changes) => {
          await onEdit(editingCustomer, changes);
          setEditingCustomer(null);
        }}
      />
      {actionMenu ? createPortal(
        <div
          data-customer-action-menu
          role="menu"
          aria-label={`Manage ${actionMenu.customer.name}`}
          style={{ top: actionMenu.top, left: actionMenu.left }}
          className="admin-ui fixed z-[85] w-44 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
        >
          <MenuAction icon={Pencil} label="Edit customer" onClick={() => { setActionMenu(null); setEditingCustomer(actionMenu.customer); }} />
          <MenuAction
            icon={actionMenu.customer.disabled ? Power : PowerOff}
            label={actionMenu.customer.disabled ? "Enable account" : "Disable account"}
            tone={actionMenu.customer.disabled ? "success" : "warning"}
            onClick={() => { const customer = actionMenu.customer; setActionMenu(null); onToggleDisabled(customer); }}
          />
          <div className="my-1 border-t border-slate-100" />
          <MenuAction icon={Trash2} label="Delete customer" tone="danger" onClick={() => { const customer = actionMenu.customer; setActionMenu(null); onDelete(customer); }} />
        </div>,
        document.body,
      ) : null}

      <section aria-label="Customer statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Customers" value={visibleCustomers.length} description="All customer accounts" icon={Users} />
        <StatCard label="Active Customers" value={active} description="Verified and active" icon={UserRound} tone="green" />
        <StatCard label="Pending Verification" value={pending} description="Awaiting account review" icon={UserRound} tone="amber" />
        <StatCard label="Inactive / Suspended" value={inactive} description="Restricted accounts" icon={UserRound} tone="red" />
      </section>

      <section aria-label="Customer growth insights" className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,.75fr)]">
        <AnalyticsPanel eyebrow="Customer growth tracker" title="New account momentum" description={`Monthly renter and operator registrations for the six months ending ${monthLabel(growthPeriod)}.`} icon={Activity} action={<FilterSelect label="Month / Year" aria-label="Customer registration month and year" value={growthPeriod} onChange={setGrowthPeriod} options={growthPeriodOptions} className="w-full sm:w-48" />}>
          <TrendBars data={growthTrend} primaryKey="renters" secondaryKey="operators" primaryLabel="Renters" secondaryLabel="Operators" emptyLabel="No account registrations in this six-month period." />
          <div className="mt-5 border-t border-slate-100 pt-5">
            <p className="text-xs text-slate-500">Current totals across all customer accounts</p>
            <div className="mt-3 grid grid-cols-3 gap-2"><MetricTile label="Renters" value={renters} tone="blue" /><MetricTile label="Operators" value={operators} tone="violet" /><MetricTile label="Pending" value={pending} tone={pending ? "amber" : "slate"} /></div>
          </div>
        </AnalyticsPanel>
        <AnalyticsPanel eyebrow="Activation health" title="Account readiness" description="How many customer accounts are verified, active, and ready to use RentifyPro." icon={BadgeCheck}>
          <ProgressRing value={activationRate} label="Active" detail={`${active} of ${visibleCustomers.length} customer accounts are currently active.`} tone={activationRate >= 75 ? "emerald" : activationRate >= 50 ? "amber" : "rose"} />
          <div className="mt-5 border-t border-slate-100 pt-5"><DistributionList items={[
            { label: "Active", value: active, tone: "emerald" },
            { label: "Pending verification", value: pending, tone: "amber" },
            { label: "Inactive / suspended", value: inactive, tone: "rose" },
          ]} /></div>
        </AnalyticsPanel>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_6px_20px_rgba(33,33,33,0.035)]">
        <div className="grid gap-4 border-b border-slate-200 p-4 lg:grid-cols-[minmax(260px,1.4fr)_190px_210px_190px_auto] lg:items-end">
          <SearchField label="Search Customers" value={search} onChange={setSearch} placeholder="Search by name, email, or phone..." />
          <FilterSelect label="Role" value={role} onChange={setRole} options={["All Roles", "Renter", "Operator"]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={["All Statuses", "Active", "Pending Verification", "Inactive", "Suspended"]} />
          <label className="block"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">Joined From</span><input type="date" value={joined} onChange={(event) => setJoined(event.target.value)} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-700 outline-none hover:border-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /></label>
          <button type="button" onClick={clearFilters} className="h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">Clear Filters</button>
        </div>

        <div tabIndex={0} role="region" aria-label="Customer records, scroll horizontally for more columns" className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse">
            <caption className="sr-only">RentifyPro customer accounts</caption>
            <thead className="bg-slate-50"><tr>{["Customer", "Email", "Phone", "Role", "Status", "Joined", "Actions"].map((heading) => <th key={heading} scope="col" className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {pagination.rows.map((customer, index) => (
                <tr key={customer.id || customer.email} className="transition-colors hover:bg-blue-50/30">
                  <td className="whitespace-nowrap px-4 py-3.5"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${avatarTones[index % avatarTones.length]}`}>{initials(customer.name)}</span><span className="text-sm font-semibold text-slate-950">{customer.name}</span></div></td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{customer.email}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-sm text-slate-600">{customer.phone}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{customer.role}</td>
                  <td className="px-4 py-3.5"><StatusBadge value={customer.status} />{customer.status === "Pending Verification" && customer.verification?.pendingReasons?.length ? <p className="mt-1.5 max-w-56 text-xs leading-5 text-slate-600">Needs: {customer.verification.pendingReasons.join(", ")}</p> : null}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-sm tabular-nums text-slate-600"><time dateTime={customer.created}>{customer.created}</time></td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <ActionButton label="View" icon={Eye} onClick={() => onView(customer)} />
                      <button
                        type="button"
                        data-customer-action-menu
                        aria-label={`More actions for ${customer.name}`}
                        aria-haspopup="menu"
                        aria-expanded={actionMenu?.customer.id === customer.id}
                        onClick={(event) => openActionMenu(event, customer)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                      >
                        <MoreVertical size={17} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length ? <EmptyState icon={Users} title="No customers found" description="Try changing your search or filters." /> : null}
        </div>
        <PaginationFooter pagination={pagination} noun="customers" />
      </section>
    </div>
  );
}

function ActionButton({ label, icon: Icon, onClick, tone = "default" }) {
  const tones = {
    default: "border-slate-300 text-slate-700 hover:bg-slate-50",
    success: "border-emerald-200 text-emerald-700 hover:bg-emerald-50",
    warning: "border-amber-200 text-amber-700 hover:bg-amber-50",
    danger: "border-rose-200 text-rose-700 hover:bg-rose-50",
  };
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 ${tones[tone] || tones.default}`}>
      <Icon size={14} aria-hidden="true" />
      {label}
    </button>
  );
}

function MenuAction({ icon: Icon, label, onClick, tone = "default" }) {
  const tones = {
    default: "text-slate-700 hover:bg-slate-50",
    success: "text-emerald-700 hover:bg-emerald-50",
    warning: "text-amber-700 hover:bg-amber-50",
    danger: "text-rose-700 hover:bg-rose-50",
  };
  return (
    <button type="button" role="menuitem" onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold ${tones[tone] || tones.default}`}>
      <Icon size={16} aria-hidden="true" />
      {label}
    </button>
  );
}

function CustomerEditDialog({ customer, onClose, onSave, returnFocusRef }) {
  if (!customer) return null;
  return <CustomerEditForm key={customer.id} customer={customer} onClose={onClose} onSave={onSave} returnFocusRef={returnFocusRef} />;
}

function CustomerEditForm({ customer, onClose, onSave, returnFocusRef }) {
  const originalPhone = /\d/.test(String(customer.phone || "")) ? String(customer.phone) : "";
  const [form, setForm] = useState({
    name: String(customer.name || ""),
    email: String(customer.email || ""),
    phone: ["—", "â€”"].includes(String(customer.phone || "")) ? "" : String(customer.phone || ""),
    role: customer.role === "Operator" ? "Operator" : "Renter",
    adminPassword: "",
    reason: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (form.name.trim().length < 2) return setError("Name must contain at least 2 characters.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError("Enter a valid email address.");
    if (form.reason.trim().length < 10) return setError("Explain the administrative correction using at least 10 characters.");
    if (!form.adminPassword) return setError("Enter your Super Admin password to save these changes.");
    setSaving(true);
    try {
      await onSave({ ...form, name: form.name.trim(), email: form.email.trim().toLowerCase(), phone: form.phone.trim() });
    } catch (requestError) {
      setError(requestError.message || "The customer could not be updated.");
      setSaving(false);
    }
  };
  const changes = [
    ["Name", customer.name, form.name],
    ["Email", customer.email, form.email],
    ["Phone", originalPhone, form.phone],
    ["Role", customer.role, form.role],
  ].filter(([, before, after]) => String(before || "") !== String(after || ""));
  const sensitiveChange = changes.some(([field]) => ["Email", "Role"].includes(field));

  return (
    <AdminModal onClose={onClose} busy={saving} returnFocusRef={returnFocusRef}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="customer-edit-title" aria-busy={saving} className="flex w-full max-w-lg flex-col overflow-hidden bg-white">
        <div className="flex items-start justify-between border-b border-slate-200 p-5">
          <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">Customer management</p><h3 id="customer-edit-title" className="mt-1.5 text-xl font-bold text-slate-950">Edit customer</h3></div>
          <button type="button" data-dialog-initial onClick={onClose} disabled={saving} aria-label="Close edit dialog" className="admin-icon-button text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={19} /></button>
        </div>
        <div className="grid min-h-0 gap-4 overflow-y-auto overscroll-contain p-5 sm:grid-cols-2">
          <EditField label="Full name" value={form.name} onChange={update("name")} maxLength={100} />
          <EditField label="Email address" type="email" value={form.email} onChange={update("email")} maxLength={254} />
          <EditField label="Phone number" value={form.phone} onChange={update("phone")} maxLength={32} placeholder="Optional" />
          <FilterSelect label="Role" value={form.role} onChange={(value) => setForm((current) => ({ ...current, role: value }))} options={customer.role === "Renter" ? ["Renter"] : ["Renter", "Operator"]} />
          {customer.role === "Renter" ? <p className="text-xs leading-5 text-slate-600">Owner upgrades require the customer to complete Become a Vehicle Owner on RentifyPro.</p> : null}
          {changes.length ? <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">Changes to be recorded</p><div className="mt-2 space-y-2">{changes.map(([field, before, after]) => <div key={field} className="grid grid-cols-[72px_1fr_18px_1fr] items-center gap-2 text-xs"><span className="font-semibold text-slate-600">{field}</span><span className="truncate rounded bg-white px-2 py-1.5 text-slate-600">{before || "—"}</span><span className="text-center text-slate-400">→</span><span className="truncate rounded bg-blue-50 px-2 py-1.5 font-semibold text-blue-800">{after || "—"}</span></div>)}</div></div> : null}
          {sensitiveChange ? <div className="sm:col-span-2 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><span>Email changes revoke sessions and require verification. Role changes require the applicable owner verification and must not conflict with existing records.</span></div> : null}
          <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-semibold text-slate-700">Administrative reason</span><textarea value={form.reason} onChange={update("reason")} required maxLength={500} rows={3} placeholder="Explain why this correction is necessary" className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /><span className="mt-1 block text-xs text-slate-500">{form.reason.trim().length}/500 characters</span></label>
          <PasswordInput label="Confirm Super Admin password" labelClassName="mb-1.5 block text-xs font-semibold text-slate-700" wrapperClassName="sm:col-span-2" autoComplete="current-password" value={form.adminPassword} onChange={update("adminPassword")} required placeholder="Required for sensitive customer changes" className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100" />
          {error ? <p role="alert" className="sm:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p> : null}
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={saving} className="h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving || !changes.length} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? <LoaderCircle size={17} className="animate-spin" /> : <Pencil size={16} />}{saving ? "Saving..." : "Save changes"}</button>
        </div>
      </form>
    </AdminModal>
  );
}

function EditField({ label, type = "text", value, onChange, maxLength, placeholder }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</span><input type={type} value={value} onChange={onChange} maxLength={maxLength} placeholder={placeholder} required={label !== "Phone number"} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /></label>;
}

function initials(name) { return String(name || "?").split(" ").filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase(); }

function buildCustomerTrend(customers, period) {
  const months = [];
  const [year, month] = period.split("-").map(Number);
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(year, month - 1 - offset, 1);
    months.push({ key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`, label: date.toLocaleDateString("en-PH", { month: "short", year: "2-digit" }), renters: 0, operators: 0 });
  }
  const byKey = new Map(months.map((month) => [month.key, month]));
  customers.forEach((customer) => {
    const date = new Date(customer.createdAt || customer.created);
    if (Number.isNaN(date.getTime())) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const month = byKey.get(key);
    if (!month) return;
    if (customer.role === "Operator") month.operators += 1;
    else month.renters += 1;
  });
  return months;
}
