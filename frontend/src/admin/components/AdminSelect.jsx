import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Keep focus on the combobox so keyboard use also works inside existing dialogs.
export default function AdminSelect({ label, value, onChange, options, disabled = false, className = "", id, "aria-label": ariaLabel, icon: Icon }) {
  const generatedId = useId();
  const controlId = id || generatedId;
  const listId = `${controlId}-options`;
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const typeahead = useRef({ value: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState(null);
  const items = options.map((option) => typeof option === "string" ? { value: option, label: option } : option);
  const selectedIndex = items.findIndex((option) => option.value === value);
  const selected = items[selectedIndex];
  const expanded = open && !disabled;

  useLayoutEffect(() => {
    if (!expanded) return undefined;
    const placeMenu = (event) => {
      if (event?.target instanceof Node && menuRef.current?.contains(event.target)) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportHeight = viewport?.height || window.innerHeight;
      const viewportWidth = viewport?.width || document.documentElement.clientWidth;
      const below = viewportTop + viewportHeight - rect.bottom - 14;
      const above = rect.top - viewportTop - 14;
      const upwards = below < Math.min(280, items.length * 44 + 12) && above > below;
      const maxHeight = Math.max(44, Math.min(320, upwards ? above : below));
      const width = Math.min(Math.max(rect.width, 180), viewportWidth - 16);
      const left = Math.max(viewportLeft + 8, Math.min(rect.left, viewportLeft + viewportWidth - width - 8));
      setPosition({ left, width, maxHeight, ...(upwards ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
    };
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    window.visualViewport?.addEventListener("resize", placeMenu);
    window.visualViewport?.addEventListener("scroll", placeMenu);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
      window.visualViewport?.removeEventListener("resize", placeMenu);
      window.visualViewport?.removeEventListener("scroll", placeMenu);
    };
  }, [expanded, items.length]);

  useEffect(() => {
    if (!expanded) return undefined;
    const closeOutside = (event) => {
      if (!buttonRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
    };
  }, [expanded]);

  useLayoutEffect(() => {
    if (!expanded || activeIndex < 0) return;
    const menu = menuRef.current;
    const option = menu?.children[activeIndex];
    if (!option) return;
    // Scroll only the popup, never the page underneath it.
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
  }, [expanded, activeIndex, position]);

  const firstEnabled = items.findIndex((option) => !option.disabled);
  const showMenu = () => {
    setActiveIndex(selectedIndex >= 0 && !selected.disabled ? selectedIndex : firstEnabled);
    setOpen(true);
  };
  const choose = (index) => {
    const option = items[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    typeahead.current = { value: "", time: 0 };
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  };
  const handleKeyDown = (event) => {
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      typeahead.current = { value: "", time: 0 };
      setOpen(false);
    } else if (event.key === "Tab") {
      typeahead.current = { value: "", time: 0 };
      setOpen(false);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!expanded) {
        showMenu();
        if (event.key === "Home") setActiveIndex(firstEnabled);
        if (event.key === "End") setActiveIndex(items.findLastIndex((option) => !option.disabled));
        return;
      }
      if (event.key === "Home") setActiveIndex(firstEnabled);
      else if (event.key === "End") setActiveIndex(items.findLastIndex((option) => !option.disabled));
      else {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        for (let step = 1; step <= items.length; step += 1) {
          const next = (activeIndex + direction * step + items.length) % items.length;
          if (!items[next].disabled) { setActiveIndex(next); break; }
        }
      }
    } else if (event.key === "Enter" || (event.key === " " && Date.now() - typeahead.current.time >= 700)) {
      event.preventDefault();
      typeahead.current = { value: "", time: 0 };
      if (expanded) choose(activeIndex);
      else showMenu();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const previous = now - typeahead.current.time < 700 ? typeahead.current.value : "";
      const query = previous + event.key.toLocaleLowerCase();
      typeahead.current = { value: query, time: now };
      const repeated = [...query].every((letter) => letter === query[0]);
      for (let step = 1; step <= items.length; step += 1) {
        const start = activeIndex >= 0 ? activeIndex : Math.max(selectedIndex, 0);
        const next = (start + step - (previous && !repeated ? 1 : 0)) % items.length;
        if (!items[next].disabled && String(items[next].label).toLocaleLowerCase().startsWith(repeated ? query[0] : query)) {
          setActiveIndex(next);
          setOpen(true);
          break;
        }
      }
    }
  };

  return (
    <div className={`min-w-0 ${className}`}>
      {label ? <label id={`${controlId}-label`} htmlFor={controlId} className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">{label}</label> : null}
      <button ref={buttonRef} id={controlId} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? listId : undefined} aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined} aria-label={ariaLabel || (!label ? String(selected?.label || "Select an option") : undefined)} aria-labelledby={!ariaLabel && label ? `${controlId}-label ${controlId}-value` : undefined} disabled={disabled} onKeyDown={handleKeyDown} onClick={() => { typeahead.current = { value: "", time: 0 }; if (expanded) setOpen(false); else showMenu(); }} className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-800 outline-none transition hover:border-slate-400 focus-visible:border-blue-500 focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60">
        {Icon ? <Icon size={18} className="shrink-0 text-slate-500" aria-hidden="true" /> : null}
        <span id={`${controlId}-value`} className="min-w-0 flex-1 break-words">{selected?.label || "Select an option"}</span>
        <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-slate-500 transition-transform duration-150 motion-reduce:transition-none ${expanded ? "rotate-180" : "rotate-0"}`} />
      </button>
      {expanded && position ? createPortal(
        <div ref={menuRef} id={listId} role="listbox" aria-label={ariaLabel || label || "Options"} style={position} className="fixed z-[100] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-1.5 text-sm text-slate-800 shadow-[0_12px_32px_rgba(15,23,42,0.16)]">
          {items.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} onPointerDown={(event) => event.preventDefault()} onPointerMove={() => { if (!option.disabled) setActiveIndex(index); }} onClick={() => choose(index)} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 ${option.disabled ? "cursor-not-allowed text-slate-400" : index === activeIndex ? "bg-blue-50 text-blue-800" : "hover:bg-slate-50"} ${option.value === value ? "font-semibold text-blue-700" : "font-medium"}`}>
            <span className="min-w-0 flex-1 break-words">{option.label}</span>{option.value === value ? <Check size={16} className="shrink-0" aria-hidden="true" /> : null}
          </div>)}
        </div>, document.body,
      ) : null}
    </div>
  );
}
