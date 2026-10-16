import path from "node:path";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import { getAdminStoragePaths, checkAdminStorage } from "../config/storage.js";
import { getMongoConnectionConfig } from "../config/mongoConnection.js";
import { inspectAndRecoverKycFiles } from "../services/kycFileRecovery.service.js";
import { ensureKycEvidence } from "../services/remoteKycStorage.service.js";

const backend = fileURLToPath(new URL("../", import.meta.url));
dotenv.config({ path: path.join(backend, ".env"), quiet: true });
dotenv.config({ path: path.join(getAdminStoragePaths().website, ".env"), quiet: true });
const source = process.argv.find(arg => arg.startsWith("--recover-from="))?.slice(15);
const apply = process.argv.includes("--apply");
let connection;
try {
  if (source && !path.isAbsolute(source)) throw new Error("The recovery source must be an absolute directory.");
  if (apply && !source) throw new Error("--apply requires --recover-from=<absolute private directory>.");
  const { uri, options } = getMongoConnectionConfig();
  connection = await mongoose.createConnection(uri, { ...options, autoIndex: false, autoCreate: false }).asPromise();
  const cursor = connection.db.collection("prekycdocuments").find({}, { projection: { fileKey: 1, fileHash: 1 } }).batchSize(100);
  let remoteUnavailable = 0;
  async function* documentsToCheck() {
    for await (const document of cursor) {
      if (process.argv.includes("--fetch-remote")) {
        try { await ensureKycEvidence(document); } catch { remoteUnavailable++; }
      }
      yield document;
    }
  }
  const documents = documentsToCheck();
  const files = await inspectAndRecoverKycFiles(documents, getAdminStoragePaths().kyc, { source, apply });
  console.log(JSON.stringify({ database: "connected", storage: await checkAdminStorage(), files, remoteUnavailable, applied: apply }, null, 2));
  if (files.missing > files.recovered || files.invalid || files.unverifiable || files.mismatch || files.unreadable) process.exitCode = 1;
} catch (error) {
  console.error(error.code === "KYC_STORAGE_UNAVAILABLE" ? error.message : ["MongoServerSelectionError", "MongooseServerSelectionError", "MongoParseError"].includes(error.name)
    ? `Storage check could not connect to the configured database (${error.name}).` : "Storage check failed. Check source/destination access and database configuration.");
  process.exitCode = 1;
} finally { if (connection) await connection.close(); }
