import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = process.argv.find((arg) => arg.startsWith("--destination="))?.slice(14);
if (!destination || !path.isAbsolute(destination)) throw new Error("Pass --destination=<absolute admin backend/data/private-kyc directory>.");
const files = ["services/documentValidation.service.js", "services/manualDocumentComparison.js",
  "services/privateDocumentExtraction.service.js", "services/privateDocumentLayout.service.js", "services/privateKycReviewContext.js",
  "services/privateKycOcr.service.js", "utils/kycScreeningProvider.js", "utils/geminiDataPolicy.js"];
const assets = await Promise.all(files.map(async (file) => ({ file, bytes: await fs.readFile(path.join(backend, file)) })));
for (const { file, bytes } of assets) {
  const target = path.join(destination, file);
  if (process.argv.includes("--check")) {
    if (!bytes.equals(await fs.readFile(target))) throw new Error(`Admin KYC asset is stale: ${file}`);
  } else {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }
}
console.log(`${files.length} admin KYC assets ${process.argv.includes("--check") ? "matched" : "synchronized"}.`);
