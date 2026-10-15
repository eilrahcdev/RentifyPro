import { ArrowDownRight, Car, Eye, Gauge, Info, MapPin, RotateCcw, SlidersHorizontal, Tags, Wrench } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import VehicleImage from "../components/VehicleImage";
import { presentVehicle } from "../vehiclePresentation";
import { percentage } from "../adminAnalytics";
import { AnalyticsPanel, MetricTile, ProgressRing } from "../components/AdminAnalytics";
import { EmptyState, FilterSelect, SearchField, StatCard, StatusBadge, TableFooter } from "../components/AdminUI";

export default function VehiclesView({ vehicles: sourceVehicles, onView }) {
  const vehicles = useMemo(() => sourceVehicles.map(presentVehicle), [sourceVehicles]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All Statuses");
  const [type, setType] = useState("All Types");
  const [category, setCategory] = useState("All Categories");
  const [moreFilters, setMoreFilters] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(10);
  const recordsRef = useRef(null);
  const types = [...new Set(vehicles.map((vehicle) => vehicle.type).filter(Boolean))];
  const categories = [...new Set(vehicles.map((vehicle) => vehicle.category).filter(Boolean))];
  const available = vehicles.filter((vehicle) => vehicle.status === "Available").length;
  const unavailable = vehicles.length - available;
  const readiness = percentage(available, vehicles.length);
  const typeDistribution = types.map((vehicleType, index) => ({ label: vehicleType, value: vehicles.filter((vehicle) => vehicle.type === vehicleType).length, color: typeColors[index % typeColors.length] }));
  const locations = countValues(vehicles.map((vehicle) => String(vehicle.location || "").trim()).filter((location) => location !== "—"));

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      const matchesSearch = !query || [vehicle.name, vehicle.plateNumber, vehicle.operator, vehicle.location].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesStatus = status === "All Statuses" || (status === "Unavailable" ? vehicle.status !== "Available" : vehicle.status === status);
      const matchesType = type === "All Types" || vehicle.type === type;
      const matchesCategory = category === "All Categories" || vehicle.category === category;
      return matchesSearch && matchesStatus && matchesType && matchesCategory;
    });
  }, [category, search, status, type, vehicles]);
  const visibleVehicles = filtered.slice(0, visibleLimit);
  const hasFilters = Boolean(search || status !== "All Statuses" || type !== "All Types" || category !== "All Categories");

  const clearFilters = () => {
    setSearch("");
    setStatus("All Statuses");
    setType("All Types");
    setCategory("All Categories");
    setVisibleLimit(10);
  };

  const showListings = (listingStatus) => {
    setSearch("");
    setStatus(listingStatus);
    setType("All Types");
    setCategory("All Categories");
    setVisibleLimit(10);
    window.requestAnimationFrame(() => {
      recordsRef.current?.focus({ preventScroll: true });
      recordsRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    });
  };

  return (
    <div className="space-y-5">
      <section aria-label="Vehicle statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Vehicles" value={vehicles.length} description="All registered vehicles" icon={Car} />
        <StatCard label="Available" value={available} description="Ready for booking" icon={Car} tone="green" />
        <StatCard label="Unavailable" value={unavailable} description="Not currently rental-ready" icon={Wrench} tone="amber" />
        <StatCard label="Vehicle Types" value={types.length} description="Fleet classifications" icon={Tags} tone="slate" />
      </section>

      <section aria-label="Fleet health overview" className="grid items-start gap-5 xl:grid-cols-[minmax(330px,.65fr)_minmax(0,1.35fr)]">
        <AnalyticsPanel eyebrow="Fleet health monitor" title="Rental readiness" description="The share of registered vehicles currently ready to accept bookings." icon={Gauge}>
          {vehicles.length ? <ProgressRing value={readiness} label="Ready" detail={`${available} available and ${unavailable} unavailable vehicle${vehicles.length === 1 ? "" : "s"}.`} tone={readiness >= 75 ? "emerald" : readiness >= 50 ? "amber" : "rose"} size="large" /> : <EmptyState icon={Car} title="No vehicles yet" description="Rental readiness will appear when vehicles are registered." />}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <ReadinessAction label="Ready to rent" count={available} listingStatus="Available" selected={status === "Available"} onSelect={showListings} tone="emerald" />
            <ReadinessAction label="Needs attention" count={unavailable} listingStatus="Unavailable" selected={status === "Unavailable"} onSelect={showListings} tone={unavailable ? "amber" : "slate"} />
          </div>
        </AnalyticsPanel>
        <AnalyticsPanel eyebrow="Fleet composition" title="Vehicle types and operating areas" description="Understand how the marketplace fleet is distributed across classifications and locations." icon={Tags}>
          <div className="[container-type:inline-size]">
            <div className="grid gap-6 [@container(min-width:48rem)]:grid-cols-2">
              <VehicleTypesChart items={typeDistribution} vehicleCount={vehicles.length} />
              <OperatingAreasChart items={locations} />
            </div>
          </div>
        </AnalyticsPanel>
      </section>

      <section id="vehicle-records" ref={recordsRef} tabIndex={-1} aria-label="Vehicle records" className="scroll-mt-48 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_6px_20px_rgba(33,33,33,0.035)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 sm:scroll-mt-32">
        <div className="grid gap-4 border-b border-slate-200 p-4 xl:grid-cols-[minmax(280px,1.6fr)_220px_220px_auto] xl:items-end">
          <SearchField value={search} onChange={(value) => { setSearch(value); setVisibleLimit(10); }} placeholder="Search by vehicle, plate number, operator, or location..." />
          <FilterSelect aria-label="Listing status" value={status} onChange={(value) => { setStatus(value); setVisibleLimit(10); }} options={["All Statuses", "Available", "Unavailable"]} />
          <FilterSelect aria-label="Vehicle type" value={type} onChange={(value) => { setType(value); setVisibleLimit(10); }} options={["All Types", ...types]} />
          <button type="button" aria-expanded={moreFilters} onClick={() => setMoreFilters((current) => !current)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><SlidersHorizontal size={17} />More Filters</button>
          <button type="button" disabled={!hasFilters} onClick={clearFilters} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50 xl:col-span-4 xl:justify-self-start"><RotateCcw size={16} aria-hidden="true" />Clear Filters</button>
        </div>
        {moreFilters ? <div className="border-b border-slate-200 bg-slate-50/60 p-4"><div className="max-w-xs"><FilterSelect label="Category" value={category} onChange={(value) => { setCategory(value); setVisibleLimit(10); }} options={["All Categories", ...categories]} /></div></div> : null}
        {status !== "All Statuses" ? <div role="status" className={`border-b border-slate-200 px-4 py-3 text-sm ${status === "Unavailable" ? "bg-amber-50/60 text-amber-900" : "bg-emerald-50/60 text-emerald-900"}`}>
          <p className="font-semibold">{status === "Unavailable" ? "Unavailable listings" : "Available listings"} <span aria-hidden="true">·</span> {filtered.length} matching {filtered.length === 1 ? "vehicle" : "vehicles"}</p>
          <p className="mt-1 text-xs leading-5">{status === "Unavailable" ? "Needs Attention counts listings not marked available. A stored hold reason is shown with the vehicle status when recorded." : "Ready to Rent counts listings marked available."}</p>
        </div> : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse">
            <caption className="sr-only">Registered RentifyPro vehicles</caption>
            <thead className="bg-slate-50"><tr>{["Vehicle", "Plate No.", "Category", "Operator", "Location", "Rental Rate", "Status", "Actions"].map((heading) => <th key={heading} scope="col" className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {visibleVehicles.map((vehicle) => (
                <tr key={vehicle.id || vehicle.plateNumber} className="transition-colors hover:bg-blue-50/30">
                  <td className="px-4 py-3.5"><div className="flex min-w-[250px] items-center gap-3"><VehicleImage vehicle={vehicle} className="w-20" thumbnail /><div><p className="text-sm font-semibold text-slate-950">{vehicle.name}</p><p className="mt-1 text-xs text-slate-500">{vehicle.type} <span aria-hidden="true">•</span> {vehicle.seats} seats <span aria-hidden="true">•</span> {vehicle.transmission}</p><p className="mt-0.5 text-xs text-slate-500">{vehicle.fuel}</p></div></div></td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-sm text-slate-600">{vehicle.plateNumber}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{vehicle.category}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{vehicle.operator}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{vehicle.location}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-sm font-semibold text-slate-800">{vehicle.rentalRate}</td>
                  <td className="px-4 py-3.5"><StatusBadge value={vehicle.status} />{vehicle.status !== "Available" ? <p className="mt-1.5 text-xs leading-5 text-slate-500">{vehicle.availabilityHoldReason === "manual" ? "Manual hold" : vehicle.availabilityHoldReason === "inspection" ? "Inspection hold" : "Listing marked unavailable"}</p> : null}</td>
                  <td className="px-4 py-3.5"><button type="button" onClick={() => onView(vehicle)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><Eye size={14} />View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length ? <EmptyState icon={Car} title={vehicles.length ? "No vehicles found" : "No vehicles have been registered yet"} description={vehicles.length ? "Try changing your search or filters." : "Registered vehicles will appear here."} /> : null}
        </div>
        <TableFooter visible={visibleVehicles.length} total={filtered.length} noun={hasFilters ? "matching vehicles" : "vehicles"} />
        {visibleVehicles.length < filtered.length ? <div className="border-t border-slate-200 p-4 text-center"><button type="button" onClick={() => setVisibleLimit((current) => current + 10)} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-blue-200 px-5 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">View More</button></div> : null}
      </section>
    </div>
  );
}

const typeColors = ["#045fc3", "#0753a6", "#64748b", "#0f766e", "#7c3aed", "#b45309"];
const locationColors = ["#3b82f6", "#3b82f6", "#14b8a6", "#f59e0b", "#8b5cf6"];

function ReadinessAction({ label, count, listingStatus, selected, onSelect, tone }) {
  return (
    <button type="button" disabled={!count} aria-pressed={selected} aria-controls="vehicle-records" aria-label={`${label}: ${count}. ${count ? `Show ${listingStatus.toLowerCase()} listings` : `No ${listingStatus.toLowerCase()} listings`}.`} onClick={() => onSelect(listingStatus)} className={`group min-w-0 rounded-xl text-left transition-shadow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-not-allowed [&>div]:h-full ${count ? "hover:shadow-md" : ""} ${selected ? listingStatus === "Unavailable" ? "ring-2 ring-amber-400" : "ring-2 ring-emerald-400" : ""}`}>
      <MetricTile label={label} value={<span className="flex flex-wrap items-center justify-between gap-2"><span>{count}</span>{count ? <ArrowDownRight size={14} className="shrink-0 text-slate-500 transition-transform group-hover:translate-y-0.5" aria-hidden="true" /> : null}</span>} helper={<span className="text-xs">{count ? `${listingStatus} listings` : `No ${listingStatus.toLowerCase()} listings`}</span>} tone={tone} size="large" />
    </button>
  );
}

function CompositionHeading({ title, description, icon: Icon }) {
  return (
    <div className="mb-5 flex items-start gap-3 border-b border-slate-100 pb-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Icon size={20} aria-hidden="true" /></span>
      <div className="min-w-0"><h3 className="text-base font-bold text-slate-900">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>
    </div>
  );
}

function VehicleTypesChart({ items, vehicleCount }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <section aria-label="Vehicle types" className="min-w-0 [container-type:inline-size]">
      <CompositionHeading title="Vehicle Types" description="Distribution of vehicles by recorded type." icon={Car} />
      {total ? (
        <div className="grid gap-4">
          <div className="relative mx-auto aspect-square w-full max-w-[280px]" role="img" aria-label={`Vehicle types: ${items.map((item) => `${item.label}, ${item.value} vehicles, ${shareLabel(item.value, total)}`).join("; ")}`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={items} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius="49%" outerRadius="96%" startAngle={90} endAngle={-270} stroke="#fff" strokeWidth={1.5} labelLine={false} label={renderTypeShare} isAnimationActive={false}>
                  {items.map((item) => <Cell key={item.label} fill={item.color} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} ${Number(value) === 1 ? "vehicle" : "vehicles"} · ${shareLabel(Number(value), total)}`, name]} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <strong className="text-4xl font-extrabold tracking-[-0.03em] text-slate-900 sm:text-5xl">{total}</strong>
              <span className="mt-1 max-w-20 text-sm font-medium text-slate-600 sm:max-w-28">{total === vehicleCount ? "Total Vehicles" : "Vehicles with type"}</span>
            </div>
          </div>
          <ul aria-label="Vehicle type counts and percentages" className="grid min-w-0 gap-x-4 [@container(min-width:28rem)]:grid-cols-2">
            {items.map((item) => (
              <li key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto_3.5rem] items-center gap-2 border-b border-slate-100 py-2.5 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-slate-700"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: item.color }} /><span className="min-w-0 break-words">{item.label}</span></span>
                <strong className="font-semibold tabular-nums text-slate-900">{item.value}</strong>
                <span className="text-right tabular-nums text-slate-500">{shareLabel(item.value, total)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : <p className="flex min-h-48 items-center justify-center text-center text-sm text-slate-500">Vehicle classifications will appear here.</p>}
    </section>
  );
}

function renderTypeShare({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.07) return null;
  const angle = -midAngle * Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.6;
  return <text x={cx + radius * Math.cos(angle)} y={cy + radius * Math.sin(angle)} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={15} fontWeight={700} pointerEvents="none">{Number((percent * 100).toFixed(1))}%</text>;
}

function OperatingAreasChart({ items }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const topLocations = items.slice(0, 5);
  const otherCount = items.slice(5).reduce((sum, item) => sum + item.value, 0);
  const rows = [...topLocations.map((item, index) => ({ ...item, color: locationColors[index] })), ...(otherCount ? [{ label: "Other recorded locations", value: otherCount, color: "#94a3b8" }] : [])];
  const maximum = Math.max(1, ...rows.map((item) => item.value));
  return (
    <section aria-label="Operating areas" className="min-w-0">
      <CompositionHeading title="Operating Areas" description="Distribution of vehicles across recorded locations." icon={MapPin} />
      {total ? (
        <>
          <ul className="space-y-4" aria-label="Operating location counts and percentages">
            {rows.map((item) => (
              <li key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto_3.5rem] items-end gap-x-3 gap-y-2 text-sm" title={`${item.label}: ${item.value} ${item.value === 1 ? "vehicle" : "vehicles"} · ${shareLabel(item.value, total)}`}>
                <span className="col-span-3 break-words font-medium leading-5 text-slate-700">{item.label}</span>
                <div className="h-3 self-center overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${item.label}: ${item.value} vehicles, ${shareLabel(item.value, total)}`}>
                  <div className="h-full rounded-full" style={{ width: `${item.value / maximum * 100}%`, backgroundColor: item.color }} />
                </div>
                <strong className="font-semibold tabular-nums text-slate-900">{item.value}</strong>
                <span className="text-right tabular-nums text-slate-500">{shareLabel(item.value, total)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-slate-500"><Info size={15} className="mt-0.5 shrink-0" aria-hidden="true" />Percentages use {total} {total === 1 ? "vehicle" : "vehicles"} with recorded locations. Bar lengths compare vehicle counts.</p>
        </>
      ) : <p className="flex min-h-48 items-center justify-center text-center text-sm text-slate-500">Vehicle locations will appear here.</p>}
    </section>
  );
}

function shareLabel(value, total) {
  return `${(value / total * 100).toFixed(1)}%`;
}

function countValues(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((first, second) => second.value - first.value);
}
