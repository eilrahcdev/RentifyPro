import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle, Star, X } from "lucide-react";

import API from "../utils/api";
import { sanitizeBookingReviewComment, validateBookingRating, validateBookingReviewComment } from "../utils/bookingReviewValidation";
import ModalPortal from "./ModalPortal";
import VehicleThumbnail from "./VehicleThumbnail";
import AutoResizeTextarea from "./AutoResizeTextarea";

export default function BookingReviewModal({ booking, onClose, onSubmitted }) {
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const ratingRef = useRef(null);
  const commentRef = useRef(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submissionError, setSubmissionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const vehicleName = booking.vehicle?.name || "this vehicle";

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog.showModal();
    titleRef.current?.focus();
    return () => {
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (submitting || saved) return;
    const nextErrors = {
      rating: validateBookingRating(rating),
      comment: validateBookingReviewComment(comment),
    };
    setFieldErrors(nextErrors);
    if (nextErrors.rating) { ratingRef.current?.focus(); return; }
    if (nextErrors.comment) { commentRef.current?.focus(); return; }

    setSubmitting(true);
    setSubmissionError("");
    try {
      const response = await API.reviewBooking(booking._id, { rating, comment: comment.trim() });
      if (response?.success === false) throw new Error(response.message || "Your review could not be saved.");
      onSubmitted?.(response.booking);
      setSaved(true);
      titleRef.current?.focus();
    } catch (error) {
      setSubmissionError(error.message || "Your review could not be saved. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    if (!submitting) onClose?.();
  };

  const updateComment = (event) => {
    const input = event.currentTarget;
    const raw = input.value;
    const cursor = input.selectionStart ?? raw.length;
    const value = sanitizeBookingReviewComment(raw);
    if (raw !== value) {
      input.value = value;
      const nextCursor = sanitizeBookingReviewComment(raw.slice(0, cursor)).length;
      input.setSelectionRange(nextCursor, nextCursor);
    }
    setComment(value);
    if (fieldErrors.comment) setFieldErrors((current) => ({ ...current, comment: validateBookingReviewComment(value) }));
  };

  return (
    <ModalPortal>
      <dialog
        ref={dialogRef}
        aria-labelledby="booking-review-title"
        aria-describedby="booking-review-description"
        aria-modal="true"
        aria-busy={submitting}
        onCancel={(event) => { event.preventDefault(); close(); }}
        className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-transparent p-0 text-slate-900 backdrop:bg-slate-950/60"
      >
        <div className="flex min-h-full items-end justify-center sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <div className="my-auto w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl">
            <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
              <VehicleThumbnail vehicle={booking.vehicle} className="h-14 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100 sm:w-20" />
              <div className="min-w-0 flex-1">
                <h2 ref={titleRef} tabIndex={-1} id="booking-review-title" className="break-words text-lg font-bold leading-6 text-slate-950 outline-none sm:text-xl">
                  {saved ? "Thanks for your review" : `How was ${vehicleName}?`}
                </h2>
                <p id="booking-review-description" className="mt-1 text-sm leading-5 text-slate-600">
                  {saved ? "Your feedback is now part of this vehicle's reviews." : "Share your experience after this completed rental."}
                </p>
              </div>
              <button type="button" onClick={close} disabled={submitting} aria-label="Close review" className="rp-icon-button shrink-0 disabled:opacity-50">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            <div className="max-h-[calc(100dvh-7rem)] overflow-y-auto px-4 py-4 sm:px-5">
              {saved ? (
                <div className="py-7 text-center" role="status">
                  <CheckCircle2 size={40} strokeWidth={1.8} className="mx-auto text-emerald-600" aria-hidden="true" />
                  <p className="mt-3 font-semibold text-slate-900">You rated this rental {rating} out of 5 stars.</p>
                  <p className="mt-1 text-sm text-slate-600">You can see your rating in booking history.</p>
                  <button type="button" onClick={close} className="mt-5 min-h-11 rounded-xl bg-[#017FE6] px-6 text-sm font-semibold text-white hover:bg-[#006cc3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
                    Done
                  </button>
                </div>
              ) : (
                <form onSubmit={submit} noValidate className="space-y-4">
                  <fieldset aria-describedby={fieldErrors.rating ? "booking-rating-error" : undefined}>
                    <legend className="text-sm font-semibold text-slate-900">Your rating <span className="text-rose-600">*</span></legend>
                    <div className="mt-2 flex flex-wrap gap-1" aria-label="Rate this rental from 1 to 5 stars">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <label key={value} className="cursor-pointer">
                          <input
                            ref={value === 1 ? ratingRef : undefined}
                            type="radio"
                            name="booking-rating"
                            value={value}
                            checked={rating === value}
                            disabled={submitting}
                            onChange={() => { setRating(value); setFieldErrors((current) => ({ ...current, rating: "" })); }}
                            aria-invalid={Boolean(fieldErrors.rating)}
                            aria-label={`${value} ${value === 1 ? "star" : "stars"}`}
                            className="peer sr-only"
                          />
                          <span className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-700 ${value <= rating ? "text-amber-600" : "text-slate-400 hover:bg-slate-100"}`}>
                            <Star size={29} strokeWidth={1.8} fill={value <= rating ? "currentColor" : "none"} aria-hidden="true" />
                          </span>
                        </label>
                      ))}
                    </div>
                    {fieldErrors.rating && <p id="booking-rating-error" role="alert" className="mt-1 text-sm text-rose-700">{fieldErrors.rating}</p>}
                  </fieldset>

                  <div>
                    <label htmlFor="booking-review-comment" className="block text-sm font-semibold text-slate-900">Your review <span className="font-normal text-slate-500">(optional)</span></label>
                    <p id="booking-review-comment-help" className="mt-1 text-xs text-slate-600">Letters, numbers, and single spaces only. You can mention condition, cleanliness, or pickup.</p>
                    <AutoResizeTextarea
                      id="booking-review-comment"
                      ref={commentRef}
                      value={comment}
                      disabled={submitting}
                      onChange={updateComment}
                      onCompositionEnd={updateComment}
                      onBlur={() => { if (comment) setFieldErrors((current) => ({ ...current, comment: validateBookingReviewComment(comment) })); }}
                      maxLength={1200}
                      aria-invalid={Boolean(fieldErrors.comment)}
                      aria-describedby={`booking-review-comment-help booking-review-comment-count${fieldErrors.comment ? " booking-review-comment-error" : ""}`}
                      className={`mt-2 block w-full rounded-xl border bg-white px-3 py-2 text-base leading-6 text-slate-900 focus:outline-none focus:ring-2 ${fieldErrors.comment ? "border-rose-500 focus:ring-rose-100" : "border-slate-300 focus:border-blue-600 focus:ring-blue-100"}`}
                    />
                    <p id="booking-review-comment-count" className="mt-1 text-right text-xs tabular-nums text-slate-500">{comment.trim().length}/1,200 characters</p>
                    {fieldErrors.comment && <p id="booking-review-comment-error" role="alert" className="mt-1 text-sm text-rose-700">{fieldErrors.comment}</p>}
                  </div>

                  <p className="text-xs leading-5 text-slate-600">Your rating and review will appear on this vehicle's listing with your renter name.</p>
                  {submissionError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{submissionError}</p>}
                  <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
                    <button type="button" onClick={close} disabled={submitting} className="min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">Not now</button>
                    <button type="submit" disabled={submitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#017FE6] px-5 text-sm font-semibold text-white hover:bg-[#006cc3] disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
                      {submitting && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
                      {submitting ? "Submitting..." : "Submit review"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </dialog>
    </ModalPortal>
  );
}
