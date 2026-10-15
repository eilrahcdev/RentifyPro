import Booking from "../models/Booking.js";
import { getPayMongoCheckoutSession, isPayMongoCheckoutProcessing } from "../utils/paymongo.js";
import { applyCapturedBookingCheckout } from "../services/bookingPayment.service.js";
import { notifyBookingPaymentRecorded } from "../controllers/booking.controller.js";

let timer = null;
let running = false;
const retries = new Map();
const MAX_RETRY_ENTRIES = 1000;
const REVIEW_RETRY_MS = 15 * 60_000;
const fingerprint = booking => JSON.stringify([
  booking.paymongoCheckoutId, booking.updatedAt, booking.paymentRevision, booking.manualPaymentRevision,
  booking.status, booking.paymentStatus, booking.paymentAmountPaid, booking.paymentAmountDue,
  booking.paymentCheckoutAmount, booking.totalAmount, booking.transactionFee, booking.lateReturnPenaltyFee,
  booking.manualPaymentUpdatedAt, booking.paymongoVerifiedCheckoutIds,
]);
export async function reconcileBookingPayments() {
  if (running || !process.env.PAYMONGO_SECRET_KEY) return;
  running = true;
  try {
    const candidates = await Booking.find({
      paymongoCheckoutId: { $type: "string", $ne: "" },
      paymentCheckoutClosedAt: null,
      $expr: { $not: { $in: ["$paymongoCheckoutId", { $ifNull: ["$paymongoVerifiedCheckoutIds", []] }] } },
    }).sort({ paymentLastCheckedAt: 1, _id: 1 }).limit(10);
    for (const booking of candidates) {
      await Booking.updateOne({ _id: booking._id }, { $set: { paymentLastCheckedAt: new Date() } }, { timestamps: false });
      const bookingId = String(booking._id), version = fingerprint(booking), previous = retries.get(bookingId);
      if (previous?.version === version && previous.retryAt > Date.now()) continue;
      try {
        const checkout = await getPayMongoCheckoutSession(booking.paymongoCheckoutId);
        const result = await applyCapturedBookingCheckout(booking, checkout);
        if (!result.captured && checkout.attributes?.status === "expired" && !isPayMongoCheckoutProcessing(checkout)) {
          await Booking.updateOne({ _id: booking._id, paymongoCheckoutId: booking.paymongoCheckoutId },
            { $set: { paymentCheckoutClosedAt: new Date() } }, { timestamps: false });
        }
        retries.delete(bookingId);
        if (result.updated) {
          const base = new URL(process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`);
          await notifyBookingPaymentRecorded({ protocol: base.protocol.slice(0, -1), get: () => base.host }, booking._id);
        }
      } catch (error) {
        const requiresReview = error.requiresReview === true || (error.isPayMongoError && error.statusCode >= 400
          && error.statusCode < 500 && ![408, 409, 429].includes(error.statusCode));
        const attempts = previous?.version === version ? Math.min(previous.attempts + 1, 10) : 1;
        const delay = requiresReview ? REVIEW_RETRY_MS : Math.min(REVIEW_RETRY_MS, 60_000 * 2 ** (attempts - 1));
        const retryAt = Date.now() + delay;
        retries.delete(bookingId);
        if (retries.size >= MAX_RETRY_ENTRIES) retries.delete(retries.keys().next().value);
        retries.set(bookingId, { version, attempts, retryAt });
        console.error("[Payment Reconciliation] Checkout needs retry or review", {
          bookingId, code: error.code || error.statusCode || "INTERNAL_ERROR",
          reason: error.reconciliationReason || (error.isPayMongoError ? "PROVIDER_CHECK_REQUIRED" : "RECONCILIATION_RETRY"),
          action: requiresReview ? "manual_review" : "retry", retryAt: new Date(retryAt).toISOString(),
        });
      }
    }
  } finally { running = false; }
}
export function startPaymentReconciliationJob() {
  if (timer || String(process.env.PAYMENT_RECONCILIATION_ENABLED || "true").toLowerCase() === "false") return;
  const run = () => reconcileBookingPayments().catch(() => console.error("[Payment Reconciliation] Database scan failed."));
  void run();
  timer = setInterval(run, 60_000);
  timer.unref?.();
}
export function stopPaymentReconciliationJob() { clearInterval(timer); timer = null; retries.clear(); }
