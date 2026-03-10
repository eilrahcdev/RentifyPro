const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const backendRoot = path.resolve(__dirname, "..", "..");
const appDataDir = path.join(backendRoot, ".hardhat-appdata");
const localAppDataDir = path.join(backendRoot, ".hardhat-localappdata");
const npmCacheDir = path.join(backendRoot, ".npm-cache");

const hardhatArgs = process.argv.slice(2);

if (!hardhatArgs.length) {
  console.error("Usage: node blockchain/scripts/run-hardhat.cjs <hardhat args>");
  process.exit(1);
}

fs.mkdirSync(appDataDir, { recursive: true });
fs.mkdirSync(localAppDataDir, { recursive: true });
fs.mkdirSync(npmCacheDir, { recursive: true });

const env = {
  ...process.env,
  APPDATA: appDataDir,
  LOCALAPPDATA: localAppDataDir,
  NPM_CONFIG_CACHE: npmCacheDir,
  NPM_CONFIG_OFFLINE: "false",
  npm_config_offline: "false",
  HTTP_PROXY: "",
  HTTPS_PROXY: "",
  ALL_PROXY: "",
  http_proxy: "",
  https_proxy: "",
  all_proxy: "",
  GIT_HTTP_PROXY: "",
  GIT_HTTPS_PROXY: "",
};

const hardhatCli = path.join(backendRoot, "node_modules", "hardhat", "internal", "cli", "bootstrap.js");
if (!fs.existsSync(hardhatCli)) {
  console.error("Hardhat is not installed. Run: npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox");
  process.exit(1);
}

const result = spawnSync(process.execPath, [hardhatCli, ...hardhatArgs], {
  cwd: backendRoot,
  env,
  stdio: "inherit",
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.error) {
  console.error(result.error.message || "Failed to execute Hardhat.");
}
process.exit(1);
