import { useRef, useState } from "react";
import API from "../utils/api";
import { BOOKING_REPORT_CATEGORY_GROUPS } from "../data/reportCategories";
import ReportCategorySelect from "./ReportCategorySelect";
import ReportModalFrame from "./ReportModalFrame";
import EvidenceFilePicker from "./EvidenceFilePicker";
import ReportReview from "./ReportReview";
import ReportSubmissionError from "./ReportSubmissionError";
import AutoResizeTextarea from "./AutoResizeTextarea";
import useReportSubmission from "../hooks/useReportSubmission";
import { validateReportEvidenceFiles } from "../utils/fileValidation";
import { getReportCategoryLabel, validateReportCategory, validateReportDescription } from "../utils/reportValidation";

export default function ReportIssueModal(props) {
  return props.booking ? <BookingReportForm key={`${props.booking._id}-${props.perspective || "renter"}`} {...props} /> : null;
}

function BookingReportForm({ booking, perspective = "renter", onClose, onSubmitted }) {
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [evidenceError, setEvidenceError] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const categoryRef = useRef(null);
  const descriptionRef = useRef(null);
  const evidenceRef = useRef(null);
  const { submitting, error, existingReport, submit } = useReportSubmission();
  const reportedRole = perspective === "owner" ? "renter" : "owner";
  const reportedName = perspective === "owner"
    ? booking.renter?.name || booking.renter?.email || "this renter"
    : booking.owner?.name || booking.owner?.email || "this owner";
  const categoryGroups = BOOKING_REPORT_CATEGORY_GROUPS[reportedRole] || [];
  const bookingReference = `#${String(booking._id).slice(-6).toUpperCase()}`;

  const review = () => {
    if (submitting) return;
    const nextErrors = {
      category: validateReportCategory(categoryGroups, category),
      description: validateReportDescription(description),
    };
    setFieldErrors(nextErrors);
    if (nextErrors.category) { categoryRef.current?.focus(); return; }
    if (nextErrors.description) { descriptionRef.current?.focus(); return; }
    if (evidenceError) { evidenceRef.current?.focus(); return; }
    try {
      validateReportEvidenceFiles(files);
    } catch (validationError) {
      setEvidenceError(validationError.message);
      evidenceRef.current?.focus();
      return;
    }
    setReviewing(true);
  };

  const confirm = () => {
    if (!reviewing || submitting || evidenceError) return;
    // Recheck the draft at the final action; the server also validates it.
    if (validateReportCategory(categoryGroups, category) || validateReportDescription(description)) {
      setReviewing(false);
      return;
    }
    try {
      validateReportEvidenceFiles(files);
    } catch (validationError) {
      setEvidenceError(validationError.message);
      setReviewing(false);
      return;
    }
    void submit(() => {
      const formData = new FormData();
      formData.append("bookingId", booking._id);
      formData.append("category", category);
      formData.append("description", description.trim());
      files.forEach((file) => formData.append("evidence", file));
      return API.createReport(formData);
    }, (report) => { onSubmitted?.(report); onClose?.(); });
  };

  return (
    <ReportModalFrame
      titleId="report-title"
      title={reviewing ? "Submit this report?" : "Report a booking issue"}
      subtitle={`Report ${reportedName} for booking ${bookingReference}.`}
      submittingLabel="Submitting..."
      submitting={submitting}
      reviewing={reviewing}
      onClose={onClose}
      onBack={() => setReviewing(false)}
      onSubmit={review}
      onConfirm={confirm}
    >
      {reviewing ? (
        <ReportReview reportedName={reportedName} context={bookingReference} category={getReportCategoryLabel(categoryGroups, category)} description={description.trim()} files={files} />
      ) : (
        <>
          <ReportCategorySelect label="Booking issue" placeholder="Select a booking-related category" groups={categoryGroups} value={category} onChange={(value) => { setCategory(value); setFieldErrors((current) => ({ ...current, category: validateReportCategory(categoryGroups, value) })); }} disabled={submitting} error={fieldErrors.category} buttonRef={categoryRef} />
          <div>
            <label htmlFor="report-description" className="mb-1.5 block text-sm font-semibold text-slate-800">Incident details <span className="font-normal text-slate-500">(required)</span></label>
            <p id="report-description-help" className="mb-1.5 text-xs leading-4 text-slate-500">20–3,000 characters after trimming spaces.</p>
            <AutoResizeTextarea
              id="report-description"
              ref={descriptionRef}
              value={description}
              disabled={submitting}
              required
              maxLength={3000}
              aria-invalid={Boolean(fieldErrors.description)}
              aria-describedby={`report-description-help report-description-count${fieldErrors.description ? " report-description-error" : ""}`}
              onChange={(event) => {
                const value = event.target.value;
                setDescription(value);
                if (fieldErrors.description) setFieldErrors((current) => ({ ...current, description: validateReportDescription(value) }));
              }}
              onBlur={() => { if (description) setFieldErrors((current) => ({ ...current, description: validateReportDescription(description) })); }}
              minRows={2}
              maxRows={6}
              placeholder="Explain what happened and when..."
              className={`block w-full rounded-xl border px-3 py-2 text-sm leading-5 outline-none focus:ring-4 ${fieldErrors.description ? "border-rose-500 focus:ring-rose-100" : "border-slate-300 focus:border-blue-500 focus:ring-blue-100"}`}
            />
            <span id="report-description-count" className="mt-1 block text-right text-xs text-slate-500">{description.trim().length}/3,000 characters</span>
            {fieldErrors.description && <p id="report-description-error" role="alert" className="mt-1.5 text-sm text-rose-700">{fieldErrors.description}</p>}
          </div>
          <EvidenceFilePicker compact files={files} onChange={setFiles} onError={setEvidenceError} disabled={submitting} buttonRef={evidenceRef} error={evidenceError} />
        </>
      )}
      <ReportSubmissionError error={error} existingReport={existingReport} />
    </ReportModalFrame>
  );
}
