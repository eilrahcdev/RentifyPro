export const BOOKING_LEDGER_ABI = [
  "event BookingProofRecorded(bytes32 indexed bookingKey,bytes32 indexed bookingHash,bytes32 indexed renterIdHash,uint96 amountInCents,uint8 paymentStatusCode,uint64 timestamp,address recorder)",
  "function recordBookingProof(bytes32 bookingKey,bytes32 bookingHash,bytes32 renterIdHash,uint96 amountInCents,uint8 paymentStatusCode)",
  "function recordBookingProofBatch(bytes32[] bookingKeys,bytes32[] bookingHashes,bytes32[] renterIdHashes,uint96[] amountInCents,uint8[] paymentStatusCodes)",
  "function owner() view returns (address)",
  "function proofExists(bytes32 bookingKey) view returns (bool)",
  "function totalRecorded() view returns (uint256)",
];
