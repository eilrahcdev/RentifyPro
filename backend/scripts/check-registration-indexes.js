import dotenv from "dotenv";
import mongoose from "mongoose";
import { auditRegistrationUsers } from "../utils/registrationIndexAudit.js";

dotenv.config({ quiet: true });
const apply = process.argv.includes("--apply");
try {
  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  if (!uri) throw new Error("Database configuration is required.");
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10000,
    ...(process.env.MONGO_DB_NAME ? { dbName: process.env.MONGO_DB_NAME } : {}) });
  const db = mongoose.connection.db;
  const users = db.collection("users");
  const audit = auditRegistrationUsers(await users.find({}, { projection: { email: 1, phone: 1, registrationDraftId: 1 } }).toArray());
  const indexes = await users.indexes();
  const required = [
    ["email", "email_1", {}],
    ["phone", "registration_phone_unique", { partialFilterExpression: { phone: { $type: "string" } } }],
    ["registrationDraftId", "registration_draft_unique", { partialFilterExpression: { registrationDraftId: { $type: "string" } } }],
  ];
  const missing = [];
  for (const [field, name, options] of required) {
    const present = indexes.some(index => Object.keys(index.key).length === 1 && index.key[field] === 1 && index.unique
      && (field === "email" ? !index.partialFilterExpression && !index.sparse
        : !index.partialFilterExpression || JSON.stringify(index.partialFilterExpression) === JSON.stringify(options.partialFilterExpression)));
    if (!present) missing.push({ field, name, options });
  }
  const ttl = [];
  for (const collectionName of ["registrationdrafts", "prekycdocuments", "prekycfaces", "otps"]) {
    const collection = db.collection(collectionName);
    const existing = await collection.indexes().catch(error => error.codeName === "NamespaceNotFound" ? [] : Promise.reject(error));
    if (!existing.some(index => index.key.expiresAt === 1 && index.expireAfterSeconds === 0)) ttl.push(collectionName);
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "read-only", audit,
    missingUniqueIndexes: missing.map(index => index.field), missingTtlIndexes: ttl }, null, 2));
  if (apply) {
    const unsafe = missing.some(({ field }) => field === "email"
      ? audit.duplicateEmails || audit.nonCanonicalEmails
      : field === "phone" ? audit.duplicatePhones || audit.nonCanonicalPhones : audit.duplicateDrafts);
    if (unsafe) throw new Error("Existing data requires a separate reviewed correction before the missing unique indexes can be added. No records were modified.");
    for (const { field, name, options } of missing) await users.createIndex({ [field]: 1 }, { name, unique: true, ...options });
    for (const name of ttl) await db.collection(name).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_1" });
    console.log("Registration indexes are ready. No account records were modified.");
  }
} catch (error) {
  console.error(`Registration index check failed: ${error.name}. ${error.name === "Error" ? error.message : "Check connectivity or existing index compatibility."}`);
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
