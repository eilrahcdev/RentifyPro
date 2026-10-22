import { useEffect, useRef } from "react";

export default function RegistrationDocumentActions({ upload, docType, revision, status, busy, onCancel, children }) {
  const active = upload.active?.docType === docType;
  const cancelling = active && upload.active.phase === "cancelling";
  const notice = upload.notice?.docType === docType ? upload.notice : null;
  const canCancel = active || (notice?.error && notice.attemptId) || (revision && ["queued", "processing", "retry_wait"].includes(status));
  const actionsRef = useRef(null);
  useEffect(() => {
    if (!active || !actionsRef.current) return;
    const bounds = actionsRef.current.getBoundingClientRect();
    const footer = document.querySelector(".rp-registration-actions");
    const visibleBottom = footer && getComputedStyle(footer).position === "fixed" ? footer.getBoundingClientRect().top : window.innerHeight;
    if (bounds.bottom > visibleBottom - 16 || bounds.top < 16) actionsRef.current.scrollIntoView({ block: "center", behavior: "instant" });
  }, [active]);
  useEffect(() => { if (notice && !notice.error) actionsRef.current?.lastElementChild?.focus({ preventScroll: true }); }, [notice]);
  return <div className="min-w-0 space-y-2" data-document-actions={docType}>
    <div ref={actionsRef} className={`grid min-w-0 items-stretch gap-2 ${canCancel ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-1"}`}>
      {canCancel && <button type="button" onClick={() => onCancel(docType, revision)}
        disabled={cancelling || (busy && !active)}
        className="rp-btn-secondary min-h-11 min-w-0 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={`Cancel ${docType === "id" ? "ID" : "business document"} ${active && !cancelling ? "upload" : "check"}`}>
        {cancelling ? "Cancelling…" : active ? "Cancel upload" : "Cancel check"}
      </button>}
      {children}
    </div>
    {notice && <p role={notice.error ? "alert" : "status"} className={`break-words text-sm ${notice.error ? "text-red-600" : "text-slate-600"}`}>{notice.message}</p>}
  </div>;
}
