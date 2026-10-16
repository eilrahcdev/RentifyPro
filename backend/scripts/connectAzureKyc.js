import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const backend = fileURLToPath(new URL("../", import.meta.url));
const argument = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const app = argument("app");
const group = argument("resource-group");
const days = Number(argument("days") || 30);
const azurePython = process.platform === "win32"
  ? path.join(process.env.ProgramFiles || "C:/Program Files", "Microsoft SDKs", "Azure", "CLI2", "python.exe") : null;
function azure(args, extraEnv = {}) {
  const result = spawnSync(azurePython || "az", azurePython ? ["-IBm", "azure.cli", ...args] : args,
    { encoding: "utf8", windowsHide: true, env: { ...process.env, ...extraEnv }, maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("Azure CLI access failed. Sign in to the intended Azure account and retry.");
  return result.stdout.trim();
}
try {
  if (!app || !group || !/^[a-z\d-]+$/i.test(app) || !/^[\w.()-]+$/.test(group)
    || !Number.isInteger(days) || days < 1 || days > 90) throw new Error("Supply --app=<name> --resource-group=<group> and optionally --days=1..90.");
  const mounts = JSON.parse(azure(["webapp", "config", "storage-account", "list", "--name", app,
    "--resource-group", group, "--output", "json", "--only-show-errors"]));
  const matches = mounts.filter(entry => entry.value?.type === "AzureFiles" && entry.value?.mountPath === "/mounts/rentifypro");
  if (matches.length !== 1) throw new Error("The application must have one existing Azure Files mount at /mounts/rentifypro. No cloud resources were changed.");
  const mount = matches[0].value;
  const expires = new Date(Date.now() + days * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const sas = azure(["storage", "share", "generate-sas", "--account-name", mount.accountName, "--name", mount.shareName,
    "--permissions", "r", "--https-only", "--expiry", expires, "--output", "tsv", "--only-show-errors"], { AZURE_STORAGE_KEY: mount.accessKey });
  const url = `https://${mount.accountName}.file.core.windows.net/${mount.shareName}/private_uploads/kyc/`;
  const envFile = path.join(backend, ".env");
  const original = await fs.readFile(envFile, "utf8");
  const lines = original.split(/\r?\n/).filter(line => !/^\s*(?:KYC_REMOTE_BASE_URL|KYC_REMOTE_READ_SAS)\s*=/.test(line));
  const publicMedia = dotenv.parse(original).WEBSITE_PUBLIC_URL ? "" : `WEBSITE_PUBLIC_URL="https://${app}.azurewebsites.net/"\n`;
  const updated = `${lines.join("\n").trimEnd()}\n\nKYC_REMOTE_BASE_URL="${url}"\nKYC_REMOTE_READ_SAS="${sas}"\n${publicMedia}`;
  const temporary = path.join(backend, ".env.kyc-connection.tmp");
  await fs.writeFile(temporary, updated, { mode: 0o600 });
  await fs.rename(temporary, envFile);
  console.log(`Local private KYC retrieval configured with an HTTPS read-only credential expiring ${expires}. Restart the admin backend. No Azure resources or database records were changed.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
