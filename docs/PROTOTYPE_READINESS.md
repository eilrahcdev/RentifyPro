# Prototype readiness

## Official terms

Use these eight core terms consistently in renter, vehicle owner, and admin views.

| Term | Meaning |
| --- | --- |
| Renter | Person renting a vehicle. |
| Vehicle Owner | Person managing a listed vehicle. Legacy API role `owner` and admin `Operator` remain compatible. |
| Booking | A rental request and its resulting record. |
| Pending | Waiting for the vehicle owner's decision. |
| Confirmed | The vehicle owner accepted the booking. Payment is tracked separately. |
| Completed | The vehicle owner confirmed physical receipt of the returned vehicle. An outstanding balance may remain. |
| Cancelled | Booking ended through cancellation. |
| Rejected | The vehicle owner declined the booking request. Do not replace this with Cancelled. |

`Extended` remains a booking status. `Active` and `Overdue` describe its operational condition.
Document decisions use `Approved` and `Rejected`; document progress uses `Queued`,
`Screening`, `Retrying`, and `Pending Review`. Face verification alone is not identity approval.

## Implemented behavior

- Both document review endpoints call `reviewKycDocument`. Rejection requires correction instructions.
- Logged-in KYC reconciles document approval, the completed face check, and the user's access summary.
  Either completion order works. A pending summary write is repaired by repeating the decision or refreshing KYC status.
- A changed document version or opposing final decision requires a fresh review.
- Screening results and failures are conditional on the claimed file and processing lock, so an old worker cannot overwrite a manual decision or replacement file.
- Renter and owner bookings show loading, refresh, failure, retry, and genuine empty states.
- Owner booking actions show progress and block competing clicks. Initial booking decisions also use a conditional backend update.
- Rejected bookings retain their status and offer renter recovery guidance.
- Registration shows review status, correction instructions, refresh, and document resubmission while preserving entered details.
- Report information requests specify what is needed; duplicate report errors link to Reports.
- Payment verification retains the checkout reference while its result is uncertain. A previous partial payment is not treated as proof that a second payment succeeded.
- App navigation preserves the payment provider's return parameters until the booking page has consumed them.

## Repeatable checks

Run `npm test` in `backend`, then `npm run lint` and `npm run build` in `frontend`.
The backend tests include the actual admin Documents handler with isolated model stubs,
approval ordering, rejection guidance, interrupted writes, stale documents, conflicting
booking decisions, screening races, and terminology.

For browser checks, run the frontend preview on port 4175 and an isolated headless
Chrome with remote debugging on port 9235. Then run from the repository root:

```powershell
node --experimental-websocket scripts/readiness-browser-check.mjs
```

This script intercepts all API traffic and uses fixture accounts and bookings. It checks
renter and owner loading/error/retry states, approval controls, rejected status, a mobile
viewport, pending-payment recovery, vehicle search retry, and admin rejection instructions.
It does not create real accounts, submit real documents, or charge a payment method.

## Live acceptance walkthrough

Use test accounts and the payment provider's test mode to verify external integration:

1. Register a renter, submit ID and selfie, approve the document, verify email OTP, and sign in.
2. Repeat with document approval before selfie verification; reject and correct another submission.
3. Submit a valid booking, approve it as the vehicle owner, complete payment, request return,
   confirm receipt as the owner, and submit a review as the renter.
4. Submit a report, request specific information as admin, supply it as the reporter,
   and issue the appropriate decision. Verify the affected user's appeal path where available.
5. Interrupt a request, restore connectivity, and retry. Confirm filters and entered values remain usable.

Production email, face screening, provider checkout, and real database persistence require
this live walkthrough; passing fixture checks does not establish that external services are available.
