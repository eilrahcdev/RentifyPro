import { BOOKING_LEDGER_ABI } from "../blockchain/abi/BookingLedgerAbi.js";

const SEPOLIA_CHAIN_ID = 11155111;
const WALLET_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const LEDGER_VERSION = "booking-ledger";
const PAYMENT_STATUS_TO_CODE = {
  unknown: 0,
  unpaid: 1,
  partial: 2,
  paid: 3,
  refunded: 4,
};

let ethersLoader = null;

const loadEthers = async () => {
  if (!ethersLoader) {
    ethersLoader = import("ethers")
      .then((module) => module?.ethers || module)
      .catch(() => {
        throw new Error("Blockchain dependency is missing: install backend package 'ethers'.");
      });
  }
  return ethersLoader;
};

export const normalizeAddress = (value) => String(value || "").trim().toLowerCase();

export const isValidWalletAddress = (value) => {
  const candidate = String(value || "").trim();
  return WALLET_ADDRESS_REGEX.test(candidate);
};

export const amountToCents = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 100);
};

const normalizePrivateKey = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  const unquoted = trimmed.replace(/^["']|["']$/g, "");
  const hex = unquoted.startsWith("0x") || unquoted.startsWith("0X") ? unquoted.slice(2) : unquoted;
  const isHex = /^[0-9a-fA-F]+$/.test(hex);
  if (!isHex || hex.length !== 64) {
    return "";
  }

  return `0x${hex}`;
};

export const getBookingLedgerConfig = () => {
  const contractAddress = normalizeAddress(process.env.BOOKING_LEDGER_CONTRACT_ADDRESS);
  const rpcUrl = String(process.env.SEPOLIA_RPC_URL || "").trim();
  const deployerPrivateKey = normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY);
  const chainId = Number(process.env.BOOKING_LEDGER_CHAIN_ID || SEPOLIA_CHAIN_ID);

  return {
    contractAddress,
    selectedVersion: contractAddress ? LEDGER_VERSION : null,
    rpcUrl,
    deployerPrivateKey,
    chainId,
    network: "sepolia",
  };
};

export const getSepoliaTxUrl = (txHash) =>
  `https://sepolia.etherscan.io/tx/${encodeURIComponent(String(txHash || "").trim())}`;

export const getBookingLedgerEligibility = (booking) => {
  const status = String(booking?.status || "").trim().toLowerCase();
  const paymentStatus = String(booking?.paymentStatus || "").trim().toLowerCase();

  if (["cancelled", "rejected"].includes(status)) {
    return { eligible: false, reason: "booking_cancelled" };
  }
  if (paymentStatus !== "paid") {
    return { eligible: false, reason: "payment_not_completed" };
  }
  return { eligible: true, reason: "ready_to_record" };
};

const buildLedgerPayload = (ethers, booking) => {
  const bookingId = String(booking?._id || "").trim();
  const vehicleId = String(booking?.vehicle?._id || booking?.vehicle || "").trim();
  const renterId = String(booking?.renter?._id || booking?.renter || "").trim();
  const ownerId = String(booking?.owner?._id || booking?.owner || "").trim();
  const totalAmountInCents = amountToCents(booking?.totalAmount);
  const paymentStatus = String(booking?.paymentStatus || "").trim().toLowerCase();
  const paymentStatusCode = PAYMENT_STATUS_TO_CODE[paymentStatus] ?? PAYMENT_STATUS_TO_CODE.unknown;

  if (!bookingId || !vehicleId || !renterId || !ownerId || totalAmountInCents === null || !paymentStatus) {
    throw new Error("Booking payload is incomplete for blockchain recording.");
  }

  const renterIdHash = ethers.keccak256(ethers.toUtf8Bytes(`rentifypro:renter:${renterId}`));
  const bookingKey = ethers.keccak256(ethers.toUtf8Bytes(`rentifypro:booking:${bookingId}`));
  return {
    bookingId,
    bookingKey,
    vehicleId,
    renterIdHash,
    ownerId,
    bookingHash: ethers.solidityPackedKeccak256(
      ["string", "string", "bytes32", "string", "uint256", "uint8"],
      [bookingId, vehicleId, renterIdHash, ownerId, totalAmountInCents, paymentStatusCode]
    ),
    totalAmountInCents,
    paymentStatus,
    paymentStatusCode,
  };
};

export const applyLedgerRecordToBooking = (booking, record) => {
  booking.blockchainTxHash = record.txHash;
  booking.blockchainRecordedAt = record.recordedAt;
  booking.blockchain = {
    network: record.network,
    chainId: record.chainId,
    contractAddress: record.contractAddress,
    version: record.version || LEDGER_VERSION,
    bookingKey: record.bookingKey || null,
    bookingHash: record.bookingHash || null,
    renterIdHash: record.renterIdHash,
    ownerId: record.ownerId,
    amountInCents: record.amountInCents,
    paymentStatus: record.paymentStatus,
    paymentStatusCode:
      Number.isFinite(Number(record.paymentStatusCode)) ? Number(record.paymentStatusCode) : null,
    blockNumber: record.blockNumber,
  };
};

const toPositiveInt = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
};

const buildTxOverrides = (ethers) => {
  const overrides = {};
  const gasLimit = toPositiveInt(process.env.BOOKING_LEDGER_GAS_LIMIT);
  if (gasLimit) {
    overrides.gasLimit = BigInt(gasLimit);
  }

  const maxFeeGwei = Number(process.env.BOOKING_LEDGER_MAX_FEE_GWEI);
  const maxPriorityGwei = Number(process.env.BOOKING_LEDGER_MAX_PRIORITY_FEE_GWEI);
  if (Number.isFinite(maxFeeGwei) && maxFeeGwei > 0 && Number.isFinite(maxPriorityGwei) && maxPriorityGwei > 0) {
    overrides.maxFeePerGas = ethers.parseUnits(String(maxFeeGwei), "gwei");
    overrides.maxPriorityFeePerGas = ethers.parseUnits(String(maxPriorityGwei), "gwei");
  }

  return overrides;
};

const submitLedgerTransaction = async ({ contract, payload, overrides }) => {
  const args = [
    payload.bookingKey,
    payload.bookingHash,
    payload.renterIdHash,
    payload.totalAmountInCents,
    payload.paymentStatusCode,
  ];

  if (Object.keys(overrides).length > 0) {
    return contract.recordBookingProof(...args, overrides);
  }
  return contract.recordBookingProof(...args);
};

const resolveRecordedAtFromReceipt = ({ receipt, contract }) => {
  let recordedAt = new Date();

  for (const log of receipt.logs || []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "BookingProofRecorded") {
        const timestamp = Number(parsed?.args?.timestamp || 0);
        if (Number.isFinite(timestamp) && timestamp > 0) {
          recordedAt = new Date(timestamp * 1000);
        }
        break;
      }
    } catch {
      // Ignore logs from other contracts.
    }
  }

  return recordedAt;
};

export const recordBookingTransactionOnChain = async ({ booking }) => {
  const config = getBookingLedgerConfig();
  if (!config.rpcUrl || !config.contractAddress) {
    throw new Error("Blockchain recording is not configured on the server.");
  }

  const privateKey = config.deployerPrivateKey;
  if (!privateKey) {
    throw new Error("Blockchain recording wallet is not configured on the server.");
  }

  const ethers = await loadEthers();
  const payload = buildLedgerPayload(ethers, booking);

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) {
    throw new Error("Configured RPC does not point to the expected blockchain network.");
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(config.contractAddress, BOOKING_LEDGER_ABI, wallet);
  const txOverrides = buildTxOverrides(ethers);

  let tx;
  try {
    tx = await submitLedgerTransaction({
      contract,
      payload,
      overrides: txOverrides,
    });
  } catch (error) {
    const message = String(error?.shortMessage || error?.reason || error?.message || "").toLowerCase();
    if (message.includes("already recorded") || message.includes("bookingalreadyrecorded")) {
      throw new Error("Booking is already recorded on-chain.");
    }
    if (message.includes("execution reverted") || message.includes("missing revert data")) {
      throw new Error(
        "Blockchain contract call failed. Ensure BOOKING_LEDGER_CONTRACT_ADDRESS points to the latest BookingLedger deployment."
      );
    }
    throw new Error("Failed to submit booking transaction to blockchain.");
  }

  const receipt = await tx.wait();
  if (!receipt || Number(receipt.status || 0) !== 1) {
    throw new Error("Blockchain transaction failed.");
  }

  const recordedAt = resolveRecordedAtFromReceipt({
    receipt,
    contract,
  });

  return {
    txHash: tx.hash,
    version: LEDGER_VERSION,
    network: config.network,
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    bookingKey: payload.bookingKey,
    bookingHash: payload.bookingHash,
    renterIdHash: payload.renterIdHash,
    ownerId: payload.ownerId,
    amountInCents: payload.totalAmountInCents,
    paymentStatus: payload.paymentStatus,
    paymentStatusCode: payload.paymentStatusCode,
    blockNumber: Number(receipt.blockNumber || 0),
    recordedAt,
  };
};
