import axios from "axios";
import { spawn } from "child_process";
import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { auditLog } from "../middleware/auditLogger.middleware.js";

const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || "http://localhost:8000";
const FACE_SERVICE_AUTOSTART = (process.env.FACE_SERVICE_AUTOSTART || "true").toLowerCase() !== "false";
const STARTUP_TIMEOUT_MS = Number(process.env.FACE_SERVICE_STARTUP_TIMEOUT_MS || 90000);
const HEALTH_TIMEOUT_MS = Number(process.env.FACE_SERVICE_HEALTH_TIMEOUT_MS || 2500);
const HEALTH_POLL_INTERVAL_MS = Number(process.env.FACE_SERVICE_HEALTH_POLL_MS || 1500);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const faceServiceDir = path.resolve(repoRoot, "face-service");
const faceServiceEntry = process.env.FACE_SERVICE_ENTRY
  ? path.resolve(process.env.FACE_SERVICE_ENTRY)
  : path.join(faceServiceDir, "main.py");
const bundledVenvPython = path.join(faceServiceDir, "venv", "Scripts", "python.exe");

let faceServiceProcess = null;
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

export const isFaceServiceConnectionError = (error) => {
  if (!error) return false;
  if (!error.response) return true;
  return ["ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH"].includes(error.code);
};

const parseLines = (chunk, sink) => {
  const text = chunk?.toString?.().trim();
  if (!text) return;
  text.split(/\r?\n/).forEach((line) => {
    const clean = line.trim();
    if (clean) sink(clean);
  });
};

const faceServiceRootUrl = () => {
  try {
    const parsed = new URL(FACE_SERVICE_URL);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return FACE_SERVICE_URL;
  }
};

const healthCheck = async () => {
  try {
    await axios.get(`${faceServiceRootUrl()}/`, { timeout: HEALTH_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
};

const getPythonCandidates = () => {
  const configured = process.env.FACE_SERVICE_PYTHON_BIN?.trim();
  const candidates = [];
  if (configured) {
    candidates.push({ command: configured, args: [], source: "FACE_SERVICE_PYTHON_BIN" });
  }
  if (existsSync(bundledVenvPython)) {
    candidates.push({ command: bundledVenvPython, args: [], source: "face-service/venv" });
  }
  candidates.push({ command: "python", args: [], source: "system-python" });
  candidates.push({ command: "py", args: ["-3"], source: "py-launcher" });
  return candidates;
};

const spawnCandidate = (candidate) =>
  new Promise((resolve) => {
    const args = [...candidate.args, path.basename(faceServiceEntry)];
    const child = spawn(candidate.command, args, {
      cwd: path.dirname(faceServiceEntry),
      env: {
        ...process.env,
        TF_ENABLE_ONEDNN_OPTS: process.env.TF_ENABLE_ONEDNN_OPTS || "0",
        TF_CPP_MIN_LOG_LEVEL: process.env.TF_CPP_MIN_LOG_LEVEL || "2",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const onError = (error) => resolve({ ok: false, error });
    child.once("error", onError);
    child.once("spawn", () => {
      child.off("error", onError);
      resolve({ ok: true, child, args });
    });
  });

const waitUntilHealthy = async () => {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await healthCheck()) return true;
    if (faceServiceProcess && faceServiceProcess.exitCode !== null) return false;
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
  return false;
};

const attachLogs = (child) => {
  child.stdout?.on("data", (chunk) => parseLines(chunk, (line) => auditLog.info("KYC", `[FaceService] ${line}`)));
  child.stderr?.on("data", (chunk) => parseLines(chunk, (line) => auditLog.warn("KYC", `[FaceService] ${line}`)));
  child.once("exit", (code, signal) => {
    auditLog.warn("KYC", `Face service exited (code=${code ?? "null"}, signal=${signal ?? "none"})`);
    if (faceServiceProcess?.pid === child.pid) faceServiceProcess = null;
  });
};

const startFaceService = async () => {
  if (!existsSync(faceServiceEntry)) {
    throw new Error(`Face service entry not found: ${faceServiceEntry}`);
  }

  const candidates = getPythonCandidates();
  const failures = [];

  for (const candidate of candidates) {
    const spawned = await spawnCandidate(candidate);
    if (!spawned.ok) {
      failures.push(`${candidate.command} (${spawned.error?.code || spawned.error?.message || "unknown error"})`);
      continue;
    }

    faceServiceProcess = spawned.child;
    attachLogs(spawned.child);
    auditLog.info("KYC", `Starting local face service with ${candidate.command} (${candidate.source})`);

    const healthy = await waitUntilHealthy();
    if (healthy) {
      auditLog.info("KYC", `Face service is ready at ${faceServiceRootUrl()}`);
      return true;
    }

    failures.push(`${candidate.command} (not healthy within ${STARTUP_TIMEOUT_MS}ms)`);
    if (faceServiceProcess?.exitCode === null) {
      try {
        faceServiceProcess.kill();
      } catch {
        // Nothing else to do here.
      }
    }
    faceServiceProcess = null;
  }

  const detail = failures.length ? ` Attempts: ${failures.join(", ")}` : "";
  throw new Error(`Unable to start face service automatically.${detail}`);
};

export const ensureFaceServiceReady = async () => {
  if (await healthCheck()) return true;
  if (!FACE_SERVICE_AUTOSTART) return false;
  if (!isLocalUrl(FACE_SERVICE_URL)) return false;

  if (!bootPromise) {
    bootPromise = startFaceService()
      .catch((error) => {
        auditLog.error("KYC", "Face service auto-start failed", { detail: error.message });
        throw error;
      })
      .finally(() => {
        bootPromise = null;
      });
  }

  return bootPromise;
};

export const warmupFaceService = async () => {
  try {
    await ensureFaceServiceReady();
  } catch {
    // Do not block API startup if the face service is still down.
  }
};
