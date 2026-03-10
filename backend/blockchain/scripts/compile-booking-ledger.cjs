const fs = require("fs");
const path = require("path");
const solc = require("solc");

const backendRoot = path.resolve(__dirname, "..", "..");
const contractsDir = path.join(backendRoot, "blockchain", "contracts");
const artifactsDir = path.join(backendRoot, "blockchain", "artifacts");
const contractFiles = fs
  .readdirSync(contractsDir)
  .filter((name) => name.toLowerCase().endsWith(".sol"))
  .sort();

if (!contractFiles.length) {
  console.error(`No Solidity contracts found in ${contractsDir}`);
  process.exit(1);
}

const sources = {};
for (const fileName of contractFiles) {
  const fullPath = path.join(contractsDir, fileName);
  sources[fileName] = { content: fs.readFileSync(fullPath, "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = Array.isArray(output.errors) ? output.errors : [];
const fatalErrors = errors.filter((entry) => entry.severity === "error");

errors.forEach((entry) => {
  const printer = entry.severity === "error" ? console.error : console.warn;
  printer(entry.formattedMessage || entry.message);
});

if (fatalErrors.length > 0) {
  process.exit(1);
}

fs.mkdirSync(artifactsDir, { recursive: true });
const compilerVersion = solc.version();
const writtenArtifacts = [];

for (const fileName of contractFiles) {
  const expectedName = path.basename(fileName, ".sol");
  const compiledContracts = output?.contracts?.[fileName] || {};

  let contract = compiledContracts[expectedName];
  let contractName = expectedName;

  if (!contract) {
    const availableNames = Object.keys(compiledContracts);
    if (!availableNames.length) {
      console.error(`No compiled output for ${fileName}`);
      process.exit(1);
    }
    contractName = availableNames[0];
    contract = compiledContracts[contractName];
  }

  const bytecode = contract?.evm?.bytecode?.object;
  if (!bytecode) {
    console.error(`Compiled bytecode is empty for ${contractName} (${fileName}).`);
    process.exit(1);
  }

  const artifact = {
    contractName,
    sourceName: fileName,
    abi: contract.abi,
    bytecode: `0x${bytecode}`,
    deployedBytecode: contract?.evm?.deployedBytecode?.object
      ? `0x${contract.evm.deployedBytecode.object}`
      : "0x",
    metadata: contract.metadata || "",
    compiler: {
      version: compilerVersion,
    },
    updatedAt: new Date().toISOString(),
  };

  const artifactPath = path.join(artifactsDir, `${contractName}.json`);
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  writtenArtifacts.push(artifactPath);
}

console.log("Booking ledger contracts compiled successfully.");
writtenArtifacts.forEach((artifactPath) => console.log("Artifact:", artifactPath));
console.log("Compiler:", compilerVersion);
