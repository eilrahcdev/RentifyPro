import { Activity } from "lucide-react";

const toneStyles = {
  blue: { bar: "bg-blue-500", text: "text-blue-700", soft: "bg-blue-50" },
  emerald: { bar: "bg-emerald-500", text: "text-emerald-700", soft: "bg-emerald-50" },
  amber: { bar: "bg-amber-500", text: "text-amber-700", soft: "bg-amber-50" },
  rose: { bar: "bg-rose-500", text: "text-rose-700", soft: "bg-rose-50" },
  violet: { bar: "bg-violet-500", text: "text-violet-700", soft: "bg-violet-50" },
  slate: { bar: "bg-slate-500", text: "text-slate-700", soft: "bg-slate-100" },
};

export function AnalyticsPanel({ eyebrow, title, description, icon: Icon = Activity, action, children, className = "" }) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_6px_20px_rgba(33,33,33,0.035)] ${className}`}>
      <header className="flex flex-col gap-3 border-b border-slate-100 bg-white px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-blue-600"><Icon size={15} aria-hidden="true" /><p className="text-[10px] font-semibold uppercase tracking-[0.15em]">{eyebrow}</p></div>
          <h2 className="mt-1.5 text-lg font-bold tracking-[-0.015em] text-slate-900">{title}</h2>
          {description ? <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function DistributionList({ items, total: suppliedTotal, emptyLabel = "No data is available yet." }) {
  const total = suppliedTotal ?? items.reduce((sum, item) => sum + Number(item.value || 0), 0);
  if (!items.length || total <= 0) return <p className="flex min-h-36 items-center justify-center text-center text-sm text-slate-500">{emptyLabel}</p>;

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const value = Number(item.value || 0);
        const percentage = Math.round((value / total) * 100);
        const theme = toneStyles[item.tone] || toneStyles.blue;
        return (
          <div key={item.label}>
            <div className="mb-1.5 flex items-center justify-between gap-4 text-xs">
              <span className="flex min-w-0 items-center gap-2 font-semibold text-slate-700"><span className={`h-2 w-2 shrink-0 rounded-full ${theme.bar}`} /> <span className="truncate">{item.label}</span></span>
              <span className="shrink-0 font-bold tabular-nums text-slate-900">{item.displayValue ?? value} <span className="ml-1 font-medium text-slate-400">{percentage}%</span></span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={`${item.label}: ${percentage}%`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={percentage}>
              <div className={`h-full min-w-[3px] rounded-full ${theme.bar}`} style={{ width: `${percentage}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TrendBars({ data, primaryKey = "value", secondaryKey, primaryLabel = "Total", secondaryLabel, emptyLabel = "No activity is available for this period.", formatValue }) {
  const maximum = Math.max(0, ...data.flatMap((item) => [Number(item[primaryKey] || 0), secondaryKey ? Number(item[secondaryKey] || 0) : 0]));
  const displayValue = (value) => formatValue ? formatValue(value) : value;
  if (!data.length || maximum <= 0) return <p className="flex min-h-44 items-center justify-center text-center text-sm text-slate-500">{emptyLabel}</p>;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-4 text-[11px] font-semibold text-slate-500">
        <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-blue-500" />{primaryLabel}</span>
        {secondaryKey ? <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" />{secondaryLabel}</span> : null}
      </div>
      <div className="flex h-44 items-end gap-2 border-b border-slate-200 px-1 sm:gap-3">
        {data.map((item, index) => {
          const primary = Number(item[primaryKey] || 0);
          const secondary = secondaryKey ? Number(item[secondaryKey] || 0) : 0;
          return (
            <div key={item.label} className="group flex h-full min-w-0 flex-1 items-end justify-center gap-1" title={`${item.tooltipLabel || item.label}: ${primaryLabel} ${displayValue(primary)}${secondaryKey ? `, ${secondaryLabel} ${displayValue(secondary)}` : ""}`}>
              <div className="relative flex h-full w-full max-w-8 items-end">
                <span className={`absolute -top-5 hidden whitespace-nowrap rounded bg-slate-900 px-1.5 py-1 text-[9px] font-semibold text-white group-hover:block ${formatValue && index === 0 ? "left-0" : formatValue && index === data.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2"}`}>{displayValue(primary)}</span>
                <span className="w-full rounded-t-md bg-blue-500/90 transition-colors group-hover:bg-blue-600" style={{ height: `${Math.max(primary ? 5 : 0, (primary / maximum) * 100)}%` }} />
              </div>
              {secondaryKey ? <div className="flex h-full w-full max-w-8 items-end"><span className="w-full rounded-t-md bg-emerald-500/85" style={{ height: `${Math.max(secondary ? 5 : 0, (secondary / maximum) * 100)}%` }} /></div> : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2 px-1 sm:gap-3">{data.map((item) => <span key={item.label} className="min-w-0 flex-1 truncate text-center text-[10px] font-semibold text-slate-500">{item.label}</span>)}</div>
    </div>
  );
}

export function ProgressRing({ value, label, detail, tone = "blue", size = "default" }) {
  const normalized = Math.max(0, Math.min(100, Math.round(Number(value || 0))));
  const colors = { blue: "#0b75e7", emerald: "#10b981", amber: "#f59e0b", rose: "#f43f5e", violet: "#8b5cf6" };
  const color = colors[tone] || colors.blue;
  const large = size === "large";
  return (
    <div className="flex flex-col items-center justify-center text-center">
      <div className={`relative flex ${large ? "aspect-square w-full max-w-[240px]" : "h-36 w-36"} items-center justify-center rounded-full`} style={{ background: `conic-gradient(${color} ${normalized * 3.6}deg, #e2e8f0 0deg)` }} role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={normalized}>
        <div className={`flex ${large ? "h-[74%] w-[74%]" : "h-[108px] w-[108px]"} flex-col items-center justify-center rounded-full bg-white shadow-inner`}>
          <strong className={`${large ? "text-[48px] leading-none sm:text-[56px]" : "text-3xl"} font-extrabold tracking-[-0.04em] text-slate-950`}>{normalized}%</strong>
          <span className={`${large ? "mt-1 text-sm font-semibold" : "mt-0.5 text-[10px]"} uppercase tracking-[0.1em] text-slate-500`}>{label}</span>
        </div>
      </div>
      {detail ? <p className={`mt-4 max-w-xs ${large ? "text-sm" : "text-xs"} leading-5 text-slate-500`}>{detail}</p> : null}
    </div>
  );
}

export function MetricTile({ label, value, helper, tone = "blue", size = "default" }) {
  const theme = toneStyles[tone] || toneStyles.blue;
  const large = size === "large";
  return (
    <div className={`rounded-xl ${large ? "p-4" : "p-3.5"} ring-1 ring-inset ring-slate-200/70 ${theme.soft}`}>
      <p className={`${large ? "text-xs leading-5" : "text-[10px]"} font-semibold uppercase tracking-[0.1em] text-slate-500`}>{label}</p>
      <p className={`mt-1 ${large ? "text-2xl" : "text-xl"} font-bold tracking-[-0.03em] ${theme.text}`}>{value}</p>
      {helper ? <p className="mt-1 text-[10px] leading-4 text-slate-500">{helper}</p> : null}
    </div>
  );
}
