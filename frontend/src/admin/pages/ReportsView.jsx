import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSearch, LoaderCircle, RefreshCw, ShieldAlert, TriangleAlert, X } from "lucide-react";
import { adminDataApi } from "../adminDataApi";
import AutoResizeTextarea from "../../components/AutoResizeTextarea";

const titleCase = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const actions = [
  ["warning", "Formal warning"],
  ["booking_restriction", "Restrict new bookings"],
  ["listing_restriction", "Restrict vehicle listings"],
  ["chat_restriction", "Restrict sending chat messages"],
  ["temporary_suspension", "Temporarily suspend account"],
  ["permanent_ban", "Permanently disable account"],
  ["kyc_reverification", "Require KYC reverification"],
  ["vehicle_delisting", "Delist related vehicle"],
];
const durationActions = new Set(["booking_restriction", "listing_restriction", "chat_restriction", "temporary_suspension"]);

export default function ReportsView() {
  const [reports, setReports] = useState([]);
  const [summary, setSummary] = useState({});
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [decision, setDecision] = useState({ outcome: "", action: "", durationDays: "7", policyReason: "", userVisibleReason: "", internalNote: "", confirmed: false });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await adminDataApi.getReports({ status, priority, limit: 100 });
      setReports(Array.isArray(response.reports) ? response.reports : []);
      setSummary(response.summary || {});
    } catch (requestError) {
      setError(requestError.message || "Reports could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [priority, status]);

  useEffect(() => { void load(); }, [load]);
  const openCases = useMemo(() => Number(summary.open || 0) + Number(summary.investigating || 0) + Number(summary.awaiting_information || 0) + Number(summary.appealed || 0), [summary]);

  const updateCase = async (body) => {
    if (!selected || saving) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await adminDataApi.updateReport(selected._id, body);
      setSelected(response.report);
      setReports((items) => items.map((item) => item._id === response.report._id ? response.report : item));
      setNotice("Case updated.");
    } catch (requestError) {
      setNotice(requestError.message || "The case could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  const submitDecision = async (event) => {
    event.preventDefault();
    if (!selected || saving) return;
    if (!decision.confirmed) return setNotice("Confirm that you reviewed the case evidence and context.");
    const body = {
      outcome: decision.outcome,
      action: decision.outcome === "dismissed" ? "none" : decision.action,
      policyReason: decision.policyReason,
      userVisibleReason: decision.userVisibleReason,
      internalNote: decision.internalNote,
      ...(durationActions.has(decision.action) ? { durationDays: Number(decision.durationDays) } : {}),
    };
    setSaving(true);
    setNotice("");
    try {
      const response = await adminDataApi.decideReport(selected._id, body);
      setSelected(response.report);
      setReports((items) => items.map((item) => item._id === response.report._id ? response.report : item));
      setDecision({ outcome: "", action: "", durationDays: "7", policyReason: "", userVisibleReason: "", internalNote: "", confirmed: false });
      setNotice("The moderation decision was applied and recorded.");
    } catch (requestError) {
      setNotice(requestError.message || "The decision could not be applied.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3"><SummaryCard label="Needs review" value={openCases} tone="blue" /><SummaryCard label="Actioned" value={summary.actioned || 0} tone="rose" /><SummaryCard label="Dismissed" value={summary.dismissed || 0} tone="slate" /></div>
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end">
        <Filter label="Status" value={status} onChange={setStatus} options={["all", "open", "investigating", "awaiting_information", "appealed", "actioned", "dismissed", "closed"]} />
        <Filter label="Priority" value={priority} onChange={setPriority} options={["all", "urgent", "high", "normal", "low"]} />
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-blue-600 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"><RefreshCw size={18} strokeWidth={2} className={loading ? "animate-spin" : ""} aria-hidden="true" />Refresh</button>
      </div>
      {error ? <p className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><TriangleAlert size={18} strokeWidth={2} aria-hidden="true" />{error}</p> : null}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? <div className="flex min-h-72 items-center justify-center"><LoaderCircle size={32} strokeWidth={2} className="animate-spin text-blue-600" aria-hidden="true" /></div> : null}
        {!loading && !error && !reports.length ? <div className="px-6 py-16 text-center"><FileSearch size={32} strokeWidth={2} className="mx-auto text-slate-300" aria-hidden="true" /><h2 className="mt-3 font-bold text-slate-900">No matching reports</h2><p className="mt-1 text-sm text-slate-500">Try another status or priority filter.</p></div> : null}
        {!loading && reports.length ? <div className="divide-y divide-slate-200">{reports.map((report) => <button key={report._id} type="button" onClick={() => { setSelected(report); setNotice(""); }} className="grid w-full gap-3 p-4 text-left hover:bg-slate-50 sm:grid-cols-[1fr_180px_120px] sm:items-center"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-blue-600">{report.caseReference}</p><p className="mt-1 truncate font-semibold text-slate-950">{titleCase(report.category)}</p><p className="mt-1 truncate text-xs text-slate-500">{report.reporter?.name} reported {report.reportedUser?.name} · Booking #{String(report.booking?._id || report.booking || "").slice(-6).toUpperCase()}</p></div><span className="text-sm font-medium text-slate-600">{new Date(report.createdAt).toLocaleString()}</span><div className="flex gap-2 sm:justify-end"><Badge value={report.priority} /><Badge value={report.status} /></div></button>)}</div> : null}
      </div>
      {selected ? <CaseDialog key={selected._id} report={selected} decision={decision} setDecision={setDecision} notice={notice} saving={saving} onClose={() => setSelected(null)} onUpdate={updateCase} onSubmitDecision={submitDecision} /> : null}
    </div>
  );
}

function CaseDialog({ report, decision, setDecision, notice, saving, onClose, onUpdate, onSubmitDecision }) {
  const [informationNote, setInformationNote] = useState("");
  const actionable = ["open", "investigating", "awaiting_information", "appealed"].includes(report.status);
  return <div className="fixed inset-0 z-[90] overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm"><div className="mx-auto my-4 max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl"><header className="flex items-start justify-between border-b border-slate-200 p-5 sm:p-6"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">Moderation case {report.caseReference}</p><h2 className="mt-1 text-2xl font-bold text-slate-950">{titleCase(report.category)}</h2><div className="mt-2 flex flex-wrap gap-2"><Badge value={report.status} /><Badge value={report.priority} /></div></div><button type="button" onClick={onClose} aria-label="Close report details" className="rp-icon-button"><X size={20} /></button></header><div className="grid gap-6 p-5 lg:grid-cols-[1fr_380px] lg:p-6"><div className="space-y-5"><InfoBlock title="Participants"><p><strong>{report.reporter?.name}</strong> ({titleCase(report.reporterRole)}) reported <strong>{report.reportedUser?.name}</strong> ({titleCase(report.reportedRole)}).</p><p className="mt-1 text-xs text-slate-500">Booking #{String(report.booking?._id || report.booking || "").slice(-6).toUpperCase()} · Submitted {new Date(report.createdAt).toLocaleString()}</p></InfoBlock><InfoBlock title="Incident description"><p className="whitespace-pre-wrap">{report.description}</p></InfoBlock><InfoBlock title={`Evidence (${report.evidence?.length || 0})`}>{report.evidence?.length ? <div className="flex flex-wrap gap-2">{report.evidence.map((file) => <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">{file.originalName}</a>)}</div> : <p>No files were submitted.</p>}</InfoBlock>{report.appeal ? <InfoBlock title="Appeal statement"><p className="whitespace-pre-wrap text-amber-900">{report.appeal.statement}</p><p className="mt-2 text-xs text-slate-500">Submitted {new Date(report.appeal.submittedAt).toLocaleString()}</p></InfoBlock> : null}{report.currentDecision ? <InfoBlock title="Current decision"><p className="font-semibold">{titleCase(report.currentDecision.action)}</p><p className="mt-1">{report.currentDecision.userVisibleReason}</p></InfoBlock> : null}</div><aside className="space-y-4">{notice ? <p className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-800">{notice}</p> : null}{actionable ? <><div className="rounded-2xl border border-slate-200 p-4"><p className="text-sm font-bold text-slate-900">Review controls</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={() => onUpdate({ status: "investigating" })} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Begin investigation</button><label className="w-full text-xs font-semibold text-slate-700">Information the reporter should provide<AutoResizeTextarea minRows={2} maxRows={6} value={informationNote} onChange={(event) => setInformationNote(event.target.value)} maxLength={1000} disabled={saving} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" placeholder="Specify the dates, explanation, or evidence needed to continue review." /></label><button type="button" disabled={saving || informationNote.trim().length < 10} onClick={() => onUpdate({ status: "awaiting_information", note: informationNote.trim() })} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50">Request information</button></div></div><form onSubmit={onSubmitDecision} className="space-y-3 rounded-2xl border border-slate-200 p-4"><div className="flex items-center gap-2"><ShieldAlert size={18} className="text-rose-600" /><p className="text-sm font-bold text-slate-900">Final decision</p></div><FieldSelect label="Outcome" value={decision.outcome} onChange={(value) => setDecision((current) => ({ ...current, outcome: value, action: value === "dismissed" ? "" : current.action }))} options={[["", "Select outcome"], ["dismissed", "Dismiss report"], ["violation_confirmed", "Confirm violation"]]} />{decision.outcome === "violation_confirmed" ? <FieldSelect label="Action" value={decision.action} onChange={(value) => setDecision((current) => ({ ...current, action: value }))} options={[["", "Select action"], ...actions]} /> : null}{durationActions.has(decision.action) ? <label className="block text-xs font-semibold text-slate-700">Duration in days<input type="number" min="1" max="365" required value={decision.durationDays} onChange={(event) => setDecision((current) => ({ ...current, durationDays: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label> : null}<FieldArea label="Policy reason" value={decision.policyReason} onChange={(value) => setDecision((current) => ({ ...current, policyReason: value }))} placeholder="Policy or evidence supporting the decision" required /><FieldArea label="Explanation shown to user" value={decision.userVisibleReason} onChange={(value) => setDecision((current) => ({ ...current, userVisibleReason: value }))} placeholder="Clear, respectful explanation" required /><FieldArea label="Internal note (optional)" value={decision.internalNote} onChange={(value) => setDecision((current) => ({ ...current, internalNote: value }))} placeholder="Private administrative context" /><label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900"><input type="checkbox" checked={decision.confirmed} onChange={(event) => setDecision((current) => ({ ...current, confirmed: event.target.checked }))} className="mt-0.5" />I reviewed the booking context and available evidence. This decision will be audited and may immediately restrict the user.</label><button type="submit" disabled={saving || !decision.outcome || (decision.outcome === "violation_confirmed" && !decision.action)} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50">{saving ? <LoaderCircle size={17} className="animate-spin" /> : <ShieldAlert size={17} />}{saving ? "Applying..." : report.status === "appealed" ? "Decide appeal" : "Apply decision"}</button></form></> : <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">This case has a final decision. It can be reviewed again only if the affected user submits an appeal.</div>}</aside></div></div></div>;
}

function SummaryCard({ label, value, tone }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-2 text-3xl font-bold ${tone === "rose" ? "text-rose-600" : tone === "blue" ? "text-blue-600" : "text-slate-700"}`}>{value}</p></div>; }
function Badge({ value }) { const normalized = String(value || ""); const tone = ["urgent", "high", "actioned"].includes(normalized) ? "bg-rose-50 text-rose-700" : ["open", "investigating"].includes(normalized) ? "bg-blue-50 text-blue-700" : normalized === "appealed" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-700"; return <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>{titleCase(value)}</span>; }
function Filter({ label, value, onChange, options }) { return <label className="block min-w-44 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold normal-case text-slate-700">{options.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}</select></label>; }
function InfoBlock({ title, children }) { return <section className="rounded-2xl border border-slate-200 p-4"><h3 className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">{title}</h3><div className="mt-2 text-sm leading-6 text-slate-700">{children}</div></section>; }
function FieldSelect({ label, value, onChange, options }) { return <label className="block text-xs font-semibold text-slate-700">{label}<select required value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>; }
function FieldArea({ label, value, onChange, placeholder, required = false }) { return <label className="block text-xs font-semibold text-slate-700">{label}<AutoResizeTextarea required={required} minLength={required ? 10 : undefined} maxLength={required ? 1000 : 2000} minRows={required ? 2 : 1} maxRows={required ? 6 : 4} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm leading-5" /></label>; }
