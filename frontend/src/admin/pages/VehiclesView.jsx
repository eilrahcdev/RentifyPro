import VehicleThumbnail from "../../components/VehicleThumbnail";
import VehiclePhotoReviews from "../../components/VehiclePhotoReviews";
import { CarFront, Eye, SlidersHorizontal, Tags, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, FilterSelect, SearchField, StatCard, StatusBadge, TableFooter } from "../components/AdminUI";

export default function VehiclesView({ vehicles, onView }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All Statuses");
  const [type, setType] = useState("All Types");
  const [category, setCategory] = useState("All Categories");
  const [moreFilters, setMoreFilters] = useState(false);
  const types = [...new Set(vehicles.map((vehicle) => vehicle.type).filter(Boolean))];
  const categories = [...new Set(vehicles.map((vehicle) => vehicle.category).filter(Boolean))];
  const available = vehicles.filter((vehicle) => vehicle.status === "Available").length;
  const unavailable = vehicles.length - available;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      const matchesSearch = !query || [vehicle.name, vehicle.plateNumber, vehicle.operator, vehicle.location].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesStatus = status === "All Statuses" || vehicle.status === status;
      const matchesType = type === "All Types" || vehicle.type === type;
      const matchesCategory = category === "All Categories" || vehicle.category === category;
      return matchesSearch && matchesStatus && matchesType && matchesCategory;
    });
  }, [category, search, status, type, vehicles]);

  return (
    <div className="space-y-5">
      <VehiclePhotoReviews admin />
      <section aria-label="Vehicle statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Vehicles" value={vehicles.length} description="All registered vehicles" icon={CarFront} />
        <StatCard label="Available" value={available} description="Ready for booking" icon={CarFront} tone="green" />
        <StatCard label="Unavailable" value={unavailable} description="Not currently rental-ready" icon={Wrench} tone="amber" />
        <StatCard label="Vehicle Types" value={types.length} description="Fleet classifications" icon={Tags} tone="slate" />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-4 border-b border-slate-200 p-4 lg:grid-cols-[minmax(280px,1.6fr)_220px_220px_auto] lg:items-end">
          <SearchField value={search} onChange={setSearch} placeholder="Search by vehicle, plate number, vehicle owner, or location..." />
          <FilterSelect value={status} onChange={setStatus} options={["All Statuses", "Available", "Unavailable"]} />
          <FilterSelect value={type} onChange={setType} options={["All Types", ...types]} />
          <button type="button" aria-expanded={moreFilters} onClick={() => setMoreFilters((current) => !current)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><SlidersHorizontal size={18} strokeWidth={2} aria-hidden="true" />More Filters</button>
        </div>
        {moreFilters ? <div className="border-b border-slate-200 bg-slate-50/60 p-4"><div className="max-w-xs"><FilterSelect label="Category" value={category} onChange={setCategory} options={["All Categories", ...categories]} /></div></div> : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse">
            <caption className="sr-only">Registered RentifyPro vehicles</caption>
            <thead className="bg-slate-50"><tr>{["Vehicle", "Plate No.", "Category", "Vehicle Owner", "Location", "Rental Rate", "Status", "Actions"].map((heading) => <th key={heading} scope="col" className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((vehicle) => (
                <tr key={vehicle.id || vehicle.plateNumber} className="transition-colors hover:bg-blue-50/30">
                  <td className="px-4 py-3.5"><div className="flex min-w-[250px] items-center gap-3"><VehicleThumbnail vehicle={vehicle} className="h-14 w-20 shrink-0 overflow-hidden rounded-xl" /><div><p className="text-sm font-semibold text-slate-950">{vehicle.name}</p><p className="mt-1 text-xs text-slate-500">{vehicle.type} <span aria-hidden="true">•</span> {vehicle.seats} seats <span aria-hidden="true">•</span> {vehicle.transmission}</p><p className="mt-0.5 text-xs text-slate-500">{vehicle.fuel}</p></div></div></td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-sm text-slate-600">{vehicle.plateNumber}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{vehicle.category}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{vehicle.operator}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{vehicle.location}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-sm font-semibold text-slate-800">{vehicle.rentalRate}</td>
                  <td className="px-4 py-3.5"><StatusBadge value={vehicle.status} /></td>
                  <td className="px-4 py-3.5"><button type="button" onClick={() => onView(vehicle)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><Eye size={18} strokeWidth={2} aria-hidden="true" />View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length ? <EmptyState icon={CarFront} title={vehicles.length ? "No vehicles found" : "No vehicles have been registered yet"} description={vehicles.length ? "Try changing your search or filters." : "Registered vehicles will appear here."} /> : null}
        </div>
        <TableFooter visible={filtered.length} total={vehicles.length} noun="vehicles" />
      </section>
    </div>
  );
}
