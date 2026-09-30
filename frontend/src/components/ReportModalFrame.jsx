import { useEffect, useRef } from "react";
import { LoaderCircle, ShieldAlert, X } from "lucide-react";
import ModalPortal from "./ModalPortal";

export default function ReportModalFrame({
  titleId, title, subtitle, headerIcon, submitIcon, submittingLabel,
  submitting, reviewing = false, onClose, onBack, onSubmit, onConfirm, children,
}) {
  const dialogRef = useRef(null);
  const titleRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    titleRef.current?.focus();
    dialogRef.current?.scrollTo(0, 0);
  }, [reviewing]);

  const dismiss = () => {
    if (!submitting) (reviewing ? onBack : onClose)?.();
  };

  const trapFocus = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), a[href], textarea:not(:disabled), input:not(:disabled), [tabindex="0"]')]
      .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) {
      event.preventDefault();
      titleRef.current?.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <ModalPortal>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-subtitle`}
        aria-modal="true"
        aria-busy={submitting}
        onCancel={(event) => { event.preventDefault(); dismiss(); }}
        onKeyDown={trapFocus}
        className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-transparent p-0 text-slate-900 backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm"
      >
        <div className="flex min-h-full items-center justify-center p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
          <form
            noValidate
            onSubmit={(event) => { event.preventDefault(); if (!submitting && !reviewing) onSubmit(); }}
            className="my-auto w-full min-w-0 max-w-lg rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div className="flex min-w-0 gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 [&>svg]:h-5 [&>svg]:w-5">
                  {headerIcon || <ShieldAlert size={24} strokeWidth={2} aria-hidden="true" />}
                </span>
                <div className="min-w-0">
                  <h2 ref={titleRef} tabIndex={-1} id={titleId} className="text-base font-bold leading-6 text-slate-950 outline-none sm:text-lg">{title}</h2>
                  <p id={`${titleId}-subtitle`} className="mt-0.5 break-words text-xs leading-4 text-slate-500">{subtitle}</p>
                </div>
              </div>
              <button type="button" aria-label={reviewing ? "Back to edit report" : "Close report form"} disabled={submitting} onClick={dismiss} className="rp-icon-button">
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            <div className="space-y-3 px-4 py-3">{children}</div>

            <div className="flex items-center justify-end gap-2 rounded-b-2xl border-t border-slate-200 bg-slate-50 px-4 py-2">
              <button type="button" onClick={dismiss} disabled={submitting} className="min-h-11 shrink-0 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">
                {reviewing ? "Back to edit" : "Cancel"}
              </button>
              <button
                key={reviewing ? "confirm" : "review"}
                type={reviewing ? "button" : "submit"}
                onClick={reviewing ? onConfirm : undefined}
                disabled={submitting}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-wait disabled:opacity-60 [&>svg]:shrink-0"
              >
                {submitting ? <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : submitIcon || <ShieldAlert size={18} strokeWidth={2} aria-hidden="true" />}
                {submitting ? submittingLabel : reviewing ? "Confirm and submit" : "Review report"}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </ModalPortal>
  );
}
