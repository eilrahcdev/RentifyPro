# Backend environment configuration

`backend/.env.example` documents backend configuration, including the optional private OCR provider. The earlier environment audit also checked dynamic `process.env[name]` reads and the production validator's `env[key]` reads.

The existing populated `.env` and Atlas backup were preserved. Missing optional keys do not need to be appended to a working `.env`: the backend already has defaults and compatibility fallbacks. Configure production values privately in Azure; do not replace a working `.env` with the example.

## Required configuration

Production startup calls `assertProductionConfiguration()` in [server.js](server.js), backed by [productionConfig.js](utils/productionConfig.js). Gemini KYC is optional; all other production requirements remain unchanged.

| Purpose | Production requirement |
| --- | --- |
| Runtime | `NODE_ENV=production`; the server respects the supplied `PORT`, with 5000 as its local fallback. |
| Database | At least one of `MONGO_URI` / `MONGO_URI_DIRECT`; `MONGO_AUTO_INDEX=false`. The direct URI takes precedence. |
| Authentication / internal service access | Private random `JWT_SECRET` and `INTERNAL_API_KEY`, each at least 32 characters. Match the internal key to the Face Service. Python chatbot access uses the matching `CHATBOT_INTERNAL_API_KEY` when supplied, otherwise `INTERNAL_API_KEY`. |
| Public URLs / CORS | `BACKEND_PUBLIC_URL`, `FACE_SERVICE_URL`, and `CHATBOT_URL` must be public HTTPS service URLs. `FRONTEND_URL` must contain exact owned HTTPS origins; `ALLOW_VERCEL_PREVIEW_ORIGINS` must stay false. |
| External services | `FACE_SERVICE_AUTOSTART=false` and `CHATBOT_SERVICE_AUTOSTART=false`. |
| Persistent storage | Absolute mounted `STORAGE_ROOT`; `STORAGE_DURABILITY_CONFIRMED=true`. Public and private upload directories must remain separate inside that root. |
| Payments | Live `PAYMONGO_SECRET_KEY` and registered `PAYMONGO_WEBHOOK_SECRET`. Test keys require the existing explicit `PAYMONGO_ALLOW_TEST_MODE=true` staging exception. Keep `PAYMENT_RECONCILIATION_ENABLED=true`; the runtime defaults to enabled and the validator rejects explicit `false`. |
| Document screening | Keep `GEMINI_SENSITIVE_DATA_APPROVED=false` to block sensitive Gemini KYC. The default provider then uses manual review. Select `KYC_DOCUMENT_PROVIDER=private_ocr` to use your separately deployed checker, with an owned HTTPS `KYC_PRIVATE_SERVICE_URL` and an explicit 32+ character `KYC_DOCUMENT_FINGERPRINT_SECRET`. A Gemini key remains required only when Gemini sensitive-data approval is `true`. |

`PASSWORD_RESET_TOKEN_SECRET` is optional and falls back to `JWT_SECRET`; if supplied in production, the validator requires at least 32 characters. `PRE_KYC_SESSION_SECRET` and `LOG_HASH_SECRET` retain their JWT fallback. `KYC_DOCUMENT_FINGERPRINT_SECRET` retains that fallback for legacy Gemini fingerprinting, but private OCR and manual comparison require an explicit shared secret so the website and separate admin backend produce the same fingerprints. SMTP settings are needed for registration/OTP/password-reset mail even though the production validator does not validate SMTP delivery.

In development, a MongoDB URI is needed to start the API. JWT, internal-service, Gemini, PayMongo, and SMTP credentials are required for their respective features; the template leaves those credentials blank. Local service URLs and autostart remain supported. The Face Service default is 8010, matching the backend manager and KYC controller; the Chatbot Service default is 8001.

With `GEMINI_SENSITIVE_DATA_APPROVED=false` and the default `gemini` provider, ID and supporting-document uploads are stored privately as `pending_review`, with no automatic approval. The queue moves existing queued/retry documents into manual review without reading their image files or contacting Gemini. The document extractor and both Gemini face helpers also reject unapproved requests. An explicit false disables Gemini KYC in development too; leaving the switch unset outside production retains the existing development behavior.

Files, profile snapshots, and existing retention settings remain available to the protected administrator review endpoints. Identity-detail matching and selfie approval gates remain unchanged: an unscreened ID is not treated as matched and cannot be approved merely because it is pending review. The separate Face Service and vehicle-photo screening behavior are unchanged.

## Private document extraction

The CPU reader enables MKL-DNN acceleration with a one-shape cache and the existing single-image recognition batch. It keeps the same local models, 1400-pixel image limit, field-confidence thresholds and manual approval policy. `KYC_OCR_ENABLE_MKLDNN=false` selects the previous CPU path when a host needs lower memory usage; an unsupported acceleration kernel also falls back during startup. The local launcher passes this optional setting from the backend environment to Python. Separately launched or hosted Python processes need it in their own environment. No new credential is required.

The private queue waits for local model warmup before claiming work. Its default abandoned-claim recovery window is 60000 ms, with a minimum of the configured OCR HTTP timeout plus 30000 ms for result writes. Longer explicit `KYC_PROCESSING_LOCK_TIMEOUT_MS` values remain effective; Gemini retains its 600000 ms default. This recovers interrupted work after a restart without reclaiming a normal active request. File-hash, review-version and claim-time guards still reject stale writes.

Restart Python and both Node backends after applying the optimization; an already running compatible Python process retains its old settings until restarted. These changes accelerate automated checking, not administrator approval. Local reading benchmarks and measured memory trade-offs are documented in [the OCR README](../kyc-ocr-service/README.md#performance-and-restart-recovery).

`KYC_DOCUMENT_PROVIDER` accepts `gemini` (the backward-compatible default), `private_ocr`, or `manual`. Provider selection never falls back to Gemini. `private_ocr` works while `GEMINI_SENSITIVE_DATA_APPROVED=false`; `manual` disables automated document extraction. Invalid provider values fail production validation.

Deploy [kyc-ocr-service](../kyc-ocr-service/README.md) separately from the Node App Service. The backend sends only document bytes, MIME type, and protocol version to its authenticated `/inspect` endpoint. Registration profiles stay in Node. The service uses local CPU PaddleOCR models, OpenCV image conversion, and bounded PDF rendering; it stores no document files and makes no model-download requests during inference. Production never autostarts this service. For local development, `npm.cmd run kyc:ocr:dev` explicitly launches one CPU worker using an existing isolated Python environment; the launcher rejects production use.

To start OCR with `npm.cmd run dev`, set `KYC_PRIVATE_SERVICE_AUTOSTART=true` alongside `KYC_DOCUMENT_PROVIDER=private_ocr` and `KYC_PRIVATE_SERVICE_URL=http://127.0.0.1:8020` in the local backend `.env`. Startup runs in the background while models load. An existing service is reused only when `/health` reports `ready=true`, `schema_version=1`, `provider=paddleocr`, and `layout_version=2`. An occupied unavailable or incompatible service produces a restart warning without launching another process or terminating the existing one. Backend shutdown stops only the OCR process it launched. Keep autostart false on Azure; even if set true, it is ignored in production and for remote URLs.

For private mode, configure:

| Setting | Requirement |
| --- | --- |
| `KYC_DOCUMENT_PROVIDER=private_ocr` | Explicitly selects private extraction. Leaving it unset preserves existing behavior. |
| `KYC_PRIVATE_SERVICE_URL` | Required in private mode; your owned HTTPS service URL in production, loopback HTTP allowed locally. Credentials, query strings, fragments, and redirects are rejected. |
| `KYC_PRIVATE_SERVICE_AUTOSTART` | Optional, default false. True starts one local OCR worker alongside the development backend. Ignored in production, with remote URLs, and with other document providers. |
| `KYC_PRIVATE_INTERNAL_API_KEY` | Optional dedicated private 32+ character OCR key. Blank falls back to the existing `INTERNAL_API_KEY`. Set the chosen value as Python's `INTERNAL_API_KEY` and use the same OCR key on the admin backend. A dedicated key lets existing Face/Chatbot credentials remain unchanged. |
| `KYC_DOCUMENT_FINGERPRINT_SECRET` | Explicit private 32+ character secret, identical on website and admin backends. Required for private-mode production and every manual comparison. |
| `KYC_PRIVATE_REQUEST_TIMEOUT_MS` | Optional, default 30000; accepted range 1000–120000. No effect on Gemini timeout. |
| `KYC_OCR_ENABLE_MKLDNN` | Optional Python reader setting, default true. False uses the baseline CPU reader. Local Node launchers pass it to Python; hosted Python requires its own setting. Restart Python after changing it. |

Private extraction independently checks the OCR title and issuing-body text against the existing 10 ID and 7 supporting-document types before comparing registration details. A confidently detected wrong type, no recognized type, or conflicting types requires a new upload; matching personal/business details cannot override this result. Low-confidence type evidence remains for manual review. The selected type is never used as a detected-type fallback, and known mismatches cannot be overridden during comparison or final approval.

Matching types supply preliminary field comparisons, then leave the upload `pending_review` and `detailsMatched=false`. A successful current automated match can unlock pre-registration selfies, while final document approval still requires the recorded manual comparison. A versioned keyed binding ties selfie readiness to the current private file, selected type, session, role, and registration snapshot; stale or legacy screening results cannot unlock it. Existing approved documents remain authoritative. The existing automatic-verification switches do not approve private OCR results. Transient service failures use the bounded queue retries; permanent provider failures proceed to manual review. The Gemini request throttle still applies only to Gemini; the private service permits one extraction at a time.

The private checker consumes bounded OCR positions and requires at least 90% confidence for document classification and each critical field. It compares the selected type, name, and birth date when required by the existing role's registration flow; business comparisons require the registered name and applicable registration/permit or BIR TIN/branch values. ID numbers, applicable expiry, and duplicate fingerprints remain checked. English/Filipino labels and the National ID's unlabelled card number are supported. A stronger existing classification threshold is honored. Business names are compared in full after formatting normalization; partial names cannot pass. Ambiguous readings and dates require correction or review. Split labels need positions to associate their values; legacy inline readings remain compatible. Rigid layout, country-banner, OCR portrait, and MRZ presence checks are not conditions for proceeding to selfies. Face matching/liveness and final manual inspection remain separate. OCR confidence is not a probability that a document is genuine, and no issuer lookup or MRZ checksum validation is performed.

Registration shows one specific result per document beside its upload controls, without a checklist or repeated result badges. Successful ID matching opens selfie controls; failures identify the wrong type or first mismatched/unreadable field. A per-upload revision prevents an old response from confirming a replacement document or corrected profile. Status responses expose no extracted names/numbers, OCR text, profile bindings, or file hashes. Final admin approval and live face verification remain required. No new environment variables are required; the existing explicit fingerprint secret also keys the current-result binding.

Private OCR uses up to two attempts with a three-second retry delay for transient service failures, independently of Gemini settings. A private request timeout proceeds to manual review without submitting the same native inference again. The worker drains ready private documents sequentially without the previous five-second gaps between jobs; active frontend status polling is 1.25 seconds and slows during manual review. The 30-second private request timeout remains configurable through the existing setting. Restart Python and Node after installing these changes. Live `/inspect` responses must contain protocol 1 and position format `layout_version=2`; older formats produce `PRIVATE_KYC_SERVICE_INCOMPATIBLE` and preserve the upload for manual review without blaming document readability or repeatedly retrying an outdated worker. Legacy response normalization and existing approved/manual evidence remain compatible. Split-field extraction never guesses from the next OCR line when positions are missing. Re-uploading after the service update requeues an unmatched incompatible result; existing approved or current manually compared documents remain authoritative. A legacy stored screening result must be rechecked through a new submission before it can unlock selfies automatically.

In the admin review, inspect the original file, correct OCR suggestions, confirm the required document features, and save a comparison. Both backends reuse the existing type, country, name, birth-date, business, TIN/branch, expiry, and duplicate-identifier rules. A mismatch cannot be saved as matched. Comparisons require the current file hash and review version and store masked summaries and reviewer evidence; original OCR names/numbers are not retained. OCR suggestions are obtained again when an unmatched document is opened, so this adds one private request per review opening. If OCR is unavailable, the administrator can enter the fields from the original file.

Saving a comparison does not approve the document or account. Final approval remains separate, and identity/selfie reconciliation still checks the document associated with the completed selfie challenge. The admin backend retains its session, password reauthentication, reason, and audit requirements. Both deployment backends must have access to the same existing private KYC storage and database; do not mount that directory publicly.

The separate admin checkout contains backend-owned copies in `backend/data/private-kyc/`. From the main repository root, synchronize before shipping either backend:

```powershell
node backend/scripts/sync-admin-kyc-assets.js '--destination=C:/Users/charlie/rentifypro admin/backend/data/private-kyc'
node backend/scripts/sync-admin-kyc-assets.js '--destination=C:/Users/charlie/rentifypro admin/backend/data/private-kyc' --check
```

Use your actual absolute checkout path. The eight copied modules are a release-time dependency; deployed admin code loads its own copies and does not require a sibling main repository. The synchronization test also checks that those modules load in an isolated backend directory.

Local private OCR can be selected in the real `.env` for development testing. Keep its loopback endpoint confined to local development; deploy and test an owned HTTPS endpoint before selecting `private_ocr` in Azure. Keep all credentials and environment backups out of Git.

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
| `PAYMONGO_SECRET_KEY`, `PAYMONGO_PAYMENT_METHODS`, `BOOKING_TRANSACTION_FEE` | Active payment/fee settings; [paymongo.js](utils/paymongo.js) and [fees.js](utils/fees.js). The transaction fee defaults to PHP 100 per booking for every vehicle; existing bookings retain their stored fee. |
| `GEMINI_API_KEY` | Active screening credential; Gemini document, KYC, face, and vehicle-photo code. Required for production Gemini KYC only when `GEMINI_SENSITIVE_DATA_APPROVED=true`; optional for startup in manual-review mode. |
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

Synchronization is a development/release step and does not run at App Service startup. The deployed backend needs only its own copies, not the Python application or its source directory. `CHATBOT_URL` and `CHATBOT_SERVICE_AUTOSTART` retain their existing behavior; Azure should continue using the external HTTPS classifier URL and `CHATBOT_SERVICE_AUTOSTART=false`. Asset synchronization requires no additional environment variables, and the old `CHATBOT_DATASET_PATH` override remains ignored.

## API request budgets and chatbot service access

Production always enables rate limiting. Development uses `ENABLE_RATE_LIMIT=true` to exercise the same controls. General API counters belong to one Node process and reset on restart; configure a shared store before scaling to multiple backend instances. Dedicated chatbot shared storage is described below. Provider/CDN traffic filtering and a correctly configured trusted proxy remain deployment tasks.

| Budget | Default | Optional override |
| --- | --- | --- |
| API requests per IP, before body parsing | 1,000 per minute, including signed-in callers | `RATE_LIMIT_IP_MAX` |
| General guest API requests per IP | 100 per 5 minutes | `RATE_LIMIT_GUEST_MAX` |
| General signed-session API requests per account | 600 per 5 minutes | `RATE_LIMIT_USER_MAX` |
| Payment checkout creation per account | 10 per 5 minutes | `RATE_LIMIT_PAYMENT_CREATE_MAX` |
| Vehicle creation/editing per account, before multipart processing | 30 per 5 minutes, shared across create/edit | `RATE_LIMIT_VEHICLE_WRITE_MAX` |
| Message sends per account | 30 per minute | `RATE_LIMIT_MESSAGE_MAX` |
| Pre-KYC status checks per IP | 1,200 per 5 minutes | `RATE_LIMIT_KYC_STATUS_IP_MAX` |
| Pre-KYC status checks per verified pre-KYC session | 600 per 5 minutes | `RATE_LIMIT_KYC_STATUS_MAX` |

Overrides must be positive safe integers; missing, empty, zero, negative, or invalid values retain the defaults. Restart Node after changing them. These starting budgets allow existing 1.25-second verification polling in two tabs; tune against ordinary hosted usage and server capacity. Only the exact status-read route gets the separate polling budgets. Its token validation and private response handling remain in place. KYC attempts retain their route-level limits without the previous duplicate router-wide attempt counter. Existing login/OTP, verification, booking, report, payment-verification, and photo-upload controls retain their existing policies. Chatbot budgets are described separately below.

`GET /api/health` has a separate 120-per-minute IP budget, so exhausting a caller's ordinary API budget does not itself turn health checks into failures. The signed PayMongo webhook remains before the other API gates, with its independent 120-per-minute limit and raw request bytes. HTTP budgets do not constitute provider-level DDoS protection or limits on every Socket.IO event.

`TRUST_PROXY_HOPS` must match the real proxy chain. Use `0` for direct connections with no trusted proxy; the existing default is `1`. At the hosted deployment, confirm that different visitors produce different `req.ip` values and that untrusted forwarding headers cannot change the observed client identity. Do not change it to unconditional `true`. Restrict origin access to the trusted ingress when the host permits it.

Node sends `x-internal-key` to Python. Both services choose a nonblank `CHATBOT_INTERNAL_API_KEY` first and otherwise use `INTERNAL_API_KEY`; the chosen chatbot key must contain at least 32 characters. A dedicated chatbot key allows existing Face/OCR credentials to remain unchanged. Store it privately in both hosting environments; no service key belongs in frontend code. Missing/weak configuration rejects chat with HTTP 503; missing/wrong request keys receive HTTP 403 before body validation or classification. Python's `/`, `/docs`, and `/openapi.json` require the key too. `/health` remains a public minimal readiness response. Service-key failures return a generic temporary chatbot-unavailable response to the browser and never ask the user to log in.

Local Node autostart passes its environment to Python. For a manually started local service, run this from `chatbot-service/`:

```powershell
.\venv\Scripts\python.exe -m uvicorn app:app --env-file ../backend/.env --host 127.0.0.1 --port 8001
```

Restart an already-running Python service as well as Node after applying this change. Autostart can reuse an existing service and cannot update that process's code/environment. For hosted rollout, first set the matching key in both services, deploy Node's header support, then deploy Python's enforcement. Keep the existing production URL/autostart checks. Internal Container Apps ingress is optional and requires verified backend network access before switching it on.

`npm.cmd run services:check` checks public chatbot health, authenticated metadata access, and denial of metadata access without the key. Run it against the intended configured deployment after both services restart. Automated coverage uses synthetic keys and isolated handlers; it does not establish hosted proxy behavior, production load capacity, or external provider availability.

### Local chatbot development startup

Keep `CHATBOT_URL=http://127.0.0.1:8001` in the ignored local `backend/.env`, with `NODE_ENV=development`. This persists across ordinary restarts. The earlier localhost mismatch came from an Azure URL saved in that local file; a terminal-only override corrected the running process but could not correct the next session. Do not copy the local URL into Azure configuration: production still uses its separately configured HTTPS service URL and `CHATBOT_SERVICE_AUTOSTART=false`.

`npm.cmd run dev` uses `nodemon server.js`; Node loads `.env` from its working directory via `dotenv/config`. Existing process environment values take precedence over `.env`. Run backend commands from `backend/` and clear any old terminal `CHATBOT_URL` override before starting. The route and service manager use that resolved URL; neither switches to Azure when a configured local service is unavailable.

Start in this order, using three PowerShell terminals from the repository root:

1. Start Python with the existing virtual environment and matching private backend service key:

   ```powershell
   cd chatbot-service
   .\venv\Scripts\python.exe -m uvicorn app:app --env-file ../backend/.env --host 127.0.0.1 --port 8001
   ```

   If the model is already cached and you need an offline session, set `$env:HF_HUB_OFFLINE="1"` and `$env:TRANSFORMERS_OFFLINE="1"` in this terminal before starting Python. These optional process settings do not change `CHATBOT_URL` or the model.

2. Wait for Python startup, then verify its connection before starting Node:

   ```powershell
   cd backend
   Remove-Item Env:CHATBOT_URL -ErrorAction SilentlyContinue
   npm.cmd run services:check -- --chatbot-local
   if ($LASTEXITCODE -eq 0) { npm.cmd run dev }
   ```

3. Start React:

   ```powershell
   cd frontend
   npm.cmd run dev
   ```

The expected addresses are React `http://localhost:5173`, Node `http://localhost:5000`, and Python `http://127.0.0.1:8001`. Stop an existing instance before starting its replacement. Restart Python after Python source changes; Node autostart can reuse an old running Python process. This manual startup sequence does not require changing the existing autostart setting.

`services:check -- --chatbot-local` checks only the configured local chatbot: health, authenticated metadata, and rejection of unauthenticated metadata access. It compares revision, intent count, and dataset/config SHA-256 hashes with the current local Python source. At this revision it must report `search-relevance-limits-2026-10-12`, `61 intents`, and matching hashes. A stale service, hosted URL, unreachable service, or incorrect private key fails the check with a nonzero exit code. It does not start services, change configuration, or fall back to another URL. The existing `services:check` command without the flag retains its general service checks.

The check reports the effective configuration for a newly launched process. To confirm a running Node process, also inspect its startup `Chatbot:` URL and send a normal chat request after restarting it from that same terminal. `/health` alone does not identify the classifier version, and metadata keys must never be supplied to the browser.

## Variables added to the example

The original example had 38 variables. Those remain documented alongside the additional groups below. Defaults, secret placeholders, inheritance rules, units, and optional overrides are recorded beside their assignments in `.env.example`. Request-budget overrides and the optional dedicated chatbot key are described above.

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

## Chatbot request budgets and shared storage

Only `POST /api/chat` uses these dedicated budgets instead of the general API budget. The early IP budget still applies, as do existing route authentication and private-record checks. Other `/api/chat/...` messaging routes keep their existing limits. Production always enables protection; development can exercise it with `ENABLE_RATE_LIMIT=true`.

| Setting | Default | Purpose |
| --- | --- | --- |
| `CHATBOT_BURST_MAX` | 20 | Admitted messages per signed account or server-issued guest session |
| `CHATBOT_BURST_WINDOW_MS` | 30000 | Burst window in milliseconds |
| `CHATBOT_SUSTAINED_MAX` | 120 | Admitted messages per identity over the sustained window |
| `CHATBOT_SUSTAINED_WINDOW_MS` | 600000 | Sustained window in milliseconds |
| `CHATBOT_GUEST_IP_BURST_MAX` | 100 | Aggregate guest burst budget per observed IP/subnet |
| `CHATBOT_GUEST_IP_SUSTAINED_MAX` | 600 | Aggregate guest sustained budget per observed IP/subnet |
| `CHATBOT_MAX_CONCURRENT` | 4 | In-flight chatbot requests across the configured store |
| `CHATBOT_GUEST_IP_CONCURRENT` | 2 | In-flight guest requests per IP/subnet |
| `CHATBOT_IN_FLIGHT_TTL_MS` | 30000 | Crash-recovery lifetime for an in-flight lease |
| `CHATBOT_RATE_LIMIT_STORE` | `memory` | `memory` for one process; `mongodb` for shared counters and leases |
| `CHATBOT_BACKEND_INSTANCES` | 1 | Maximum backend process/replica count; also checks `WEB_CONCURRENCY` |

Each identity permits one in-flight request. All applicable fixed-window budgets and concurrency capacity admit a message in one transaction. The two existing middleware exports share that admission and charge it once, including when their order is reversed. Blocked requests neither reserve capacity nor increment message counters or move reset deadlines. HTTP 429 includes `CHAT_RATE_LIMITED`, a layer, and bounded integer `Retry-After`. `retryAfterMs` preserves the exact remaining duration; `retryAfterAt` is its stable deadline, while the seconds/header round up. The retry covers every currently exhausted budget and capacity constraint, rather than whichever middleware runs first. Capacity timing uses lease expiry as its known recovery bound; processing may finish earlier. Store failures return HTTP 503 `CHAT_LIMITER_UNAVAILABLE` without classification. Admitted failed/cancelled requests still count once because work may have started; refunded failed requests would permit failure floods. Invalid nonempty overrides reject configuration: counts are 1–10000, windows 1–3600000 ms, concurrency 1–64, leases 1–300000 ms, and process count 1–256. The sustained window must cover the burst window. Keep the lease longer than expected request processing; the classifier's existing HTTP timeout is 15 seconds.

Signed identities come from verified authentication cookies. Guests receive the separate signed, HttpOnly `rp_chat_guest` cookie, scoped to `/api/chat`, with a 24-hour lifetime. It conveys no authentication or role. Production uses Secure/SameSite=None; development uses SameSite=Lax. Missing, expired, forged, or browser-blocked guest cookies use an IP fallback and still share the guest IP guard. Clearing cookies cannot remove that guard. Keys are purpose-derived HMAC hashes; counters contain no chat text, raw IPs, raw user IDs, credentials, or private rental records. Keep `JWT_SECRET` consistent across replicas and follow the existing production secret requirements. Existing `TRUST_PROXY_HOPS` is unchanged and must match the actual ingress chain.

Memory counters are bounded and reset on process restart. Set `CHATBOT_RATE_LIMIT_STORE=mongodb` and the actual `CHATBOT_BACKEND_INSTANCES` before using multiple processes or replicas; memory with a declared count above one fails startup. The application cannot infer an Azure replica count that the operator has not declared. Mongo uses the existing connection and a separate temporary `chatbot_limits` collection, snapshot/majority transactions, and an `expiresAt` TTL index. Use a transaction-capable replica set/Atlas deployment and grant access to that collection/index, or provision the index beforehand through the existing deployment process. TTL cleanup can lag; admission checks expiry directly. Unavailable stores fail closed. Business records are not used for quota storage. Other API limiters still have their existing process-local stores.

Memory cleanup checks touched records immediately, amortizes full expiry sweeps to once per second of request activity, and sweeps early when capacity is full. Storage remains bounded to 10,000 records and has no background session timers. Expired records are reclaimed on activity, not by a running idle cleanup job.

Restart Node after changing these settings. The frontend preserves rejected/pending drafts, including a second draft typed while waiting, within existing account-scoped session storage. It shows a countdown by the composer, removes expired rate notices, and permits manual retry; it never automatically resubmits. Navigation aborts the browser request and ignores late callbacks while the backend retains started work until it settles. The former 800 ms minimum response-display delay was removed. The limits remain starting defaults, not measured hosted capacity; lowering them to the suggested 12/minute and 60/15 minutes is optional and stricter. Local fake-clock tests and a transactional Mongo adapter fixture passed; no live multi-host Mongo or Azure scaling test was performed.

## Owner-configured late-return fees

Owners can set a percentage of the booking-time hourly rental/selected-driver rates, or a fixed peso amount per overdue hour. When no fee value is configured, the effective fee is zero. Vehicle creation, model defaults, owner form defaults, and renter fee estimates follow that rule.

`LATE_RETURN_PENALTY_MULTIPLIER` is no longer read by application code and is not a required or recommended Azure setting. It has been removed from `.env.example`; existing real `.env` values were preserved. `BOOKING_OVERDUE_GRACE_MINUTES` remains an optional grace-period fallback and does not introduce a charge.

Existing booking policies, hourly-rate snapshots, and finalized fees remain authoritative. No records are migrated or rewritten. Existing stored vehicle fee values, including 25 percent, remain effective because the stored value cannot distinguish an owner choice from a former default.

## Azure configuration to complete

Set the production requirements above in App Service configuration using the real deployed URLs and private credentials. For the specified Azure Files mount, configure `STORAGE_ROOT=/mounts/rentifypro` and `STORAGE_DURABILITY_CONFIRMED=true` after verifying that the mount persists writes. Leave directory overrides empty to derive paths from the root, or keep overrides inside the mount with public/private separation. No mount path or Azure URL is hard-coded in application logic.

Keep both service autostart switches false for the existing Container Apps services. Configure the exact frontend origin(s), public backend URL, matching internal key, SMTP provider/sender, registered PayMongo webhook secret, and live payment key (or explicit staging mode). Keep `GEMINI_SENSITIVE_DATA_APPROVED=false` when sensitive KYC processing is not approved; this permits startup with manual review. Supply private random authentication/internal secrets that meet the existing production checks. Use the existing database migration process for required indexes with `MONGO_AUTO_INDEX=false`.

Earlier local environment checks found unresolved runtime, secret, database, URL, payment, and mounted-storage requirements. The exact remaining errors depend on the actual deployment settings; `GEMINI_SENSITIVE_DATA_APPROVED=false` is no longer a startup blocker. No fake production values were inserted. Run `npm run production:check` in the real Linux deployment environment once these settings are available; the POSIX mount path is evaluated by Linux's path rules.

The environment audit does not establish mounted-volume persistence, SMTP delivery, signed webhook delivery, provider quotas, or hosted workflow correctness. Those still need verification against the deployment.

## Validation commands

Run from `backend/` (use `npm.cmd` instead of `npm` if PowerShell blocks `npm.ps1`):

```powershell
npm.cmd test
npm.cmd audit --omit=dev
npm.cmd run db:check
npm.cmd run services:check
```

The `npm test` script selects `tests/*.test.js` so it runs the automated suite without discovering the standalone manual `test-email.js` diagnostic. Other existing package-file edits were preserved.

Automated backend tests passed on Node 24.19.0. During the earlier environment audit, `npm audit --omit=dev` reported zero vulnerabilities and live MongoDB and Face/Chatbot service checks passed with configured values hidden from output. Those earlier checks do not establish current hosted availability. The private OCR implementation has separate Python, Node, admin, and synthetic extraction checks described in its README.

Real `.env` files and backups remain ignored by Git; `.env.example` remains allowed. Private OCR dependencies are isolated in the new service environment; Node, Face Service, and Chatbot Service dependencies were not changed. No database migrations were applied. Late-return fallbacks use zero while preserving owner-configured fees and existing booking snapshots.
