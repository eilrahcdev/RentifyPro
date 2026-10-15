import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import ModalPortal from "./ModalPortal";

export default function BookingRequestModal({ titleId, title, subtitle, loading, error, onClose, onSubmit, submitLabel, children }) {
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const errorRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog.showModal();
    titleRef.current?.focus();
    return () => { dialog.close(); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const dismiss = () => { if (!loading) onClose(); };
  return (
    <ModalPortal>
      <dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={`${titleId}-description`} aria-busy={loading}
        onCancel={(event) => { event.preventDefault(); dismiss(); }}
        className="rp-report-dialog fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-transparent p-0 text-slate-900 backdrop:bg-slate-950/60">
        <div className="rp-native-modal-frame" onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
          <form noValidate onSubmit={(event) => { event.preventDefault(); if (!loading) onSubmit(); }}
            className="rp-modal-panel my-auto flex w-full min-w-0 max-w-lg flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <h2 ref={titleRef} tabIndex={-1} id={titleId} className="text-lg font-bold text-slate-950 outline-none">{title}</h2>
                <p id={`${titleId}-description`} className="mt-1 text-sm text-slate-600">{subtitle}</p>
              </div>
              <button type="button" onClick={dismiss} disabled={loading} className="rp-icon-button" aria-label={`Close ${title.toLowerCase()}`}><X size={20} aria-hidden="true" /></button>
            </div>
            <div className="rp-modal-scroll space-y-4 px-5 py-4">{children}{error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-rose-800 outline-none">{error}</p>}</div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button type="button" onClick={dismiss} disabled={loading} className="min-h-11 rounded-xl border border-slate-400 bg-white px-4 text-sm font-semibold text-slate-800 disabled:opacity-60">Cancel</button>
              <button type="submit" disabled={loading} className="min-h-11 rounded-xl bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60">{loading ? "Saving..." : submitLabel}</button>
            </div>
          </form>
        </div>
      </dialog>
    </ModalPortal>
  );
}
