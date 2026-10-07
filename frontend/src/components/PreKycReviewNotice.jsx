import { useCallback, useEffect, useState } from "react";
import { clearPreKycSessionToken, getPreKycStatus } from "../utils/kycApi";
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

const reviewGuidance = (status, label, document) => {
  if (status === "rejected") return document?.reason || `${label} was rejected. Upload a corrected document.`;
  if (["queued", "processing"].includes(status)) return document?.docType === "id"
    ? "Checking your ID type and registration details..." : "Checking your business document and registration details...";
  if (status === "retry_wait") return "Screening is taking longer than expected. We will retry automatically.";
  if (document?.reasonCode === "DOCUMENT_TYPE_MISMATCH") return document.docType === "id"
    ? "The uploaded ID does not match the selected type. Select the correct type or upload another ID."
    : "The uploaded business document does not match the selected type. Select the correct type or upload another document.";
  if (document?.docType === "id" && document?.identityReadyForSelfie) return "ID check passed. You can now proceed to selfie verification.";
  if (status === "verified") return `${label} approved. You can continue.`;
  if (document?.docType === "supporting" && document?.automatedScreening?.outcome === "passed") return "Business document check passed. You can continue.";
  if (["pending_review", "reupload_required"].includes(status)) return document?.reason
    || `${label} needs admin review before you can continue.`;
  return `Upload ${label.toLowerCase()} to start its review.`;
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
  ignoreIdDocument = false, idRevision = "", supportingRevision = "" }) {
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
        const nextDocuments = (result.documents || []).filter((document) => {
          if (ignoreSupportingDocument && document.docType === "supporting") return false;
          if (ignoreIdDocument && document.docType === "id") return false;
          const expectedRevision = document.docType === "id" ? idRevision : supportingRevision;
          return !expectedRevision || document.documentRevision === expectedRevision;
        });
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
  }, [email, role, enabled, onIdStatus, onDocumentsChange, refreshSignal, refreshKey, ignoreSupportingDocument, ignoreIdDocument, idRevision, supportingRevision]);
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
            {reviewGuidance(status, label, document)}
          </p>
          {correction && <div className="flex flex-wrap gap-x-4">
            {detailsMismatch && <button type="button" onClick={() => onCorrectDetails?.(type)} className="min-h-11 font-semibold text-blue-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Correct registration details</button>}
            <button type="button" onClick={() => onResubmit?.(type)} className="min-h-11 font-semibold text-blue-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Upload another document</button>
          </div>}
        </div>;
      })}
      {documents.some((document) => document.status === "pending_review" && !document.identityReadyForSelfie
        && document.automatedScreening?.outcome !== "passed") && <button type="button" onClick={refresh} disabled={loading}
          className="min-h-11 font-semibold text-blue-700 underline underline-offset-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Refresh status</button>}
    </div>}
  </div>;
}
