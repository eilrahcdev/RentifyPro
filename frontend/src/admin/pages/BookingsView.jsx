import { Activity, CalendarCheck2, CalendarDays, Car, Clock3, Eye, UserRoundCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { currentMonthKey, monthLabel, monthOptions } from "../analyticsPeriods";
import { AnalyticsPanel, DistributionList, MetricTile, TrendBars } from "../components/AdminAnalytics";
import { EmptyState, FilterSelect, SearchField, StatCard, StatusBadge, PaginationFooter } from "../components/AdminUI";
import { useTablePage } from "../useTablePage";

export default function BookingsView({ bookings, initialStatus = "All Statuses", onView }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [trendPeriod, setTrendPeriod] = useState(currentMonthKey);
  const [rentalPeriod, setRentalPeriod] = useState(currentMonthKey);
  const trendPeriodOptions = useMemo(() => monthOptions(bookings.map((booking) => booking.createdAt || booking.pickupAt)), [bookings]);
  const rentalPeriodOptions = useMemo(() => monthOptions(bookings.map((booking) => booking.pickupAt)), [bookings]);
  const mostRentedVehicles = useMemo(() => buildMostRentedVehicles(bookings, rentalPeriod), [bookings, rentalPeriod]);
  const rentalChartRowHeight = Math.max(60, ...mostRentedVehicles.map((vehicle) => wrapVehicleName(vehicle.vehicle).length * 14 + 16));
  const active = bookings.filter((booking) => booking.isActive).length;
  const overdue = bookings.filter((booking) => booking.isOverdue).length;
  const completed = bookings.filter((booking) => booking.status === "Completed").length;
  const bookingTrend = useMemo(() => buildBookingTrend(bookings, trendPeriod), [bookings, trendPeriod]);
  const upcoming = useMemo(() => bookings
    .filter((booking) => !["Cancelled", "Rejected", "Completed"].includes(booking.status) && validDate(booking.pickupAt) >= startOfToday())
    .sort((first, second) => validDate(first.pickupAt) - validDate(second.pickupAt))
    .slice(0, 5), [bookings]);
  const statusDistribution = [
    { label: "Pending", value: bookings.filter((booking) => booking.status === "Pending").length, tone: "amber" },
    { label: "Confirmed / extended", value: bookings.filter((booking) => ["Confirmed", "Extended"].includes(booking.status)).length, tone: "blue" },
    { label: "Completed", value: completed, tone: "emerald" },
    { label: "Cancelled / rejected", value: bookings.filter((booking) => ["Cancelled", "Rejected"].includes(booking.status)).length, tone: "rose" },
  ];

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return bookings.filter((booking) => {
      const displayStatus = booking.isOverdue ? "Overdue" : booking.isActive ? "Active" : booking.status;
      const matchesSearch = !query || [booking.reference, booking.renter, booking.vehicle, booking.operator].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesStatus = status === "All Statuses" || displayStatus === status;
      return matchesSearch && matchesStatus;
    });
  }, [bookings, search, status]);
  const pagination = useTablePage(filtered);

  return (
    <div className="space-y-5">
      <section aria-label="Booking operations statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Bookings" value={bookings.length} description="All platform booking records" icon={CalendarCheck2} />
        <StatCard label="Active Rentals" value={active} description="Currently in progress" icon={CalendarCheck2} tone="green" />
        <StatCard label="Overdue Returns" value={overdue} description="Require operational follow-up" icon={Clock3} tone="red" />
        <StatCard label="Completed" value={completed} description="Successfully completed rentals" icon={UserRoundCheck} tone="slate" />
      </section>

      <section aria-label="Booking activity insights" className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)]">
        <AnalyticsPanel eyebrow="Booking tracker" title="Rental demand and status flow" description={`Six-month booking volume ending ${monthLabel(trendPeriod)}.`} icon={Activity} action={<FilterSelect label="Trend ending month" value={trendPeriod} onChange={setTrendPeriod} options={trendPeriodOptions} className="w-full sm:w-48" />}>
          <TrendBars data={bookingTrend} primaryLabel="Bookings" />
          <div className="mt-5 border-t border-slate-100 pt-5"><p className="mb-4 text-xs font-semibold text-slate-500">Current status mix across all booking records</p><DistributionList items={statusDistribution} /></div>
        </AnalyticsPanel>
        <AnalyticsPanel eyebrow="Upcoming schedule" title="Next pickups" description="The nearest confirmed or pending rentals that need operational readiness." icon={CalendarDays}>
          {upcoming.length ? <div className="space-y-2.5">{upcoming.map((booking) => (
            <button key={booking.id} type="button" onClick={() => onView(booking)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">
              <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl bg-blue-50 text-blue-700"><strong className="text-sm leading-none">{dayNumber(booking.pickupAt)}</strong><span className="mt-0.5 text-[8px] font-bold uppercase">{monthShort(booking.pickupAt)}</span></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-slate-900">{booking.vehicle}</span><span className="mt-0.5 block truncate text-[10px] text-slate-500">#{booking.reference} · {booking.renter}</span></span>
              <StatusBadge value={booking.status} />
            </button>
          ))}</div> : <div className="grid min-h-48 place-items-center text-center"><div><CalendarCheck2 className="mx-auto text-slate-300" size={28} /><p className="mt-3 text-sm font-semibold text-slate-700">No upcoming pickups</p><p className="mt-1 text-xs text-slate-500">New confirmed rentals will appear here.</p></div></div>}
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4"><MetricTile label="Active now" value={active} tone="emerald" /><MetricTile label="Overdue" value={overdue} tone={overdue ? "rose" : "slate"} /></div>
        </AnalyticsPanel>
      </section>

      <AnalyticsPanel eyebrow="Rental rankings" title="Most Rented Vehicles" description="Active, overdue, and completed rentals by recorded pickup month. Only identifiable vehicles are included." icon={Car} className="[container-type:inline-size]" action={
        <FilterSelect label="Pickup month" value={rentalPeriod} onChange={setRentalPeriod} options={rentalPeriodOptions} className="w-full sm:w-48" />
      }>
        {mostRentedVehicles.length ? <div className="grid min-w-0 gap-5 [@container(min-width:820px)]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <figure aria-label="Most rented vehicle rental counts" className="min-w-0">
            <figcaption className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-600"><span className="h-2 w-2 rounded-full bg-blue-600" />Rentals in {monthLabel(rentalPeriod)}</figcaption>
            <ResponsiveContainer width="100%" height={mostRentedVehicles.length * rentalChartRowHeight + 40} minWidth={0}>
              <BarChart data={mostRentedVehicles} layout="vertical" margin={{ top: 8, right: 32, bottom: 8, left: 0 }} accessibilityLayer>
                <CartesianGrid stroke="#e9eef5" strokeDasharray="4 4" horizontal={false} />
                <XAxis type="number" dataKey="count" allowDecimals={false} domain={[0, "dataMax + 1"]} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#64748b" }} />
                <YAxis type="category" dataKey="vehicle" width={112} axisLine={false} tickLine={false} interval={0} tick={<VehicleNameTick />} />
                <Tooltip cursor={{ fill: "#eff6ff" }} content={<RentalCountTooltip />} />
                <Bar dataKey="count" name="Rentals" fill="#0b75e7" radius={[0, 5, 5, 0]} maxBarSize={26} isAnimationActive={false}>
                  <LabelList dataKey="count" position="right" fill="#0f172a" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </figure>
          <div className="min-w-0 border-t border-slate-100 pt-4 [@container(min-width:820px)]:border-l [@container(min-width:820px)]:border-t-0 [@container(min-width:820px)]:pl-5 [@container(min-width:820px)]:pt-0">
            <h3 className="mb-3 text-sm font-bold text-slate-900">Top 5 Most Rented Vehicles</h3>
            <ol className="divide-y divide-slate-100">
              {mostRentedVehicles.map((vehicle, index) => (
                <li key={vehicle.key} className="flex items-start gap-3 py-3 first:pt-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-xs font-bold text-blue-700">#{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{vehicle.vehicle}</p>
                    <p className="mt-1 break-words text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">{vehicle.operator}</p>
                  </div>
                  <span className="shrink-0 text-right"><strong className="block text-lg font-bold tabular-nums text-slate-900">{vehicle.count}</strong><span className="text-[10px] font-semibold text-slate-500">{vehicle.count === 1 ? "rental" : "rentals"}</span></span>
                </li>
              ))}
            </ol>
          </div>
        </div> : <EmptyState icon={Car} title="No rental rankings for this month" description="Identifiable vehicles with active, overdue, or completed rentals and a recorded pickup date will appear here." />}
      </AnalyticsPanel>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_6px_20px_rgba(33,33,33,0.035)]">
        <div className="grid gap-4 border-b border-slate-200 p-4 lg:grid-cols-[minmax(280px,1fr)_220px_auto] lg:items-end">
          <SearchField label="Search Bookings" value={search} onChange={setSearch} placeholder="Search by booking, renter, vehicle, or operator..." />
          <FilterSelect label="Operational Status" value={status} onChange={setStatus} options={["All Statuses", "Active", "Pending", "Confirmed", "Extended", "Completed", "Cancelled", "Rejected", "Overdue"]} />
          <button type="button" onClick={() => { setSearch(""); setStatus("All Statuses"); }} className="h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">Clear Filters</button>
        </div>

        <div tabIndex={0} role="region" aria-label="Booking records, scroll horizontally for more columns" className="overflow-x-auto">
          <table className="w-full min-w-[1060px] border-collapse">
            <caption className="sr-only">RentifyPro booking operations without financial information</caption>
            <thead className="bg-slate-50">
              <tr>{["Booking", "Renter", "Vehicle", "Operator", "Pickup", "Return", "Driver", "Status", "Actions"].map((heading) => <th key={heading} scope="col" className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagination.rows.map((booking) => (
                <tr key={booking.id} className="transition-colors hover:bg-blue-50/30">
                  <td className="whitespace-nowrap px-4 py-3.5 text-sm font-bold text-blue-700">#{booking.reference}</td>
                  <td className="px-4 py-3.5 text-sm font-semibold text-slate-950">{booking.renter}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{booking.vehicle}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{booking.operator}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-sm text-slate-600"><time dateTime={booking.pickupAt}>{formatDateTime(booking.pickupAt)}</time></td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-sm text-slate-600"><time dateTime={booking.returnAt}>{formatDateTime(booking.returnAt)}</time></td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{booking.driverSelected ? "Selected" : "Not selected"}</td>
                  <td className="px-4 py-3.5"><StatusBadge value={booking.isOverdue ? "Overdue" : booking.isActive ? "Active" : booking.status} /></td>
                  <td className="px-4 py-3.5"><button type="button" onClick={() => onView(booking)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><Eye size={14} />View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length ? <EmptyState icon={CalendarCheck2} title="No bookings found" description="Try changing your search or status filter." /> : null}
        </div>
        <PaginationFooter pagination={pagination} noun="bookings" />
      </section>
    </div>
  );
}

function buildMostRentedVehicles(bookings, period) {
  const vehicles = new Map();
  bookings.forEach((booking) => {
    if (["Pending", "Cancelled", "Rejected"].includes(booking.status) || !(booking.isActive || booking.isOverdue || booking.status === "Completed") || pickupMonthKey(booking.pickupAt) !== period) return;
    const vehicleName = String(booking.vehicle || "").trim();
    if (!booking.vehicleId && (!vehicleName || vehicleName.toLowerCase() === "unknown vehicle")) return;
    const vehicle = vehicleName || "Unknown vehicle";
    const operator = String(booking.operator || "Unknown operator");
    const key = booking.vehicleId ? `vehicle:${booking.vehicleId}` : JSON.stringify([vehicle, booking.operatorId || operator]);
    const entry = vehicles.get(key) || { key, vehicle, operator, count: 0 };
    entry.count += 1;
    vehicles.set(key, entry);
  });
  return [...vehicles.values()].sort((first, second) => second.count - first.count || first.vehicle.localeCompare(second.vehicle) || first.key.localeCompare(second.key)).slice(0, 5);
}

function pickupMonthKey(value) {
  const date = validDate(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : "";
}

function wrapVehicleName(value) {
  const lines = [];
  String(value).split(/\s+/).forEach((word) => {
    const parts = word.match(/.{1,16}/g) || [];
    parts.forEach((part) => {
      const previous = lines.length - 1;
      if (previous >= 0 && lines[previous].length + part.length + 1 <= 16) lines[previous] += ` ${part}`;
      else lines.push(part);
    });
  });
  return lines.length > 3 ? [...lines.slice(0, 2), `${lines[2].slice(0, 15)}\u2026`] : lines;
}

function VehicleNameTick({ x, y, payload }) {
  const lines = wrapVehicleName(payload.value);
  return <text x={x - 4} y={y - (lines.length - 1) * 7} textAnchor="end" dominantBaseline="central" fill="#475569" fontSize={11}><title>{payload.value}</title>{lines.map((line, index) => <tspan key={index} x={x - 4} dy={index ? 14 : 0}>{line}</tspan>)}</text>;
}

function RentalCountTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const vehicle = payload[0].payload;
  return <div className="max-w-64 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg"><p className="break-words font-bold text-slate-900 [overflow-wrap:anywhere]">{vehicle.vehicle}</p><p className="mt-1 break-words text-slate-500 [overflow-wrap:anywhere]">{vehicle.operator}</p><p className="mt-2 font-semibold text-blue-700">{vehicle.count} {vehicle.count === 1 ? "rental" : "rentals"}</p></div>;
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function buildBookingTrend(bookings, period) {
  const months = [];
  const [year, month] = period.split("-").map(Number);
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(year, month - 1 - offset, 1);
    months.push({ key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`, label: date.toLocaleDateString("en-PH", { month: "short" }), value: 0 });
  }
  const byKey = new Map(months.map((month) => [month.key, month]));
  bookings.forEach((booking) => {
    const date = validDate(booking.createdAt || booking.pickupAt);
    if (!date) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (byKey.has(key)) byKey.get(key).value += 1;
  });
  return months;
}

function validDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function dayNumber(value) { return validDate(value)?.getDate() || "—"; }
function monthShort(value) { return validDate(value)?.toLocaleDateString("en-PH", { month: "short" }) || ""; }
