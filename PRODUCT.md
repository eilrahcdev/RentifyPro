# RentifyPro Admin

## Purpose and users

RentifyPro Admin is the web administration surface for the RentifyPro vehicle-rental platform. The current implementation serves a system/Super Admin managing rental operations, customers, verification evidence, moderation, and account security. This describes repository evidence, not a new feature specification.

## Existing workflows

- Overview: dashboard metrics and operational activity.
- Operations: booking monitoring and transaction records.
- Fleet: vehicle records and availability information.
- Customers: renter/operator records and verification-document review.
- Governance: user reports, audit logs, passkey settings, and active admin sessions.
- Authentication: account sign-in, configured secret passkey or email verification, password recovery, and sign-out.

The interface supports operational decisions using actual records. Reviews should prioritize clear status, readable data, usable filters, understandable validation, and explicit consequences for sensitive actions. Do not invent metrics, claims, transactions, or customer evidence.

## Stack and boundaries

Platform: web. The root npm workspace contains a React 19/Vite 7 frontend using Tailwind CSS 3, Lucide icons, and Recharts; the backend uses Node, Express 5, Mongoose/MongoDB, and Socket.IO. Shared admin API contract code lives in `shared/adminApiContract.js`.

The admin dashboard uses the same MongoDB data as the main RentifyPro website. Authenticated vehicle and KYC upload previews can depend on the website backend's upload directory. Preserve data compatibility and existing integration behavior.

Sensitive customer changes use reason/password confirmation and audit records. Session management, password/passkey hashing, email verification, account restrictions, document decisions, and privacy-preserving archives are existing behavior, not design cleanup opportunities.

## Constraints and voice

`Rules.md` governs all changes. Preserve routes, permissions, API contracts, security, database behavior, and rental/payment rules. Keep frontend work scoped to the requested surface and avoid affecting renter or vehicle-owner experiences through shared changes.

Use clear operational language and existing domain terminology. Preserve factual copy and distinctions among customers, renters, owners/operators, vehicles, bookings, documents, transactions, reports, and security events. Keep loading, empty, error, and authorization states meaningful.

Preserve the visual identity documented in `DESIGN.md`. The current task only installs manual review skills; no redesign or automatic remediation is authorized.

## Evidence and unknowns

Sources: `README.md`, `Rules.md`, workspace package manifests, `frontend/AdminAccountPage.jsx`, `frontend/src/admin/AdminApp.jsx`, and `frontend/src/admin/components/AdminShell.jsx`.

This document is based on source inspection, not a live deployment or user study. Production deployment details, usage volumes, business targets, and a formal accessibility conformance level have not been established here.
