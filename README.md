# RentifyPro Admin

This checkout contains the React/Vite admin panel and its Express API. The API uses the **same MongoDB database** as the main RentifyPro website, so customer, vehicle, booking, and verification records stay in sync. It also reads the website backend's upload folders for vehicle images and protected document previews.

## Requirements

- Node.js **20.19.0 or newer** and npm **10 or newer** (see the root `package.json`).
- A reachable MongoDB instance containing the main RentifyPro website's data. Use the same local database or hosted database URI as the website backend.
- Access to the main website's `backend` directory for uploads and optional email configuration. The website server itself does not have to be running for the admin panel to start.
- Working SMTP credentials to receive the six-digit sign-in code at the configured admin email. A secret passkey can be configured later, with email as backup.

## Install packages

From **this admin repository's root**, install the checked-in npm workspaces and lockfile:

```bash
npm ci
```

One root install covers both `frontend` and `backend`; no separate package install or global Vite/nodemon install is needed. If you deliberately change a dependency, use `npm install` from the root and commit the updated `package-lock.json`.

| Workspace | Packages installed by `npm ci` |
| --- | --- |
| Frontend | React, React DOM, React Router, Axios, Recharts, Socket.IO client, Lucide icons, React Hot Toast, and Poppins font files. Development tools include Vite, the React Vite plugin, Tailwind CSS, PostCSS, Autoprefixer, and ESLint. |
| Backend | Express, Mongoose, bcryptjs, JSON Web Tokens, dotenv, Nodemailer, Socket.IO, Multer, cookie parser, CORS, Helmet, HPP, and Express rate limiting. Nodemon is installed for local development. |
| Root | `concurrently` runs the frontend and backend together. |

The exact dependency versions are in `frontend/package.json`, `backend/package.json`, and `package-lock.json`.

## Configure the backend

1. Start MongoDB or obtain the website backend's working MongoDB URI.
2. Create the admin environment file from the tracked template:

   ```powershell
   Copy-Item backend/.env.example backend/.env
   ```

   On macOS/Linux, use `cp backend/.env.example backend/.env`.
3. Edit `backend/.env` with the values below. Keep this file private; it is gitignored.

| Setting | What to set |
| --- | --- |
| `MONGODB_URI` | The **same database URI** used by the main website backend. The website's `MONGO_URI` setting is also supported. |
| `MONGO_URI_DIRECT` | Optional standard Atlas URI from the website backend. When present, this is preferred over `MONGODB_URI` and `MONGO_URI`, matching the website's connection behavior. |
| `MONGO_DB_NAME` | The website's database name, normally `rentifypro`. Set this explicitly when the Atlas URI has no database path so the admin reads the application's records. |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | Connection timeout in milliseconds; defaults to `15000`. |
| `WEBSITE_BACKEND_DIR` | The absolute path to the main website's `backend` folder. Replace the example's machine-specific path. This provides upload previews and lets the admin API read missing email settings from the website's `.env`. Use forward slashes or escaped backslashes in a Windows path. |
| `STORAGE_ROOT` | Optional mount of the website's shared persistent storage, matching Charlie's backend configuration. Admin reads `uploads/vehicles` and `private_uploads/kyc` beneath this root. |
| `PUBLIC_UPLOAD_DIR` | Optional public uploads root; vehicle files are read from its `vehicles` subdirectory. Overrides the public directory beneath `STORAGE_ROOT`. |
| `KYC_UPLOAD_DIR` | Optional mounted private KYC directory. Overrides the private directory beneath `STORAGE_ROOT`. Keep this storage private and accessible only to authorized backend services. |
| `WEBSITE_PUBLIC_URL` | Optional deployed website base URL for published vehicle media. Admin redirects vehicle image requests to its existing `/uploads/vehicles/` endpoint. This setting is never used for private documents. |
| `PORT` | `5001` for the included Vite proxy. If changed, also change the proxy target in `frontend/vite.config.js`. |
| `CLIENT_ORIGIN` | `http://localhost:5174` for the included Vite configuration. Set the actual frontend origin when hosting elsewhere. |
| `ADMIN_NAME`, `ADMIN_EMAIL` | Initial Super Admin display name and an email address you can receive codes at. The accepted email domains are Gmail, Yahoo, Outlook, and Hotmail. |
| `ADMIN_PASSWORD` | Initial admin password for local development: 8 to 128 characters with uppercase, lowercase, a digit, and a special character, without spaces or emoji. In production, configure `ADMIN_PASSWORD_HASH` with a bcrypt hash instead. |
| `JWT_SECRET` | A long, random secret used to sign admin sessions. Keep it private and stable across restarts. |
| `SMTP_USER`, `SMTP_PASS` | Working SMTP credentials for admin sign-in codes and password recovery. By default the backend connects to Gmail SMTP; set `SMTP_HOST`, `SMTP_PORT`, and `SMTP_SECURE` if using another provider. The sender can be set with `EMAIL_FROM` and `EMAIL_FROM_NAME`. |
| `ADMIN_SECRET_KEY` | Optional secret passkey for the second sign-in step. Leave empty to start with email codes; it can be configured later on **Governance > Security**. If set through credential sync, it must be 12 to 128 characters, meet the password character rules, and differ from the admin password. |
| `ADMIN_PASSWORD_RESET_DEV_MODE` | Optional local password recovery aid. Use `true` only for local development; set `false` in production. |

The admin backend loads `backend/.env` first, then the website backend's `.env` for variables that were **not already defined**. To reuse the website's `SMTP_USER` and `SMTP_PASS`, remove or comment out the empty `SMTP_USER=` and `SMTP_PASS=` lines copied from the template. Alternatively, fill them in the admin file. Email codes are required for the first sign-in when no passkey is configured, so verify SMTP before trying to log in.

## Run locally

From the admin repository root:

```bash
npm run dev
```

This starts Vite at `http://localhost:5174` and the admin API at `http://localhost:5001`. Open `http://localhost:5174`, sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`, and enter the email code. Vite forwards `/api` requests to the backend, so `VITE_API_URL` is not needed for the default local setup. The API health endpoint is `http://localhost:5001/api/health`; its `database` field should say `connected` once MongoDB is available.

Run only one side when needed with `npm run dev:frontend` or `npm run dev:backend`. If Vite moves to another port because 5174 is busy, use the URL it prints and update `CLIENT_ORIGIN` to match that origin if needed.

## Useful commands

Run these from the repository root:

```bash
npm run build                       # Build frontend/dist
npm run lint                        # Lint the frontend
npm run test --workspace backend    # Run backend tests
npm run start                       # Start only the backend without nodemon
npm run admin:sync-credentials -- --check
```

The credential check compares the configured values with the stored system-admin account without printing credentials. To deliberately apply changed credentials, run `npm run admin:sync-credentials`. This updates the single system-admin account and invalidates earlier sessions when authentication changes. An empty `ADMIN_SECRET_KEY` preserves a passkey configured through the Security page.

## Admin data

The dashboard reads `users`, `vehicles`, `bookings`, and `prekycdocuments` from the shared database. Customer changes, account restrictions, privacy-preserving archives, and document decisions are written back to that same database. Archiving anonymizes personal data while preserving linked booking history.

### Uploaded file previews

The inspected Charlie remote commit `8018210eb7ad1fd70f23902c5be62786c9c10b64` stores upload keys and metadata in MongoDB, with actual image/document bytes on filesystem storage. KYC uploads arrive as Base64, are decoded, and are written to private files. That implementation does not use GridFS or persist uploaded Base64 content. A deployed version with different storage needs its own verified retrieval contract.

Admin keeps retrieval behind its existing session-protected endpoints:

- `GET /api/admin/vehicles/:id/image?index=N` reads an ordered, deduplicated gallery from `vehicles.imageUrl` and `vehicles.images`. Omitting `index` retrieves the cover. Published vehicle URLs can use the configured website origin.
- `GET /api/admin/documents/:id/file` reads `prekycdocuments.fileKey` from private storage. JPG/JPEG, PNG, WEBP, and PDF previews use authenticated requests with temporary browser object URLs that are revoked when the preview changes or closes. Private responses use `Cache-Control: private, no-store`.
- `GET /api/admin/data` supplies booking details independently of files. Customer verification attachments prefer the user ID in authenticated KYC/reverification sessions, with the existing email relationship for pre-registration documents.

All teammates must use the same application database and have access to the same stored bytes. Pulling the Admin branch alone does not copy uploads. Use a shared persistent storage mount for private documents; published vehicle media may instead use `WEBSITE_PUBLIC_URL`. Do not copy sensitive uploads into the repository or publish private KYC files. The website's private review endpoint uses a separate website admin session, so remote-only private access needs an agreed authenticated integration with Charlie.

Missing files and records with no `fileKey` cannot be reconstructed from MongoDB metadata. Legacy path-only records need a separately reviewed recovery plan. These changes do not migrate files, run cleanup jobs, or change retention.

## Admin authentication and recovery

The first startup creates the single system-admin credential in MongoDB using the values in `backend/.env`. Passwords are stored only as bcrypt hashes. After the password, login requires either a six-digit email code or a configured secret passkey before the server creates a session. Password recovery uses a separate six-digit code with a five-minute expiry, a maximum-attempt limit, and a short-lived reset token. Completing a reset invalidates existing admin sessions.

The backend first tries SMTP using its own settings or the main website backend's email settings. Admin sign-in MFA codes are delivered only by email and are never returned to the browser. `ADMIN_PASSWORD_RESET_DEV_MODE=true` permits an on-screen password-reset code only for non-production requests originating from the local machine; disable it in production.

Sensitive customer changes require the current Super Admin password. Disable/enable and archive actions also require a written reason. Security events and management decisions are available under **Governance > Audit Logs**. The frontend and backend import `shared/adminApiContract.js` and verify its version on each admin data response so incompatible checkouts fail clearly instead of silently drifting.

The **Governance > Security** page lists active admin sessions and allows the Super
Admin to revoke one session or every other session. The sign-in verification surface
is intentionally limited to the secret passkey and email backup.

The Security page can also configure a separate secret admin passkey. It is strength-
validated and stored only as a bcrypt hash. Once enabled, the secret passkey is the
default verification step after the account password; email codes are generated and
sent only when the admin chooses the email backup option.

Changing `ADMIN_PASSWORD` or `ADMIN_SECRET_KEY` after the first startup does not
automatically rotate stored secrets. Admin email and display name can refresh at
startup; use credential sync for intentional authentication changes so previous
sessions and pending verification attempts are invalidated. Run `npm run admin:sync-credentials`
from the repository root to validate those values, hash the secrets, update only the
single system-admin account, and invalidate prior sessions. Use
`npm run admin:sync-credentials -- --check` to compare the stored credential safely
without printing any configured value. If `ADMIN_SECRET_KEY` is empty, the command
preserves the passkey already configured through the Security page.

Customer profile changes require a reason and password, record before/after values in
the audit log, notify the user, and force email re-verification when the email changes.
Direct renter-to-owner role changes are blocked until the required owner document is
approved; customers should normally use the website's **Become a Vehicle Owner** flow.

The **Customers > Documents** page is the final decision point for queued KYC evidence.
It shows screening confidence, mismatch/tampering indicators, retry state, and notes.
A Gemini outage leaves the item available for manual review instead of rejecting it.

Do not commit `backend/.env`. Use a strong `JWT_SECRET`, and use `ADMIN_PASSWORD_HASH` instead of a plain-text password in production.
