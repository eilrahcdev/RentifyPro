# Account access and document approval

Implemented locally on 2026-10-15 in the RentifyPro checkout and the separate `C:\Users\charlie\rentifypro admin` checkout. Changes remain uncommitted and undeployed.

## Result

Email-verified, active accounts can sign in, browse vehicles, and manage their profiles while required documents await review or need correction. Login already supported this separation; its authentication checks were preserved and regression-tested. Document rejection no longer labels the account inactive in either admin API.

Booking creation and owner confirmation validate current account, email, document versions, approvals, and selfie proof on the backend. Both parties are checked again immediately before the booking write. Listing creation, editing, and publishing require applicable owner verification. Pending owners can still view their vehicles and use existing disabling/removal actions, subject to their existing authorization and moderation rules.

| Account state | Sign in and account management | Verification permits booking | Verification permits owner listing actions |
| --- | --- | --- | --- |
| Active, email verified, ID pending or rejected | Yes | No | No |
| Active owner, ID approved, business document pending or rejected | Yes | No | No |
| Active, email verified, all required current documents approved, current selfie passed | Yes | Yes | Yes for owners |
| Email unverified, suspended, or archived | Existing access restrictions apply | No | No |

Verification eligibility does not replace booking debt, date, schedule, vehicle availability, payment, moderation, or other existing policies.

## State and security

- Existing account flags (`isDisabled`, `isArchived`), email proof (`isVerified`), per-document status, and the KYC summary remain separate. An additive `verification` response reports their actual combined state without exposing private paths, images, provider scores, or another party's correction instructions.
- Required documents are resolved from the account's saved registration or replacement sessions. Decisions must match the pinned document revision and identity hash. Missing bindings on new registrations and owner upgrades fail closed.
- Admin approval requires the existing comparison rules. Rejection requires correction instructions. The version/hash-checked decision atomically appends its action, reason, time, and reviewer to document history. Retried decisions do not create another history entry. A same-file rescreen also invalidates an older decision request.
- Both admin backends reconcile all required documents. Approving an owner's ID alone does not approve a pending business document. Existing admin authorization, sessions, password reauthentication in Super Admin, upload limits, and screening checks remain in place.
- Authenticated replacement uploads reuse the private storage and screening queue. Linked account evidence has no pre-registration expiry. Same-file retries retain the current revision and approval rather than creating duplicate evidence.
- Replacing a business document preserves the ID approval and valid selfie. Replacing the ID invalidates its face result, retains unrelated business approval, and requires a new selfie. Upload attempts and provider results are bound to the current ID version; delayed or unbound callbacks cannot approve a replacement.
- If ID face setup is interrupted, the saved reference and incomplete setup status remain recoverable. The user can retry setup from the private backend file without selecting or uploading it again. The backend checks ownership and file integrity. Expired provider face setup can be initialized again from that file; a completed valid selfie does not depend on keeping a temporary provider embedding alive.
- Optional approved-account face reverification uses separate temporary document storage. It preserves the account's required approved evidence.
- Owner upgrades retain their existing requirement for approved business evidence. That evidence is now durably linked and version-pinned. An interrupted upgrade leaves listing restricted until its required bindings are complete. This task does not broaden the upgrade policy to accept pending evidence.
- Historical approved accounts retain their existing approval. The UI labels this `Previously approved`; it does not invent document versions or historical decisions. Current registered accounts and replacements use the stronger version-bound checks.
- Schema additions are backward compatible. This task requires no destructive data migration or index change and performed no live database changes. Earlier registration-draft migration work remains separate.

The existing five-step registration flow and Step 4 email/ID/face phases are retained. Its OTP, draft recovery, final account creation, password-in-memory, and private evidence regressions are included in the test run. See [registration email workflow](registration-email-workflow.md) and [registration persistence](registration-persistence.md) for those earlier changes. This document supersedes the earlier report's ambiguous statement that account access waits for document approval: restricted booking/listing actions wait for approval; an active email-verified account can sign in.

## Intentionally changed files

Paths in this table are relative to the main RentifyPro checkout. Existing unrelated worktree changes were preserved.

| File | Purpose |
| --- | --- |
| `backend/utils/accountVerification.js` | Shared pure rules for current document approvals, required bindings, selfie proof, and interrupted ID setup. |
| `backend/services/accountVerification.service.js` | Resolve owned evidence, compute separate account/verification/eligibility state, and enforce fresh eligibility without leaking another party's document details. |
| `backend/middleware/rbac.middleware.js` | Validate actual evidence behind existing KYC guards; fail closed when verification cannot be loaded. |
| `backend/controllers/booking.controller.js` | Check renter and owner eligibility during creation and expose the signed-in user's combined eligibility in preflight. |
| `backend/controllers/ownerDashboard.controller.js` | Recheck both parties before confirming a booking while preserving other booking transitions. |
| `backend/routes/owner.routes.js` | Guard listing edits and publication, including normalized availability inputs. |
| `backend/controllers/kyc.controller.js` | Add authenticated per-document correction and saved-ID setup recovery; retain durable private files, isolate optional reverification, and reject stale face results. |
| `backend/routes/kyc.routes.js` | Protect the correction endpoint; allow only the matching verified, approved renter to use the existing owner-upgrade business upload path. |
| `backend/services/kycReview.service.js` | Reconcile independent required documents and append atomic version-bound review history. |
| `backend/controllers/auth.controller.js` | Bind approved upgrade evidence to its owner account without replacing the existing identity history. |
| `backend/models/User.js` | Add a backward-compatible owner-document requirement flag for upgrades. |
| `backend/models/KycVerification.js` | Store supporting-document session, historical identity proof, and ID upload attempt binding. |
| `backend/models/PreKycDocument.js` | Store per-version admin decision history. |
| `backend/routes/admin.routes.js` | Separate account/document status, expose admin history, and include actual verification state in admin data. |
| `backend/scripts/sync-admin-kyc-assets.js` | Include the shared approval rules in the existing admin asset synchronization. |
| `frontend/src/components/AccountVerificationDocuments.jsx` | Show backend statuses and reasons; support replacement, cancellation, saved-ID setup retry, and continuing the current selfie. |
| `frontend/src/pages/AccountSettings.jsx` | Integrate independent document status and current-ID selfie recovery for renters. |
| `frontend/src/owner/pages/Profile.jsx` | Integrate the same status/correction controls for owners. |
| `frontend/src/verification/VerificationStepper.jsx` | Resume at selfie without reuploading the ID and retain actionable backend conflict messages. |
| `frontend/src/utils/api.js` | Add the authenticated document correction request. |
| `frontend/src/admin/components/AdminUI.jsx` | Display the version, reviewer, date, reason, and decision in an expandable history. |
| `backend/tests/accountVerification.test.js` | Cover login separation, independent approvals, stale summaries, fresh backend guards, authorization, privacy, and the owner-upgrade upload gate. |
| `backend/tests/accountDocumentReplacement.test.js` | Exercise real temporary private files with controlled models/providers, deduplication, business/ID invalidation, saved-file recovery, foreign ownership, and delayed provider responses. |
| `backend/tests/helpers/approvedAccountFixture.js` | Provide actual approved account state to existing booking regression fixtures. |
| `backend/tests/bookingEligibility.test.js` | Supply approved account evidence to existing debt/schedule and preflight tests. |
| `backend/tests/bookingTransactionFee.test.js` | Keep transaction-fee scenarios authenticated and approved under fresh account checks. |
| `backend/tests/vehicleBookingConcurrency.test.js` | Preserve concurrent reservation/creation assertions with approved actors. |
| `backend/tests/dateValidation.test.js` | Preserve date/horizon validation assertions with approved actors. |
| `backend/tests/readinessWorkflows.test.js` | Preserve booking confirmation/rejection concurrency checks with approved actors. |
| `backend/tests/geminiManualReview.test.js` | Cover durable authenticated uploads and version-bound provider acknowledgements while retaining pre-registration expiry assertions. |
| `backend/tests/kycReview.test.js` | Add history idempotence and same-file rescreen decision-conflict regressions. |
| `backend/tests/ownerUpgrade.test.js` | Check durable business linkage and preserved original identity approval. |
| `backend/tests/preKycSession.test.js` | Model verified email and fresh KYC reads in the existing guard regressions. |
| `scripts/account-verification-browser-check.mjs` | Repeatable synthetic responsive, refresh, correction, interrupted response, duplicate-click, keyboard, saved-ID recovery, and history checks. |
| `docs/account-verification-workflow.md` | Record behavior, modified files, validation evidence, rollout, and limits. |

The separate admin checkout has four intentional changes:

| File | Purpose |
| --- | --- |
| `backend/routes/adminData.routes.js` | Keep account status independent; append per-version review history and audit metadata; reconcile approval through the shared rules. |
| `backend/services/privateKycReview.service.js` | Resolve linked registration/correction documents and update eligibility only when all current conditions hold. |
| `backend/data/private-kyc/utils/accountVerification.js` | Synchronized copy of the shared approval rules. |
| `backend/tests/accountVerification.test.js` | Test owner/renter decisions, required evidence, interrupted setup, replacements, and explicit reverification restrictions. |

## Validation

- Main explicit regression suite: **375 passed, 0 failed**. It covers account eligibility/replacements, registration OTP/drafts/finalization, KYC routes/review/reverification/storage, sessions, owner settings/upgrades, booking eligibility/concurrency/dates/fees/extensions/cancellations, payment safety, reports, and camera helpers. Existing behavioral assertions were retained; fixtures now supply the account state needed by fresh checks.
- Separate admin suite: **16 passed, 0 failed**, using `accountVerification.test.js`, `privateKyc.test.js`, `adminCustomerRoutes.test.js`, and `adminSecurityModels.test.js`.
- Synthetic Chrome: **24 responsive role/state cases** at 320, 390, 768, and 1200 pixels, with refresh recovery; **11 focused interaction/recovery checks**. The earlier four interaction checks were expanded into the latter eleven rather than counted twice. Both renter and owner screens were exercised. Screenshots were inspected; measured pages had no horizontal overflow. Keyboard Tab/focus and admin history disclosure were checked. These are emulated viewports and intercepted APIs, not real phones or live verification.
- Focused ESLint passed for the six modified frontend files. `npm.cmd run build` passed. Nineteen changed JavaScript source/test/helper files passed explicit syntax checks; JSX compilation is covered by the build.
- All **9 shared admin KYC assets matched** using the existing synchronization script with `--check`. Both checkouts passed `git diff --check`, apart from informational existing line-ending warnings. The full intentional diff, new files, and admin diff were reviewed against the starting snapshots; unrelated changes were preserved.

Test evidence is in the system temporary directory: `rentifypro-account-verification-final-tests.txt`, `rentifypro-account-verification-browser.json`, `rentifypro-account-verification-browser-recovery.json`, and `rentifypro-*-document-review-*.png` / `rentifypro-*-saved-id-recovery-390.png`. The browser script expects Vite on 4176 and an isolated Chrome CDP instance on 9236; it does not send real mail or create real accounts.

## Rollout and remaining limits

Deploy the main backend, rebuilt frontend, and the four admin changes together. Retain the existing durable shared private-upload storage and access controls. Shared MongoDB alone does not share file bytes between deployments. No deployment, commit, push, environment-secret change, or live account mutation was performed.

Controlled model tests exercise the real controllers/routes and private file operations. They do not prove live MongoDB transaction/race behavior, SMTP delivery, OCR accuracy, face/liveness provider behavior, or document authenticity. The booking checks are fresh checks before writes; they do not claim a transaction spanning verification, account, and booking collections. Physical Android/iOS devices and assistive technologies still require live acceptance testing.

New audit entries are durable from this implementation onward. Earlier document decisions are not reconstructed. Existing protected identity/business profile fields remain protected; correcting missing registered BIR details still uses the existing support process.

## UI delivery gate

Scope: changed verification controls and history disclosure. Existing navigation, global styles, unrelated page content, and themes were not redesigned. Direction follows `DESIGN.md`: an operational account workflow using incumbent Manrope, blue actions, slate text, the existing radius/spacing scale, and compact document rows. ENERGY 1 / RHYTHM 1 / MOTION 1. Existing primary-button treatments identify the next action; rows and dividers separate independent evidence. No assets, dependencies, or global styles were introduced. Anti-slop was applied during editing, as selected by the user; Impeccable guided the existing-design integration.

| Gate | Result and evidence |
| --- | --- |
| R-02 copy punctuation | PASS: new user-facing verification copy has no em dashes. |
| R-03 responsive layout | PASS: measured role/state pages at four widths, refreshed them, and inspected mobile/desktop screenshots; no horizontal overflow. |
| R-17 statistics | PASS: the new UI displays backend state, with no promotional statistics. |
| R-18 testimonials | PASS: no testimonials introduced; browser fixtures are explicitly synthetic. |
| R-23 assets/navigation | PASS: no new visual assets or navigation structure. |
| R-24 destinations | PASS: existing account routes are retained; new controls call the authenticated document endpoint or existing selfie stepper. |
| R-25 contrast | PASS: inherited white primary-button text has at least 4.78:1 contrast across its blue stops; slate-600 on white is 7.58:1, green-800 is 7.13:1, and red-700 is 6.47:1. |
| R-26 working controls | PASS: browser actions cover replacement, file selection, submit, cancel, saved-ID retry, continuing selfie, and history disclosure. |
| R-27 states | PASS: backend missing/pending/rejected/approved states, loading indicators, alerts, malformed acknowledgements, and interrupted responses are handled. |
| R-28 FAQ | PASS: no FAQ added. |
| R-32 keyboard/focus | PASS: native labeled inputs/select/buttons and details/summary; inherited visible focus styles; Tab reaches recovery with a visible outline and Enter toggles history. |
| R-33 source implementation | PASS: controls are implemented directly in JSX; no runtime source/CSS rewriting. |
| R-34 themes | PASS: existing theme behavior retained; no theme control introduced. |
| R-35 execution | PASS: production build, focused lint, responsive checks, and recorded changed-control interactions passed. |
| R-36 claims | PASS: document approval and account access are described separately; live-service and device testing limits are stated above. |
| R-37 direction | PASS: the user requested preservation of the existing design; implementation uses `DESIGN.md` and the operational dials declared above. |
| R-38 real content | PASS: production rows use backend documents, reasons, and decision history; synthetic content exists only in tests. |
| R-01 gradients | PASS: existing blue button gradient marks primary action; no new gradient styles. |
| R-04 icons | PASS: no icon family or decorative icons added. |
| R-06 type | PASS: incumbent Manrope and existing type sizes preserve the app's identity. |
| R-07 backgrounds | PASS: no new grid or patterned backgrounds. |
| R-08 arrows | PASS: no decorative arrows added. |
| R-09 badges | PASS: independent states use plain descriptive text; no promotional badges. |
| R-10 transparency | PASS: no new translucent surfaces. |
| R-12 elevation | PASS: reuse existing button/card elevation; document rows use dividers. |
| R-13 glow | PASS: no new glow treatment. |
| R-14 repeated rows | PASS: a shared row structure supports comparison of required documents; next actions depend on actual state. |
| R-19 motion | PASS: no new animations; existing button interaction is retained. |
| R-22 illustrations | PASS: no illustrations added. |
| Liveliness dials | PASS: ENERGY 1 / RHYTHM 1 / MOTION 1 declared for an operational workflow. |
| Dial consistency | PASS: compact rows and existing button feedback match those dials. |
| Focal point | PASS: current document action or recovery action is visually primary. |
| Structural whitespace | PASS: existing spacing separates account summary, individual documents, and correction form. |
| Accent | PASS: incumbent blue marks actionable recovery/submission. |
| Identity motif | PASS: existing rounded controls and slate labels recur across renter and owner views. |
| Design read | PASS: preserve the established account/settings interface while making independent verification states actionable. |
| C-1 intentionality | PASS: each addition supports status inspection, correction, recovery, or audit review. |
| C-2 completeness | PASS: changed controls have real handlers and the browser checks exercise their outcomes. |
| C-3 composition | PASS: rows reflect required ID/business evidence; no filler sections. |
| C-4 resilience | PASS: changed controls handle the tested viewport, refresh, network, and keyboard cases; physical-device/assistive testing remains an acceptance limit. |
| C-5 evidence | PASS: backend status and recorded test results are distinguished from untested live behavior. |
| R-05 structure | PASS: existing settings/profile placement retained; no marketing template added. |
| R-11 radii | PASS: existing control/card scale retained. |
| R-15 action labels | PASS: specific labels such as Replace ID, Submit replacement, and Retry saved ID setup. |
| R-16 wording | PASS: concrete status/correction copy; no promotional claims. |
| R-20 identity | PASS: incumbent RentifyPro account surface, typography, and controls retained. |
| R-21 theme direction | PASS: no forced theme or deferred theme requirement. |
| R-29 palette | PASS: existing blue/slate palette with semantic error/success text. |
| R-30 originality | PASS: extends the existing product interface; no borrowed product layout. |
| R-31 reasons | PASS: layout separates independent evidence, type follows the established scale, and blue identifies the next action. |
