/** Create indexes for durable, expiring logout revocations. Dry run by default. */
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

  const collection = mongoose.connection.db.collection("revokedsessions");
  const indexes = await collection.indexes().catch((error) =>
    error?.codeName === "NamespaceNotFound" ? [] : Promise.reject(error)
  );
  console.log(`Existing revoked-session indexes: ${indexes.map((index) => index.name).join(", ") || "none"}`);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to create the lookup and expiry indexes.");
    return;
  }

  await collection.createIndex({ tokenHash: 1 }, { name: "tokenHash_1" });
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_1" });
  console.log("Session revocation indexes are ready.");
};

main()
  .catch((error) => { console.error("Session revocation index migration failed:", error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
