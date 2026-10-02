import mongoose from "mongoose";
import Notification from "../models/Notification.js";
import NotificationDelivery from "../models/NotificationDelivery.js";

const DEFAULT_LIMIT = 100; // Backward-compatible for existing clients; new clients can request smaller cursor pages.
const MAX_LIMIT = 100;

const activeUserNotificationScope = (userId) => ({
  user: userId,
  archived_at: null,
  deleted_at: null, // Legacy rows remain hidden until their cleanup period ends.
});

const archivedUserNotificationScope = (userId) => ({
  user: userId,
  archived_at: { $ne: null },
  deleted_at: null,
});

const parseLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_LIMIT) : DEFAULT_LIMIT;
};

const parseCursor = (value) => {
  if (!value) return null;
  try {
    const cursor = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    const lastOccurredAt = new Date(cursor?.lastOccurredAt);
    if (!mongoose.Types.ObjectId.isValid(cursor?._id) || Number.isNaN(lastOccurredAt.getTime())) return null;
    return { _id: new mongoose.Types.ObjectId(cursor._id), lastOccurredAt };
  } catch {
    return null;
  }
};

const makeCursor = (notification) =>
  Buffer.from(JSON.stringify({ _id: String(notification._id), lastOccurredAt: notification.lastOccurredAt || notification.createdAt })).toString("base64url");

const parseIds = (ids) => {
  if (!Array.isArray(ids)) return [];
  const unique = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, MAX_LIMIT);
  if (unique.some((id) => !mongoose.Types.ObjectId.isValid(id))) return null;
  return unique.map((id) => new mongoose.Types.ObjectId(id));
};

export const getMyNotifications = async (req, res) => {
  try {
    const archived = String(req.query.archived || "").toLowerCase() === "true";
    const status = String(req.query.status || "all").toLowerCase();
    const limit = parseLimit(req.query.limit);
    const cursor = parseCursor(req.query.cursor);
    const scope = archived
      ? archivedUserNotificationScope(req.user._id)
      : activeUserNotificationScope(req.user._id);

    if (status === "unread") scope.readAt = null;
    if (status === "read") scope.readAt = { $ne: null };
    if (cursor) {
      scope.$or = [
        { lastOccurredAt: { $lt: cursor.lastOccurredAt } },
        { lastOccurredAt: cursor.lastOccurredAt, _id: { $lt: cursor._id } },
      ];
    }

    const notifications = await Notification.find(scope)
      .sort({ lastOccurredAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const hasMore = notifications.length > limit;
    const page = hasMore ? notifications.slice(0, limit) : notifications;

    res.json({
      success: true,
      notifications: page,
      pagination: {
        limit,
        hasMore,
        nextCursor: hasMore && page.length ? makeCursor(page[page.length - 1]) : null,
      },
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch notifications." });
  }
};

export const getUnreadNotificationCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({ ...activeUserNotificationScope(req.user._id), readAt: null });
    res.json({ success: true, unreadCount: count });
  } catch {
    res.status(500).json({ success: false, message: "Failed to count notifications." });
  }
};

export const markNotificationAsRead = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid notification ID." });
  }
  try {
    const scope = { ...activeUserNotificationScope(req.user._id), _id: req.params.id };
    await Notification.updateOne({ ...scope, readAt: null }, { $set: { readAt: new Date() } });
    const notification = await Notification.findOne(scope);
    if (!notification) return res.status(404).json({ success: false, message: "Notification not found." });
    res.json({ success: true, notification });
  } catch {
    res.status(500).json({ success: false, message: "Failed to mark notification as read." });
  }
};

export const markAllNotificationsAsRead = async (req, res) => {
  const ids = parseIds(req.body?.ids);
  if (ids === null) return res.status(400).json({ success: false, message: "Notification IDs are invalid." });
  try {
    const scope = { ...activeUserNotificationScope(req.user._id), readAt: null, ...(ids.length ? { _id: { $in: ids } } : {}) };
    const result = await Notification.updateMany(scope, { $set: { readAt: new Date() } });
    res.json({ success: true, message: "Notifications marked as read.", modifiedCount: result.modifiedCount || 0 });
  } catch {
    res.status(500).json({ success: false, message: "Failed to update notifications." });
  }
};

export const deleteAllReadNotifications = async (req, res) => {
  try {
    const scope = { ...activeUserNotificationScope(req.user._id), readAt: { $ne: null } };
    const notificationIds = await Notification.find(scope).distinct("_id");
    const result = await Notification.deleteMany(scope);
    if (notificationIds.length) {
      await NotificationDelivery.deleteMany({ user: req.user._id, notification: { $in: notificationIds } });
    }
    res.json({ success: true, message: "Read notifications deleted.", deletedCount: result.deletedCount || 0 });
  } catch {
    res.status(500).json({ success: false, message: "Failed to delete read notifications." });
  }
};

export const archiveNotification = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid notification ID." });
  }
  try {
    const notification = await Notification.findOneAndUpdate(
      { ...activeUserNotificationScope(req.user._id), _id: req.params.id },
      { $set: { archived_at: new Date() } },
      { new: true }
    );
    if (!notification) return res.status(404).json({ success: false, message: "Notification not found." });
    res.json({ success: true, notification });
  } catch {
    res.status(500).json({ success: false, message: "Failed to archive notification." });
  }
};

export const restoreNotification = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid notification ID." });
  }
  try {
    const notification = await Notification.findOneAndUpdate(
      { ...archivedUserNotificationScope(req.user._id), _id: req.params.id },
      { $set: { archived_at: null } },
      { new: true }
    );
    if (!notification) return res.status(404).json({ success: false, message: "Archived notification not found." });
    res.json({ success: true, notification });
  } catch {
    res.status(500).json({ success: false, message: "Failed to restore notification." });
  }
};

export const deleteNotification = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid notification ID." });
  }
  try {
    const notification = await Notification.findOneAndDelete({
      user: req.user._id,
      _id: req.params.id,
      deleted_at: null,
    });
    if (!notification) return res.status(404).json({ success: false, message: "Notification not found." });

    await NotificationDelivery.deleteMany({ user: req.user._id, notification: notification._id });
    res.json({ success: true, message: "Notification deleted." });
  } catch {
    res.status(500).json({ success: false, message: "Failed to delete notification." });
  }
};
