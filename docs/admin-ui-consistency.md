# Admin UI consistency

The authenticated admin screens keep the existing Manrope font, RentifyPro blue, slate surfaces, Lucide icons, navigation, and data contracts. This pass standardizes their presentation and interactions.

## Design decisions

- Direction: a calm operational console for administrators, ENERGY 1 / RHYTHM 1 / MOTION 1; preserve the current identity and information architecture.
- Typography: 14px controls, 12px labels and supporting text, 18px section headings, and 28px numeric metrics establish a readable hierarchy. Narrow-screen form controls use 16px text. Existing font assets remain unchanged.
- Color: the existing darker blue `#045fc3` supports white button text at 6.12:1 contrast; green, amber, and rose retain their existing status meanings. Categorical charts retain their data-series colors.
- Spacing: 16px panel padding on narrow screens and 20px on wider screens keeps related content together; existing page-level 16/24/28px gutters remain.
- Shape: 12px control radii and 16px panel/dialog radii distinguish controls from containers.
- Icons: action icons use an 18px box and a consistent stroke; the existing Lucide set keeps navigation meanings familiar.
- Elevation: routine cards use borders; modal and popup shadows identify content above the page.
- Interaction: controls have a minimum 44px height, icon-only actions have a minimum 44px width, and keyboard focus has a solid blue outline.

## Changes

- Scoped shared styles to `.admin-ui`, including portaled menus, dialogs, and notifications.
- Standardized metric-card labels and values, analytics-panel spacing, table headings, form controls, action icons, and refresh controls.
- Adjusted the audit filter row to wrap at tablet widths. Existing table scroll regions remain contained and major record tables can receive keyboard focus.
- Used one modal shell for confirmations, customer editing/profiles, booking/vehicle/file previews, document reviews, report reviews/decisions, and sign-out.
- Modal behavior includes background inactivity, scroll locking, initial focus, Tab wrapping, Escape/backdrop dismissal, focus restoration, and protection while a request is pending. Nested dialogs keep only the top dialog active.
- Customer editing and report decisions keep their actions reachable on short screens. Report dialogs use the same light header and panel treatment as the other dialogs.
- The mobile drawer marks its expanded state, isolates the page behind it, traps focus, and shares scroll locking with dialogs.
- Floating notifications distinguish success and error. Success notifications last six seconds; errors stay until dismissed or superseded. Both support manual dismissal and screen-reader announcements. Security-page inline feedback uses the same visual treatment.
- Customer action menus support arrow keys, Home/End, Escape, and focus restoration. Moderation outcome choices are a keyboard-operable radio group with a visible focus treatment.

## Files changed in this UI pass

New files:

- `frontend/src/admin/admin-ui.css`
- `frontend/src/admin/components/AdminModal.jsx`
- `frontend/src/components/useScrollLock.js`
- `scripts/admin-ui-browser-check.mjs`
- `docs/admin-ui-consistency.md`

Updated files:

- `frontend/AdminAccountPage.jsx`
- `frontend/src/index.css`
- `frontend/src/admin/components/AdminAnalytics.jsx`
- `frontend/src/admin/components/AdminSelect.jsx`
- `frontend/src/admin/components/AdminShell.jsx`
- `frontend/src/admin/components/AdminUI.jsx`
- `frontend/src/admin/pages/AuditLogsView.jsx`
- `frontend/src/admin/pages/BookingsView.jsx`
- `frontend/src/admin/pages/CustomersView.jsx`
- `frontend/src/admin/pages/DashboardView.jsx`
- `frontend/src/admin/pages/DocumentsView.jsx`
- `frontend/src/admin/pages/ReportsView.jsx`
- `frontend/src/admin/pages/SecurityView.jsx`
- `frontend/src/admin/pages/TransactionRecords.jsx`
- `frontend/src/admin/pages/VehiclesView.jsx`
- `frontend/src/components/LogoutModal.jsx`
- `frontend/src/components/ModalPortal.jsx`

## Preserved

No backend, environment, dependency, API-contract, authentication, authorization, database, booking, or payment changes are part of this pass. Document approval, manual inspection, registration assistance, password confirmation, administrative reasons, moderation actions, and duplicate-submit protections retain their existing rules. Existing unrelated local changes were preserved.

## Verification

- Frontend lint, production build, and all nine existing frontend tests.
- `scripts/admin-ui-browser-check.mjs`: all nine authenticated screens at 320, 390, 768, 1024, 1280, and 1440px; no page-wide horizontal overflow with the supplied fixtures; control heights; mobile input sizing; customer-menu keyboard behavior; customer editing and booking/vehicle/document dialogs at 540px height; nested report dialogs; mobile drawer/sign-out transitions; notification error/success/dismissal; focus wrapping and restoration under StrictMode; dropdown Escape; pending-request Escape protection.
- `scripts/admin-integration-browser-check.mjs`: existing document/customer/booking regression checks at 390, 768, and 1280px, including missing-file approval blocks, manual comparison requirements, password requirements/errors, rejection reasons, duplicate submission prevention, and account-status refresh after approval.
- Browser scripts intercept admin API requests and use synthetic records. They do not authenticate against, update, or prove the state of a live database or deployment. Browser widths are emulated, not physical-device testing.

Run browser checks with the frontend served at `http://127.0.0.1:4181` and a separate Chrome debugging instance on port 9244:

```powershell
node --experimental-websocket scripts/admin-ui-browser-check.mjs
node --experimental-websocket scripts/admin-integration-browser-check.mjs
```

Screenshots are written into a uniquely named system temporary directory, printed by each script.

## Transaction visibility and data alignment

The Transaction Records header now has an eye toggle immediately before Refresh. It hides the financial summaries, charts, filters, and rows together; the component keeps its filters and selected month, and Refresh still updates it while hidden. Visibility is session-local React state and does not change access permissions or stored records. The header actions stack on narrow screens to avoid colliding with the page title.

Transaction responses must include their expected records, summary fields, and finite nonnegative monetary values. Loading does not display invented zero totals, and a failed refresh removes stale summaries in favor of an error with retry. The chart identifies its UTC booking-creation cohorts, and the filter description distinguishes global summaries from filtered table rows. Recorded Payments describes the stored booking field rather than claiming payment-provider settlement. Amount columns use aligned numerals and do not wrap; metric cards use fewer columns where currency values need more room.

This follow-up changes `frontend/AdminAccountPage.jsx`, `frontend/src/admin/pages/TransactionRecords.jsx`, `frontend/src/admin/components/AdminShell.jsx`, the browser check script, and this document. It preserves backend calculations, historical booking fees, API contracts, database records, and existing unrelated work.

Validation includes the six existing backend transaction-analytics tests, nine frontend tests, lint, production build, and targeted browser checks at six widths:

```powershell
node --experimental-websocket scripts/admin-ui-browser-check.mjs --transactions
```

The existing read-only `backend/scripts/checkTransactionQuery.js` also passed on October 16, 2026: the monetary aggregation agreed with the row mapper for 59 stored bookings and 80 synthetic edge cases. This check did not write records or verify payment-provider settlements.
