import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import ModalPortal from "./ModalPortal";

export default function NotificationToolbarButton({ icon: Icon, label, tooltip = label, buttonRef, onClick, compact = false, ...props }) {
  const [position, setPosition] = useState(null);
  const tooltipId = useId();
  const hideTimer = useRef(null);
  const tooltipRef = useRef(null);

  const hide = () => {
    window.clearTimeout(hideTimer.current);
    setPosition(null);
  };
  const show = (event) => {
    window.clearTimeout(hideTimer.current);
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointer = event.type.startsWith("pointer");
    if (pointer && event.pointerType !== "mouse") return;
    document.dispatchEvent(new CustomEvent("rentifypro:notification-tooltip", { detail: tooltipId }));
    setPosition({ left: pointer ? event.clientX : bounds.left + bounds.width / 2, top: pointer ? event.clientY + 16 : bounds.bottom + 8 });
  };
  const hideSoon = () => { hideTimer.current = window.setTimeout(hide, 150); };

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  useLayoutEffect(() => {
    if (!position) return undefined;
    const dismiss = (event) => {
      if (event.type !== "keydown" || event.key === "Escape") setPosition(null);
    };
    const replaceTooltip = (event) => {
      if (event.detail !== tooltipId) {
        window.clearTimeout(hideTimer.current);
        setPosition(null);
      }
    };
    // Portal coordinates must stay within the viewport, including at the toolbar edges.
    const tooltipElement = tooltipRef.current;
    if (tooltipElement) {
      const bounds = tooltipElement.getBoundingClientRect();
      tooltipElement.style.left = `${Math.max(8, Math.min(position.left, window.innerWidth - bounds.width - 8))}px`;
      tooltipElement.style.top = `${Math.max(8, Math.min(position.top, window.innerHeight - bounds.height - 8))}px`;
    }
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    document.addEventListener("keydown", dismiss);
    document.addEventListener("rentifypro:notification-tooltip", replaceTooltip);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("rentifypro:notification-tooltip", replaceTooltip);
    };
  }, [position, tooltipId]);

  return (
    <>
      <button
        {...props}
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-describedby={position ? tooltipId : undefined}
        onPointerEnter={show}
        onPointerLeave={hideSoon}
        onFocus={show}
        onBlur={hide}
        onClick={(event) => { hide(); onClick?.(event); }}
        className={`inline-flex shrink-0 items-center justify-center text-slate-700 hover:bg-slate-200/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-40 ${compact ? "!h-10 !w-6 !min-w-6 rounded" : "h-11 w-11 rounded-lg"}`}
      >
        {compact ? <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M0 0h10L5 6Z" fill="currentColor" /></svg> : <Icon size={20} aria-hidden="true" />}
      </button>
      {position && <ModalPortal lockScroll={false}>
        <div ref={tooltipRef} id={tooltipId} role="tooltip" onPointerEnter={() => window.clearTimeout(hideTimer.current)} onPointerLeave={hideSoon} className="fixed z-[130] max-w-[calc(100vw-1rem)] rounded border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white shadow-md">
          {tooltip}
        </div>
      </ModalPortal>}
    </>
  );
}
