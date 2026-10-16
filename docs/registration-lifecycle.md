# Registration lifecycle implementation

Registration remains temporary until the applicant explicitly selects **Create Account**. Completing document checks or selfie verification does not create a user. Temporary backend storage is still necessary to screen uploads and recover progress.

## The nine changes

1. **Keep unfinished registrations temporary.** Drafts retain the existing 60-minute inactivity expiry and maximum 72-hour lifetime, subject to a shorter configured KYC-session lifetime. Cancellation is terminal for that draft; stale saves and signed tokens cannot restore it.
2. **Use Cancel registration.** Both forms ask for confirmation, offer Keep registering, and return home after successful cancellation. Back, replacement uploads, and selfie retakes remain available. Leaving the page preserves resumable progress until expiry. A cancellation failure preserves the form and permits retry.
3. **Serialize verification, cancellation, and submission.** Revision-bound verification leases prevent cancellation or final submission from deleting evidence during an upload or selfie request. A completed or uncertain account submission cannot be treated as an abandoned draft. Background OCR claims and writes exclude cancelled or expired registration evidence.
4. **Clean temporary evidence together.** Cancellation clears draft details and removes its unsubmitted document records, Node selfie results, and unreferenced private files. File references survive partial deletion failures for retry by the existing cleanup job. Expired orphan evidence can recreate a cleanup marker if MongoDB TTL removed its draft first. Account-associated evidence is protected. Cleanup markers expire; cleanup email references are removed once deletion succeeds.
5. **Separate registration assistance from final approval.** Ordinary abandoned uploads do not enter the admin review query. An applicant can explicitly request manual comparison of an unresolved current ID. The separate admin app defaults to Final approval and offers a Registration assistance view with Save comparison. Neither approval nor rejection is allowed for an unsubmitted registration. Backend restrictions protect both admin APIs, previews, and comparison writes.
6. **Preserve hybrid verification.** Private OCR provides preliminary checks; existing manual final-approval requirements remain. An ID must pass the existing comparison requirements before selfie verification. Uncertain business readings can proceed with final approval pending. A confirmed business correction blocks progression and final submission. No automatic-approval flag or OCR threshold was enabled or relaxed.
7. **Show truthful verification guidance.** Preliminary matching, requested manual comparison, corrections, and final approval have distinct messages. Document status remains visible during selfie verification. Completing a selfie removes the instruction to take another one. Cancellation preserves keyboard focus during registration phase transitions.
8. **Protect account creation against retries and duplicates.** The existing email constraint is retained; phone and registration-draft uniqueness are declared. Replica-set and sharded deployments use one transaction for the new user, KYC case, document links, and draft completion. Standalone databases retain the existing recoverable submission flow. Unknown transaction commit results retain their recovery claim. The index script defaults to read-only and adds only missing indexes with `--apply`; it never normalizes or deletes account records.
9. **Verify the affected flows.** Regression tests cover cancellation after all verification, stale requests, active claims, deletion retries, TTL orphans, submitted-account protection, manual assistance, business corrections, and transactional wiring. Synthetic browser checks exercise both roles, mobile/tablet/desktop cancellation, verification errors, camera cleanup, replacement revisions, and repeated Create Account clicks.

## Files intentionally changed

Paths in this table are relative to the main checkout.

| Files | Purpose |
| --- | --- |
| `backend/controllers/auth.controller.js` | Claim submission safely and call transactional account creation. |
| `backend/controllers/registrationDraft.controller.js` | Return safe screening/recovery data, guard cancelled drafts, propagate expiry, and coordinate cancellation. |
| `backend/controllers/kyc.controller.js` | Bind uploads to drafts, accept explicit current-ID assistance requests, expose safe status, and restrict admin access. |
| `backend/middleware/registrationEvidence.middleware.js` | Hold a revision-bound lease for verification requests. |
| `backend/models/RegistrationDraft.js` | Add compatible cancellation, cleanup, and lease metadata. |
| `backend/models/PreKycDocument.js` | Add draft ownership, expiry, cancellation, and assistance metadata. |
| `backend/models/User.js` | Declare phone and registration-draft unique indexes. |
| `backend/routes/kyc.routes.js` | Apply existing security/rate limits plus evidence leases; expose the manual-assistance request. |
| `backend/routes/admin.routes.js` | Restrict the integrated admin queue, previews, and comparisons. |
| `backend/services/registrationCleanup.service.js` | Coordinate cancellation and retryable cleanup, including expired orphans. |
| `backend/services/registrationFinalization.service.js` | Create and finalize atomically where MongoDB supports transactions; preserve recovery otherwise. |
| `backend/services/kycReview.service.js` | Require submission before final decisions. |
| `backend/services/manualKycComparison.service.js` | Permit only submitted evidence or explicitly requested current-ID assistance. |
| `backend/jobs/kycDocumentProcessing.job.js` | Prevent cancelled/expired registrations from receiving OCR writes. |
| `backend/jobs/kycFileCleanup.job.js` | Run coordinated draft cleanup before existing file retention. |
| `backend/utils/registrationDraft.js` | Reject cancelled drafts and enforce supporting-document corrections during recovery. |
| `backend/utils/registrationReview.js` | Define submission, assistance, review visibility, and business continuation rules. |
| `backend/utils/registrationIndexAudit.js` | Count normalized duplicates and legacy-format issues without exposing identities. |
| `backend/scripts/check-registration-indexes.js` | Audit live index readiness and add missing indexes explicitly. |
| `backend/scripts/sync-admin-kyc-assets.js` | Include the shared registration-review policy in future admin asset synchronization. |
| `frontend/src/components/RegisterPage.jsx`, `frontend/src/pages/RegisterOwnerPage.jsx` | Wire cancellation, retain verification guidance, and prevent actions while cancelling; owner form also enforces business corrections. |
| `frontend/src/components/RegistrationDraftNotice.jsx` | Provide confirmation, retry, keyboard focus, and cancellation outcomes. |
| `frontend/src/components/PreKycReviewNotice.jsx` | Show accurate statuses and the explicit manual-assistance request. |
| `frontend/src/hooks/useRegistrationDraft.js` | Stop pending autosaves before cancellation and preserve progress after failures. |
| `frontend/src/hooks/useRegistrationNavigation.js` | Avoid stealing focus from cancellation confirmation. |
| `frontend/src/utils/registrationVerification.js` | Share user-facing verification rules and messages. |
| `frontend/src/utils/kycApi.js` | Call the manual-assistance endpoint; retain the pre-existing response-parser changes. |
| `backend/tests/registrationOtp.test.js`, `backend/tests/registrationDraft.test.js` | Exercise lifecycle behavior and update fixtures to reflect terminal cancellation. |
| `backend/tests/registrationEvidence.test.js`, `backend/tests/registrationCleanup.test.js`, `backend/tests/registrationReview.test.js` | Cover leases, orphan cleanup, ownership policy, business continuation, and index declarations. |
| `backend/tests/privateKyc.test.js`, `backend/tests/kycReview.test.js` | Distinguish requested comparison from submitted final approval. |
| `frontend/tests/registrationVerification.test.mjs` | Verify truthful messages and correction rules. |
| `scripts/registration-recovery-browser-check.mjs` | Add lifecycle browser scenarios and update cancellation expectations. |
| `scripts/private-document-checker-browser-check.mjs` | Update backend-draft fixtures and current upload/review expectations; keep camera, stale-revision, and mismatch assertions. |
| `docs/registration-lifecycle.md` | Record behavior, scope, verification, and release requirements. |

In the separate `C:\Users\charlie\rentifypro admin` checkout, the intentional changes are:

| Files | Purpose |
| --- | --- |
| `backend/data/private-kyc/utils/registrationReview.js` | Use the same registration-review policy as the main API. |
| `backend/services/privateKycReview.service.js` | Enforce assistance/submission boundaries while preserving existing integrity, ownership, identifier, and visual-inspection requirements. |
| `backend/routes/adminData.routes.js` | Filter the queue and restrict preview, comparison, and final-decision writes. |
| `frontend/src/admin/pages/DocumentsView.jsx` | Separate assistance from final approval and scope queue statistics to the selected purpose. |
| `frontend/src/admin/components/AdminUI.jsx` | Save an assistance comparison without exposing final decision actions. |
| `frontend/AdminAccountPage.jsx` | Connect Save comparison to the existing authenticated comparison API. |
| `backend/tests/privateKyc.test.js` | Use submitted evidence in final-approval fixtures. |
| `backend/tests/registrationSubmission.test.js` | Cover unsubmitted, cancelled, expired, conflicting, and submitted evidence. |

## Verification and database audit

- Main backend: 184 focused/relevant tests passed across registration, private OCR, KYC, account eligibility, CORS, and authentication security.
- Separate admin backend: 23 focused tests passed.
- Frontend verification-message test passed; targeted main frontend ESLint passed.
- Main and admin production frontend builds passed.
- Synthetic browser checks: 33 lifecycle checks, 24 verification-error checks, four document/camera scenarios, and two completion scenarios at each of desktop and mobile widths. These do not create live accounts or prove real-document authenticity or physical-device behavior.
- Main and admin Git whitespace checks passed. The 29 unrelated pre-existing changed files in the main checkout and 52 in the admin checkout matched their initial hashes. Existing work inside intentionally edited files was retained through scoped changes.
- The configured database contained 13 users, no normalized duplicate emails/phones/drafts, and one legacy phone-format issue. Only the missing registration-draft unique index was added. A follow-up read-only audit found no missing required unique or TTL indexes. No account records were corrected or deleted; the legacy formatting issue remains visible in the audit.

From `backend`, use `node scripts/check-registration-indexes.js` for a read-only audit. `--apply` adds missing compatible indexes after checking the affected fields; it does not repair legacy records. Do not use destructive index synchronization.

## Release and retention boundaries

Deploy the main backend/frontend and the separate admin backend/frontend together so queue visibility and assistance behavior agree. No commit, push, merge, or deployment was performed. The database index addition is already applied to the database selected by the local backend configuration.

The API process must run its existing KYC cleanup job and have access to the same durable private-file storage used for uploads. Cleanup runs at startup and every 15 minutes by default; failed file deletion can finish later. MongoDB TTL timing is asynchronous. Cancellation marks the registration unusable before cleanup finishes.

Face-service template retention is unchanged: successful selfie verification already deletes its biometric template; unmatched templates use the face service's existing TTL (24 hours by default). This implementation removes the Node registration evidence/results and private uploads; it does not add a new face-service deletion API. Passwords, consent, files, selfies, and verification claims remain excluded from browser drafts. Existing accounts and their evidence are preserved.

The production transaction path was checked with mocked transaction/session wiring, not by creating real accounts in the configured database. Standalone MongoDB deployments keep the prior recovery-based behavior. Live OCR, face-provider quality, remote storage availability, and deployed-service health require separate operational verification.
