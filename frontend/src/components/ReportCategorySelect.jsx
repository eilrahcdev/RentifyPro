import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export default function ReportCategorySelect({
  label,
  placeholder,
  groups = [],
  value,
  onChange,
  disabled = false,
  error = "",
  buttonRef,
}) {
  const listboxId = useId();
  const triggerRef = useRef(null);
  const optionsRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const selectedLabel = useMemo(
    () => groups.flatMap((group) => group.options).find(([optionValue]) => optionValue === value)?.[1] || "",
    [groups, value]
  );

  useEffect(() => {
    if (open) (optionsRef.current?.querySelector('[aria-selected="true"]') || optionsRef.current?.querySelector('[role="option"]'))?.focus();
  }, [open]);

  const selectOption = (optionValue) => {
    onChange(optionValue);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const openOptions = () => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    setOpenAbove(Boolean(bounds && window.innerHeight - bounds.bottom < 208 && bounds.top > 208));
    setOpen(true);
  };

  return (
    <div
      className="relative block"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <span id={`${listboxId}-label`} className="mb-1.5 block text-sm font-semibold text-slate-800">{label} <span className="font-normal text-slate-500">(required)</span></span>
      <button
        ref={(element) => { triggerRef.current = element; if (buttonRef) buttonRef.current = element; }}
        type="button"
        disabled={disabled}
        aria-labelledby={`${listboxId}-label ${listboxId}-value`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${listboxId}-error` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => { if (open) setOpen(false); else openOptions(); }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            openOptions();
          }
        }}
        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border bg-white px-3 py-2.5 text-left text-sm outline-none transition focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${
          error ? "border-rose-500 focus:ring-rose-100" : open
            ? "border-blue-500 ring-4 ring-blue-100"
            : "border-slate-300 hover:border-slate-400 focus:border-blue-500 focus:ring-blue-100"
        }`}
      >
        <span id={`${listboxId}-value`} className={selectedLabel ? "font-medium text-slate-900" : "text-slate-500"}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown size={18} strokeWidth={2} className={`shrink-0 text-blue-600 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open ? (
        <div
          ref={optionsRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          onKeyDown={(event) => {
            const options = [...event.currentTarget.querySelectorAll('[role="option"]')];
            const index = options.indexOf(document.activeElement);
            const next = { ArrowDown: (index + 1) % options.length, ArrowUp: (index - 1 + options.length) % options.length, Home: 0, End: options.length - 1 }[event.key];
            if (next !== undefined) { event.preventDefault(); options[next]?.focus(); }
          }}
          className={`absolute left-0 right-0 z-10 max-h-48 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-slate-50 p-2 shadow-lg ${openAbove ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          {groups.map((group, groupIndex) => (
            <div
              key={group.label}
              role="group"
              aria-label={group.label}
              className={groupIndex ? "mt-2 border-t border-slate-200 pt-2" : ""}
            >
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.options.map(([optionValue, optionLabel]) => {
                  const selected = optionValue === value;
                  return (
                    <button
                      key={optionValue}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      disabled={disabled}
                      aria-selected={selected}
                      onClick={() => selectOption(optionValue)}
                      className={`flex w-full items-start justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm leading-5 transition ${
                        selected
                          ? "bg-blue-600 font-semibold text-white"
                          : "bg-white text-slate-700 hover:bg-blue-50 hover:text-blue-800"
                      }`}
                    >
                      <span>{optionLabel}</span>
                      {selected ? <Check size={16} className="mt-0.5 shrink-0" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {error && <p id={`${listboxId}-error`} role="alert" className="mt-1.5 text-sm text-rose-700">{error}</p>}
    </div>
  );
}
