import { useMemo, useState } from "react";
import {
  CalendarDays,
  CarFront,
  ChevronRight,
  Clock3,
  FileText,
  User,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState, StatusBadge } from "../components/AdminUI";

const bookingColors = ["#f59e0b", "#2563eb", "#16a34a", "#e11d48", "#64748b"];
const fleetColors = ["#16a34a", "#e11d48"];
const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  boxShadow: "0 12px 30px rgba(15,23,42,.1)",
};

export default function DashboardView({ vehicles, customers, documents, bookings = [], period, onSelect }) {
  const platformCustomers = customers.filter((customer) => customer.role !== "Admin");
  const renters = platformCustomers.filter((customer) => customer.role === "Renter").length;
  const operators = platformCustomers.filter((customer) => customer.role === "Vehicle Owner").length;
  const available = vehicles.filter((vehicle) => vehicle.status === "Available").length;
  const unavailable = vehicles.length - available;
  const activeRentals = bookings.filter((booking) => booking.isActive).length;
  const overdueRentals = bookings.filter((booking) => booking.isOverdue).length;
  const pendingDocuments = documents.filter((document) => document.canReview === true).length;
  const periodBookings = bookings.filter((booking) => dateMonthKey(booking.pickupAt || booking.createdAt) === period);

  const bookingData = ["Pending", "Confirmed", "Completed", "Cancelled", "Rejected"].map((status) => ({
    status,
    count: periodBookings.filter((booking) => booking.status === status).length,
  }));
  const fleetData = [
    { name: "Available", value: available },
    { name: "Unavailable", value: unavailable },
  ].filter((item) => item.value > 0);
  const recentBookings = [...bookings]
    .sort((first, second) => dateTime(second.createdAt) - dateTime(first.createdAt))
    .slice(0, 7);

  return (
    <div className="space-y-3">
      <section aria-label="Platform operations statistics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <DashboardKpiCard label="Renters" value={renters} actionLabel="View renters" onAction={() => onSelect("customers", { role: "Renter" })} icon={Users} tone="blue" />
        <DashboardKpiCard label="Vehicle Owners" value={operators} actionLabel="View operators" onAction={() => onSelect("customers", { role: "Vehicle Owner" })} icon={User} tone="blue" />
        <DashboardKpiCard label="Vehicles" value={vehicles.length} actionLabel="View vehicles" onAction={() => onSelect("vehicles")} icon={CarFront} tone="blue" />
        <DashboardKpiCard label="Active Rentals" value={activeRentals} actionLabel="View rentals" onAction={() => onSelect("bookings", { status: "Active" })} icon={CalendarDays} tone="green" />
        <DashboardKpiCard label="Pending Reviews" value={pendingDocuments} actionLabel="Review documents" onAction={() => onSelect("documents", { status: "Pending Review" })} icon={FileText} tone="amber" />
        <DashboardKpiCard label="Overdue Returns" value={overdueRentals} actionLabel="View overdue" onAction={() => onSelect("bookings", { status: "Overdue" })} icon={Clock3} tone="red" />
      </section>

      <section aria-label="Platform operational overview" className="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(380px,1fr)]">
        <DashboardCard title="Booking Operations" description={`${periodLabel(period)} status distribution. Counts only; financial data is intentionally excluded.`}>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bookingData} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#edf2f7" vertical={false} />
                <XAxis dataKey="status" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f8fafc" }} />
                <Bar dataKey="count" radius={[7, 7, 0, 0]} isAnimationActive={false}>
                  {bookingData.map((entry, index) => <Cell key={entry.status} fill={bookingColors[index]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </DashboardCard>

        <DashboardCard title="Fleet Availability" description="Current platform-wide rental readiness." footerLabel="View all vehicles" onFooterClick={() => onSelect("vehicles")}>
          {fleetData.length ? (
            <div className="flex h-72 items-center gap-2">
              <div className="relative h-full min-w-0 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={fleetData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={91} paddingAngle={3} isAnimationActive={false}>
                      {fleetData.map((entry, index) => <Cell key={entry.name} fill={fleetColors[index]} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-slate-950">{vehicles.length}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Vehicles</span>
                </div>
              </div>
              <ul className="w-[126px] space-y-3 text-xs text-slate-600">
                {fleetData.map((item, index) => (
                  <li key={item.name} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: fleetColors[index] }} />{item.name}</span>
                    <strong className="text-slate-900">{item.value}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : <EmptyState icon={CarFront} title="No fleet data" description="Registered vehicle availability will appear here." />}
        </DashboardCard>
      </section>

      <section aria-label="Platform rental schedule">
        <OperationsCalendar bookings={periodBookings} period={period} />
      </section>

      <section aria-label="Recent booking records">
        <DashboardCard title="Recent Bookings" description="Latest platform bookings without confidential financial information." headerActionLabel="View all bookings" onHeaderAction={() => onSelect("bookings")}>
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[820px] border-collapse">
              <caption className="sr-only">Recent RentifyPro booking operations</caption>
              <thead className="bg-slate-50">
                <tr>{["Booking", "Renter", "Vehicle", "Vehicle Owner", "Pickup", "Return", "Status"].map((heading) => <th key={heading} scope="col" className="border-b border-slate-200 px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-600">{heading}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentBookings.map((booking) => (
                  <tr key={booking.id} className="hover:bg-blue-50/30">
                    <td className="whitespace-nowrap px-4 py-3 text-xs font-bold text-blue-700">#{booking.reference}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-900">{booking.renter}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{booking.vehicle}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{booking.operator}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600"><time dateTime={booking.pickupAt}>{formatShortDate(booking.pickupAt)}</time></td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600"><time dateTime={booking.returnAt}>{formatShortDate(booking.returnAt)}</time></td>
                    <td className="px-4 py-3"><StatusBadge value={booking.isOverdue ? "Overdue" : booking.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!recentBookings.length ? <EmptyState icon={CalendarDays} title="No bookings found" description="New platform bookings will appear here." /> : null}
          </div>
        </DashboardCard>
      </section>
    </div>
  );
}

function OperationsCalendar({ bookings, period }) {
  const defaultDate = period === dateMonthKey(new Date()) ? dateKey(new Date()) : `${period}-01`;
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const visibleSelectedDate = selectedDate.startsWith(`${period}-`) ? selectedDate : defaultDate;
  const days = useMemo(() => buildCalendarDays(period), [period]);

  const schedule = bookings.flatMap((booking) => {
    const entries = [];
    if (dateKey(booking.pickupAt) === visibleSelectedDate) entries.push({ booking, event: "Pickup", tone: "bg-blue-50 text-blue-700" });
    if (dateKey(booking.returnAt) === visibleSelectedDate) entries.push({ booking, event: booking.isOverdue ? "Overdue return" : "Return", tone: booking.isOverdue ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700" });
    return entries;
  });

  return (
    <DashboardCard title="Platform Rental Calendar" description={`${periodLabel(period)} pickups, returns, and overdue activity.`}>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-100 pb-3 text-xs font-medium text-slate-600">
        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" />Pickup</span>
        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Return</span>
        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" />Overdue</span>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
        <div className="grid grid-cols-7 bg-slate-50">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day} className="border-b border-slate-200 px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{day}</div>)}</div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const pickupCount = bookings.filter((booking) => dateKey(booking.pickupAt) === day.key).length;
            const returnBookings = bookings.filter((booking) => dateKey(booking.returnAt) === day.key);
            const overdueCount = returnBookings.filter((booking) => booking.isOverdue).length;
            const returnCount = returnBookings.length - overdueCount;
            const selected = visibleSelectedDate === day.key;
            return (
              <button key={day.key} type="button" onClick={() => setSelectedDate(day.key)} className={`relative min-h-14 border-b border-r border-slate-100 p-2 text-left transition focus-visible:z-10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-blue-100 sm:min-h-16 ${day.inPeriod ? "bg-white" : "bg-slate-50/70"} ${selected ? "ring-2 ring-inset ring-blue-500" : "hover:bg-blue-50/30"}`}>
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${selected ? "bg-blue-600 text-white" : day.inPeriod ? "text-slate-800" : "text-slate-400"}`}>{day.day}</span>
                <span className="mt-1 flex flex-wrap gap-1" aria-label={`${pickupCount} pickups, ${returnCount} returns, ${overdueCount} overdue returns`}>
                  {pickupCount ? <span className="h-2 w-2 rounded-full bg-blue-500" /> : null}
                  {returnCount ? <span className="h-2 w-2 rounded-full bg-emerald-500" /> : null}
                  {overdueCount ? <span className="h-2 w-2 rounded-full bg-rose-500" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-slate-900">Schedule for {formatLongDate(visibleSelectedDate)}</p>
          <span className="text-xs font-semibold text-slate-500">{schedule.length} {schedule.length === 1 ? "event" : "events"}</span>
        </div>
        {schedule.length ? (
          <ul className="mt-2 space-y-2">
            {schedule.slice(0, 4).map(({ booking, event, tone }, index) => (
              <li key={`${booking.id}-${event}-${index}`} className="flex flex-wrap items-center gap-3 rounded-lg bg-white px-3 py-2.5 text-xs ring-1 ring-inset ring-slate-200">
                <span className={`rounded-full px-2.5 py-1 font-semibold ${tone}`}>{event}</span>
                <strong className="text-slate-900">{booking.vehicle}</strong>
                <span className="text-slate-500">{booking.renter}</span>
                <span className="ml-auto text-slate-500">#{booking.reference}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-xs text-slate-500">No pickups or returns are scheduled for this date.</p>}
      </div>
    </DashboardCard>
  );
}

function DashboardKpiCard({ label, value, actionLabel, onAction, icon: Icon, tone }) {
  const tones = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-rose-50 text-rose-600",
  };

  return (
    <article className="relative min-h-[144px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div aria-hidden="true" className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-slate-50" />
      <div className="relative flex h-full flex-col">
        <div className="flex items-start gap-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tones[tone] || tones.blue}`}><Icon size={20} aria-hidden="true" /></div>
          <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold tracking-[-0.035em] text-slate-950">{value}</p></div>
        </div>
        <button type="button" onClick={onAction} className="group mt-auto flex w-full items-center justify-between border-t border-slate-100 pt-3 text-xs font-semibold text-blue-600 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><span>{actionLabel}</span><ChevronRight size={16} strokeWidth={2} className="transition group-hover:translate-x-0.5" aria-hidden="true" /></button>
      </div>
    </article>
  );
}

function DashboardCard({ title, description, children, footerLabel, onFooterClick, headerActionLabel, onHeaderAction }) {
  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div><h2 className="text-base font-bold text-slate-950">{title}</h2>{description ? <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p> : null}</div>
        {headerActionLabel ? <button type="button" onClick={onHeaderAction} className="group mt-0.5 inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><span>{headerActionLabel}</span><ChevronRight size={18} strokeWidth={2} className="transition group-hover:translate-x-0.5" aria-hidden="true" /></button> : null}
      </div>
      {children}
      {footerLabel ? <button type="button" onClick={onFooterClick} className="mt-4 flex w-full items-center justify-between border-t border-slate-100 pt-4 text-sm font-semibold text-blue-600 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><span>{footerLabel}</span><ChevronRight size={18} strokeWidth={2} aria-hidden="true" /></button> : null}
    </article>
  );
}

function buildCalendarDays(period) {
  const [year, month] = String(period).split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  if (Number.isNaN(firstDay.getTime())) return [];
  const leadingDays = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(year, month - 1, 1 - leadingDays);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return { key: dateKey(date), day: date.getDate(), inPeriod: dateMonthKey(date) === period };
  });
}

function dateKey(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateMonthKey(value) {
  return dateKey(value).slice(0, 7);
}

function validDate(value) {
  return Boolean(value) && !Number.isNaN(new Date(value).getTime());
}

function dateTime(value) {
  return validDate(value) ? new Date(value).getTime() : 0;
}

function periodLabel(value) {
  const [year, month] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(date);
}

function formatShortDate(value) {
  if (!validDate(value)) return "—";
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatLongDate(value) {
  if (!validDate(value)) return "selected date";
  return new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric" }).format(new Date(value));
}
