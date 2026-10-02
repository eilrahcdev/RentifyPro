import { createHmac, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import { getPayMongoCheckoutSession } from "../utils/paymongo.js";
import { applyCapturedBookingCheckout } from "../services/bookingPayment.service.js";
import { notifyBookingPaymentRecorded } from "./booking.controller.js";

export function verifyPayMongoWebhookSignature(rawBody, header, { secret, live, now = Date.now() }) {
  if (!secret || !Buffer.isBuffer(rawBody) || typeof header !== "string" || header.length > 1024) return false;
  const parts = new Map();
  for (const part of header.split(",")) {
    const [key, value, extra] = part.trim().split("=");
    if (extra !== undefined || parts.has(key)) return false;
    parts.set(key, value);
  }
  const timestamp = parts.get("t");
  const signature = parts.get(live ? "li" : "te");
  if (!/^\d{1,12}$/.test(timestamp || "") || !/^[a-f\d]{64}$/i.test(signature || "")) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export async function receivePayMongoWebhook(req, res) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  const apiKey = String(process.env.PAYMONGO_SECRET_KEY || "");
  if (!secret || !/^sk_(live|test)_/.test(apiKey)) return res.status(503).json({ success: false });
  const live = apiKey.startsWith("sk_live_");
  if (!verifyPayMongoWebhookSignature(req.body, req.get("paymongo-signature"), { secret, live })) {
    return res.status(401).json({ success: false });
  }
  let envelope;
  try { envelope = JSON.parse(req.body.toString("utf8")); }
  catch { return res.status(400).json({ success: false }); }
  const event = envelope?.data?.attributes || envelope?.data;
  if (typeof event?.livemode !== "boolean" || event.livemode !== live) return res.status(400).json({ success: false });
  if (event.type !== "checkout_session.payment.paid") return res.json({ success: true, ignored: true });
  const checkoutId = event.data?.id;
  if (typeof checkoutId !== "string" || !/^cs_[a-z\d_-]{1,128}$/i.test(checkoutId)) return res.status(400).json({ success: false });
  try {
    // Retrieve with our secret key; never trust webhook metadata alone to credit a booking.
    const checkout = await getPayMongoCheckoutSession(checkoutId);
    if (checkout.attributes?.livemode !== live) return res.status(400).json({ success: false });
    const bookingId = checkout.attributes?.metadata?.bookingId;
    const booking = mongoose.isValidObjectId(bookingId)
      ? await Booking.findById(bookingId) : await Booking.findOne({ paymongoCheckoutId: checkoutId });
    if (!booking) return res.status(503).json({ success: false });
    const result = await applyCapturedBookingCheckout(booking, checkout);
    if (!result.captured) return res.status(503).json({ success: false });
    if (result.updated) await notifyBookingPaymentRecorded(req, result.booking._id);
    return res.json({ success: true });
  } catch (error) {
    console.error("[Payment Webhook] Recording failed", { code: error.code || error.statusCode || "INTERNAL_ERROR" });
    return res.status(503).json({ success: false });
  }
}
