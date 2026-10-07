import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = fileURLToPath(new URL("../../chatbot-service/", import.meta.url));
const targetDirectory = fileURLToPath(new URL("../data/chatbot/", import.meta.url));
const assetNames = ["chatbot_config.json", "rentifypro_chatbot_dataset_v6.json"];

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) throw new Error("Usage: node scripts/sync-chatbot-assets.js [--check]");
  const checkOnly = args.includes("--check");
  const assets = await Promise.all(assetNames.map(async (name) => {
    let contents;
    try {
      contents = await fs.readFile(path.join(sourceDirectory, name));
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`Source ${name} is missing. Run asset synchronization from the full repository checkout, before packaging the backend.`);
      throw error;
    }
    const parsed = JSON.parse(contents.toString("utf8"));
    if (name === "rentifypro_chatbot_dataset_v6.json" && parsed.schema_version !== "v6_intent_multilingual_conversational") {
      throw new Error("The source chatbot dataset must use the current v6 schema.");
    }
    return { name, contents };
  }));

  if (!checkOnly) await fs.mkdir(targetDirectory, { recursive: true });
  const mismatches = [];
  for (const { name, contents } of assets) {
    const targetPath = path.join(targetDirectory, name);
    if (checkOnly) {
      let current;
      try { current = await fs.readFile(targetPath); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (!current?.equals(contents)) mismatches.push(name);
    } else {
      await fs.writeFile(targetPath, contents);
    }
  }
  if (mismatches.length) throw new Error(`Backend chatbot assets are out of sync: ${mismatches.join(", ")}. Run npm run chatbot:assets:sync.`);
  console.log(checkOnly ? "PASS: Backend chatbot assets match the Python service sources byte-for-byte." : "Synchronized both chatbot JSON assets into backend/data/chatbot/.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
