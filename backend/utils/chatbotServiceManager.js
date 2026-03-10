import axios from "axios";
import { spawn } from "child_process";
import path from "path";
import { copyFileSync, existsSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { auditLog } from "../middleware/auditLogger.middleware.js";

const CHATBOT_URL = process.env.CHATBOT_URL || "http://localhost:8001";
const CHATBOT_SERVICE_AUTOSTART = (process.env.CHATBOT_SERVICE_AUTOSTART || "true").toLowerCase() !== "false";
const CHATBOT_SERVICE_RELOAD =
  (process.env.CHATBOT_SERVICE_RELOAD || "false").toLowerCase() !== "false";
const STARTUP_TIMEOUT_MS = Number(process.env.CHATBOT_SERVICE_STARTUP_TIMEOUT_MS || 180000);
const HEALTH_TIMEOUT_MS = Number(process.env.CHATBOT_SERVICE_HEALTH_TIMEOUT_MS || 3000);
const HEALTH_POLL_INTERVAL_MS = Number(process.env.CHATBOT_SERVICE_HEALTH_POLL_MS || 2000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const chatbotServiceDir = path.resolve(repoRoot, "chatbot-service");
const chatbotServiceEntry = path.join(chatbotServiceDir, "app.py");
const bundledVenvPython = path.join(chatbotServiceDir, "venv", "Scripts", "python.exe");
const chatbotDatasetDefaultPath = path.join(chatbotServiceDir, "rentifypro_chatbot_dataset.json");
const chatbotDatasetCompatPath = path.join(chatbotServiceDir, "rentifypro_chatbot_dataset_v4.json");

let chatbotServiceProcess = null;
let bootPromise = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isLocalUrl = (url) => {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
};

const parseLines = (chunk, sink) => {
  const text = chunk?.toString?.().trim();
  if (!text) return;
  text.split(/\r?\n/).forEach((line) => {
    const clean = line.trim();
    if (clean) sink(clean);
  });
};

const chatbotServiceRootUrl = () => {
  try {
    const parsed = new URL(CHATBOT_URL);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return CHATBOT_URL;
  }
};

const chatbotServiceHost = () => {
  try {
    return new URL(CHATBOT_URL).hostname || "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
};

const chatbotServicePort = () => {
  try {
    const parsed = new URL(CHATBOT_URL);
    return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  } catch {
    return "8001";
  }
};

const healthCheck = async () => {
  try {
    await axios.get(`${chatbotServiceRootUrl()}/`, {
      timeout: HEALTH_TIMEOUT_MS,
      validateStatus: (status) => status >= 200 && status < 500,
    });
    return true;
  } catch {
    return false;
  }
};

const ensureChatbotDatasetAlias = () => {
  if (!existsSync(chatbotDatasetDefaultPath)) {
    return;
  }

  const shouldSync =
    !existsSync(chatbotDatasetCompatPath) ||
    statSync(chatbotDatasetCompatPath).mtimeMs < statSync(chatbotDatasetDefaultPath).mtimeMs;

  if (!shouldSync) {
    return;
  }

  copyFileSync(chatbotDatasetDefaultPath, chatbotDatasetCompatPath);
  auditLog.info("CHATBOT", "Synced chatbot dataset compatibility file");
};

const getPythonCandidates = () => {
  const configured = process.env.CHATBOT_SERVICE_PYTHON_BIN?.trim();
  const candidates = [];
  if (configured) {
    candidates.push({ command: configured, args: [], source: "CHATBOT_SERVICE_PYTHON_BIN" });
  }
  if (existsSync(bundledVenvPython)) {
    candidates.push({ command: bundledVenvPython, args: [], source: "chatbot-service/venv" });
  }
  candidates.push({ command: "python", args: [], source: "system-python" });
  candidates.push({ command: "py", args: ["-3"], source: "py-launcher" });
  return candidates;
};

const spawnCandidate = (candidate) =>
  new Promise((resolve) => {
    const args = [
      ...candidate.args,
      "-m",
      "uvicorn",
      "app:app",
      "--host",
      chatbotServiceHost(),
      "--port",
      chatbotServicePort(),
    ];

    if (CHATBOT_SERVICE_RELOAD) {
      args.push("--reload");
    }

    const child = spawn(candidate.command, args, {
      cwd: chatbotServiceDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const onError = (error) => resolve({ ok: false, error });
    child.once("error", onError);
    child.once("spawn", () => {
      child.off("error", onError);
      resolve({ ok: true, child });
    });
  });

const waitUntilHealthy = async () => {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await healthCheck()) return true;
    if (chatbotServiceProcess && chatbotServiceProcess.exitCode !== null) return false;
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
  return false;
};

const attachLogs = (child) => {
  child.stdout?.on("data", (chunk) => parseLines(chunk, (line) => auditLog.info("CHATBOT", `[ChatbotService] ${line}`)));
  child.stderr?.on("data", (chunk) => parseLines(chunk, (line) => auditLog.warn("CHATBOT", `[ChatbotService] ${line}`)));
  child.once("exit", (code, signal) => {
    auditLog.warn("CHATBOT", `Chatbot service exited (code=${code ?? "null"}, signal=${signal ?? "none"})`);
    if (chatbotServiceProcess?.pid === child.pid) chatbotServiceProcess = null;
  });
};

const startChatbotService = async () => {
  if (!existsSync(chatbotServiceEntry)) {
    throw new Error(`Chatbot service entry not found: ${chatbotServiceEntry}`);
  }

  ensureChatbotDatasetAlias();

  const candidates = getPythonCandidates();
  const failures = [];

  for (const candidate of candidates) {
    const spawned = await spawnCandidate(candidate);
    if (!spawned.ok) {
      failures.push(`${candidate.command} (${spawned.error?.code || spawned.error?.message || "unknown error"})`);
      continue;
    }

    chatbotServiceProcess = spawned.child;
    attachLogs(spawned.child);
    auditLog.info("CHATBOT", `Starting local chatbot service with ${candidate.command} (${candidate.source})`);

    const healthy = await waitUntilHealthy();
    if (healthy) {
      auditLog.info("CHATBOT", `Chatbot service is ready at ${chatbotServiceRootUrl()}`);
      return true;
    }

    failures.push(`${candidate.command} (not healthy within ${STARTUP_TIMEOUT_MS}ms)`);
    if (chatbotServiceProcess?.exitCode === null) {
      try {
        chatbotServiceProcess.kill();
      } catch {
        // Nothing else to do here.
      }
    }
    chatbotServiceProcess = null;
  }

  const detail = failures.length ? ` Attempts: ${failures.join(", ")}` : "";
  throw new Error(`Unable to start chatbot service automatically.${detail}`);
};

export const ensureChatbotServiceReady = async () => {
  if (await healthCheck()) return true;
  if (!CHATBOT_SERVICE_AUTOSTART) return false;
  if (!isLocalUrl(CHATBOT_URL)) return false;

  if (!bootPromise) {
    bootPromise = startChatbotService()
      .catch((error) => {
        auditLog.error("CHATBOT", "Chatbot service auto-start failed", { detail: error.message });
        throw error;
      })
      .finally(() => {
        bootPromise = null;
      });
  }

  return bootPromise;
};

export const warmupChatbotService = async () => {
  try {
    await ensureChatbotServiceReady();
  } catch {
    // Do not block API startup if the chatbot is still down.
  }
};
