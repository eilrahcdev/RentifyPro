import Notification from "../models/Notification.js";

const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const retentionDays = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const cutoffDaysAgo = (now, days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

const parseCleanupInterval = () => {
  const raw = Number(process.env.NOTIFICATION_CLEANUP_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CLEANUP_INTERVAL_MS;
  return Math.floor(raw);
};

let cleanupTimer = null;

export const purgeArchivedNotifications = async (now = new Date()) => {
  const readArchiveCutoff = cutoffDaysAgo(now, retentionDays("READ_NOTIFICATION_RETENTION_DAYS", 30));
  const archivedCutoff = cutoffDaysAgo(now, retentionDays("NOTIFICATION_ARCHIVE_RETENTION_DAYS", 90));
  await Notification.updateMany(
    { archived_at: null, deleted_at: null, readAt: { $lte: readArchiveCutoff } },
    { $set: { archived_at: now } }
  );
  const result = await Notification.deleteMany({
    $or: [
      { archived_at: { $lte: archivedCutoff } },
      // Legacy safety: remove rows soft-deleted by the previous implementation.
      { deleted_at: { $exists: true, $ne: null } },
    ],
  });
  return result.deletedCount || 0;
};

export const startNotificationCleanupJob = () => {
  if (cleanupTimer) return;

  const runCleanup = async () => {
    try {
      const deletedCount = await purgeArchivedNotifications();
      if (deletedCount > 0) {
        console.log(`[notification-cleanup] Permanently deleted ${deletedCount} notifications.`);
      }
    } catch (error) {
      console.error("[notification-cleanup] Failed:", error?.message || error);
    }
  };

  void runCleanup();
  cleanupTimer = setInterval(() => {
    void runCleanup();
  }, parseCleanupInterval());

  if (typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }
};

export const stopNotificationCleanupJob = () => {
  if (!cleanupTimer) return;
  clearInterval(cleanupTimer);
  cleanupTimer = null;
};
