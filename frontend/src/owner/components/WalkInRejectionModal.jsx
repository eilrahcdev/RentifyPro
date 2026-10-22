import { useRef, useState } from "react";
import BookingRequestModal from "../../components/BookingRequestModal";
import AutoResizeTextarea from "../../components/AutoResizeTextarea";

export default function WalkInRejectionModal({ booking, loading, error, onClose, onSubmit }) {
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState("");
  const submitting = useRef(false);
  const reasonRef = useRef(null);

  const submit = async () => {
    if (loading || submitting.current) return;
    const reason = note.trim();
    if (!reason || reason.length > 500) {
      setFieldError(!reason ? "Enter a reason for rejecting this walk-in payment request." : "The reason must be 500 characters or fewer.");
      reasonRef.current?.focus();
      return;
    }
    setFieldError("");
    submitting.current = true;
    try {
      await onSubmit(reason);
    } finally {
      submitting.current = false;
    }
  };

  return (
    <BookingRequestModal
      titleId="walk-in-rejection-title"
      title="Reject walk-in payment?"
      subtitle={`Review the walk-in payment request for ${booking.vehicle?.name || "this vehicle"}.`}
      loading={loading}
      error={fieldError || error}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Reject walk-in payment"
    >
      <p className="text-sm leading-6 text-slate-700">
        Your reason will be shared with the renter in a notification. The booking stays active and recorded payments are retained.
      </p>
      <div>
        <label htmlFor="walk-in-rejection-reason" className="mb-1.5 block text-sm font-semibold text-slate-800">
          Reason for rejection (required)
        </label>
        <AutoResizeTextarea
          ref={reasonRef}
          id="walk-in-rejection-reason"
          value={note}
          minRows={3}
          maxLength={500}
          required
          disabled={loading}
          aria-invalid={Boolean(fieldError)}
          aria-describedby="walk-in-rejection-hint"
          onChange={(event) => { setNote(event.target.value); setFieldError(""); }}
          placeholder="Explain why you cannot accept this walk-in payment."
          className="w-full rounded-xl border border-slate-400 px-3 py-3 text-base text-slate-800 placeholder:text-slate-600 focus:border-blue-700 focus:outline focus:outline-2 focus:outline-blue-700 disabled:opacity-60"
        />
        <p id="walk-in-rejection-hint" className="mt-1.5 text-sm text-slate-600">
          Up to 500 characters. {note.length}/500
        </p>
      </div>
    </BookingRequestModal>
  );
}
