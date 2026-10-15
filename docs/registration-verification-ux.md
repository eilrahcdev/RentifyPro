# Registration and verification UX validation

Work completed locally on 2026-10-15. The user confirmed that RentifyPro should retain **five steps**, with Email Verification, ID/Business Documents, and Face Recognition inside Step 4. No sixth step or separate post-registration OTP page was added.

This phase builds on [registration persistence](registration-persistence.md), [email verification](registration-email-workflow.md), and [account/document approval](account-verification-workflow.md). Both the main backend and the separate Super Admin checkout were inspected before implementation. Existing unrelated worktree edits were preserved.

## Audit findings and fixes

| Finding | Result |
| --- | --- |
| Both admin backends saved document decisions, but neither produced a document-decision notification. | Each new decision now atomically records a notification marker in its version-bound audit entry. A recovery worker uses the existing in-app notification service and email delivery queue. |
| The booking screen could give a cached `User.kycStatus` precedence over a fresh eligibility response, and send document restrictions to booking history. | Fresh backend verification takes precedence. Pending/rejected users get the correct next action and a link to their role's Verification Status section. Existing debt/schedule guidance is retained. |
| The status panel had independent data but lacked clear next actions, a saved-document indicator, and automatic refresh. | Added role-appropriate guidance, private saved-document indicators, visible stale-data feedback, and refresh on focus, reconnection, document notifications, and visible-page polling. Older responses cannot overwrite newer status requests. |
| Successful signup redirected after 1.2 or 1.5 seconds, leaving little time to understand pending approval. | Registration Complete now remains visible with a separate Verification Pending/Complete message and an explicit Sign in action. The submitted form is hidden and disabled. |
| The mobile action bar used a portal and remained visible when its form was hidden after completion. | Completed registrations now unmount those actions and focus Sign in. The browser regression checks that no Create Account control remains. |
| The expired-session browser test reproduced an empty protected page after authentication was cleared. | Protected pages now switch to Sign In when the session is cleared. Returning with a valid session restores the saved backend evidence. Authentication enforcement remains intact. |
| Rapid entry of recovered owner passwords could overwrite a preceding field and send submission back to Step 1. | A focused browser regression reproduced the loss. Renter/owner field updates now merge against the latest state; rapid entry and duplicate submission are checked together. |
| Email HTML escaped text before applying the character limit, which could truncate a valid rejection reason containing many HTML-sensitive characters. | Limit the raw text before escaping. Full permitted rejection reasons remain readable, without rendering supplied HTML. Relative action links resolve only to the configured HTTPS frontend origin. |

The new decision-notification regression initially failed because the saved audit entry had no recoverable notification marker. It passed after the marker was added. Browser tests then exposed and verified the expired-session fix.

## Behavior and delivery

- Verification Status shows account access, email, selfie, ID, applicable business documents, booking access, and owner listing access. Pending review, corrections, interrupted ID setup, missing documents, and completed verification have distinct instructions.
- Document references are backend references. A refresh does not manufacture an approval or require another upload of already saved evidence. The registration phase rail says Documents saved rather than presenting a pending document as fully approved.
- Rejection notices include the recorded reason and the appropriate Replace ID or Replace business document action. Business corrections preserve unaffected ID/selfie checks; ID replacements require a new selfie. The notification link opens the correct account section for the current role.
- Notification processing runs at startup and every 30 seconds, in batches of up to 25 documents. It is independent of whether email delivery is enabled. New decisions from either admin backend use the same queue.
- A notice is associated with the linked account or authenticated evidence session, exact document revision/hash, action, and decision time. Unlinked registration decisions wait until account linkage. Old decisions remain in the audit history but are skipped if the document/session has since been replaced.
- Existing unique notification and delivery keys prevent duplicate in-app records and duplicate email queue rows. If notification creation, email queueing, or acknowledgement fails, the saved decision can be retried without changing the admin decision or account progress.
- Email respects `NOTIFICATION_EMAIL_ENABLED`, configured SMTP, and the user's existing email preference. Disabled email leaves the notice in-app; enabling it later does not backfill already completed in-app-only notices. No configuration or secrets were changed.
- Account access and booking approval remain separate. The new completion notice explains that an email-verified account exists while booking and restricted listing actions may still require approval. The backend booking and listing gates from the preceding phase remain authoritative.
- Session expiration changes the authentication view without deleting registration drafts, linked documents, approvals, or valid selfie proof. Offline or malformed status responses retain the last checked values and label them as stale.

## Privacy and preservation

Private upload storage, authenticated admin preview routes, KYC `private, no-store` response headers, signed draft ownership, OTP expiration/cooldowns/attempt limits, password-in-memory rules, version checks, and temporary-upload cleanup remain in place. Notifications contain the decision and correction instructions; they contain no file paths, private file keys, attachments, passwords, OTPs, face scores, or raw document contents.

The existing cleanup regressions cover active evidence retention, expired draft/file cleanup, duplicate upload cleanup, and failed writes. Linked account files remain protected from pre-registration expiry. No production records, storage objects, indexes, or destructive migrations were changed. No new package, visual asset, global style, or unrelated flow was introduced.

## Intentionally modified files

Paths are relative to the main checkout unless specified otherwise.

| File | Purpose |
| --- | --- |
| `backend/models/PreKycDocument.js` | Add optional notification state and evidence-session binding to individual audit entries. |
| `backend/services/kycReview.service.js` | Save the notification marker atomically with the admin decision. |
| `backend/jobs/verificationNotification.job.js` | Recover pending decision notices with ownership, session/version checks, deduplication, and email queue acknowledgement. |
| `backend/services/notification.service.js` | Reuse the existing email queue operation and expose its acknowledgement for reliable retry. |
| `backend/utils/sendEmail.js` | Preserve full escaped reasons and safely resolve relative frontend action links. |
| `backend/server.js` | Start and stop the decision-notification worker with the existing server jobs; permit the required registration draft header through the existing CORS policy. |
| `backend/tests/kycReview.test.js` | Verify atomic persistence of the recoverable notice and evidence session. |
| `backend/tests/verificationNotifications.test.js` | Test renters/owners, both documents and decisions, ownership, stale versions, duplicate delivery, retries, email preferences, safe links, and escaping using a fake mail transport. |
| `backend/tests/accountVerification.test.js` | Add direct private-document preview attempts by a signed-in owner and an unauthenticated client to the existing real HTTP authorization test. |
| `backend/tests/registrationCors.test.js` | Exercise the server's real CORS declaration over HTTP for draft/OTP preflights, readable recovery, and retained origin/header/role protections. |
| `frontend/src/utils/verificationStatus.js` | Share role/state guidance and the rule giving fresh backend eligibility precedence over cached KYC. |
| `frontend/tests/verificationStatus.test.mjs` | Cover stale caches and distinct pending/correction/setup/selfie/account/email/completed instructions. |
| `frontend/src/components/AccountVerificationDocuments.jsx` | Add guidance, private saved indicators, stale-data messaging, automatic refresh, and the verification anchor. |
| `frontend/src/pages/AccountSettings.jsx` | Open verification links directly, retain valid data on refresh errors, and ignore superseded responses. |
| `frontend/src/owner/pages/Profile.jsx` | Apply the same status recovery and remove the redundant inferred summary when actual backend state is available. |
| `frontend/src/pages/VehicleDetailsPage.jsx` | Display accurate verification restrictions and link to the required action using fresh eligibility. |
| `frontend/src/components/NotificationDetailsModal.jsx` | Show wrapped correction text and a role-appropriate verification link instead of a booking link for document decisions. |
| `frontend/src/hooks/useRegistrationDraft.js` | Retain the confirmed account's completion status in page memory. |
| `frontend/src/components/RegistrationDraftNotice.jsx` | Reuse the existing notice for explicit registration completion and verification status; focus the Sign in action. |
| `frontend/src/components/RegisterPage.jsx` | Preserve completion, merge rapid field updates safely, guard duplicate submission, and remove completed mobile actions. |
| `frontend/src/pages/RegisterOwnerPage.jsx` | Apply the same owner field, completion, portal-action, and submission safeguards. |
| `frontend/src/components/RegistrationVerificationPhases.jsx` | Distinguish saved documents and matched selfie results from final admin approval. |
| `frontend/src/App.jsx` | Route an expired authenticated session away from an empty protected page to Sign In. |
| `scripts/account-verification-browser-check.mjs` | Extend the responsive fixtures with fresh/cached status changes, session/network failures, notification links, and booking next actions. |
| `scripts/registration-recovery-browser-check.mjs` | Check the explicit completion view and simultaneous Create Account clicks while retaining prior recovery/OTP assertions. |
| `docs/registration-verification-ux.md` | Record this phase's audit, implementation, file purposes, validation, rollout, and limits. |

Separate `C:\Users\charlie\rentifypro admin` checkout:

| File | Purpose |
| --- | --- |
| `backend/routes/adminData.routes.js` | Add the same session-bound notification marker to the existing atomic decision history write. |
| `backend/tests/verificationNotification.test.js` | Exercise actual HTTP approval/rejection handlers, password confirmation, required reason, missing sessions, and repeated decisions with controlled database/session fixtures. |

## Validation results

- Main explicit regression suite: **393 passed, 0 failed**. Coverage includes registration OTP/drafts/finalization, new and historical accounts, owner upgrades, independent approvals, file replacement/deduplication/retention, current selfie binding, authentication, booking/listing API authorization, booking lifecycle/payment safety, notifications, and camera helpers.
- Separate admin suite: **18 passed, 0 failed**, including the new HTTP decision/notification tests and existing session, review, comparison, and reconciliation checks.
- Account/verification browser suite: **49 passed**, with intercepted APIs and no runtime exceptions. It covers both roles at 320, 390, 768, and 1200 pixels; correction/recovery actions; pending/approved/rejected states; refresh; network and malformed responses; expired sessions; notification navigation; and stale-cache booking prompts.
- Registration browser matrix: **90 passed**, with intercepted APIs and no runtime exceptions. It refreshes every wizard step and each Step 4 phase for both roles at 320, 390, 768, and 1200 pixels. It also covers OTP retries/cooldowns, ordinary and rapid field entry, expired/conflicting drafts, interrupted upload/selfie/account responses, browser Back/Forward, password re-entry, and duplicate account submission.
- Final mobile navigation/completion pass: **14 passed**, with intercepted APIs and no runtime exceptions. Both roles retain verified phases through OTP retries, Back/Forward, interrupted account responses, and the former OTP URL. Rapid field entry and duplicate submission preserve a single creation request; completed screens hide all Create Account controls and retain the explicit Sign in action. Final renter/owner screenshots were inspected.
- Focused ESLint passed for the 12 affected frontend source files. The production Vite build passed. Explicit JavaScript/module syntax checks passed. Both checkouts passed `git diff --check`, with informational existing line-ending warnings. All nine shared admin KYC assets matched. Direct private-document preview attempts returned 403 for a signed-in owner and 401 without authentication.

These are controlled integration and browser workflow tests. Browser API/provider responses and native admin session fixtures are synthetic. File/controller/route regressions and the email worker exercise their real code with controlled models and a fake SMTP transport. No real OTP emails, document-decision emails, registrations, bookings, or production writes were performed.

Evidence is in the system temporary directory: `rentifypro-verification-ux-regression.txt`, `rentifypro-account-verification-browser.json`, `rentifypro-registration-recovery-browser.json`, `rentifypro-registration-recovery-browser-mobile.json`, and the `rentifypro-*-document-review-*`, `rentifypro-*-verification-notice-*`, and `rentifypro-*-registration-complete-*` screenshots. The browser scripts use isolated Vite/CDP ports 4176/9236 and must run sequentially because they share the browser's origin storage.

### Follow-up: live registration CORS correction

The reported Failed to fetch error and disabled fields were reproduced on the local frontend/API boundary. Draft requests require the `x-registration-draft` anti-CSRF header, but the server's explicit CORS header list omitted it. The live preflight returned 204 without allowing that header, so the browser could not finish initial recovery. The form correctly remained locked until backend recovery succeeded. Earlier intercepted browser tests did not exercise this server configuration.

This correction changes one production line in `backend/server.js`, adds `backend/tests/registrationCors.test.js`, and updates this report. It permits the specific required header. Origin restrictions, credentials, the required-header guard, role checks, cookie ownership, OTP limits, and rate limiting remain unchanged. No frontend, environment, database, or separate-admin files were changed for this correction.

- The new real-middleware HTTP regression failed before the header addition and passed afterward. It checks ten renter/owner draft and OTP preflights, actual no-cookie recovery, denied untrusted origins, missing-header rejection, invalid roles, and retention of existing allowed/exposed headers.
- **72 focused tests passed, 0 failed** across `registrationCors`, `corsOrigins`, `productionSafety`, `registrationDraft`, `registrationOtp`, `registrationEmail`, `preKycSession`, and `authSessionSecurity`. This is the follow-up suite; the larger UX suite above was not rerun for the one-line correction. Test mail and account/database operations in that suite use controlled fixtures.
- The existing development backend automatically reloaded. Its live preflight now explicitly allows `x-registration-draft`.
- **4 live browser checks passed**: renter and owner at 390 and 1200 pixels, using `localhost:5173` and the actual `localhost:5000` API. Each simulated an initial recovery failure, used Retry saving and recovery to reach the live draft controller through real browser CORS, confirmed field entry, then interrupted autosaving and verified that fields stayed editable and passwords were absent from browser storage. All eleven attempted test writes were blocked before transmission. No account was created, no OTP/email was sent, and no test draft was written to the database.
- Browser evidence: system temporary directory `rentify-registration-cors-live-browser.json`, with zero runtime errors. Backend syntax checks and `git diff --check` passed. The final diff was reviewed against a snapshot taken before this correction; unrelated worktree changes were preserved.

## Deployment and remaining risks

Deploy the main backend, rebuilt frontend, and the one-line Super Admin producer change together. The main backend must be running for decision-notification recovery and email delivery. Use the existing notification unique indexes, email flag/SMTP configuration, and durable shared private storage. No deployment, commit, push, environment-secret change, live email send, or production data mutation was performed.

Live MongoDB concurrency, SMTP delivery, OCR/face/liveness providers, real document authenticity, physical Android/iOS camera behavior, production storage durability, and full assistive-technology testing remain unverified. A real SMTP provider can still duplicate an email if it accepts the message but its acknowledgement is lost; the existing worker provides bounded retries and unique queue records, not a provider-level exactly-once guarantee. Previously recorded admin decisions are not backfilled into new notifications.

## UI delivery gate

Scope: the changed verification, booking-feedback, notification-link, and completion controls. Direction preserves the incumbent Manrope/blue/slate account interface and `DESIGN.md`, with ENERGY 1 / RHYTHM 1 / MOTION 1. Existing spacing, radii, buttons, focus styles, and semantic colors are reused. Anti-slop was applied during editing as selected by the user; Impeccable guided the existing-design integration.

| Gate | Result and evidence |
| --- | --- |
| R-02 | PASS: new user-facing copy has no em dashes. |
| R-03 | PASS: account/status and registration views passed four viewport widths with no horizontal overflow; mobile/desktop screenshots were inspected. |
| R-17 | PASS: status values come from backend responses; no promotional statistics added. |
| R-18 | PASS: no testimonials; fixture identities are explicitly synthetic. |
| R-23 | PASS: no visual assets or navigation structure created. |
| R-24 | PASS: notification and booking links reached the correct role's real verification section. |
| R-25 | PASS: existing primary blue/white and slate styles retain the preceding account report's measured contrast; completion text on its green surface measures 8.70:1. |
| R-26 | PASS: changed controls have actual handlers/links; account browser checks exercise replacement, retry, refresh, and navigation. |
| R-27 | PASS: missing, saved, pending, rejected, completed, loading, stale, offline, malformed-response, and expired-session states are handled. |
| R-28 | PASS: no FAQ added. |
| R-32 | PASS: native labeled controls and anchors retain keyboard operation and existing visible focus; Tab/focus and Enter history interaction passed. |
| R-33 | PASS: features implemented directly in source; no runtime source/CSS rewriting. |
| R-34 | PASS: existing theme behavior retained; no new theme controls. |
| R-35 | PASS: build, lint, regression suites, 49 account browser checks, 90 registration browser checks, and 14 final mobile checks passed; changed controls were exercised. |
| R-36 | PASS: simulated validation and untested live services are explicitly distinguished. |
| R-37 | PASS: preserve the existing five-step product design, with operational dials declared above. |
| R-38 | PASS: production content uses real backend state and recorded reasons; fabricated content stays in fixtures. |
| R-01 | PASS: existing primary-button gradient retained for action hierarchy; no new gradient treatment. |
| R-04 | PASS: existing icon family and notification components reused; no decorative icons added. |
| R-06 | PASS: existing Manrope hierarchy retained for product consistency. |
| R-07 | PASS: no background patterns added. |
| R-08 | PASS: no decorative arrows added. |
| R-09 | PASS: concrete status labels; no promotional badges. |
| R-10 | PASS: existing modal surface reused; no new translucent layers. |
| R-12 | PASS: existing control/panel elevation retained; no new shadow system. |
| R-13 | PASS: no new glow effects. |
| R-14 | PASS: shared document rows support comparison of independent required evidence. |
| R-19 | PASS: no new animations; existing loading/focus feedback retained. |
| R-22 | PASS: no illustrations added. |
| Dials | PASS: ENERGY 1 / RHYTHM 1 / MOTION 1 declared for the operational workflow. |
| Dial consistency | PASS: compact status rows and direct correction actions match those dials. |
| Focal point | PASS: current next action or registration completion is explicit. |
| Whitespace | PASS: existing spacing separates summary, documents, and correction form. |
| Accent | PASS: incumbent blue marks actionable controls. |
| Identity motif | PASS: existing rounded controls, slate labels, and account-panel structure retained. |
| Design read | PASS: current progress and required next action lead the existing account workflow. |
| C-1 | PASS: additions serve status inspection, recovery, correction, or completion. |
| C-2 | PASS: tested changed controls produce real outcomes. |
| C-3 | PASS: content follows required evidence and account progress; no filler sections. |
| C-4 | PASS: tested refresh, network, state-change, viewport, and keyboard cases preserve progress; live-device limits are stated above. |
| C-5 | PASS: no invented security, delivery, or real-service claims. |
| R-05 | PASS: settings/profile structure retained; no template redesign. |
| R-11 | PASS: incumbent radius scale retained. |
| R-15 | PASS: specific labels such as Replace ID, View Verification Status, and Sign in. |
| R-16 | PASS: concrete instructions and status copy; no promotional language. |
| R-20 | PASS: RentifyPro's existing account identity retained. |
| R-21 | PASS: no forced or deferred theme change. |
| R-29 | PASS: existing blue/slate palette with semantic feedback colors. |
| R-30 | PASS: extends the existing interface rather than adopting another product's layout. |
| R-31 | PASS: status clarity, independent evidence, and next actions explain the layout choices. |
