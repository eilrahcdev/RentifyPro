import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const logDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "logs");
let timer = null;

const retentionMs = () => Math.max(1, Number(process.env.AUDIT_LOG_RETENTION_DAYS || 30)) * 24 * 60 * 60 * 1000;

export const purgeExpiredAuditLogs = async () => {
  let entries = [];
  try {
    entries = await fs.readdir(logDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  const cutoff = Date.now() - retentionMs();
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^audit-\d{4}-\d{2}-\d{2}\.log$/.test(entry.name)) continue;
    const target = path.join(logDir, entry.name);
    const stat = await fs.stat(target);
    if (stat.mtimeMs < cutoff) {
      await fs.unlink(target);
      deleted += 1;
    }
  }
  return deleted;
};

export const startLogRetentionJob = () => {
  if (timer) return;
  const run = async () => {
    try {
      const deleted = await purgeExpiredAuditLogs();
      if (deleted) console.log(`[log-retention] Deleted ${deleted} expired audit log file(s).`);
    } catch (error) {
      console.error("[log-retention] Failed:", error?.message || error);
    }
  };
  void run();
  timer = setInterval(() => void run(), 24 * 60 * 60 * 1000);
  timer.unref?.();
};

export const stopLogRetentionJob = () => {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
};
