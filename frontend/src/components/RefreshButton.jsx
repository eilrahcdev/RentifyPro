import { RefreshCw } from "lucide-react";

export default function RefreshButton({
  onClick,
  disabled = false,
  refreshing = false,
  busyLabel = "Refreshing...",
  className = "",
  "aria-label": ariaLabel = "Refresh",
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || refreshing}
      aria-label={ariaLabel}
      aria-busy={refreshing}
      title={ariaLabel}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white p-0 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-wait disabled:opacity-50 md:w-auto md:px-4 ${className}`}
    >
      <RefreshCw
        size={18}
        strokeWidth={2}
        className={refreshing ? "animate-spin motion-reduce:animate-none" : "md:hidden"}
        aria-hidden="true"
      />
      <span className="hidden md:inline">{refreshing ? busyLabel : "Refresh"}</span>
    </button>
  );
}
