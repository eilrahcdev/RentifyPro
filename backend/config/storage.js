import path from "node:path";
import { fileURLToPath } from "node:url";
import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";

const backend = fileURLToPath(new URL("../", import.meta.url));
export function remoteKycConfigured(env = process.env) {
  return Boolean(env.KYC_REMOTE_BASE_URL && env.KYC_REMOTE_READ_SAS);
}
export function getAdminStoragePaths(env = process.env) {
  const website = path.resolve(env.WEBSITE_BACKEND_DIR || path.join(backend, "..", "..", "rentifypro", "backend"));
  const root = path.resolve(env.STORAGE_ROOT || website);
  return { root, website, publicUploads: path.resolve(env.PUBLIC_UPLOAD_DIR || path.join(root, "uploads")),
    kyc: path.resolve(remoteKycConfigured(env) ? env.KYC_CACHE_DIR || path.join(backend, "private_uploads", "kyc-cache")
      : env.KYC_UPLOAD_DIR || path.join(root, "private_uploads", "kyc")),
    reports: path.resolve(env.REPORT_EVIDENCE_DIR || path.join(root, "private_uploads", "reports")) };
}

export async function checkAdminStorage(env = process.env) {
  const paths = getAdminStoragePaths(env);
  const checks = {};
  for (const key of ["kyc", "reports"]) {
    try {
      await access(paths[key], constants.R_OK);
      const actual = await realpath(paths[key]);
      if (!(await stat(actual)).isDirectory()) { checks[key] = false; continue; }
      const publicRoot = await realpath(paths.publicUploads).catch(() => paths.publicUploads);
      const relative = path.relative(publicRoot, actual);
      checks[key] = relative !== "" && (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
    } catch { checks[key] = false; }
  }
  let remote = null;
  if (remoteKycConfigured(env)) {
    remote = { readable: false, expiresAt: null, renewSoon: true };
    try {
      const { remoteKycUrl } = await import("../services/remoteKycStorage.service.js");
      const probe = remoteKycUrl("readiness-probe.jpg", env);
      const expiresAt = new Date(new URLSearchParams(String(env.KYC_REMOTE_READ_SAS).replace(/^\?/, "")).get("se"));
      const response = await fetch(probe, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(3000) });
      remote = { readable: [200, 404].includes(response.status), expiresAt: expiresAt.toISOString(), renewSoon: expiresAt.getTime() - Date.now() < 7 * 86400000 };
    } catch { /* Credential and network failures make readiness false without exposing the signed URL. */ }
  }
  const durable = Boolean(remote?.readable) || (Boolean(env.STORAGE_ROOT)
    && path.isAbsolute(env.STORAGE_ROOT) && env.STORAGE_DURABILITY_CONFIRMED === "true");
  return { ready: (env.NODE_ENV !== "production" || durable) && Object.values(checks).every(Boolean) && (!remote || remote.readable), durable, ...checks, remote };
}
