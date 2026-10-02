export default function ReportReview({ reportedName, context, category, description, files = [], messageText }) {
  return (
    <>
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
        An administrator reviews each report before taking action.
      </p>
      <dl className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-5">
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2"><dt className="font-semibold text-slate-600">Reporting</dt><dd className="break-words text-slate-950">{reportedName}</dd></div>
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2"><dt className="font-semibold text-slate-600">{messageText !== undefined ? "Report type" : "Booking"}</dt><dd className="break-words text-slate-950">{context}</dd></div>
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2"><dt className="font-semibold text-slate-600">Category</dt><dd className="break-words text-slate-950">{category}</dd></div>
        {description !== undefined && <div className="border-t border-slate-200 pt-2.5"><dt className="font-semibold text-slate-600">Incident details</dt><dd className="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-slate-950" tabIndex={0}>{description}</dd></div>}
        {messageText !== undefined ? (
          <div className="border-t border-slate-200 pt-2.5"><dt className="font-semibold text-slate-600">Message being reported</dt><dd className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-slate-950" tabIndex={0}>{messageText}</dd></div>
        ) : (
          <div><dt className="font-semibold text-slate-600">Private evidence ({files.length})</dt><dd className="mt-1 text-slate-950">
            {files.length ? <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">{files.map((file, index) => <li key={`${file.name}-${index}`} title={file.name} className="truncate">{file.name}</li>)}</ul> : "No files attached"}
          </dd></div>
        )}
      </dl>
      <p className="text-xs leading-4 text-slate-500">{messageText !== undefined ? "Only this message is attached, not the conversation." : "Evidence is private to you and review admins."}</p>
    </>
  );
}
