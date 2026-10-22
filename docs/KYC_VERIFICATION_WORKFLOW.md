# KYC document verification workflow

RentifyPro treats Gemini as a screening assistant, not the source of truth. New ID and
owner-supporting documents are validated locally, stored outside public uploads, and
placed in MongoDB before an external request is attempted. One worker processes the
queue at a configurable rate. Quota and service failures retry with backoff and then
move to manual review; they never automatically reject an applicant.

## Status flow

`queued -> processing -> verified | pending_review | reupload_required`

Manual review can finish as `verified` or `rejected`. A correctable quality, unsupported
file, or exact-type problem uses `reupload_required` instead of permanently rejecting
the applicant.

Temporary provider errors use `retry_wait` before returning to `processing`. With the
default `KYC_ALLOW_RULE_BASED_AUTO_VERIFY=false`, every new document requires a Super
Admin decision even when all hard gates pass. The legacy
`KYC_ALLOW_GEMINI_AUTO_APPROVE` setting remains supported when the new setting is not
configured. Registration selfie capture unlocks only after the active ID has
`detailsMatched: true`; `queued`, `processing`, `retry_wait`, mismatch, and rejected
IDs cannot enter selfie verification. A matched ID may continue to the selfie while
its authenticity review remains `pending_review`. A successful selfie produces
`challenge_passed`, and the user becomes `approved` only after the ID is approved.

## Document photos during registration

Renter IDs, owner IDs and owner business documents offer **Take photo** alongside
file upload. The document camera prefers the rear camera, keeps text unmirrored,
and presents **Use photo**, **Retake** and **Cancel** before changing the selected
file. A confirmed photo uses the existing document-selection validation and is not
uploaded until the existing **Upload and check** action. Permission failures and
cancellation preserve the previous selection. Camera tracks stop after capture,
on backgrounding and on close; late permission results are stopped too.

ID photos accept JPG/PNG up to 5 MiB. Business documents accept JPG/PNG/PDF up to
5 MiB, with the existing five-page PDF limit. Captures stay in temporary UI state
and do not enter browser draft storage. ID replacement still invalidates the
previous selfie; business-document replacement retains the unaffected ID/selfie.
The selfie image limit remains 4 MiB.

Release the frontend, Node backend and private OCR service together. Change any
explicit `KYC_DOC_MAX_BYTES=4194304` deployment setting to `5242880`, keep
`KYC_JSON_BODY_LIMIT=8mb`, and retain the separate selfie `KYC_IMAGE_MAX_BYTES`.
The private OCR request limit is 8 MiB because Base64 increases payload size.
Synchronize the private reader used by the admin backend too; a stale 4 MiB reader
would reject otherwise valid documents during recovery or manual review.

Camera behavior requires checks on physical Android Chrome and iPhone Safari over
HTTPS. Synthetic browser tests cover state transitions and cleanup, not physical
rear-camera selection, autofocus, or real-document accuracy.

Implementation files for this change:

- `frontend/src/components/DocumentCapture.jsx` owns document camera lifecycle,
  temporary preview, confirmation and accessible dismissal. `RegisterPage.jsx` and
  `pages/RegisterOwnerPage.jsx` connect it to their existing selection handlers.
- `frontend/src/utils/fileValidation.js` changes document size checks;
  `components/BecomeVehicleOwner.jsx` and `verification/VerificationStepper.jsx`
  keep labels aligned with those shared checks.
- `backend/controllers/kyc.controller.js` separates document and selfie limits;
  `services/geminiDocument.service.js` measures decoded bytes at the boundary;
  `services/privateKycReviewContext.js` accepts bounded 5 MiB private evidence while
  preserving path/hash checks. The admin checkout's copy of that reader is kept
  identical at `backend/data/private-kyc/services/privateKycReviewContext.js`.
- `kyc-ocr-service/main.py` updates file/request ceilings. `backend/.env.example`,
  `backend/ENVIRONMENT.md` and `kyc-ocr-service/README.md` document the matching
  settings and service limits.
- `backend/tests/registrationDraft.test.js`,
  `backend/tests/documentUploadLimits.test.js`,
  `kyc-ocr-service/tests/test_service.py`,
  `scripts/document-upload-limits.test.mjs` and
  `scripts/private-document-checker-browser-check.mjs` cover boundaries, private
  recovery, unchanged selfie limits, capture-to-request encoding and simulated
  camera behavior.

## Saved-progress recovery and cancelling document checks

**Recover saved progress** loads the backend's saved version without replaying
conflicting pending edits. A failed recovery keeps the local pending cache until
the backend confirms recovery. Going online does not discard conflicted edits.
Autosaving pauses while registration verification is busy; required saves before
uploads and submission still run. An active evidence lease has a separate
`REGISTRATION_BUSY` response instead of claiming another tab changed the draft.

Renter IDs, owner IDs and owner business documents have a secondary **Cancel
upload** / **Cancel check** button immediately left of the upload action. Controls
wrap their text within a two-column row and retain a minimum 44-pixel touch target.
The existing typography, blue primary action and neutral secondary action are
preserved. The active action row scrolls clear of the mobile footer when needed;
only the document being uploaded shows upload progress. Other form controls remain locked during an upload. Successful
cancellation returns focus to the upload action and keeps entered details and the
selected local file. Cancellation failures show an error without claiming success.

`POST /api/kyc/pre/documents/:docType/prepare` reserves an upload attempt before
sending file bytes. The reservation does not replace a current valid document.
Uploads include the optional `upload_attempt_id`; existing clients retain their
API contract. `POST /api/kyc/pre/documents/:docType/cancel` requires the current
attempt or saved document revision. Both routes enforce the signed registration
session, verified email, role, draft ownership and independent control rate limits.
The existing upload/verification rate limits remain unchanged.

Cancellation atomically marks the attempt on its own document. A matching saved
revision becomes `reupload_required` with `DOCUMENT_CHECK_CANCELLED`, a new review
version and cleared verification results. The private file remains available for
retry under the existing retention rules. The cancelled upload cannot commit
later; queued work cannot claim it and existing workers cannot overwrite its new
status/version. Only that attempt's evidence lease can be released. Cancelling a
business document preserves the independent ID/selfie. Created accounts, other
registrations and completed manual decisions cannot be cancelled through this API.

An OCR/native inference call already running may finish computing. Its cancelled
result is not accepted; cancellation does not promise to stop native computation
immediately. Frontend and Node backend changes must be released together. No OCR
service or production-setting changes are needed for cancellation itself.

Implementation files:

- `hooks/useRegistrationDraft.js` and `components/RegistrationDraftNotice.jsx`
  handle recovery state, pending edits and the busy message.
- `hooks/useRegistrationDocumentUpload.js`,
  `components/RegistrationDocumentActions.jsx`, `utils/kycApi.js`,
  `components/RegisterPage.jsx` and `pages/RegisterOwnerPage.jsx` connect attempt
  preparation, abortable requests, cancellation feedback and responsive controls.
- `controllers/registrationDocument.controller.js`, `controllers/kyc.controller.js`,
  `controllers/registrationDraft.controller.js` and `routes/kyc.routes.js` enforce
  attempt ownership, atomic cancellation, guarded upload commits and busy saves.
- `models/PreKycDocument.js`, `models/RegistrationDraft.js`,
  `middleware/registrationEvidence.middleware.js` and
  `middleware/security.middleware.js` store additive attempt metadata, release only
  the matching lease and rate-limit document controls independently.
- `backend/tests/registrationDocumentCancellation.test.js`,
  `backend/tests/registrationEvidence.test.js`, `backend/tests/geminiDocumentProcessing.test.js` and
  `scripts/registration-recovery-browser-check.mjs --document-cancel-only` cover
  ownership, Mongoose pipeline compatibility, late results, recovery, keyboard
  controls, cancellation failures, retries and simulated responsive behavior.

## Selfie capture and liveness boundary

Renter registration, owner registration, and logged-in account verification use the
same `SelfieCapture` interface. The camera starts only after the user chooses
**Open camera**, stops immediately after capture, and the captured image is sent to
the matching endpoint only after **Use selfie and continue** is selected. Customer
screens show a plain match result and do not expose provider confidence scores.

The portrait guide helps the user position their face; it is not liveness or
anti-spoofing verification. The current single-image face match must not be described
as proof that a live person was present. If stronger spoof protection becomes a
requirement, use a dedicated liveness provider with a server-verified challenge and
persist only the provider decision and audit metadata needed by the KYC policy. A
provider should not be enabled until its consent copy, retention policy, failure
handling, credentials, and sandbox-to-production verification are configured.

## Ordered document gates

The worker uses one Gemini inspection per upload, then applies deterministic backend
rules in this order:

1. Image readability.
2. Independent recognition as a supported government or registration document.
3. Exact detected type versus the type selected by the applicant.
4. Type-specific layout and structural features.
5. Required field extraction and expiration.
6. Registration-data comparison.
7. Final verification, manual review, or re-upload status.

The selected type is validated by the server but is deliberately not included in the
Gemini prompt. The model may return `UNKNOWN`; matching personal information cannot
bypass an earlier recognition, type, or structure failure. This remains visual
screening, not government-issuer or database authentication.

For renter IDs, automatic identity comparison requires complete first-name and
surname token matches plus an exact registration birth date. Substring-only name
matches are not accepted. A name or birth-date conflict becomes
`reupload_required` with `IDENTITY_DATA_MISMATCH`; it cannot be approved through the
ordinary administrator decision action. Owner registration currently retains its
existing name-only comparison because that form does not collect a birth date.

Administrators can decide a document only after screening reaches `pending_review`.
Queued, processing, and retrying uploads are view-only. An ID can be approved only
when the server recorded `detailsMatched: true`; final registration and authenticated
KYC reconciliation enforce the same invariant even if a record is altered outside
the normal review route. Final registration also compares the submitted name and,
for renters, birth date with the profile snapshot used during ID screening so a
verified result cannot be reused after changing personal details.

## Compatibility and data safety

- No migration rewrites users or KYC cases. Existing users with `kycStatus: approved`
  remain approved.
- The new queue states are additions to `PreKycDocument`; legacy `verified`,
  `pending_review`, and `rejected` records remain valid.
- Do not delete or reseed the shared database before testing. Test with a new email and
  leave existing approved accounts in place as a regression check.
- Evidence is private and served only through an authenticated admin endpoint with
  `Cache-Control: private, no-store`. Database records store an object key and checksum,
  not a public URL.

## Free-tier operation

The default vision model is `gemini-3.5-flash-lite`, overridable with
`GEMINI_VISION_MODEL`. One document request has a 30-second timeout, configurable with
`KYC_GEMINI_REQUEST_TIMEOUT_MS`. Timeouts, rate limits, and temporary provider outages
retain bounded retries. Model-access, authentication, and other non-retryable provider
errors go directly to `pending_review`; they do not require a new upload. Missing
credentials or unconfirmed production data handling also go directly to manual review.
The timeout applies to one provider attempt, not the entire review or final approval.
After the service is restored, explicitly re-uploading the same file requeues an
`AUTOMATED_SCREENING_UNAVAILABLE` result. Completed screening and approvals continue
to be reused when the file, session, type, and profile match.

Start conservatively with four Gemini requests per minute and three attempts. The
queue continues accepting uploads when the provider is rate-limited, so user traffic
does not create a burst of parallel Gemini calls. Queued, processing, and retrying
documents remain view-only; administrator decisions unlock at `pending_review`.

The upload path wakes the existing queue worker immediately instead of waiting for
the next scheduled poll. During active screening, registration polls the database-only
status endpoint more frequently and slows down for retry or manual-review states. These
status checks do not send the document to Gemini again.

For multi-instance production, replace local evidence storage with private encrypted
object storage and use a distributed queue/lease (for example, a managed queue and
Redis lock). Configure provider billing alerts and daily usage alerts. Do not increase
rate limits until measured quota and load tests support it.

## Operational checks

1. Confirm the Super Admin **Documents** page can preview, approve, and reject evidence.
2. Confirm an unavailable Gemini API ends in manual review, not rejection.
3. Confirm a selfie pass alone leaves the account pending.
4. Confirm the selfie step stays locked while ID details are unknown or mismatched and
   unlocks automatically after `detailsMatched: true` is stored.
5. Confirm approval records the reviewer, timestamp, reason, and audit event.
6. Confirm expired private evidence is removed according to the retention policy while
   the minimal KYC decision record remains.
7. Confirm a wrong document type and plain paper with matching personal data both stop
   before registration-data comparison.
