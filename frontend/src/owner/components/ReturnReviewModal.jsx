import { CircleCheck, CircleX, X } from "lucide-react";
import ModalPortal from "../../components/ModalPortal";

export default function ReturnReviewModal({ review, note, loading, error, onNoteChange, onClose, onSubmit }) {
  if (!review?.booking) return null;
  const confirming = review.action === "confirm";
  const vehicleName = review.booking.vehicle?.name || "this vehicle";

  return (
    <ModalPortal>
      <div className="rp-modal-layer" role="dialog" aria-modal="true" aria-labelledby="return-review-title">
        <button type="button" className="rp-modal-backdrop" onClick={loading ? undefined : onClose} aria-label="Close return review" />
        <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.3)]">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${confirming ? "bg-blue-100 text-blue-700" : "bg-rose-100 text-rose-700"}`}>
                {confirming ? <CircleCheck size={24} strokeWidth={2} aria-hidden="true" /> : <CircleX size={24} strokeWidth={2} aria-hidden="true" />}
              </span>
              <div>
                <h2 id="return-review-title" className="text-lg font-bold text-slate-900">
                  {confirming ? "Confirm vehicle received" : "Decline return request"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">Review the renter's return request for {vehicleName}.</p>
              </div>
            </div>
            <button type="button" onClick={onClose} disabled={loading} className="rp-icon-button" aria-label="Close modal">
              <X size={18} />
            </button>
          </div>

          <div className="space-y-4 p-5 sm:p-6">
            <div className={`rounded-2xl border px-4 py-3 text-sm ${confirming ? "border-blue-200 bg-blue-50 text-blue-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}>
              {confirming
                ? "Confirm only after you have physically received the vehicle. It will be placed under inspection/maintenance."
                : "Declining keeps the booking active and the vehicle unavailable. The renter can submit another return request later."}
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Optional note</span>
              <textarea
                value={note}
                maxLength={500}
                onChange={(event) => onNoteChange(event.target.value)}
                placeholder={confirming ? "Condition or handover note" : "Reason for declining the request"}
                className="min-h-24 w-full resize-y rounded-2xl border border-slate-200 px-3.5 py-3 text-sm text-slate-800 outline-none focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"
              />
            </label>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
            <button type="button" onClick={onClose} disabled={loading} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={onSubmit} disabled={loading} className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${confirming ? "bg-[#017FE6] hover:bg-[#006cc3]" : "bg-rose-600 hover:bg-rose-700"}`}>
              {loading ? "Saving..." : confirming ? "Confirm vehicle received" : "Decline request"}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
