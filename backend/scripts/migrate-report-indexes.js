/** Create report case indexes and replace the pre-message-report uniqueness index. Dry run by default. */
import "dotenv/config";
import mongoose from "mongoose";

const apply = process.argv.includes("--apply");
const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
if (!uri) throw new Error("MONGO_URI or MONGO_URI_DIRECT is required.");

const main = async () => {
  await mongoose.connect(uri, {
    ...(process.env.MONGO_DB_NAME ? { dbName: process.env.MONGO_DB_NAME } : {}),
    autoIndex: false,
  });
  const reports = mongoose.connection.db.collection("reports");
  const indexes = await reports.indexes().catch((error) => error?.codeName === "NamespaceNotFound" ? [] : Promise.reject(error));
  const legacyIndex = indexes.find((index) => index.name === "reporter_1_booking_1" && !index.partialFilterExpression);
  const missingSourceType = await reports.countDocuments({ sourceType: { $exists: false } });

  console.log(`Existing report indexes: ${indexes.map((index) => index.name).join(", ") || "none"}`);
  console.log(`Legacy booking-only uniqueness index found: ${Boolean(legacyIndex)}`);
  console.log(`Existing reports needing sourceType backfill: ${missingSourceType}`);
  if (!apply) {
    console.log("Dry run only. Re-run with --apply after a tested backup.");
    return;
  }

  await reports.updateMany(
    { sourceType: { $exists: false } },
    { $set: { sourceType: "booking" } }
  );
  await reports.updateMany(
    { priorityRank: { $exists: false } },
    [{ $set: { priorityRank: { $switch: { branches: [
      { case: { $eq: ["$priority", "urgent"] }, then: 4 },
      { case: { $eq: ["$priority", "high"] }, then: 3 },
      { case: { $eq: ["$priority", "low"] }, then: 1 },
    ], default: 2 } } } }]
  );
  if (legacyIndex) await reports.dropIndex(legacyIndex.name);
  await reports.createIndex({ caseReference: 1 }, { unique: true, name: "caseReference_1" });
  await reports.createIndex(
    { reporter: 1, booking: 1 },
    { unique: true, partialFilterExpression: { sourceType: "booking" }, name: "unique_booking_report" }
  );
  await reports.createIndex(
    { reporter: 1, reportedMessage: 1 },
    { unique: true, partialFilterExpression: { sourceType: "chat_message" }, name: "unique_message_report" }
  );
  await reports.createIndex({ status: 1, priorityRank: -1, createdAt: -1 }, { name: "status_priority_created" });
  await reports.createIndex({ reportedUser: 1, createdAt: -1 }, { name: "reported_user_created" });
  console.log("Report index migration complete.");
};

main()
  .catch((error) => { console.error("Report index migration failed:", error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
