import fs from "node:fs/promises";
import path from "node:path";
import { getKycUploadDir } from "../utils/storagePaths.js";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_RETENTION_HOURS = 3;
const DEFAULT_REVIEW_RETENTION_HOURS = 72;
let cleanupTimer = null;

const parsePositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getKycRoot = getKycUploadDir;
const getCutoff = () =>
  Date.now() - parsePositiveNumber(process.env.KYC_FILE_RETENTION_HOURS, DEFAULT_RETENTION_HOURS) * 60 * 60 * 1000;
const getReviewCutoff = () =>
  Date.now() - parsePositiveNumber(
    process.env.KYC_PENDING_REVIEW_RETENTION_HOURS,
    DEFAULT_REVIEW_RETENTION_HOURS
  ) * 60 * 60 * 1000;

const walkFiles = async (directory) => {
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(target)));
    else if (entry.isFile()) files.push(target);
  }
  return files;
};

export const purgeExpiredKycFiles = async () => {
  const root = getKycRoot();
  const cutoff = getCutoff();
  const reviewCutoff = getReviewCutoff();
  const files = await walkFiles(root);
  let deleted = 0;

  for (const file of files) {
    try {
      const stats = await fs.stat(file);
      const effectiveCutoff = path.basename(file).startsWith("review-") ? reviewCutoff : cutoff;
      if (stats.mtimeMs > effectiveCutoff) continue;
      await fs.unlink(file);
      deleted += 1;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return deleted;
};

export const startKycFileCleanupJob = () => {
  if (cleanupTimer) return;
  const run = async () => {
    try {
      const deleted = await purgeExpiredKycFiles();
      if (deleted) console.log(`[kyc-file-cleanup] Permanently deleted ${deleted} expired private KYC file(s).`);
    } catch (error) {
      console.error("[kyc-file-cleanup] Failed:", error?.message || error);
    }
  };
  void run();
  cleanupTimer = setInterval(() => void run(), parsePositiveNumber(process.env.KYC_FILE_CLEANUP_INTERVAL_MS, DEFAULT_INTERVAL_MS));
  cleanupTimer.unref?.();
};

export const stopKycFileCleanupJob = () => {
  if (!cleanupTimer) return;
  clearInterval(cleanupTimer);
  cleanupTimer = null;
};
