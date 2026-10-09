import useResponsiveList from "../../hooks/useResponsiveList";
import ListRevealControls from "../../components/ListRevealControls";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CarFront,
  Info,
  RefreshCw,
} from "lucide-react";
import API from "../../utils/api";
import OwnerPageHeader from "../components/OwnerPageHeader";
import { AnalyticsContentSkeleton } from "../../components/LoadingSkeletons";

const PERIOD_OPTIONS = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "365d", label: "Last 12 months" },
];

const FREQUENCY_META = {
  frequent: {
    label: "Frequent",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    bar: "bg-emerald-500",
  },
  typical: {
    label: "Typical",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
    bar: "bg-[#017FE6]",
  },
  infrequent: {
    label: "Infrequent",
    badge: "bg-amber-50 text-amber-800 ring-amber-200",
    bar: "bg-amber-500",
  },
  none: {
    label: "No bookings",
    badge: "bg-slate-100 text-slate-600 ring-slate-200",
    bar: "bg-slate-400",
  },
  new: {
    label: "New listing",
    badge: "bg-violet-50 text-violet-700 ring-violet-200",
    bar: "bg-violet-500",
  },
};

const money = (value) =>
  `\u20b1${Number(value || 0).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;

const monthLabel = (item) => {
  const year = Number(item?._id?.year);
  const month = Number(item?._id?.month);
  if (!year || !month) return "Unknown month";
  return new Intl.DateTimeFormat("en-PH", { month: "short", year: "numeric" }).format(
    new Date(year, month - 1, 1)
  );
};

const pluralize = (count, singular, plural = `${singular}s`) =>
  `${count.toLocaleString("en-PH")} ${count === 1 ? singular : plural}`;

export default function Analytics() {
  const [period, setPeriod] = useState("90d");
  const [refreshKey, setRefreshKey] = useState(0);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setAnalytics((current) => (current?.period?.key === period ? current : null));
      setLoading(true);
      setError("");
      try {
        const response = await API.getOwnerAnalytics({ period });
        if (!cancelled) setAnalytics(response);
      } catch (err) {
        if (!cancelled) setError(err.message || "Analytics could not be loaded. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [period, refreshKey]);

  const vehiclePerformance = analytics?.vehiclePerformance || [];
  const summary = analytics?.summary || {};
  const visibleRankings = useResponsiveList(vehiclePerformance, period);
  const bookingTrend = useMemo(
    () => (analytics?.bookingTrend || []).slice(-6),
    [analytics?.bookingTrend]
  );
  const earningsTrend = useMemo(
    () => (analytics?.monthlyEarningsTrend || []).slice(-6),
    [analytics?.monthlyEarningsTrend]
  );
  const maxBookingRate = Math.max(
    summary.fleetAverageBookingRate || 0,
    ...vehiclePerformance.map((vehicle) => Number(vehicle.bookingRate || 0)),
    1
  );
  const maxMonthlyBookings = Math.max(
    ...bookingTrend.map((item) => Number(item.totalBookings || 0)),
    1
  );
  const maxMonthlyEarnings = Math.max(
    ...earningsTrend.map((item) => Number(item.totalEarnings || 0)),
    1
  );

  const selectedPeriodLabel =
    PERIOD_OPTIONS.find((option) => option.value === period)?.label || "Selected period";

  return (
    <div className="space-y-5" aria-busy={loading}>
      <OwnerPageHeader
        title="Vehicle performance"
        description="Compare booking demand across your fleet and spot vehicles that may need attention."
        actions={
          <div className="flex w-full items-end gap-2 sm:w-auto">
            <label className="min-w-0 flex-1 sm:w-44 sm:flex-none">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Comparison period</span>
              <select
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
                disabled={loading}
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-wait disabled:opacity-70"
              >
                {PERIOD_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setRefreshKey((value) => value + 1)}
              disabled={loading}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:text-[#017FE6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 disabled:cursor-wait disabled:opacity-60"
              aria-label="Refresh vehicle analytics"
            >
              <RefreshCw size={17} className={loading ? "animate-spin" : ""} aria-hidden="true" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        }
      />

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
            className="min-h-11 rounded-xl px-3 font-semibold text-rose-800 underline decoration-rose-300 underline-offset-4 hover:decoration-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
          >
            Try again
          </button>
        </div>
      )}

      {loading && !analytics ? (
        <AnalyticsContentSkeleton />
      ) : analytics ? (
        <>
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-label="Monthly trends">
            <TrendPanel
              title="Booking activity"
              description="Booking requests created in the latest six recorded months."
              rows={bookingTrend}
              maxValue={maxMonthlyBookings}
              emptyText="No booking history yet."
              getValue={(item) => Number(item.totalBookings || 0)}
              formatValue={(value) => pluralize(value, "request")}
              tone="blue"
            />
            <TrendPanel
              title="Completed-booking earnings"
              description="Recorded earnings from completed bookings by month."
              rows={earningsTrend}
              maxValue={maxMonthlyEarnings}
              emptyText="No completed-booking earnings yet."
              getValue={(item) => Number(item.totalEarnings || 0)}
              formatValue={money}
              tone="green"
            />
          </section>
          {vehiclePerformance.length > 0 && (
            <BookingDemandChart vehicles={vehiclePerformance} periodLabel={selectedPeriodLabel} />
          )}

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.045)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
              <div>
                <div className="flex items-center gap-2">
                  <BarChart3 size={20} className="text-[#017FE6]" aria-hidden="true" />
                  <h2 className="text-lg font-bold tracking-[-0.025em] text-slate-900">Fleet booking frequency</h2>
                </div>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                  Ranked by booking requests per 30 listed days. The marker shows your fleet average.
                </p>
              </div>
              <div className="flex flex-wrap gap-2" aria-label="Frequency legend">
                {Object.entries(FREQUENCY_META).map(([key, meta]) => (
                  <span key={key} className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${meta.badge}`}>
                    {meta.label}
                  </span>
                ))}
              </div>
            </div>

            {vehiclePerformance.length === 0 ? (
              <EmptyFleet />
            ) : (
              <div role="list" className="divide-y divide-slate-100">
                {visibleRankings.items.map((vehicle) => (
                  <VehiclePerformanceRow
                    key={vehicle.vehicleId}
                    vehicle={vehicle}
                    maxBookingRate={maxBookingRate}
                    fleetAverageBookingRate={Number(summary.fleetAverageBookingRate || 0)}
                  />
                ))}
              </div>
            )}

            <ListRevealControls list={visibleRankings} label="vehicle rankings" />
            <div className="flex gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3.5 text-xs leading-5 text-slate-600 sm:px-5">
              <Info size={17} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
              <p>
                Frequent means at least 25% above your fleet average; infrequent means more than 25% below it. Listings under 14 days are marked new. Past days when a vehicle was manually unavailable are not recorded, so availability history is not included.
              </p>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function BookingDemandChart({ vehicles, periodLabel }) {
  const largestValue = Math.max(
    ...vehicles.map((vehicle) => Math.max(
      Number(vehicle.bookings || 0),
      Number(vehicle.completedBookings || 0)
    )),
    1
  );
  const chartMaximum = Math.max(4, Math.ceil(largestValue / 4) * 4);
  const tickValues = [chartMaximum, chartMaximum * 0.75, chartMaximum * 0.5, chartMaximum * 0.25, 0];
  const chartWidth = Math.max(560, vehicles.length * 104);

  return (
    <figure
      data-testid="vehicle-demand-chart"
      aria-labelledby="vehicle-demand-chart-title"
      aria-describedby="vehicle-demand-chart-description"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.045)]"
    >
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 size={20} className="text-[#017FE6]" aria-hidden="true" />
            <h2 id="vehicle-demand-chart-title" className="text-lg font-bold tracking-[-0.025em] text-slate-900">
              Booking requests vs completed
            </h2>
          </div>
          <p id="vehicle-demand-chart-description" className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            Compare how many requests each vehicle received and how many reached completion during the {periodLabel.toLowerCase()}.
          </p>
        </div>
        <div className="flex flex-wrap gap-4 text-xs font-semibold text-slate-700" aria-label="Graph legend">
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-[#017FE6]" aria-hidden="true" />
            Requests
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-emerald-500" aria-hidden="true" />
            Completed
          </span>
        </div>
      </div>

      <div className="px-3 pb-3 pt-5 sm:px-5 sm:pb-5">
        <p className="mb-2 text-xs text-slate-500 sm:hidden">Swipe horizontally to compare every vehicle.</p>
        <div className="overflow-x-auto rounded-lg pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200" tabIndex={0} aria-label="Scrollable vehicle booking graph">
          <div className="flex" style={{ minWidth: `${chartWidth}px` }}>
            <div className="flex h-72 w-9 shrink-0 flex-col text-[0.68rem] tabular-nums text-slate-500">
              <div className="relative h-60 border-r border-slate-200">
                {tickValues.map((tick, index) => (
                  <span
                    key={`${tick}-${index}`}
                    className="absolute right-2"
                    style={{
                      top: `${index * 25}%`,
                      transform: index === 0
                        ? "translateY(0)"
                        : index === tickValues.length - 1
                          ? "translateY(-100%)"
                          : "translateY(-50%)",
                    }}
                  >
                    {Number.isInteger(tick) ? tick : tick.toFixed(1)}
                  </span>
                ))}
              </div>
              <div className="h-12 border-r border-slate-200" aria-hidden="true" />
            </div>

            <div className="flex-1">
              <div
                className="grid h-60 border-b border-slate-300"
                style={{
                  gridTemplateColumns: `repeat(${vehicles.length}, minmax(92px, 1fr))`,
                  backgroundImage: "linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)",
                  backgroundSize: "100% 25%",
                }}
              >
                {vehicles.map((vehicle) => {
                  const requestHeight = (Number(vehicle.bookings || 0) / chartMaximum) * 100;
                  const completedHeight = (Number(vehicle.completedBookings || 0) / chartMaximum) * 100;

                  return (
                    <div
                      key={vehicle.vehicleId}
                      data-chart-vehicle={vehicle.vehicleId}
                      data-requests={vehicle.bookings}
                      className="relative flex min-w-0 items-end justify-center gap-2 px-2"
                      aria-hidden="true"
                    >
                      <ChartBar value={vehicle.bookings} height={requestHeight} color="bg-[#017FE6]" />
                      <ChartBar value={vehicle.completedBookings} height={completedHeight} color="bg-emerald-500" />
                    </div>
                  );
                })}
              </div>
              <div
                className="grid h-12"
                style={{ gridTemplateColumns: `repeat(${vehicles.length}, minmax(92px, 1fr))` }}
              >
                {vehicles.map((vehicle) => (
                  <div key={vehicle.vehicleId} className="min-w-0 px-2">
                    <p className="flex h-12 items-start justify-center pt-2 text-center text-[0.72rem] font-semibold leading-4 text-slate-700" title={vehicle.vehicleName}>
                      <span className="line-clamp-2">{vehicle.vehicleName}</span>
                    </p>
                    <span className="sr-only">
                      {vehicle.vehicleName}: {pluralize(Number(vehicle.bookings || 0), "request")}, {pluralize(Number(vehicle.completedBookings || 0), "completed booking")}.
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <figcaption className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600 sm:px-5">
        The space between each blue and green bar represents requests that are still pending or active, or ended as cancelled or rejected.
      </figcaption>
    </figure>
  );
}

function ChartBar({ value, height, color }) {
  const visibleHeight = value > 0 ? Math.max(height, 3) : 0;
  return (
    <span className="relative flex h-full w-7 items-end justify-center">
      <span
        className="absolute z-10 -translate-y-1 text-[0.68rem] font-bold tabular-nums text-slate-700"
        style={{ bottom: `${Math.min(visibleHeight, 93)}%` }}
      >
        {value}
      </span>
      <span
        className={`block w-full rounded-t-md ${color}`}
        style={{ height: `${visibleHeight}%` }}
      />
    </span>
  );
}

function VehiclePerformanceRow({ vehicle, maxBookingRate, fleetAverageBookingRate }) {
  const meta = FREQUENCY_META[vehicle.frequency] || FREQUENCY_META.typical;
  const barWidth = Math.min(100, (Number(vehicle.bookingRate || 0) / maxBookingRate) * 100);
  const averageMarker = Math.min(100, (fleetAverageBookingRate / maxBookingRate) * 100);

  return (
    <article role="listitem" className="px-4 py-4 sm:px-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold tabular-nums text-slate-400">#{vehicle.rank}</span>
            <h3 className="truncate text-sm font-bold text-slate-900 sm:text-base">{vehicle.vehicleName}</h3>
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${meta.badge}`}>
              {meta.label}
            </span>
            <span className="text-xs text-slate-500">
              {vehicle.availabilityStatus === "available" ? "Available" : "Unavailable"}
            </span>
          </div>

          <div className="mt-3">
            <div className="relative h-2 rounded-full bg-slate-100" aria-hidden="true">
              <span className={`block h-2 rounded-full ${meta.bar}`} style={{ width: `${barWidth}%` }} />
              {fleetAverageBookingRate > 0 && (
                <span
                  className="absolute top-[-3px] h-3.5 w-px bg-slate-700"
                  style={{ left: `${averageMarker}%` }}
                />
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>{vehicle.bookingShare}% of fleet requests</span>
              <TrendLabel trend={vehicle.trend} />
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2 sm:gap-4 lg:min-w-[330px]">
          <Stat label="Requests" value={vehicle.bookings} />
          <Stat label="Per 30 days" value={Number(vehicle.bookingRate || 0).toLocaleString("en-PH", { maximumFractionDigits: 1 })} />
          <Stat label="Completed" value={vehicle.completedBookings} />
        </dl>
      </div>
    </article>
  );
}

function Stat({ label, value }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-2.5 py-2 text-center sm:px-3">
      <dt className="truncate text-[0.68rem] font-semibold uppercase tracking-[0.06em] text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-bold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

function TrendLabel({ trend }) {
  if (!trend || trend.direction === "flat") {
    return <span>Steady vs prior period</span>;
  }
  if (trend.direction === "new") {
    return <span className="font-semibold text-violet-700">New demand this period</span>;
  }

  const isUp = trend.direction === "up";
  const Icon = isUp ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${isUp ? "text-emerald-700" : "text-amber-800"}`}>
      <Icon size={14} aria-hidden="true" />
      {Math.abs(Number(trend.percent || 0))}% vs prior period
    </span>
  );
}

function TrendPanel({ title, description, rows, maxValue, emptyText, getValue, formatValue, tone }) {
  const barClass = tone === "green" ? "bg-emerald-500" : "bg-[#017FE6]";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.035)] sm:p-5">
      <h2 className="text-base font-bold tracking-[-0.02em] text-slate-900">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
      {rows.length === 0 ? (
        <p className="mt-6 rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">{emptyText}</p>
      ) : (
        <div className="mt-5 space-y-4">
          {rows.map((item, index) => {
            const value = getValue(item);
            return (
              <div key={`${item._id?.year}-${item._id?.month}-${index}`}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-slate-700">{monthLabel(item)}</span>
                  <span className="font-bold tabular-nums text-slate-900">{formatValue(value)}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-100" aria-hidden="true">
                  <span className={`block h-2 rounded-full ${barClass}`} style={{ width: `${Math.max(value > 0 ? 4 : 0, (value / maxValue) * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function EmptyFleet() {
  return (
    <div className="px-5 py-12 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-[#017FE6]">
        <CarFront size={21} aria-hidden="true" />
      </span>
      <h3 className="mt-3 text-base font-bold text-slate-900">No vehicles to compare yet</h3>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-600">
        Add a vehicle first. Its booking demand will appear here as renters send requests.
      </p>
    </div>
  );
}
