import { User, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, FilterSelect, SearchField, StatCard, StatusBadge, TableFooter } from "../components/AdminUI";

const avatarTones = ["bg-blue-50 text-blue-600", "bg-orange-50 text-orange-600", "bg-violet-50 text-violet-600", "bg-cyan-50 text-cyan-700"];

export default function CustomersView({ customers, adminEmail, initialRole = "All Roles", onView }) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState(initialRole);
  const [status, setStatus] = useState("All Statuses");
  const [joined, setJoined] = useState("");
  const visibleCustomers = useMemo(
    () => customers.filter((customer) => customer.role !== "Admin" && String(customer.email || "").toLowerCase() !== String(adminEmail || "").toLowerCase()),
    [adminEmail, customers],
  );
  const active = visibleCustomers.filter((customer) => customer.status === "Active").length;
  const pending = visibleCustomers.filter((customer) => customer.status === "Pending Verification").length;
  const inactive = visibleCustomers.filter((customer) => ["Inactive", "Suspended"].includes(customer.status)).length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return visibleCustomers.filter((customer) => {
      const matchesSearch = !query || [customer.name, customer.email, customer.phone].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesRole = role === "All Roles" || customer.role === role;
      const matchesStatus = status === "All Statuses" || customer.status === status;
      const matchesJoined = !joined || customer.created >= joined;
      return matchesSearch && matchesRole && matchesStatus && matchesJoined;
    });
  }, [joined, role, search, status, visibleCustomers]);

  const clearFilters = () => { setSearch(""); setRole("All Roles"); setStatus("All Statuses"); setJoined(""); };

  return (
    <div className="space-y-5">
      <section aria-label="Customer statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Customers" value={visibleCustomers.length} description="All customer accounts" icon={Users} />
        <StatCard label="Active Customers" value={active} description="Verified and active" icon={User} tone="green" />
        <StatCard label="Pending Verification" value={pending} description="Awaiting account review" icon={User} tone="amber" />
        <StatCard label="Inactive / Suspended" value={inactive} description="Restricted accounts" icon={User} tone="red" />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-4 border-b border-slate-200 p-4 lg:grid-cols-[minmax(260px,1.4fr)_190px_210px_190px_auto] lg:items-end">
          <SearchField label="Search Customers" value={search} onChange={setSearch} placeholder="Search by name, email, or phone..." />
          <FilterSelect label="Role" value={role} onChange={setRole} options={["All Roles", "Renter", "Vehicle Owner"]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={["All Statuses", "Active", "Pending Verification", "Inactive", "Suspended"]} />
          <label className="block"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">Joined From</span><input type="date" value={joined} onChange={(event) => setJoined(event.target.value)} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-700 outline-none hover:border-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /></label>
          <button type="button" onClick={clearFilters} className="h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">Clear Filters</button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse">
            <caption className="sr-only">RentifyPro customer accounts</caption>
            <thead className="bg-slate-50"><tr>{["Customer", "Email", "Phone", "Role", "Status", "Joined", "Actions"].map((heading) => <th key={heading} scope="col" className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((customer, index) => (
                <tr key={customer.id || customer.email} className="transition-colors hover:bg-blue-50/30">
                  <td className="whitespace-nowrap px-4 py-3.5"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${avatarTones[index % avatarTones.length]}`}>{initials(customer.name)}</span><span className="text-sm font-semibold text-slate-950">{customer.name}</span></div></td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{customer.email}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-sm text-slate-600">{customer.phone}</td>
                  <td className="px-4 py-3.5 text-sm text-slate-600">{customer.role}</td>
                  <td className="px-4 py-3.5"><StatusBadge value={customer.status} /></td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-sm tabular-nums text-slate-600"><time dateTime={customer.created}>{customer.created}</time></td>
                  <td className="px-4 py-3.5"><button type="button" onClick={() => onView(customer)} className="h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length ? <EmptyState icon={Users} title="No customers found" description="Try changing your search or filters." /> : null}
        </div>
        <TableFooter visible={filtered.length} total={visibleCustomers.length} noun="customers" />
      </section>
    </div>
  );
}

function initials(name) { return String(name || "?").split(" ").filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase(); }
