// Additive registration-draft indexes. Dry run by default; existing data is untouched.
import dotenv from "dotenv";
import mongoose from "mongoose";
dotenv.config({ quiet: true });
const apply = process.argv.includes("--apply");
try {
  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  if (!uri) throw new Error("Database configuration is required.");
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10000,
    ...(process.env.MONGO_DB_NAME ? { dbName: process.env.MONGO_DB_NAME } : {}) });
  const collection = mongoose.connection.db.collection("registrationdrafts");
  const indexes = await collection.indexes().catch(error => error.codeName === "NamespaceNotFound" ? [] : Promise.reject(error));
  console.log(`Registration draft indexes: ${indexes.map(index => index.name).join(", ") || "none"}`);
  if (apply) {
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_1" });
    await collection.createIndex({ sessionId: 1 }, { name: "sessionId_1" });
    console.log("Registration draft indexes are ready.");
  } else console.log("Dry run. Use --apply to create the additive TTL and session indexes.");
} catch (error) { console.error(`Registration draft index check failed: ${error.name}`); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
