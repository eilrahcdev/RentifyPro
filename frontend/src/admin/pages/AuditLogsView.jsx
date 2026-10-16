import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, ChevronLeft, ChevronRight, Clock3, LoaderCircle, RefreshCw, ScrollText, ShieldAlert, XCircle } from "lucide-react";
import { adminDataApi } from "../adminDataApi";
import { EmptyState, FilterSelect, SearchField, StatCard, StatusBadge } from "../components/AdminUI";

const PAGE_SIZE = 30;

export default function AuditLogsView({ initialOutcome = "all" }) {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const [outcome, setOutcome] = useState(initialOutcome);
  const [offset, setOffset] = useState(0);
  const [payload, setPayload] = useState({ logs: [], actions: [], summary: { total: 0, success: 0, failure: 0, recent24Hours: 0 }, page: { total: 0, hasMore: false } });
  const [state, setState] = useState("loading");
  const [error, setError] = useState("");

  const loadLogs = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const result = await adminDataApi.getAuditLogs({ search, action, outcome, offset, limit: PAGE_SIZE });
      setPayload(result);
      setState("ready");
    } catch (requestError) {
      setError(requestError.message || "Audit activity could not be loaded.");
      setState("error");
    }
  }, [action, offset, outcome, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLogs(), 250);
    return () => window.clearTimeout(timer);
  }, [loadLogs]);

  const updateFilter = (setter) => (value) => { setter(value); setOffset(0); };
  const logs = Array.isArray(payload.logs) ? payload.logs : [];
  const actions = ["all", ...(payload.actions || []).filter(Boolean)];

  return (
    <div className="space-y-5">
      <section aria-label="Audit activity statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Matching Events" value={Number(payload.summary?.total || 0)} description="For the selected action and search" icon={Activity} />
        <StatCard label="Successful Actions" value={Number(payload.summary?.success || 0)} description="Completed administrative events" icon={CheckCircle2} tone="green" />
        <StatCard label="Failed Checks" value={Number(payload.summary?.failure || 0)} description="Authentication or action failures" icon={XCircle} tone={payload.summary?.failure ? "red" : "slate"} />
        <StatCard label="Last 24 Hours" value={Number(payload.summary?.recent24Hours || 0)} description="Recent security and admin activity" icon={Clock3} tone="slate" />
      </section>
      <section className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm leading-6 text-blue-900">
        <div className="flex gap-3"><ShieldAlert className="mt-0.5 shrink-0 text-blue-600" size={20} /><p>This immutable-style activity history records security events and Super Admin decisions. Passwords, MFA codes, and session tokens are never stored in log metadata.</p></div>
      </section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_6px_20px_rgba(33,33,33,0.035)]">
        <div className="grid gap-4 border-b border-slate-200 p-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,.8fr)_auto] xl:items-end">
          <SearchField label="Search activity" value={search} onChange={updateFilter(setSearch)} placeholder="Search summary, target, reason, or admin..." />
          <FilterSelect label="Action" value={action} onChange={updateFilter(setAction)} options={actions} />
          <FilterSelect label="Outcome" value={outcome} onChange={updateFilter(setOutcome)} options={["all", "success", "failure"]} />
          <button type="button" onClick={() => void loadLogs()} disabled={state === "loading"} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><RefreshCw size={16} className={state === "loading" ? "animate-spin" : ""} />Refresh</button>
        </div>
        {state === "error" ? <div className="p-8 text-center"><p className="text-sm font-semibold text-rose-700">{error}</p><button type="button" onClick={() => void loadLogs()} className="mt-3 text-sm font-semibold text-blue-700">Try again</button></div> : null}
        {state === "loading" && !logs.length ? <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500"><LoaderCircle size={19} className="animate-spin" />Loading audit activity...</div> : null}
        {logs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1050px] border-collapse"><caption className="sr-only">Super Admin audit history</caption><thead className="bg-slate-50"><tr>{["Time", "Action", "Outcome", "Target", "Summary", "Reason", "IP address"].map((heading) => <th key={heading} className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{logs.map((log) => <tr key={log.id} className="align-top hover:bg-blue-50/30"><td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{formatTimestamp(log.createdAt)}</td><td className="whitespace-nowrap px-4 py-3 font-sans tabular-nums text-xs font-semibold text-slate-800">{log.action}</td><td className="px-4 py-3"><StatusBadge value={log.outcome === "success" ? "Verified" : "Rejected"} /></td><td className="px-4 py-3 text-xs text-slate-700">{log.targetLabel || "—"}</td><td className="max-w-sm px-4 py-3 text-xs leading-5 text-slate-700">{log.summary}</td><td className="max-w-xs px-4 py-3 text-xs leading-5 text-slate-600">{log.reason || "—"}</td><td className="whitespace-nowrap px-4 py-3 font-sans tabular-nums text-xs text-slate-500">{log.ip || "—"}</td></tr>)}</tbody></table></div> : null}
        {state === "ready" && !logs.length ? <EmptyState icon={ScrollText} title="No audit activity found" description="Security events and management actions will appear here." /> : null}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-xs text-slate-600"><span>Showing {logs.length ? offset + 1 : 0}–{offset + logs.length} of {payload.page?.total || 0}</span><div className="flex gap-2"><button type="button" aria-label="Previous audit page" disabled={offset === 0 || state === "loading"} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))} className="rounded-lg border border-slate-300 bg-white p-2 disabled:opacity-40"><ChevronLeft size={16} /></button><button type="button" aria-label="Next audit page" disabled={!payload.page?.hasMore || state === "loading"} onClick={() => setOffset((current) => current + PAGE_SIZE)} className="rounded-lg border border-slate-300 bg-white p-2 disabled:opacity-40"><ChevronRight size={16} /></button></div></div>
      </section>
    </div>
  );
}

function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}
