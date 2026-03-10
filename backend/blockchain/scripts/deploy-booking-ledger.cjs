const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { ethers } = require("ethers");

const backendRoot = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(backendRoot, ".env") });

const artifactPath = path.join(backendRoot, "blockchain", "artifacts", "BookingLedger.json");
const rpcUrl = String(process.env.SEPOLIA_RPC_URL || "").trim();
const rawPrivateKey = String(process.env.DEPLOYER_PRIVATE_KEY || "").trim();
const expectedChainId = Number(process.env.BOOKING_LEDGER_CHAIN_ID || "11155111");

const ensure = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

const normalizePrivateKey = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  const unquoted = trimmed.replace(/^["']|["']$/g, "");
  const hex = unquoted.startsWith("0x") || unquoted.startsWith("0X")
    ? unquoted.slice(2)
    : unquoted;

  const isHex = /^[0-9a-fA-F]+$/.test(hex);
  if (!isHex || hex.length !== 64) {
    console.error(
      `Invalid DEPLOYER_PRIVATE_KEY format in backend/.env (got ${hex.length} hex chars, expected 64).`
    );
    console.error("Use an Ethereum account private key, e.g. 0x<64-hex-characters>.");
    process.exit(1);
  }

  return `0x${hex}`;
};

ensure(rpcUrl, "Missing SEPOLIA_RPC_URL in backend/.env");
ensure(rawPrivateKey, "Missing DEPLOYER_PRIVATE_KEY in backend/.env");
ensure(fs.existsSync(artifactPath), `Artifact not found at ${artifactPath}. Run npm run blockchain:compile first.`);
const privateKey = normalizePrivateKey(rawPrivateKey);

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
ensure(Array.isArray(artifact.abi), "Invalid artifact ABI.");
ensure(
  typeof artifact.bytecode === "string" && artifact.bytecode.startsWith("0x") && artifact.bytecode.length > 2,
  "Invalid artifact bytecode."
);

async function main() {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  if (Number.isFinite(expectedChainId) && expectedChainId > 0 && chainId !== expectedChainId) {
    throw new Error(`RPC chainId (${chainId}) does not match BOOKING_LEDGER_CHAIN_ID (${expectedChainId}).`);
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const balance = await provider.getBalance(wallet.address);
  if (balance <= 0n) {
    throw new Error(`Deployer wallet ${wallet.address} has no ETH for gas.`);
  }

  console.log("Deploying BookingLedger...");
  console.log("Deployer:", wallet.address);
  console.log("Chain ID:", chainId);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  const deploymentTx = contract.deploymentTransaction();

  console.log("BookingLedger deployed.");
  console.log("Contract Address:", contractAddress);
  console.log("Transaction Hash:", deploymentTx?.hash || "N/A");
  console.log("");
  console.log("Set these values:");
  console.log(`backend/.env -> BOOKING_LEDGER_CONTRACT_ADDRESS=${contractAddress}`);
  console.log(`frontend/.env -> VITE_BOOKING_LEDGER_CONTRACT_ADDRESS=${contractAddress}`);
}

main().catch((error) => {
  console.error("Deployment failed:", error.message || error);
  process.exit(1);
});
