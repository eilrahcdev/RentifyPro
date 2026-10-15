# Booking extensions and vehicle handover

New bookings explicitly use booking policy version 2. Existing bookings default to version 1 and keep their saved extension accounting. This release does not migrate active agreements or rewrite completed bookings.

## Extension accounting

The requested return time must be after both the current deadline and server time, within the existing six-month horizon, and pass vehicle and renter schedule checks. Approval rechecks the schedule. A pending request expires at its requested return time and grants no automatic permission to retain the vehicle.

For version 2, an approved extension starts at the later of the existing deadline and the server-recorded request time. The extension adds only that interval's normal vehicle and selected-driver charges. Earlier uncovered late periods remain in history and use the booking's saved grace period and penalty rate. An approved interval is never simultaneously billed as late time.

For example, a vehicle due at 16:00 with a request submitted at 18:00 for return at 18:30 has two hours of earlier late time (less saved grace) and 30 minutes of approved additional rental time. Approval at 18:15 authorizes the requested interval; it does not move the return deadline to 18:45.

Late charges remain estimates until the owner verifies physical handover. A saved zero penalty rate stays zero. No new transaction fee is added for an extension; version 2 uses its persisted booking fee.

## Return and verification

The renter may withdraw a pending extension or request return. A return request withdraws a pending extension under the same renter mutation lease used by owner approval. A renter may optionally report a handover timestamp; that claim does not complete the booking, stop charges authoritatively, or release the vehicle.

The owner confirms actual physical receipt and an ISO timestamp with timezone between pickup and current server time. Version 2 requires this explicit timestamp. The verified handover time is saved in `actualReturnAt`; app confirmation time remains in `returnConfirmedAt`. Final late fees end at verified handover, including earlier uncovered periods. Both parties see the history and timestamps and can report incorrect times or charges through the existing booking issue review flow.

Legacy API callers without a handover timestamp retain the version 1 confirmation-time fallback. Updated owner interfaces submit explicit handover times for both versions.

The vehicle remains unavailable after confirmed return under its existing inspection hold until the owner marks it rental-ready.

## Integrity and compatibility

Request, withdrawal, return review, and extension approval share the existing renter mutation lease. Booking workflow revisions reject stale lifecycle or workflow saves. Existing payment revision and manual-payment guards remain active. Optional `expectedRequestedAt` identifies the specific request shown by updated clients and rejects stale reviews.

The persisted rental total contains the original rental plus approved extension intervals. Final late penalties remain separate in `lateReturnPenaltyFee`. Recorded payments are preserved, and existing down-payment, PayMongo, walk-in, KYC, booking eligibility, and availability rules continue to apply.

Restart or redeploy the backend, frontend, and chatbot service to use the changed source. A separate review is needed before converting any existing active booking to version 2.

## Files changed for this implementation

Pre-existing uncommitted changes were preserved. Only the following files were intentionally edited or added for this task.

| File | Purpose |
| --- | --- |
| `backend/models/Booking.js` | Add policy version, original deadline, request history, reported handover, and guarded workflow revisions. |
| `backend/utils/lateReturnPolicy.js` | Share extension quotes, uncovered late-period calculation, expiry, history updates, and strict handover validation. |
| `backend/controllers/booking.controller.js` | Create version 2 bookings; validate, serialize, withdraw, and request return under renter leases. |
| `backend/controllers/ownerDashboard.controller.js` | Apply approved interval charges, retain earlier lateness, and finalize against verified handover. |
| `backend/jobs/bookingLifecycle.job.js` | Use the shared late calculation and expire pending requests. |
| `backend/routes/booking.routes.js` | Expose authenticated, participant-scoped extension withdrawal. |
| `backend/utils/bookingPayment.js` | Preserve version 2 transaction-fee snapshots, including zero. |
| `backend/services/bookingEligibility.service.js` | Load policy version for consistent fee calculations without changing eligibility rules. |
| `backend/controllers/report.controller.js` | Include return records in booking dispute review while preserving message-only chat reports. |
| `backend/handlers/notification.handlers.js` | Explain extension consequences and include distinct handover/confirmation timestamps. |
| `backend/services/notification.service.js` | Allow only the additional return timestamps through notification sanitization. |
| `frontend/src/pages/BookingsPage.jsx` | Offer on-time extension requests, separate estimates, withdrawal, return claims, and history/dispute access. |
| `frontend/src/owner/pages/Bookings.jsx` | Show retained late estimates/history and submit verified handover times. |
| `frontend/src/owner/pages/Dashboard.jsx` | Use accurate extension quotes and the same handover review as Booking Management. |
| `frontend/src/owner/components/ReturnReviewModal.jsx` | Collect actual handover and require explicit physical-receipt confirmation. |
| `frontend/src/components/BookingRequestModal.jsx` | Provide a responsive native dialog with keyboard focus, dismissal, loading, and error handling. |
| `frontend/src/components/BookingPolicyDetails.jsx` | Display approved intervals, return records, and the existing booking dispute action. |
| `frontend/src/components/NotificationDetailsModal.jsx` | Distinguish verified handover from app confirmation in notification details. |
| `frontend/src/utils/bookingPolicy.js` | Share renter/owner live estimates and extension previews. |
| `frontend/src/utils/api.js` | Send handover/request identifiers and support withdrawal. |
| `chatbot-service/rentifypro_chatbot_dataset_v6.json` | Explain the implemented policy and updated extension controls in supported languages. |
| `backend/data/chatbot/rentifypro_chatbot_dataset_v6.json` | Keep the backend chatbot copy identical to its source. |
| `backend/tests/bookingExtensionPolicy.test.js` | Regress charging, expiry, withdrawal, handover, concurrency, snapshots, and participant authorization. |
| `backend/tests/bookingPolicyPresentation.test.js` | Verify shared browser estimates and new/legacy preview behavior. |
| `backend/tests/notificationLateReturnData.test.js` | Verify the distinct return timestamps survive sanitization. |
| `backend/tests/reportRoutes.test.js` | Verify booking handover context and chat-report privacy. |
| `backend/tests/chatbotResponseQuality.test.js` | Check instructions against the implemented extension button label. |
| `backend/scripts/check-booking-mongo.js` | Verify real persistence and stale-write protection in a disposable loopback fixture database. |
| `scripts/booking-policy-browser-check.mjs` | Exercise renter/owner flows with intercepted APIs, keyboard interaction, and responsive measurements. |
| `docs/booking-extension-return-policy.md` | Record the policy, compatibility boundary, file purposes, and verification evidence. |

## Verification on 2026-10-13

- Backend: 627 tests passed, zero failures, using explicit `tests/*.test.js` discovery.
- MongoDB: seven integration scenarios passed in a newly created loopback fixture database, including persisted interval history, retained payments, stale lifecycle rejection, reservation safety, and inspection holds. The synthetic database was removed afterward; application databases were not used.
- Frontend: production build and focused ESLint passed.
- Browser: eight fixture checks passed with no runtime errors. Extension, renter return, and owner return forms were measured at 1440, 768, 390, and 320 pixels. Checked separate fee estimates, past-time rejection, submission, withdrawal, return during pending extension, physical-receipt validation, history/dispute access, Dashboard handover review, Tab containment, and Escape dismissal. API traffic was intercepted; these checks do not demonstrate live accounts, payments, notifications, or deployment.
- Visual review: desktop and mobile screenshots inspected; inputs remain readable and dialogs scroll internally while keeping actions visible. New button contrast was 6.70:1 and secondary/placeholder text contrast was 7.58:1 against white.
- Skills applied: Impeccable, UI/UX Pro Max, and Anti Slop during implementation. Existing RentifyPro design direction was retained: ENERGY 1, RHYTHM 1, MOTION 1. Form grouping supports the booking task; the single blue primary action and dialog elevation identify the decision being submitted. No visual assets or additional dependencies were introduced.
- Anti Slop delivery gate: hard requirements PASS (responsive fit, keyboard checks, measured contrast, working controls); purpose PASS (existing colors and dialog hierarchy); liveliness PASS (task-focused hierarchy within the established design); craftsmanship PASS (build, lint, complete fixture interactions, and source review).
- No commit, push, merge, deployment, production migration, or environment-variable edit was performed.
