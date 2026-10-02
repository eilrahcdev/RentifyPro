import Booking from "../models/Booking.js";
import { getPayMongoCheckoutSession, isPayMongoCheckoutProcessing } from "../utils/paymongo.js";
import { applyCapturedBookingCheckout } from "../services/bookingPayment.service.js";
import { notifyBookingPaymentRecorded } from "../controllers/booking.controller.js";

let timer = null;
let running = false;
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
      try {
        const checkout = await getPayMongoCheckoutSession(booking.paymongoCheckoutId);
        const result = await applyCapturedBookingCheckout(booking, checkout);
        if (!result.captured && checkout.attributes?.status === "expired" && !isPayMongoCheckoutProcessing(checkout)) {
          await Booking.updateOne({ _id: booking._id, paymongoCheckoutId: booking.paymongoCheckoutId },
            { $set: { paymentCheckoutClosedAt: new Date() } }, { timestamps: false });
        }
        if (result.updated) {
          const base = new URL(process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`);
          await notifyBookingPaymentRecorded({ protocol: base.protocol.slice(0, -1), get: () => base.host }, booking._id);
        }
      } catch (error) {
        console.error("[Payment Reconciliation] Checkout needs retry or review", {
          bookingId: String(booking._id), code: error.code || error.statusCode || "INTERNAL_ERROR",
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
export function stopPaymentReconciliationJob() { clearInterval(timer); timer = null; }
