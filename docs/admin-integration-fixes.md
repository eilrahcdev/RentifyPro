# Admin integration corrections

Implemented for the admin checkout on 2026-10-16. These changes preserve admin sessions, password confirmation, written rejection reasons, document comparison, current revisions, and independent selfie verification. They do not approve documents, promote customers, rewrite booking/payment data, or deploy services.

## Azure document retrieval

The website receives uploads at https://rentifypro-api.azurewebsites.net/. Its existing Azure Files share is separate from a developer's local upload folder. Admin can either read that same mounted share or fetch only database-referenced KYC originals through Azure Files over HTTPS. Remote retrieval verifies SHA-256 before writing a private, gitignored cache. Neither the Azure credential nor a signed storage URL is sent to the browser; previews retain the authenticated admin endpoint and no-store caching. The recovery job removes only unreferenced copies older than 72 hours from the default admin cache. It never prunes the Azure share or custom cache directories.

To configure or renew local access using an existing authorized Azure CLI login:

```powershell
npm run storage:connect-azure -- --app=rentifypro-api --resource-group=rentifypro-production-rg --days=30
```

This reads the existing mount, signs an HTTPS read-only share credential, and updates only the ignored local backend environment. It creates no cloud resources and does not change the running Azure app. Renew before the reported expiry and restart the admin backend. Use the mounted shared filesystem for production hosting when practical; do not copy developer credentials into source or frontend environment variables.

```powershell
npm run storage:check
npm run storage:check -- --fetch-remote
```

The first command checks records against the configured local storage/cache. The second can download and hash-check referenced originals into the private cache. Both leave MongoDB unchanged and print counts only. For an independently recovered private directory, `--recover-from=<absolute directory>` previews recovery; adding `--apply` copies only missing files with matching hashes and never overwrites an existing file.

At verification, both pending IDs were fetched and matched their stored hashes. Two older approved originals were unavailable through the configured Azure path, and the share had no snapshots. Their existing decisions were preserved. Recover those originals from another backup or use the application's replacement flow; missing supporting-document metadata must be traced through an actual owner submission rather than fabricated.

## Workflow corrections

- Document/customer matching prioritizes the immutable registered user and fails closed on conflicting session ownership. Customer email changes and archives use scoped evidence filters.
- Email verification no longer implies document approval or rental eligibility. The admin computes the same current-document/selfie eligibility conditions and displays each check separately.
- Owner promotion must use RentifyPro's Become a Vehicle Owner workflow. Phone edits use Philippine mobile normalization and uniqueness checks.
- Decisions and comparisons reject expired/stale/conflicting evidence. Approval reads and verifies the current original again.
- The document review now shows saved registration details and three visual inspection confirmations. The repeated OCR/manual field-entry form, issuing-country selector, and separate save-comparison action are removed from the frontend. Only the Super Admin password field remains for approval; Approve sends the inspection and decision directly without a typed reason or a second confirmation modal. Reject retains its confirmation and needs no inspection confirmations. Loading the visual review does not request OCR suggestions. The legacy comparison endpoint remains compatible.
- Approval requires the current administrator password. The backend automatically records "Document approved by the Super Admin." in the existing comparison, decision, and history entries. Rejection still requires a 10–500 character reason and the administrator password. Submission errors stay inline, passwords are cleared after each attempt and when the review closes, and repeated clicks cannot send parallel decisions. Close, Escape, and Reject are held while approval is being submitted. Current-upload checks, audit attribution, and independent selfie rules remain enforced.
- Visual reviews are explicitly recorded as human observations. They do not manufacture OCR values or confidence. Stored type conflicts, failed validity checks, alteration flags, incomplete registration, duplicate identifiers when available, and duplicate original files prevent visual approval. Supporting-document fingerprints use the server's saved identifiers only after the reviewer confirms that they match the original. If an ID has no fingerprint, the UI and audit record state that duplicate screening covers identical files only; different photos cannot be matched by ID number without identifier extraction. Keep reliable background OCR for that purpose.
- A document decision stores pending account/audit work atomically with its history. Repeating the same decision resumes that work instead of appending history or notices. A 202 response means the decision is saved and delivery/synchronization is pending. The admin recovery job retries every 30 seconds. Other failed critical audit writes enter a durable outbox.
- The main backend continues to own customer notification delivery. The overview exposes a pending-notification alert; keep its notification workers running.
- Extended rentals are included in active/overdue monitoring and filters. Grace periods, actual return, and terminal states are respected without modifying persisted fee calculations.
- Document queue stages distinguish ready review, processing/retry, replacement required, and expiry. Successful decisions refresh account and alert data.
- A **Pending Review** shortcut clears search and type filters and shows only documents awaiting a decision. The existing full list and other filters remain available.
- Document rejection offers five optional, editable presets: unreadable image, incomplete document, mismatched registration details, wrong type, and expiry. Nothing is selected automatically. The final reason still requires 10–500 characters and the administrator's password, and the existing decision history and notification delivery are retained.

## Registration and account visibility

Customers lists created accounts. Documents also lists uploads submitted before account creation, so the lists intentionally have different populations. Each upload now displays its name/email and one of three account labels, with an Account registration filter:

- **Registered customer** requires a valid immutable owner, a matching non-archived renter/owner account, and consistent session ownership.
- **Registration incomplete** identifies an upload without an immutable owner or matching customer. Approval retains this label until normal signup creates and links the account.
- **Account link needs review** covers ownership conflicts, missing/archived owners, and legacy email-only associations. An email match is display context, not permission to bind or activate an account.

Customer rows and profiles show the remaining email, ID, business-document, selfie, registration, or account-update requirement. Profiles distinguish document approval from overall eligibility and offer Review document only for the account's current pending files, matching the pinned session, revision, hash, and expiry. Review includes the applicant's email and registration label. After a decision, fresh server data determines whether the customer is active, still pending, suspended, or not registered. Password confirmation, visual inspection, rejection reasons, and independent selfie checks remain enforced.

This follow-up changes `adminDomain.service.js` for account classifications and remaining checks; `adminData.routes.js` for the response metadata and archived-account context; `AdminAccountPage.jsx` for the profile-to-review transition and refreshed decision feedback; `AdminUI.jsx` for review links, account notices, and bounded previews; and `CustomersView.jsx`/`DocumentsView.jsx` for labels, email display, requirements, and filtering. The two verification test files and browser/read-path scripts cover those behaviors. No main-checkout source changes were needed.

Read-only Azure inspection on 2026-10-16 confirmed that the deployed signup controller calls `finalizeRegistrationAccount` after email, document, and selfie checks. The deployed finalizer already links the account using session, role, file hash, and document revision and then reconciles its verification case. Those main-backend files were not changed or redeployed. An approved upload without an account and recoverable draft must complete normal signup; restart registration if progress cannot be recovered. No account is fabricated from an upload, and no legacy document is reassigned by email alone.

## Background identifier screening

The admin backend starts a separate, bounded identifier worker after connecting to MongoDB. It reads at most two current pending IDs per run, using only the configured private OCR provider. It stores the keyed identifier fingerprint, the masked final four characters, confidence, type evidence, and retry metadata. It does not store raw OCR text or an unmasked ID number, approve documents, compare selfies, or change registration details. Existing trusted fingerprints are reused.

OCR findings must have version 2 positions, the selected document type, at least 95% identifier confidence, and no ambiguous identifier reading. The existing document classification threshold remains in force. Reads verify the private original's SHA-256. Claims and result writes check the upload version, hash, session, ownership link, type, and expiry. Duplicate checks include current background findings as well as existing fingerprints. Approval uses an atomic comparison of the screening metadata so an intervening worker result cannot be silently ignored.

The review polls lightweight status without redownloading the original or rerunning OCR. A new masked identifier clears inspection confirmations so the admin can compare the final four characters. The approval request includes an opaque reading revision; if a new identifier arrives before submission, the backend requires a fresh inspection. An active claim briefly holds approval; uncertain/unavailable OCR does not become an automatic decision. Retries begin after one and two minutes, then back off to every 15 minutes. Abandoned claims recover after five minutes. Unavailable or uncertain identifiers leave the explicit visual-review path and its limited duplicate coverage visible.

Configuration uses the existing private service URL, internal key, and shared fingerprint secret. `ADMIN_IDENTIFIER_SCREENING_ENABLED=false` disables this worker. Manual/Gemini provider modes do not enable it or send documents to another provider. Keep secrets in the ignored backend environment.

The configured loopback OCR service was initially stopped. Its existing launcher and installed models were verified on 2026-10-16; a synthetic in-memory image passed through the real Node HTTP adapter and produced the expected masked identifier and fingerprint. No participant documents or database writes were used for that extraction check. This demonstrates integration, not accuracy on every real document or issuer authenticity. If the local service is stopped, use the existing main checkout launcher in a separate terminal:

```powershell
Set-Location 'C:\Users\charlie\rentifypro\backend'
npm.cmd run kyc:ocr:dev
```

Then start/restart the admin from its own root with `npm run dev`. Production needs the separately hosted private OCR service; the local launcher is for development only.

## Bounded reads and hosting

Overview requests return at most 250 rows per collection with related records fetched in bounded batches. The frontend assembles complete cohorts for the existing historical charts; list tables render 25 rows per page. It deliberately does not treat a partial overview as a complete dashboard. Transaction filtering, pagination, totals, and monthly groups run in MongoDB and return at most 101 transaction rows internally.

KYC and report evidence now share the same storage-root resolution rules. `/api/health` remains liveness; `/api/ready` returns 503 for unavailable database, private storage, or recovery processing. Monitor readiness separately from missing historical originals.

Prefer a same-origin frontend/API proxy. For an intentional HTTPS cross-site deployment, `ADMIN_COOKIE_SAME_SITE=none` requires production mode and exact `CLIENT_ORIGIN` values; authenticated mutation requests must carry an allowed Origin. Configure `TRUST_PROXY_HOPS` for the actual ingress, a strong JWT secret, and a bcrypt `ADMIN_PASSWORD_HASH`. Local defaults remain unchanged.

API contract 2.2.0 requires releasing matching frontend/backend sources, including all newly added runtime files. The CI workflow runs tests, lint, and build and does not deploy.

## Verification commands

```powershell
npm test
npm run lint
npm run build
node backend/scripts/checkTransactionQuery.js
node backend/scripts/checkAdminReadPaths.js
```

The last two commands use read-only live MongoDB access. The transaction check executes synthetic aggregation cases plus a bounded live sample without inserting fixtures. The read-path check uses an isolated, GET-only local server and a synthetic session adapter to verify bounded overview loading and private preview hashes; it is not proof of production browser login.

Verified on 2026-10-16:

- All 65 backend tests and 8 frontend tests passed; lint and the production frontend build passed.
- Transaction calculations matched the previous implementation for 80 synthetic aggregation cases and 58 live bookings. No booking or payment records were written.
- The latest isolated read-path check loaded six bounded overview pages, served the remaining pending original with its expected hash, and loaded its visual-review context and lightweight screening status without exposing fingerprints. Account labels reported one registered link, one incomplete registration, and two links requiring review. Customer requirement arrays were present, and active accounts had no pending requirements. Unsigned requests returned 401. Twenty synthetic MongoDB aggregation cases checked queue eligibility, stale claims, retry backoff, and duplicate bindings without inserting fixtures.
- Browser fixtures passed at 390, 768, and 1280 pixels, covering registration labels/filters, incomplete-registration guidance, remaining requirements, review from the correct customer profile, account status after approval, table pagination, the pending shortcut, editable rejection presets, approval without a second modal or reason field, the required inline password, password failures and retry, blocked repeated submission, background status updates, clearing inspection confirmations for a new identifier, missing-original approval blocking, the combined approval payload, modal focus, and page overflow. Route tests also checked rejection reason validation and automatic approval history entries. These were simulated documents; the examined database contained no supporting-document records.
- Twenty-eight existing main-checkout registration/account tests passed with mocked dependencies. Their incidental audit-file writes were blocked by the sandbox; live signup and deployed audit delivery were not exercised.
- All nine mirrored KYC assets still matched the main checkout. Existing unrelated changes were retained.
- The UI detector's gray-on-color report on the approval button is a variant false positive: enabled text is white on blue, and disabled text is slate on a slate background. The existing button variants were preserved.
- The local read credential expires at **2026-11-14 20:45:33 UTC (2026-11-15 04:45:33 Asia/Taipei)**. Renew and restart before then.

The implementation is local and has not been deployed. Start or restart the local frontend and backend with `npm run dev`. No real approval decision or production browser login was performed during verification.

## Changed files

Runtime and interface changes:

- `backend/config/adminSecurity.js`, `backend/config/storage.js`
- `backend/routes/adminData.routes.js`, `backend/routes/adminReports.routes.js`, `backend/server.js`
- `backend/services/adminAudit.service.js`, `backend/services/adminDomain.service.js`, `backend/services/adminIdentifierScreening.service.js`, `backend/services/adminRecovery.service.js`, `backend/services/adminTransactionQuery.service.js`, `backend/services/adminVisualReview.service.js`, `backend/services/kycFileRecovery.service.js`, `backend/services/privateKycReview.service.js`, `backend/services/remoteKycStorage.service.js`
- `frontend/AdminAccountPage.jsx`, `frontend/src/admin/adminDataApi.js`, `frontend/src/admin/overviewPages.js`, `frontend/src/admin/useTablePage.js`
- `frontend/src/admin/components/AdminUI.jsx`, `frontend/src/admin/components/ManualDocumentComparison.jsx`, `frontend/src/admin/components/PasswordInput.jsx`, `frontend/src/admin/pages/BookingsView.jsx`, `frontend/src/admin/pages/CustomersView.jsx`, `frontend/src/admin/pages/DashboardView.jsx`, `frontend/src/admin/pages/DocumentsView.jsx`, `frontend/src/admin/pages/ReportsView.jsx`
- `shared/adminApiContract.js`

Checks, configuration, and documentation:

- `backend/scripts/checkAdminReadPaths.js`, `backend/scripts/checkStorage.js`, `backend/scripts/checkTransactionQuery.js`, `backend/scripts/connectAzureKyc.js`, `scripts/admin-integration-browser-check.mjs`
- `backend/tests/accountVerification.test.js`, `backend/tests/adminDomain.test.js`, `backend/tests/adminIdentifierScreening.test.js`, `backend/tests/adminRecovery.test.js`, `backend/tests/adminSecurityConfiguration.test.js`, `backend/tests/adminTransactionAnalytics.test.js`, `backend/tests/adminVisualReview.test.js`, `backend/tests/kycFileRecovery.test.js`, `backend/tests/privateKyc.test.js`, `backend/tests/remoteKycStorage.test.js`, `backend/tests/verificationNotification.test.js`, `frontend/tests/overviewPages.test.js`
- `.github/workflows/admin-checks.yml`, `backend/.env.example`, `package.json`, `backend/package.json`, `frontend/package.json`, `README.md`, this runbook
- The ignored `backend/.env` contains the local private-storage connection. It must remain outside version control.
