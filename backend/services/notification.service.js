import Notification from "../models/Notification.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import { emitToUser } from "../socket/index.js";

const TYPE_CATEGORY_MAP = {
  booking_status: "booking",
  booking_payment: "payment",
  chat_message: "chat",
  system: "system",
};

const TYPE_EVENT_PREFIX_MAP = {
  booking_status: "booking",
  booking_payment: "payment",
  chat_message: "chat",
  system: "system",
};

const VALID_CATEGORIES = new Set(["booking", "payment", "chat", "system"]);
const VALID_PRIORITIES = new Set(["low", "normal", "important", "urgent"]);

const toIdString = (value) => {
  if (!value) return "";
  return String(value?._id || value);
};

const compactText = (value) => String(value || "").trim();
const EMAIL_ENABLED = () => String(process.env.NOTIFICATION_EMAIL_ENABLED || "").toLowerCase() === "true";
const MAX_NOTIFICATION_DATA_BYTES = 4096;
const DATA_KEYS = new Set([
  "bookingId", "vehicleId", "conversationId", "messageId", "senderId", "status", "paymentStatus",
  "walkInPaymentStatus", "cancellationStatus", "extensionStatus", "requestedReturnAt", "returnAt",
  "overdueMinutes", "isOverdue", "autoCompleted", "rating", "actions", "unreadCount", "actionUrl",
  "returnStatus", "returnRequestedAt", "actualReturnAt",
  "vehicleName", "scheduledReturnAt", "graceMinutes", "lateReturnPenaltyRatePerHour",
  "estimatedLateReturnPenaltyFee", "lateReturnPenaltyFee", "feeStatus", "rentalAmount",
  "transactionFee", "totalAmountPayable", "paymentAmountPaid", "remainingBalance",
  "paymentLocation", "paymentAction",
  "reportId", "caseReference", "sanctionType", "restrictedUntil",
]);

export const sanitizeNotificationData = (data = {}) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (!DATA_KEYS.has(key) || value === undefined || value === null) continue;
    if (Array.isArray(value)) clean[key] = value.map((item) => compactText(item).slice(0, 80)).slice(0, 10);
    else if (typeof value === "boolean" || typeof value === "number") clean[key] = value;
    else if (value instanceof Date) clean[key] = value.toISOString();
    else clean[key] = compactText(value).slice(0, 240);
  }
  while (Buffer.byteLength(JSON.stringify(clean), "utf8") > MAX_NOTIFICATION_DATA_BYTES) {
    const key = Object.keys(clean).pop();
    if (!key) break;
    delete clean[key];
  }
  return clean;
};

const slugify = (value) =>
  compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

const resolveCategory = (type, category) => {
  const normalized = compactText(category);
  if (VALID_CATEGORIES.has(normalized)) return normalized;
  return TYPE_CATEGORY_MAP[type] || "system";
};

const resolveEntity = (data = {}) => {
  const bookingId = toIdString(data.bookingId);
  if (bookingId) return { entityType: "booking", entityId: bookingId };

  const conversationId = toIdString(data.conversationId);
  if (conversationId) return { entityType: "conversation", entityId: conversationId };

  const messageId = toIdString(data.messageId);
  if (messageId) return { entityType: "message", entityId: messageId };

  const vehicleId = toIdString(data.vehicleId);
  if (vehicleId) return { entityType: "vehicle", entityId: vehicleId };

  return { entityType: "", entityId: "" };
};

const resolveEvent = ({ type = "system", event, title, data = {} }) => {
  const explicitEvent = compactText(event || data.event);
  if (explicitEvent) return explicitEvent;

  if (type === "booking_status" && data.autoCompleted) return "booking.completed";
  if (type === "booking_status" && data.isOverdue) return "booking.overdue";
  if (type === "booking_payment" && data.walkInPaymentStatus) {
    return `walkin_payment.${slugify(data.walkInPaymentStatus)}`;
  }
  if (type === "booking_payment" && data.paymentStatus) {
    return `payment.${slugify(data.paymentStatus)}`;
  }
  if (type === "chat_message") return "chat.message_received";

  const prefix = TYPE_EVENT_PREFIX_MAP[type] || "system";
  const titleSlug = slugify(title);
  return titleSlug ? `${prefix}.${titleSlug}` : prefix;
};

const resolvePriority = ({ priority, type, data = {} }) => {
  const normalized = compactText(priority);
  if (VALID_PRIORITIES.has(normalized)) return normalized;
  if (data.isOverdue) return "urgent";
  if (type === "booking_payment") return "important";
  return "normal";
};

const resolveDedupeKey = ({ dedupeKey, user, type, data = {}, event }) => {
  const explicitKey = compactText(dedupeKey || data.dedupeKey);
  if (explicitKey) return explicitKey;

  const recipientId = toIdString(user);
  const bookingId = toIdString(data.bookingId);
  if (!recipientId || !bookingId) return "";

  const normalizedEvent = compactText(event);
  if (
    normalizedEvent === "booking.completed" ||
    normalizedEvent === "booking.overdue" ||
    (type === "booking_status" && (data.autoCompleted || data.isOverdue))
  ) {
    return `${recipientId}:${normalizedEvent || type}:${bookingId}`;
  }

  return "";
};

const findExistingByDedupeKey = ({ user, dedupeKey }) => {
  if (!user || !dedupeKey) return null;
  return Notification.findOne({ user, dedupeKey });
};

const queueEmailDelivery = async (notification) => {
  if (!EMAIL_ENABLED() || !notification || notification.category === "chat") return;
  try {
    await NotificationDelivery.updateOne(
      { notification: notification._id },
      { $setOnInsert: { notification: notification._id, user: notification.user, channel: "email", status: "pending", nextAttemptAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error("[notification] Failed to queue email delivery:", error?.message || error);
  }
};

export const NotificationService = {
  async send({
    user,
    type = "system",
    category,
    event,
    priority,
    actor = null,
    title,
    message,
    data = {},
    entityType,
    entityId,
    actionUrl = "",
    dedupeKey,
    coalesce = false,
  }) {
    const recipientId = toIdString(user);
    const normalizedTitle = compactText(title);
    const normalizedMessage = compactText(message);

    if (!recipientId || !normalizedTitle || !normalizedMessage) {
      console.warn("[notification] Skipped invalid notification payload.", {
        user: recipientId,
        type,
        hasTitle: Boolean(normalizedTitle),
        hasMessage: Boolean(normalizedMessage),
      });
      return null;
    }

    const safeData = sanitizeNotificationData(data);
    const inferredEntity = resolveEntity(safeData);
    const resolvedEvent = resolveEvent({ type, event, title: normalizedTitle, data: safeData });
    const resolvedDedupeKey = resolveDedupeKey({
      dedupeKey,
      user: recipientId,
      type,
      data: safeData,
      event: resolvedEvent,
    });

    try {
      const existing = await findExistingByDedupeKey({
        user: recipientId,
        dedupeKey: resolvedDedupeKey,
      });
      if (existing) {
        if (!coalesce) return existing;
        const unreadCount = Math.min(999, Number(existing.data?.unreadCount || 0) + 1);
        existing.title = normalizedTitle;
        existing.message = normalizedMessage;
        existing.data = { ...safeData, unreadCount };
        existing.readAt = null;
        existing.archived_at = null;
        existing.lastOccurredAt = new Date();
        await existing.save();
        emitToUser(recipientId, "notification:new", existing);
        return existing;
      }

      const notification = await Notification.create({
        user: recipientId,
        type,
        category: resolveCategory(type, category),
        event: resolvedEvent,
        priority: resolvePriority({ priority, type, data }),
        actor: actor ? toIdString(actor) : null,
        entityType: compactText(entityType) || inferredEntity.entityType,
        entityId: compactText(entityId) || inferredEntity.entityId,
        actionUrl: compactText(actionUrl || data.actionUrl),
        dedupeKey: resolvedDedupeKey,
        title: normalizedTitle,
        message: normalizedMessage,
        data: safeData,
        lastOccurredAt: new Date(),
      });

      emitToUser(recipientId, "notification:new", notification);
      await queueEmailDelivery(notification);
      return notification;
    } catch (error) {
      if (error?.code === 11000) {
        return findExistingByDedupeKey({
          user: recipientId,
          dedupeKey: resolvedDedupeKey,
        });
      }

      console.error("[notification] Failed to create notification:", error?.message || error);
      return null;
    }
  },

  async sendMany(items = []) {
    const notifications = [];
    for (const item of items) {
      const notification = await this.send(item);
      if (notification) notifications.push(notification);
    }
    return notifications;
  },
};

export default NotificationService;
