import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { getKycScreeningProvider, getPrivateKycInternalKey, isPrivateKycServiceUrl } from "./kycScreeningProvider.js";
import { isCompatiblePrivateOcrHealth } from "../services/privateKycOcr.service.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const service = path.join(repository, "kyc-ocr-service");
const localUrl = (env) => {
  const value = env.KYC_PRIVATE_SERVICE_URL;
  if (!isPrivateKycServiceUrl(value)) return null;
  const url = new URL(value);
  return url.protocol === "http:" && url.pathname === "/" ? url : null;
};

export async function getPrivateOcrLaunchOptions(env = process.env, pythonOverride) {
  if (env.NODE_ENV === "production") throw new Error("Deploy the OCR container separately in production.");
  const url = localUrl(env);
  if (!url) throw new Error("Local OCR startup requires a loopback HTTP KYC_PRIVATE_SERVICE_URL without a path.");
  const key = getPrivateKycInternalKey(env);
  if (key.length < 32) throw new Error("Configure KYC_PRIVATE_INTERNAL_API_KEY or INTERNAL_API_KEY with at least 32 characters.");
  await fs.access(path.join(service, "main.py"));
  const executable = process.platform === "win32" ? "Scripts/python.exe" : "bin/python";
  const candidates = pythonOverride ? [path.resolve(pythonOverride)] : [path.join(service, ".venv", executable),
    path.join(repository, "qa", "private-kyc-venv", executable)];
  let command;
  for (const candidate of candidates) {
    try { if ((await fs.stat(candidate)).isFile()) { command = candidate; break; } } catch {}
  }
  if (!command) throw new Error("The private OCR virtual environment is missing. Follow kyc-ocr-service/README.md.");
  return {
    command,
    args: ["-m", "uvicorn", "main:app", "--host", url.hostname.replace(/^\[|\]$/g, ""), "--port", url.port || "80",
      "--workers", "1", "--limit-concurrency", "8", "--no-access-log"],
    options: { cwd: service, env: { ...env, INTERNAL_API_KEY: key }, windowsHide: true, stdio: "inherit" },
  };
}

const healthCheck = async (url) => {
  try {
    const response = await fetch(new URL("/health", url), { signal: AbortSignal.timeout(2000), redirect: "error" });
    if (!response.ok) return false;
    const health = await response.json();
    return isCompatiblePrivateOcrHealth(health);
  } catch { return false; }
};

const portIsListening = (url) => new Promise((resolve) => {
  const socket = net.createConnection({ host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port || 80) });
  const finish = (listening) => { socket.destroy(); resolve(listening); };
  socket.setTimeout(1000);
  socket.once("connect", () => finish(true));
  socket.once("error", () => finish(false));
  socket.once("timeout", () => finish(false));
});

const terminateProcess = (child) => {
  // Windows virtual-environment interpreters can delegate to a second Python process.
  if (process.platform === "win32" && Number.isSafeInteger(child.pid) && child.pid > 0) {
    const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, stdio: "ignore", timeout: 5000 });
    if (!result.error && result.status === 0) return;
  }
  child.kill();
};

export function createPrivateOcrServiceManager({ env = process.env, checkHealth = healthCheck,
  isListening = portIsListening, launchOptions = getPrivateOcrLaunchOptions, spawnProcess = spawn,
  logger = console, startupTimeoutMs = 90000, pollIntervalMs = 500 } = {}) {
  let child = null;
  let bootPromise = null;
  let stopped = false;

  const stop = () => {
    stopped = true;
    if (child && child.exitCode === null && child.signalCode === null) terminateProcess(child);
    child = null;
  };

  const start = async (url) => {
    if (await checkHealth(url)) {
      logger.info("[PrivateOCR] Using the existing local OCR service.");
      return true;
    }
    if (await isListening(url)) throw new Error("The local OCR port is occupied by an unavailable or incompatible service. Restart the OCR service with schema_version=1, provider=paddleocr and layout_version=2 text positions.");
    const launch = await launchOptions(env);
    if (stopped) return false;
    const owned = spawnProcess(launch.command, launch.args, launch.options);
    child = owned;
    let failed = false;
    owned.once("error", () => { failed = true; });
    owned.once("exit", () => { if (child === owned) child = null; });
    logger.info("[PrivateOCR] Starting the local OCR service using local models.");
    const deadline = Date.now() + startupTimeoutMs;
    while (!stopped && Date.now() < deadline) {
      if (failed || owned.exitCode !== null || owned.signalCode !== null) break;
      if (await checkHealth(url)) {
        logger.info("[PrivateOCR] The local OCR service is ready.");
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    if (child === owned) {
      if (owned.exitCode === null && owned.signalCode === null) terminateProcess(owned);
      child = null;
    }
    if (stopped) return false;
    throw new Error("Local OCR did not become ready. Check its Python environment, local models, and startup output.");
  };

  const ensureReady = () => {
    if (stopped || env.NODE_ENV === "production" || getKycScreeningProvider(env) !== "private_ocr"
      || String(env.KYC_PRIVATE_SERVICE_AUTOSTART || "").trim().toLowerCase() !== "true") return Promise.resolve(false);
    const url = localUrl(env);
    if (!url) return Promise.resolve(false);
    if (!bootPromise) bootPromise = start(url).finally(() => { bootPromise = null; });
    return bootPromise;
  };
  const warmup = async () => {
    try { return await ensureReady(); }
    catch (error) { logger.warn(`[PrivateOCR] Auto-start failed: ${error.message}`); return false; }
  };
  return { ensureReady, warmup, stop };
}

const manager = createPrivateOcrServiceManager();
export const warmupPrivateOcrService = manager.warmup;
export const stopPrivateOcrService = manager.stop;
