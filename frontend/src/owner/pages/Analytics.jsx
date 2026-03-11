import { useEffect, useMemo, useState } from "react";
import API from "../../utils/api";

const money = (value) => `\u20b1${Number(value || 0).toLocaleString("en-PH")}`;

export default function Analytics() {
  const [earningsTrend, setEarningsTrend] = useState([]);
  const [bookingTrend, setBookingTrend] = useState([]);
  const [topVehicles, setTopVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await API.getOwnerAnalytics();
        setEarningsTrend(response.monthlyEarningsTrend || []);
        setBookingTrend(response.bookingTrend || []);
        setTopVehicles(response.mostBookedVehicles || []);
      } catch (err) {
        setError(err.message || "Failed to fetch analytics.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const metrics = useMemo(() => {
    const totalBookings = bookingTrend.reduce((sum, item) => sum + (item.totalBookings || 0), 0);
    const totalEarnings = earningsTrend.reduce((sum, item) => sum + (item.totalEarnings || 0), 0);
    const completedBookings = bookingTrend.reduce((sum, item) => sum + (item.completed || 0), 0);
    const utilization = totalBookings > 0 ? Math.round((completedBookings / totalBookings) * 100) : 0;

    return {
      totalBookings,
      totalEarnings,
      completedBookings,
      utilization,
    };
  }, [earningsTrend, bookingTrend]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-600">
          Monthly earnings trends, booking trends, and most-booked vehicles.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Metric title="Total Bookings" value={metrics.totalBookings} />
        <Metric title="Completed" value={metrics.completedBookings} />
        <Metric title="Total Earnings" value={money(metrics.totalEarnings)} />
        <Metric title="Utilization" value={`${metrics.utilization}%`} />
      </div>

      {loading && <p className="text-sm text-gray-600">Loading analytics...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Monthly Earnings Trend">
          <div className="space-y-2">
            {earningsTrend.map((item, index) => (
              <Row
                key={`${item._id?.year}-${item._id?.month}-${index}`}
                label={`${item._id?.year}-${String(item._id?.month).padStart(2, "0")}`}
                value={`${money(item.totalEarnings)} (Driver ${money(item.driverIncome)})`}
              />
            ))}
            {!loading && earningsTrend.length === 0 && (
              <p className="text-sm text-gray-500">No earnings trend data.</p>
            )}
          </div>
        </Card>

        <Card title="Booking Trend">
          <div className="space-y-2">
            {bookingTrend.map((item, index) => (
              <Row
                key={`${item._id?.year}-${item._id?.month}-${index}`}
                label={`${item._id?.year}-${String(item._id?.month).padStart(2, "0")}`}
                value={`Total ${item.totalBookings} • P:${item.pending} C:${item.confirmed} Done:${item.completed} X:${item.cancelled}`}
              />
            ))}
            {!loading && bookingTrend.length === 0 && (
              <p className="text-sm text-gray-500">No booking trend data.</p>
            )}
          </div>
        </Card>
      </div>

      <Card title="Most Booked Vehicles">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-gray-700">
              <tr>
                <th className="text-left px-3 py-2">Vehicle</th>
                <th className="text-right px-3 py-2">Bookings</th>
                <th className="text-right px-3 py-2">Completed</th>
                <th className="text-right px-3 py-2">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {topVehicles.map((item) => (
                <tr key={String(item.vehicleId)} className="border-t">
                  <td className="px-3 py-2">{item.vehicleName || "Deleted Vehicle"}</td>
                  <td className="px-3 py-2 text-right">{item.bookings}</td>
                  <td className="px-3 py-2 text-right">{item.completedBookings}</td>
                  <td className="px-3 py-2 text-right">{money(item.revenue)}</td>
                </tr>
              ))}
              {!loading && topVehicles.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-gray-500">
                    No vehicle analytics yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Metric({ title, value }) {
  return (
    <div className="bg-white border rounded-xl p-4">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="bg-white border rounded-xl p-4">
      <h3 className="font-semibold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3 bg-gray-50 rounded-lg px-3 py-2">
      <span className="text-gray-700">{label}</span>
      <span className="text-right text-gray-600">{value}</span>
    </div>
  );
}
