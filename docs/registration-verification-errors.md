# Registration verification error handling

## Follow-up: false ID-changed result after backend restart

The 12:26/12:28 screenshots show a separate issue from the earlier missing credential. The pre-registration selfie handler loaded `profileSnapshot` for the initial ID-readiness check, but omitted it when re-reading the current ID after the face-service response. The schema deliberately hides that private field from ordinary queries. Private OCR readiness recomputes a keyed binding from that snapshot; without it, an unchanged valid ID failed the final check and returned `Your ID changed while the selfie was being checked`.

The fix explicitly selects `+profileSnapshot` on that internal recheck. It preserves the existing email, session, role, file hash, document revision, expiry, readiness, and atomic-write guards. The snapshot remains hidden by default and is never added to the response. Real document replacement during matching still fails closed.

The ID was available to the request: the handler reads and integrity-checks its private bytes before calling either face endpoint. The empty upload preview represented the browser losing its local `File` selection during recovery, while the saved backend reference remained valid. A recovered saved ID now shows **Replace ID** in both roles' upload controls, alongside the existing private-save indicator. Its native file-picker handler is unchanged. This does not restore a browser `File`, expose a private thumbnail, or require reuploading a valid saved ID.

Earlier tests missed the backend bug because their query mock always returned `profileSnapshot`. The strengthened test now executes the real Mongoose query and intercepts only the collection operation, honoring its actual projection. It failed before the query fix and passes afterward for renters and owners. Existing mismatch/rejection checks and the document-replacement-during-match regression remain intact. The browser regression also failed before the saved-ID label correction and passes afterward.

Files changed in this follow-up:

| File | Purpose |
| --- | --- |
| `backend/controllers/kyc.controller.js` | Load the private snapshot needed by the final ID-readiness recheck; one query change. |
| `backend/tests/privateKyc.test.js` | Honor real Mongoose projections, cover both roles, and assert that the successful response contains no private fields. |
| `frontend/src/components/RegisterPage.jsx` | Distinguish a recovered saved ID from an empty upload with the Replace ID action. |
| `frontend/src/pages/RegisterOwnerPage.jsx` | Use the same saved-ID action for owners. |
| `scripts/registration-recovery-browser-check.mjs` | Verify the recovered saved-ID state after refresh on mobile/desktop for both roles, retaining all prior error scenarios. |
| `docs/registration-verification-errors.md` | Record this later cause, correction, and evidence without discarding the earlier investigation. |

Current follow-up validation: **87 focused regressions and 24 browser scenarios passed**, along with focused ESLint, the production build, Node syntax checks, and scoped diff review. The browser report's `errors` array is empty. Tests use synthetic documents/mail/face-service results and a fake camera; the collection stub honors Mongoose projections but does not contact a live database. No real ID or selfie was sent to a provider during this follow-up. Hosted credential validation remains with the user as requested. No `.env`, schema, migration, storage, dependency, deployment, or unrelated files were changed in this follow-up.

## Earlier confirmed causes

The local audit log at 11:48:46 and 11:49:31 on October 15 records the same failure for ID upload and selfie submission: the Node backend had no `INTERNAL_API_KEY` for its face-service requests. Document screening is a separate worker. It can pass an already stored ID even when preparation of its biometric template fails. Document readiness is not a completed selfie match or final admin approval.

The frontend then compounded that failure:

- ID error handling displayed an error and started recovery without waiting. Recovery and status polling restored the saved ID, but did not clear the old error. That produced the simultaneous green success and red failure messages in the screenshot.
- Every recovery unconditionally emptied `selfieDataUrl` and `selfieBase64Clean`, even when the current ID was unchanged. A recoverable service failure therefore removed the captured photo.
- The handler decided the visible result before the recovery request had checked the actual backend result. An interrupted success response could briefly be presented as failed verification.

## Scoped changes

| File | Purpose |
| --- | --- |
| `backend/.env` (ignored local file) | Add the missing shared credential using the existing face-service configuration, without printing it or changing any other setting. Hosted acceptance remains unverified pending approval. |
| `frontend/src/hooks/useRegistrationDraft.js` | Return the backend-validated recovery result to the caller; retain all existing ownership, expiry, revision, and failure behavior. |
| `frontend/src/components/RegisterPage.jsx` | Await recovery before deciding the error, clear obsolete ID errors after confirmed results, retain the in-memory photo for the same ID version, and invalidate it when the ID changes. Clear previous errors during a retry. |
| `frontend/src/pages/RegisterOwnerPage.jsx` | Apply the same correction to the owner flow without changing business-document requirements. |
| `scripts/registration-recovery-browser-check.mjs` | Add isolated verification-error scenarios for both roles at 390 and 1200 pixels. Keep the original recovery assertions intact. |
| `docs/registration-verification-errors.md` | Record causes, changes, evidence, and the pending hosted check. |

Recovery is attempted after a possibly completed upload, rather than after local image validation or a failed prerequisite save. A selfie rejection remains a rejection. A failed or unavailable recovery does not manufacture a successful match. Session or document-version conflicts are rechecked against the backend. The captured image and its ID-version association remain only in React memory, and a browser refresh still requires a fresh capture unless a valid backend match was already saved.

The five-step wizard, current layout, shared `SelfieCapture`, email OTP, manual document approval, role restrictions, booking eligibility, password policy, private storage, and backend verification gates were preserved. No backend source, dependency, database, deployment, or separate-admin files were changed. Existing unrelated worktree edits were preserved; nothing was committed, pushed, or deployed.

## Validation

The new regression first failed with `A recovered successful ID must not retain an upload failure`, reproducing the reported contradiction. After the correction:

- 20 new browser scenarios passed, covering saved-ID recovery without duplicate upload, unavailable face service with the exact photo retained, genuine mismatch remaining unverified, retry and a dropped successful response, refresh after a completed match, and invalidation after ID replacement. Both roles were checked on mobile and desktop with no horizontal overflow.
- 81 focused backend/draft/OTP/private-KYC/camera tests passed. They include ownership, expiry, document-version binding, direct API bypass rejection, pending document review, and duplicate account protection.
- Focused ESLint passed for all three modified frontend source files.
- Production Vite build passed.
- All 90 existing recovery browser checks passed, including wizard-step and verification-phase refresh, interrupted uploads and selfie responses, expired drafts, stale tabs, Back/Forward navigation, OTP recovery, and duplicate account creation. Both browser reports contain an empty `errors` array.

Browser APIs, document screening, mail, and biometric results in these tests are synthetic fixtures; camera capture uses Chrome's fake media device. They do not prove a real person's identity, liveness, live provider acceptance, or physical-device camera behavior.

```powershell
node --experimental-websocket scripts/registration-recovery-browser-check.mjs --verification-errors-only
node --experimental-websocket scripts/registration-recovery-browser-check.mjs
node --test backend/tests/registrationDraft.test.js backend/tests/registrationOtp.test.js backend/tests/privateKyc.test.js frontend/tests/cameraKyc.test.mjs scripts/registration-draft.test.mjs
# From frontend:
npx.cmd eslint src/components/RegisterPage.jsx src/pages/RegisterOwnerPage.jsx src/hooks/useRegistrationDraft.js
npm.cmd run build
```

The new browser report is `%TEMP%\rentifypro-registration-recovery-browser-verification-errors.json`. Existing full recovery results are in `%TEMP%\rentifypro-registration-recovery-browser.json`. Test services use isolated ports 4176 and 9236.

## Hosted verification and configuration

The configured face endpoint is the existing Azure Container Apps service. Its public `/health` endpoint returned HTTP 200 in a live read-only check with no credentials or documents sent. That proves reachability, not authenticated verification. No hosted application settings or data were changed. Only presence/equality checks were printed for local secrets; no secret values or user documents were printed or transmitted.

Automatic approval review rejected a diagnostic that would send the existing `INTERNAL_API_KEY` to the configured hosted face-service endpoint with an invalid, non-personal image string. Its stated reason was that the user had not explicitly authorized transmitting the credential to that destination. The diagnostic was not executed and was not retried through another mechanism. Hosted credential acceptance therefore remains unverified. Approval for that specific check, or manual validation by the user, is required before claiming the live integration works.

The existing local face credential was reused without rotating other services. It is below the existing production minimum of 32 characters; production validation remains unchanged. Deployment credentials were not accessed or changed. The running development backend needs a restart to read the local configuration, after the hosted credential has been confirmed. No user-owned development services were stopped or restarted by this task.

## UI delivery gate

PASS for the scoped verification repairs. Direction remains the existing operational interface, ENERGY 1 / RHYTHM 1 / MOTION 1. The follow-up changes only the saved-ID button text within the incumbent controls; CSS, typography, imagery, layout, and navigation structure remain unchanged. The gate concerns the changed states and labels; it does not certify the whole site or live hosted verification.

| Item | Result and evidence |
| --- | --- |
| R-02 | PASS: the only new customer-facing copy is Replace ID, with no em dash or invented claim. |
| R-03 | PASS: both roles' error and recovery views fit 390 and 1200 pixels without horizontal overflow. |
| R-17 | PASS: no statistics added. |
| R-18 | PASS: no testimonials added. |
| R-23 | PASS: no assets or navigation architecture created. |
| R-24 | PASS: existing routes and links retained. |
| R-25 | PASS: existing error, success, text, and focus colors retained; no CSS or markup changed. |
| R-26 | PASS: existing upload, camera, capture, Back to ID, and retry paths retained; Replace ID reuses the existing native file-picker handler, and its recovered state is asserted in the browser checks. |
| R-27 | PASS: real mismatch remains blocked; unavailable and interrupted requests are distinguished from confirmed backend success. |
| R-28 | PASS: no FAQ added. |
| R-32 | PASS: existing native controls, focus semantics, and shared camera implementation retained. No keyboard behavior changed. |
| R-33 | PASS: logic changes are in source; synthetic interception exists only in the test harness. |
| R-34 | PASS: no theme behavior changed. |
| R-35 | PASS: this follow-up passed 24 browser scenarios, 87 regressions, lint, syntax checks, and production build. The earlier 90-check recovery run is recorded above; it was not rerun for this one-query and button-label correction. |
| R-36 | PASS: no new security or verification claims; hosted acceptance is explicitly unverified. |
| R-37 | PASS: incumbent layout and operational dials preserved; this is an error-state repair. |
| R-38 | PASS: fixture data is identified as synthetic; no fabricated production content added. |
| R-01 | PASS: no gradients or glows added. |
| R-04 | PASS: no icons changed. |
| R-06 | PASS: existing typography retained. |
| R-07 | PASS: no background patterns added. |
| R-08 | PASS: no arrows added. |
| R-09 | PASS: no badges added. |
| R-10 | PASS: no glass effects added. |
| R-12 | PASS: existing elevation unchanged. |
| R-13 | PASS: no glow effects added. |
| R-14 | PASS: existing document/camera composition retained. |
| R-19 | PASS: existing request loading behavior retained; no new motion. |
| R-22 | PASS: no illustrations added. |
| Dials | PASS: ENERGY 1 / RHYTHM 1 / MOTION 1 unchanged. |
| Focal point | PASS: the existing active verification task remains primary. |
| Whitespace | PASS: incumbent registration spacing unchanged. |
| Accent | PASS: incumbent blue action/focus accent unchanged. |
| Identity | PASS: existing RentifyPro controls and imagery retained. |
| Design Read | PASS: preserve current layout; reconcile error state against actual results; retain retryable captures in memory. |
| C-1 | PASS: every change addresses the reproduced contradiction, discarded capture, or confirmed missing configuration. |
| C-2 | PASS: captured photos can retry; a confirmed match is restored without another biometric check in the dropped-response scenario. |
| C-3 | PASS: no new sections or filler added to the UI. |
| C-4 | PASS: genuine failures stay unverified; replacement invalidates the prior capture; service failures retain it only for the same ID. |
| C-5 | PASS: no fabricated verification success; results require the backend response or validated recovery. |
| R-05 | PASS: the existing five-step form composition retained. |
| R-11 | PASS: existing radii unchanged. |
| R-15 | PASS: existing task-specific action labels retained. |
| R-16 | PASS: no new marketing copy. |
| R-20 | PASS: existing product identity retained. |
| R-21 | PASS: existing theme unchanged. |
| R-29 | PASS: existing palette unchanged. |
| R-30 | PASS: no other design system introduced. |
| R-31 | PASS: all state changes have a recorded failure and purpose above. |
