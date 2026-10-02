import { randomUUID } from "node:crypto";
import Booking from "../models/Booking.js";
import { getBookingPaidAmount, getBookingPayableAmount, getEffectiveTransactionFee } from "../utils/bookingPayment.js";
import { roundCurrency } from "../utils/pricing.js";
import {
  createPayMongoCheckoutSession, expirePayMongoCheckoutSession, getPayMongoCheckoutSession,
  getPayMongoCheckoutId, getPayMongoCheckoutUrl, getPayMongoCheckoutMetadata,
  getPayMongoCheckoutReferenceNumber, getPayMongoPaymentIntentId,
  getPayMongoCheckoutAmountInCentavos, getPayMongoCapturedAmountInCentavos, isPayMongoCheckoutPaid, isPayMongoCheckoutProcessing,
} from "../utils/paymongo.js";

const id = (value) => String(value?._id || value || "");
const revisionFilter = (value) => Number(value || 0) === 0 ? { $in: [0, null] } : Number(value);
export const paymentConflict = (message = "This booking changed. Refresh its payment details and try again.") =>
  Object.assign(new Error(message), { statusCode: 409, code: "BOOKING_PAYMENT_CHANGED" });
const snapshotFilter = (booking) => ({
  _id: booking._id, updatedAt: booking.updatedAt,
  paymentRevision: revisionFilter(booking.paymentRevision),
  manualPaymentRevision: revisionFilter(booking.manualPaymentRevision),
});
const resetWalkIn = {
  balancePaymentMethod: null, walkInPaymentStatus: "none", walkInRequestedAt: null,
  walkInRequestedBy: null, walkInRequestNote: "", walkInReviewedAt: null,
  walkInReviewedBy: null, walkInReviewNote: "", walkInConfirmedAt: null,
  walkInConfirmedBy: null, walkInConfirmationNote: "",
};

export async function acquirePaymentCheckoutLock(bookingId, renterId) {
  const token = randomUUID();
  const now = new Date();
  const result = await Booking.updateOne({
    _id: bookingId, renter: renterId,
    $or: [{ paymentMutationUntil: null }, { paymentMutationUntil: { $lte: now } }],
  }, { $set: { paymentMutationToken: token, paymentMutationUntil: new Date(now.getTime() + 120_000) } },
  { timestamps: false, maxTimeMS: 10_000 });
  if (!result.modifiedCount) throw paymentConflict("Another payment checkout is in progress. Wait a moment and try again.");
  return async () => {
    try {
      await Booking.updateOne({ _id: bookingId, paymentMutationToken: token },
        { $unset: { paymentMutationToken: "", paymentMutationUntil: "" } },
        { timestamps: false, maxTimeMS: 10_000 });
    } catch {
      console.error("[Booking Payment] Checkout lease release failed; the lease will expire.");
    }
  };
}

export function checkoutBelongsToBooking(booking, checkout) {
  const metadata = getPayMongoCheckoutMetadata(checkout);
  if (metadata.bookingId && metadata.bookingId !== id(booking)) return false;
  if (metadata.renterId && metadata.renterId !== id(booking.renter)) return false;
  if (metadata.ownerId && metadata.ownerId !== id(booking.owner)) return false;
  return getPayMongoCheckoutId(checkout) === booking.paymongoCheckoutId ||
    (metadata.bookingId === id(booking) && metadata.renterId === id(booking.renter) && metadata.ownerId === id(booking.owner));
}

export async function applyCapturedBookingCheckout(initialBooking, checkout) {
  const checkoutId = getPayMongoCheckoutId(checkout);
  if (!checkoutId || !checkoutBelongsToBooking(initialBooking, checkout)) {
    throw Object.assign(new Error("Payment checkout session does not belong to this booking."), { statusCode: 400 });
  }
  const captured = isPayMongoCheckoutPaid(checkout);
  if (!captured) return { booking: initialBooking, updated: false, captured: false };
  const centavos = getPayMongoCapturedAmountInCentavos(checkout);
  if (!Number.isSafeInteger(centavos) || centavos <= 0 || centavos !== getPayMongoCheckoutAmountInCentavos(checkout)) {
    throw Object.assign(new Error("Payment amount or currency does not match this checkout."), { statusCode: 400 });
  }
  const amount = roundCurrency(centavos / 100);
  let booking = initialBooking;
  for (let retry = 0; retry < 3; retry++) {
    if ((booking.paymongoVerifiedCheckoutIds || []).includes(checkoutId)) return { booking, updated: false, captured: true };
    if (!["confirmed", "extended", "completed"].includes(booking.status) || booking.paymentStatus === "refunded") {
      throw paymentConflict("This captured payment needs review because the booking status changed.");
    }
    const metadata = getPayMongoCheckoutMetadata(checkout);
    const manualRevision = Number(booking.manualPaymentRevision || 0);
    const createdAt = Number(checkout.attributes?.created_at) > 0
      ? new Date(Number(checkout.attributes.created_at) * 1000) : booking.paymentRequestedAt;
    if ((metadata.manualPaymentRevision !== undefined && Number(metadata.manualPaymentRevision) !== manualRevision) ||
        (metadata.manualPaymentRevision === undefined && manualRevision > 0 &&
          (!createdAt || new Date(booking.manualPaymentUpdatedAt) >= new Date(createdAt)))) {
      throw paymentConflict("This captured payment needs review because the owner corrected payment details after checkout began.");
    }
    const expectedAmount = checkoutId === booking.paymongoCheckoutId
      ? Number(booking.paymentCheckoutAmount || metadata.paymentAmount || roundCurrency(getBookingPayableAmount(booking) - getBookingPaidAmount(booking)))
      : Number(metadata.paymentAmount);
    if (!Number.isFinite(expectedAmount) || Math.abs(expectedAmount - amount) > 0.01) {
      throw Object.assign(new Error("Payment amount does not match this booking."), { statusCode: 400 });
    }
    const total = getBookingPayableAmount(booking);
    const before = getBookingPaidAmount(booking);
    if (amount > roundCurrency(total - before + 0.01)) {
      throw paymentConflict("This captured payment exceeds the remaining balance and needs review.");
    }
    const paid = Math.min(total, roundCurrency(before + amount));
    const due = roundCurrency(total - paid);
    const now = new Date();
    const changes = {
      paymentMethod: "PayMongo", transactionFee: getEffectiveTransactionFee(booking),
      paymentAmountPaid: paid, paymentAmountDue: due,
      paymentStatus: due <= 0 ? "paid" : "partial", paidAt: due <= 0 ? booking.paidAt || now : null,
      paymentUpdatedAt: now, ...resetWalkIn,
    };
    if (!booking.paymongoCheckoutId || booking.paymongoCheckoutId === checkoutId) Object.assign(changes, {
      paymongoCheckoutId: checkoutId, paymongoReference: getPayMongoCheckoutReferenceNumber(checkout) || booking.paymongoReference,
      paymentIntentId: getPayMongoPaymentIntentId(checkout) || booking.paymentIntentId,
      paymentCheckoutAmount: 0, paymentCheckoutAttempt: null,
    });
    const updated = await Booking.findOneAndUpdate({ ...snapshotFilter(booking), paymongoVerifiedCheckoutIds: { $ne: checkoutId } },
      { $set: changes, $addToSet: { paymongoVerifiedCheckoutIds: checkoutId }, $inc: { paymentRevision: 1 } },
      { new: true, runValidators: true });
    if (updated) return { booking: updated, updated: true, captured: true };
    const latest = await Booking.findById(booking._id);
    if (!latest) throw paymentConflict();
    // A manual correction is authoritative and must be reviewed before adding a delayed payment.
    if (Number(latest.manualPaymentRevision || 0) !== Number(initialBooking.manualPaymentRevision || 0)) throw paymentConflict();
    booking = latest;
  }
  throw paymentConflict();
}

async function saveCheckout(booking, checkout, request) {
  const checkoutId = getPayMongoCheckoutId(checkout);
  if (!checkoutId || !getPayMongoCheckoutUrl(checkout)) throw Object.assign(new Error("Failed to create payment checkout URL."), { statusCode: 502 });
  const updated = await Booking.findOneAndUpdate(snapshotFilter(booking), { $set: {
    paymentMethod: "PayMongo", ...resetWalkIn,
    paymongoCheckoutId: checkoutId, paymongoReference: getPayMongoCheckoutReferenceNumber(checkout) || request.referenceNumber,
    paymentIntentId: getPayMongoPaymentIntentId(checkout) || booking.paymentIntentId,
    paymentScope: request.metadata.paymentScope, paymentChannel: request.metadata.paymentChannel,
    paymentCheckoutAmount: request.amountInCentavos / 100, transactionFee: getEffectiveTransactionFee(booking),
    paymentAmountDue: roundCurrency(getBookingPayableAmount(booking) - getBookingPaidAmount(booking)),
    paymentRequestedAt: new Date(), paymentUpdatedAt: new Date(), paymentCheckoutClosedAt: null,
  }, $inc: { paymentRevision: 1 } }, { new: true, runValidators: true }).select("+paymentCheckoutAttempt");
  if (!updated) throw paymentConflict();
  return updated;
}

async function createAttemptCheckout(booking, attempt) {
  try {
    return await createPayMongoCheckoutSession({ ...attempt.request, idempotencyKey: attempt.key });
  } catch (error) {
    if (error.isPayMongoError && error.statusCode >= 400 && error.statusCode < 500 &&
        ![408, 409, 429].includes(error.statusCode)) {
      // A definitive rejection created no session. Allow corrected billing details on the next request.
      await Booking.updateOne({ _id: booking._id, "paymentCheckoutAttempt.key": attempt.key, paymongoCheckoutId: null },
        { $set: { paymentCheckoutAttempt: null }, $inc: { paymentRevision: 1 } });
    }
    throw error;
  }
}

export async function getOrCreateBookingCheckout(initialBooking, request) {
  let booking = initialBooking;
  // Recover the exact persisted request after a provider timeout or a process crash.
  if (booking.paymentCheckoutAttempt && !booking.paymongoCheckoutId) {
    const attempt = booking.paymentCheckoutAttempt;
    const recovered = await createAttemptCheckout(booking, attempt);
    booking = await saveCheckout(booking, recovered, attempt.request);
  }
  if (booking.paymongoCheckoutId && !(booking.paymongoVerifiedCheckoutIds || []).includes(booking.paymongoCheckoutId)) {
    let checkout = await getPayMongoCheckoutSession(booking.paymongoCheckoutId);
    if (!checkoutBelongsToBooking(booking, checkout)) throw paymentConflict();
    if (isPayMongoCheckoutPaid(checkout)) {
      await applyCapturedBookingCheckout(booking, checkout);
      throw paymentConflict("Your payment was recorded. Refresh the booking before starting another checkout.");
    }
    const sameRequest = Math.round(Number(booking.paymentCheckoutAmount) * 100) === request.amountInCentavos &&
      booking.paymentScope === request.metadata.paymentScope && booking.paymentChannel === request.metadata.paymentChannel;
    if (checkout.attributes?.status === "active" && sameRequest && getPayMongoCheckoutUrl(checkout)) return { booking, checkout };
    if (isPayMongoCheckoutProcessing(checkout)) throw paymentConflict("The previous payment is still processing. Check its status before starting a different checkout.");
    if (checkout.attributes?.status !== "expired") {
      await expirePayMongoCheckoutSession(booking.paymongoCheckoutId);
      checkout = await getPayMongoCheckoutSession(booking.paymongoCheckoutId);
      if (isPayMongoCheckoutPaid(checkout)) {
        await applyCapturedBookingCheckout(booking, checkout);
        throw paymentConflict("Your payment was recorded. Refresh the booking before starting another checkout.");
      }
      if (isPayMongoCheckoutProcessing(checkout)) throw paymentConflict("The previous payment is still processing. Check its status before trying again.");
      if (checkout.attributes?.status !== "expired") throw paymentConflict("The previous checkout is still processing. Check its status before trying again.");
    }
  }
  const attempt = { key: randomUUID(), request, createdAt: new Date() };
  booking = await Booking.findOneAndUpdate(snapshotFilter(booking), { $set: {
    paymentCheckoutAttempt: attempt, paymongoCheckoutId: null, paymentCheckoutAmount: 0,
  }, $inc: { paymentRevision: 1 } }, { new: true, runValidators: true }).select("+paymentCheckoutAttempt");
  if (!booking) throw paymentConflict();
  const checkout = await createAttemptCheckout(booking, attempt);
  booking = await saveCheckout(booking, checkout, request);
  return { booking, checkout };
}
