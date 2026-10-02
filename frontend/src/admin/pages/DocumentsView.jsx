import { Eye, FileImage, FileText, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, FilterSelect, SearchField, StatCard, StatusBadge, TableFooter } from "../components/AdminUI";

export default function DocumentsView({ documents, initialStatus = "All Statuses", onView, onReview }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [type, setType] = useState("All Document Types");
  const documentTypes = [...new Set(documents.map((document) => document.document))];
  const approved = documents.filter((document) => document.approval === "Approved").length;
  const pending = documents.filter((document) => document.canReview === true).length;
  const needsAttention = documents.filter((document) => ["Rejected", "Needs Re-upload"].includes(document.approval)).length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return documents.filter((document) => {
      const matchesSearch = !query || [document.customer, document.fileName, document.document].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesStatus = status === "All Statuses" || normalizedStatus(document.approval) === status;
      const matchesType = type === "All Document Types" || document.document === type;
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [documents, search, status, type]);

  const clearFilters = () => { setSearch(""); setStatus("All Statuses"); setType("All Document Types"); };

  return (
    <div className="space-y-5">
      <section aria-label="Document statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Documents" value={documents.length} description="All verification files" icon={FileText} />
        <StatCard label="Approved Documents" value={approved} description="Successfully approved" icon={FileText} tone="green" />
        <StatCard label="Pending Review" value={pending} description="Awaiting admin review" icon={FileText} tone="amber" />
        <StatCard label="Needs Attention" value={needsAttention} description="Files requiring a new upload" icon={FileText} tone="red" />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-4 border-b border-slate-200 p-4 lg:grid-cols-[minmax(280px,1.5fr)_220px_230px_auto] lg:items-end">
          <SearchField label="Search Documents" value={search} onChange={setSearch} placeholder="Search by customer, filename, or document type..." />
          <FilterSelect label="Approval Status" value={status} onChange={setStatus} options={["All Statuses", "Queued", "Screening", "Retrying", "Pending Review", "Needs Re-upload", "Rejected"]} />
          <FilterSelect label="Document Type" value={type} onChange={setType} options={["All Document Types", ...documentTypes]} />
          <button type="button" onClick={clearFilters} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><RotateCcw size={18} strokeWidth={2} aria-hidden="true" />Clear Filters</button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] border-collapse">
            <caption className="sr-only">Customer verification documents</caption>
            <thead className="bg-slate-50"><tr>{["Customer", "Role", "Document Type", "File", "Submitted", "Status", "Actions"].map((heading) => <th key={heading} scope="col" className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((document) => {
                const DocumentIcon = String(document.fileName || "").toLowerCase().endsWith(".pdf") ? FileText : FileImage;
                const readyForReview = document.canReview === true;
                return (
                  <tr key={document.id || document.fileName} className="transition-colors hover:bg-blue-50/30">
                    <td className="whitespace-nowrap px-4 py-3.5 text-sm font-semibold text-slate-950">{document.customer}</td>
                    <td className="px-4 py-3.5 text-sm text-slate-600">{document.role}</td>
                    <td className="px-4 py-3.5 text-sm text-slate-600">{document.document}</td>
                    <td className="max-w-[260px] px-4 py-3.5"><button type="button" title={document.fileName} onClick={() => onView(document)} className="flex max-w-full items-center gap-2 rounded-lg text-left text-sm font-semibold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><DocumentIcon size={16} /></span><span className="truncate">{document.fileName}</span></button></td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-sm tabular-nums text-slate-600"><time dateTime={document.submitted}>{document.submitted}</time></td>
                    <td className="px-4 py-3.5"><StatusBadge value={normalizedStatus(document.approval)} /></td>
                    <td className="px-4 py-3.5"><button type="button" onClick={() => readyForReview ? onReview(document) : onView(document)} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 ${readyForReview ? "bg-blue-600 text-white hover:bg-blue-700" : "border border-slate-300 text-slate-700 hover:bg-slate-50"}`}><Eye size={18} strokeWidth={2} aria-hidden="true" />{readyForReview ? "Review" : "View"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filtered.length ? <EmptyState icon={FileText} title="No verification documents found" description="Try changing your search or filters." /> : null}
        </div>
        <TableFooter visible={filtered.length} total={documents.length} noun="documents" />
      </section>
    </div>
  );
}

function normalizedStatus(status) {
  if (status === "Approved") return "Approved";
  if (status === "Pending") return "Pending Review";
  return status;
}
