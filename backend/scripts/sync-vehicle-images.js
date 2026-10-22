import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import "dotenv/config";
import { getVehicleUploadDir } from "../utils/localMedia.js";
import { vehicleImageSignatureMatches } from "../middleware/upload.middleware.js";
import { MAX_SHARED_VEHICLE_IMAGE_BYTES, publishSharedVehicleImage, readSharedVehicleImage, vehicleImageContentType, assertVehicleImageStorageConfiguration } from "../services/vehicleImageStorage.service.js";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export async function syncVehicleImages({ apply = false, directories = [getVehicleUploadDir(), path.resolve("uploads/vehicles")] } = {}) {
  if (apply) {
    if (process.env.VEHICLE_IMAGE_STORAGE !== "azure") throw new Error("Set VEHICLE_IMAGE_STORAGE=azure before applying the vehicle image migration.");
    assertVehicleImageStorageConfiguration();
  }
  const summary = { dryRun: !apply, eligible: 0, uploaded: 0, alreadyShared: 0, skipped: 0 };
  const seen = new Set();
  for (const directory of new Set(directories.map(value => path.resolve(value)))) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    for (const entry of entries) {
      if (seen.has(entry.name)) continue;
      const contentType = vehicleImageContentType(entry.name);
      if (!entry.isFile() || !contentType) { summary.skipped++; continue; }
      seen.add(entry.name);
      const source = path.join(directory, entry.name);
      const metadata = await fs.stat(source);
      if (!metadata.size || metadata.size > MAX_SHARED_VEHICLE_IMAGE_BYTES) { summary.skipped++; continue; }
      const bytes = await fs.readFile(source);
      if (!vehicleImageSignatureMatches(bytes, contentType)) { summary.skipped++; continue; }
      summary.eligible++;
      if (!apply) continue;
      if (await publishSharedVehicleImage(entry.name, source, { skipExisting: true })) summary.uploaded++;
      else {
        const existing = await readSharedVehicleImage(entry.name);
        if (!existing || hash(existing) !== hash(bytes)) throw new Error(`Shared image conflicts with the local file: ${entry.name}. No existing blob was overwritten.`);
        summary.alreadyShared++;
      }
    }
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--apply")) {
    console.error("Usage: node scripts/sync-vehicle-images.js [--apply]");
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await syncVehicleImages({ apply: args.includes("--apply") }), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
