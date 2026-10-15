import "dotenv/config";
import axios from "axios";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getChatbotServiceHeaders } from "../utils/chatbotServiceAuth.js";

const normalizeBaseUrl = (value = "") => String(value || "").trim().replace(/\/+$/, "");

const faceServiceUrl = normalizeBaseUrl(process.env.FACE_SERVICE_URL);
const chatbotUrl = normalizeBaseUrl(process.env.CHATBOT_URL);
const localChatbot = process.argv.includes("--chatbot-local");
let localMetadata;

if (localChatbot) {
  try {
    if (process.env.NODE_ENV === "production") throw new Error("Local verification cannot run in production mode.");
    const target = new URL(chatbotUrl);
    if (target.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
      || target.username || target.password || target.search || target.hash || target.pathname !== "/") {
      throw new Error("CHATBOT_URL must be a local HTTP loopback URL, normally http://127.0.0.1:8001.");
    }
    const source = new URL("../../chatbot-service/", import.meta.url);
    const revision = readFileSync(new URL("app.py", source), "utf8").match(/"routing_revision":\s*"([^"]+)"/)?.[1];
    if (!revision) throw new Error("Cannot read the local Python routing revision.");
    const dataset = readFileSync(new URL("rentifypro_chatbot_dataset_v6.json", source));
    localMetadata = {
      status: "ok",
      routing_revision: revision,
      intent_count: JSON.parse(dataset).items.length,
      dataset_sha256: createHash("sha256").update(dataset).digest("hex"),
      config_sha256: createHash("sha256").update(readFileSync(new URL("chatbot_config.json", source))).digest("hex"),
    };
    console.log(`[LOCAL] Effective CHATBOT_URL: ${chatbotUrl} (process environment overrides backend/.env)`);
  } catch (error) {
    console.log(`[FAIL] Local chatbot configuration: ${error.code ? "Cannot read local Python source files." : error.message}`);
    process.exit(1);
  }
}

const checks = [
  {
    name: "face-service",
    url: `${faceServiceUrl}/`,
    enabled: Boolean(faceServiceUrl),
  },
  {
    name: "chatbot-service",
    url: `${chatbotUrl}/health`,
    enabled: Boolean(chatbotUrl),
  },
  {
    name: "chatbot-service-authenticated-access",
    url: `${chatbotUrl}/`,
    enabled: Boolean(chatbotUrl),
    getHeaders: getChatbotServiceHeaders,
  },
  {
    name: "chatbot-service-rejects-direct-access",
    url: `${chatbotUrl}/`,
    enabled: Boolean(chatbotUrl),
    expectedStatus: 403,
  },
];

let hasError = false;

for (const check of checks.filter(check => !localChatbot || check.name !== "face-service")) {
  if (!check.enabled) {
    console.log(`[SKIP] ${check.name}: URL not configured`);
    continue;
  }

  try {
    const response = await axios.get(check.url, {
      timeout: 10000,
      maxRedirects: 0,
      headers: check.getHeaders?.(),
      ...(check.expectedStatus ? { validateStatus: (status) => status === check.expectedStatus } : {}),
    });
    if (localChatbot && check.name === "chatbot-service" && response.data?.status !== "ok") {
      throw new Error("Configured Python service is not ready.");
    }
    if (localChatbot && check.name === "chatbot-service-authenticated-access") {
      const mismatches = Object.keys(localMetadata).filter(field => response.data?.[field] !== localMetadata[field]);
      if (mismatches.length) throw new Error(`Connected Python differs from local source: ${mismatches.join(", ")}. Restart the intended local Python service.`);
      console.log(`[OK] Local Python: ${localMetadata.routing_revision}, ${localMetadata.intent_count} intents; dataset/config hashes match local source.`);
    }
    console.log(`[OK] ${check.name}: ${response.status} ${check.url}`);
  } catch (error) {
    hasError = true;
    if (error.response) {
      console.log(`[FAIL] ${check.name}: ${error.response.status} ${check.url}`);
    } else {
      console.log(`[FAIL] ${check.name}: ${error.message} ${check.url}`);
    }
  }
}

if (hasError) {
  if (localChatbot) console.log("Start the intended local Python service first (see backend/ENVIRONMENT.md), then check the matching private service key. There is no fallback to a hosted chatbot.");
  process.exit(1);
}
console.log("External service checks passed.");

