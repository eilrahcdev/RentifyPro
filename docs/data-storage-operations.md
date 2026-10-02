# Data storage operations

The application now keeps public vehicle/avatar media separate from private KYC evidence. It does not delete historical files or database records during deployment.

## Retention defaults

| Data class | Hot retention | Action |
| --- | --- | --- |
| Face/temporary KYC file | 3 hours | private local cleanup in development; object-store lifecycle in production |
| Queued or pending-review KYC document | 72 hours | private review access only; delete after the review window |
| Biometric template | 24 hours | Mongo TTL; deleted immediately after a successful match |
| KYC status/case | policy-defined | retain only the application case, not the template |
| Vehicle/avatar media | until replacement/deletion | public immutable media; safely delete managed local keys only |
| Local audit logs | 30 days | redacted, non-blocking local logs; emit to managed logging in production |

Set the corresponding environment variables instead of changing source defaults. Confirm the KYC/legal retention policy with your privacy officer before increasing any period.

## Production requirements

- For a single backend instance, set `STORAGE_ROOT` to an encrypted persistent volume and confirm its mount with `STORAGE_DURABILITY_CONFIRMED=true`. Public `uploads/vehicles` and `uploads/avatars` stay separate from protected `private_uploads/kyc`, `private_uploads/reports`, and `private_uploads/vehicle-images`. Before scaling to multiple instances, implement private object storage (SSE-KMS, blocked public access, authenticated downloads) and shared retention jobs. See [production release checks](production-release-checks.md).
- Use a CDN only for transformed public vehicle/avatar media. Version object keys and use immutable cache headers.
- Run Redis for distributed rate limiting, short-lived response cache, token/session revocation TTLs, and single-execution job leases. Do not cache KYC, OTP, payment, or booking-truth responses.
- Enable Atlas automated backups/PITR, encrypt backups, maintain an off-account copy, and test restores at least quarterly.

## Notification policy and email

- In-app notifications are operational convenience records, never the source of truth for bookings or payments.
- Unread notifications remain active until they are read. Read notifications stay active for 30 days before being automatically archived; archived notifications are permanently deleted after 90 days. Configure `READ_NOTIFICATION_RETENTION_DAYS` and `NOTIFICATION_ARCHIVE_RETENTION_DAYS` if policy changes.
- Set `NOTIFICATION_EMAIL_ENABLED=true` only after SMTP is configured. Email is queued in MongoDB with retries, is sent for booking/payment/system events, and respects `email` plus `bookingUpdates` preferences. Chat stays in-app to avoid inbox spam.
- Notifications support per-item archive, restore, and permanent delete actions. Permanent deletion removes only the notification and its delivery record; it never changes booking, payment, vehicle, or message data. Use cursor pagination and the unread-count endpoint; do not infer unread counts from a truncated notification list.
- Before dropping an index, inspect `$indexStats`, hide it first, observe production workload, then use an explicit migration. Application startup never rebuilds unique indexes.

## One-time migration and cleanup

1. Verify a backup restore.
2. From `backend`, run `npm run db:migrate:kyc`; inspect the dry-run counts.
3. Run `npm run db:migrate:kyc -- --apply`; validate new `kyc_cases` and `biometric_templates` collections; retain the old collection until rollback window closes.
4. Do not bulk-delete existing `uploads/kyc` files automatically. Review their legal status and remove them through a documented, auditable disposal operation.
5. `.npm-cache` is now ignored, but already-tracked cache history requires a coordinated repository-history cleanup; do not attempt it on an active branch.
