# Registration draft persistence

The renter and owner wizards now recover ordinary form data and the last valid step from a private backend draft. Recovery checks browser ownership, role, draft expiration, document integrity, the profile used for screening, and current selfie verification. Passwords and consent remain in page memory and must be entered again after reload.

The follow-up integrates email OTP into Step 4, persists the current valid verification phase, and permits Step 5 account creation while documents await admin approval. See [registration-email-workflow.md](registration-email-workflow.md) for the current workflow, additional changed files, updated validation results, and remaining limits. The validation counts below describe the original persistence implementation.

## Behavior and security

- Each role has a separate random HttpOnly cookie. MongoDB stores its SHA-256 digest, not the cookie value. An email alone cannot recover a draft.
- Draft endpoints require a custom header, apply the existing origin policy, return `private, no-store`, and have an IP rate limit. Existing authentication, upload limits, document review, registration validation, and OTP requirements remain in place.
- Saving is debounced and serialized, with revision checks to prevent an older tab from overwriting a newer save. Progress shows as saved only after a valid backend acknowledgement.
- A password-free session buffer covers edits made before autosave completes or during a network failure. Its fields and requested step are submitted to the owned backend draft before recovery; it never supplies document or selfie approval.
- Successfully stored IDs and supporting documents remain in the existing private KYC directory. References and statuses are recovered without putting document bytes or private file paths in browser storage. Corrected profile details can rescreen a saved reference.
- Selfie results are recorded with an atomic update of the matching document revision. Replacing or rescreening a document invalidates its previous result. Expired, rejected, missing, unbound legacy, or profile-mismatched evidence cannot restore completed verification.
- Duplicate uploads discard their unused private file; replacement and failed database writes clean up unused files. The existing retention job preserves active references and eventually removes files left by interrupted processes. Cleanup retains a file if the database cannot establish whether it is referenced.
- Draft access expires after 60 minutes of inactivity, with an absolute limit of up to 72 hours, capped by a shorter configured pre-KYC renewal policy. Backend checks enforce expiration independently of MongoDB TTL cleanup. Document and selfie expiration continue to use existing KYC settings.
- Start over clears the owned draft and its unsubmitted evidence. Successful registration links current private evidence to its account, including documents awaiting review. Completed drafts are cleared after acknowledgement or recovered completion.

## Files changed

| File | Purpose |
| --- | --- |
| `backend/models/RegistrationDraft.js` | Durable cookie-owned draft, revisions, and expiration indexes. |
| `backend/controllers/registrationDraft.controller.js` | Ownership, save/recovery/delete endpoints, backend recovery validation, and safe public responses. |
| `backend/utils/registrationDraft.js` | Password-free field allowlist, draft/session validity, profile matching, and step completeness. |
| `backend/routes/kyc.routes.js` | Wire protected, rate-limited draft endpoints into the existing KYC router. |
| `backend/utils/preKycSession.js` | Carry the draft binding through signed session issuance and renewal. |
| `backend/middleware/preKycSession.middleware.js` | Refuse expired, deleted, or changed draft-bound upload/verification sessions. |
| `backend/middleware/validate.middleware.js` | Export existing email/date/age validators for reuse without changing their behavior. |
| `backend/models/PreKycDocument.js` | Store atomic, document-version-bound selfie results. |
| `backend/models/PreKycFace.js` | Bind compatible face summaries to document hashes and revisions. |
| `backend/utils/preKycFace.js` | Validate the current document's durable selfie result and reject stale summaries. |
| `backend/utils/preKycDocs.js` | Exclude expired approvals from document eligibility. |
| `backend/controllers/kyc.controller.js` | Resume private references, avoid duplicate/orphaned files, isolate biometric keys by revision, and reject delayed stale results. |
| `backend/controllers/auth.controller.js` | Validate the complete email-verified draft and create/finalize its account while documents await review. |
| `backend/jobs/kycFileCleanup.job.js` | Purge expired drafts, preserve referenced evidence, and discard unused uploads. |
| `backend/scripts/migrate-registration-drafts.js` | Provide an additive index migration with a read-only default. |
| `frontend/src/hooks/useRegistrationDraft.js` | Backend recovery/autosave, serialized writes, pending-save replay, retries, expiration, and memory-only passwords. |
| `frontend/src/utils/registrationDraftApi.js` | Credentialed, bounded draft requests and acknowledgement validation. |
| `frontend/src/utils/registrationDraft.js` | Reuse safe tab storage for pending fields and legacy migration; exclude passwords and verification claims. |
| `frontend/src/utils/kycApi.js` | Restore the signed session and rescreen a saved document revision. |
| `frontend/src/components/RegisterPage.jsx` | Restore renter progress, private uploads, and selfies; request the lost password at review. |
| `frontend/src/pages/RegisterOwnerPage.jsx` | Restore owner progress and both private document types, including BIR details. |
| `frontend/src/components/RegistrationDraftNotice.jsx` | Accurate loading, pending, saved, conflict, unavailable, and expired notices with recovery actions. |
| `frontend/src/components/PreKycReviewNotice.jsx` | Synchronize selfie state with the current backend document result. |
| `backend/tests/registrationDraft.test.js` | Draft ownership, HTTP cookies/cache/expiry, completeness, stale writes, file cleanup, and selfie binding/races. |
| `backend/tests/privateKyc.test.js` | Extend existing private KYC fixtures/assertions for document-bound selfie results and private-file recovery. Existing unrelated worktree edits are preserved. |
| `backend/tests/geminiManualReview.test.js` | Keep existing manual review regression fixtures accurate for unused-file cleanup. |
| `scripts/registration-draft.test.mjs` | Verify the pending buffer excludes passwords, files, consent, and verification claims. |
| `scripts/registration-recovery-browser-check.mjs` | Exercise both roles, every wizard step, responsive refresh recovery, and network/interruption states using synthetic APIs. |
| `docs/registration-persistence.md` | Record behavior, changed files, checks, setup, and limitations. |

## Validation

The focused suite covers registration drafts, email validation, signed pre-KYC sessions, document/selfie gates, private OCR/manual review, existing authenticated KYC and reverification, and camera helpers. Browser coverage uses an isolated headless Chrome with synthetic API, address, and verification responses. It creates no real accounts or identity documents.

Verified results: 117 focused regression tests pass. The complete browser suite passes 52 checks, including 40 refresh cases across both roles, every step, and four viewport widths. An additional mobile run passes 12 interruption/recovery checks with a synthetic camera stream. Focused ESLint, the frontend production build, JavaScript syntax checks, and the scoped Git whitespace check pass.

UI verification: PASS for responsive reflow (320-1200px DOM overflow checks and desktop/mobile screenshots); PASS for functional recovery controls (save, retry, conflict recovery, and confirmed restart exercised); PASS for accurate notices (malformed and failed responses never show saved); PASS for consistency (existing typography, palette, wizard navigation, and shared controls retained, with no decorative assets or new motion). These checks apply to the modified registration surfaces, not an accessibility certification of the whole application.

Run the regression suite from the repository root:

```powershell
node --test backend/tests/registrationDraft.test.js backend/tests/privateKyc.test.js backend/tests/geminiManualReview.test.js backend/tests/preKycSession.test.js backend/tests/preKycDocumentGate.test.js backend/tests/preKycSelfieGate.test.js backend/tests/kycRoutes.test.js backend/tests/registrationEmail.test.js backend/tests/kycReview.test.js backend/tests/kycReverification.test.js backend/tests/kycQueueCompatibility.test.js backend/tests/kycSummary.test.js scripts/registration-draft.test.mjs frontend/tests/cameraKyc.test.mjs
```

With Vite on `127.0.0.1:4176` and an isolated Chrome CDP instance on port `9236`:

```powershell
node --experimental-websocket scripts/registration-recovery-browser-check.mjs
node --experimental-websocket scripts/registration-recovery-browser-check.mjs --edges-only --mobile
```

The browser matrix checks all five steps for both roles at 320, 390, 768, and 1200 pixels. Additional checks cover private business documents, immediate refresh before debounce, refresh during a network save failure, stale tabs, expiration/start over, missing evidence, interrupted upload responses, and passwords being absent from storage and after reload.

## Setup and remaining limitations

Restart the backend and serve the rebuilt frontend to use the new endpoints. Add the non-destructive draft indexes when preparing the target database; from `backend`, inspect with `node scripts/migrate-registration-drafts.js`, then explicitly apply with `node scripts/migrate-registration-drafts.js --apply`. This work does not apply that migration to the shared database or deploy changes. Request-time expiry and the existing cleanup job enforce expiry even before the TTL index is installed.

- Recovery belongs to the same browser profile and its cookies. It does not recover on another device or after cookies are cleared. Browsers that block the credentialed cookie show a recovery failure rather than claiming progress was saved.
- Confirmed backend progress survives tab closure. Unsaved edits buffered only in session storage cannot be guaranteed after closing the tab, forcibly terminating the browser, or disabling storage.
- Live database collection counts and indexes were inspected read-only. New draft writes and race cases were tested with model fixtures and an actual Express HTTP server, not against shared MongoDB data.
- Live OCR/face matching, real document authenticity, physical Android/iOS devices, Safari cookie behavior, and deployment/storage durability were not validated by the browser fixtures.
- Legacy drafts migrate their allowlisted ordinary fields. When the browser still holds the corresponding signed pre-KYC session, its available private uploads are adopted without reupload. An old selfie result without a provable document-version binding must be repeated.
- Private evidence left after an abrupt process crash remains subject to the existing bounded retention cleanup. Filesystem cleanup requires the configured private storage and database to be available.

No application dependencies were added. No `.env` values were printed or edited. No commit, push, merge, or deployment was performed.
