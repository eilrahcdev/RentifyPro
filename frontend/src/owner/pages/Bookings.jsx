import { useEffect, useMemo, useState } from "react";
import API from "../../utils/api";
import { getSocket } from "../../utils/socket";

const statusFilters = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "confirmed", label: "Confirmed" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];
const statusStyles = {
  pending: "bg-yellow-100 text-yellow-700",
  confirmed: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
  rejected: "bg-red-100 text-red-700",
};
const paymentStyles = {
  unpaid: "bg-gray-200 text-gray-700",
  partial: "bg-orange-100 text-orange-700",
  paid: "bg-green-100 text-green-700",
  refunded: "bg-blue-100 text-blue-700",
};

const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : "-");
const money = (value) =>
  `\u20b1${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
const toTitleCase = (value = "") =>
  String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
const normalizeBookingStatus = (booking) =>
  booking?.status === "rejected" ? { ...booking, status: "cancelled" } : booking;
const getPayableAmount = (booking) => {
  const payable = Number(booking?.amountPayable);
  if (Number.isFinite(payable) && payable >= 0) {
    return payable;
  }
  const total = Number(booking?.totalAmount || 0);
  const gasFee = Number(booking?.blockchainGasFee || 0);
  return total + (Number.isFinite(gasFee) && gasFee >= 0 ? gasFee : 0);
};

export default function Bookings() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadBookings = async (status = "all") => {
    setLoading(true);
    setError("");
    try {
      const response = await API.getOwnerBookings(status);
      const mapped = (response.bookings || []).map(normalizeBookingStatus);
      setBookings(mapped);
    } catch (err) {
      setError(err.message || "Failed to load bookings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBookings(statusFilter);
  }, [statusFilter]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleBookingUpdate = (booking) => {
      setBookings((prev) => {
        const normalized = normalizeBookingStatus(booking);
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

  const filteredBookings = useMemo(
    () =>
      statusFilter === "all"
        ? bookings
        : bookings.filter((booking) => booking.status === statusFilter),
    [bookings, statusFilter]
  );

  const updateBookingStatus = async (bookingId, nextStatus) => {
    try {
      const response = await API.updateOwnerBookingStatus(bookingId, nextStatus);
      const normalized = normalizeBookingStatus(response.booking);
      setBookings((prev) =>
        prev.map((booking) =>
          booking._id === bookingId ? normalized : booking
        )
      );
    } catch (err) {
      setError(err.message || "Failed to update booking status.");
    }
  };

  const updatePaymentStatus = async (bookingId, paymentStatus) => {
    try {
      const response = await API.updateOwnerBookingPaymentStatus(bookingId, paymentStatus);
      const normalized = normalizeBookingStatus(response.booking);
      setBookings((prev) =>
        prev.map((booking) =>
          booking._id === bookingId ? normalized : booking
        )
      );
    } catch (err) {
      setError(err.message || "Failed to update payment status.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Booking Management</h1>
        <p className="text-sm text-gray-600">
          View and manage renter bookings with status and payment updates.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {statusFilters.map((status) => (
          <button
            key={status.id}
            onClick={() => setStatusFilter(status.id)}
            className={`px-3 py-2 rounded-lg border text-sm ${
              statusFilter === status.id
                ? "bg-[#017FE6] text-white border-[#017FE6]"
                : "bg-white text-gray-700"
            }`}
          >
            {status.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-gray-600">Loading bookings...</p>}

      {!loading && !filteredBookings.length && (
        <div className="bg-white rounded-xl border p-6 text-sm text-gray-600">
          No bookings available.
        </div>
      )}

      <div className="space-y-4">
        {filteredBookings.map((booking) => (
          <article key={booking._id} className="bg-white rounded-xl border p-5">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{booking.vehicle?.name || "Vehicle"}</h3>
                <p className="text-sm text-gray-500">
                  Renter: {booking.renter?.name || booking.renter?.email || "-"}
                </p>
              </div>
              <div className="flex gap-2">
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    statusStyles[booking.status] || "bg-gray-100 text-gray-700"
                  }`}
                >
                  {toTitleCase(booking.status)}
                </span>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    paymentStyles[booking.paymentStatus] || "bg-gray-100 text-gray-700"
                  }`}
                >
                  {toTitleCase(booking.paymentStatus)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-4 text-sm">
              <Info title="Pickup" value={formatDateTime(booking.pickupAt)} />
              <Info title="Return" value={formatDateTime(booking.returnAt)} />
              <Info title="Duration" value={`${booking.bookingDays} day(s)`} />
              <Info title="Location" value={booking.vehicle?.location || "-"} />
              <Info title="Vehicle Rate" value={money(booking.vehicleDailyRate)} />
              <Info
                title="Driver Option"
                value={
                  booking.driverSelected
                    ? `Yes (${money(booking.driverDailyRate)} /day)`
                    : "No"
                }
              />
              <Info title="Base Amount" value={money(booking.baseAmount)} />
              <Info title="Total Payment" value={money(getPayableAmount(booking))} />
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex gap-2 flex-wrap">
                {booking.status === "pending" && (
                  <>
                    <button
                      onClick={() => updateBookingStatus(booking._id, "confirmed")}
                      className="px-3 py-2 rounded-lg bg-green-600 text-white text-sm"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => updateBookingStatus(booking._id, "rejected")}
                      className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm"
                    >
                      Reject
                    </button>
                  </>
                )}
                {booking.status === "confirmed" && (
                  <button
                    onClick={() => updateBookingStatus(booking._id, "completed")}
                    className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm"
                  >
                    Mark Completed
                  </button>
                )}
                {["pending", "confirmed"].includes(booking.status) && (
                  <button
                    onClick={() => updateBookingStatus(booking._id, "cancelled")}
                    className="px-3 py-2 rounded-lg bg-gray-700 text-white text-sm"
                  >
                    Cancel
                  </button>
                )}
              </div>

              <div className="flex justify-start md:justify-end items-center gap-2">
                <label className="text-sm text-gray-600">Payment</label>
                <select
                  className="border rounded-lg px-2 py-2 text-sm"
                  value={booking.paymentStatus}
                  onChange={(e) => updatePaymentStatus(booking._id, e.target.value)}
                >
                  <option value="unpaid">Unpaid</option>
                  <option value="partial">Partial</option>
                  <option value="paid">Paid</option>
                  <option value="refunded">Refunded</option>
                </select>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Info({ title, value }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-gray-500">{title}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
