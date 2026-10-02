/** Backfill notification lifecycle fields and create the new query/delivery indexes. Dry run by default. */
import "dotenv/config";
import mongoose from "mongoose";

const apply = process.argv.includes("--apply");
const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
if (!uri) throw new Error("MONGO_URI or MONGO_URI_DIRECT is required.");

const main = async () => {
  await mongoose.connect(uri, { ...(process.env.MONGO_DB_NAME ? { dbName: process.env.MONGO_DB_NAME } : {}), autoIndex: false });
  const db = mongoose.connection.db;
  const notifications = db.collection("notifications");
  const deliveries = db.collection("notificationdeliveries");
  const missingLastOccurredAt = await notifications.countDocuments({ lastOccurredAt: { $exists: false } });
  console.log(`Notifications needing lastOccurredAt: ${missingLastOccurredAt}`);
  if (!apply) {
    console.log("Dry run only. Re-run with --apply after a tested backup.");
    return;
  }
  await notifications.updateMany(
    { lastOccurredAt: { $exists: false } },
    [{ $set: { lastOccurredAt: { $ifNull: ["$createdAt", "$$NOW"] } } }]
  );
  await notifications.createIndex({ user: 1, archived_at: 1, lastOccurredAt: -1, _id: -1 }, { name: "user_archive_lastOccurred" });
  await notifications.createIndex({ user: 1, archived_at: 1, readAt: 1, lastOccurredAt: -1 }, { name: "user_archive_read_lastOccurred" });
  await notifications.createIndex({ user: 1, category: 1, readAt: 1, lastOccurredAt: -1 }, { name: "user_category_read_lastOccurred" });
  await notifications.createIndex({ entityType: 1, entityId: 1, lastOccurredAt: -1 }, { name: "entity_lastOccurred" });
  await deliveries.createIndex({ notification: 1 }, { unique: true, name: "notification_1" });
  await deliveries.createIndex({ status: 1, nextAttemptAt: 1, lockedUntil: 1 }, { name: "status_nextAttempt_lock" });
  console.log("Notification migration complete. Do not drop legacy indexes until $indexStats confirms they are unused.");
};

main().catch((error) => { console.error("Notification migration failed:", error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
