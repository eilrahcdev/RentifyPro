import { AlertTriangle, Eye, FileImage, FileText, RotateCcw, ScanSearch, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { percentage } from "../adminAnalytics";
import { AnalyticsPanel, DistributionList, MetricTile, ProgressRing } from "../components/AdminAnalytics";
import { EmptyState, FilterSelect, SearchField, StatCard, StatusBadge, PaginationFooter } from "../components/AdminUI";
import { useTablePage } from "../useTablePage";

export default function DocumentsView({ documents: allDocuments, initialStatus = "All Statuses", initialPurpose = "Final approval", onView, onReview }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [type, setType] = useState("All Document Types");
  const [registration, setRegistration] = useState("All uploads");
  const [purpose, setPurpose] = useState(initialPurpose);
  const documents = useMemo(() => allDocuments.filter(document => (document.reviewPurpose || "Final approval") === purpose), [allDocuments, purpose]);
  const documentTypes = [...new Set(documents.map((document) => document.document).filter(Boolean))];
  const approved = documents.filter((document) => document.approval === "Approved").length;
  const pending = documents.filter((document) => document.approval === "Pending").length;
  const rejected = documents.filter((document) => document.approval === "Rejected").length;
  const tamperingFlags = documents.filter((document) => document.suspectedTampering).length;
  const mismatchFlags = documents.filter((document) => document.mismatchFields?.length).length;
  const retrying = documents.filter((document) => document.processingStage === "retry_wait").length;
  const resolutionRate = percentage(approved + rejected, documents.length);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return documents.filter((document) => {
      const matchesSearch = !query || [document.customer, document.email, document.fileName, document.document].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesStatus = status === "All Statuses" || normalizedStatus(document.approval) === status;
      const matchesType = type === "All Document Types" || document.document === type;
      const matchesRegistration = registration === "All uploads" || registration === (document.accountLink?.label || "Account link needs review");
      return matchesSearch && matchesStatus && matchesType && matchesRegistration;
    });
  }, [documents, search, status, type, registration]);
  const pagination = useTablePage(filtered);

  const clearFilters = () => { setSearch(""); setStatus("All Statuses"); setType("All Document Types"); setRegistration("All uploads"); };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3" role="group" aria-label="Review purpose">{["Final approval", "Registration assistance"].map(value => <button key={value} type="button" aria-pressed={purpose === value} onClick={() => setPurpose(value)} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2">{value}</button>)}</div>
      <section aria-label="Document statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Documents" value={documents.length} description="All verification files" icon={FileText} />
        <StatCard label="Verified Documents" value={approved} description="Successfully approved" icon={FileText} tone="green" />
        <StatCard label="Pending Review" value={pending} description="Awaiting admin review" icon={FileText} tone="amber" />
        <StatCard label="Needs Attention" value={rejected} description="Rejected verification files" icon={FileText} tone="red" />
      </section>

      <section aria-label="Document review insights" className="grid gap-5 xl:grid-cols-[minmax(330px,.72fr)_minmax(0,1.28fr)]">
        <AnalyticsPanel eyebrow="Verification pipeline" title="Review completion" description="Resolved decisions compared with the total verification queue." icon={ShieldCheck}>
          <ProgressRing value={resolutionRate} label="Resolved" detail={`${approved + rejected} of ${documents.length} documents have a final decision.`} tone={resolutionRate >= 75 ? "emerald" : "amber"} />
          <div className="mt-5 border-t border-slate-100 pt-5"><DistributionList items={[
            { label: "Verified", value: approved, tone: "emerald" },
            { label: "Pending review", value: pending, tone: "amber" },
            { label: "Rejected", value: rejected, tone: "rose" },
          ]} /></div>
        </AnalyticsPanel>
        <AnalyticsPanel eyebrow="Screening monitor" title="Items requiring closer inspection" description="Automated screening signals help prioritize manual review; they do not make the final decision." icon={ScanSearch}>
          <div className="grid gap-3 sm:grid-cols-3"><MetricTile label="Tampering flags" value={tamperingFlags} helper="Potential file alteration" tone={tamperingFlags ? "rose" : "slate"} /><MetricTile label="Detail mismatches" value={mismatchFlags} helper="Submitted data differs" tone={mismatchFlags ? "amber" : "slate"} /><MetricTile label="Waiting to retry" value={retrying} helper="Screening will resume" tone={retrying ? "violet" : "slate"} /></div>
          <div className={`mt-5 flex gap-3 rounded-xl border p-4 ${tamperingFlags || mismatchFlags ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
            {tamperingFlags || mismatchFlags ? <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={19} /> : <ShieldCheck className="mt-0.5 shrink-0 text-emerald-600" size={19} />}
            <div><p className={`text-sm font-bold ${tamperingFlags || mismatchFlags ? "text-amber-900" : "text-emerald-900"}`}>{tamperingFlags || mismatchFlags ? "Manual inspection recommended" : "No screening risks detected"}</p><p className={`mt-1 text-xs leading-5 ${tamperingFlags || mismatchFlags ? "text-amber-700" : "text-emerald-700"}`}>{tamperingFlags || mismatchFlags ? `${tamperingFlags + mismatchFlags} screening signal${tamperingFlags + mismatchFlags === 1 ? "" : "s"} appear across the queue. Open each document and verify the evidence before deciding.` : "Current documents have no mismatch or tampering indicators."}</p></div>
          </div>
          <div className="mt-5 border-t border-slate-100 pt-5"><p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Document type mix</p><DistributionList items={documentTypes.map((documentType, index) => ({ label: documentType, value: documents.filter((document) => document.document === documentType).length, tone: ["blue", "violet", "emerald", "amber"][index % 4] }))} emptyLabel="Document types will appear here." /></div>
        </AnalyticsPanel>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_6px_20px_rgba(33,33,33,0.035)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
          <button type="button" aria-pressed={status === "Pending Review"} onClick={() => { setStatus("Pending Review"); setSearch(""); setType("All Document Types"); setRegistration("All uploads"); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-800 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">Pending Review <span className="tabular-nums">({pending})</span></button>
          <p className="text-sm text-slate-600">{purpose === "Registration assistance" ? "Requested ID comparisons for applicants who have not submitted an account." : "Submitted account documents awaiting final approval."}</p>
        </div>
        <div className="grid gap-4 border-b border-slate-200 p-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end">
          <SearchField label="Search Documents" value={search} onChange={setSearch} placeholder="Name, email, filename, or document type..." />
          <FilterSelect label="Approval Status" value={status} onChange={setStatus} options={["All Statuses", "Verified", "Pending Review", "Queued", "Processing", "Waiting to retry", "Replacement required", "Expired", "Rejected"]} />
          <FilterSelect label="Document Type" value={type} onChange={setType} options={["All Document Types", ...documentTypes]} />
          <FilterSelect label="Account registration" value={registration} onChange={setRegistration} options={["All uploads", "Registered customer", "Registration incomplete", "Account link needs review"]} />
          <button type="button" onClick={clearFilters} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 md:col-span-2 xl:col-span-1"><RotateCcw size={16} />Clear Filters</button>
        </div>

        <div tabIndex={0} role="region" aria-label="Document records, scroll horizontally for more columns" className="overflow-x-auto">
          <table className="w-full min-w-[940px] border-collapse">
            <caption className="sr-only">Verification uploads from customers and registration applicants</caption>
            <thead className="bg-slate-50"><tr>{["Applicant / customer", "Role", "Document Type", "File", "Submitted", "Status", "Actions"].map((heading) => <th key={heading} scope="col" className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {pagination.rows.map((document) => {
                const DocumentIcon = String(document.fileName || "").toLowerCase().endsWith(".pdf") ? FileText : FileImage;
                const pendingReview = document.processingStage === "pending_review" && document.approval === "Pending";
                return (
                  <tr key={document.id || document.fileName} className="transition-colors hover:bg-blue-50/30">
                    <td className="px-4 py-3.5"><p className="text-sm font-semibold text-slate-950">{document.customerName || (document.accountLink?.status === "registration_incomplete" ? "Registration applicant" : document.customer)}</p><p className="mt-1 break-all text-xs text-slate-600">{document.email || "Email not available"}</p><p className="mt-1 text-xs font-medium text-slate-700">{document.accountLink?.label || "Account link needs review"}</p></td>
                    <td className="px-4 py-3.5 text-sm text-slate-600">{document.role}</td>
                    <td className="px-4 py-3.5 text-sm text-slate-600">{document.document}</td>
                    <td className="max-w-[260px] px-4 py-3.5"><button type="button" title={document.fileName} onClick={() => onView(document)} className="flex max-w-full items-center gap-2 rounded-lg text-left text-sm font-semibold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><DocumentIcon size={16} /></span><span className="truncate">{document.fileName}</span></button></td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-sm tabular-nums text-slate-600"><time dateTime={document.submitted}>{document.submitted}</time></td>
                    <td className="px-4 py-3.5"><StatusBadge value={normalizedStatus(document.approval)} /></td>
                    <td className="px-4 py-3.5"><button type="button" onClick={() => pendingReview ? onReview(document) : onView(document)} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 ${pendingReview ? "bg-blue-600 text-white hover:bg-blue-700" : "border border-slate-300 text-slate-700 hover:bg-slate-50"}`}><Eye size={14} />{pendingReview ? "Review" : "View"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filtered.length ? <EmptyState icon={FileText} title="No verification documents found" description="Try changing your search or filters." /> : null}
        </div>
        <PaginationFooter pagination={pagination} noun="documents" />
      </section>
    </div>
  );
}

function normalizedStatus(status) {
  if (status === "Approved") return "Verified";
  if (status === "Pending") return "Pending Review";
  return status;
}
