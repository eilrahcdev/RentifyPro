<<<<<<< HEAD
import { useEffect, useMemo, useState } from "react";
import API from "../../utils/api";
import { getSocket } from "../../utils/socket";
import { getSepoliaEtherscanTxUrl } from "../../blockchain/config";

const money = (value) =>
  `\u20b1${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : "-");
const toTitleCase = (value = "") =>
  String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
const normalizeBookingStatus = (booking) =>
  booking?.status === "rejected" ? { ...booking, status: "cancelled" } : booking;
const getPayableAmount = (record) => {
  const payable = Number(record?.amountPayable);
  if (Number.isFinite(payable) && payable >= 0) {
    return payable;
  }
  const total = Number(record?.totalAmount || 0);
  const gasFee = Number(record?.blockchainGasFee || 0);
  return total + (Number.isFinite(gasFee) && gasFee >= 0 ? gasFee : 0);
};

const shortenHash = (value = "") => {
  const hash = String(value || "").trim();
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
};

const paymentStyles = {
  unpaid: "bg-rose-100 text-rose-700 border border-rose-200",
  partial: "bg-orange-100 text-orange-700 border border-orange-200",
  paid: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  refunded: "bg-cyan-100 text-cyan-700 border border-cyan-200",
};

const bookingStyles = {
  pending: "bg-amber-100 text-amber-700 border border-amber-200",
  confirmed: "bg-blue-100 text-blue-700 border border-blue-200",
  completed: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  cancelled: "bg-rose-100 text-rose-700 border border-rose-200",
  rejected: "bg-rose-100 text-rose-700 border border-rose-200",
};

const recordFilters = [
  { id: "all", label: "All Records" },
  { id: "onchain", label: "On-Chain Only" },
  { id: "pending", label: "Pending On-Chain" },
];

const blockerLabel = {
  chain_not_configured: "Blockchain is not configured on server",
};

const reasonLabel = {
  payment_not_completed: "Waiting for payment confirmation",
  booking_cancelled: "Booking is cancelled/rejected",
  awaiting_record: "Awaiting on-chain recording",
};

=======
<<<<<<< HEAD
>>>>>>> 8422a2f (fixed bugs and updates)
export default function Blockchain() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recordFilter, setRecordFilter] = useState("all");

  const loadRecords = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await API.getOwnerBookings("all");
      const normalized = (response.bookings || []).map(normalizeBookingStatus);
      setRecords(normalized);
    } catch (err) {
      setError(err.message || "Failed to load transaction records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleBookingUpdate = (booking) => {
      const normalized = normalizeBookingStatus(booking);
      setRecords((prev) => {
        const exists = prev.some((item) => item._id === normalized._id);
        if (exists) {
          return prev.map((item) => (item._id === normalized._id ? normalized : item));
        }
        return [normalized, ...prev];
      });
    };

    socket.on("booking:updated", handleBookingUpdate);
    return () => socket.off("booking:updated", handleBookingUpdate);
  }, []);

  const filteredRecords = useMemo(() => {
    if (recordFilter === "onchain") {
      return records.filter((record) => Boolean(record.blockchainTxHash));
    }
    if (recordFilter === "pending") {
      return records.filter(
        (record) =>
          record.paymentStatus === "paid" &&
          !["cancelled", "rejected"].includes(record.status) &&
          !record.blockchainTxHash
      );
    }
    return records;
  }, [records, recordFilter]);

  const onChainCount = useMemo(
    () => records.filter((record) => Boolean(record.blockchainTxHash)).length,
    [records]
  );

  const hasConfigBlocker = useMemo(
    () =>
      filteredRecords.some((record) =>
        (record.blockchainStatus?.blockers || []).includes("chain_not_configured")
      ),
    [filteredRecords]
  );

  return (
<<<<<<< HEAD
=======
    <div className="bg-white p-6 rounded-xl shadow">
      <h1 className="text-xl font-bold">Blockchain Records</h1>
=======
import { useEffect, useMemo, useState } from "react";
import API from "../../utils/api";
import { getSocket } from "../../utils/socket";
import { getSepoliaEtherscanTxUrl } from "../../blockchain/config";

const money = (value) =>
  `\u20b1${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : "-");
const toTitleCase = (value = "") =>
  String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
const normalizeBookingStatus = (booking) =>
  booking?.status === "rejected" ? { ...booking, status: "cancelled" } : booking;
const getPayableAmount = (record) => {
  const payable = Number(record?.amountPayable);
  if (Number.isFinite(payable) && payable >= 0) {
    return payable;
  }
  const total = Number(record?.totalAmount || 0);
  const gasFee = Number(record?.blockchainGasFee || 0);
  return total + (Number.isFinite(gasFee) && gasFee >= 0 ? gasFee : 0);
};

const shortenHash = (value = "") => {
  const hash = String(value || "").trim();
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
};

const paymentStyles = {
  unpaid: "bg-rose-100 text-rose-700 border border-rose-200",
  partial: "bg-orange-100 text-orange-700 border border-orange-200",
  paid: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  refunded: "bg-cyan-100 text-cyan-700 border border-cyan-200",
};

const bookingStyles = {
  pending: "bg-amber-100 text-amber-700 border border-amber-200",
  confirmed: "bg-blue-100 text-blue-700 border border-blue-200",
  completed: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  cancelled: "bg-rose-100 text-rose-700 border border-rose-200",
  rejected: "bg-rose-100 text-rose-700 border border-rose-200",
};

const recordFilters = [
  { id: "all", label: "All Records" },
  { id: "onchain", label: "On-Chain Only" },
  { id: "pending", label: "Pending On-Chain" },
];

const blockerLabel = {
  chain_not_configured: "Blockchain is not configured on server",
};

const reasonLabel = {
  payment_not_completed: "Waiting for payment confirmation",
  booking_cancelled: "Booking is cancelled/rejected",
  awaiting_record: "Awaiting on-chain recording",
};

export default function Blockchain() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recordFilter, setRecordFilter] = useState("all");

  const loadRecords = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await API.getOwnerBookings("all");
      const normalized = (response.bookings || []).map(normalizeBookingStatus);
      setRecords(normalized);
    } catch (err) {
      setError(err.message || "Failed to load transaction records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleBookingUpdate = (booking) => {
      const normalized = normalizeBookingStatus(booking);
      setRecords((prev) => {
        const exists = prev.some((item) => item._id === normalized._id);
        if (exists) {
          return prev.map((item) => (item._id === normalized._id ? normalized : item));
        }
        return [normalized, ...prev];
      });
    };

    socket.on("booking:updated", handleBookingUpdate);
    return () => socket.off("booking:updated", handleBookingUpdate);
  }, []);

  const filteredRecords = useMemo(() => {
    if (recordFilter === "onchain") {
      return records.filter((record) => Boolean(record.blockchainTxHash));
    }
    if (recordFilter === "pending") {
      return records.filter(
        (record) =>
          record.paymentStatus === "paid" &&
          !["cancelled", "rejected"].includes(record.status) &&
          !record.blockchainTxHash
      );
    }
    return records;
  }, [records, recordFilter]);

  const onChainCount = useMemo(
    () => records.filter((record) => Boolean(record.blockchainTxHash)).length,
    [records]
  );

  const hasConfigBlocker = useMemo(
    () =>
      filteredRecords.some((record) =>
        (record.blockchainStatus?.blockers || []).includes("chain_not_configured")
      ),
    [filteredRecords]
  );

  return (
>>>>>>> 8422a2f (fixed bugs and updates)
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transaction Records</h1>
          <p className="text-sm text-gray-600">
            Booking transactions with on-chain references for audit and verification.
          </p>
        </div>
        <div className="text-sm text-gray-600">
          <p>Total Records: {records.length}</p>
          <p>Recorded On-Chain: {onChainCount}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {recordFilters.map((filter) => (
          <button
            key={filter.id}
            onClick={() => setRecordFilter(filter.id)}
            className={`px-3 py-2 rounded-lg border text-sm ${
              recordFilter === filter.id
                ? "bg-[#017FE6] text-white border-[#017FE6]"
                : "bg-white text-gray-700"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-gray-600">Loading transaction records...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && hasConfigBlocker && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          Blockchain setup is incomplete on backend. Add `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`,
          and `BOOKING_LEDGER_CONTRACT_ADDRESS` to `backend/.env`, then restart server.
        </div>
      )}

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="text-left px-4 py-3">Booking</th>
              <th className="text-left px-4 py-3">Vehicle</th>
              <th className="text-left px-4 py-3">Renter</th>
              <th className="text-right px-4 py-3">Total</th>
              <th className="text-left px-4 py-3">Booking Status</th>
              <th className="text-left px-4 py-3">Payment</th>
              <th className="text-left px-4 py-3">Blockchain</th>
              <th className="text-left px-4 py-3">Recorded At</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.map((record) => {
              const txHash = String(record.blockchainTxHash || "").trim();
              const explorerUrl = String(record.blockchainExplorerUrl || "").trim() || getSepoliaEtherscanTxUrl(txHash);
              const bookingIdShort = String(record._id || "").slice(-6).toUpperCase();
              const status = record.blockchainStatus || {};
              const blockers = Array.isArray(status.blockers) ? status.blockers : [];
              const blockerText = blockers.map((code) => blockerLabel[code] || code).join(", ");
              const fallbackText = reasonLabel[status.reason] || "Not recorded yet";

              return (
                <tr key={record._id} className="border-t align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium">{bookingIdShort || "-"}</p>
                    <p className="text-xs text-gray-500">{formatDateTime(record.createdAt)}</p>
                  </td>
                  <td className="px-4 py-3">{record.vehicle?.name || "-"}</td>
                  <td className="px-4 py-3">{record.renter?.name || record.renter?.email || "-"}</td>
                  <td className="px-4 py-3 text-right font-semibold">{money(getPayableAmount(record))}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${
                        bookingStyles[record.status] || "bg-gray-100 text-gray-700 border border-gray-200"
                      }`}
                    >
                      {toTitleCase(record.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${
                        paymentStyles[record.paymentStatus] || "bg-gray-100 text-gray-700 border border-gray-200"
                      }`}
                    >
                      {toTitleCase(record.paymentStatus)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {txHash ? (
                      <div>
                        <a
                          href={explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-[#017FE6] underline break-all"
                          title={txHash}
                        >
                          {shortenHash(txHash)}
                        </a>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <span className="text-xs text-amber-700">{fallbackText}</span>
                        {blockerText && (
                          <p className="text-[11px] text-gray-500">{blockerText}</p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">{formatDateTime(record.blockchainRecordedAt)}</td>
                </tr>
              );
            })}

            {!loading && filteredRecords.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-5 text-center text-gray-500">
                  No transaction records found for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    </div>
  );
}
