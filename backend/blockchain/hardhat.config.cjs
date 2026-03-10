const path = require("path");
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL || "";
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY || "";

module.exports = {
  solidity: "0.8.24",
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    sepolia: {
      url: sepoliaRpcUrl,
      chainId: 11155111,
      accounts: deployerPrivateKey ? [deployerPrivateKey] : [],
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
};
