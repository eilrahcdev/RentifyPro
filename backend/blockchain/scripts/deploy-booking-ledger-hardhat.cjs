const hre = require("hardhat");

async function main() {
  const BookingLedger = await hre.ethers.getContractFactory("BookingLedger");
  const bookingLedger = await BookingLedger.deploy();
  await bookingLedger.waitForDeployment();

  const address = await bookingLedger.getAddress();
  const deployTx = bookingLedger.deploymentTransaction();

  console.log("BookingLedger deployed.");
  console.log("Contract Address:", address);
  console.log("Transaction Hash:", deployTx?.hash || "N/A");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});

