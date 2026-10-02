import { useEffect, useId, useRef } from "react";
import { LoaderCircle, Trash2, X } from "lucide-react";
import ModalPortal from "./ModalPortal";

export default function ConfirmationModal({ title, message, confirmLabel = "Confirm", busyLabel = "Deleting...", icon: Icon = Trash2, busy = false, error = "", onCancel, onConfirm, fallbackFocusRef }) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const previousFocus = document.activeElement;
    const fallbackFocus = fallbackFocusRef?.current;
    const dialog = dialogRef.current;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
      else fallbackFocus?.focus();
    };
  }, [fallbackFocusRef]);

  useEffect(() => {
    // Disabled buttons lose focus; keep keyboard events inside the busy dialog.
    if (busy) dialogRef.current?.focus();
    else cancelRef.current?.focus();
  }, [busy]);

  const dismiss = () => { if (!busy) onCancel(); };

  return (
    <ModalPortal>
      <dialog
        ref={dialogRef}
        tabIndex={-1}
        closedby={busy ? "none" : "closerequest"}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        aria-busy={busy}
        onCancel={(event) => { event.preventDefault(); dismiss(); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            dismiss();
          }
        }}
        className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-transparent p-0 text-slate-900 backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm"
      >
        <div className="flex min-h-full items-center justify-center p-4" onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
          <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.25)]">
            <div className="border-b border-slate-200 bg-gradient-to-r from-[#0B75E7]/10 via-white to-white px-6 pb-4 pt-5 sm:px-7">
              <button type="button" onClick={dismiss} disabled={busy} aria-label="Close confirmation" className="rp-icon-button absolute right-2 top-2">
                <X size={16} aria-hidden="true" />
              </button>
              <div className="flex items-center gap-3 pr-10">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200">
                  <Icon size={20} className="text-[#0B75E7]" aria-hidden="true" />
                </div>
                <h2 id={titleId} className="text-xl font-bold text-slate-900">{title}</h2>
              </div>
            </div>
            <div className="px-6 py-5 sm:px-7">
              <p id={messageId} className="mb-6 break-words text-sm text-slate-600">{message}</p>
              {error && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
              <div className="flex items-center gap-3">
                <button ref={cancelRef} type="button" onClick={dismiss} disabled={busy} className="rp-btn-secondary w-full py-2.5 text-sm disabled:opacity-50">Cancel</button>
                <button type="button" onClick={onConfirm} disabled={busy} className="rp-btn-primary w-full gap-2 py-2.5 text-sm disabled:opacity-50">
                  {busy && <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  {busy ? busyLabel : confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      </dialog>
    </ModalPortal>
  );
}
