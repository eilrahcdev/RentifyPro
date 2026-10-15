# Registration UI repair

The requested correction preserves the existing five-step renter/owner wizards and Step 4's required Email, Documents, and Selfie sequence. It restores the incumbent Manrope/blue/slate interface and removes the extra phase counter. No backend or persistence policy was changed.

## Causes and corrections

- The renter's `SelectField` and `FileCard` were declared inside `RegisterForm`. Every parent render, including draft saves and clock/state updates, created a new React component type. React replaced the native controls, losing select focus/open state and replacing the file input. Both helpers now live at module scope. Their existing markup, native select behavior, validation, file rules, and disabled states are preserved.
- Step changes called `scrollIntoView` on the inner form. That could scroll multiple ancestors, pushing the card header and left-hand branding above the viewport. Step navigation now focuses the existing registration heading without implicit scrolling, resets the registration content scroller, and resets the page to the top. ID/selfie headings also use `preventScroll`. Validation errors still focus and reveal the affected field.
- The normal draft notice changed between differently sized panels, explanatory paragraphs, and timestamps while saving. Normal progress now occupies a compact disclosure row. It reports Saving progress or Progress saved accurately; saved time, expiry, and password/consent information appear only when expanded. Routine updates are not live-announced after every field. Save failures, conflicts, expired drafts, expiry warnings, retry/recovery, confirmed restart, and completion notices remain available.
- The three-item phase rail was removed from renter and owner Step 4. Server-validated phase navigation, email-before-document enforcement, document versions, and saved selfie results remain unchanged. The earlier email verification presentation was reused inside Step 4: a code/resend strip, centered recipient/instructions, bounded six-digit fields, and Clear Code/Verify Code actions. It does not restore the removed post-registration OTP page.
- Existing ID upload, business-document, document-status, and `SelfieCapture` interfaces remain in use. The extra phase rail no longer displaces them. Registration-only scroll anchoring is disabled so asynchronous status layout changes do not reposition the form.
- The full recovery regression exposed an intermittent owner Review data-loss race during rapid password/consent entry. The address-composition effect could replace the entire form with an older render's copy while location data arrived. Its state updater now merges only the composed address into the latest form. Passwords and consent remain in memory and are not added to persistence. The original rapid-entry assertion was retained; the focused completion rerun passed.

Autosaving is necessary for refresh recovery. A large, repeatedly changing confirmation panel is not. The existing safe-field allowlist, debounce, backend ownership/revision checks, recovery rules, and password-in-memory policy were preserved.

## Intentionally modified files

| File | Purpose |
| --- | --- |
| `frontend/src/components/RegisterPage.jsx` | Keep renter select/file controls mounted across saves, remove the phase counter, and prevent identity-heading focus from scrolling ancestors. |
| `frontend/src/pages/RegisterOwnerPage.jsx` | Remove the phase counter, prevent identity-heading focus from scrolling ancestors, and keep asynchronous address composition from overwriting newly entered fields. |
| `frontend/src/hooks/useRegistrationNavigation.js` | Reset the correct scroll positions while preserving heading focus and validation-error navigation. |
| `frontend/src/components/RegistrationDraftNotice.jsx` | Show routine autosave status in a compact, expandable row while retaining recovery/error/expiry/completion controls. |
| `frontend/src/components/RegistrationEmailVerification.jsx` | Reuse the earlier compact OTP presentation and Clear Code action inside Step 4. |
| `frontend/src/responsive.css` | Add two registration-scoped scroll/focus rules without changing other auth pages. |
| `scripts/registration-recovery-browser-check.mjs` | Add responsive DOM/focus, compact-status, navigation, OTP, file-picker, camera, and action-reachability regressions using existing synthetic APIs. |
| `docs/registration-ui-repair.md` | Record the causes, scoped changes, evidence, and limitations. |

No `.env`, backend, database, authentication, payment, dependency, shared camera implementation, or separate-admin files were modified for this repair. Unrelated dirty-worktree changes were preserved. No commits, pushes, merges, or deployment were performed.

## Validation

The new browser regression failed before the UI correction because autosaving replaced the renter select node and lost focus. After the correction, 42 UI browser checks passed across both roles at 390, 768, 1200, and 1920 pixels. They checked native control identity/focus through saves, compact notice height, uncropped headings after real Next navigation, removal of the phase rail, OTP clearing/resend, stable file inputs, and no horizontal overflow. Both roles' live fake-camera streams survived autosaving; capture and Retake worked. Bottom actions remained reachable by scrolling in every tested verification view.

- 60 focused registration/CORS/OTP/draft/camera-helper regressions passed with controlled database/mail/provider fixtures.
- All 90 existing recovery browser checks passed after the owner address correction. Coverage includes every wizard step and verification phase at 320, 390, 768, and 1200 pixels, restored documents/selfies, failed saves, expired drafts, stale tabs, interrupted responses, OTP retry/cooldown, Back/Forward navigation, and duplicate account submission. The rapid recovered-field assertion was unchanged. Both browser reports contain an empty `errors` array.
- Focused ESLint passed for all five affected JSX/JavaScript source files.
- Production Vite build passed.
- Impeccable's layout detector returned no findings for the affected components. The scoped diff was compared with a snapshot taken before editing; `git diff --check` passed with existing informational line-ending warnings.

Commands used:

```powershell
node --experimental-websocket scripts/registration-recovery-browser-check.mjs --ux-only
node --experimental-websocket scripts/registration-recovery-browser-check.mjs
node --test backend/tests/registrationCors.test.js backend/tests/registrationDraft.test.js backend/tests/registrationOtp.test.js backend/tests/registrationEmail.test.js scripts/registration-draft.test.mjs frontend/tests/cameraKyc.test.mjs
# From frontend:
npx.cmd eslint src/components/RegisterPage.jsx src/pages/RegisterOwnerPage.jsx src/components/RegistrationDraftNotice.jsx src/components/RegistrationEmailVerification.jsx src/hooks/useRegistrationNavigation.js
npm.cmd run build
```

Browser evidence is written under the Windows temporary directory: `rentifypro-registration-recovery-browser-ux.json` and `rentifypro-registration-recovery-browser.json`. The harness requires its isolated frontend on port 4176 and Chrome debugging on port 9236; the camera checks require Chrome's fake media stream flags. These are test services, separate from the user's running development servers.

Browser API, address, email, document, and face-match responses are synthetic and isolated from real accounts. Fake-camera checks validate the camera UI lifecycle, not physical-device camera quality, real-person identity, or liveness. No real OTP, registration, document upload, or booking was created by these tests.

## UI delivery evidence

Direction is preservation of RentifyPro's existing operational interface: ENERGY 1 / RHYTHM 1 / MOTION 1. The form task leads; progress is secondary; OTP fields are bounded for readable grouping; the extra rail is removed to recover vertical space. Existing typography, palette, gradients, radii, imagery, and responsive action rail are retained for continuity. No new assets, claims, theme controls, or motion were introduced.

Two bounded screenshot-review passes covered renter email/ID and owner email/selfie on desktop/mobile, followed by the renter's live camera view on mobile. The 42-check pass also confirmed action reachability and camera persistence. Physical mobile devices, native operating-system select popups, and assistive-technology interaction remain unverified; the dropdown regression checks DOM identity and focus in Chrome.

## Anti-slop delivery gate

PASS for this scoped repair. Existing branding and shared controls were preserved at the user's request. The evidence below concerns the changed registration UI; it is not a whole-site accessibility or design certification.

| Item | Result and evidence |
| --- | --- |
| R-02 | PASS: no em dash added to customer-facing copy; incumbent step titles were preserved. |
| R-03 | PASS: responsive checks found no horizontal overflow; headings and bottom actions remain reachable across the tested widths. |
| R-17 | PASS: no statistics added. |
| R-18 | PASS: no testimonials added. |
| R-23 | PASS: no new visual assets or navigation architecture; the earlier OTP presentation was reused as requested. |
| R-24 | PASS: no navbar links added; existing Next, Back, and Sign in routes retained. |
| R-25 | PASS: new routine text uses slate-600 on white (7.58:1); OTP blue text on blue-50 is 5.43:1. Existing shared button styles retained. |
| R-26 | PASS: Clear Code clears all digits; Send Code starts cooldown; Next advances; selects and file pickers retain their native controls. |
| R-27 | PASS: initial, saving, saved, loading, error, expiry, and recovery states remain implemented; routine states use the compact row. |
| R-28 | PASS: no FAQ added. |
| R-32 | PASS: native details/select/button semantics and existing focus styles retained; dropdown focus survives saves, and Clear Code returns focus to the first digit. Assistive technology remains untested. |
| R-33 | PASS: changes live in React/CSS source; browser scripts only exercise synthetic test sessions. |
| R-34 | PASS: no theme toggle or alternate theme added or modified. |
| R-35 | PASS: production build, focused lint, 60 regressions, 42 responsive UI checks, and 90 recovery checks passed; click-through outcomes are recorded above and in the JSON reports. |
| R-36 | PASS: no new security, performance, or compliance claims; fake-camera checks are explicitly identified as simulated. |
| R-37 | PASS: preservation direction and ENERGY 1 / RHYTHM 1 / MOTION 1 were declared before editing. |
| R-38 | PASS: no fabricated production content; fixture names and verification responses exist only in the browser harness. |
| R-01 | PASS: incumbent blue gradients retained for brand continuity; no glow or gradient added. |
| R-04 | PASS: ShieldCheck labels the verification code; Clock3 labels its resend wait. Existing icon library retained. |
| R-06 | PASS: existing Manrope typography retained for continuity; no display monospace or tracked uppercase added. |
| R-07 | PASS: no background patterns added. |
| R-08 | PASS: no decorative button arrows added. |
| R-09 | PASS: no badges added; existing registration branding retained as requested. |
| R-10 | PASS: no glass effects added. |
| R-12 | PASS: existing shared elevations retained; the large routine notice panel was removed. |
| R-13 | PASS: no glow effects added. |
| R-14 | PASS: the redundant uniform phase-card rail was removed; document cards keep their existing upload purpose. |
| R-19 | PASS: no new motion; existing busy indicator communicates an active request. |
| R-22 | PASS: no illustrations added. |
| Dials | PASS: ENERGY 1 / RHYTHM 1 / MOTION 1 match the retained operational form and restrained progress row. |
| Focal point | PASS: the active form or verification task leads; routine saved status is secondary. |
| Whitespace | PASS: bounded OTP width groups digits; removal of the rail and large status panel recovers task space. |
| Accent | PASS: incumbent blue remains the primary action and focus accent. |
| Identity | PASS: incumbent Manrope, blue/slate controls, rounded panels, and vehicle imagery retained. |
| Design Read | PASS: preserve the existing interface, quiet routine saving, remove redundant phase chrome, and fix control identity and scrolling. |
| C-1 | PASS: changes address the reported cropping, disruptive status panel, control remounts, and verification spacing. |
| C-2 | PASS: changed controls have native behavior or existing handlers; Clear Code/Send Code/Next and camera actions were exercised. |
| C-3 | PASS: redundant phase rail removed; no filler sections added. |
| C-4 | PASS: tested responsive states and focus are stable through saves; recovery/error handling retained. Physical-device coverage is explicitly limited. |
| C-5 | PASS: no fabricated product claims or customer evidence. |
| R-05 | PASS: existing task-based five-step composition retained; no marketing template introduced. |
| R-11 | PASS: existing varied control and panel radii retained. |
| R-15 | PASS: actions name their work: Send Code, Clear Code, Verify Code, Start over. |
| R-16 | PASS: new text describes saving, expiry, and code entry in plain language. |
| R-20 | PASS: existing RentifyPro identity retained rather than replaced. |
| R-21 | PASS: incumbent light interface retained; no dark mode or theme request deferred. |
| R-29 | PASS: incumbent slate/blue palette and semantic feedback colors retained. |
| R-30 | PASS: no other product's design system introduced. |
| R-31 | PASS: each change has a concrete cause and correction recorded above. |
