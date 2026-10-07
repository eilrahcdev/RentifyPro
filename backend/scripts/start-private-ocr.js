import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createPrivateOcrServiceManager, getPrivateOcrLaunchOptions } from "../utils/privateOcrServiceManager.js";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(backend, ".env"), quiet: true });
if (process.env.NODE_ENV === "production") throw new Error("This launcher is for local development only. Deploy the OCR container separately in production.");
const configured = process.argv.find((argument) => argument.startsWith("--python="))?.slice(9);
const manager = createPrivateOcrServiceManager({
  env: { ...process.env, KYC_DOCUMENT_PROVIDER: "private_ocr", KYC_PRIVATE_SERVICE_AUTOSTART: "true",
    KYC_PRIVATE_SERVICE_URL: process.env.KYC_PRIVATE_SERVICE_URL || "http://127.0.0.1:8020" },
  launchOptions: (env) => getPrivateOcrLaunchOptions(env, configured),
});
for (const signal of ["SIGINT", "SIGTERM", "exit"]) process.on(signal, manager.stop);
try { if (!await manager.ensureReady()) process.exitCode = 1; }
catch (error) { console.error(error.message); process.exitCode = 1; }
