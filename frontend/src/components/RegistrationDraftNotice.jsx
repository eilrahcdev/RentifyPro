import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const DRAFT_MESSAGES = {
  new: {
    title: "Draft saved in this tab",
    description: "Expires after 60 minutes of inactivity. Passwords, consent, and verification files are not saved.",
  },
  restored: {
    title: "Draft restored",
    description: "Your details expire after 60 minutes of inactivity. Re-enter your password, accept the terms again, and repeat document and selfie verification.",
  },
  expired: {
    title: "Draft expired",
    description: "Your saved details were cleared after 60 minutes of inactivity. Please start again.",
  },
  restarted: {
    title: "Draft cleared",
    description: "You can start a new registration. Drafts expire after 60 minutes of inactivity.",
  },
  unavailable: {
    title: "Draft saving unavailable",
    description: "Keep this page open to avoid losing your details. The form expires after 60 minutes of inactivity.",
  },
};

export default function RegistrationDraftNotice({ draft, busy }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const keepRef = useRef(null);
  const wasWarning = useRef(false);
  const previousFocus = useRef(null);

  useEffect(() => {
    if (draft.warning && !wasWarning.current) {
      previousFocus.current = document.activeElement;
      keepRef.current?.focus({ preventScroll: true });
    } else if (!draft.warning && wasWarning.current && previousFocus.current?.isConnected) {
      previousFocus.current.focus({ preventScroll: true });
    }
    wasWarning.current = draft.warning;
  }, [draft.warning]);

  if (draft.completed) return null;

  const noticeState = !draft.storageAvailable
    ? "unavailable"
    : ["restored", "expired", "restarted"].includes(draft.status) ? draft.status : "new";
  const notice = DRAFT_MESSAGES[noticeState];

  return (
    <div className="mb-5 space-y-3 text-sm" data-registration-draft data-draft-state={noticeState}>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0 flex-1 basis-56">
          <p className={`font-semibold ${noticeState === "expired" ? "text-amber-800" : "text-slate-800"}`}>{notice.title}</p>
          <p className="mt-1 text-slate-600">{notice.description}</p>
        </div>
        <button type="button" disabled={busy} onClick={() => setConfirmReset(true)} className="shrink-0 font-semibold text-blue-700 underline underline-offset-2 disabled:opacity-50">Start over</button>
      </div>
      {draft.warning && createPortal(
        <div className="rp-floating-alert-position">
          <div className="rp-floating-alert" role="region" aria-label="Registration draft expiry">
            <p role="alert">Your registration draft is about to expire.</p>
            <p className="mt-1 font-normal text-slate-600">
              {draft.remainingSeconds > 0
                ? <>Your entered details will be cleared in <span role="timer" aria-live="off">{Math.ceil(draft.remainingSeconds / 60)} {draft.remainingSeconds > 60 ? "minutes" : "minute"}</span>.</>
                : "Waiting for your current request to finish before clearing your details."}
            </p>
            <button ref={keepRef} type="button" onClick={draft.keepProgress} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">Keep my progress</button>
          </div>
        </div>, document.body
      )}
      {confirmReset && (
        <div className="rounded-xl border border-slate-300 p-3" role="group" aria-label="Confirm starting over">
          <p>Clear your entered details and restart registration?</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" disabled={busy} onClick={draft.startOver} className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-50">Clear and start over</button>
            <button type="button" onClick={() => setConfirmReset(false)} className="rounded-lg border border-slate-300 px-3 py-2 font-semibold">Keep editing</button>
          </div>
        </div>
      )}
    </div>
  );
}
