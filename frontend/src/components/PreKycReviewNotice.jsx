import { useCallback, useEffect, useState } from "react";
import { clearPreKycSessionToken, getPreKycStatus, requestManualIdReview } from "../utils/kycApi";
import { registrationDocumentGuidance, needsManualIdReview } from "../utils/registrationVerification";
import RequestFeedback from "./RequestFeedback";

const ACTIVE_SCREENING_POLL_MS = 1_250;
const RETRY_POLL_MS = 15_000;
const MANUAL_REVIEW_POLL_MS = 45_000;

const nextPollDelay = (documents) => {
  if (documents.length === 0) return ACTIVE_SCREENING_POLL_MS;
  if (documents.some((document) => ["queued", "processing"].includes(document.status))) return ACTIVE_SCREENING_POLL_MS;
  if (documents.some((document) => document.status === "retry_wait")) return RETRY_POLL_MS;
  if (documents.some((document) => document.status === "pending_review")) return MANUAL_REVIEW_POLL_MS;
  return 0;
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

export default function PreKycReviewNotice({ email, role = "user", enabled, onResubmit, onCorrectDetails, onIdStatus, onDocumentsChange, refreshKey = 0, ignoreSupportingDocument = false,
  ignoreIdDocument = false, idRevision = "", supportingRevision = "", onVerificationChange, selfieComplete = false }) {
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [requestingReview, setRequestingReview] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const requestReview = async document => {
    if (requestingReview) return;
    setRequestingReview(true); setReviewError("");
    try { await requestManualIdReview(email, role, document.documentRevision); refresh(); }
    catch (failure) { setReviewError(failure.message || "We couldn't request manual verification. Please retry."); }
    finally { setRequestingReview(false); }
  };
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
        const nextDocuments = (result.documents || []).filter((document) => {
          if (ignoreSupportingDocument && document.docType === "supporting") return false;
          if (ignoreIdDocument && document.docType === "id") return false;
          const expectedRevision = document.docType === "id" ? idRevision : supportingRevision;
          return !expectedRevision || document.documentRevision === expectedRevision;
        });
        setDocuments(nextDocuments);
        onDocumentsChange?.(nextDocuments);
        onVerificationChange?.(nextDocuments.some(document => document.docType === "id" && document.identityReadyForSelfie)
          && result.selfieVerified === true);
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
  }, [email, role, enabled, onIdStatus, onDocumentsChange, onVerificationChange, refreshSignal, refreshKey, ignoreSupportingDocument, ignoreIdDocument, idRevision, supportingRevision]);
  if (!enabled) return null;

  const expectedDocuments = (role === "owner"
    ? [{ type: "supporting", label: "Supporting document" }, { type: "id", label: "Government ID" }]
    : [{ type: "id", label: "Government ID" }]).filter(({ type }) =>
      !(ignoreSupportingDocument && type === "supporting") && !(ignoreIdDocument && type === "id"));
  const documentsByType = new Map(documents
    .filter((document) => !(ignoreSupportingDocument && document.docType === "supporting"))
    .map((document) => [document.docType, document]));
  const showInitialLoading = loading && documents.length === 0 && !error;

  return <div className="space-y-2 text-sm">
    <RequestFeedback
      loading={showInitialLoading}
      label="Checking document status..."
      error={error?.message || ""}
      onRetry={error?.restart ? restartVerification : refresh}
      retryLabel={error?.restart ? "Restart verification" : "Try again"}
    />
    {!showInitialLoading && !error && <div className="space-y-2" aria-live="polite" aria-atomic="true">
      {expectedDocuments.map(({ type, label }) => {
        const document = documentsByType.get(type);
        const status = document?.status || "not_uploaded";
        const correction = ["reupload_required", "rejected"].includes(status) || document?.automatedScreening?.outcome === "correction_needed";
        const passed = !correction && (document?.identityReadyForSelfie || status === "verified"
          || (type === "supporting" && document?.automatedScreening?.outcome === "passed"));
        const detailsMismatch = correction && ["IDENTITY_DATA_MISMATCH", "REGISTRATION_DATA_INCOMPLETE"].includes(document?.reasonCode);
        return <div key={type} data-document-result={type} className="space-y-1">
          <p className={`break-words font-medium ${passed ? "text-emerald-800" : correction ? "text-rose-800" : "text-slate-700"}`}>
            {registrationDocumentGuidance(document, label, selfieComplete)}
          </p>
          {correction && <div className="flex flex-wrap gap-x-4">
            {detailsMismatch && <button type="button" onClick={() => onCorrectDetails?.(type)} className="min-h-11 font-semibold text-blue-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Correct registration details</button>}
            <button type="button" onClick={() => onResubmit?.(type)} className="min-h-11 font-semibold text-blue-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Upload another document</button>
          </div>}
          {needsManualIdReview(document) && <div className="flex flex-wrap gap-x-4">
            {!document.manualReviewRequested && <button type="button" disabled={requestingReview} onClick={() => void requestReview(document)} className="min-h-11 font-semibold text-blue-700 underline underline-offset-2 disabled:opacity-50 focus-visible:outline focus-visible:outline-2">{requestingReview ? "Requesting verification..." : "Request manual verification"}</button>}
            <button type="button" onClick={() => onResubmit?.(type)} className="min-h-11 font-semibold text-blue-700 underline underline-offset-2 focus-visible:outline focus-visible:outline-2">Upload a clearer ID</button>
          </div>}
        </div>;
      })}
      {documents.some((document) => document.status === "pending_review" && !document.identityReadyForSelfie
        && document.automatedScreening?.outcome !== "passed") && <button type="button" onClick={refresh} disabled={loading}
          className="min-h-11 font-semibold text-blue-700 underline underline-offset-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Refresh status</button>}
    </div>}
    {reviewError && <p role="alert" className="text-rose-800">{reviewError}</p>}
  </div>;
}
