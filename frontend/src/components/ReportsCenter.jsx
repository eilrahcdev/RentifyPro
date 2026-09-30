import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TriangleAlert,
  ArrowLeft,
  FileUp,
  FileWarning,
  LoaderCircle,
  RefreshCw,
  Send,
} from "lucide-react";
import API from "../utils/api";
import EvidenceFilePicker from "./EvidenceFilePicker";
import { validateReportEvidenceFiles } from "../utils/fileValidation";
import OwnerPageHeader from "../owner/components/OwnerPageHeader";

const titleCase = (value) =>
  String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const statusTone = (status) => ({
  open: "bg-blue-50 text-blue-700",
  investigating: "bg-violet-50 text-violet-700",
  awaiting_information: "bg-amber-50 text-amber-700",
  actioned: "bg-rose-50 text-rose-700",
  dismissed: "bg-slate-100 text-slate-700",
  appealed: "bg-orange-50 text-orange-700",
  closed: "bg-emerald-50 text-emerald-700",
}[status] || "bg-slate-100 text-slate-700");

export default function ReportsCenter({ onBack, embedded = false, ownerHeader = false }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [appealingId, setAppealingId] = useState("");
  const [appealText, setAppealText] = useState("");
  const [respondingId, setRespondingId] = useState("");
  const [informationText, setInformationText] = useState("");
  const [informationFiles, setInformationFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await API.getMyReports();
      setReports(Array.isArray(response.reports) ? response.reports : []);
    } catch (requestError) {
      setError(requestError.message || "Reports could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => filter === "all" ? reports : reports.filter((item) => item.perspective === filter),
    [filter, reports]
  );

  useEffect(() => {
    if (loading || !window.location.hash.startsWith("#report-")) return;
    const id = window.location.hash.slice(1);
    const target = document.getElementById(id);
    target?.scrollIntoView({ block: "start" });
  }, [loading, visible]);

  const submitAppeal = async (report) => {
    if (appealText.trim().length < 20) {
      setNotice("Please explain your appeal in at least 20 characters.");
      return;
    }
    setSubmitting(true);
    setNotice("");
    try {
      await API.appealReport(report._id, appealText.trim());
      setAppealingId("");
      setAppealText("");
      setNotice("Your appeal was submitted for administrator review.");
      await load();
    } catch (requestError) {
      setNotice(requestError.message || "The appeal could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitInformation = async (report) => {
    if (informationText.trim().length < 20) {
      setNotice("Please provide at least 20 characters of additional information.");
      return;
    }
    try {
      validateReportEvidenceFiles(informationFiles);
    } catch (validationError) {
      setNotice(validationError.message || "The selected evidence files are invalid.");
      return;
    }
    const formData = new FormData();
    formData.append("statement", informationText.trim());
    informationFiles.forEach((file) => formData.append("evidence", file));
    setSubmitting(true);
    setNotice("");
    try {
      await API.addReportInformation(report._id, formData);
      setRespondingId("");
      setInformationText("");
      setInformationFiles([]);
      setNotice("Your additional information was added to the case.");
      await load();
    } catch (requestError) {
      setNotice(requestError.message || "The information could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className={embedded ? "space-y-5" : "min-h-screen bg-slate-50 px-4 py-8 sm:px-6"}>
      <div className={ownerHeader ? "space-y-5" : "mx-auto max-w-6xl space-y-5"}>
        {ownerHeader ? (
          <OwnerPageHeader
            title="Reports and Appeals"
            description="Track reports you submitted and moderation decisions involving your account."
            actions={(
              <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <RefreshCw size={18} strokeWidth={2} className={loading ? "animate-spin" : ""} aria-hidden="true" />Refresh
              </button>
            )}
          />
        ) : (
        <header className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-3">
            {onBack ? (
              <button type="button" onClick={onBack} aria-label="Go back" className="mt-0.5 rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50">
                <ArrowLeft size={18} strokeWidth={2} />
              </button>
            ) : null}
            <div>
              <h1 className="text-2xl font-bold text-slate-950">Reports and appeals</h1>
              <p className="mt-1 text-sm text-slate-500">Track reports you submitted and moderation decisions involving your account.</p>
            </div>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw size={18} strokeWidth={2} className={loading ? "animate-spin" : ""} aria-hidden="true" />Refresh
          </button>
        </header>
        )}

        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:w-fit">
          {[["all", "All"], ["submitted", "Submitted"], ["received", "Received"]].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setFilter(id)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${filter === id ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {label}
            </button>
          ))}
        </div>

        {notice ? <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{notice}</p> : null}
        {error ? <p className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><TriangleAlert size={18} strokeWidth={2} aria-hidden="true" />{error}</p> : null}
        {loading ? <div className="flex min-h-64 items-center justify-center rounded-3xl border border-slate-200 bg-white"><LoaderCircle size={32} strokeWidth={2} className="animate-spin text-blue-600" aria-hidden="true" /></div> : null}
        {!loading && !error && !visible.length ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
            <FileWarning size={32} className="mx-auto text-slate-300" />
            <h2 className="mt-3 font-bold text-slate-900">No reports in this view</h2>
            <p className="mt-1 text-sm text-slate-500">Booking-related cases will appear here.</p>
          </div>
        ) : null}

        {!loading ? (
          <div className="space-y-4">
            {visible.map((report) => (
              <article id={`report-${report._id}`} key={report._id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">{report.caseReference} · {report.perspective}</p>
                    <h2 className="mt-1 text-lg font-bold text-slate-950">{titleCase(report.category)}</h2>
                    <p className="mt-1 text-sm text-slate-500">{report.sourceType === "chat_message" ? "Reported chat message" : `Booking #${String(report.booking?._id || report.booking || "").slice(-6).toUpperCase()}`} · {new Date(report.createdAt).toLocaleString()}</p>
                  </div>
                  <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${statusTone(report.status)}`}>{titleCase(report.status)}</span>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{report.description}</p>

                {report.sourceType === "chat_message" && report.messageSnapshot?.text ? (
                  <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Reported message only</p>
                    <blockquote className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-900">“{report.messageSnapshot.text}”</blockquote>
                    <p className="mt-2 text-xs text-slate-500">No other messages from the conversation are attached to this case.</p>
                  </div>
                ) : null}

                {report.informationResponses?.length ? (
                  <div className="mt-4 space-y-2 rounded-xl border border-blue-100 bg-blue-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Additional information submitted</p>
                    {report.informationResponses.map((response) => <p key={response._id} className="whitespace-pre-wrap text-sm leading-6 text-blue-950">{response.statement}</p>)}
                  </div>
                ) : null}

                {report.currentDecision ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Administrator decision</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{titleCase(report.currentDecision.action)}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{report.currentDecision.userVisibleReason}</p>
                  </div>
                ) : null}

                {report.evidence?.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {report.evidence.map((file) => file.url ? (
                      <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">{file.originalName}</a>
                    ) : <span key={file.id} className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">Private evidence</span>)}
                  </div>
                ) : null}

                {report.informationRequest && report.status === "awaiting_information" && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>Requested information:</strong> {report.informationRequest}</p>}
                {report.perspective === "submitted" && report.status === "awaiting_information" ? (
                  <InformationForm
                    open={respondingId === report._id}
                    text={informationText}
                    files={informationFiles}
                    submitting={submitting}
                    onOpen={() => { setRespondingId(report._id); setInformationText(""); setInformationFiles([]); }}
                    onCancel={() => setRespondingId("")}
                    onTextChange={setInformationText}
                    onFilesChange={setInformationFiles}
                    onFileError={setNotice}
                    onSubmit={() => void submitInformation(report)}
                  />
                ) : null}

                {report.canAppeal ? (
                  <div className="mt-5 border-t border-slate-200 pt-4">
                    {appealingId !== report._id ? (
                      <button type="button" onClick={() => { setAppealingId(report._id); setAppealText(""); }} className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800">Appeal decision</button>
                    ) : (
                      <div className="space-y-3">
                        <textarea value={appealText} onChange={(event) => setAppealText(event.target.value.slice(0, 2000))} rows={4} placeholder="Explain why this decision should be reconsidered." className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setAppealingId("")} disabled={submitting} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">Cancel</button>
                          <button type="button" onClick={() => void submitAppeal(report)} disabled={submitting} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                            {submitting ? <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <Send size={18} strokeWidth={2} aria-hidden="true" />}Submit appeal
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function InformationForm({ open, text, files, submitting, onOpen, onCancel, onTextChange, onFilesChange, onFileError, onSubmit }) {
  return (
    <div className="mt-5 border-t border-slate-200 pt-4">
      {!open ? (
        <button type="button" onClick={onOpen} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Provide requested information</button>
      ) : (
        <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <textarea value={text} onChange={(event) => onTextChange(event.target.value.slice(0, 2000))} rows={4} placeholder="Provide the details requested by the administrator." className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" />
          <EvidenceFilePicker files={files} onChange={onFilesChange} onError={onFileError} disabled={submitting} />
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} disabled={submitting} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Cancel</button>
            <button type="button" onClick={onSubmit} disabled={submitting} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {submitting ? <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <FileUp size={18} strokeWidth={2} aria-hidden="true" />}Submit information
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
