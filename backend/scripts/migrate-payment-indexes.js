import "dotenv/config";
import mongoose from "mongoose";

const apply = process.argv.includes("--apply");
async function main() {
  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  if (!uri) throw new Error("A MongoDB URI is required.");
  await mongoose.connect(uri, {
    ...(process.env.MONGO_DB_NAME ? { dbName: process.env.MONGO_DB_NAME } : {}),
    autoIndex: false, serverSelectionTimeoutMS: 10_000,
  });
  const collection = mongoose.connection.db.collection("bookings");
  const indexes = await collection.indexes().catch((error) => error.codeName === "NamespaceNotFound" ? [] : Promise.reject(error));
  console.log(`Payment reconciliation index: ${indexes.some((index) => index.name === "payment_reconciliation_queue") ? "present" : "missing"}`);
  if (!apply) return console.log("Dry run only. Back up and verify the target, then rerun with --apply.");
  await collection.createIndex({ paymentLastCheckedAt: 1, _id: 1 }, {
    name: "payment_reconciliation_queue", partialFilterExpression: { paymongoCheckoutId: { $type: "string" } },
  });
  console.log("Payment reconciliation index is ready. No booking records were changed.");
}
main().catch((error) => { console.error("Payment index migration failed:", error.code || error.name); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
