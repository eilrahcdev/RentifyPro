import { LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";

export default function RequestFeedback({ loading = false, error = "", label = "Loading...", onRetry, retryLabel = "Retry" }) {
  if (loading) return <div role="status" className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800"><LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{label}</div>;
  if (!error) return null;
  return <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><TriangleAlert size={18} className="shrink-0" aria-hidden="true" /><p className="min-w-0 flex-1">{error}</p>{onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-2 font-semibold hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"><RefreshCw size={16} aria-hidden="true" />{retryLabel}</button>}</div>;
}
