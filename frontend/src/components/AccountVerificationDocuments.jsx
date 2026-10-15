import { useEffect, useEffectEvent, useRef, useState } from "react";
import API from "../utils/api";
import { ID_DOCUMENT_TYPES, SUPPORTING_DOCUMENT_TYPES } from "../data/kycDocumentTypes";
import { fileToBase64, validateDocumentImageFile } from "../utils/cameraKyc";
import { validateSupportingDocumentFile } from "../utils/fileValidation";
import { verificationGuidance } from "../utils/verificationStatus";
import { getSocket } from "../utils/socket";

const labels = { verified: "Approved", legacy_approved: "Previously approved", pending_review: "Pending Review", rejected: "Rejected", reupload_required: "Needs replacement",
  queued: "Waiting for screening", processing: "Screening", retry_wait: "Screening retry pending", not_submitted: "Not submitted" };

export default function AccountVerificationDocuments({ verification, onRefresh, onSelfie, disabled = false, stale = false }) {
  const [editing, setEditing] = useState("");
  const [type, setType] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const refresh = useEffectEvent(() => { if (!inFlight.current && !disabled) void onRefresh(); });
  const available = Boolean(verification);
  useEffect(() => {
    if (!available) return;
    let debounce;
    const schedule = () => { if (document.visibilityState === "hidden") return; clearTimeout(debounce); debounce = setTimeout(refresh, 150); };
    const decision = notification => { if (notification?.event?.startsWith("verification.document_")) schedule(); };
    const socket = getSocket();
    window.addEventListener("focus", schedule); window.addEventListener("online", schedule);
    document.addEventListener("visibilitychange", schedule);
    socket.on("notification:new", decision); socket.on("connect", schedule);
    const interval = setInterval(schedule, 30_000);
    if (window.location.hash === "#verification-status") document.getElementById("verification-status")?.scrollIntoView({ block: "start" });
    return () => { clearTimeout(debounce); clearInterval(interval); window.removeEventListener("focus", schedule); window.removeEventListener("online", schedule);
      document.removeEventListener("visibilitychange", schedule); socket.off("notification:new", decision); socket.off("connect", schedule); };
  }, [available]);
  if (!verification) return null;
  const guidance = verificationGuidance(verification);
  const retrySetup = async document => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await API.kycReplaceDocument("id", { document_revision: document.documentRevision, id_type: document.selectedDocCategory });
      if (result.success !== true) throw new Error("ID face setup was not confirmed. Refresh status and retry.");
      setMessage("Saved ID face setup completed. Continue selfie verification when its document checks are ready.");
      await onRefresh();
    } catch (failure) { setError(failure.message || "ID face setup is unavailable. Retry when the service recovers."); await onRefresh(); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const submit = async event => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      if (!type || !file) throw new Error("Choose the document type and its replacement file.");
      if (editing === "id") await validateDocumentImageFile(file); else validateSupportingDocumentFile(file);
      const image = await fileToBase64(file);
      const result = await API.kycReplaceDocument(editing, editing === "id"
        ? { id_image_base64: image, id_image_mime: file.type, id_type: type }
        : { doc_image_base64: image, doc_image_mime: file.type, supporting_doc_type: type });
      if (result.success !== true) throw new Error(result.message || "The replacement was not confirmed. Refresh status before retrying.");
      setEditing(""); setFile(null); setMessage(result.message || "Document saved. Approval is pending.");
      await onRefresh();
    } catch (failure) { setError(failure.message || "Upload failed. Keep the file selected and retry."); await onRefresh(); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <section id="verification-status" aria-label="Verification Status" data-account-verification className="scroll-mt-24 space-y-4">
    <div className="space-y-2" role="status" aria-live="polite">
      <p className="font-semibold text-slate-800">{guidance.title}</p>
      <p className="text-sm text-slate-600">{guidance.instruction}</p>
      {stale && <p className="text-sm text-amber-900">Showing the last checked status. Refresh Status when the connection is available. Saved documents and completed checks are preserved. If your session expired, <a href="/signin" className="font-semibold underline underline-offset-2">sign in again</a>.</p>}
    </div>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="font-semibold text-slate-700">Account access</dt><dd className="capitalize text-slate-600">{verification.accountStatus}</dd></div>
      <div><dt className="font-semibold text-slate-700">Email</dt><dd className="text-slate-600">{verification.emailVerified ? "Verified" : "Verification required"}</dd></div>
      <div><dt className="font-semibold text-slate-700">Selfie</dt><dd className="text-slate-600">{verification.selfieVerified ? "Verified" : "Verification required"}</dd></div>
      <div><dt className="font-semibold text-slate-700">Booking access</dt><dd className="text-slate-600">{verification.bookingEligible ? "Available" : "Locked until all required approvals are complete"}</dd></div>
      {verification.ownerAccount && <div><dt className="font-semibold text-slate-700">Listing access</dt><dd className="text-slate-600">{verification.listingEligible ? "Available" : "Locked until all required approvals are complete"}</dd></div>}
    </dl>
    {!verification.bookingEligible && verification.accountStatus === "active" && verification.emailVerified && <p className="text-sm text-slate-600">You can browse vehicles and manage your account while documents are reviewed.</p>}
    {verification.documents.map(document => <div key={document.docType} className="border-t border-slate-200 pt-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><p className="font-semibold text-slate-800">{document.docType === "id" ? "Government ID" : "Business document"}</p>
          <p className="break-words text-sm text-slate-600">{document.selectedDocCategory || "Required document"}: {labels[document.status] || "Check status"}</p>
          {document.reference && <p className="mt-1 text-sm text-slate-600">Document saved privately. {document.status === "pending_review" ? "Awaiting admin review; no reupload needed." : "Its reference is restored after refresh."}</p>}
          {document.reason && <p className="mt-1 break-words text-sm text-slate-600">{document.reason}</p>}</div>
        <button type="button" disabled={disabled || busy || editing === document.docType} onClick={() => { setEditing(document.docType); setType(document.selectedDocCategory || ""); setFile(null); setError(""); setMessage(""); }}
          className="rp-btn-secondary min-h-11 shrink-0 px-4 py-2 text-sm disabled:opacity-60">Replace {document.docType === "id" ? "ID" : "business document"}</button>
      </div>
      {document.docType === "id" && !verification.selfieVerified && document.reference && <div className="mt-3 space-y-2"><p className="text-sm text-slate-600">{document.faceSetupRequired ? "Your ID is saved. Its face setup needs another attempt." : "You can reuse the saved ID if face setup needs another attempt."}</p>
        <button type="button" disabled={disabled || busy} onClick={() => retrySetup(document)} className="rp-btn-primary min-h-11 px-4 py-2 text-sm disabled:opacity-60">Retry saved ID setup</button></div>}
    </div>)}
    {editing && <form onSubmit={submit} className="space-y-3 border-t border-slate-200 pt-4">
      <p className="text-sm text-slate-600">Replacing this document pauses restricted actions until it is reviewed.{editing === "id" ? " A new ID also requires selfie verification." : " Your ID and selfie results are preserved."}</p>
      <label className="block text-sm font-semibold text-slate-700" htmlFor="account-document-type">Document type</label>
      <select id="account-document-type" value={type} onChange={event => setType(event.target.value)} disabled={busy || disabled} required
        className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
        <option value="">Select document type</option>{(editing === "id" ? ID_DOCUMENT_TYPES : SUPPORTING_DOCUMENT_TYPES).map(value => <option key={value}>{value}</option>)}
      </select>
      <label className="block text-sm font-semibold text-slate-700" htmlFor="account-document-file">Replacement file</label>
      <input key={editing} id="account-document-file" type="file" accept={editing === "id" ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,application/pdf"}
        onChange={event => setFile(event.target.files?.[0] || null)} disabled={busy || disabled} required className="min-h-11 w-full min-w-0 text-sm text-slate-700" />
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={busy || disabled} className="rp-btn-primary min-h-11 px-4 py-2 text-sm disabled:opacity-60">{busy ? "Saving document..." : "Submit replacement"}</button>
        <button type="button" disabled={busy} onClick={() => { setEditing(""); setFile(null); }} className="rp-btn-secondary min-h-11 px-4 py-2 text-sm">Cancel replacement</button></div>
    </form>}
    {!verification.selfieVerified && verification.documents.some(document => document.identityReadyForSelfie) && <button type="button" disabled={busy || disabled} onClick={onSelfie}
      className="rp-btn-primary min-h-11 px-4 py-2 text-sm disabled:opacity-60">Continue selfie verification</button>}
    {busy && <p role="status" className="text-sm text-slate-600">Saving the document. Keep this page open.</p>}
    {message && <p role="status" className="text-sm text-green-800">{message}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
