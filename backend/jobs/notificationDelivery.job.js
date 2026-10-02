import NotificationDelivery from "../models/NotificationDelivery.js";
import { sendNotificationEmail } from "../utils/sendEmail.js";

const INTERVAL_MS = Math.max(10_000, Number(process.env.NOTIFICATION_DELIVERY_INTERVAL_MS || 60_000));
const LOCK_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 5;
let timer = null;
let running = false;

const backoffMs = (attempts) => Math.min(24 * 60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempts - 1));

const claimNextDelivery = async () => {
  const now = new Date();
  return NotificationDelivery.findOneAndUpdate(
    {
      channel: "email",
      attempts: { $lt: MAX_ATTEMPTS },
      nextAttemptAt: { $lte: now },
      $or: [{ status: "pending" }, { status: "failed" }, { status: "processing", lockedUntil: { $lte: now } }],
    },
    { $set: { status: "processing", lockedUntil: new Date(now.getTime() + LOCK_MS) }, $inc: { attempts: 1 } },
    { new: true, sort: { nextAttemptAt: 1 } }
  ).populate("notification user", "title message actionUrl category event email notificationSettings");
};

const isEmailAllowed = (delivery) => {
  const user = delivery.user;
  const notification = delivery.notification;
  if (!user?.email || !notification) return false;
  const settings = user.notificationSettings || {};
  if (settings.email === false) return false;
  if (["booking", "payment"].includes(notification.category) && settings.bookingUpdates === false) return false;
  // Chat delivery stays in-app to avoid one email per conversation message.
  return notification.category !== "chat";
};

const processOneDelivery = async () => {
  const delivery = await claimNextDelivery();
  if (!delivery) return false;
  if (!isEmailAllowed(delivery)) {
    await NotificationDelivery.updateOne({ _id: delivery._id, status: "processing" }, { $set: { status: "skipped", lockedUntil: null } });
    return true;
  }
  try {
    await sendNotificationEmail({
      to: delivery.user.email,
      title: delivery.notification.title,
      message: delivery.notification.message,
      actionUrl: delivery.notification.actionUrl,
    });
    await NotificationDelivery.updateOne({ _id: delivery._id, status: "processing" }, { $set: { status: "sent", sentAt: new Date(), lockedUntil: null, lastError: "" } });
  } catch (error) {
    const exhausted = delivery.attempts >= MAX_ATTEMPTS;
    await NotificationDelivery.updateOne(
      { _id: delivery._id, status: "processing" },
      { $set: { status: exhausted ? "failed" : "failed", lockedUntil: null, nextAttemptAt: new Date(Date.now() + backoffMs(delivery.attempts)), lastError: String(error?.message || error).slice(0, 500) } }
    );
  }
  return true;
};

export const runNotificationDeliveryBatch = async () => {
  if (running || String(process.env.NOTIFICATION_EMAIL_ENABLED || "").toLowerCase() !== "true") return 0;
  running = true;
  try {
    let processed = 0;
    while (processed < 25 && (await processOneDelivery())) processed += 1;
    return processed;
  } finally {
    running = false;
  }
};

export const startNotificationDeliveryJob = () => {
  if (timer) return;
  const run = () => void runNotificationDeliveryBatch().catch((error) => console.error("[notification-delivery] Failed:", error?.message || error));
  run();
  timer = setInterval(run, INTERVAL_MS);
  timer.unref?.();
};

export const stopNotificationDeliveryJob = () => {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
};
