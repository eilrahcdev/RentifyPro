# Mobile sign-in and verification notices

This change keeps the current Netlify website and Azure API addresses. On Netlify, the browser calls its own origin for API and Socket.IO requests. The edge function forwards the existing HttpOnly cookies to Azure and returns host-only cookies to the website. No JWT is stored in browser storage.

## Release configuration

1. Create one random secret of at least 32 characters, preferably 32 random bytes encoded as hex. Set the same `NETLIFY_PROXY_SECRET` value in Azure App Service application settings and Netlify environment variables. On Netlify it must be available to Edge Functions at runtime, through the Functions scope. Never prefix it with `VITE_`, put it in source control, or include it in browser bundles.
2. Deploy the backend first. Its signed-IP middleware verifies the edge signature before the existing API rate limiters. Direct requests retain the existing authentication, IP handling, CORS and rate limits. Keep `NODE_ENV=production`, HTTPS, and the existing frontend origin allowlist. Do not increase `TRUST_PROXY_HOPS` for this change.
3. Deploy the frontend using the root `netlify.toml`. The build base is `frontend`, the publish directory is `dist`, and the edge function is `frontend/netlify/edge-functions/backend.js`. `VITE_SAME_ORIGIN_PROXY=true` takes precedence over the old API/socket URLs in the application. Do not override it to false in Netlify settings. Local development keeps its existing direct backend URLs.
4. Confirm that Edge Functions are enabled and Netlify split testing is off. Confirm the function is present in the deploy summary. Missing secrets fail closed with a temporary-unavailable response.

## Behavior to verify after release

- On the affected iPhone and an Android browser, log in as an approved renter and owner. `/api/auth/login` and `/api/auth/me` must use the website origin. The latter must return the same user before navigation. Refresh, navigate to a protected page, and sign out; no repeated sign-in should be required.
- An email-verified account awaiting document review can sign in and browse. Booking, listing and confirmation restrictions remain enforced by the backend. Email-unverified, disabled and archived accounts remain restricted.
- Pending and correction notices link to the existing verification section. Approval removes the pending notice after status refresh; a status outage shows an unavailable message. Check notification delivery and reconnect after backgrounding the phone.
- Netlify uses authenticated Socket.IO HTTP polling because WebSocket proxy upgrades are not provided by this implementation. Direct deployments keep WebSockets. The 20-second heartbeat keeps polling responses bounded. If Azure is scaled to multiple instances, preserve working session affinity for Engine.IO polling and check both handshake and subsequent polls reach the same instance.
- Exercise a slow ID/selfie check. Selected verification POST routes return a streamed JSON envelope with whitespace heartbeats so Netlify's response-header deadline does not interrupt face-service startup. Both KYC clients restore the original status, body and retry headers before handling success/errors. Cookie-changing routes never use this envelope.
- Verify separate client devices retain separate rate-limit budgets. Only IP information signed by the shared secret is trusted; arbitrary forwarded IP headers are not trusted by the new middleware.

API, verification and polling responses are not cached. Public vehicle/avatar proxy routes preserve the backend's existing media cache headers. Existing approval/rejection notices and email-delivery preferences are reused. There is no database migration.

The implementation does not publish itself. Source tests and local browser fixtures do not prove the Netlify runtime, Azure settings, real email delivery, multi-instance affinity or physical-device behavior. Roll back the frontend deploy first if the proxy is unavailable; existing direct-backend clients remain compatible.

References: [Netlify Edge limits](https://docs.netlify.com/build/edge-functions/limits/), [Edge environment variables](https://docs.netlify.com/build/edge-functions/environment-variables/), [Socket.IO behind a proxy](https://socket.io/docs/v4/reverse-proxy/).

## Local verification

- 40 focused backend tests passed for authentication errors, session security, verification access, notifications, rate limits, KYC routes and signed proxy metadata.
- 24 frontend/configuration/proxy tests passed, including a real local authenticated Socket.IO polling connection and notification.
- The new browser script passed 11 checks against the production build with synthetic responses, including pending/approved renter and owner login, refresh, sign-out, unavailable status, approval updates, and 320/390/768/1440-pixel layouts. No runtime exceptions were reported.
- The existing booking sign-in return check and 9 existing verification recovery checks passed with synthetic responses.
- Frontend lint, production build, JavaScript syntax, TOML function paths and Git whitespace checks passed.
- The older `scripts/session-browser-check.mjs` stops at its assertion that a fast restored session must show no skeleton. Both committed and current `App.jsx` enforce `SESSION_SKELETON_MIN_MS = 1000`; the committed `SessionSkeleton.jsx` renders immediately. That existing behavior and the old assertion were left unchanged. The new browser checks separately verify refresh and sign-out behavior.

## Changed files

| File | Purpose |
| --- | --- |
| `netlify.toml` | Build with first-party API/socket routing and declare the edge routes. |
| `frontend/netlify/edge-functions/backend.js` | Forward cookies to the fixed Azure API, sign client IPs, disable private caching, and stream slow verification responses. |
| `backend/middleware/proxyClient.middleware.js` | Validate signed IP metadata before the existing rate limiters. |
| `backend/server.js` | Mount that middleware before API request budgets. |
| `backend/middleware/auth.middleware.js` | Prevent caching authenticated responses and session failures. |
| `backend/routes/auth.routes.js` | Prevent caching login and other authentication responses. |
| `backend/socket/index.js` | Keep polling heartbeats bounded and responses uncached. |
| `frontend/src/utils/runtimeConfig.js` | Use the website origin in proxy builds while preserving direct and quick-tunnel modes. |
| `frontend/src/utils/socket.js` | Select polling for the edge proxy and retain WebSockets elsewhere. |
| `frontend/public/_redirects` | Preserve public vehicle/avatar media when the API origin becomes the website origin. |
| `frontend/.env.example` | Document the optional proxy flag without changing local secrets. |
| `frontend/src/utils/confirmSignIn.js` | Require a matching, active, email-verified cookie session before entering the app. |
| `frontend/src/components/SignInPage.jsx` | Use the confirmed profile and display session failures without a redirect loop. |
| `frontend/src/utils/readApiResponse.js` | Restore original status/body/retry headers for streamed responses. |
| `frontend/src/utils/api.js` | Decode streamed responses and fetch fresh profile/verification status with abort support. |
| `frontend/src/utils/kycApi.js` | Preserve registration verification error handling through the proxy. |
| `frontend/src/components/AccountVerificationNotice.jsx` | Share fresh verification state and render persistent notices, retry controls and status links. |
| `frontend/src/utils/verificationStatus.js` | Distinguish automated screening from manual review. |
| `frontend/src/App.jsx` | Provide signed-in verification state and retain verification anchors during navigation. |
| `frontend/src/components/Navbar.jsx` | Show renter notices and an account-menu status link. |
| `frontend/src/owner/OwnerLayout.jsx` | Show owner notices and open the existing Profile verification section. |
| `frontend/src/owner/components/Topbar.jsx` | Make owner verification status visible and actionable. |
| `backend/tests/proxyClient.test.js` | Reject forged, expired and altered proxy signatures. |
| `frontend/tests/signInSession.test.mjs` | Cover confirmed, missing, mismatched, restricted and rate-limited sessions. |
| `frontend/tests/runtimeConfig.test.mjs` | Verify proxy/direct/tunnel origins and transports. |
| `frontend/tests/sameOriginProxy.test.mjs` | Cover cookie forwarding, signed IPs, streaming and preserved error statuses. |
| `frontend/tests/proxySocket.test.mjs` | Exercise real local protected requests and authenticated Socket.IO polling through the proxy. |
| `frontend/tests/verificationStatus.test.mjs` | Cover the separate screening/review guidance alongside existing status cases. |
| `scripts/mobile-signin-browser-check.mjs` | Exercise sign-in, notices, status links, outages, approval updates and responsive layout with browser fixtures. |
| `docs/mobile-signin-release.md` | Record release configuration, verification boundaries and this file manifest. |
