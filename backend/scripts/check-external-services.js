import "dotenv/config";
import axios from "axios";

const normalizeBaseUrl = (value = "") => String(value || "").trim().replace(/\/+$/, "");

const faceServiceUrl = normalizeBaseUrl(process.env.FACE_SERVICE_URL);
const chatbotUrl = normalizeBaseUrl(process.env.CHATBOT_URL);

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
];

let hasError = false;

for (const check of checks) {
  if (!check.enabled) {
    console.log(`[SKIP] ${check.name}: URL not configured`);
    continue;
  }

  try {
    const response = await axios.get(check.url, { timeout: 10000 });
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

if (hasError) process.exit(1);
console.log("External service checks passed.");

