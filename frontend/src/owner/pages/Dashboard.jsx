<<<<<<< HEAD
import { useCallback, useEffect, useMemo, useState } from "react";
import API from "../../utils/api";
import { getSocket } from "../../utils/socket";
import { formatDisplayName } from "../../utils/dateUtils";
import { resolveAssetUrl } from "../../utils/media";
=======
<<<<<<< HEAD
import { useState } from "react";
>>>>>>> 8422a2f (fixed bugs and updates)

const money = (value) =>
  `\u20b1${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

const statusBadge = {
  pending: "bg-amber-100 text-amber-800",
  confirmed: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-gray-200 text-gray-700",
};

const normalizeBookingStatus = (booking) =>
  booking?.status === "rejected" ? { ...booking, status: "cancelled" } : booking;

const toDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateTime = (value) => {
  const date = toDate(value);
  return date ? date.toLocaleString() : "-";
};

const getPayableAmount = (booking) => {
  const payable = Number(booking?.amountPayable);
  if (Number.isFinite(payable) && payable >= 0) {
    return payable;
  }
  const total = Number(booking?.totalAmount || 0);
  const gasFee = Number(booking?.blockchainGasFee || 0);
  return total + (Number.isFinite(gasFee) && gasFee >= 0 ? gasFee : 0);
};

const getRangeStart = (range) => {
  const start = new Date();
  start.setSeconds(0, 0);

  if (range === "week") {
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  if (range === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  start.setMonth(0, 1);
  start.setHours(0, 0, 0, 0);
  return start;
};

const rangeLabel = {
  week: "This Week",
  month: "This Month",
  year: "This Year",
};

const getRenterProfile = (renter) => {
  const name = formatDisplayName(renter?.name || "", "");
  const email = String(renter?.email || "").trim();
  const displayName = name || email || "Renter";
  const initialsSource = name || email || "R";
  const initials = initialsSource
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "R";

  return {
    displayName,
    email,
    avatar: resolveAssetUrl(renter?.avatar),
    initials,
  };
};

export default function Dashboard() {
  const [vehicles, setVehicles] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [earningsBookings, setEarningsBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [earningsRange, setEarningsRange] = useState("week");
  const [updatingBookingId, setUpdatingBookingId] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setSyncing(true);
    } else {
      setLoading(true);
    }

    try {
      const [vehiclesResponse, bookingsResponse, earningsResponse] = await Promise.all([
        API.getOwnerVehicles(),
        API.getOwnerBookings("all"),
        API.getOwnerEarnings(),
      ]);

      setVehicles(vehiclesResponse.vehicles || []);
      setBookings((bookingsResponse.bookings || []).map(normalizeBookingStatus));
      setEarningsBookings(earningsResponse.bookings || []);
      setLastUpdated(new Date().toISOString());
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load owner dashboard.");
    } finally {
      if (silent) {
        setSyncing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    const syncDashboard = () => loadDashboard({ silent: true });
    socket.on("booking:updated", syncDashboard);
    socket.on("notification:new", syncDashboard);

    return () => {
      socket.off("booking:updated", syncDashboard);
      socket.off("notification:new", syncDashboard);
    };
  }, [loadDashboard]);

  const stats = useMemo(
    () => ({
      myVehicles: vehicles.length,
      activeRentals: bookings.filter((booking) => booking.status === "confirmed").length,
      pendingRequests: bookings.filter((booking) => booking.status === "pending").length,
      completedRentals: bookings.filter((booking) => booking.status === "completed").length,
    }),
    [vehicles, bookings]
  );

  const pendingRequests = useMemo(
    () =>
      bookings
        .filter((booking) => booking.status === "pending")
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5),
    [bookings]
  );

  const recentActivity = useMemo(
    () =>
      [...bookings]
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
        .slice(0, 6),
    [bookings]
  );

  const selectedRangeEarnings = useMemo(() => {
    const rangeStart = getRangeStart(earningsRange);
    return earningsBookings.reduce((sum, booking) => {
      const completedAt = toDate(booking.completedAt || booking.updatedAt || booking.createdAt);
      if (!completedAt || completedAt < rangeStart) return sum;
      return sum + getPayableAmount(booking);
    }, 0);
  }, [earningsBookings, earningsRange]);

  const updateBookingStatus = async (bookingId, nextStatus) => {
    setUpdatingBookingId(bookingId);
    try {
      const response = await API.updateOwnerBookingStatus(bookingId, nextStatus);
      const updated = normalizeBookingStatus(response.booking);

      setBookings((prev) => {
        const exists = prev.some((booking) => booking._id === bookingId);
        if (!exists) return [updated, ...prev];
        return prev.map((booking) => (booking._id === bookingId ? updated : booking));
      });

      setLastUpdated(new Date().toISOString());
      loadDashboard({ silent: true });
    } catch (err) {
      setError(err.message || "Failed to update booking.");
    } finally {
      setUpdatingBookingId("");
    }
  };

  return (
    <div className="space-y-8 bg-gray-50 min-h-full p-4 border border-black/30 rounded-3xl">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {syncing ? "Syncing live updates..." : `Last updated: ${formatDateTime(lastUpdated)}`}
        </p>
        {loading && <p className="text-xs text-gray-500">Loading dashboard...</p>}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

<<<<<<< HEAD
=======
        {/* EARNINGS */}
=======
import { useCallback, useEffect, useMemo, useState } from "react";
import API from "../../utils/api";
import { getSocket } from "../../utils/socket";
import { formatDisplayName } from "../../utils/dateUtils";
import { resolveAssetUrl } from "../../utils/media";

const money = (value) =>
  `\u20b1${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

const statusBadge = {
  pending: "bg-amber-100 text-amber-800",
  confirmed: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-gray-200 text-gray-700",
};

const normalizeBookingStatus = (booking) =>
  booking?.status === "rejected" ? { ...booking, status: "cancelled" } : booking;

const toDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateTime = (value) => {
  const date = toDate(value);
  return date ? date.toLocaleString() : "-";
};

const getPayableAmount = (booking) => {
  const payable = Number(booking?.amountPayable);
  if (Number.isFinite(payable) && payable >= 0) {
    return payable;
  }
  const total = Number(booking?.totalAmount || 0);
  const gasFee = Number(booking?.blockchainGasFee || 0);
  return total + (Number.isFinite(gasFee) && gasFee >= 0 ? gasFee : 0);
};

const getRangeStart = (range) => {
  const start = new Date();
  start.setSeconds(0, 0);

  if (range === "week") {
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  if (range === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  start.setMonth(0, 1);
  start.setHours(0, 0, 0, 0);
  return start;
};

const rangeLabel = {
  week: "This Week",
  month: "This Month",
  year: "This Year",
};

const getRenterProfile = (renter) => {
  const name = formatDisplayName(renter?.name || "", "");
  const email = String(renter?.email || "").trim();
  const displayName = name || email || "Renter";
  const initialsSource = name || email || "R";
  const initials = initialsSource
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "R";

  return {
    displayName,
    email,
    avatar: resolveAssetUrl(renter?.avatar),
    initials,
  };
};

export default function Dashboard() {
  const [vehicles, setVehicles] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [earningsBookings, setEarningsBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [earningsRange, setEarningsRange] = useState("week");
  const [updatingBookingId, setUpdatingBookingId] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setSyncing(true);
    } else {
      setLoading(true);
    }

    try {
      const [vehiclesResponse, bookingsResponse, earningsResponse] = await Promise.all([
        API.getOwnerVehicles(),
        API.getOwnerBookings("all"),
        API.getOwnerEarnings(),
      ]);

      setVehicles(vehiclesResponse.vehicles || []);
      setBookings((bookingsResponse.bookings || []).map(normalizeBookingStatus));
      setEarningsBookings(earningsResponse.bookings || []);
      setLastUpdated(new Date().toISOString());
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load owner dashboard.");
    } finally {
      if (silent) {
        setSyncing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    const syncDashboard = () => loadDashboard({ silent: true });
    socket.on("booking:updated", syncDashboard);
    socket.on("notification:new", syncDashboard);

    return () => {
      socket.off("booking:updated", syncDashboard);
      socket.off("notification:new", syncDashboard);
    };
  }, [loadDashboard]);

  const stats = useMemo(
    () => ({
      myVehicles: vehicles.length,
      activeRentals: bookings.filter((booking) => booking.status === "confirmed").length,
      pendingRequests: bookings.filter((booking) => booking.status === "pending").length,
      completedRentals: bookings.filter((booking) => booking.status === "completed").length,
    }),
    [vehicles, bookings]
  );

  const pendingRequests = useMemo(
    () =>
      bookings
        .filter((booking) => booking.status === "pending")
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5),
    [bookings]
  );

  const recentActivity = useMemo(
    () =>
      [...bookings]
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
        .slice(0, 6),
    [bookings]
  );

  const selectedRangeEarnings = useMemo(() => {
    const rangeStart = getRangeStart(earningsRange);
    return earningsBookings.reduce((sum, booking) => {
      const completedAt = toDate(booking.completedAt || booking.updatedAt || booking.createdAt);
      if (!completedAt || completedAt < rangeStart) return sum;
      return sum + getPayableAmount(booking);
    }, 0);
  }, [earningsBookings, earningsRange]);

  const updateBookingStatus = async (bookingId, nextStatus) => {
    setUpdatingBookingId(bookingId);
    try {
      const response = await API.updateOwnerBookingStatus(bookingId, nextStatus);
      const updated = normalizeBookingStatus(response.booking);

      setBookings((prev) => {
        const exists = prev.some((booking) => booking._id === bookingId);
        if (!exists) return [updated, ...prev];
        return prev.map((booking) => (booking._id === bookingId ? updated : booking));
      });

      setLastUpdated(new Date().toISOString());
      loadDashboard({ silent: true });
    } catch (err) {
      setError(err.message || "Failed to update booking.");
    } finally {
      setUpdatingBookingId("");
    }
  };

  return (
    <div className="space-y-8 bg-gray-50 min-h-full p-4 border border-black/30 rounded-3xl">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {syncing ? "Syncing live updates..." : `Last updated: ${formatDateTime(lastUpdated)}`}
        </p>
        {loading && <p className="text-xs text-gray-500">Loading dashboard...</p>}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

>>>>>>> 8422a2f (fixed bugs and updates)
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard title="My Vehicles" value={stats.myVehicles} accent="blue" />
        <StatCard title="Active Rentals" value={stats.activeRentals} accent="emerald" />
        <StatCard title="Pending Requests" value={stats.pendingRequests} accent="amber" />
        <StatCard title="Completed Rentals" value={stats.completedRentals} accent="indigo" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
        <Panel className="lg:col-span-2">
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-semibold text-gray-800">My Earnings</h2>

            <select
              value={earningsRange}
<<<<<<< HEAD
              onChange={(event) => setEarningsRange(event.target.value)}
=======
<<<<<<< HEAD
              onChange={(e) => setEarningsRange(e.target.value)}
=======
              onChange={(event) => setEarningsRange(event.target.value)}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
              className="border border-gray-300 rounded-lg px-3 py-1 text-sm bg-white"
            >
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="year">This Year</option>
            </select>
          </div>

          <div className="h-48 flex flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-[#017FE6]/15 to-transparent">
<<<<<<< HEAD
            <p className="text-sm text-gray-600 mb-2">Earnings ({rangeLabel[earningsRange]})</p>
            <p className="text-4xl font-bold text-[#017FE6]">{money(selectedRangeEarnings)}</p>
=======
<<<<<<< HEAD
            <p className="text-sm text-gray-600 mb-2">
              Earnings ({earningsRange})
            </p>
            <p className="text-4xl font-bold text-[#017FE6]">
              {earningsData[earningsRange]}
            </p>
>>>>>>> 8422a2f (fixed bugs and updates)
          </div>
        </Panel>

        <Panel>
          <h2 className="font-semibold text-gray-800 mb-4">Booking Requests</h2>

          {pendingRequests.length === 0 ? (
            <p className="text-sm text-gray-500">No pending requests</p>
          ) : (
            <div className="space-y-4">
              {pendingRequests.map((booking) => {
                const renter = getRenterProfile(booking.renter);
                const isUpdating = updatingBookingId === booking._id;

                return (
                  <div key={booking._id} className="p-3 rounded-xl bg-gray-200/60">
                    <div className="flex items-center gap-3">
                      <RenterAvatar profile={renter} sizeClass="h-9 w-9" />
                      <div className="min-w-0">
                        <p className="font-medium text-gray-800 truncate">{renter.displayName}</p>
                        <p className="text-xs text-gray-500 truncate">{renter.email || "No email provided"}</p>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600">
                      {booking.vehicle?.name || "Vehicle"} - {booking.bookingDays || 1} day(s)
                    </p>

                    <div className="flex gap-2 mt-3">
                      <button
                        disabled={isUpdating}
                        onClick={() => updateBookingStatus(booking._id, "confirmed")}
                        className="flex-1 bg-green-200 text-green-800 rounded-lg py-1 hover:bg-green-300 disabled:opacity-60"
                      >
                        Accept
                      </button>
                      <button
                        disabled={isUpdating}
                        onClick={() => updateBookingStatus(booking._id, "rejected")}
                        className="flex-1 bg-red-200 text-red-700 rounded-lg py-1 hover:bg-red-300 disabled:opacity-60"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
<<<<<<< HEAD
                );
              })}
=======
                </div>
              ))}
=======
            <p className="text-sm text-gray-600 mb-2">Earnings ({rangeLabel[earningsRange]})</p>
            <p className="text-4xl font-bold text-[#017FE6]">{money(selectedRangeEarnings)}</p>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-semibold text-gray-800 mb-4">Booking Requests</h2>

          {pendingRequests.length === 0 ? (
            <p className="text-sm text-gray-500">No pending requests</p>
          ) : (
            <div className="space-y-4">
              {pendingRequests.map((booking) => {
                const renter = getRenterProfile(booking.renter);
                const isUpdating = updatingBookingId === booking._id;

                return (
                  <div key={booking._id} className="p-3 rounded-xl bg-gray-200/60">
                    <div className="flex items-center gap-3">
                      <RenterAvatar profile={renter} sizeClass="h-9 w-9" />
                      <div className="min-w-0">
                        <p className="font-medium text-gray-800 truncate">{renter.displayName}</p>
                        <p className="text-xs text-gray-500 truncate">{renter.email || "No email provided"}</p>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600">
                      {booking.vehicle?.name || "Vehicle"} - {booking.bookingDays || 1} day(s)
                    </p>

                    <div className="flex gap-2 mt-3">
                      <button
                        disabled={isUpdating}
                        onClick={() => updateBookingStatus(booking._id, "confirmed")}
                        className="flex-1 bg-green-200 text-green-800 rounded-lg py-1 hover:bg-green-300 disabled:opacity-60"
                      >
                        Accept
                      </button>
                      <button
                        disabled={isUpdating}
                        onClick={() => updateBookingStatus(booking._id, "rejected")}
                        className="flex-1 bg-red-200 text-red-700 rounded-lg py-1 hover:bg-red-300 disabled:opacity-60"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                );
              })}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
            </div>
          )}
        </Panel>
      </div>

<<<<<<< HEAD
=======
<<<<<<< HEAD
      {/* RECENT ACTIVITY */}
>>>>>>> 8422a2f (fixed bugs and updates)
      <Panel>
        <h2 className="font-semibold text-gray-800 mb-4">My Recent Activity</h2>

        {recentActivity.length === 0 ? (
          <p className="text-sm text-gray-500">No recent activity yet.</p>
        ) : (
          <div className="space-y-3">
            {recentActivity.map((booking) => {
              const renter = getRenterProfile(booking.renter);
              return (
                <div
                  key={booking._id}
                  className="flex items-center justify-between bg-gray-200/60 rounded-xl p-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <RenterAvatar profile={renter} sizeClass="h-10 w-10" />
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 truncate">{booking.vehicle?.name || "Vehicle"}</p>
                      <p className="text-xs text-gray-600 truncate">
                        {renter.displayName} - {formatDateTime(booking.updatedAt || booking.createdAt)}
                      </p>
                    </div>
                  </div>

<<<<<<< HEAD
=======
              <span className="px-3 py-1 text-xs rounded-full font-semibold bg-blue-200 text-blue-800">
                {r.status}
              </span>
            </div>
          ))}
        </div>
=======
      <Panel>
        <h2 className="font-semibold text-gray-800 mb-4">My Recent Activity</h2>

        {recentActivity.length === 0 ? (
          <p className="text-sm text-gray-500">No recent activity yet.</p>
        ) : (
          <div className="space-y-3">
            {recentActivity.map((booking) => {
              const renter = getRenterProfile(booking.renter);
              return (
                <div
                  key={booking._id}
                  className="flex items-center justify-between bg-gray-200/60 rounded-xl p-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <RenterAvatar profile={renter} sizeClass="h-10 w-10" />
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 truncate">{booking.vehicle?.name || "Vehicle"}</p>
                      <p className="text-xs text-gray-600 truncate">
                        {renter.displayName} - {formatDateTime(booking.updatedAt || booking.createdAt)}
                      </p>
                    </div>
                  </div>

>>>>>>> 8422a2f (fixed bugs and updates)
                  <span
                    className={`px-3 py-1 text-xs rounded-full font-semibold ${
                      statusBadge[booking.status] || "bg-gray-200 text-gray-700"
                    }`}
                  >
                    {booking.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      </Panel>
    </div>
  );
}

<<<<<<< HEAD
function RenterAvatar({ profile, sizeClass = "h-9 w-9" }) {
  const avatar = String(profile?.avatar || "").trim();
  const [failed, setFailed] = useState(false);

=======
<<<<<<< HEAD

=======
function RenterAvatar({ profile, sizeClass = "h-9 w-9" }) {
  const avatar = String(profile?.avatar || "").trim();
  const [failed, setFailed] = useState(false);

>>>>>>> 8422a2f (fixed bugs and updates)
  useEffect(() => {
    setFailed(false);
  }, [avatar]);

  if (avatar && !failed) {
    return (
      <img
        src={avatar}
        alt={profile?.displayName || "Renter"}
        className={`${sizeClass} rounded-full object-cover border border-slate-200 flex-shrink-0`}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full bg-[#017FE6] text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}
      aria-label={profile?.displayName || "Renter"}
    >
      {profile?.initials || "R"}
    </div>
  );
}
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)

function Panel({ children, className = "" }) {
  return (
    <div
      className={`bg-white rounded-3xl p-6 border border-gray-200/70 shadow-[0_8px_24px_rgba(0,0,0,0.06)] ${className}`}
    >
      {children}
    </div>
  );
}

function StatCard({ title, value, accent }) {
  const accentMap = {
    blue: "text-[#017FE6]",
    amber: "text-amber-700",
    emerald: "text-emerald-700",
    indigo: "text-indigo-700",
  };

  return (
    <Panel>
      <p className="text-sm text-gray-600 mb-1">{title}</p>
<<<<<<< HEAD
      <p className={`text-3xl font-bold ${accentMap[accent]}`}>{value}</p>
    </Panel>
  );
}


=======
<<<<<<< HEAD
      <p className={`text-3xl font-bold ${accentMap[accent]}`}>
        {value}
      </p>
    </Panel>
  );
}
=======
      <p className={`text-3xl font-bold ${accentMap[accent]}`}>{value}</p>
    </Panel>
  );
}


>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
