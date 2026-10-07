# Deploy RentifyPro: Vercel + Render + MongoDB Atlas

## 1. MongoDB Atlas setup

1. Create a database user (Database Access) and save username/password.
2. In Network Access, allow only Render's documented egress addresses or private-network connectivity. Do not allow `0.0.0.0/0`.
3. In Atlas "Connect" -> "Drivers" -> Node.js:
   - copy the SRV URI (`mongodb+srv://...`) for `MONGO_URI`
   - copy the standard URI (`mongodb://host1,host2,...`) for `MONGO_URI_DIRECT` fallback.
4. Use a URI with your DB name, for example `/rentifypro`.

## 2. Render backend environment variables

Set at least:

- `NODE_ENV=production`
- `PORT=10000` (or let Render inject `PORT`)
- `MONGO_URI=<atlas-srv-uri>`
- `MONGO_URI_DIRECT=<atlas-standard-uri>` (recommended fallback)
- `MONGO_DB_NAME=rentifypro`
- `FRONTEND_URL=https://<your-vercel-domain>` (or comma-separated origins)
- `ALLOW_VERCEL_PREVIEW_ORIGINS=false` (list owned preview origins explicitly in `FRONTEND_URL`)
- `JWT_SECRET=<strong-secret>`
- `INTERNAL_API_KEY=<long-random-shared-secret>` (must exactly match the face service; never use a default)
- `MONGO_AUTO_INDEX=false` (run schema/index changes through reviewed migrations)
- `STORAGE_ROOT=/var/data/rentifypro` on a mounted persistent disk for one backend instance
- `STORAGE_DURABILITY_CONFIRMED=true` only after verifying the disk mount and persistence
- `GEMINI_SENSITIVE_DATA_APPROVED=false` blocks sensitive Gemini KYC. Use manual review, or deploy the separate private OCR service and configure `KYC_DOCUMENT_PROVIDER=private_ocr`, its owned HTTPS `KYC_PRIVATE_SERVICE_URL`, and a shared explicit document-fingerprint secret as described in [backend configuration](../backend/ENVIRONMENT.md#private-document-extraction). Enable Gemini only after confirming the key's billing-enabled project and applicable sensitive-data terms.
- `BACKEND_PUBLIC_URL=https://<your-render-backend-domain>`
- `PAYMONGO_SECRET_KEY=<private-live-key>`
- `PAYMONGO_WEBHOOK_SECRET=<secret-for-the-registered-endpoint>`
- `PAYMENT_RECONCILIATION_ENABLED=true`
- `KYC_JSON_BODY_LIMIT=8mb`, `KYC_IMAGE_MAX_BYTES=4194304`, `KYC_MAX_FRAMES=5`
- `KYC_FILE_RETENTION_HOURS=3`, `AUDIT_LOG_RETENTION_DAYS=30`
- `NOTIFICATION_EMAIL_ENABLED=true` (enable only after SMTP delivery is tested)
- `READ_NOTIFICATION_RETENTION_DAYS=30`, `NOTIFICATION_ARCHIVE_RETENTION_DAYS=90`
- `SMTP_HOST=smtp.gmail.com` (or your SMTP host)
- `SMTP_PORT=587`
- `SMTP_SECURE=false` (`true` if using port 465)
- `SMTP_USER=<email>`
- `SMTP_PASS=<app-password>`
- `EMAIL_FROM=<email>`
- `EMAIL_FROM_NAME=RentifyPro`
- `FACE_SERVICE_AUTOSTART=false`
- `CHATBOT_SERVICE_AUTOSTART=false`

If face/chatbot are deployed as separate services, set:

- `FACE_SERVICE_URL=https://<your-face-service-domain>`
- `CHATBOT_URL=https://<your-chatbot-service-domain>`

If you deploy `face-service`, use the same Mongo variables there as well:

- `MONGO_URI=<atlas-srv-uri>`
- `MONGO_URI_DIRECT=<atlas-standard-uri>`
- `MONGO_DB_NAME=rentifypro`
- `INTERNAL_API_KEY=<the-same-long-random-shared-secret>`
- `BIOMETRIC_TEMPLATE_TTL_HOURS=24`

## 3. Vercel frontend environment variables

Set:

- `VITE_API_BASE_URL=https://<your-render-backend-domain>`
- `VITE_SOCKET_URL=https://<your-render-backend-domain>`

Important:
- Use `https://` URLs (not `http://`) to avoid browser mixed-content fetch failures.

## 4. Fix for `querySrv ECONNREFUSED`

If you see:

`querySrv ECONNREFUSED _mongodb._tcp.<cluster>.mongodb.net`

it means SRV DNS lookup failed on your current network/DNS path.

Use one or more of these fixes:

1. Set `MONGO_URI_DIRECT` to the standard (non-SRV) Atlas URI.
2. Switch DNS to Cloudflare (`1.1.1.1`) or Google (`8.8.8.8`).
3. Disable VPN/proxy/firewall DNS filtering temporarily and retest.
4. Confirm Atlas Network Access allows your source IP.

## 5. Fix for `bad auth : authentication failed`

If direct URI connects to hosts but returns Atlas `code 8000`, credentials are invalid.

1. Atlas -> Database Access -> select your database user -> reset password.
2. Put the exact new credentials into both `MONGO_URI` and `MONGO_URI_DIRECT`.
3. If password has special characters, URL-encode it before placing it in URI.
4. Grant only the role needed for this application's database, ideally collection-scoped `readWrite` access. Do not use `readWriteAnyDatabase` for the web or face service.

For local verification from backend folder:

`npm run db:check`

## 6. Required data operations before production

1. Take and test an Atlas point-in-time restore before migrations. Keep an encrypted copy in a separate account/project according to your RPO/RTO.
2. Run `npm run db:migrate:kyc` first (dry run), review counts, then run `npm run db:migrate:kyc -- --apply`. The legacy collection is retained for rollback.
3. For one backend instance, attach a persistent disk and set `STORAGE_ROOT`. All upload classes now use this volume while retaining public/private access boundaries. Copy existing files with their original names, back up the volume, and test a restore. An object-storage integration is required before moving to multiple instances; see [production release checks](production-release-checks.md).
4. Configure Redis for shared rate limits, job leases, and short public-response caching before scaling to multiple backend instances. Logout token revocations are stored in MongoDB.
5. Run `npm run db:migrate:notifications` first (dry run), then `npm run db:migrate:notifications -- --apply` after backup. Test one booking notification email before enabling it for all users.
6. Run `npm run db:migrate:session-revocations` first (dry run), then `npm run db:migrate:session-revocations -- --apply` before deploying the backend auth changes. This creates the lookup and TTL indexes for hashed logout tokens.
7. Run `npm run db:migrate:payments` first (dry run), then `npm run db:migrate:payments -- --apply` after backup. Register the signed PayMongo webhook and complete the staging payment checks in [production release checks](production-release-checks.md).
8. Run `npm run production:check` on the target environment before starting the backend. Production startup now rejects missing configuration; development startup retains its existing defaults.
