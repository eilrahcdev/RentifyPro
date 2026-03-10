import { SEPOLIA_CHAIN_ID, SEPOLIA_CHAIN_ID_HEX } from "./config";

export const getEthereumProvider = () =>
  typeof window !== "undefined" ? window.ethereum || null : null;

export const ensureSepoliaNetwork = async () => {
  const ethereum = getEthereumProvider();
  if (!ethereum) {
    throw new Error("MetaMask is not available in this browser.");
  }

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
    });
  } catch (error) {
    if (error?.code !== 4902) throw error;

    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: SEPOLIA_CHAIN_ID_HEX,
          chainName: "Sepolia Test Network",
          nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://rpc.sepolia.org"],
          blockExplorerUrls: ["https://sepolia.etherscan.io"],
        },
      ],
    });
  }
};

export const connectMetaMaskWallet = async () => {
  const ethereum = getEthereumProvider();
  if (!ethereum) {
    throw new Error("MetaMask is not installed.");
  }

  await ensureSepoliaNetwork();

  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || !accounts[0]) {
    throw new Error("No MetaMask account was selected.");
  }
  const chainIdHex = await ethereum.request({ method: "eth_chainId" });
  const chainId = Number.parseInt(String(chainIdHex || "0x0"), 16);

  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error("Please switch MetaMask to Sepolia.");
  }

  return {
    ethereum,
    address: String(accounts[0]),
    chainId,
  };
};
