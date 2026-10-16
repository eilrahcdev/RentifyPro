import mongoose from "mongoose";
import AdminAuditLog from "../models/AdminAuditLog.js";
import { finishAdminKycDecision } from "./privateKycReview.service.js";
import { defaultKycCacheDirectory, pruneUnreferencedKycCache } from "./remoteKycStorage.service.js";
import { getAdminStoragePaths, remoteKycConfigured } from "../config/storage.js";

let running = false;
let timer;
export const recoveryStatus = { lastRunAt: null, lastSuccessAt: null, failed: false };

export async function recoverAdminOperations(database = mongoose.connection.db) {
  if (running || !database) return;
  running = true;
  recoveryStatus.lastRunAt = new Date();
  let failed = false;
  try {
    const documents = await database.collection("prekycdocuments").find({ adminDecisionPending: { $exists: true } })
      .sort({ "adminDecisionPending.queuedAt": 1 }).limit(25).toArray();
    for (const document of documents) {
      try { await finishAdminKycDecision(database, document); } catch { failed = true; }
    }
    for (const name of ["users", "reports", "prekycdocuments"]) {
      const collection = database.collection(name);
      const targets = await collection.find({ "adminAuditOutbox.0": { $exists: true } }, { projection: { adminAuditOutbox: 1 } }).limit(25).toArray();
      for (const target of targets) for (const record of (target.adminAuditOutbox || []).slice(0, 100)) {
        try {
          try { await AdminAuditLog.create(record); } catch (error) { if (error.code !== 11000) throw error; }
          await collection.updateOne({ _id: target._id }, { $pull: { adminAuditOutbox: { _id: record._id } } });
        } catch { failed = true; }
      }
    }
    const audits = await database.collection("adminauditoutbox").find({}).sort({ createdAt: 1 }).limit(25).toArray();
    for (const audit of audits) {
      try {
        try { await AdminAuditLog.create(audit.record); }
        catch (error) { if (error.code !== 11000) throw error; }
        await database.collection("adminauditoutbox").deleteOne({ _id: audit._id });
      } catch { failed = true; }
    }
    if (remoteKycConfigured() && getAdminStoragePaths().kyc === defaultKycCacheDirectory) await pruneUnreferencedKycCache(database);
    if (!failed) recoveryStatus.lastSuccessAt = new Date();
  } catch { failed = true; }
  finally { recoveryStatus.failed = failed; running = false; }
}

export function startAdminRecoveryJob() {
  if (timer) return;
  void recoverAdminOperations();
  timer = setInterval(() => void recoverAdminOperations(), 30_000);
  timer.unref?.();
}
