const RECORD_BOOKING_SIGNATURE = "recordBooking(string,address,address,string,uint256,string)";
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const stripHexPrefix = (value = "") => String(value || "").replace(/^0x/i, "");
const toHexPrefix = (value = "") => `0x${stripHexPrefix(value)}`;

const padLeft64 = (hexValue = "") => stripHexPrefix(hexValue).padStart(64, "0");

const bytesToHex = (bytes = []) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const utf8ToHex = (value = "") => bytesToHex(new TextEncoder().encode(String(value)));

const toWordUint = (value) => {
  let bigintValue;
  try {
    bigintValue = typeof value === "bigint" ? value : BigInt(value);
  } catch {
    throw new Error("Invalid uint256 value for blockchain transaction.");
  }
  if (bigintValue < 0n) {
    throw new Error("Negative values are not allowed for uint256.");
  }
  return padLeft64(bigintValue.toString(16));
};

const toWordAddress = (value = "") => {
  const normalized = String(value || "").trim();
  if (!ADDRESS_REGEX.test(normalized)) {
    throw new Error("Invalid wallet address in blockchain payload.");
  }
  return padLeft64(stripHexPrefix(normalized).toLowerCase());
};

const encodeStringBlock = (value = "") => {
  const rawHex = utf8ToHex(String(value || ""));
  const bytesLength = rawHex.length / 2;
  const lengthWord = toWordUint(bytesLength);
  const paddedLength = Math.ceil(bytesLength / 32) * 64;
  const dataWord = rawHex.padEnd(paddedLength, "0");
  return `${lengthWord}${dataWord}`;
};

const buildFunctionSelector = async (ethereum, signature) => {
  const signatureHex = toHexPrefix(utf8ToHex(signature));
  const hash = await ethereum.request({
    method: "web3_sha3",
    params: [signatureHex],
  });
  const normalizedHash = stripHexPrefix(hash);
  if (normalizedHash.length < 8) {
    throw new Error("Failed to derive function selector for booking ledger call.");
  }
  return normalizedHash.slice(0, 8);
};

const encodeRecordBookingParams = ({
  bookingId,
  renter,
  owner,
  vehicleId,
  totalAmountInCents,
  bookingStatus,
}) => {
  const types = ["string", "address", "address", "string", "uint256", "string"];
  const values = [bookingId, renter, owner, vehicleId, totalAmountInCents, bookingStatus];
  const headSizeBytes = 32 * types.length;

  const headWords = [];
  let tailHex = "";

  for (let index = 0; index < types.length; index += 1) {
    const type = types[index];
    const value = values[index];

    if (type === "string") {
      const encoded = encodeStringBlock(value);
      const currentTailBytes = tailHex.length / 2;
      const offsetBytes = headSizeBytes + currentTailBytes;
      headWords.push(toWordUint(offsetBytes));
      tailHex += encoded;
      continue;
    }

    if (type === "address") {
      headWords.push(toWordAddress(value));
      continue;
    }

    if (type === "uint256") {
      headWords.push(toWordUint(value));
      continue;
    }

    throw new Error(`Unsupported ABI type: ${type}`);
  }

  return `${headWords.join("")}${tailHex}`;
};

export const buildRecordBookingCallData = async (
  ethereum,
  { bookingId, renter, owner, vehicleId, totalAmountInCents, bookingStatus }
) => {
  if (!ethereum) {
    throw new Error("MetaMask provider is unavailable.");
  }

  const selector = await buildFunctionSelector(ethereum, RECORD_BOOKING_SIGNATURE);
  const encodedParams = encodeRecordBookingParams({
    bookingId,
    renter,
    owner,
    vehicleId,
    totalAmountInCents,
    bookingStatus,
  });
  return toHexPrefix(`${selector}${encodedParams}`);
};

const delay = (ms) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

export const waitForTransactionReceipt = async (
  ethereum,
  txHash,
  { timeoutMs = 180000, pollMs = 2000 } = {}
) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await ethereum.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    });
    if (receipt) return receipt;
    await delay(pollMs);
  }
  throw new Error("Timed out waiting for blockchain transaction confirmation.");
};

export const isReceiptSuccessful = (receipt) =>
  Number.parseInt(String(receipt?.status || "0x0"), 16) === 1;

