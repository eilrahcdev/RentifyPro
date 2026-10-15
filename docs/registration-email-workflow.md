# Registration email verification and recovery

The five-step renter and owner wizards now use Step 4 for Email Verification → ID Verification → Face Recognition. Owner Step 3 collects business details; its supporting-document upload is in Step 4 after email verification. Step 5 creates an email-verified account while eligible documents await final admin review, then directs the user to sign in.

## Backend behavior

- OTP uses the existing `Otp` model and email delivery service. Codes use cryptographic randomness and a draft/session/email-bound HMAC. New draft OTP records contain hashes, never plaintext codes or passwords.
- Codes expire after five minutes. Verification allows five attempts per code and 25 attempts per draft. Resending has a minimum 45-second cooldown, enforced on the draft and on a deterministic email-wide OTP record across browsers. A separate send limiter permits ten requests per IP per 15 minutes; existing OTP, draft, upload, and general limits remain active.
- A valid signed session alone cannot bypass email verification. Document uploads and selfie checks require an active draft with the current email verified on the backend. Final registration checks the same proof, current document integrity/profile/version, valid selfie result, and submitted details against the saved draft.
- Requested steps and phases are navigation preferences. Recovery clamps them to the actual backend verification state. An earlier valid phase is restored after refresh without clearing completed checks.
- Changing email clears its OTP and verified-email proof while preserving the registration session and unaffected private evidence. A code for the new email is required. Changing an ID invalidates its corresponding selfie; changing a business document preserves the unaffected ID/selfie result.
- A revision-checked submission lease serializes Create Account. The unique email/phone indexes remain authoritative. The user records its draft association so retries or lost database acknowledgements can finalize the same account. Owned-draft recovery repairs interrupted finalization.
- The wizard clears its draft only after a confirmed account response or backend recovery of the created account. A malformed success response preserves Review and completed checks. Draft deletion uses backend submission/account associations; a client completion flag cannot remove linked evidence or skip cleanup of abandoned evidence.
- New accounts have `isVerified: true`. Pending document review uses the existing `challenge_passed` KYC state, displayed as document review pending; documents retain `pending_review`. Linked evidence stays private and is protected from pre-registration expiration cleanup. Document/session bindings are preserved.
- Approval reconciliation checks the pinned ID and, for owners, the supporting-document version. Account access remains restricted until the existing approval workflow grants `approved`. Later authenticated ID corrections retain the business-review gate. Existing approved-account reverification remains separate.
- The separate `RegisterOTP` page was removed. Legacy `/registerotp` URLs return to the appropriate role's wizard and recover its owned draft. Existing account-verification and password-reset APIs remain available for their current callers.
- The unused owner signup API now follows the same final-registration validation through `/api/owner/register`. Its former `/api/owner/resend-otp` and `/api/owner/verify-otp` actions return `410 REGISTRATION_WIZARD_REQUIRED`; they cannot create accounts through stale pending OTP payloads. No frontend callers of those actions were found. External clients using that discontinued signup flow must use the draft wizard.
- Passwords and consent remain in page memory only. Refresh or a document navigation requires password re-entry and renewed consent before submission.

## Files changed for this follow-up

| File | Purpose |
| --- | --- |
| `backend/models/RegistrationDraft.js` | Persist OTP proof/challenge, requested phase, submission lease, and account-finalization metadata. |
| `backend/controllers/registrationDraft.controller.js` | Send/verify draft OTP, validate and restore phases, invalidate changed email proof, repair interrupted finalization, and protect account evidence during draft deletion. |
| `backend/utils/registrationDraft.js` | Reuse completeness/profile rules, validate email proof, and clamp requested steps/phases. |
| `backend/utils/emailOtp.js` | Share secure code generation and expiry with existing OTP callers; provide draft hashing and bounded cooldown configuration. |
| `backend/models/Otp.js` | Add an isolated registration-draft purpose for email-wide resend serialization. |
| `backend/routes/kyc.routes.js` | Wire guarded OTP endpoints and require verified email before pre-registration uploads/selfies. |
| `backend/routes/owner.routes.js` | Route the owner registration alias through shared validation and retire obsolete signup OTP actions. Other owner routes retain their guards. |
| `backend/middleware/preKycSession.middleware.js` | Enforce the draft/email gate and retain the evidence identity across email edits. |
| `backend/controllers/auth.controller.js` | Validate the complete draft, create an email-verified pending account, and finalize repeated/uncertain submissions safely. |
| `backend/services/registrationFinalization.service.js` | Reuse one retryable finalization path to create the KYC case, link current private evidence, and reconcile approval. |
| `backend/models/User.js` | Bind a created account to its registration draft for duplicate prevention and recovery. |
| `backend/models/PreKycDocument.js` | Associate successfully submitted private evidence with its account. |
| `backend/models/KycVerification.js` | Pin registration document versions and distinguish later authenticated ID corrections. |
| `backend/services/kycReview.service.js` | Reconcile registered pending cases only after all required pinned documents are approved. |
| `backend/controllers/kyc.controller.js` | Refuse stale pre-registration writes to account evidence and keep subsequent authenticated correction/reverification routing compatible. |
| `backend/jobs/kycFileCleanup.job.js` | Preserve private files linked to created accounts while continuing abandoned-draft cleanup. |
| `frontend/src/components/RegistrationEmailVerification.jsx` | Embedded OTP controls, code paste/autofill handling, cooldown/expiry/errors, and duplicate-action prevention. |
| `frontend/src/components/RegistrationVerificationPhases.jsx` | Show the three phases with current and completed states. |
| `frontend/src/components/RegisterPage.jsx` | Integrate OTP, restore valid phases, preserve unaffected results, and submit Pending Review accounts at Review with a validated account acknowledgement. |
| `frontend/src/pages/RegisterOwnerPage.jsx` | Move business uploads after email verification, retain five steps, preserve independent document/selfie results, and validate account acknowledgements. |
| `frontend/src/hooks/useRegistrationDraft.js` | Restore authoritative email/phase state, save phase preferences, call OTP endpoints, and recover completed registrations. |
| `frontend/src/utils/registrationDraftApi.js` | Serialize OTP requests with saves and expose server retry timing. |
| `frontend/src/utils/registrationDraft.js` | Cache only an allowlisted, untrusted phase preference alongside password-free pending edits. |
| `frontend/src/components/RegistrationDraftNotice.jsx` | Recover an already-created account without another submission and clear the completed draft when continuing to sign in. |
| `frontend/src/App.jsx` | Remove the post-registration OTP flow and route old OTP links back to the correct registration role. |
| `frontend/src/pages/Register.jsx` | Remove the obsolete OTP callback from the registration wrapper. |
| `frontend/src/verification/RegisterOTP.jsx` (removed) | Remove the separate post-registration page; its OTP control patterns are used inside the wizard. |
| `backend/tests/registrationOtp.test.js` | OTP ownership/expiry/attempt/cooldown races, phase recovery, changed email/documents, Pending Review creation, approval gates, and interrupted/duplicate submissions. |
| `backend/tests/registrationDraft.test.js` | Update verified fixtures/completeness expectations while preserving recovery/security assertions. |
| `backend/tests/registrationEmail.test.js` | Keep the final email-race regression behind the new verified-draft prerequisite. |
| `scripts/registration-draft.test.mjs` | Verify phase preferences remain allowlisted and passwords/verification claims never enter the pending buffer. |
| `scripts/registration-recovery-browser-check.mjs` | Extend synthetic browser checks to OTP phases, navigation, refresh, pending creation, and interrupted responses. |
| `docs/registration-persistence.md` | Update the persistence overview for in-wizard OTP and pending account creation. |
| `docs/registration-email-workflow.md` | Record this follow-up's behavior, files, validation, setup, and limits. |

## Validation

The targeted regression suite includes real Express route/middleware checks with controlled database, mail, document, and verification fixtures. No test sent a real email or created a live account. The frontend production build, focused ESLint, 20 JavaScript syntax checks, and Git whitespace check passed.

Final focused regression result: **174 passed, 0 failed**. This includes OTP, draft deletion and ownership, version-bound verification, phase navigation, uncertain/duplicate submissions, account creation, authenticated KYC/reverification, owner manual-payment, and vehicle-photo route regressions.

The complete browser run passed 84 synthetic checks across both roles, all five steps, and all three verification phases at 320, 390, 768, and 1200 pixels. Desktop and mobile email-phase screenshots were inspected. An additional final mobile run passed 28 checks, including browser Back/Forward, refresh in earlier phases, OTP autofill-style input, and completed-draft cleanup when continuing to sign in.

UI review: responsive reflow and no horizontal overflow passed; OTP fields have individual accessible labels and numeric/one-time-code input hints; errors and confirmations use live regions; existing wizard styles, document widgets, camera capture, and navigation controls remain in use. No new assets, global styles, dependencies, or motion were added.

Run focused regression tests from the repository root:

```powershell
node --test backend/tests/registrationOtp.test.js backend/tests/registrationDraft.test.js backend/tests/registrationEmail.test.js backend/tests/preKycSession.test.js backend/tests/preKycDocumentGate.test.js backend/tests/preKycSelfieGate.test.js backend/tests/kycRoutes.test.js backend/tests/kycQueueCompatibility.test.js backend/tests/privateKyc.test.js backend/tests/geminiManualReview.test.js backend/tests/kycReview.test.js backend/tests/kycReverification.test.js backend/tests/kycSummary.test.js backend/tests/authSessionSecurity.test.js backend/tests/authFieldErrors.test.js backend/tests/ownerManualPayment.test.js backend/tests/vehiclePhotos.test.js scripts/registration-draft.test.mjs frontend/tests/cameraKyc.test.mjs
```

With Vite on `127.0.0.1:4176` and isolated Chrome CDP on `9236`, run `node --experimental-websocket scripts/registration-recovery-browser-check.mjs`. Use `--edges-only --mobile` for the additional mobile recovery/navigation run.

After the final acknowledgement and deletion safeguards, the targeted navigation run (`--navigation-only --mobile`) passed 12 checks. It covers both roles, malformed account responses, dropped account-creation responses, earlier-phase refresh, browser Back/Forward, legacy OTP redirects, and completed-draft cleanup. The complete 84-check matrix and additional 28-check mobile run were performed before those final safeguards; the targeted rerun exercises the affected submission/navigation paths.

## Setup and remaining limits

The read-only database check confirmed the existing unique account-email index and OTP expiration index. The registration draft collection/indexes have not been created in the connected database. The additive migration from the persistence implementation remains available: from `backend`, run `node scripts/migrate-registration-drafts.js` to inspect, then `node scripts/migrate-registration-drafts.js --apply` against the intended deployment database. Runtime expiry checks and cleanup also enforce draft expiration. No live database data or indexes were changed during this implementation.

Browser/provider responses and camera streams were synthetic. Live SMTP delivery, real OCR/face/liveness services, physical phones, production cookies, and deployment were not exercised. Existing uncertain/mismatched OCR still needs the current comparison/correction before selfie; final document approval no longer blocks account creation. Pending accounts remain subject to the existing account-review workflow. No commits, pushes, merges, or deployments were performed.

Deployment must retain the existing private KYC directory on persistent storage, shared by backend instances when applicable. This implementation reuses that storage; local filesystem fixtures do not establish production storage durability.
