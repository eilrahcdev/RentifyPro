import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard, PhilippinePeso, ReceiptText, Search, WalletCards } from "lucide-react";
import { adminDataApi } from "../adminDataApi";
import { percentage } from "../adminAnalytics";
import { currentMonthKey, monthLabel, monthOptions } from "../analyticsPeriods";
import { AnalyticsPanel, DistributionList, MetricTile, ProgressRing, TrendBars } from "../components/AdminAnalytics";
import { FilterSelect, StatCard } from "../components/AdminUI";

const EMPTY_PAGE = { hasMore: false, nextCursor: null };
const EMPTY_SUMMARY = {
  totalRecords: 0,
  paidBookings: 0,
  partialPayments: 0,
  unpaidBookings: 0,
  refundedBookings: 0,
  totalCollected: 0,
  totalOutstanding: 0,
  totalPayable: 0,
  totalTransactionFees: 0,
  monthlyTrend: [],
};

const filters = [
  { id: "all", label: "All Records" },
  { id: "paid", label: "Paid" },
  { id: "partial", label: "Partial" },
  { id: "unpaid", label: "Unpaid" },
  { id: "refunded", label: "Refunded" },
];

const money = (value) =>
  `\u20b1${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
};

const toTitleCase = (value = "") =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const getPaymentMethod = (record) => {
  const balanceMethod = String(record?.balancePaymentMethod || "").trim();
  if (balanceMethod) return balanceMethod;

  const provider = String(record?.paymentMethod || "").trim();
  const channel = String(record?.paymentChannel || "").trim();
  if (provider && channel) return `${provider} Â· ${toTitleCase(channel)}`;
  return provider || (channel ? toTitleCase(channel) : "-");
};

const paymentStyles = {
  unpaid: "border-rose-200 bg-rose-50 text-rose-700",
  partial: "border-orange-200 bg-orange-50 text-orange-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  refunded: "border-cyan-200 bg-cyan-50 text-cyan-700",
};

const bookingStyles = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  confirmed: "border-blue-200 bg-blue-50 text-blue-700",
  extended: "border-violet-200 bg-violet-50 text-violet-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
};

export default function TransactionRecords({ refreshSignal = 0, onRefreshStateChange }) {
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [page, setPage] = useState(EMPTY_PAGE);
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [cashFlowPeriod, setCashFlowPeriod] = useState(currentMonthKey);
  const [cashFlow, setCashFlow] = useState({ period: "", monthlyTrend: [], trendStartMonth: null });
  const [cashFlowLoading, setCashFlowLoading] = useState(true);
  const [cashFlowError, setCashFlowError] = useState("");
  const cashFlowRequestSequence = useRef(0);
  const requestSequence = useRef(0);
  const handledRefreshSignal = useRef(refreshSignal);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadRecords = useCallback(
    async ({ cursor = null, append = false, refresh = false } = {}) => {
      const sequence = ++requestSequence.current;
      if (append) setLoadingMore(true);
      else if (refresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      try {
        const response = await adminDataApi.getTransactions({
          paymentStatus: paymentFilter,
          search: searchQuery,
          limit: 50,
          ...(cursor ? { cursor } : {}),
        });
        if (sequence !== requestSequence.current) return;

        const incoming = response?.transactions || [];
        setRecords((previous) => (append ? [...previous, ...incoming] : incoming));
        setSummary(response?.summary || EMPTY_SUMMARY);
        setPage(response?.page || EMPTY_PAGE);
      } catch (err) {
        if (sequence !== requestSequence.current) return;
        setError(err?.message || "Failed to load transaction records.");
        if (!append) {
          setRecords([]);
          setPage(EMPTY_PAGE);
        }
      } finally {
        if (sequence === requestSequence.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [paymentFilter, searchQuery]
  );

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadRecords(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadRecords]);

  useEffect(() => {
    if (refreshSignal === handledRefreshSignal.current) return;
    handledRefreshSignal.current = refreshSignal;
    void loadRecords({ refresh: true });
  }, [loadRecords, refreshSignal]);

  const loadCashFlow = useCallback(async () => {
    const sequence = ++cashFlowRequestSequence.current;
    setCashFlowLoading(true);
    setCashFlowError("");
    try {
      const response = await adminDataApi.getTransactions({ trendEndMonth: cashFlowPeriod, limit: 1 });
      if (sequence !== cashFlowRequestSequence.current) return;
      const trend = response?.summary?.monthlyTrend;
      if (!Array.isArray(trend) || trend.length !== 6 || trend.at(-1)?.key !== cashFlowPeriod) {
        throw new Error("Cash-flow data is unavailable for the selected month. Please try again.");
      }
      setCashFlow({ period: cashFlowPeriod, monthlyTrend: trend, trendStartMonth: response.summary.trendStartMonth || null });
    } catch (err) {
      if (sequence === cashFlowRequestSequence.current) setCashFlowError(err?.message || "Failed to load cash-flow analytics.");
    } finally {
      if (sequence === cashFlowRequestSequence.current) setCashFlowLoading(false);
    }
  }, [cashFlowPeriod]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCashFlow(), 0);
    return () => {
      window.clearTimeout(timer);
      cashFlowRequestSequence.current += 1;
    };
  }, [loadCashFlow, refreshSignal]);

  useEffect(() => {
    onRefreshStateChange?.(loading || refreshing || cashFlowLoading);
  }, [cashFlowLoading, loading, onRefreshStateChange, refreshing]);

  useEffect(() => () => onRefreshStateChange?.(false), [onRefreshStateChange]);

  const cashFlowOptions = monthOptions([cashFlow.trendStartMonth, summary.trendStartMonth, cashFlowPeriod].filter(Boolean).map((month) => `${month}-01T12:00:00`));
  const cashFlowTrend = cashFlow.period === cashFlowPeriod ? cashFlow.monthlyTrend.map((month) => ({
    ...month,
    label: new Date(`${month.key}-01T12:00:00`).toLocaleDateString("en-PH", { month: "short" }),
    tooltipLabel: monthLabel(month.key),
  })) : [];
  const cashFlowPending = cashFlowLoading || (!cashFlowError && cashFlow.period !== cashFlowPeriod);
  const selectCashFlowPeriod = (period) => {
    cashFlowRequestSequence.current += 1;
    setCashFlowPeriod(period);
    setCashFlowLoading(true);
    setCashFlowError("");
  };

  return (
    <div className="space-y-5">
      <section aria-label="Transaction statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Transaction Records" value={Number(summary.totalRecords || 0).toLocaleString()} description="Every booking payment record" icon={ReceiptText} />
        <StatCard label="Total Collected" value={money(summary.totalCollected)} description={`${summary.paidBookings} fully paid bookings`} icon={PhilippinePeso} tone="green" />
        <StatCard label="Outstanding Balance" value={money(summary.totalOutstanding)} description={`${summary.unpaidBookings + summary.partialPayments} bookings with a balance`} icon={WalletCards} tone={summary.totalOutstanding ? "amber" : "slate"} />
        <StatCard label="Transaction Fees" value={money(summary.totalTransactionFees)} description="Fees represented in booking totals" icon={CreditCard} tone="slate" />
      </section>

      <section aria-label="Payment performance" className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(350px,.75fr)]">
        <AnalyticsPanel eyebrow="Payment tracker" title="Cash-flow overview" description={`Collected payments and remaining balances for bookings created in the six months ending ${monthLabel(cashFlowPeriod)}.`} icon={PhilippinePeso} action={<FilterSelect label="Month / Year" aria-label="Cash-flow reporting month and year" value={cashFlowPeriod} onChange={selectCashFlowPeriod} options={cashFlowOptions} className="w-full sm:w-48" />}>
          <div aria-busy={cashFlowPending}>
            {cashFlowPending ? <p role="status" className="flex min-h-44 items-center justify-center text-sm text-slate-500">Loading cash-flow analytics...</p> : cashFlowError ? <div role="alert" className="flex min-h-44 flex-col items-center justify-center gap-3 text-center"><p className="text-sm text-rose-700">{cashFlowError}</p><button type="button" onClick={() => void loadCashFlow()} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">Retry cash-flow analytics</button></div> : <TrendBars data={cashFlowTrend} primaryKey="collected" secondaryKey="outstanding" primaryLabel="Collected (PHP)" secondaryLabel="Outstanding (PHP)" formatValue={money} emptyLabel="No financial activity for bookings created in this six-month period." />}
          </div>
          <div className="mt-5 border-t border-slate-100 pt-5"><p className="mb-3 text-xs font-medium text-slate-500">Current totals across all transaction records</p><div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]"><MetricTile label="Total payable" value={money(summary.totalPayable)} tone="blue" /><MetricTile label="Still outstanding" value={money(summary.totalOutstanding)} tone={summary.totalOutstanding ? "amber" : "slate"} /></div></div>
        </AnalyticsPanel>
        <AnalyticsPanel eyebrow="Payment health" title="Collection and status mix" description="A platform-wide view of completed and unresolved payment records." icon={WalletCards}>
          <ProgressRing value={percentage(summary.totalCollected, summary.totalPayable)} label="Collected" detail={`${money(summary.totalCollected)} received from ${money(summary.totalPayable)} payable.`} tone={percentage(summary.totalCollected, summary.totalPayable) >= 75 ? "emerald" : "amber"} />
          <div className="mt-5 border-t border-slate-100 pt-5"><DistributionList items={[
            { label: "Paid", value: summary.paidBookings, tone: "emerald" },
            { label: "Partial", value: summary.partialPayments, tone: "amber" },
            { label: "Unpaid", value: summary.unpaidBookings, tone: "rose" },
            { label: "Refunded", value: summary.refundedBookings, tone: "violet" },
          ]} total={summary.totalRecords} /></div>
        </AnalyticsPanel>
      </section>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_20px_rgba(33,33,33,0.035)]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {filters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setPaymentFilter(filter.id)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  paymentFilter === filter.id
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <label className="relative block w-full xl:max-w-md">
            <span className="sr-only">Search transaction records</span>
            <Search
              size={17}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search booking, reference, renter, owner, vehicle..."
              maxLength={100}
              className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-600">Loading transaction records...</p>}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-[0_6px_20px_rgba(33,33,33,0.035)]">
          <table className="w-full min-w-[1280px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Record</th>
                <th className="px-4 py-3 text-left font-semibold">Vehicle</th>
                <th className="px-4 py-3 text-left font-semibold">Renter</th>
                <th className="px-4 py-3 text-left font-semibold">Owner</th>
                <th className="px-4 py-3 text-left font-semibold">Method</th>
                <th className="px-4 py-3 text-right font-semibold">Payable</th>
                <th className="px-4 py-3 text-right font-semibold">Paid</th>
                <th className="px-4 py-3 text-right font-semibold">Balance</th>
                <th className="px-4 py-3 text-left font-semibold">Booking</th>
                <th className="px-4 py-3 text-left font-semibold">Payment</th>
                <th className="px-4 py-3 text-left font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const shortId = String(record._id || "").slice(-8).toUpperCase();
                return (
                  <tr key={record._id} className="border-t border-slate-100 align-top hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">#{shortId || "-"}</p>
                      <p className="mt-1 max-w-[180px] break-all text-xs text-slate-500">
                        {record.paymongoReference || "Internal booking record"}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">{formatDateTime(record.createdAt)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{record.vehicle?.name || "Unavailable"}</p>
                      <p className="mt-1 text-xs text-slate-500">{record.vehicle?.location || "-"}</p>
                    </td>
                    <PartyCell party={record.renter} fallback="Renter unavailable" />
                    <PartyCell party={record.owner} fallback="Owner unavailable" />
                    <td className="px-4 py-3 text-slate-700">{getPaymentMethod(record)}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">
                      {money(record.amountPayable)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                      {money(record.paymentAmountPaid)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">
                      {money(record.paymentAmountDue)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={record.bookingStatus} styles={bookingStyles} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={record.paymentStatus} styles={paymentStyles} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDateTime(record.paymentUpdatedAt || record.paidAt || record.updatedAt)}
                    </td>
                  </tr>
                );
              })}

              {records.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-slate-500">
                    No transaction records match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {page.hasMore && !loading && !error && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => loadRecords({ cursor: page.nextCursor, append: true })}
            disabled={loadingMore}
            className="rounded-lg border border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore ? "Loading..." : "Load more records"}
          </button>
        </div>
      )}
    </div>
  );
}

const PartyCell = ({ party, fallback }) => (
  <td className="px-4 py-3">
    <p className="font-medium text-slate-900">{party?.name || fallback}</p>
    <p className="mt-1 text-xs text-slate-500">{party?.email || "-"}</p>
  </td>
);

const StatusBadge = ({ value, styles }) => (
  <span
    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
      styles[value] || "border-slate-200 bg-slate-50 text-slate-700"
    }`}
  >
    {toTitleCase(value || "unknown")}
  </span>
);
