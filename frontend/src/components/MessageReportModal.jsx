import { useRef, useState } from "react";
import { MessageCircleWarning } from "lucide-react";
import API from "../utils/api";
import { MESSAGE_REPORT_CATEGORY_GROUPS } from "../data/reportCategories";
import ReportCategorySelect from "./ReportCategorySelect";
import ReportModalFrame from "./ReportModalFrame";
import ReportSubmissionError from "./ReportSubmissionError";
import useReportSubmission from "../hooks/useReportSubmission";
import { validateReportCategory } from "../utils/reportValidation";

export default function MessageReportModal(props) {
  return props.message ? <MessageReportForm key={props.message._id} {...props} /> : null;
}

function MessageReportForm({ message, senderName = "this user", onClose, onReported }) {
  const [category, setCategory] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const categoryRef = useRef(null);
  const { submitting, error, existingReport, submit } = useReportSubmission();

  const submitReport = () => {
    if (submitting) return;
    const validationError = validateReportCategory(MESSAGE_REPORT_CATEGORY_GROUPS, category);
    setCategoryError(validationError);
    if (validationError) { categoryRef.current?.focus(); return; }
    void submit(() => API.reportChatMessage(message._id, category), (report) => {
      onReported?.(report);
      onClose?.();
    });
  };

  return (
    <ReportModalFrame
      titleId="message-report-title"
      title="Report this message"
      subtitle={`Report a message sent by ${senderName}.`}
      headerIcon={<MessageCircleWarning size={24} strokeWidth={2} aria-hidden="true" />}
      submittingLabel="Reporting..."
      submitting={submitting}
      onClose={onClose}
      onSubmit={submitReport}
    >
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-semibold text-slate-600">Message being reported</p>
        <blockquote className="mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-5 text-slate-900" tabIndex={0}>{message.text}</blockquote>
        <p className="mt-2 text-xs leading-4 text-slate-500">Only this message is attached, not the conversation.</p>
      </div>
      <ReportCategorySelect label="Message violation" placeholder="Select a message-related category" groups={MESSAGE_REPORT_CATEGORY_GROUPS} value={category} onChange={(value) => { setCategory(value); setCategoryError(validateReportCategory(MESSAGE_REPORT_CATEGORY_GROUPS, value)); }} disabled={submitting} error={categoryError} buttonRef={categoryRef} />
      <ReportSubmissionError error={error} existingReport={existingReport} />
    </ReportModalFrame>
  );
}
