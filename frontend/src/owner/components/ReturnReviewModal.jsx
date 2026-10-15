import { useState } from "react";
import BookingRequestModal from "../../components/BookingRequestModal";
import AutoResizeTextarea from "../../components/AutoResizeTextarea";
import { formatHandoverInput } from "../../utils/bookingPolicy";

export default function ReturnReviewModal({ review, note, loading, error, onNoteChange, onClose, onSubmit }) {
  if (!review?.booking) return null;
  return <ReturnReviewForm key={`${review.booking._id}-${review.action}-${(review.booking.returnRequest || review.booking.return_request)?.requestedAt}`} {...{ review, note, loading, error, onNoteChange, onClose, onSubmit }} />;
}

function ReturnReviewForm({ review, note, loading, error, onNoteChange, onClose, onSubmit }) {
  const confirming = review.action === "confirm";
  const vehicleName = review.booking.vehicle?.name || "this vehicle";
  const request = review.booking.returnRequest || review.booking.return_request || {};
  const [handover, setHandover] = useState(() => formatHandoverInput(request.reportedHandoverAt || new Date()));
  const [received, setReceived] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const submit = () => {
    const date = new Date(handover);
    if (confirming && (!received || !handover || Number.isNaN(date.getTime()) || date > new Date() || date < new Date(review.booking.pickupAt))) {
      setFieldError("Enter the actual handover time between pickup and now, and confirm physical receipt.");
      return;
    }
    setFieldError("");
    onSubmit({ ...(confirming ? { actualReturnAt: date.toISOString() } : {}), expectedRequestedAt: request.requestedAt });
  };

  return (
    <BookingRequestModal titleId="return-review-title" title={confirming ? "Confirm vehicle received" : "Decline return request"}
      subtitle={`Review the renter's return request for ${vehicleName}.`} loading={loading} error={fieldError || error}
      onClose={onClose} onSubmit={submit} submitLabel={confirming ? "Confirm vehicle received" : "Decline request"}>
            <div className={`rounded-2xl border px-4 py-3 text-sm ${confirming ? "border-blue-200 bg-blue-50 text-blue-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}>
              {confirming
                ? "Confirm only after you have physically received the vehicle. It will be placed under inspection/maintenance."
                : "Declining keeps the booking active and the vehicle unavailable. The renter can submit another return request later."}
            </div>
            {confirming && <div className="space-y-3">
              {request.reportedHandoverAt && <p className="text-sm text-slate-700">Renter-reported handover: {new Date(request.reportedHandoverAt).toLocaleString()}. Verify this time before confirming.</p>}
              <label className="block text-sm font-semibold text-slate-800">Actual handover date and time
                <input type="datetime-local" value={handover} min={formatHandoverInput(review.booking.pickupAt)} max={formatHandoverInput()}
                  disabled={loading} required onChange={(event) => { setHandover(event.target.value); setFieldError(""); }}
                  className="mt-1 block min-h-11 w-full min-w-0 rounded-xl border border-slate-400 px-3 text-base focus:border-blue-700 focus:outline focus:outline-2 focus:outline-blue-700" />
              </label>
              <p className="text-sm text-slate-600">Late charges end at the verified handover time. The time you confirm in the app is recorded separately.</p>
              <label className="flex min-h-11 items-start gap-3 py-2 text-sm text-slate-800">
                <input type="checkbox" checked={received} disabled={loading} onChange={(event) => { setReceived(event.target.checked); setFieldError(""); }} className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700" />
                I physically received the vehicle at this date and time.
              </label>
            </div>}
            <label className="block text-sm font-semibold text-slate-800">
              <span className="mb-1.5 block">Optional note</span>
              <AutoResizeTextarea
                value={note}
                maxLength={500}
                onChange={(event) => onNoteChange(event.target.value)}
                placeholder={confirming ? "Condition or handover note" : "Reason for declining the request"}
                disabled={loading}
                className="w-full rounded-xl border border-slate-400 px-3 py-3 text-base font-normal text-slate-800 placeholder:text-slate-600 focus:border-blue-700 focus:outline focus:outline-2 focus:outline-blue-700"
              />
            </label>
    </BookingRequestModal>
  );
}
