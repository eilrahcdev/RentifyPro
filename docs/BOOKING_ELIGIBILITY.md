# Booking eligibility and renter limits

RentifyPro checks eligibility on the server before reserving a vehicle. The
vehicle detail page also previews the result for the signed-in renter and links
to their bookings when something needs attention.

## Rules

- At most **3 open bookings** per renter across all owners and vehicles. Open
  means `pending`, `confirmed`, or `extended`.
- At most **2 pending requests**, included within those 3 open bookings.
- Open booking schedules must not overlap. This includes pending requests and
  rentals with drivers. Adjacent schedules (one ends exactly when another starts)
  are allowed. Returned vehicles do not create schedule conflicts.
- A confirmed/extended rental past its return time plus its snapshotted grace
  period blocks new bookings until the owner confirms the return or approves a
  valid extension. The check uses the clock, not a possibly stale overdue flag.
- An unpaid balance on a returned/completed rental, or a confirmed/extended rental
  past its scheduled return time, blocks new bookings. This includes finalized
  late-return penalties. Remaining amounts reuse the checkout calculation.
- Ordinary unpaid pending requests and current/upcoming partial payments do not
  create debt restrictions. They still count toward booking limits.
- Walk-in approval and payment initiation do not count as received payment.
  Confirmed settlement restores eligibility automatically if all other checks pass.
- Cancelled/rejected bookings do not count toward limits or outstanding rental
  balances. Completed refunded bookings do not create debt restrictions.

The existing agreement allows payment during the rental or walk-in settlement
at return. This change preserves that deadline; it does not introduce payment
before pickup. Vehicle-return grace does not extend the rental payment deadline.
There is no monthly or lifetime rental cap.

Existing reservations are not automatically cancelled, even if an account already
exceeds these limits. Payment, return, cancellation, support, and extension-request
flows stay accessible. Extensions are checked for renter schedule conflicts both
when requested and when approved. Owner confirmation also checks conflicts, which
protects older pending bookings made before these rules existed.

## API and concurrency

`GET /api/bookings/eligibility` requires authentication and returns only the
current account's eligibility. Optional `pickupAt` and `returnAt` query parameters
add a schedule check. The response is not cached:

```json
{
  "success": true,
  "eligibility": {
    "eligible": true,
    "limits": { "open": 3, "pending": 2, "simultaneous": 1 },
    "counts": { "open": 1, "pending": 0 },
    "reasons": []
  }
}
```

Creation rechecks fresh data under a per-renter MongoDB lease shared with extension
review. A rejected creation returns HTTP 409 with `code`, `message`, and
`eligibility`; no vehicle is reserved. Concurrent updates return
`BOOKING_UPDATE_IN_PROGRESS` and can be retried. The lease is token-scoped, renewed
before writing, released in `finally`, and expires after two minutes if a server
crashes. It works on standalone MongoDB as well as replica sets; no transaction
configuration or data migration is required.

Policy reason codes: `OVERDUE_VEHICLE_RETURN`, `OVERDUE_BOOKING_BALANCE`,
`UNPAID_LATE_RETURN_PENALTY`, `OPEN_BOOKING_LIMIT`, `PENDING_BOOKING_LIMIT`, and
`RENTER_SCHEDULE_CONFLICT`.

The preflight is advisory. The submit endpoint remains authoritative when dates,
payment state, or other bookings change. An eligibility-service failure does not
allow creation to bypass validation. Restrictions are computed, not saved as
permanent suspensions. There is no new penalty-waiver or admin-override workflow.

## Verification

- `cd backend; npm test`: includes eligibility boundaries, payment/return states,
  direct POST rejection, concurrent requests using mocked database operations,
  lease cleanup, and extension conflict checks.
- `cd frontend; npm run lint` and `npm run build`.
- `scripts/booking-eligibility-browser-check.mjs`: fixture-only browser checks of
  preflight messages, API denials, retry, date changes, booking navigation, and
  responsive layouts. It does not create real rentals or verify live payments.
