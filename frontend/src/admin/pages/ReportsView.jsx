import {
  Activity, AlertTriangle, CheckCircle2, ChevronRight, CircleAlert, ExternalLink,
  FileText, Flag, Gavel, Inbox, LoaderCircle, MessageSquareMore, RefreshCw,
  ShieldAlert, UserRound, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminDataApi } from "../adminDataApi";
import { DashboardKpiCard as ReportKpiCard } from "./DashboardView";
import { EmptyState, FilterSelect, SearchField } from "../components/AdminUI";
import PasswordInput from "../components/PasswordInput";
import AdminModal from "../components/AdminModal";

const ACTIVE_STATUSES = new Set(["open", "investigating", "awaiting_information", "appealed"]);
const DURATION_ACTIONS = new Set(["booking_restriction", "listing_restriction", "chat_restriction", "temporary_suspension"]);
const STATUS_OPTIONS = [
  ["all", "All statuses"], ["active", "Needs review"], ["resolved", "Resolved"], ["open", "Open"], ["investigating", "Investigating"],
  ["awaiting_information", "Awaiting information"], ["appealed", "Appealed"],
  ["actioned", "Actioned"], ["dismissed", "Dismissed"], ["closed", "Closed"],
];
const PRIORITY_OPTIONS = [["all", "All priorities"], ["urgent", "Urgent"], ["high", "High"], ["normal", "Normal"], ["low", "Low"]];

export default function ReportsView({ initialStatus = "all", onFeedback }) {
  const [reports, setReports] = useState([]);
  const [summary, setSummary] = useState({});
  const [loadState, setLoadState] = useState("loading");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatus || "all");
  const [priority, setPriority] = useState("all");
  const [selectedReport, setSelectedReport] = useState(null);
  const [decisionReport, setDecisionReport] = useState(null);

  const loadReports = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true);
    else setLoadState("loading");
    setError("");
    try {
      const payload = await adminDataApi.getReports({ limit: 100 });
      setReports(payload.reports);
      setSummary(payload.summary || {});
      setLoadState("ready");
      if (background) onFeedback?.("Reports refreshed from RentifyPro.");
    } catch (requestError) {
      setError(requestError.message || "Reports could not be loaded.");
      if (!background) setLoadState("error");
      else onFeedback?.(requestError.message || "Reports could not be refreshed.", "error");
    } finally {
      setRefreshing(false);
    }
  }, [onFeedback]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadReports(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadReports]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reports.filter((report) => {
      const haystack = [report.caseReference, report.categoryLabel, report.description, report.reporter?.name,
        report.reporter?.email, report.reportedUser?.name, report.reportedUser?.email, report.vehicle?.name];
      const matchesStatus = status === "all"
        || (status === "active" && ACTIVE_STATUSES.has(report.status))
        || (status === "resolved" && !ACTIVE_STATUSES.has(report.status))
        || report.status === status;
      return matchesStatus
        && (priority === "all" || report.priority === priority)
        && (!query || haystack.some((value) => String(value || "").toLowerCase().includes(query)));
    });
  }, [priority, reports, search, status]);

  const updateLocalReport = (updated) => {
    setReports((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelectedReport((current) => current?.id === updated.id ? updated : current);
  };

  const handleTriage = async (report, changes) => {
    const payload = await adminDataApi.updateReport(report.id, changes);
    updateLocalReport(payload.report);
    onFeedback?.("Report review details updated.");
    return payload.report;
  };

  const handleDecision = async (report, decision) => {
    const payload = await adminDataApi.decideReport(report.id, decision);
    updateLocalReport(payload.report);
    setDecisionReport(null);
    setSummary((current) => ({
      ...current,
      [report.status]: Math.max(Number(current[report.status] || 0) - 1, 0),
      [payload.report.status]: Number(current[payload.report.status] || 0) + 1,
    }));
    onFeedback?.(payload.message || "Report decision recorded.");
  };

  const actionableCount = ["open", "investigating", "awaiting_information", "appealed"].reduce((total, key) => total + Number(summary[key] || 0), 0);
  const resolvedCount = ["actioned", "dismissed", "closed"].reduce((total, key) => total + Number(summary[key] || 0), 0);
  const totalReports = Object.values(summary).reduce((total, value) => total + Number(value || 0), 0);
  const awaitingCount = Number(summary.awaiting_information || 0);
  const resolutionRate = percentage(resolvedCount, totalReports);
  const queueShare = percentage(actionableCount, totalReports);
  if (loadState === "loading") return <ReportsLoadingState />;
  if (loadState === "error") return <ReportsErrorState message={error} onRetry={() => void loadReports()} />;

  return (
    <div className="space-y-5">
      <ReportReviewDialog key={selectedReport?.id || "no-report"} report={selectedReport} onClose={() => setSelectedReport(null)} onTriage={handleTriage} onDecide={setDecisionReport} onFeedback={onFeedback} />
      <DecisionDialog key={decisionReport?.id || "no-decision"} report={decisionReport} onClose={() => setDecisionReport(null)} onSubmit={handleDecision} />

      <section aria-label="Report queue statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportKpiCard label="Needs review" value={actionableCount} helper={`${resolvedCount} of ${totalReports} reports are already resolved`} status={actionableCount ? "Action required" : "Queue cleared"} progress={queueShare} progressLabel="Share of all reports" actionLabel="View active queue" onAction={() => setStatus("active")} icon={ShieldAlert} tone={actionableCount ? "red" : "green"} />
        <ReportKpiCard label="Open reports" value={Number(summary.open || 0)} helper="New reports waiting for an administrator to begin review" status={summary.open ? "Unassigned work" : "All reviewed"} progress={percentage(Number(summary.open || 0), actionableCount)} progressLabel="Share of active queue" actionLabel="Show open reports" onAction={() => setStatus("open")} icon={Inbox} tone={summary.open ? "amber" : "blue"} />
        <ReportKpiCard label="Awaiting response" value={awaitingCount} helper="Reporters have been asked to provide more evidence or context" status={awaitingCount ? "Follow-up pending" : "No follow-ups"} progress={percentage(awaitingCount, actionableCount)} progressLabel="Share of active queue" actionLabel="View follow-ups" onAction={() => setStatus("awaiting_information")} icon={MessageSquareMore} tone="blue" />
        <ReportKpiCard label="Resolution rate" value={`${resolutionRate}%`} helper={`${resolvedCount} completed decisions across ${totalReports} submitted cases`} status={resolutionRate >= 75 ? "Healthy progress" : "Review workload"} progress={resolutionRate} progressLabel="Cases resolved" actionLabel="View resolved reports" onAction={() => setStatus("resolved")} icon={CheckCircle2} tone={resolutionRate >= 75 ? "green" : "amber"} />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_6px_20px_rgba(33,33,33,0.035)]">
        <div className="flex flex-col gap-4 border-b border-slate-100 bg-white p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div><div className="flex items-center gap-2 text-blue-600"><Activity size={16} /><p className="text-[10px] font-semibold uppercase tracking-[0.16em]">Moderation workspace</p></div><h2 className="mt-2 text-lg font-bold tracking-[-0.025em] text-slate-950">User report queue</h2><p className="mt-1 text-xs leading-5 text-slate-500">Search, prioritize, and review every report from one operational workspace.</p></div>
            <button type="button" onClick={() => void loadReports({ background: true })} disabled={refreshing} className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:opacity-60"><RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />Refresh data</button>
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(260px,1fr)_190px_180px_auto] xl:items-end">
          <SearchField label="Search Reports" value={search} onChange={setSearch} placeholder="Case, category, reporter, or reported user..." />
          <ReportSelect label="Case status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          <ReportSelect label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
          <button type="button" onClick={() => { setSearch(""); setStatus("all"); setPriority("all"); }} className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-4 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">Clear filters</button>
          </div>
        </div>

        <div className="grid gap-3 p-4 lg:hidden">
          {filtered.map((report) => <MobileReportCard key={report.id} report={report} onReview={() => setSelectedReport(report)} />)}
          {!filtered.length ? <EmptyState icon={Flag} title="No reports found" description="No report matches the current search and filters." /> : null}
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1050px] border-collapse">
            <caption className="sr-only">RentifyPro user reports and moderation status</caption>
            <thead className="bg-[#f8fafc]"><tr>{["Case", "Reported by", "Reported user", "Reason", "Submitted", "Priority", "Status", "Actions"].map((heading) => <th key={heading} scope="col" className="border-b border-slate-200 px-5 py-3.5 text-left text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{filtered.map((report) => (
              <tr key={report.id} className="group transition-colors hover:bg-blue-50/40">
                <td className="px-5 py-4"><div className="flex items-center gap-3"><span className={`h-9 w-1 shrink-0 rounded-full ${priorityBar(report.priority)}`} /><div><p className="whitespace-nowrap text-sm font-bold text-blue-700">{report.caseReference}</p><p className="mt-0.5 text-[11px] text-slate-500">{sourceLabel(report.sourceType)}</p></div></div></td>
                <td className="px-5 py-4"><PersonCell person={report.reporter} fallbackRole={report.reporterRole} /></td>
                <td className="px-5 py-4"><PersonCell person={report.reportedUser} fallbackRole={report.reportedRole} /></td>
                <td className="max-w-[220px] px-5 py-4"><p className="truncate text-sm font-semibold text-slate-800" title={report.categoryLabel}>{report.categoryLabel}</p>{report.vehicle?.name ? <p className="mt-0.5 truncate text-[11px] text-slate-500">{report.vehicle.name}</p> : null}</td>
                <td className="whitespace-nowrap px-5 py-4 text-xs font-medium text-slate-500"><time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time></td>
                <td className="px-5 py-4"><PriorityBadge value={report.priority} /></td>
                <td className="px-5 py-4"><ReportStatusBadge value={report.status} /></td>
                <td className="px-5 py-4"><button type="button" onClick={() => setSelectedReport(report)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition group-hover:border-blue-200 group-hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><Gavel size={14} />Review<ChevronRight size={14} /></button></td>
              </tr>
            ))}</tbody>
          </table>
          {!filtered.length ? <EmptyState icon={Flag} title="No reports found" description="No report matches the current search and filters." /> : null}
        </div>
        <div className="flex flex-col gap-1 border-t border-slate-100 bg-slate-50/70 px-5 py-3 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>Showing <strong className="text-slate-700">{filtered.length}</strong> of {reports.length} reports</span><span>{actionableCount} cases currently require attention</span></div>
      </section>
    </div>
  );
}

function MobileReportCard({ report, onReview }) {
  return (
    <button type="button" onClick={onReview} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-[0_8px_24px_rgba(15,23,42,0.045)] transition hover:border-blue-200 hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${priorityBar(report.priority)}`} />
      <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-blue-700">{report.caseReference}</p><p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{sourceLabel(report.sourceType)}</p></div><ChevronRight size={18} className="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600" /></div>
      <h3 className="mt-4 text-base font-bold text-slate-950">{report.categoryLabel}</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3"><PersonCell person={report.reporter} fallbackRole={report.reporterRole} /><PersonCell person={report.reportedUser} fallbackRole={report.reportedRole} /></div>
      <div className="mt-4 flex flex-wrap items-center gap-2"><PriorityBadge value={report.priority} /><ReportStatusBadge value={report.status} /><span className="ml-auto text-[11px] font-medium text-slate-500">{formatDate(report.createdAt)}</span></div>
    </button>
  );
}

function ReportReviewDialog({ report, onClose, onTriage, onDecide, onFeedback }) {
  const [busy, setBusy] = useState(false);
  const [requestingInfo, setRequestingInfo] = useState(false);
  const [informationNote, setInformationNote] = useState("");
  if (!report) return null;
  const active = ACTIVE_STATUSES.has(report.status);
  const triage = async (changes) => {
    setBusy(true);
    try {
      await onTriage(report, changes);
      setRequestingInfo(false);
      setInformationNote("");
    } catch (requestError) {
      onFeedback?.(requestError.message || "The report could not be updated.", "error");
    } finally { setBusy(false); }
  };

  return (
    <AdminModal onClose={onClose} busy={busy}>
      <div role="dialog" aria-modal="true" aria-labelledby="report-review-title" aria-busy={busy} className="flex w-full max-w-6xl flex-col overflow-hidden bg-white">
        <header className="admin-modal-header">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="admin-section-label text-blue-700">Trust &amp; safety review</p><PriorityBadge value={report.priority} /><ReportStatusBadge value={report.status} /></div><h2 id="report-review-title" className="mt-2 text-xl font-bold tracking-tight text-slate-950">{report.caseReference}</h2><p className="mt-1 text-sm text-slate-500">Submitted {formatDateTime(report.createdAt)} from {sourceLabel(report.sourceType).toLowerCase()}</p></div>
          <button type="button" data-dialog-initial onClick={onClose} disabled={busy} aria-label="Close report review" className="admin-icon-button text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={20} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f5f7fb] p-5 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.8fr)]">
            <div className="space-y-5">
              <section className="grid gap-3 sm:grid-cols-2"><PersonPanel label="Reported by" person={report.reporter} role={report.reporterRole} /><PersonPanel label="Reported account" person={report.reportedUser} role={report.reportedRole} danger /></section>
              <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.045)]"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Reported issue</p><h3 className="mt-2 text-lg font-bold text-slate-950">{report.categoryLabel}</h3><p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">{report.description || "No description was provided."}</p></section>
              {report.appeal ? <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5"><div className="flex gap-3"><MessageSquareMore size={20} className="mt-0.5 shrink-0 text-violet-600" /><div><p className="text-sm font-bold text-violet-950">Decision appealed</p><p className="mt-1 text-xs text-violet-700">Submitted {formatDateTime(report.appeal.submittedAt)}</p><p className="mt-3 whitespace-pre-line text-sm leading-6 text-violet-900">{report.appeal.statement}</p></div></div></section> : null}
              {report.informationResponses?.length ? <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.045)]"><h3 className="text-sm font-bold text-slate-950">Additional information</h3><div className="mt-3 space-y-3">{report.informationResponses.map((item, index) => <div key={item.id || index} className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-100"><p className="whitespace-pre-line text-sm leading-6 text-slate-700">{item.statement}</p><p className="mt-1 text-xs text-slate-500">Received {formatDateTime(item.submittedAt)}</p></div>)}</div></section> : null}
              <EvidenceSection evidence={report.evidence} />
            </div>
            <aside className="space-y-5">
              <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.045)]"><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><FileText size={15} /></span><h3 className="text-sm font-bold text-slate-950">Related record</h3></div><dl className="mt-4 space-y-3"><DetailRow label="Source" value={sourceLabel(report.sourceType)} />{report.booking ? <DetailRow label="Booking" value={`#${report.booking.reference} · ${titleCase(report.booking.status)}`} /> : null}{report.vehicle ? <DetailRow label="Vehicle" value={[report.vehicle.name, report.vehicle.plateNumber, report.vehicle.location].filter(Boolean).join(" · ")} /> : null}<DetailRow label="Submitted" value={formatDateTime(report.createdAt)} />{report.resolvedAt ? <DetailRow label="Resolved" value={formatDateTime(report.resolvedAt)} /> : null}</dl></section>
              {report.currentDecision ? <DecisionSummary decision={report.currentDecision} /> : null}
              <ActivitySection activity={report.activity} />
            </aside>
          </div>
        </div>
        {active ? <footer className="max-h-[50dvh] shrink-0 overflow-y-auto border-t border-slate-200 bg-slate-50 p-4 sm:px-5">
          {requestingInfo ? <div className="mb-4 rounded-xl border border-amber-200 bg-white p-4"><label className="block"><span className="text-sm font-semibold text-slate-800">What information should the reporter provide?</span><textarea autoFocus rows={3} maxLength={1000} value={informationNote} onChange={(event) => setInformationNote(event.target.value)} disabled={busy} className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" placeholder="Describe the missing evidence or details (at least 10 characters)" /></label><div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setRequestingInfo(false)} disabled={busy} className="h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700">Cancel</button><button type="button" onClick={() => void triage({ status: "awaiting_information", note: informationNote.trim() })} disabled={busy || informationNote.trim().length < 10} className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle size={16} className="animate-spin" /> : null}Send request</button></div></div> : null}
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between"><div className="flex flex-wrap items-end gap-3"><ReportSelect label="Priority" value={report.priority} onChange={(value) => void triage({ priority: value })} options={PRIORITY_OPTIONS.slice(1)} disabled={busy} compact />{report.status === "open" ? <button type="button" onClick={() => void triage({ status: "investigating" })} disabled={busy} className="h-10 rounded-xl border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">Start investigation</button> : null}{!requestingInfo ? <button type="button" onClick={() => setRequestingInfo(true)} disabled={busy} className="h-10 rounded-xl border border-amber-200 bg-white px-4 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50">Request information</button> : null}</div><button type="button" onClick={() => onDecide(report)} disabled={busy} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"><Gavel size={17} />{report.status === "appealed" ? "Decide appeal" : "Make decision"}</button></div>
        </footer> : null}
      </div>
    </AdminModal>
  );
}

function EvidenceSection({ evidence = [] }) {
  return <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.045)]"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><FileText size={15} /></span><h3 className="text-sm font-bold text-slate-950">Evidence</h3></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">{evidence.length} file(s)</span></div>{evidence.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{evidence.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="group flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50/50 hover:shadow-sm"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-700"><FileText size={18} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800">{item.originalName}</span><span className="mt-0.5 block text-xs text-slate-500">{formatFileSize(item.size)}</span></span><ExternalLink size={15} className="text-slate-400 group-hover:text-blue-600" /></a>)}</div> : <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">The reporter did not attach evidence.</p>}</section>;
}

function ActivitySection({ activity = [] }) {
  return <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.045)]"><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600"><Activity size={15} /></span><h3 className="text-sm font-bold text-slate-950">Case activity</h3></div>{activity.length ? <ol className="mt-4 space-y-4 border-l border-slate-200 pl-4">{activity.slice(0, 10).map((item, index) => <li key={`${item.action}-${item.at}-${index}`} className="relative text-sm before:absolute before:-left-[21px] before:top-1.5 before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-white before:bg-blue-500 before:shadow"><p className="font-semibold text-slate-800">{titleCase(item.action)}</p><p className="mt-0.5 text-xs text-slate-500">{formatDateTime(item.at)}</p>{item.note ? <p className="mt-1 rounded-lg bg-slate-50 px-2.5 py-2 text-xs leading-5 text-slate-600">{item.note}</p> : null}</li>)}</ol> : <p className="mt-3 text-sm text-slate-500">No case activity has been recorded.</p>}</section>;
}

function DecisionDialog({ report, onClose, onSubmit }) {
  const [outcome, setOutcome] = useState("violation_confirmed");
  const [action, setAction] = useState("warning");
  const [durationDays, setDurationDays] = useState("7");
  const [policyReason, setPolicyReason] = useState("");
  const [userVisibleReason, setUserVisibleReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!report) return null;
  const actions = moderationActionsFor(report);
  const durationRequired = outcome === "violation_confirmed" && DURATION_ACTIONS.has(action);
  const valid = policyReason.trim().length >= 10 && userVisibleReason.trim().length >= 10 && adminPassword.length > 0 && (!durationRequired || (Number(durationDays) >= 1 && Number(durationDays) <= 365));
  const submit = async (event) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError("");
    try {
      await onSubmit(report, { outcome, action: outcome === "dismissed" ? "none" : action, durationDays: durationRequired ? Number(durationDays) : null, policyReason: policyReason.trim(), userVisibleReason: userVisibleReason.trim(), internalNote: internalNote.trim(), adminPassword });
    } catch (requestError) { setError(requestError.message || "The decision could not be recorded."); setBusy(false); }
  };

  return (
    <AdminModal onClose={onClose} busy={busy}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="decision-title" aria-busy={busy} className="flex w-full max-w-2xl flex-col overflow-hidden bg-white">
        <header className="admin-modal-header"><div className="min-w-0"><p className="admin-section-label text-blue-700">Final moderation decision</p><h2 id="decision-title" className="mt-1.5 text-xl font-bold tracking-tight text-slate-950">{report.caseReference}</h2><p className="mt-1 text-sm text-slate-500">This decision is audited and affected users are notified.</p></div><button type="button" data-dialog-initial onClick={onClose} disabled={busy} aria-label="Close decision form" className="admin-icon-button text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={19} /></button></header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-[#f8fafc] p-5 sm:p-6">
          <fieldset disabled={busy}><legend className="text-sm font-semibold text-slate-800">Outcome</legend><div className="mt-2 grid gap-3 sm:grid-cols-2"><DecisionChoice checked={outcome === "violation_confirmed"} onChange={() => setOutcome("violation_confirmed")} icon={ShieldAlert} title="Violation confirmed" description="Apply a proportionate moderation action." /><DecisionChoice checked={outcome === "dismissed"} onChange={() => setOutcome("dismissed")} icon={CheckCircle2} title="Dismiss report" description="Close without sanctioning the reported user." /></div></fieldset>
          {outcome === "violation_confirmed" ? <div className="grid gap-4 sm:grid-cols-2"><FieldSelect label="Moderation action" value={action} onChange={setAction} options={actions} disabled={busy} />{durationRequired ? <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-800">Duration in days</span><input type="number" min="1" max="365" value={durationDays} onChange={(event) => setDurationDays(event.target.value)} disabled={busy} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /></label> : null}</div> : <div className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600"><CircleAlert size={19} className="mt-0.5 shrink-0" />No sanction will be applied. On appeal, sanctions from the earlier decision will be revoked.</div>}
          <DecisionTextArea label="Policy reason" hint="Visible only to administrators" value={policyReason} onChange={setPolicyReason} maxLength={1000} placeholder="Explain how the evidence supports this decision (at least 10 characters)" busy={busy} />
          <DecisionTextArea label="Message to affected users" hint="Included in the moderation record" value={userVisibleReason} onChange={setUserVisibleReason} maxLength={1000} placeholder="Give a clear, respectful explanation of the outcome" busy={busy} />
          <DecisionTextArea label="Internal note (optional)" value={internalNote} onChange={setInternalNote} maxLength={2000} placeholder="Add context for future administrators" busy={busy} optional />
          <PasswordInput label="Confirm Super Admin password" autoComplete="current-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} disabled={busy} required placeholder="Required to issue the decision" className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" />
          {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p> : null}
        </div>
        <footer className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 p-4 sm:flex-row sm:justify-end sm:px-5"><button type="button" onClick={onClose} disabled={busy} className="admin-button disabled:opacity-50">Cancel</button><button type="submit" disabled={!valid || busy} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${outcome === "dismissed" ? "bg-slate-700 hover:bg-slate-800" : "bg-blue-600 hover:bg-blue-700"}`}>{busy ? <LoaderCircle size={17} className="animate-spin" /> : <Gavel size={17} />}{busy ? "Recording decision..." : outcome === "dismissed" ? "Dismiss report" : "Confirm action"}</button></footer>
      </form>
    </AdminModal>
  );
}

function moderationActionsFor(report) {
  const actions = [["warning", "Issue a formal warning"], ["chat_restriction", "Restrict chat access"], ["temporary_suspension", "Temporarily suspend account"], ["permanent_ban", "Permanently ban account"], ["kyc_reverification", "Require identity reverification"]];
  if (report.reportedRole === "user") actions.splice(1, 0, ["booking_restriction", "Restrict new bookings"]);
  if (report.reportedRole === "owner") actions.splice(1, 0, ["listing_restriction", "Restrict new listings"]);
  if (report.reportedRole === "owner" && report.vehicle) actions.push(["vehicle_delisting", "Delist the reported vehicle"]);
  return actions;
}

function DecisionChoice({ checked, onChange, icon: Icon, title, description }) {
  return <label className={`flex cursor-pointer gap-3 rounded-xl border bg-white p-4 transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-700 ${checked ? "border-blue-600 bg-blue-50" : "border-slate-300 hover:border-slate-400"}`}><input type="radio" name="moderation-outcome" checked={checked} onChange={onChange} className="sr-only" /><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${checked ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}><Icon size={18} /></span><span><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></span></label>;
}

function DecisionTextArea({ label, hint, value, onChange, maxLength, placeholder, busy, optional = false }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-800">{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value.slice(0, maxLength))} disabled={busy} required={!optional} rows={optional ? 2 : 3} placeholder={placeholder} className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /><span className="mt-1 block text-xs text-slate-500">{hint ? `${hint} · ` : ""}{value.trim().length}/{maxLength}</span></label>;
}

function FieldSelect({ label, value, onChange, options, disabled }) {
  return <FilterSelect label={label} value={value} onChange={onChange} disabled={disabled} options={options.map(([value, label]) => ({ value, label }))} />;
}

function DecisionSummary({ decision }) {
  return <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex items-center gap-2"><CheckCircle2 size={18} className="text-emerald-600" /><h3 className="text-sm font-bold text-emerald-950">Decision recorded</h3></div><dl className="mt-4 space-y-3"><DetailRow label="Outcome" value={titleCase(decision.outcome)} /><DetailRow label="Action" value={titleCase(decision.action)} />{decision.durationDays ? <DetailRow label="Duration" value={`${decision.durationDays} days`} /> : null}<DetailRow label="Decision date" value={formatDateTime(decision.createdAt)} /></dl><p className="mt-4 text-sm leading-6 text-emerald-900">{decision.userVisibleReason}</p></section>;
}

function PersonPanel({ label, person, role, danger = false }) {
  return <div className={`rounded-2xl border bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] ${danger ? "border-rose-200" : "border-slate-200/80"}`}><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">{label}</p>{danger ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-semibold uppercase text-rose-600">Subject</span> : null}</div><div className="mt-3 flex items-center gap-3"><span className={`flex h-11 w-11 items-center justify-center rounded-xl ${danger ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}><UserRound size={19} /></span><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-950">{person?.name || "Deleted account"}</p><p className="truncate text-xs text-slate-500">{person?.email || titleCase(role)}</p></div></div>{person?.isDisabled ? <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-2 text-xs font-semibold text-rose-700"><AlertTriangle size={14} />Account currently disabled</p> : null}</div>;
}

function PersonCell({ person, fallbackRole }) { return <div className="min-w-0"><p className="max-w-[170px] truncate text-sm font-semibold text-slate-900">{person?.name || "Deleted account"}</p><p className="mt-0.5 max-w-[170px] truncate text-xs text-slate-500">{person?.email || titleCase(fallbackRole)}</p></div>; }
function DetailRow({ label, value }) { return <div><dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{label}</dt><dd className="mt-1 text-sm font-medium leading-5 text-slate-800">{value || "—"}</dd></div>; }
function ReportSelect({ label, value, onChange, options, disabled = false, compact = false }) { return <FilterSelect label={label} value={value} onChange={onChange} disabled={disabled} className={compact ? "w-44 max-w-full" : ""} options={options.map(([value, label]) => ({ value, label }))} />; }

function ReportStatusBadge({ value }) {
  const tones = { open: "bg-amber-50 text-amber-700", investigating: "bg-blue-50 text-blue-700", awaiting_information: "bg-orange-50 text-orange-700", appealed: "bg-violet-50 text-violet-700", actioned: "bg-emerald-50 text-emerald-700", dismissed: "bg-slate-100 text-slate-700", closed: "bg-slate-100 text-slate-600" };
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ring-current/10 ${tones[value] || tones.closed}`}>{titleCase(value)}</span>;
}
function PriorityBadge({ value }) {
  const tones = { urgent: "bg-rose-100 text-rose-700", high: "bg-orange-100 text-orange-700", normal: "bg-blue-50 text-blue-700", low: "bg-slate-100 text-slate-600" };
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${tones[value] || tones.normal}`}>{titleCase(value)}</span>;
}
function ReportsLoadingState() { return <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-slate-200 bg-white"><div className="text-center"><LoaderCircle size={34} className="mx-auto animate-spin text-blue-600" /><p className="mt-4 font-semibold text-slate-900">Loading user reports</p><p className="mt-1 text-sm text-slate-500">Reading moderation cases and evidence from RentifyPro.</p></div></div>; }
function ReportsErrorState({ message, onRetry }) { return <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-rose-200 bg-white p-6"><div className="max-w-md text-center"><CircleAlert size={32} className="mx-auto text-rose-500" /><h2 className="mt-4 text-lg font-bold text-slate-950">Could not load reports</h2><p className="mt-2 text-sm leading-6 text-slate-600">{message}</p><button type="button" onClick={onRetry} className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white"><RefreshCw size={16} />Try again</button></div></div>; }
function sourceLabel(value) { return value === "chat_message" ? "Reported chat message" : "Booking report"; }
function titleCase(value) { return String(value || "Unknown").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function percentage(value, total) { if (!total) return 0; return Math.max(0, Math.min(100, Math.round((Number(value) / Number(total)) * 100))); }
function priorityBar(value) { return value === "urgent" ? "bg-rose-500" : value === "high" ? "bg-orange-500" : value === "low" ? "bg-slate-400" : "bg-blue-500"; }
function formatDate(value) { const date = value ? new Date(value) : null; return !date || Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(date); }
function formatDateTime(value) { const date = value ? new Date(value) : null; return !date || Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date); }
function formatFileSize(value) { const bytes = Number(value || 0); if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
