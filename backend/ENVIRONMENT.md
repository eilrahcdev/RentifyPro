# Backend environment configuration

`backend/.env.example` documents the current backend's 107 supported variables. The environment audit inspected 165 JavaScript, module, JSON, and configuration files, including scripts and tests. It also checked dynamic `process.env[name]` reads and the production validator's `env[key]` reads. Every supported variable has one assignment in the example.

The existing populated `.env` and Atlas backup were preserved. Missing optional keys do not need to be appended to a working `.env`: the backend already has defaults and compatibility fallbacks. Configure production values privately in Azure; do not replace a working `.env` with the example.

## Required configuration

Production startup still calls `assertProductionConfiguration()` in [server.js](server.js), backed by the unchanged [productionConfig.js](utils/productionConfig.js).

| Purpose | Production requirement |
| --- | --- |
| Runtime | `NODE_ENV=production`; the server respects the supplied `PORT`, with 5000 as its local fallback. |
| Database | At least one of `MONGO_URI` / `MONGO_URI_DIRECT`; `MONGO_AUTO_INDEX=false`. The direct URI takes precedence. |
| Authentication / internal service access | Private random `JWT_SECRET` and `INTERNAL_API_KEY`, each at least 32 characters. Match the internal key to the Face Service. |
| Public URLs / CORS | `BACKEND_PUBLIC_URL`, `FACE_SERVICE_URL`, and `CHATBOT_URL` must be public HTTPS service URLs. `FRONTEND_URL` must contain exact owned HTTPS origins; `ALLOW_VERCEL_PREVIEW_ORIGINS` must stay false. |
| External services | `FACE_SERVICE_AUTOSTART=false` and `CHATBOT_SERVICE_AUTOSTART=false`. |
| Persistent storage | Absolute mounted `STORAGE_ROOT`; `STORAGE_DURABILITY_CONFIRMED=true`. Public and private upload directories must remain separate inside that root. |
| Payments | Live `PAYMONGO_SECRET_KEY` and registered `PAYMONGO_WEBHOOK_SECRET`. Test keys require the existing explicit `PAYMONGO_ALLOW_TEST_MODE=true` staging exception. Keep `PAYMENT_RECONCILIATION_ENABLED=true`; the runtime defaults to enabled and the validator rejects explicit `false`. |
| Document screening | `GEMINI_API_KEY` and `GEMINI_SENSITIVE_DATA_APPROVED=true`, only after confirming the applicable billing and sensitive-data terms. |

`PASSWORD_RESET_TOKEN_SECRET` is optional and falls back to `JWT_SECRET`; if supplied in production, the validator requires at least 32 characters. `PRE_KYC_SESSION_SECRET`, `KYC_DOCUMENT_FINGERPRINT_SECRET`, and `LOG_HASH_SECRET` are optional dedicated secrets with the documented JWT fallback. SMTP settings are needed for registration/OTP/password-reset mail even though the production validator does not validate SMTP delivery.

In development, a MongoDB URI is needed to start the API. JWT, internal-service, Gemini, PayMongo, and SMTP credentials are required for their respective features; the template leaves those credentials blank. Local service URLs and autostart remain supported. The Face Service default is 8010, matching the backend manager and KYC controller; the Chatbot Service default is 8001.

## Compatibility aliases

| Canonical setting | Retained alias | Existing precedence |
| --- | --- | --- |
| `SMTP_USER` | `EMAIL_USER` | A nonempty canonical value wins; otherwise the legacy username is used. |
| `SMTP_PASS` | `EMAIL_PASS` | A nonempty canonical value wins; otherwise the legacy password is used. |
| `KYC_ALLOW_RULE_BASED_AUTO_VERIFY` | `KYC_ALLOW_GEMINI_AUTO_APPROVE` | A nonblank canonical switch wins; otherwise the legacy switch is used; default false. |
| `KYC_DOCUMENT_AUTO_VERIFY_MIN_CONFIDENCE` | `KYC_DOCUMENT_AUTO_APPROVE_MIN_CONFIDENCE` | A nonempty canonical value wins; otherwise the alias is used; default 85. |

Use a complete SMTP credential pair from one provider. The existing implementation falls back per field, so setting only one canonical credential can mix it with a legacy credential. No email or KYC behavior was changed. Final account approval still requires administrator review.

## Existing local variable audit

| Existing variables | Status / source |
| --- | --- |
| `PORT`, `NODE_ENV`, `ENABLE_RATE_LIMIT` | Active runtime/development controls; [server.js](server.js) and [security.middleware.js](middleware/security.middleware.js). Production rate limiting remains mandatory. |
| `MONGO_URI`, `MONGO_URI_DIRECT`, `MONGO_DB_NAME`, `MONGO_SERVER_SELECTION_TIMEOUT_MS` | Active database settings; [db.js](config/db.js) and database scripts. URI required; name and timeout optional. |
| `JWT_SECRET`, `JWT_EXPIRE`, `LOGIN_CHALLENGE_TTL_MINUTES` | Active authentication settings; [auth.controller.js](controllers/auth.controller.js). JWT secret required for authentication; expiry/challenge duration have defaults. |
| `FRONTEND_URL` | Active CORS and booking URL setting; [corsOrigins.js](utils/corsOrigins.js) and [booking.controller.js](controllers/booking.controller.js). Required in production. |
| `FACE_SERVICE_URL`, `CHATBOT_URL`, `INTERNAL_API_KEY` | Active service configuration; service managers, KYC controller, and chat route. Required in production. |
| `EMAIL_USER`, `EMAIL_PASS` | Active SMTP compatibility aliases; [sendEmail.js](utils/sendEmail.js). Preserved. |
| `PREKYC_DOC_TTL_HOURS`, `PREKYC_FACE_TTL_HOURS`, `PREKYC_CLEAR_ON_REGISTER` | Active optional retention/registration controls; KYC and auth controllers. Preserved. |
| `PAYMONGO_SECRET_KEY`, `PAYMONGO_PAYMENT_METHODS`, `BOOKING_TRANSACTION_FEE` | Active payment/fee settings; [paymongo.js](utils/paymongo.js) and [fees.js](utils/fees.js). Method list and fee have defaults. |
| `GEMINI_API_KEY` | Active screening credential; Gemini document, KYC, face, and vehicle-photo code. Required in production. |
| `NOTIFICATION_EMAIL_ENABLED` | Active optional notification-email switch; notification service and delivery job. Default false; OTP mail is independent. |
| `NOTIFICATION_ARCHIVE_RETENTION_DAYS`, `READ_NOTIFICATION_RETENTION_DAYS` | Active optional cleanup controls read dynamically by [notificationCleanup.job.js](jobs/notificationCleanup.job.js); defaults 90 and 30 days. |
| `KYC_MIN_CONFIDENCE` | Unused in current source. Preserved in the real `.env`; omitted from the authoritative template. Use the supported document confidence settings for new configuration. |
| `NOTIFICATION_MAX_RETENTION_DAYS`, `CHAT_NOTIFICATION_RETENTION_DAYS` | Unused in current source. Preserved in the real `.env`; omitted from the authoritative template. |

`CHATBOT_DATASET_PATH` appears in a regression test that confirms the backend ignores this old override. It is not a supported backend setting and is not included in the template.

## Chatbot metadata in backend-only deployments

The backend loads its chatbot metadata from `data/chatbot/chatbot_config.json` and `data/chatbot/rentifypro_chatbot_dataset_v6.json`, relative to the backend module location. These files must be included in the backend App Service deployment. They are byte-for-byte copies of the Python service's current source files; the Node backend keeps its existing v6 schema checks, response validation, guardrails, and multilingual behavior.

After editing either source file in `chatbot-service/`, run these commands from `backend/` before packaging or deploying:

```powershell
npm.cmd run chatbot:assets:sync
npm.cmd run chatbot:assets:check
```

The sync command validates both source JSON files before copying them. The check command is read-only and fails if either backend copy is missing or differs. The automated suite also checks synchronization when the full repository is available, and tests runtime loading in an isolated `wwwroot` directory without a sibling Python service.

Synchronization is a development/release step and does not run at App Service startup. The deployed backend needs only its own copies, not the Python application or its source directory. `CHATBOT_URL` and `CHATBOT_SERVICE_AUTOSTART` retain their existing behavior; Azure should continue using the external HTTPS classifier URL and `CHATBOT_SERVICE_AUTOSTART=false`. No new environment variables are required or introduced, and the old `CHATBOT_DATASET_PATH` override remains ignored.

## Variables added to the example

The original example had 38 variables. All 38 remain documented; the following 69 were added. Defaults, secret placeholders, inheritance rules, units, and optional overrides are recorded beside their assignments in `.env.example`.

| Group / primary readers | Added variables |
| --- | --- |
| Runtime: server, security middleware | `ENABLE_RATE_LIMIT`, `TRUST_PROXY_HOPS`, `JSON_BODY_LIMIT`, `URLENCODED_BODY_LIMIT`, `KYC_JSON_BODY_LIMIT` |
| MongoDB: connection config, connection diagnostic | `MONGO_CONNECT_RETRIES`, `MONGO_RETRY_DELAY_MS`, `MONGO_SERVER_SELECTION_TIMEOUT_MS` |
| Authentication: auth controller, pre-KYC session helper, audit logger | `PRE_KYC_SESSION_SECRET`, `PRE_KYC_SESSION_TTL`, `PRE_KYC_SESSION_MAX_RENEWAL_HOURS`, `OTP_RESEND_COOLDOWN_SECONDS`, `LOGIN_CHALLENGE_TTL_MINUTES`, `LOGIN_CHALLENGE_MAX_ATTEMPTS`, `AVATAR_MAX_BYTES`, `LOG_HASH_SECRET` |
| Face Service manager / local subprocess | `FACE_SERVICE_ENTRY`, `FACE_SERVICE_PYTHON_BIN`, `FACE_SERVICE_STARTUP_TIMEOUT_MS`, `FACE_SERVICE_HEALTH_TIMEOUT_MS`, `FACE_SERVICE_HEALTH_POLL_MS`, `TF_ENABLE_ONEDNN_OPTS`, `TF_CPP_MIN_LOG_LEVEL` |
| Chatbot Service manager | `CHATBOT_SERVICE_PYTHON_BIN`, `CHATBOT_SERVICE_RELOAD`, `CHATBOT_SERVICE_STARTUP_TIMEOUT_MS`, `CHATBOT_SERVICE_HEALTH_TIMEOUT_MS`, `CHATBOT_SERVICE_HEALTH_POLL_MS` |
| KYC screening: document worker, validation, Gemini and vehicle-photo services | `GEMINI_VEHICLE_PHOTO_MODEL`, `KYC_ALLOW_RULE_BASED_AUTO_VERIFY`, `KYC_DOCUMENT_AUTO_VERIFY_MIN_CONFIDENCE`, `KYC_DOCUMENT_AUTO_APPROVE_MIN_CONFIDENCE`, `KYC_DOCUMENT_CLASSIFICATION_MIN_CONFIDENCE`, `KYC_DOCUMENT_FINGERPRINT_SECRET`, `KYC_GEMINI_MAX_ATTEMPTS`, `KYC_GEMINI_REQUESTS_PER_MINUTE`, `KYC_DOCUMENT_QUEUE_POLL_MS`, `KYC_PROCESSING_LOCK_TIMEOUT_MS`, `KYC_DOC_MAX_BYTES`, `KYC_IMAGE_MAX_BYTES` |
| KYC lifetime: KYC/auth controllers, file-cleanup job | `PREKYC_DOC_TTL_HOURS`, `PREKYC_FACE_TTL_HOURS`, `PREKYC_CLEAR_ON_REGISTER`, `KYC_FILE_RETENTION_HOURS`, `KYC_PENDING_REVIEW_RETENTION_HOURS`, `KYC_FILE_CLEANUP_INTERVAL_MS` |
| Storage helper, production validator, admin routes | `PUBLIC_UPLOAD_DIR`, `AVATAR_UPLOAD_DIR`, `KYC_UPLOAD_DIR`, `REPORT_EVIDENCE_DIR`, `WEBSITE_BACKEND_DIR` |
| Payment methods: PayMongo helper | `PAYMONGO_PAYMENT_METHODS` |
| Mail transport | `SMTP_SERVICE`, `EMAIL_USER`, `EMAIL_PASS`, `SMTP_TLS_INSECURE` |
| Notification delivery/cleanup and audit-log retention jobs | `NOTIFICATION_EMAIL_ENABLED`, `NOTIFICATION_DELIVERY_INTERVAL_MS`, `NOTIFICATION_CLEANUP_INTERVAL_MS`, `READ_NOTIFICATION_RETENTION_DAYS`, `NOTIFICATION_ARCHIVE_RETENTION_DAYS`, `AUDIT_LOG_RETENTION_DAYS` |
| Booking fee, lifecycle job, late-return policy | `BOOKING_TRANSACTION_FEE`, `BOOKING_LIFECYCLE_INTERVAL_MS`, `BOOKING_OVERDUE_GRACE_MINUTES` |
| Maintenance scripts only | `MONGO_LOCAL_URI`, `MONGO_LOCAL_DB_NAME`, `BIOMETRIC_TEMPLATE_TTL_HOURS`, `TEST_EMAIL_TO` |

## Owner-configured late-return fees

Owners can set a percentage of the booking-time hourly rental/selected-driver rates, or a fixed peso amount per overdue hour. When no fee value is configured, the effective fee is zero. Vehicle creation, model defaults, owner form defaults, and renter fee estimates follow that rule.

`LATE_RETURN_PENALTY_MULTIPLIER` is no longer read by application code and is not a required or recommended Azure setting. It has been removed from `.env.example`; existing real `.env` values were preserved. `BOOKING_OVERDUE_GRACE_MINUTES` remains an optional grace-period fallback and does not introduce a charge.

Existing booking policies, hourly-rate snapshots, and finalized fees remain authoritative. No records are migrated or rewritten. Existing stored vehicle fee values, including 25 percent, remain effective because the stored value cannot distinguish an owner choice from a former default.

## Azure configuration to complete

Set the production requirements above in App Service configuration using the real deployed URLs and private credentials. For the specified Azure Files mount, configure `STORAGE_ROOT=/mounts/rentifypro` and `STORAGE_DURABILITY_CONFIRMED=true` after verifying that the mount persists writes. Leave directory overrides empty to derive paths from the root, or keep overrides inside the mount with public/private separation. No mount path or Azure URL is hard-coded in application logic.

Keep both service autostart switches false for the existing Container Apps services. Configure the exact frontend origin(s), public backend URL, matching internal key, SMTP provider/sender, registered PayMongo webhook secret, live payment key (or explicit staging mode), and Gemini acknowledgement. Supply private random authentication/internal secrets that meet the existing production checks. Use the existing database migration process for required indexes with `MONGO_AUTO_INDEX=false`.

The local configuration currently reports 11 production validation errors: runtime mode; JWT/internal secret requirements; explicit auto-index setting; public backend URL; both autostart switches; payment mode; webhook secret; Gemini acknowledgement; and mounted storage confirmation. No fake production values were inserted and `npm run production:check` was not run as a deployment-readiness check. Run it in the real Linux deployment environment once these settings are available; the POSIX mount path is evaluated by Linux's path rules.

The environment audit does not establish mounted-volume persistence, SMTP delivery, signed webhook delivery, provider quotas, or hosted workflow correctness. Those still need verification against the deployment.

## Validation commands

Run from `backend/` (use `npm.cmd` instead of `npm` if PowerShell blocks `npm.ps1`):

```powershell
npm.cmd test -- --test-reporter=dot "tests/*.test.js"
npm.cmd audit --omit=dev
npm.cmd run db:check
npm.cmd run services:check
```

The current `npm test` script uses unrestricted Node test discovery, which also discovers the manual `test-email.js` script. Explicitly selecting `tests/*.test.js` runs the automated suite without sending a real diagnostic email. The existing package-file edits were preserved.

Automated backend tests passed on Node 24.19.0. `npm audit --omit=dev` reported zero vulnerabilities. The existing live MongoDB and Face/Chatbot service checks passed with network access, with configured values hidden from output. Template coverage, duplicate-key checks, secret-placeholder checks, source preservation, and the final scoped diff were also verified.

Real `.env` files and backups remain ignored by Git; `.env.example` remains allowed. No dependencies were installed and no database migrations were applied. Late-return fallbacks now use zero while preserving owner-configured fees and existing booking snapshots. The earlier environment audit also corrected the Face Service's fallback port in its startup log.
