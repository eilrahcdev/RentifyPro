import { useId, useRef, useState } from "react";
import { FileUp, X } from "lucide-react";
import { validateReportEvidenceFiles } from "../utils/fileValidation";

export default function EvidenceFilePicker({ files = [], onChange, onError, disabled = false, buttonRef, error, compact = false }) {
  const inputRef = useRef(null);
  const errorId = useId();
  const [localError, setSelectionError] = useState("");
  const selectionError = error ?? localError;

  const updateError = (message) => {
    setSelectionError(message);
    onError?.(message);
  };

  const chooseFiles = (event) => {
    const selected = Array.from(event.target.files || []);
    if (disabled || !selected.length) return;
    try {
      const validated = validateReportEvidenceFiles(selected);
      onChange?.(validated);
      updateError("");
    } catch (validationError) {
      updateError(`${validationError.message || "The selected evidence files are invalid."} ${files.length ? "Your previous attachments have been kept." : "No files were attached."}`);
    } finally {
      event.target.value = "";
    }
  };

  const removeFile = (index) => {
    if (disabled) return;
    onChange?.(files.filter((_, fileIndex) => fileIndex !== index));
  };

  return (
    <div className={`rounded-xl border border-dashed border-slate-300 bg-slate-50 transition hover:border-blue-300 ${compact ? "p-3" : "p-4"}`}>
      <div className={compact ? "flex flex-wrap items-center justify-between gap-2" : "flex flex-wrap items-start justify-between gap-3"}>
        <div>
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <FileUp size={18} className="text-blue-600" />{compact ? "Evidence (optional)" : "Private evidence (optional)"}
          </span>
          {!compact && <span className="mt-1 block text-xs leading-5 text-slate-500">
            Up to five JPG, PNG, WEBP, or PDF files, 5 MB each. Only you and reviewing administrators can view them.
          </span>}
        </div>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          aria-invalid={Boolean(selectionError)}
          aria-describedby={selectionError ? errorId : undefined}
          className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={chooseFiles}
          disabled={disabled}
          className="hidden"
          aria-label="Choose private evidence files"
        />
      </div>
      {compact && <p className="mt-1.5 text-xs leading-4 text-slate-500">Up to 5 JPG, PNG, WEBP or PDF files, 5 MB each. Private to you and reviewing admins.</p>}
      {selectionError && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
        <p id={errorId} role="alert">{selectionError}</p>
        <button type="button" disabled={disabled} onClick={() => updateError("")} className="mt-2 font-semibold underline">Dismiss attachment error</button>
      </div>}
      {files.length ? (
        <ul className={compact ? "mt-2 grid grid-cols-2 gap-1.5" : "mt-3 space-y-2"} aria-label="Selected evidence files">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}`} className={`flex min-w-0 items-center justify-between rounded-lg border border-slate-200 bg-white text-xs text-slate-700 ${compact ? "gap-1 pl-2 pr-1" : "gap-3 px-3 py-2"}`}>
              <span title={file.name} className="min-w-0 truncate">{file.name}</span>
              <button type="button" onClick={() => removeFile(index)} disabled={disabled} aria-label={`Remove ${file.name}`} className={`shrink-0 rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 ${compact ? "p-1.5" : "p-0.5"}`}>
                <X size={16} strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
