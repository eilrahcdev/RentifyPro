import { bookingStatusLabel } from "../../utils/workflowStatus";
import { CalendarDays, CircleCheck, Clock3, Eye } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, FilterSelect, SearchField, StatCard, StatusBadge, TableFooter } from "../components/AdminUI";

export default function BookingsView({ bookings, initialStatus = "All Statuses", onView }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const active = bookings.filter((booking) => booking.isActive).length;
  const overdue = bookings.filter((booking) => booking.isOverdue).length;
  const completed = bookings.filter((booking) => booking.status === "Completed").length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return bookings.filter((booking) => {
      const displayStatus = booking.isOverdue ? "Overdue" : booking.isActive ? "Active" : booking.status;
      const matchesSearch = !query || [booking.reference, booking.renter, booking.vehicle, booking.operator].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesStatus = status === "All Statuses" || displayStatus === status || bookingStatusLabel(booking.status) === status;
      return matchesSearch && matchesStatus;
    });
  }, [bookings, search, status]);

  return (
    <div className="space-y-5">
      <section aria-label="Booking operations statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Bookings" value={bookings.length} description="All platform booking records" icon={CalendarDays} />
        <StatCard label="Active Rentals" value={active} description="Currently in progress" icon={CalendarDays} tone="green" />
        <StatCard label="Overdue Returns" value={overdue} description="Require operational follow-up" icon={Clock3} tone="red" />
        <StatCard label="Completed" value={completed} description="Successfully completed rentals" icon={CircleCheck} tone="slate" />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-4 border-b border-slate-200 p-4 lg:grid-cols-[minmax(280px,1fr)_220px_auto] lg:items-end">
          <SearchField label="Search Bookings" value={search} onChange={setSearch} placeholder="Search by booking, renter, vehicle, or vehicle owner..." />
          <FilterSelect label="Operational Status" value={status} onChange={setStatus} options={["All Statuses", "Active", "Pending", "Confirmed", "Completed", "Cancelled", "Rejected", "Overdue"]} />
          <button type="button" onClick={() => { setSearch(""); setStatus("All Statuses"); }} className="h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">Clear Filters</button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1060px] border-collapse">
            <caption className="sr-only">RentifyPro booking operations without financial information</caption>
            <thead className="bg-slate-50">
              <tr>{["Booking", "Renter", "Vehicle", "Vehicle Owner", "Pickup", "Return", "Driver", "Status", "Actions"].map((heading) => <th key={heading} scope="col" className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((booking) => (
                <tr key={booking.id} className="transition-colors hover:bg-blue-50/30">
                  <td className="whitespace-nowrap px-4 py-3.5 text-sm font-bold text-blue-700">#{booking.reference}</td>
                  <td className="px-4 py-3.5 text-sm font-semibold text-slate-950">{booking.renter}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{booking.vehicle}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{booking.operator}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-sm text-slate-600"><time dateTime={booking.pickupAt}>{formatDateTime(booking.pickupAt)}</time></td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-sm text-slate-600"><time dateTime={booking.returnAt}>{formatDateTime(booking.returnAt)}</time></td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{booking.driverSelected ? "Selected" : "Not selected"}</td>
                  <td className="px-4 py-3.5"><div className="flex flex-wrap gap-1"><StatusBadge value={bookingStatusLabel(booking.status)} />{booking.isOverdue ? <StatusBadge value="Overdue" /> : booking.isActive ? <StatusBadge value="Active" /> : null}</div></td>
                  <td className="px-4 py-3.5"><button type="button" onClick={() => onView(booking)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><Eye size={18} strokeWidth={2} aria-hidden="true" />View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length ? <EmptyState icon={CalendarDays} title="No bookings found" description="Try changing your search or status filter." /> : null}
        </div>
        <TableFooter visible={filtered.length} total={bookings.length} noun="bookings" />
      </section>
    </div>
  );
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
