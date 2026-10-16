import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getAdminStoragePaths, remoteKycConfigured } from "../config/storage.js";

const MAX_BYTES = 4 * 1024 * 1024;
const inFlight = new Map();
let cacheScanAfter = "";
export const defaultKycCacheDirectory = fileURLToPath(new URL("../private_uploads/kyc-cache", import.meta.url));
const fail = message => Object.assign(new Error(message), { status: 503, code: "KYC_STORAGE_UNAVAILABLE", expose: true });
export function remoteKycUrl(key, env = process.env) {
  if (typeof key !== "string" || key !== path.basename(key) || !/^[a-z0-9][a-z0-9._-]{0,220}\.(?:jpe?g|png|webp|pdf)$/i.test(key)) throw fail("Invalid private document reference.");
  let base;
  try { base = new URL(env.KYC_REMOTE_BASE_URL); } catch { throw fail("Private remote storage is not configured."); }
  if (base.protocol !== "https:" || !/^[a-z\d]{3,24}\.file\.core\.windows\.net$/i.test(base.hostname)
    || base.port || base.username || base.password || base.search || base.hash || !/^\/[a-z\d-]+\/private_uploads\/kyc\/?$/i.test(base.pathname)) {
    throw fail("Private remote storage must use the configured Azure Files KYC directory.");
  }
  const sas = new URLSearchParams(String(env.KYC_REMOTE_READ_SAS || "").replace(/^\?/, ""));
  if (sas.get("sp") !== "r" || sas.get("spr") !== "https" || !sas.get("sig") || !(new Date(sas.get("se")) > new Date())) {
    throw fail("The private storage read credential is missing, expired, or not restricted to HTTPS read access.");
  }
  return new URL(`${base.href.replace(/\/$/, "")}/${encodeURIComponent(key)}?${sas}`).href;
}

async function fetchEvidence(document, env, fetcher) {
  const directory = getAdminStoragePaths(env).kyc;
  const url = remoteKycUrl(document.fileKey, env);
  if (!/^[a-f\d]{64}$/i.test(String(document.fileHash || ""))) throw fail("The document has no verifiable file hash. Ask for a replacement upload.");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const root = await fs.realpath(directory);
  const target = path.join(root, document.fileKey);
  const verify = bytes => bytes.length > 0 && bytes.length <= MAX_BYTES
    && createHash("sha256").update(bytes).digest("hex") === document.fileHash;
  try {
    const actual = await fs.realpath(target);
    const info = await fs.stat(actual);
    if (path.dirname(actual) !== root || !info.isFile() || info.size > MAX_BYTES || !verify(await fs.readFile(actual))) {
      throw fail("Private document integrity check failed. Investigate storage or request a replacement.");
    }
    return directory;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  let response;
  try { response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store" }); }
  catch { throw fail("Azure private storage could not be reached. Retry the preview."); }
  if (!response.ok) {
    await response.body?.cancel();
    throw fail(response.status === 404 ? "The original document is missing from Azure private storage. Restore it or request a replacement."
      : "Azure private storage denied access. Check the private read credential and retry.");
  }
  if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body?.cancel(); throw fail("The private file exceeds the permitted size."); }
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_BYTES) throw fail("The private file exceeds the permitted size.");
      chunks.push(Buffer.from(chunk));
    }
  } catch { throw fail("The private file could not be downloaded completely. Retry the preview."); }
  const bytes = Buffer.concat(chunks);
  if (!verify(bytes)) throw fail("Azure document integrity check failed. Investigate storage or request a replacement.");
  try { await fs.writeFile(target, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error.code !== "EEXIST" || path.dirname(await fs.realpath(target)) !== root || !verify(await fs.readFile(target))) throw fail("The private document could not be cached securely.");
  }
  return directory;
}

export async function ensureKycEvidence(document, env = process.env, fetcher = fetch) {
  if (!remoteKycConfigured(env)) return getAdminStoragePaths(env).kyc;
  const key = `${getAdminStoragePaths(env).kyc}:${document.fileKey}:${document.fileHash}`;
  if (!inFlight.has(key)) inFlight.set(key, fetchEvidence(document, env, fetcher).finally(() => inFlight.delete(key)));
  return inFlight.get(key);
}

export async function pruneUnreferencedKycCache(database, directory = defaultKycCacheDirectory, now = Date.now()) {
  let root;
  try { root = await fs.realpath(directory); } catch (error) { if (error.code === "ENOENT") return 0; throw error; }
  const expected = path.resolve(directory);
  const normalize = value => process.platform === "win32" ? value.toLowerCase() : value;
  if (normalize(root) !== normalize(expected)) throw fail("Private cache cleanup refused a redirected directory.");
  let removed = 0;
  const entries = (await fs.readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isFile() && /^[a-z0-9][a-z0-9._-]{0,220}\.(?:jpe?g|png|webp|pdf)$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const next = entries.findIndex(entry => entry.name.localeCompare(cacheScanAfter) > 0);
  const batch = entries.slice(next < 0 ? 0 : next, (next < 0 ? 0 : next) + 25);
  for (const entry of batch) {
    const file = path.resolve(root, entry.name);
    let info;
    try { info = await fs.stat(file); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (path.dirname(file) !== root || info.mtimeMs > now - 72 * 3600000) continue;
    if (await database.collection("prekycdocuments").countDocuments({ fileKey: entry.name })) continue;
    await fs.unlink(file); removed++;
  }
  cacheScanAfter = batch.at(-1)?.name || "";
  return removed;
}
