# QA Runner (Alternative to the Removed Docs)

This folder provides a runnable, script-based way to execute the `Normal`, `Attack`, and `Edge` stage checks.

## 1) Setup
1. Copy config template:
```powershell
Copy-Item qa/test-config.example.json qa/test-config.json
```
2. Fill `qa/test-config.json` with:
- `baseUrl`
- valid `owner` and `renter` tokens
- optional `vehicleId` and `bookingId` for tests that require existing records

## 1.1) Optional: Auto-generate tokens + IDs from MongoDB
If you have a local MongoDB with existing users/vehicles/bookings, you can generate
JWTs and update `qa/test-config.json` automatically.

Prereqs:
- `backend/.env` has `MONGO_URI` and `JWT_SECRET` set.
- An existing renter and owner user are in MongoDB.

Run:
```powershell
$env:DOTENV_CONFIG_PATH='backend/.env'
node qa/build-test-config.mjs
```

This will set:
- `tokens.owner`
- `tokens.renter`
- `ids.vehicleId` (if any vehicle exists for owner)
- `ids.bookingId` (if any booking exists for owner)

## 2) Run
Run from repo root (`c:\Users\charlie\RentifyPro`):

### 2.1) Start the backend API
Make sure the backend is running:
```powershell
node backend/server.js
```

```powershell
node qa/run-stage-tests.mjs --config qa/test-config.json --stage normal
```

```powershell
node qa/run-stage-tests.mjs --config qa/test-config.json --stage attack
```

```powershell
node qa/run-stage-tests.mjs --config qa/test-config.json --stage edge
```

Run all stages:

```powershell
node qa/run-stage-tests.mjs --config qa/test-config.json --stage all
```

List available tests:

```powershell
node qa/run-stage-tests.mjs --list --config qa/test-config.json
```

## 3) Reports
JSON reports are written to `qa/reports/` by default.

Use a custom report path:

```powershell
node qa/run-stage-tests.mjs --config qa/test-config.json --stage all --out qa/reports/latest.json
```

## 4) Notes
- This runner is designed to be safe-first (validation, RBAC, and controlled negative checks).
- Some tests are skipped if required config values are missing (`vehicleId`, `bookingId`, or tokens).
- The runner preflights `GET /api/health` and exits early if the backend is unreachable.
- Placeholder values like `PASTE_OWNER_TOKEN_HERE` are treated as missing and will skip related tests.
