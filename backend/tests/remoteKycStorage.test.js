import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { remoteKycUrl, ensureKycEvidence, pruneUnreferencedKycCache } from "../services/remoteKycStorage.service.js";

const environment = () => ({ KYC_REMOTE_BASE_URL: "https://syntheticstorage.file.core.windows.net/synthetic/private_uploads/kyc/",
  KYC_REMOTE_READ_SAS: `sp=r&spr=https&sig=synthetic&se=${encodeURIComponent(new Date(Date.now() + 3600000).toISOString())}` });
test("remote storage refuses arbitrary hosts, traversal, write grants and expired credentials", () => {
  assert.throws(() => remoteKycUrl("../private.jpg", environment()));
  assert.throws(() => remoteKycUrl("file.jpg", { ...environment(), KYC_REMOTE_BASE_URL: "https://example.test/" }));
  assert.throws(() => remoteKycUrl("file.jpg", { ...environment(), KYC_REMOTE_READ_SAS: "sp=rw&sig=synthetic&spr=https&se=2099-01-01" }));
  assert.throws(() => remoteKycUrl("file.jpg", { ...environment(), KYC_REMOTE_READ_SAS: "sp=r&sig=synthetic&spr=https&se=2000-01-01" }));
});
test("remote evidence is hash verified before caching, and repeat previews reuse private bytes", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "remote-kyc-"));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); await fs.rm(root, { recursive: true, force: true }); });
  const env = { ...environment(), KYC_CACHE_DIR: root };
  const bytes = Buffer.from("Synthetic document evidence");
  const doc = { fileKey: "fixture.jpg", fileHash: createHash("sha256").update(bytes).digest("hex") };
  let reads = 0;
  const fetcher = async (_url, options) => { reads++; assert.equal(options.redirect, "error"); return new Response(bytes); };
  await ensureKycEvidence(doc, env, fetcher);
  await ensureKycEvidence(doc, env, fetcher);
  assert.equal(reads, 1); assert.deepEqual(await fs.readFile(path.join(root, doc.fileKey)), bytes);
  await assert.rejects(ensureKycEvidence({ ...doc, fileKey: "mismatch.jpg" }, env, async () => new Response("Different bytes")), /integrity/);
  await assert.rejects(fs.stat(path.join(root, "mismatch.jpg")));
});

test("cache retention preserves referenced evidence and removes only old unreferenced copies", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kyc-cache-retention-"));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); await fs.rm(root, { recursive: true, force: true }); });
  const old = new Date(Date.now() - 73 * 3600000);
  for (const name of ["referenced.jpg", "orphan.jpg", "recent.jpg"]) await fs.writeFile(path.join(root, name), "Synthetic cache bytes");
  for (const name of ["referenced.jpg", "orphan.jpg"]) await fs.utimes(path.join(root, name), old, old);
  const database = { collection: () => ({ countDocuments: async ({ fileKey }) => fileKey === "referenced.jpg" ? 1 : 0 }) };
  assert.equal(await pruneUnreferencedKycCache(database, root), 1);
  assert.deepEqual((await fs.readdir(root)).sort(), ["recent.jpg", "referenced.jpg"]);
});
