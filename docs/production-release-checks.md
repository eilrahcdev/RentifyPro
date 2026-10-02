# Production release checks

The application changes repair payment capture detection, checkout retries, duplicate recording, webhook handling, reconciliation, malformed socket events, and database readiness. Passing fixture tests is separate from validating a deployed payment provider, storage volume, email recipient, or camera.

## Configure the target environment

Keep development `.env` files local. Configure deployment secrets in the host's environment settings. `backend/.env.example` documents the new settings without credentials. Run from the backend directory:

```sh
npm ci
npm run production:check
```

Production startup validates strong JWT/internal secrets, database settings, exact HTTPS frontend origins, external face/chatbot URLs, payment configuration, storage configuration, and Gemini confirmation. It fails with setting names and corrective instructions without printing secret values. A green configuration check cannot prove billing status, webhook registration, disk durability, backups, or live-service delivery.

Use `NODE_ENV=production`, `MONGO_AUTO_INDEX=false`, `ALLOW_VERCEL_PREVIEW_ORIGINS=false`, `FACE_SERVICE_AUTOSTART=false`, and `CHATBOT_SERVICE_AUTOSTART=false`. Provide exact owned origins in `FRONTEND_URL` and set `BACKEND_PUBLIC_URL` to the backend's HTTPS origin. Keep the face service's internal key identical to the backend's. Use separate secrets and databases for staging and production.

Set `GEMINI_SENSITIVE_DATA_APPROVED=true` only after confirming the API key belongs to the intended billing-enabled Google Cloud project and reviewing the applicable data-processing terms. Google prohibits sensitive/personal data in standard unpaid services. The flag is an operator acknowledgement, not a billing check. Production document extraction refuses to send data without it. Keep existing KYC identity comparisons and administrator review gates enabled. If this setup is unavailable, production registration remains blocked; do not bypass identity checks to compensate. Use synthetic documents for development until data handling is confirmed. [Google's terms](https://ai.google.dev/gemini-api/terms).

## Persist uploads on one backend instance

For the existing Render deployment, attach a paid persistent disk mounted at `/var/data`, then set:

```dotenv
STORAGE_ROOT=/var/data/rentifypro
STORAGE_DURABILITY_CONFIRMED=true
```

These settings route all upload classes to the disk, retaining their existing public URLs and private object keys. Explicit `KYC_UPLOAD_DIR`, `REPORT_EVIDENCE_DIR`, `PUBLIC_UPLOAD_DIR`, or `AVATAR_UPLOAD_DIR` overrides must also live on the volume and keep private evidence outside public directories. Existing files are not moved automatically: securely copy current vehicle/avatar files to `uploads/vehicles` and `uploads/avatars`, and KYC/report/vehicle-photo evidence to the corresponding `private_uploads` directories. Preserve filenames, verify checksums, and retain the original copy for rollback. Never expose the storage root with `express.static`.

Upload synthetic public and private fixtures, restart/redeploy the service, and verify the public image still loads and private evidence still requires authorized access. Back up both MongoDB and the media volume, then restore to an isolated environment and verify matching records/files. Record backup frequency and the acceptable recovery time/data loss. Monitor free disk space and cleanup errors. Render preserves only files beneath the disk mount; disks are limited to one service instance and introduce restart/deploy downtime. [Render disk documentation](https://render.com/docs/disks).

This implementation supports persistent volumes. Object storage and shared Redis rate limits/job leases/socket adapters remain necessary before scaling across backend instances.

## Apply indexes after backup

Run the dry runs against the intended target and inspect the database selection privately:

```sh
npm run db:migrate:session-revocations
npm run db:migrate:payments
```

After verifying a backup restore, apply and repeat the dry runs to confirm presence:

```sh
npm run db:migrate:session-revocations -- --apply
npm run db:migrate:payments -- --apply
```

The session migration creates `tokenHash_1` and the `expiresAt_1` TTL index; MongoDB then removes expired logout revocations. The payment migration adds `payment_reconciliation_queue`. Neither migration renames/drops existing indexes or rewrites booking/payment records. Apply the repository's other existing KYC/notification/report migrations as described in their deployment documentation.

## Register and validate PayMongo

1. Register `https://<backend-domain>/api/payments/paymongo/webhook` in PayMongo for `checkout_session.payment.paid` and copy that endpoint's secret into `PAYMONGO_WEBHOOK_SECRET`. Use a separate test endpoint/key/secret for staging. Set `PAYMONGO_ALLOW_TEST_MODE=true` only on staging using a test secret key; remove it for real-money production.
2. Keep `PAYMENT_RECONCILIATION_ENABLED=true`. The worker checks up to ten unresolved checkouts per minute, oldest checked first, and continues after transient errors. Monitor backlog size and `[Payment Reconciliation]`/`[Payment Webhook]` failures, especially captures needing review after a cancellation, refund, or manual correction.
3. In staging, approve a synthetic booking, complete a 30% downpayment, verify the recorded amount and remaining balance, then complete the full remaining balance. Repeat for enabled GCash, Maya, and card methods. Authorization and pending capture must never display payment success.
4. Close the renter browser before the provider callback. Verify the webhook or worker records payment and notifies both parties. Replay the test webhook and verification request; the amount must remain unchanged. Invalid signatures, altered payloads, stale timestamps, and mode mismatches must be rejected.
5. Submit checkout twice, retry after a simulated timeout, and restart the backend during an uncertain provider response. A persisted request and provider idempotency key must recover the same session. Changing scope/channel first expires the old session; an in-flight authorization/capture blocks replacement. Confirm expired checkouts cannot collect a new payment.
6. Test walk-in approval/receipt, owner manual corrections, cancellation, extension, return, and finalized late fees. Delayed captures that exceed the current balance or conflict with authoritative manual corrections require reconciliation by an operator; they must not be silently added or labelled refunded. Check the provider dashboard before any refund/correction.

The handler verifies the raw-body HMAC and test/live signature, retrieves the checkout with the server key, checks ownership and PHP captured amount, and records the checkout ID and totals in one conditional MongoDB update. Provider failures return a retryable status. Browser and worker verification use the same update. [PayMongo signature setup](https://docs.paymongo.com/docs/developer-tools-webhook-setup-management), [idempotency guidance](https://docs.paymongo.com/docs/developer-tools-best-practices-1).

Do not rotate a merchant API key or discard a persisted uncertain checkout request until its provider outcome has been reconciled. Never clear an uncertain request merely to force a new charge.

## Release verification

```sh
# Backend
npm test
npm audit --omit=dev

# Local MongoDB only: creates and removes one isolated synthetic collection
npm run test:payment-mongo

# Frontend, from frontend/
npm run lint
npm run build
npm audit --omit=dev
```

`scripts/readiness-browser-check.mjs` requires a preview at `127.0.0.1:4175` and isolated headless Chrome CDP at `127.0.0.1:9235`; run it with `node --experimental-websocket scripts/readiness-browser-check.mjs` from the project root. It intercepts API traffic and verifies renter/owner/admin browser states. It does not make real payments or approve actual documents.

Finish a live staging walkthrough for registration/OTP recipient delivery, KYC with consented test data, real camera capture, booking approval/payment/return, private evidence access, and backup restore. Check `/api/health`: it returns 200 only while MongoDB is connected and 503 otherwise. Exercise expected traffic and provider outages before launch. Keep database and file backups plus the previous release available; when rolling back application code, retain new additive fields/indexes and reconcile in-flight payments before restoring older payment logic.
