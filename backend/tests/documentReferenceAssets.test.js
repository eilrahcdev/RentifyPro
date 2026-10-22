import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("archived public references retain their source metadata and exact SHA-256 hashes without a network request", () => {
  const output = execFileSync(process.execPath, [path.join(backend, "scripts/collect-document-references.js"), "--check"], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(output), { checked: 4, downloaded: 4 });
});

test("admin synchronization includes the reference catalog and every new imported runtime dependency", async t => {
  const tempRoot = path.resolve(os.tmpdir());
  const destination = await fs.mkdtemp(path.join(tempRoot, "rentifypro-reference-sync-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(destination)), tempRoot);
    await fs.rm(destination, { recursive: true, force: true });
  });
  execFileSync(process.execPath, [path.join(backend, "scripts/sync-admin-kyc-assets.js"), `--destination=${destination}`]);
  const preservedPath = path.join(destination, "services/privateKycReviewContext.js");
  const originalTimestamp = (await fs.stat(preservedPath, { bigint: true })).mtimeNs;
  execFileSync(process.execPath, [path.join(backend, "scripts/sync-admin-kyc-assets.js"), `--destination=${destination}`]);
  assert.equal((await fs.stat(preservedPath, { bigint: true })).mtimeNs, originalTimestamp, "Identical shared files must not be rewritten");
  execFileSync(process.execPath, [path.join(backend, "scripts/sync-admin-kyc-assets.js"), `--destination=${destination}`, "--check"]);
  await fs.writeFile(path.join(destination, "package.json"), '{"type":"module"}');
  const { evaluatePrivateDocumentInspection } = await import(pathToFileURL(path.join(destination, "services/privateDocumentExtraction.service.js")));
  assert.equal(typeof evaluatePrivateDocumentInspection, "function");
  const { DOCUMENT_REFERENCE_CATALOG } = await import(pathToFileURL(path.join(destination, "data/documentReferences.js")));
  assert.equal(DOCUMENT_REFERENCE_CATALOG.documents.length, 17);
});
