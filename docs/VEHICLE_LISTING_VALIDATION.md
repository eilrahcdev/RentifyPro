# Owner listing validation and photo review

## Field rules

Create and edit use equivalent frontend/backend validators, covered by parity tests.

- Name: 3–120 characters.
- Description: 30–2,000 characters; plain text with paragraphs. Excess spaces/blank lines are normalized. HTML, emoji, control characters and repeated-character filler are rejected.
- Location: 3–180 characters; owner form retains its existing Philippine-location check.
- Sub-type: 2–60 characters; plate: 3–20 characters, letters/numbers with single spaces/hyphens, normalized to uppercase.
- Seats: whole numbers, 1–12 for cars/trucks, 1–3 for motorcycles, 1–30 for vans. These are product limits, not regulatory classifications.
- Hourly rate: 0.01–100,000; driver hourly rate: 0–100,000 when enabled; at most two decimal places.
- Type, transmission and fuel use the form's supported options. Existing late-fee rules remain in effect.

Limits are applied before persistence. Existing short descriptions are not rewritten or deleted; owners must correct them when editing listing details. Booking and availability-only routes are unchanged.

## New photo lifecycle

1. The owner selects local files and saves the form. Photos are submitted to `POST /api/vehicle-photos`, authenticated, owner-only, KYC-approved and subject to existing listing restrictions.
2. Each upload is limited to 5 MiB. Sharp fully decodes a still JPEG/PNG/WEBP, rejects corrupt/oversized images (40 million pixels maximum), requires at least 320 × 200 pixels, and produces a WebP up to 2,048 × 2,048 pixels. Output excludes EXIF/GPS and preserves transparency.
3. Private bytes live under `backend/private_uploads/vehicle-images` (ignored by Git and not statically served). MongoDB records owner, content hash, vehicle type, processing/review state and reviewer information. Private previews require the owner or an administrator.
4. Gemini screens image content. Clear matching exterior/interior/detail photos with confidence >=0.9 may pass; clearly unrelated images are rejected. Uncertain classification, malformed output, missing configuration and provider failure become `needs_review`. This threshold is a starting product setting and has not been calibrated against a live photo dataset.
5. Administrators review uncertain images in **Vehicles → Vehicle photos awaiting review** in this checkout's built-in admin UI. They must supply a reason and explicitly mark whether an image is a suitable exterior cover. Decisions are atomic and record reviewer/time. A processing record interrupted for over two minutes is sent for review when the queue is refreshed.
6. The owner refreshes **Your photo reviews** and saves again, or adds a previously approved photo from that panel. Photos are deduplicated per owner, vehicle type and content hash; retries reuse the review. A pending/rejected photo cannot save the listing.
7. Listing POST/PUT accepts `approvedImageIds`, not raw files or new image URLs. Approved IDs must belong to the owner and match the vehicle type. The server copies approved bytes under fresh managed public keys only after validation. A new cover must be an approved exterior. Interior photos cannot later be promoted to covers. Existing public photos remain unchanged until replacement images pass and the listing saves.

The review queue is implemented in `frontend/src/admin` in this repository. A separately deployed admin checkout must integrate the same review endpoints before it can operate this queue.

## Configuration and rollout

- Install backend dependencies, including Sharp, and restart the backend for the new routes. Deploy frontend and backend together: the new approved-ID contract intentionally rejects the old raw-image submission path.
- Existing `GEMINI_API_KEY` is reused. Optional `GEMINI_VEHICLE_PHOTO_MODEL` overrides `GEMINI_VISION_MODEL`; fallback is `gemini-3.5-flash-lite`.
- No credentials were changed and no live personal photos were sent during implementation testing. If automatic screening is unavailable, administrators can still review photos.
- Existing image references, including legacy external URLs, may only be retained on their existing listing. They are not retroactively labeled as reviewed. Plan an explicit review/migration of older galleries rather than deleting or hiding them automatically.
- The new private photo records are durable so owners can resume after closing the form. They are not transient previews and do not have a TTL; include this directory and collection in the application's retention/access processes.
- Photo content screening does not prove ownership, registration, image authenticity, or that all gallery photos show the same physical vehicle. Do not describe it as ownership verification.

## Verification

`node --test backend/tests/vehicleListingValidation.test.js backend/tests/vehiclePhotos.test.js` covers validation parity, direct API validation, real image decoding/re-encoding, content-decision handling, unavailable screening, owner-bound publication, cover rules, private access and review conflicts.

`node --experimental-websocket scripts/vehicle-listing-browser-check.mjs` uses fixture APIs, preview on port 4176 and isolated Chrome CDP on port 9236. It checks the responsive form, inline validation, pending-to-approved publication, and admin decisions. It does not prove live Gemini classification accuracy or database persistence.
