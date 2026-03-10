# Secure Booking Blockchain Integration (Sepolia)

## 1) Architecture

### Primary data flow
1. Renter creates booking.
2. Booking is saved in MongoDB (`Booking` collection) as source-of-truth.
3. Renter pays booking (existing PayMongo flow).
4. After payment is verified, frontend records booking snapshot on Ethereum Sepolia via MetaMask.
5. Frontend sends resulting transaction hash to backend.
6. Backend verifies on-chain event data against MongoDB booking data.
7. Backend stores `blockchainTxHash` and blockchain metadata in MongoDB booking record.

### Security model
- Off-chain booking logic remains in backend + MongoDB.
- Blockchain write is append-only proof/audit record.
- Backend does not trust raw tx hash blindly.
- Backend validates:
  - tx was mined and successful,
  - tx target contract is the configured booking ledger contract,
  - tx signer matches renter wallet,
  - emitted `BookingRecorded` event matches booking ID, vehicle ID, owner/renter wallets, amount, and status.

## 2) Smart Contract

- Contract path: `backend/blockchain/contracts/BookingLedger.sol`
- Stores:
  - `bookingId`
  - `renter`
  - `owner`
  - `vehicleId`
  - `totalAmountInCents`
  - `timestamp`
  - `bookingStatus`
- Prevents duplicate booking records (`Booking already recorded`).
- Restricts recording caller: `msg.sender` must be the renter wallet.

## 3) Deployment (Hardhat)

### Files
- Config: `backend/blockchain/hardhat.config.cjs`
- Deploy script: `backend/blockchain/scripts/deploy-booking-ledger.cjs`

### Backend dependencies
Install/update dependencies in `backend`:

```bash
npm install
```

### Required backend `.env` values
Add to `backend/.env`:

```env
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
DEPLOYER_PRIVATE_KEY=0xyour_private_key
ETHERSCAN_API_KEY=your_etherscan_api_key

# after deployment:
BOOKING_LEDGER_CONTRACT_ADDRESS=0xYourDeployedContractAddress
BOOKING_LEDGER_CHAIN_ID=11155111
```

### Compile + deploy
Run from `backend` directory:

```bash
npm run blockchain:compile
npm run blockchain:deploy:sepolia
```

Optional verify on Etherscan:

```bash
npx hardhat verify --network sepolia 0xYourDeployedContractAddress --config blockchain/hardhat.config.cjs
```

## 4) Backend Integration

### Updated backend models and controllers
- `User` model now supports `walletAddress`.
- `Booking` model now stores:
  - `blockchainTxHash`
  - `blockchainRecordedAt`
  - `blockchain` metadata object (`network`, `chainId`, `contractAddress`, wallets, amount, status, block number).

### New booking endpoint
- `POST /api/bookings/:id/blockchain-record`
- Requires auth.
- Used after frontend sends on-chain tx.
- Verifies tx against Sepolia before storing hash.

### Verification utility
- `backend/utils/blockchainBooking.js`
- Connects to Sepolia RPC and validates receipt/log consistency with MongoDB booking.

## 5) Frontend Integration (React + ethers + MetaMask)

### New frontend blockchain files
- `frontend/src/blockchain/bookingLedgerAbi.js`
- `frontend/src/blockchain/config.js`
- `frontend/src/blockchain/metamask.js`

### Required frontend `.env` value
In frontend env (for Vite):

```env
VITE_BOOKING_LEDGER_CONTRACT_ADDRESS=0xYourDeployedContractAddress
```

### Frontend behavior
- Renter bookings page:
  - connect MetaMask wallet on Sepolia,
  - auto-attempt blockchain recording after payment verification,
  - manual fallback button: `Record On Blockchain`,
  - shows tx hash + Etherscan link.
- Owner profile page:
  - connect MetaMask and save owner wallet address for booking ownership linkage.

## 6) End-to-End Test Checklist

1. Owner logs in and links wallet in owner profile.
2. Renter creates booking (MongoDB record created).
3. Renter pays booking (existing flow).
4. On return to bookings page, payment is verified.
5. MetaMask prompts renter to record booking on-chain.
6. Backend stores `blockchainTxHash` only after verifying on-chain event data.
7. Booking card shows tx hash + Sepolia Etherscan link.
8. Open Etherscan tx URL and confirm `BookingRecorded` event details.

## 7) Notes

- Booking flow does not fail if blockchain recording fails; booking/payment in MongoDB remains valid.
- Blockchain recording can be retried from booking UI when `paymentStatus === "paid"` and no tx hash is stored.
