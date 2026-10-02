import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import API from "../../utils/api";

const EMPTY_PAGE = { hasMore: false, nextCursor: null };
const EMPTY_SUMMARY = {
  totalRecords: 0,
  paidBookings: 0,
  partialPayments: 0,
  unpaidBookings: 0,
  refundedBookings: 0,
  totalCollected: 0,
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
  if (provider && channel) return `${provider} · ${toTitleCase(channel)}`;
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

export default function TransactionRecords() {
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
  const requestSequence = useRef(0);

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
        const response = await API.getAdminTransactions({
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
    loadRecords();
  }, [loadRecords]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Transaction Records</h2>
          <p className="mt-1 text-sm text-slate-600">
            Review payment activity across every renter, owner, and booking.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadRecords({ refresh: true })}
          disabled={loading || refreshing}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={18} strokeWidth={2} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total Records" value={summary.totalRecords.toLocaleString()} />
        <SummaryCard label="Paid Bookings" value={summary.paidBookings.toLocaleString()} tone="emerald" />
        <SummaryCard label="Partial Payments" value={summary.partialPayments.toLocaleString()} tone="orange" />
        <SummaryCard label="Total Collected" value={money(summary.totalCollected)} tone="blue" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
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
              size={18}
              strokeWidth={2}
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
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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

const SummaryCard = ({ label, value, tone = "slate" }) => {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    orange: "border-orange-200 bg-orange-50 text-orange-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
  };

  return (
    <div className={`rounded-xl border p-4 ${tones[tone] || tones.slate}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
};

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
