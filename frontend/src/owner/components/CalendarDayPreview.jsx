import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import ModalPortal from "../../components/ModalPortal";
import "./CalendarDayPreview.css";

export default function CalendarDayPreview({ id, anchor, dateLabel, entries, refreshing, error, notice = "", onClose, onViewDetails }) {
  const dialogRef = useRef(null);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 639px)").matches);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    anchor.focus({ preventScroll: true });
    if (compact) dialog.showModal(); else dialog.show();

    const position = () => {
      if (compact) return;
      if (!anchor.isConnected) { onClose(); return; }
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft || 0;
      const topEdge = viewport?.offsetTop || 0;
      const width = viewport?.width || document.documentElement.clientWidth;
      const height = viewport?.height || window.innerHeight;
      const cell = anchor.getBoundingClientRect();
      if (cell.bottom <= topEdge || cell.top >= topEdge + height || cell.right <= leftEdge || cell.left >= leftEdge + width) {
        onClose();
        return;
      }
      const below = topEdge + height - cell.bottom - 20;
      const above = cell.top - topEdge - 20;
      const placement = below >= Math.min(448, height - 24) || below >= above ? "below" : "above";
      const available = placement === "below" ? below : above;
      dialog.style.setProperty("--calendar-preview-height", `${Math.min(448, height - 24, Math.max(160, available))}px`);
      const panel = dialog.getBoundingClientRect();
      const left = Math.max(leftEdge + 12, Math.min(cell.left, leftEdge + width - panel.width - 12));
      const top = Math.max(topEdge + 12, Math.min(placement === "below" ? cell.bottom + 8 : cell.top - panel.height - 8, topEdge + height - panel.height - 12));
      dialog.style.setProperty("--calendar-preview-left", `${left}px`);
      dialog.style.setProperty("--calendar-preview-top", `${top}px`);
      dialog.dataset.placement = placement;
    };
    position();
    dialog.focus({ preventScroll: true });

    const outside = (event) => {
      const rect = dialog.getBoundingClientRect();
      const backdrop = event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
      if (backdrop || (!dialog.contains(event.target) && !event.target.closest?.("[data-owner-calendar-date]"))) onClose();
    };
    const scroll = (event) => { if (!dialog.contains(event.target)) position(); };
    const observer = new ResizeObserver(position);
    observer.observe(dialog);
    observer.observe(anchor);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      dialog.close();
    };
  }, [anchor, compact, onClose]);

  const dismiss = () => {
    dialogRef.current.close();
    if (anchor.isConnected) anchor.focus({ preventScroll: true });
    onClose();
  };

  return (
    <ModalPortal lockScroll={compact}>
      <dialog
        ref={dialogRef}
        id={id}
        tabIndex={-1}
        aria-modal={compact ? "true" : undefined}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-summary`}
        aria-busy={refreshing}
        className="rp-calendar-preview"
        onCancel={(event) => { event.preventDefault(); dismiss(); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            dismiss();
          } else if (!compact && event.key === "Tab") {
            const controls = event.currentTarget.querySelectorAll("button");
            const leaving = event.shiftKey
              ? document.activeElement === controls[0] || document.activeElement === event.currentTarget
              : document.activeElement === controls[controls.length - 1];
            if (leaving) { event.preventDefault(); dismiss(); }
          }
        }}
      >
        <header className="rp-calendar-preview__header">
          <div>
            <h2 id={`${id}-title`}>{dateLabel}</h2>
            <p id={`${id}-summary`} aria-live="polite">
              {error ? "Booking events unavailable" : refreshing ? "Updating booking events..." : `${entries.length} booking${entries.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <button type="button" className="rp-calendar-preview__close" aria-label="Close booking preview" onClick={dismiss}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="rp-calendar-preview__list" tabIndex={entries.length && !error ? 0 : undefined} aria-label="Booking events">
          {!error && notice && <p className="rp-calendar-preview__message" role="status">{notice}</p>}
          {error ? (
            <p className="rp-calendar-preview__message" role="status">Booking events are unavailable. Close this preview and reload the dashboard to try again.</p>
          ) : entries.length ? (
            <ul>
              {entries.map((entry) => (
                <li key={entry.id}>
                  <p className="rp-calendar-preview__vehicle">{entry.vehicle}</p>
                  <p className="rp-calendar-preview__renter">{entry.renter}</p>
                  {entry.events.map((event) => <p key={event} className="rp-calendar-preview__event">{event}</p>)}
                  <p className="rp-calendar-preview__status">Status: {entry.status}</p>
                </li>
              ))}
            </ul>
          ) : refreshing ? (
            <p className="rp-calendar-preview__message" role="status">Loading booking events...</p>
          ) : !notice && (
            <p className="rp-calendar-preview__message">No booking events for this date.</p>
          )}
        </div>
        <footer className="rp-calendar-preview__footer">
          <button type="button" className="rp-calendar-preview__details" onClick={onViewDetails}>View full day details</button>
        </footer>
      </dialog>
    </ModalPortal>
  );
}
