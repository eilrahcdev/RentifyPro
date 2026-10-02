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
