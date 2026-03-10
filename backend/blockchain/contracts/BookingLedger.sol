// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title BookingLedger
 * @notice Gas-optimized booking proof ledger.
 *         Full booking/payment details remain in MongoDB.
 *         This contract stores only minimal tamper-proof proofs.
 */
contract BookingLedger {
    enum PaymentStatusCode {
        Unknown,
        Unpaid,
        Partial,
        Paid,
        Refunded
    }

    error OnlyOwner();
    error EmptyBatch();
    error BatchTooLarge();
    error MismatchedArrayLength();
    error BookingKeyRequired();
    error BookingHashRequired();
    error RenterHashRequired();
    error AmountRequired();
    error InvalidPaymentStatus();
    error BookingAlreadyRecorded();

    address public immutable owner;

    // Minimal on-chain state: only proof existence.
    mapping(bytes32 => bool) private _proofRecorded;
    uint256 public totalRecorded;

    event BookingProofRecorded(
        bytes32 indexed bookingKey,
        bytes32 indexed bookingHash,
        bytes32 indexed renterIdHash,
        uint96 amountInCents,
        uint8 paymentStatusCode,
        uint64 timestamp,
        address recorder
    );

    event BookingProofBatchRecorded(
        uint256 count,
        uint64 timestamp,
        address recorder
    );

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function recordBookingProof(
        bytes32 bookingKey,
        bytes32 bookingHash,
        bytes32 renterIdHash,
        uint96 amountInCents,
        uint8 paymentStatusCode
    ) external onlyOwner {
        _recordBookingProof(
            bookingKey,
            bookingHash,
            renterIdHash,
            amountInCents,
            paymentStatusCode,
            uint64(block.timestamp)
        );
    }

    function recordBookingProofBatch(
        bytes32[] calldata bookingKeys,
        bytes32[] calldata bookingHashes,
        bytes32[] calldata renterIdHashes,
        uint96[] calldata amountInCents,
        uint8[] calldata paymentStatusCodes
    ) external onlyOwner {
        uint256 length = bookingKeys.length;

        if (length == 0) revert EmptyBatch();
        if (length > 200) revert BatchTooLarge();

        if (
            length != bookingHashes.length ||
            length != renterIdHashes.length ||
            length != amountInCents.length ||
            length != paymentStatusCodes.length
        ) {
            revert MismatchedArrayLength();
        }

        uint64 timestamp = uint64(block.timestamp);

        for (uint256 i = 0; i < length; ) {
            _recordBookingProof(
                bookingKeys[i],
                bookingHashes[i],
                renterIdHashes[i],
                amountInCents[i],
                paymentStatusCodes[i],
                timestamp
            );
            unchecked {
                ++i;
            }
        }

        emit BookingProofBatchRecorded(length, timestamp, msg.sender);
    }

    function proofExists(bytes32 bookingKey) external view onlyOwner returns (bool) {
        return _proofRecorded[bookingKey];
    }

    function _recordBookingProof(
        bytes32 bookingKey,
        bytes32 bookingHash,
        bytes32 renterIdHash,
        uint96 amountInCents,
        uint8 paymentStatusCode,
        uint64 timestamp
    ) internal {
        if (bookingKey == bytes32(0)) revert BookingKeyRequired();
        if (bookingHash == bytes32(0)) revert BookingHashRequired();
        if (renterIdHash == bytes32(0)) revert RenterHashRequired();
        if (amountInCents == 0) revert AmountRequired();
        if (paymentStatusCode > uint8(PaymentStatusCode.Refunded)) revert InvalidPaymentStatus();
        if (_proofRecorded[bookingKey]) revert BookingAlreadyRecorded();

        _proofRecorded[bookingKey] = true;

        unchecked {
            ++totalRecorded;
        }

        emit BookingProofRecorded(
            bookingKey,
            bookingHash,
            renterIdHash,
            amountInCents,
            paymentStatusCode,
            timestamp,
            msg.sender
        );
    }
}
