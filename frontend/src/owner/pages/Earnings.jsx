<<<<<<< HEAD
import { useEffect, useMemo, useState } from "react";
import API from "../../utils/api";
=======
<<<<<<< HEAD
import React, { useMemo } from "react";
const completedBookings = [
  {
    id: "BKG-1003",
    vehicle: "Mitsubishi Mirage",
    date: "2026-02-22",
    rentalFee: 10000,
    paymentMethod: "Full",
    blockchainTx: "0x8fa3...ab21",
  },
  {
    id: "BKG-1004",
    vehicle: "Toyota Camry 2024",
    date: "2026-03-05",
    rentalFee: 30000,
    paymentMethod: "Downpayment",
    blockchainTx: "0x91c2...ff09",
  },
];
>>>>>>> 8422a2f (fixed bugs and updates)

const money = (value) => `\u20b1${Number(value || 0).toLocaleString("en-PH")}`;
const getPayableAmount = (booking) => {
  const payable = Number(booking?.amountPayable);
  if (Number.isFinite(payable) && payable >= 0) {
    return payable;
  }
  const total = Number(booking?.totalAmount || 0);
  const gasFee = Number(booking?.blockchainGasFee || 0);
  return total + (Number.isFinite(gasFee) && gasFee >= 0 ? gasFee : 0);
};

export default function Earnings() {
  const [summary, setSummary] = useState({
    totalEarnings: 0,
    vehicleIncome: 0,
    driverIncome: 0,
  });
  const [monthly, setMonthly] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Earnings & Revenue</h1>
        <p className="text-sm text-gray-600">
          Income per booking, driver breakdown, and monthly revenue.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Total Earnings" value={money(summary.totalEarnings)} />
        <StatCard title="Vehicle Income" value={money(summary.vehicleIncome)} />
        <StatCard title="Driver Income" value={money(summary.driverIncome)} />
      </div>

      <div className="bg-white border rounded-xl p-5">
        <h2 className="font-semibold mb-3">Latest Monthly Summary</h2>
        {latestMonth ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Cell title="Year" value={latestMonth._id?.year} />
            <Cell title="Month" value={latestMonth._id?.month} />
            <Cell title="Bookings" value={latestMonth.bookings} />
            <Cell title="Earnings" value={money(latestMonth.totalEarnings)} />
          </div>
        ) : (
          <p className="text-sm text-gray-500">No monthly earnings data yet.</p>
        )}
      </div>

      {loading && <p className="text-sm text-gray-600">Loading earnings...</p>}
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
              <th className="text-right px-4 py-3">Total</th>
              <th className="text-left px-4 py-3">Payment Status</th>
            </tr>
          </thead>
          <tbody>
<<<<<<< HEAD
=======
            {completedBookings.map((b) => {
              const fee = b.rentalFee * PLATFORM_FEE_RATE;
              const net = b.rentalFee - fee;

              return (
                <tr key={b.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{b.id}</td>
                  <td className="px-4 py-3">{b.vehicle}</td>
                  <td className="px-4 py-3 text-center">
                    {b.paymentMethod}
                  </td>
                  <td className="px-4 py-3 text-center">
                    ₱{b.rentalFee}
                  </td>
                  <td className="px-4 py-3 text-center text-red-600">
                    ₱{fee}
                  </td>
                  <td className="px-4 py-3 text-center text-green-600 font-semibold">
                    ₱{net}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <a
                      href="#"
                      className="text-blue-600 underline text-xs"
                    >
                      View Tx
                    </a>
                  </td>
                </tr>
              );
            })}
=======
import { useEffect, useMemo, useState } from "react";
import API from "../../utils/api";

const money = (value) => `\u20b1${Number(value || 0).toLocaleString("en-PH")}`;
const getPayableAmount = (booking) => {
  const payable = Number(booking?.amountPayable);
  if (Number.isFinite(payable) && payable >= 0) {
    return payable;
  }
  const total = Number(booking?.totalAmount || 0);
  const gasFee = Number(booking?.blockchainGasFee || 0);
  return total + (Number.isFinite(gasFee) && gasFee >= 0 ? gasFee : 0);
};

export default function Earnings() {
  const [summary, setSummary] = useState({
    totalEarnings: 0,
    vehicleIncome: 0,
    driverIncome: 0,
  });
  const [monthly, setMonthly] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Earnings & Revenue</h1>
        <p className="text-sm text-gray-600">
          Income per booking, driver breakdown, and monthly revenue.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Total Earnings" value={money(summary.totalEarnings)} />
        <StatCard title="Vehicle Income" value={money(summary.vehicleIncome)} />
        <StatCard title="Driver Income" value={money(summary.driverIncome)} />
      </div>

      <div className="bg-white border rounded-xl p-5">
        <h2 className="font-semibold mb-3">Latest Monthly Summary</h2>
        {latestMonth ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Cell title="Year" value={latestMonth._id?.year} />
            <Cell title="Month" value={latestMonth._id?.month} />
            <Cell title="Bookings" value={latestMonth.bookings} />
            <Cell title="Earnings" value={money(latestMonth.totalEarnings)} />
          </div>
        ) : (
          <p className="text-sm text-gray-500">No monthly earnings data yet.</p>
        )}
      </div>

      {loading && <p className="text-sm text-gray-600">Loading earnings...</p>}
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
              <th className="text-right px-4 py-3">Total</th>
              <th className="text-left px-4 py-3">Payment Status</th>
            </tr>
          </thead>
          <tbody>
>>>>>>> 8422a2f (fixed bugs and updates)
            {bookings.map((booking) => (
              <tr key={booking._id} className="border-t">
                <td className="px-4 py-3">{booking._id.slice(-6).toUpperCase()}</td>
                <td className="px-4 py-3">{booking.vehicle?.name || "-"}</td>
                <td className="px-4 py-3">{booking.renter?.name || booking.renter?.email || "-"}</td>
                <td className="px-4 py-3 text-right">{money(booking.baseAmount)}</td>
                <td className="px-4 py-3 text-right">{money(booking.driverAmount)}</td>
                <td className="px-4 py-3 text-right font-semibold">{money(getPayableAmount(booking))}</td>
                <td className="px-4 py-3">{booking.paymentStatus}</td>
              </tr>
            ))}
            {!loading && bookings.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-5 text-center text-gray-500">
                  No completed booking earnings available.
                </td>
              </tr>
            )}
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
          </tbody>
        </table>
      </div>
    </div>
  );
}

<<<<<<< HEAD
function StatCard({ title, value }) {
  return (
=======
<<<<<<< HEAD
function StatCard({ label, value, highlight }) {
  return (
    <div
      className={`rounded-2xl p-5 border ${
        highlight
          ? "bg-green-50 border-green-200"
          : "bg-white"
      }`}
    >
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
=======
function StatCard({ title, value }) {
  return (
>>>>>>> 8422a2f (fixed bugs and updates)
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
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    </div>
  );
}
