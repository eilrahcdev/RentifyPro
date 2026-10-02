import { TriangleAlert } from "lucide-react";
import { getSessionUser } from "../utils/sessionStore";

export default function ReportSubmissionError({ error, existingReport }) {
  return (
    <>
      {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700"><TriangleAlert size={18} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />{error}</p>}
      {existingReport !== null && <a href={(getSessionUser()?.role === "owner" ? "/owner-dashboard?tab=Reports" : "/reports") + (existingReport ? "#report-" + encodeURIComponent(existingReport) : "")} className="inline-block text-sm font-semibold text-blue-700 underline">View existing report</a>}
    </>
  );
}
