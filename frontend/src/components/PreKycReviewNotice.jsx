import { useCallback, useEffect, useState } from "react";
import { clearPreKycSessionToken, getPreKycStatus } from "../utils/kycApi";
import { documentStatusLabel } from "../utils/workflowStatus";
import RequestFeedback from "./RequestFeedback";

const ACTIVE_SCREENING_POLL_MS = 2_500;
const RETRY_POLL_MS = 15_000;
const MANUAL_REVIEW_POLL_MS = 45_000;
const REVIEW_IN_PROGRESS = new Set(["queued", "processing", "retry_wait", "pending_review"]);

const nextPollDelay = (documents) => {
  if (documents.length === 0) return ACTIVE_SCREENING_POLL_MS;
  if (documents.some((document) => ["queued", "processing"].includes(document.status))) return ACTIVE_SCREENING_POLL_MS;
  if (documents.some((document) => document.status === "retry_wait")) return RETRY_POLL_MS;
  if (documents.some((document) => document.status === "pending_review")) return MANUAL_REVIEW_POLL_MS;
  return 0;
};

const reviewGuidance = (status, label, document) => {
  if (document?.docType === "id" && document?.identityReadyForSelfie) {
    return "Your personal details match this ID. You can continue to the selfie while document review finishes.";
  }
  if (status === "queued") return `${label} was uploaded. Automated checks will start shortly.`;
  if (status === "processing") return document?.docType === "id"
    ? "We are comparing the name and personal details on your ID with your registration."
    : `${label} is being screened now.`;
  if (status === "retry_wait") return "Screening is taking longer than expected. We will retry automatically.";
  if (status === "pending_review") return "A reviewer is checking this document. Refresh the status before submitting your registration.";
  if (status === "verified") return "Approved. Continue once all verification steps are complete.";
  if (status === "reupload_required") return "We need a clearer or corrected document before you can continue.";
  if (status === "rejected") return "A reviewer could not approve this document. You can upload a corrected document and try again.";
  return `Upload ${label.toLowerCase()} to start its review.`;
};

const statusTone = (status) => {
  if (status === "verified") return "bg-emerald-50 text-emerald-700";
  if (["reupload_required", "rejected"].includes(status)) return "bg-rose-50 text-rose-700";
  if (REVIEW_IN_PROGRESS.has(status)) return "bg-amber-50 text-amber-800";
  return "bg-slate-100 text-slate-600";
};

const documentTypeLabel = (value, fallback) => {
  const label = String(value || "").trim();
  return label && label.length <= 80 ? label : fallback;
};

const toReviewError = (failure) => {
  const status = Number(failure?.status);
  if (status === 401 || status === 403) {
    return {
      message: "Your secure document-review session has ended. Restart verification to upload your documents again. Your saved form details will remain available.",
      restart: true,
    };
  }
  if (status === 429) {
    return {
      message: "Document status checks are temporarily limited. Wait a moment, then try again.",
      restart: false,
    };
  }
  return {
    message: "We couldn't update your document status right now. This does not mean your document was rejected. Please try again.",
    restart: false,
  };
};

export default function PreKycReviewNotice({ email, role = "user", enabled, onResubmit, onCorrectDetails, onIdStatus, onDocumentsChange, refreshKey = 0, ignoreSupportingDocument = false }) {
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const refresh = useCallback(() => {
    setError(null);
    setRefreshSignal((value) => value + 1);
  }, []);
  const restartVerification = useCallback(() => {
    clearPreKycSessionToken(email, role);
    window.location.reload();
  }, [email, role]);

  useEffect(() => {
    if (!enabled || !email) return;
    let active = true;
    let inFlight = false;
    let timer = null;
    const read = async () => {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
      let pollDelay = 0;
      try {
        const result = await getPreKycStatus(email, role);
        if (!active) return;
        const nextDocuments = (result.documents || []).filter((document) =>
          !(ignoreSupportingDocument && document.docType === "supporting"));
        setDocuments(nextDocuments);
        onDocumentsChange?.(nextDocuments);
        setError(null);
        const id = nextDocuments.find((document) => document.docType === "id");
        if (id) onIdStatus?.(id.status, id);
        pollDelay = nextPollDelay(nextDocuments);
      } catch (failure) {
        if (active) setError(toReviewError(failure));
      } finally {
        inFlight = false;
        if (active) {
          setLoading(false);
          if (pollDelay) timer = window.setTimeout(read, pollDelay);
        }
      }
    };
    void read();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [email, role, enabled, onIdStatus, onDocumentsChange, refreshSignal, refreshKey, ignoreSupportingDocument]);
  if (!enabled) return null;

  const expectedDocuments = role === "owner"
    ? [{ type: "supporting", label: "Supporting document" }, { type: "id", label: "Government ID" }]
    : [{ type: "id", label: "Government ID" }];
  const documentsByType = new Map(documents
    .filter((document) => !(ignoreSupportingDocument && document.docType === "supporting"))
    .map((document) => [document.docType, document]));
  const showInitialLoading = loading && documents.length === 0 && !error;

  return <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-slate-900">Document review</p>
        <p className="mt-0.5 text-sm text-slate-600">Registration unlocks after every required document is approved.</p>
      </div>
      {!error && <button type="button" onClick={refresh} disabled={loading} className="text-sm font-semibold text-blue-700 underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        {loading ? "Checking status..." : "Refresh status"}
      </button>}
    </div>
    <RequestFeedback
      loading={showInitialLoading}
      label="Checking document status..."
      error={error?.message || ""}
      onRetry={error?.restart ? restartVerification : refresh}
      retryLabel={error?.restart ? "Restart verification" : "Try again"}
    />
    {!showInitialLoading && <div className="space-y-2" aria-live="polite">
      {expectedDocuments.map(({ type, label }) => {
        const document = documentsByType.get(type);
        const status = document?.status || "not_uploaded";
        const typeMismatch = status === "reupload_required"
          && document?.reasonCode === "DOCUMENT_TYPE_MISMATCH";
        const supportingDetailsMismatch = type === "supporting"
          && status === "pending_review"
          && document?.reasonCode === "IDENTITY_DATA_MISMATCH";
        const idDetailsMismatch = type === "id"
          && status === "reupload_required"
          && ["IDENTITY_DATA_MISMATCH", "REGISTRATION_DATA_INCOMPLETE"].includes(document?.reasonCode);
        const expectedType = documentTypeLabel(document?.selectedDocCategory, label);
        const detectedType = documentTypeLabel(document?.docCategory, "Unknown");
        return <div key={type} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-slate-900">{label}</p>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(status)}`}>{documentStatusLabel(status)}</span>
          </div>
          <p className="mt-2 text-slate-600">{reviewGuidance(status, label, document)}</p>
          {typeMismatch && <dl className="mt-3 grid gap-2 rounded-lg bg-rose-50 p-3 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs font-semibold text-rose-700">Expected document</dt>
              <dd className="mt-0.5 break-words font-semibold text-rose-950">{expectedType}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-semibold text-rose-700">Detected document</dt>
              <dd className="mt-0.5 break-words font-semibold text-rose-950">{detectedType}</dd>
            </div>
          </dl>}
          {["pending_review", "reupload_required", "rejected"].includes(status) && document?.reason && <p className={`mt-2 break-words ${status === "pending_review" ? "text-amber-900" : "text-rose-700"}`}><span className="font-semibold">Next step:</span> {document.reason}</p>}
          {supportingDetailsMismatch && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            <button type="button" onClick={() => onCorrectDetails?.(type)} className="font-semibold text-blue-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Check registration details</button>
            <button type="button" onClick={() => onResubmit?.(type)} className="font-semibold text-blue-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Upload another document</button>
          </div>}
          {idDetailsMismatch && <button type="button" onClick={() => onCorrectDetails?.(type)} className="mt-2 block font-semibold text-blue-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Check registration details</button>}
          {["reupload_required", "rejected"].includes(status) && <button type="button" onClick={() => onResubmit?.(type)} className="mt-2 font-semibold text-blue-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Upload a new document</button>}
        </div>;
      })}
    </div>}
  </div>;
}
