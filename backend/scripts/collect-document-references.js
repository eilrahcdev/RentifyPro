import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DOCUMENT_REFERENCE_SOURCES } from "../data/documentReferences.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "docs/document-references");
const manifestPath = path.join(output, "archives.json");
const maximum = 8 * 1024 * 1024;
const entries = Object.entries(DOCUMENT_REFERENCE_SOURCES).filter(([, value]) => value.archive);

async function verifyArchive(entry) {
  const bytes = await fs.readFile(path.join(output, entry.file));
  return bytes.subarray(0, 5).toString() === "%PDF-" && bytes.length === entry.bytes
    && crypto.createHash("sha256").update(bytes).digest("hex") === entry.sha256;
}

if (process.argv.includes("--check")) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.entries.length !== entries.length) throw Error("Reference archive manifest is incomplete.");
  for (const [id, reference] of entries) {
    const entry = manifest.entries.find(item => item.sourceId === id);
    if (!entry || entry.file !== reference.archive || entry.url !== reference.url) throw Error(`Reference archive metadata is stale: ${id}`);
    if (entry.status === "downloaded" && !await verifyArchive(entry)) throw Error(`Reference archive integrity failed: ${id}`);
    if (!["downloaded", "unavailable"].includes(entry.status)) throw Error(`Invalid reference archive status: ${id}`);
  }
  console.log(JSON.stringify({ checked: entries.length, downloaded: manifest.entries.filter(entry => entry.status === "downloaded").length }));
} else {
  if (!process.argv.includes("--collect")) throw Error("Use --collect to retrieve the catalog's public PDF references, or --check to verify local hashes.");
  await fs.mkdir(output, { recursive: true });
  const previous = await fs.readFile(manifestPath, "utf8").then(JSON.parse).catch(error => {
    if (error.code === "ENOENT") return { entries: [] }; throw error;
  });
  const collected = [];
  for (const [id, reference] of entries) {
    const existing = previous.entries.find(entry => entry.sourceId === id && entry.status === "downloaded" && entry.url === reference.url && entry.file === reference.archive);
    if (existing && await verifyArchive(existing)) { collected.push(existing); continue; }
    try {
      const response = await fetch(reference.url, { signal: AbortSignal.timeout(20000), redirect: "error" });
      if (!response.ok) { await response.body?.cancel(); throw Error(`HTTP ${response.status}`); }
      const reader = response.body.getReader();
      const chunks = []; let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.length;
          if (length > maximum) { await reader.cancel(); throw Error("PDF exceeds the archive size limit"); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      const bytes = Buffer.concat(chunks);
      if (bytes.subarray(0, 5).toString() !== "%PDF-") throw Error("Response is not a PDF");
      // Existing source snapshots are immutable; a changed source needs a new filename and catalog revision.
      await fs.writeFile(path.join(output, reference.archive), bytes, { flag: "wx" });
      collected.push({ sourceId: id, file: reference.archive, url: reference.url, status: "downloaded", retrievedAt: new Date().toISOString(),
        bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
    } catch (error) {
      if (error.code === "EEXIST") throw Error(`Review the existing archive before replacing it: ${reference.archive}`);
      collected.push({ sourceId: id, file: reference.archive, url: reference.url, status: "unavailable", checkedAt: new Date().toISOString(),
        reason: error.name === "TimeoutError" ? "Timed out" : error.message.slice(0, 160) });
    }
  }
  await fs.writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, entries: collected }, null, 2) + "\n");
  console.log(JSON.stringify({ sources: collected.length, downloaded: collected.filter(entry => entry.status === "downloaded").length,
    unavailable: collected.filter(entry => entry.status === "unavailable").map(entry => entry.sourceId) }));
}
