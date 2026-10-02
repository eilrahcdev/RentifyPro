import { useRef, useState } from "react";
import { Flag, MessageCircleWarning } from "lucide-react";
import API from "../utils/api";
import { MESSAGE_REPORT_CATEGORY_GROUPS } from "../data/reportCategories";
import ReportCategorySelect from "./ReportCategorySelect";
import ReportModalFrame from "./ReportModalFrame";
import ReportReview from "./ReportReview";
import ReportSubmissionError from "./ReportSubmissionError";
import useReportSubmission from "../hooks/useReportSubmission";
import { getReportCategoryLabel, validateReportCategory } from "../utils/reportValidation";

export default function MessageReportModal(props) {
  return props.message ? <MessageReportForm key={props.message._id} {...props} /> : null;
}

function MessageReportForm({ message, senderName = "this user", onClose, onReported }) {
  const [category, setCategory] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const categoryRef = useRef(null);
  const { submitting, error, existingReport, submit } = useReportSubmission();

  const review = () => {
    if (submitting) return;
    const validationError = validateReportCategory(MESSAGE_REPORT_CATEGORY_GROUPS, category);
    setCategoryError(validationError);
    if (validationError) { categoryRef.current?.focus(); return; }
    setReviewing(true);
  };

  const confirm = () => {
    if (!reviewing || submitting) return;
    const validationError = validateReportCategory(MESSAGE_REPORT_CATEGORY_GROUPS, category);
    if (validationError) {
      setCategoryError(validationError);
      setReviewing(false);
      return;
    }
    void submit(() => API.reportChatMessage(message._id, category), (report) => {
      onReported?.(report);
      onClose?.();
    });
  };

  return (
    <ReportModalFrame
      titleId="message-report-title"
      title={reviewing ? "Submit this report?" : "Report this message"}
      subtitle={`Report a message sent by ${senderName}.`}
      headerIcon={<MessageCircleWarning size={24} strokeWidth={2} aria-hidden="true" />}
      submitIcon={<Flag size={18} strokeWidth={2} aria-hidden="true" />}
      submittingLabel="Reporting..."
      submitting={submitting}
      reviewing={reviewing}
      onClose={onClose}
      onBack={() => setReviewing(false)}
      onSubmit={review}
      onConfirm={confirm}
    >
      {reviewing ? (
        <ReportReview reportedName={senderName} context="Chat message" category={getReportCategoryLabel(MESSAGE_REPORT_CATEGORY_GROUPS, category)} messageText={message.text || ""} />
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Message being reported</p>
            <blockquote className="mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-5 text-slate-900" tabIndex={0}>{message.text}</blockquote>
            <p className="mt-2 text-xs leading-4 text-slate-500">Only this message is attached, not the conversation.</p>
          </div>
          <ReportCategorySelect label="Message violation" placeholder="Select a message-related category" groups={MESSAGE_REPORT_CATEGORY_GROUPS} value={category} onChange={(value) => { setCategory(value); setCategoryError(validateReportCategory(MESSAGE_REPORT_CATEGORY_GROUPS, value)); }} disabled={submitting} error={categoryError} buttonRef={categoryRef} />
        </>
      )}
      <ReportSubmissionError error={error} existingReport={existingReport} />
    </ReportModalFrame>
  );
}
