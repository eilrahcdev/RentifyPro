import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import API from "../../utils/api";
import { getDurationHoursFromMinutes, getDurationMinutesBetween } from "../../utils/dateUtils";
import OwnerPageHeader from "../components/OwnerPageHeader";
import { EarningsContentSkeleton } from "../../components/LoadingSkeletons";
const money = (value) => `\u20b1${Number(value || 0).toLocaleString("en-PH")}`;
const HIDDEN_MONEY = "\u20b1\u2022\u2022\u2022\u2022\u2022\u2022";
const getBookingAmountPayable = (booking) => {
  const payable = Number(booking?.amountPayable);
  if (Number.isFinite(payable) && payable >= 0) return payable;

  const total = Number(booking?.totalAmount);
  const transactionFee = Number(booking?.transactionFee);
  if (Number.isFinite(total) && total >= 0) {
    return total + (Number.isFinite(transactionFee) ? transactionFee : 0);
  }

  const baseAmount = Number(booking?.baseAmount);
  const driverAmount = Number(booking?.driverAmount);
  if (Number.isFinite(baseAmount) && Number.isFinite(driverAmount) && baseAmount + driverAmount >= 0) {
    return baseAmount + driverAmount + (Number.isFinite(transactionFee) ? transactionFee : 0);
  }

  const directMinutes = Number(booking?.bookingDurationMinutes);
  const durationMinutes =
    Number.isFinite(directMinutes) && directMinutes > 0
      ? Math.round(directMinutes)
      : booking?.pickupAt && booking?.returnAt
        ? getDurationMinutesBetween(booking.pickupAt, booking.returnAt)
        : Number.isFinite(Number(booking?.bookingDays))
          ? Math.round(Number(booking.bookingDays) * 24 * 60)
          : 0;
  const durationHours = getDurationHoursFromMinutes(durationMinutes);
  const hourlyRate = Number((booking?.vehicleHourlyRate ?? booking?.vehicleDailyRate) || 0);
  if (Number.isFinite(hourlyRate) && hourlyRate >= 0 && Number.isFinite(durationHours) && durationHours > 0) {
    const driverHourlyRate = Number((booking?.driverHourlyRate ?? booking?.driverDailyRate) || 0);
    const driverSelected = Boolean(booking?.driverSelected);
    const computedDriverAmount =
      driverSelected && Number.isFinite(driverHourlyRate) && driverHourlyRate > 0
        ? driverHourlyRate * durationHours
        : 0;
    return hourlyRate * durationHours + computedDriverAmount +
      (Number.isFinite(transactionFee) ? transactionFee : 0);
  }

  return 0;
};

const getBookingAmountEarned = (booking) => {
  const directEarned = Number(booking?.amountEarned);
  if (Number.isFinite(directEarned) && directEarned >= 0) return directEarned;

  const totalPayable = getBookingAmountPayable(booking);
  const paid = Number(booking?.paymentAmountPaid);
  const status = String(booking?.paymentStatus || "").trim().toLowerCase();
  if (status === "refunded") return 0;
  if (Number.isFinite(paid) && paid > 0) return Math.min(paid, totalPayable);
  if (status === "paid") return totalPayable;
  return 0;
};

const getBookingVehicleIncome = (booking) => {
  const direct = Number(booking?.vehicleIncome);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const baseAmount = Number(booking?.baseAmount);
  return Number.isFinite(baseAmount) && baseAmount >= 0 ? baseAmount : 0;
};

const getBookingDriverIncome = (booking) => {
  const direct = Number(booking?.driverIncome);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const driverAmount = Number(booking?.driverAmount);
  return Number.isFinite(driverAmount) && driverAmount >= 0 ? driverAmount : 0;
};

export default function Earnings() {
  const [summary, setSummary] = useState({
    totalEarnings: 0,
    vehicleIncome: 0,
    driverIncome: 0,
  });
  const [monthly, setMonthly] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [isEarningsVisible, setIsEarningsVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await API.getOwnerEarnings();
        setSummary(response.totals || {});
        setMonthly(response.monthlyEarnings || []);
        setBookings(response.bookings || []);
      } catch (err) {
        setError(err.message || "Failed to load earnings.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const latestMonth = useMemo(() => monthly[0] || null, [monthly]);
  const displayMoney = (value) => isEarningsVisible ? money(value) : HIDDEN_MONEY;

  if (loading) return <EarningsContentSkeleton />;

  return (
    <div className="space-y-6">
      <OwnerPageHeader
        title="Earnings & Revenue"
        description="Review income per booking, driver breakdowns, and monthly revenue."
        actions={(
          <button
            type="button"
            onClick={() => setIsEarningsVisible((visible) => !visible)}
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#017FE6]/40"
            aria-label={isEarningsVisible ? "Hide earnings amounts" : "Show earnings amounts"}
            aria-pressed={isEarningsVisible}
          >
            {isEarningsVisible ? <EyeOff size={18} /> : <Eye size={18} />}
            {isEarningsVisible ? "Hide amounts" : "Show amounts"}
          </button>
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Total Earnings" value={displayMoney(summary.totalEarnings)} />
        <StatCard title="Vehicle Income" value={displayMoney(summary.vehicleIncome)} />
        <StatCard title="Driver Income" value={displayMoney(summary.driverIncome)} />
      </div>

      <div className="bg-white border rounded-xl p-5">
        <h2 className="font-semibold mb-3">Latest Monthly Summary</h2>
        {latestMonth ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Cell title="Year" value={latestMonth._id?.year} />
            <Cell title="Month" value={latestMonth._id?.month} />
            <Cell title="Bookings" value={latestMonth.bookings} />
            <Cell title="Earnings" value={displayMoney(latestMonth.totalEarnings)} />
          </div>
        ) : (
          <p className="text-sm text-gray-500">No monthly earnings data yet.</p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="text-left px-4 py-3">Booking</th>
              <th className="text-left px-4 py-3">Vehicle</th>
              <th className="text-left px-4 py-3">Renter</th>
              <th className="text-right px-4 py-3">Vehicle Income</th>
              <th className="text-right px-4 py-3">Driver Income</th>
              <th className="text-right px-4 py-3">Earned</th>
              <th className="text-left px-4 py-3">Payment Status</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((booking) => (
              <tr key={booking._id} className="border-t">
                <td className="px-4 py-3">{booking._id.slice(-6).toUpperCase()}</td>
                <td className="px-4 py-3">{booking.vehicle?.name || "-"}</td>
                <td className="px-4 py-3">{booking.renter?.name || booking.renter?.email || "-"}</td>
                <td className="px-4 py-3 text-right">{displayMoney(getBookingVehicleIncome(booking))}</td>
                <td className="px-4 py-3 text-right">{displayMoney(getBookingDriverIncome(booking))}</td>
                <td className="px-4 py-3 text-right font-semibold">{displayMoney(getBookingAmountEarned(booking))}</td>
                <td className="px-4 py-3">{booking.paymentStatus}</td>
              </tr>
            ))}
            {!loading && bookings.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-5 text-center text-gray-500">
                  No paid booking earnings available yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ title, value }) {
  return (
    <div className="bg-white border rounded-xl p-5">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

function Cell({ title, value }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-gray-500">{title}</p>
      <p className="font-medium">{value ?? "-"}</p>
    </div>
  );
}
