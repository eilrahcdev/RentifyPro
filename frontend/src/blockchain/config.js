export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";

export const BOOKING_LEDGER_CONTRACT_ADDRESS = String(
  import.meta.env.VITE_BOOKING_LEDGER_CONTRACT_ADDRESS || ""
).trim();

export const getSepoliaEtherscanTxUrl = (txHash) =>
  `https://sepolia.etherscan.io/tx/${encodeURIComponent(String(txHash || "").trim())}`;

export const shortAddress = (address = "") => {
  const text = String(address || "").trim();
  if (text.length < 10) return text;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
};

