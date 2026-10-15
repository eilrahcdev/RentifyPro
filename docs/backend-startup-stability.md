# Backend startup diagnostics and payment reconciliation

Implemented locally on 2026-10-15 after reviewing the supplied `npm run dev` output, project rules, existing payment/worker code, and regression tests. This work preserves the current application design, APIs, roles, registration drafts, verification gates, payment totals, manual payment authority, and unrelated uncommitted edits.

## Findings

The backend, chatbot, and private OCR service were running. The supplied log showed repeated Mongoose option warnings, ordinary chatbot startup messages reported as warnings, a brief MongoDB disconnect/reconnect, and three recurring payment reconciliation conflicts.

A read-only investigation found all three affected bookings completed and fully paid with zero remaining balance. Each still referenced a captured **test-mode** checkout absent from its recorded checkout history. The existing guard correctly refused to add a captured amount to an already settled balance. This establishes the conflict, but does not establish whether each capture was historically included in the recorded total or represents an additional payment requiring review.

The investigation used native MongoDB reads and PayMongo checkout GET requests. The diagnostic process replaced the payment service's write method with a throwing guard. A repeat check confirmed the same financial values after implementation. No booking balances, statuses, payment histories, checkout sessions, refunds, or database indexes were repaired or altered by the diagnostic scripts. Record-level evidence remains in the system temporary directory rather than this repository.

## Changes

- Payment conflicts retain the existing HTTP 409 and `BOOKING_PAYMENT_CHANGED` contract while gaining specific internal reasons: `BOOKING_STATUS_CHANGED`, `MANUAL_PAYMENT_CHANGED`, `CAPTURE_EXCEEDS_BALANCE`, `BOOKING_UNAVAILABLE`, and `CONCURRENT_PAYMENT_UPDATE`. Existing capture, currency, amount, ownership, revision, and duplicate-credit checks remain enforced.
- Reconciliation logs now include a safe reason, `manual_review` or `retry`, and the next retry time. Unchanged review cases retry after 15 minutes. Transient errors back off from one minute to a maximum of 15 minutes. A changed checkout, booking revision/status, or relevant financial snapshot bypasses the delay. Other bookings in the batch continue to reconcile.
- Retry state stays in a bounded, 1,000-entry process-local map. It clears on job stop and resets on process restart. The existing database scan and last-checked ordering remain in place, including advancing last-checked time for deferred cases so they cannot monopolize the oldest candidates. No schema migration, permanent exclusion, or automatic approval of historical payments was introduced.
- Replaced 35 deprecated `new: true` query options across 17 backend files with equivalent `returnDocument: "after"` options. Query filters, updates, upserts, sorting, validators, leases, and ownership checks are unchanged. Sixteen of those files were mechanically checked against the pre-change snapshot to confirm that the option replacement was their only change; the payment service also adds the conflict reasons above.
- Chatbot logging buffers complete lines and respects explicit Python/Uvicorn severity. Routine stderr `INFO` messages become informational; warnings, checkpoint notices, tracebacks, and failed exits remain visible at their proper severity. Clean exits are informational. Model weights, prompts, and classifiers are unchanged.
- MongoDB connection events now include timestamps and reconnect outage duration. Runtime error diagnostics preserve the error code/message/stack while redacting MongoDB credentials. Connection strings, retry budgets, timeouts, TLS behavior, and health checks are unchanged.

## Intentionally modified files

| File | Purpose |
| --- | --- |
| `backend/jobs/paymentReconciliation.job.js` | Distinguish review from retry, add bounded backoff and actionable diagnostics, and retain batch progress. |
| `backend/services/bookingPayment.service.js` | Add specific conflict reasons without changing payment guards; replace three deprecated query options. |
| `backend/utils/chatbotServiceManager.js` | Buffer log lines, classify severity accurately, and retain failed-process diagnostics. |
| `backend/config/db.js` | Timestamp connection transitions, measure downtime, and redact runtime connection errors. |
| `backend/jobs/kycDocumentProcessing.job.js` | Replace the deprecated option on the existing atomic document claim. |
| `backend/jobs/notificationDelivery.job.js` | Replace the deprecated option on the existing atomic email delivery claim. |
| `backend/services/kycReverification.service.js` | Replace the deprecated option on the existing version-checked verification update. |
| `backend/services/kycReview.service.js` | Replace deprecated options on existing summary and document decision updates. |
| `backend/services/manualKycComparison.service.js` | Replace the deprecated option on the existing guarded comparison update. |
| `backend/services/registrationFinalization.service.js` | Replace the deprecated option on the existing KYC case upsert. |
| `backend/services/vehiclePhoto.service.js` | Replace the deprecated option on the existing photo decision update. |
| `backend/controllers/auth.controller.js` | Replace deprecated options on existing registration, OTP, password, and owner-upgrade updates. |
| `backend/controllers/booking.controller.js` | Replace deprecated options on existing vehicle reservation and booking review updates. |
| `backend/controllers/chat.controller.js` | Replace deprecated options on existing conversation upserts. |
| `backend/controllers/kyc.controller.js` | Replace deprecated options on existing upload, face summary, and document pin updates. |
| `backend/controllers/notification.controller.js` | Replace deprecated options on existing notification archive/restore updates. |
| `backend/controllers/owner.controller.js` | Replace deprecated options on existing owner OTP and KYC updates. |
| `backend/controllers/ownerDashboard.controller.js` | Replace the deprecated option on the existing atomic owner payment correction. |
| `backend/controllers/registrationDraft.controller.js` | Replace deprecated options on existing OTP and revision-checked autosave updates. |
| `backend/controllers/vehiclePhoto.controller.js` | Replace deprecated options on existing upload/review decision updates. |
| `backend/tests/paymentSafety.test.js` | Add settled/corrected capture reasons, review/transient backoff, changed-state recovery, and batch isolation regressions. |
| `backend/tests/ownerManualPayment.test.js` | Retain the post-update document assertion using the supported Mongoose option. |
| `backend/tests/chatbotServiceLogging.test.js` | Verify partial-line buffering, genuine warning/error preservation, and exit severity. |
| `backend/tests/databaseConnectionLogging.test.js` | Verify disconnect duration, error codes, and credential redaction without a database connection. |
| `docs/backend-startup-stability.md` | Record scope, findings, changes, validation, and unresolved historical review. |

No frontend, `.env`, package manifest/lockfile, model schema, deployment configuration, or separate-admin checkout files were changed in this task. No package or model was upgraded or installed. Nothing was committed, pushed, merged, or deployed.

## Validation

- Targeted regressions failed before implementation for absent conflict reasons/backoff, mislabeled logs, and missing connection diagnostics. The corrected targeted suite passed.
- **504 JavaScript tests passed, 0 failed**: 483 across 44 explicit registration, OTP, verification, booking/payment, notification, camera/helper, storage, security, OCR compatibility, and diagnostics test files; another 21 across conversation archive, moderation, message validation, chatbot service security, and owner analytics tests. Providers, models, account writes, and SMTP are controlled fixtures in these tests. Unrestricted test discovery and real email scripts were not run.
- **14 Python OCR service tests passed**, including authentication, private/no-store responses, schema/layout compatibility, extraction limits, and CPU acceleration fallback.
- **Real isolated MongoDB check passed**: one concurrent capture is credited, stale payment saves are rejected, and one concurrent checkout lease is admitted. It used an owned MongoDB 8.2 instance bound to `127.0.0.1:27079` with a fresh temporary data directory, verified through its startup options. The existing check removed its generated fixture collection; application collections and Atlas were not used for fixture writes. This also exercises the updated payment queries through Mongoose and the real MongoDB driver.
- **Six real offline synthetic OCR extractions passed**: two PNGs and one PDF with one OpenMP thread, then the same workload with two. Both recovered the expected synthetic name/identifier and six text lines. This small comparison establishes compatibility for that workload, not a general performance benchmark or real-document authenticity. The existing two-thread setting and CPU model configuration were retained.
- **24 explicit backend JavaScript syntax checks passed**. The complete scoped diff was reviewed against a pre-change snapshot, and `git diff --check` passed with existing informational line-ending warnings.
- Final read-only local health checks returned HTTP 200 for the API with MongoDB connected, chatbot, and ready private OCR service. These checks establish responsiveness, not full production or payment-provider readiness.

Evidence in the system temporary directory: `rentify-startup-fix-regression.txt`, `rentify-startup-ocr-omp-1.json`, `rentify-startup-ocr-omp-2.json`, and `rentify-startup-readonly-payment-result.jsonl`. The pre-change snapshot and scoped diffs are in `rentify-startup-fix-ZGLzHM`.

## Expected output and remaining work

The deprecated Mongoose option warnings should disappear from the affected application queries. Routine chatbot startup lines should appear as INFO. A historical capture conflict remains explicit, for example `reason: CAPTURE_EXCEEDS_BALANCE`, `action: manual_review`, with `retryAt`; it is rechecked periodically and after relevant booking changes. It is not marked paid or reconciled merely to eliminate a warning. Backoff is per process and resets when nodemon restarts the backend.

The three historical test-mode records still need a reviewed association decision. Compare each capture with its historical receipts and owner settlement records. If evidence proves a capture was already included, prepare a separate backed-up, compare-and-set repair of the checkout history while preserving balances and settlement details. If it was an additional capture, use the applicable payment review/refund workflow. The current evidence does not justify automatically selecting either outcome, so no data repair was applied.

One MongoDB reconnect does not establish a network root cause. The new timestamp/duration diagnostics support comparison with Atlas events and local network behavior if it recurs; no speculative connection tuning was applied. A current healthy connection is not a guarantee against future interruptions.

Paddle's missing-ccache/native logging/threading notices and the transformer position-buffer checkpoint notice can still appear. Their authentic warnings were retained. OCR warmed up and completed the synthetic workload with both thread settings; no evidence justified changing the working models, dependencies, or OCR configuration to suppress those messages.

Local source changes require deployment before hosted application code changes. An already-running local backend can share its database/provider with the deployed project and may reload under nodemon. This task's active database/provider investigation was read-only; all mutation tests used controlled fixtures or the owned temporary MongoDB instance.
