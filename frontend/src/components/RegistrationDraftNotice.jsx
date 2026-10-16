import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const DRAFT_MESSAGES = {
  new: {
    title: "Registration draft ready",
    description: "Details and uploads are saved privately on the backend. Drafts expire after 60 minutes without activity, up to 72 hours. Passwords and consent are never saved.",
  },
  restored: {
    title: "Draft restored",
    description: "The backend checked your saved details, available uploads, and current verification results. Re-enter your password before submitting and accept the terms again.",
  },
  expired: {
    title: "Draft expired",
    description: "Your draft is no longer recoverable. Cancel this draft, then begin a new registration. Your entered details remain visible until you cancel.",
  },
  restarted: {
    title: "Draft cleared",
    description: "You can start a new registration. Drafts expire after 60 minutes of inactivity.",
  },
  unavailable: {
    title: "Draft saving unavailable",
    description: "Keep this page open and retry. Changes have not been confirmed by the backend.",
  },
};

Object.assign(DRAFT_MESSAGES, {
  loading: { title: "Checking saved progress...", description: "Waiting for the backend to validate your registration draft." },
  saving: { title: "Saving progress...", description: "Waiting for the backend to confirm your changes." },
  saved: { title: "Progress saved", description: "Your latest details and step were saved. Passwords and consent remain only on this page." },
  unsaved: { title: "Changes waiting to save", description: "Keep this page open until progress is saved." },
  conflict: { title: "Progress changed in another tab", description: "Recover the latest saved draft before editing. Recovery replaces the details shown here." },
});

export default function RegistrationDraftNotice({ draft, busy: working, onNavigateToSignIn, onNavigateToHome }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const busy = working || draft.cancelling;
  const cancelRef = useRef(null);
  const keepEditingRef = useRef(null);
  useEffect(() => { if (confirmReset) keepEditingRef.current?.focus(); }, [confirmReset]);
  const dismissCancellation = () => { setConfirmReset(false); cancelRef.current?.focus(); };
  const cancelRegistration = async () => {
    if (await draft.cancel()) onNavigateToHome();
  };
  const keepRef = useRef(null);
  const wasWarning = useRef(false);
  const previousFocus = useRef(null);
  const completedAction = useRef(null);
  const completed = Boolean(draft.registrationComplete || draft.completed);
  useEffect(() => { if (completed) completedAction.current?.focus(); }, [completed]);

  useEffect(() => {
    if (draft.warning && !wasWarning.current) {
      previousFocus.current = document.activeElement;
      keepRef.current?.focus({ preventScroll: true });
    } else if (!draft.warning && wasWarning.current && previousFocus.current?.isConnected) {
      previousFocus.current.focus({ preventScroll: true });
    }
    wasWarning.current = draft.warning;
  }, [draft.warning]);

  if (draft.registrationComplete || draft.completed) return <div role="status" data-registration-complete className="mt-4 space-y-3 rounded-2xl border border-green-200 bg-green-50 p-4">
    <h2 className="font-semibold text-green-900">Registration Complete</h2>
    <p className="text-sm text-green-900">Your account exists and your email is verified. You can sign in, browse vehicles, and manage your account.</p>
    <p className="text-sm font-semibold text-green-900">{draft.completionStatus === "approved" ? "Verification Complete" : draft.completionStatus ? "Verification Pending" : "Check your verification status after signing in"}</p>
    <p className="text-sm text-green-900">Booking and restricted owner listing actions require all applicable document approvals. Saved documents and completed selfie checks remain available after signing in.</p>
    <button ref={completedAction} type="button" onClick={() => { draft.complete(); onNavigateToSignIn(); }} className="rp-btn-primary px-4 py-2">Sign in</button>
  </div>;

  const noticeState = draft.status in DRAFT_MESSAGES ? draft.status : "new";
  const notice = DRAFT_MESSAGES[noticeState];
  const routine = ["new", "restored", "restarted", "saving", "saved", "unsaved"].includes(noticeState);
  const routineLabel = ["saved", "restored"].includes(noticeState) ? "Progress saved"
    : ["saving", "unsaved"].includes(noticeState) ? "Saving progress..." : "Progress saves automatically";

  return (
    <div className="mb-5 space-y-3 text-sm" data-registration-draft data-draft-state={noticeState}>
      {routine ? <div className="flex items-start justify-between gap-3 text-slate-600">
        <details className="min-w-0 flex-1">
          <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-slate-600 underline decoration-slate-300 underline-offset-4 sm:text-sm">{routineLabel}</summary>
          <div className="max-w-prose space-y-1 pb-3 text-sm text-slate-600">
            <p>Details and uploads save automatically. Passwords and consent stay only on this page.</p>
            <p>Drafts expire after 60 minutes without activity, up to 72 hours.</p>
            {draft.savedAt && <p>Last saved at {new Date(draft.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</p>}
          </div>
        </details>
        <button ref={cancelRef} type="button" disabled={busy} onClick={() => setConfirmReset(true)} className="min-h-11 shrink-0 text-xs font-semibold text-rose-800 underline underline-offset-2 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 sm:text-sm">Cancel registration</button>
      </div> : <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0 flex-1">
          <p className={`font-semibold ${noticeState === "expired" ? "text-amber-800" : "text-slate-800"}`}>{notice.title}</p>
          {["new", "restored", "restarted"].includes(noticeState) ? (
            <details className="rp-draft-details">
              <summary>Expiry and saved details</summary>
              <p className="mt-1 text-slate-600">{notice.description}</p>
            </details>
          ) : <p className="mt-1 text-slate-600">{notice.description}</p>}
          {draft.message && <p className="mt-1 break-words text-amber-800">{draft.message}</p>}
          {draft.savedAt && ["saved", "restored"].includes(noticeState) && <p className="mt-1 text-slate-600">Saved at {new Date(draft.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
        </div>
        {["unavailable", "conflict"].includes(noticeState) && <button type="button" disabled={busy} onClick={draft.retry} className="min-h-11 font-semibold text-blue-700 underline underline-offset-2 disabled:opacity-50">{noticeState === "conflict" ? "Recover saved progress" : "Retry saving and recovery"}</button>}
        <button ref={cancelRef} type="button" disabled={busy || noticeState === "loading"} onClick={() => setConfirmReset(true)} className="shrink-0 min-h-11 font-semibold text-rose-800 underline underline-offset-2 disabled:opacity-50 focus-visible:outline focus-visible:outline-2">Cancel registration</button>
      </div>}
      {draft.warning && createPortal(
        <div className="rp-floating-alert-position">
          <div className="rp-floating-alert" role="region" aria-label="Registration draft expiry">
            <p role="alert">Your registration draft is about to expire.</p>
            <p className="mt-1 font-normal text-slate-600">
              {draft.remainingSeconds > 0
                ? <>Saved recovery expires in <span role="timer" aria-live="off">{Math.ceil(draft.remainingSeconds / 60)} {draft.remainingSeconds > 60 ? "minutes" : "minute"}</span>.</>
                : "Saved recovery has expired. Your entered details remain visible until you cancel registration."}
            </p>
            <button ref={keepRef} type="button" onClick={draft.keepProgress} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">Keep my progress</button>
          </div>
        </div>, document.body
      )}
      {confirmReset && (
        <div className="rounded-xl border border-slate-300 p-3" role="group" aria-label="Confirm cancellation" onKeyDown={event => { if (event.key === "Escape" && !busy) dismissCancellation(); }}>
          <p className="font-semibold">Cancel registration and discard saved progress?</p>
          <p className="mt-1 text-slate-700">Your entered details, temporary document uploads, and verification progress will be discarded. You will return to the home page. File cleanup may finish in the background.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" disabled={busy} onClick={() => void cancelRegistration()} className="min-h-11 rounded-lg bg-rose-800 px-3 py-2 font-semibold text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">{draft.cancelling ? "Cancelling..." : "Cancel registration"}</button>
            <button ref={keepEditingRef} type="button" disabled={busy} onClick={dismissCancellation} className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-semibold focus-visible:outline focus-visible:outline-2">Keep registering</button>
          </div>
        </div>
      )}
    </div>
  );
}
