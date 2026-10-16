import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { inspectAndRecoverKycFiles } from "../services/kycFileRecovery.service.js";

test("private-file recovery is dry by default, checks hashes, rejects traversal, and never overwrites files", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kyc-recovery-"));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); await fs.rm(root, { recursive: true, force: true }); });
  const source = path.join(root, "source"), destination = path.join(root, "destination");
  await fs.mkdir(source); await fs.mkdir(destination);
  const bytes = Buffer.from("Synthetic evidence");
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  await fs.writeFile(path.join(source, "fixture.jpg"), bytes);
  const documents = [{ fileKey: "fixture.jpg", fileHash }, { fileKey: "../escape.jpg", fileHash }];
  const dry = await inspectAndRecoverKycFiles(documents, destination, { source });
  assert.equal(dry.recoverable, 1); assert.equal(dry.invalid, 1); assert.deepEqual(await fs.readdir(destination), []);
  assert.equal((await inspectAndRecoverKycFiles(documents, destination, { source, apply: true })).recovered, 1);
  await fs.writeFile(path.join(destination, "fixture.jpg"), "Existing file");
  const next = await inspectAndRecoverKycFiles(documents, destination, { source, apply: true });
  assert.equal(next.recovered, 0); assert.equal(next.mismatch, 1);
  assert.equal(await fs.readFile(path.join(destination, "fixture.jpg"), "utf8"), "Existing file");
});
