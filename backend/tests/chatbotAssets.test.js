import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { getChatbotDatasetInfo } from "../utils/chatbotPayload.js";

const run = promisify(execFile);
const backendDirectory = fileURLToPath(new URL("../", import.meta.url));
const sourceDirectory = fileURLToPath(new URL("../../chatbot-service/", import.meta.url));

test("backend chatbot metadata matches the current Python service sources", async (t) => {
  try { await fs.access(sourceDirectory); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("Source synchronization is checked in the full repository checkout.");
    return;
  }
  const { stdout } = await run(process.execPath, [path.join(backendDirectory, "scripts/sync-chatbot-assets.js"), "--check"], {
    cwd: os.tmpdir(), timeout: 10000, windowsHide: true,
  });
  assert.match(stdout, /match the Python service sources byte-for-byte/);
});

test("chatbot payload loads a backend-only deployment with no sibling Python service", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rentify-chatbot-standalone-"));
  const deploymentDirectory = path.join(root, "wwwroot");
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("rentify-chatbot-standalone-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  for (const file of [
    "package.json", "utils/chatbotPayload.js", "utils/pricing.js", "utils/chatModeration.js",
    "data/rentifypro_profanity_dataset.csv", "data/chatbot/chatbot_config.json",
    "data/chatbot/rentifypro_chatbot_dataset_v6.json",
  ]) {
    const target = path.join(deploymentDirectory, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(backendDirectory, file), target);
  }
  await assert.rejects(fs.access(path.join(root, "chatbot-service")), { code: "ENOENT" });
  const probe = `
    import { getChatbotDatasetInfo, buildChatbotPayload, applyChatbotGuardrails } from "./wwwroot/utils/chatbotPayload.js";
    const info = getChatbotDatasetInfo();
    const payload = buildChatbotPayload("hello", "en");
    const reply = applyChatbotGuardrails({ intent: "chat_greeting", confidence: 0.99, language: "en", entities: {}, conditions: {} }, payload);
    if (!reply.reply || reply.intent !== "chat_greeting") throw new Error("Standalone greeting failed");
    console.log(JSON.stringify(info));
  `;
  const { stdout } = await run(process.execPath, ["--input-type=module", "--eval", probe], {
    cwd: root, timeout: 10000, windowsHide: true,
  });
  const info = JSON.parse(stdout);
  assert.equal(info.configPath, path.join(deploymentDirectory, "data/chatbot/chatbot_config.json"));
  assert.equal(info.datasetPath, path.join(deploymentDirectory, "data/chatbot/rentifypro_chatbot_dataset_v6.json"));
  assert.equal(info.intentsCount, getChatbotDatasetInfo().intentsCount);
  assert.deepEqual(info.liveDataIntents, getChatbotDatasetInfo().liveDataIntents);
});
