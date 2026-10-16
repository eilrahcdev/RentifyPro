import path from "node:path";
import { realpath, stat, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

async function inspectedFile(directory, key, hash) {
  if (typeof key !== "string" || key !== path.basename(key) || !/^[a-z0-9][a-z0-9._-]{0,220}\.(?:jpe?g|png|webp|pdf)$/i.test(key)) return { status: "invalid" };
  if (!/^[a-f\d]{64}$/i.test(String(hash || ""))) return { status: "unverifiable" };
  try {
    const root = await realpath(directory);
    const file = await realpath(path.join(root, key));
    const info = await stat(file);
    if (path.dirname(file) !== root || !info.isFile() || info.size > 4 * 1024 * 1024) return { status: "invalid" };
    const bytes = await readFile(file);
    return { status: createHash("sha256").update(bytes).digest("hex") === hash ? "valid" : "mismatch", bytes };
  } catch (error) {
    return { status: error.code === "ENOENT" ? "missing" : "unreadable" };
  }
}

export async function inspectAndRecoverKycFiles(documents, destination, { source, apply = false } = {}) {
  const result = { total: 0, available: 0, missing: 0, invalid: 0, unverifiable: 0, mismatch: 0, unreadable: 0,
    recoverable: 0, recovered: 0 };
  for await (const document of documents) {
    result.total++;
    const current = await inspectedFile(destination, document.fileKey, document.fileHash);
    if (current.status === "valid") { result.available++; continue; }
    result[current.status]++;
    if (current.status !== "missing" || !source) continue;
    const candidate = await inspectedFile(source, document.fileKey, document.fileHash);
    if (candidate.status !== "valid") continue;
    result.recoverable++;
    if (apply) {
      const root = await realpath(destination);
      try {
        await writeFile(path.join(root, document.fileKey), candidate.bytes, { flag: "wx", mode: 0o600 });
        result.recovered++;
      } catch (error) { if (error.code !== "EEXIST") throw error; }
    }
  }
  return result;
}
