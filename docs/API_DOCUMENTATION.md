# RentifyPro API Documentation

Last updated: 2026-03-16  
Generated from the current source code in:
- `backend/server.js`
- `backend/routes/*.js`
- `backend/controllers/*.js`
- `face-service/main.py`
- `chatbot-service/app.py`

## 1. Base URLs

- Backend API (default local): `http://localhost:5000`
- Face service (default local): `http://localhost:8000`
- Chatbot service (default local): `http://localhost:8001`

## 2. Authentication and Authorization

- Auth session uses an HTTP-only cookie named `token`.
- Cookie is set by:
  - `POST /api/auth/login`
  - `POST /api/auth/verify-otp`
- Most protected endpoints require `protect` middleware:
  - Returns `401` when cookie is missing/invalid/expired.
  - Returns `403` when user email is not verified.
- Role checks use `authorize(...)` middleware and return `403` on mismatch.

### 2.1 Roles

- `user`
- `owner`
- `admin`

## 3. Common Request/Response Behavior

- JSON body parsing limit: `100mb`.
- URL-encoded parsing limit: `100mb`.
- Common success envelope (most endpoints): `success: true`.
- Common error envelope (most endpoints): `success: false, message`.
- ObjectId route params are validated on endpoints that use `validateObjectIdParam`.
- Static uploads are served from `/uploads`.

## 4. Rate Limits (5-minute window)

Global middleware and per-route limiters are configured in `backend/middleware/security.middleware.js`.

- General API limiter on `/api/*`: max `100` requests.
- Auth router limiter on `/api/auth/*`: max `10` requests (conditional skip logic present).
- Register limiter: max `5`.
- Login limiter: max `3`.
- OTP limiter: max `10`.
- KYC limiter (logged-in): max `20`.
- Pre-KYC limiter: max `15`.
- Booking create limiter: max `10`.
- Payment verify limiter: max `20`.

`429` response format includes:
- `message`
- `retryAfterSeconds`
- `retryAfterMs`
- `retryAfterAt`
- `countdown`
- `serverTime`

## 5. Core Response Objects

### 5.1 SafeUser

Used by auth/profile endpoints.

```json
{
  "_id": "string",
  "name": "string",
  "email": "string",
  "avatar": "string",
  "role": "user|owner|admin",
  "isVerified": true,
  "kycStatus": "not_started|id_uploaded|challenge_passed|approved|rejected",
  "phone": "string",
  "dateOfBirth": "string",
  "gender": "Male|Female|Prefer not to say|",
  "ownerType": "individual|business|",
  "businessName": "string",
  "licenseNumber": "string",
  "permitNumber": "string",
  "address": "string",
  "region": "string",
  "province": "string",
  "city": "string",
  "barangay": "string",
  "emergencyContactName": "string",
  "emergencyContactPhone": "string",
  "emergencyContactRelationship": "string"
}
```

### 5.2 Vehicle (serialized for renter/owner)

```json
{
  "_id": "string",
  "owner": "string|object",
  "name": "string",
  "description": "string",
  "dailyRentalRate": 0,
  "location": "string",
  "availabilityStatus": "available|unavailable",
  "images": ["absolute_url"],
  "imagePaths": ["uploads/..."],
  "imageUrl": "absolute_url",
  "driverOptionEnabled": false,
  "driverDailyRate": 0,
  "specs": {
    "type": "string",
    "subType": "string",
    "seats": 4,
    "transmission": "string",
    "fuel": "string",
    "plateNumber": "string"
  },
  "rating": 0,
  "averageRating": 0,
  "reviewCount": 0,
  "reviews": []
}
```

### 5.3 Booking (serialized)

Booking payloads include core booking, payment, walk-in, vehicle, renter, and owner data. Key fields:

- `_id`, `pickupAt`, `returnAt`, `bookingDays`
- `status`
- `paymentStatus`
- `transactionFee`
- `paymentAmountPaid`, `paymentAmountDue`, `paymentCheckoutAmount`
- `paymentScope`, `paymentChannel`
- `paymentMethod`, `balancePaymentMethod`
- `walkInPayment` details (status/request/review/confirm fields)
- `paymongoReference`, `paymongoCheckoutId`, `paymentIntentId`
- `vehicle`, `renter`, `owner`

---

## 6. Backend Endpoints

### 6.1 System

#### `GET /`
- Auth: Public
- Response: API status, version, enabled security stack.

#### `GET /api/health`
- Auth: Public
- Response:
  - `success`
  - `status`
  - `database` (`disconnected|connected|connecting|disconnecting`)
  - `timestamp`

#### `GET /api/face-service-health`
- Auth: Public
- Response on reachable service: `{ success: true, faceService: {...} }`
- Response when unavailable: `{ success: false, message: "Face service unreachable" }`

### 6.2 Auth (`/api/auth`)

#### `POST /api/auth/register`
- Auth: Public
- Middleware: `validateRegister`
- Required body:
  - `name`, `email`, `password`
- Conditional body rules:
  - `role` defaults to `user`.
  - If `role=user`: `dateOfBirth` is required and must be age 18+.
  - If `role=owner`: `ownerType` required.
  - If `role=owner` and `ownerType=business`: `businessName` and `permitNumber` required.
- Optional body:
  - `phone`, `gender`, `address`, `region`, `province`, `city`, `barangay`,
    `emergencyContactName`, `emergencyContactPhone`, `emergencyContactRelationship`,
    `licenseNumber`.
- Preconditions:
  - Pre-KYC ID document must be verified.
  - Pre-KYC selfie face match must be verified.
  - For owner registration, supporting document must also be verified.
- Success `201`:
  - `success`, `message`, `user` (`SafeUser`)
- Common errors: `400`, `409`, `500`

#### `GET /api/auth/login-challenge`
- Auth: Public
- Returns math captcha challenge.
- Success:
  - `challengeId`
  - `question`
  - `expiresInMinutes`

#### `POST /api/auth/login`
- Auth: Public
- Required body:
  - `email`, `password`, `captchaId`, `captchaAnswer`
- `captchaAnswer` must be numeric, max 3 digits.
- On success, sets `token` cookie.
- Success:
  - `success`, `message`, `user` (`SafeUser`)
- Common errors:
  - `400` (captcha/validation)
  - `401` (invalid credentials)
  - `403` (email not verified)
  - `429` (captcha attempts)

#### `POST /api/auth/send-otp`
- Auth: Public
- Body: `email`
- Behavior: returns generic success message even for unknown email.
- Success:
  - `success`
  - `message` ("If this email is registered, an OTP has been sent.")

#### `POST /api/auth/verify-otp`
- Auth: Public
- Body: `email`, `otp`
- Verifies email OTP (`verification` purpose), marks user verified, sets auth cookie.
- Success:
  - `success`, `message`, `user` (`SafeUser`)
- Common errors: `400`, `404`, `500`

#### `POST /api/auth/forgot-password`
- Auth: Public
- Body: `email`
- Returns generic success message even for unknown email.

#### `POST /api/auth/forgot-password/verify-otp`
- Auth: Public
- Body: `email`, `otp`
- Success:
  - `success`
  - `message`
  - `resetToken` (JWT for password reset flow)

#### `POST /api/auth/reset-password`
- Auth: Public
- Body:
  - `email`
  - `token` (`resetToken` from verify step)
  - `newPassword`
- Success:
  - `success`, `message`

#### `POST /api/auth/logout`
- Auth: Protected
- Invalidates current cookie token (blacklist) and clears cookie.
- Success: `success`, `message`

#### `GET /api/auth/me`
- Auth: Protected
- Success: `success`, `user` (`SafeUser`)

#### `GET /api/auth/profile`
- Auth: Protected
- Alias of `GET /api/auth/me`.

#### `PUT /api/auth/profile`
- Auth: Protected
- Body supports:
  - `name` or `firstName` + `lastName`
  - `phone`
  - `dateOfBirth` (required for role `user` if provided as key; validated)
  - `gender`, `ownerType`, `businessName`, `licenseNumber`, `permitNumber`
  - `address`, `region`, `province`, `city`, `barangay`
  - `emergencyContactName`, `emergencyContactPhone`, `emergencyContactRelationship`
  - `avatar`:
    - empty string to clear
    - normal URL/path
    - base64 image payload (saved into `/uploads/avatars`)
- Success:
  - `success`
  - `message`
  - `user` (`SafeUser`)

#### `PATCH /api/auth/change-password`
- Auth: Protected
- Body: `currentPassword`, `newPassword`
- Success: `success`, `message`

#### `GET /api/auth/notification-settings`
- Auth: Protected
- Success:
  - `success`
  - `settings`:
    - `email`
    - `sms`
    - `bookingUpdates`
    - `promotions`

#### `PUT /api/auth/notification-settings`
- Auth: Protected
- Body (optional booleans):
  - `email`, `sms`, `bookingUpdates`, `promotions`
- Success:
  - `success`
  - `settings`

#### `GET /api/auth/login-activity`
- Auth: Protected
- Query:
  - `limit` (default 10, max 50)
- Success:
  - `success`
  - `activity` (recent login events)

#### `POST /api/auth/upgrade-to-owner`
- Auth: Protected
- Body (optional): `ownerType`, `businessName`, `licenseNumber`, `permitNumber`
- Preconditions:
  - User must be email-verified.
  - Supporting pre-KYC document must be verified.
- Success:
  - `success`
  - `message`
  - `user` (`SafeUser`, role becomes `owner`)

### 6.3 KYC (`/api/kyc`)

#### `POST /api/kyc/face/detect`
- Auth: Protected
- Body: `image_base64`
- Proxies to face service for quality and face detection.

#### `POST /api/kyc/id-register`
- Auth: Protected
- Body:
  - `id_image_base64` (required)
  - `id_image_mime` (optional; default `image/jpeg`)
  - `id_type` (required; must be one of the supported Philippine ID types)
- Flow:
  - Performs local type/size validation and stores the evidence privately.
  - Queues automated screening with bounded retries and registers the ID face via the face service.
  - Returns `verificationQueued: true`; final approval waits for Super Admin review by default.

#### `POST /api/kyc/selfie/verify`
- Auth: Protected
- Body:
  - `selfie_image_base64`
- Verifies selfie against stored ID embedding.
- A successful match advances the case to `challenge_passed`; it does not bypass document review.

#### `GET /api/kyc/me`
- Auth: Protected
- Returns KYC record for current user, or `{ status: "not_started" }`.

#### `POST /api/kyc/pre/session`
- Auth: Public, rate limited
- Body: `email`, `role` (`user|owner`), and optional `previousToken` for bounded renewal.
- Returns a short-lived token bound to one email, role, and verification attempt.

#### `POST /api/kyc/pre/id-register`
- Auth: Signed pre-KYC token in `x-pre-kyc-token`
- Body:
  - `email`
  - `id_image_base64`
  - `full_name` (optional)
  - `role` (optional)
  - `id_image_mime` (optional)
- Purpose: securely queue pre-registration ID screening and register the face ID.
- Returns `verificationQueued: true` and `reviewRequired: true` on successful submission.

#### `POST /api/kyc/pre/selfie/verify`
- Auth: Signed pre-KYC token in `x-pre-kyc-token`
- Body:
  - `email`
  - `selfie_image_base64`
  - `role` (optional)
- Stores pre-registration face verification status.

#### `POST /api/kyc/pre/supporting-doc/verify`
- Auth: Signed pre-KYC token in `x-pre-kyc-token`
- Body:
  - `email`
  - `doc_image_base64`
  - `role` (optional)
  - `doc_image_mime` (optional)
- Securely stores and queues the owner supporting document.
- Returns `verificationQueued: true`; registration waits for a final document decision.

#### `GET /api/kyc/pre/status`
- Auth: Signed pre-KYC token in `x-pre-kyc-token`
- Returns the current `queued`, `processing`, `retry_wait`, `pending_review`, `verified`, or `rejected` state for documents in the current verification attempt.

#### `GET /api/kyc/admin/reviews`
- Auth: Protected admin
- Returns up to 200 queued or pending document reviews, oldest first, without embedding file contents.

#### `GET /api/kyc/admin/reviews/:id/file`
- Auth: Protected admin
- Streams private evidence with `Cache-Control: private, no-store`.

#### `PATCH /api/kyc/admin/reviews/:id`
- Auth: Protected admin
- Body: `action` (`approve|reject`), optional `remarks`.

#### `PATCH /api/kyc/internal/update-status`
- Auth: Internal key
- Required header: `x-internal-key: <INTERNAL_API_KEY>`
- Body:
  - `user_id` (email or ObjectId)
  - `status`
  - `confidence` (optional)
- Purpose: internal callback from face service to backend.

### 6.4 Public Vehicles (`/api/vehicles`)

#### `GET /api/vehicles`
- Auth: Public
- Query:
  - `search` (max 100 chars)
  - `location` (max 180 chars)
  - `vehicleType` (`car|motorcycle|van|truck`, alias `motor` -> `motorcycle`)
  - `page` (default 1)
  - `limit` (default 12, max 24)
- Success:
  - `success`
  - `vehicles` (serialized vehicles + review insights)
  - `pagination`
  - `filters`

#### `GET /api/vehicles/:id`
- Auth: Public
- Param: `id` (ObjectId)
- Success:
  - `success`
  - `vehicle` (serialized with reviews/ratings)

### 6.5 Owner APIs (`/api/owner`)

#### `POST /api/owner/register`
- Auth: Public
- Purpose: request OTP for owner registration.
- Required body:
  - `firstName`, `lastName`, `phone`, `businessEmail`, `password`, `ownerType`
- Optional body:
  - `address`, `region`, `province`, `city`, `barangay`,
    `businessName`, `licenseNumber`, `permitNumber`
- Conditions:
  - `ownerType` must be `individual` or `business`.
  - If `business`, `businessName` and `permitNumber` are required.
  - Pre-KYC ID + supporting docs + face verification must be complete.
- Success:
  - `message`, `email`, `expiresInMinutes`

#### `POST /api/owner/resend-otp`
- Auth: Public
- Body: `email`
- Success:
  - `message`, `email`, `expiresInMinutes`

#### `POST /api/owner/verify-otp`
- Auth: Public
- Body: `email`, `otp`
- On success creates owner account and clears pre-KYC cache.
- Success `201`:
  - `message`
  - `owner` summary

#### `GET /api/owner/vehicles`
- Auth: Protected owner
- Success: `success`, `vehicles`

#### `POST /api/owner/vehicles`
- Auth: Protected owner
- Content type: `multipart/form-data`
- File field:
  - `images` (max 8 files, each max 5MB)
  - Allowed MIME/signature: JPG, JPEG, PNG, WEBP
- Body:
  - Required: `name`, `description`, `location`, `dailyRentalRate`
  - Optional: `availabilityStatus`, `driverOptionEnabled`, `driverDailyRate`
  - Optional specs:
    - `specType`, `specSubType`, `specSeats`, `specTransmission`, `specFuel`, `specPlateNumber`
  - Optional linked images: `imageUrls` (array/json/csv)
- Validation: at least one image required (uploaded or linked).
- Success `201`: `success`, `vehicle`

#### `PUT /api/owner/vehicles/:id`
- Auth: Protected owner
- Content type: `multipart/form-data`
- Param: `id` (ObjectId)
- Supports all vehicle fields from create.
- Additional body:
  - `existingImages` to keep selected previous images.
- Success: `success`, `vehicle`

#### `PATCH /api/owner/vehicles/:id/availability`
- Auth: Protected owner
- Param: `id` (ObjectId)
- Body:
  - `availabilityStatus` (`available|unavailable`)
- Can return `409` if trying to set `available` while active booking exists.
- Success: `success`, `vehicle`

#### `DELETE /api/owner/vehicles/:id`
- Auth: Protected owner
- Param: `id` (ObjectId)
- Success: `success`, `message`

#### `GET /api/owner/bookings`
- Auth: Protected owner
- Query:
  - `status` (`all|pending|confirmed|completed|cancelled|rejected`)
  - `cancelled` maps to both `cancelled` and `rejected`.
- Success: `success`, `bookings`

#### `PATCH /api/owner/bookings/:id/status`
- Auth: Protected owner
- Param: `id` (ObjectId)
- Body:
  - `status` (`pending|confirmed|completed|cancelled|rejected`)
- `confirmed` checks schedule conflicts before updating.
- Success: `success`, `booking`

#### `PATCH /api/owner/bookings/:id/payment-status`
- Auth: Protected owner
- Param: `id` (ObjectId)
- Body:
  - `paymentStatus` (`unpaid|partial|paid|refunded`)
- Note: setting `paid` manually is blocked (`403`).
- Success:
  - `success`
  - `message`
  - `booking`

#### `PATCH /api/owner/bookings/:id/walk-in-request`
- Auth: Protected owner
- Param: `id` (ObjectId)
- Body:
  - `action` (`approve|reject`)
  - `note` (optional)
- Purpose: review renter walk-in payment request.
- Success: `success`, `message`, `booking`

#### `POST /api/owner/bookings/:id/walk-in-confirm`
- Auth: Protected owner
- Param: `id` (ObjectId)
- Body:
  - `note` (optional)
- Purpose: confirm approved walk-in balance payment and mark booking paid.
- Success:
  - `success`
  - `message`
  - `booking`

#### `GET /api/owner/reviews`
- Auth: Protected owner
- Success:
  - `success`
  - `reviews` (booking-linked review data)

#### `GET /api/owner/earnings`
- Auth: Protected owner
- Success:
  - `success`
  - `totals`
  - `monthlyEarnings`
  - `bookings`

#### `GET /api/owner/analytics`
- Auth: Protected owner
- Success:
  - `success`
  - `monthlyEarningsTrend`
  - `bookingTrend`
  - `mostBookedVehicles`

### 6.6 Booking APIs (`/api/bookings`)

All booking routes are protected and role-guarded to `user|owner|admin` unless noted.

#### `POST /api/bookings`
- Auth: Protected
- Roles: `user|owner|admin`
- Body:
  - `vehicleId`
  - `pickupAt`
  - `returnAt`
  - `driverSelected` (optional boolean-like)
- Rules:
  - Pickup must be future.
  - Return must be after pickup.
  - Same-day booking must be at least 1 hour.
  - Owner cannot book own vehicle.
  - Overlapping active booking is blocked.
- Success `201`: `success`, `message`, `booking`

#### `GET /api/bookings/me`
- Auth: Protected
- Roles: `user|owner|admin`
- Query:
  - `status` filter
  - `cancelled` includes `cancelled` + `rejected`
- Success: `success`, `bookings`

#### `GET /api/bookings/owner`
- Auth: Protected
- Roles: `owner|admin`
- Query: same status behavior as `/me`
- Success: `success`, `bookings`

#### `GET /api/bookings/:id`
- Auth: Protected
- Roles: `user|owner|admin`
- Param: `id` (ObjectId)
- Access is scoped by role (renter/owner/admin).
- Success: `success`, `booking`

#### `PATCH /api/bookings/:id/cancel`
- Auth: Protected
- Roles: `user|owner|admin` (controller effectively enforces renter ownership)
- Param: `id` (ObjectId)
- Cancels `pending|confirmed` booking.
- Success: `success`, `booking`

#### `PATCH /api/bookings/:id/review`
- Auth: Protected
- Roles: `user|owner|admin` (controller effectively renter-only)
- Param: `id` (ObjectId)
- Body:
  - `rating` (1-5)
  - `comment` (optional)
- Only completed bookings can be reviewed.
- Success: `success`, `booking`

#### `POST /api/bookings/:id/pay`
- Auth: Protected
- Roles: `user|owner|admin` (controller effectively renter-only)
- Param: `id` (ObjectId)
- Body:
  - `paymentScope` (`downpayment|full`, optional)
  - `paymentChannel` (`ewallet|card`, optional)
- Creates PayMongo checkout session.
- Success:
  - `success`
  - `message`
  - `checkoutUrl`
  - `checkoutId`
  - `referenceNumber`
  - `payment` summary
  - `booking`

#### `POST /api/bookings/:id/pay/balance-method`
- Auth: Protected
- Roles: `user|owner|admin` (controller effectively renter-only)
- Param: `id` (ObjectId)
- Body:
  - `method` (`walkin|walk-in|on_return|on-return|manual`)
  - `note` (optional)
- Submits walk-in balance payment approval request.
- Success: `success`, `message`, `booking`

#### `POST /api/bookings/:id/pay/walk-in-request`
- Alias route to same controller as `/pay/balance-method`.

#### `POST /api/bookings/:id/pay/verify`
- Auth: Protected
- Roles: `user|owner|admin` (controller effectively renter-only)
- Param: `id` (ObjectId)
- Body:
  - `checkoutId` (optional; validated against booking)
- Verifies checkout and updates payment state.
- Success:
  - `success`
  - `paid` (boolean for fully paid)
  - `paymentCaptured` (checkout paid status)
  - `paymentStatus`
  - `checkoutId`
  - `referenceNumber`
  - `booking`
  - `message`

### 6.7 Admin APIs (`/api/admin`)

#### `GET /api/admin/transactions`
- Auth: Protected admin
- Purpose: Lists transaction records across all bookings for the admin dashboard.
- Query:
  - `paymentStatus` (`all|unpaid|partial|paid|refunded`, optional, default `all`)
  - `search` (optional, max 100 characters; searches booking/payment references, vehicle, renter, and owner)
  - `limit` (optional, default 50, max 100)
  - `cursor` (optional pagination cursor returned by the previous response)
- Success:
  - `success`
  - `transactions` (booking, payment, vehicle, renter, and owner transaction details)
  - `summary` (record/payment counts and total collected)
  - `page` (`hasMore`, `nextCursor`, `limit`)

### 6.8 Chat APIs (`/api/chat`)

#### `POST /api/chat`
- Auth: Public
- Purpose: chatbot query endpoint.
- Body:
  - `message` (required)
  - `language` (`english|filipino`, optional, default `english`)
- Input guardrails:
  - max length 500
  - only letters, spaces, `, . ?`
  - blocks profanity list
- Success response (normalized):
  - `reply`
  - `intent`
  - `intent_id`
  - `reply_lang` (`en|fil`)
  - `score`
  - `top_preds`
  - `recommendations`
  - `reject_reason` (on rejected answers)

#### `GET /api/chat/conversations`
- Auth: Protected
- Roles: `user|owner|admin`
- Success:
  - `success`
  - `conversations` (partner, lastMessage, unreadCount)

#### `GET /api/chat/messages/:userId`
- Auth: Protected
- Roles: `user|owner|admin`
- Param: `userId` (ObjectId)
- Optional query:
  - `bookingId`
  - `vehicleId`
- Rule: only one of `bookingId` or `vehicleId`.
- Success:
  - `success`
  - `messages`
  - `conversationMeta` (`bookingId`, `vehicleId`, `ownerId`, `renterId`)

#### `POST /api/chat/messages/:userId`
- Auth: Protected
- Roles: `user|owner|admin`
- Param: `userId` (ObjectId)
- Body:
  - `text` (required)
  - optional context: `bookingId` or `vehicleId` (not both)
- Success `201`:
  - `success`
  - `message` (created chat message object)

#### `PATCH /api/chat/messages/:userId/read`
- Auth: Protected
- Roles: `user|owner|admin`
- Param: `userId` (ObjectId)
- Optional query:
  - `bookingId` or `vehicleId`
- Success:
  - `success`
  - `message`

### 6.9 Notifications (`/api/notifications`)

#### `GET /api/notifications`
- Auth: Protected
- Roles: `user|owner|admin`
- Returns latest 100 notifications.
- Success: `success`, `notifications`

#### `PATCH /api/notifications/:id/read`
- Auth: Protected
- Roles: `user|owner|admin`
- Param: `id` (notification ObjectId)
- Success: `success`, `notification`

#### `PATCH /api/notifications/read-all`
- Auth: Protected
- Roles: `user|owner|admin`
- Success: `success`, `message`

---

## 7. Face Service API (`face-service/main.py`)

Internal service used by backend KYC routes.

### `GET /`
- Health and metadata response:
  - `status`
  - `service`
  - `version`
  - `model`
  - `detector`
  - `match_threshold`
  - `registered_users`
  - `docs`

### `POST /api/kyc/face/detect`
- Body:
  - `image_base64`
- Response model:
  - `ok`
  - `message`
  - `face_count`
  - `bounding_box`
  - `quality` (`blur`, `brightness`, `face_area_ratio` when available)

### `POST /api/kyc/id/register`
- Body:
  - `user_id`
  - `role`
  - `full_name`
  - `id_image_base64`
- Response model:
  - `success`
  - `message`
  - `user_id`
  - `stored_at`

### `POST /api/kyc/selfie/challenge`
- Body:
  - `user_id`
  - `frames_base64` (array)
- Response model:
  - `passed`
  - `message`
  - `user_id`
  - `challenge_id` (when passed)

### `POST /api/kyc/selfie/verify`
- Body:
  - `user_id`
  - `challenge_id`
  - `selfie_image_base64`
- Response model:
  - `verified`
  - `message`
  - `user_id`
  - `role`
  - `full_name`
  - `distance`
  - `confidence`

---

## 8. Chatbot Service API (`chatbot-service/app.py`)

Internal service used by `POST /api/chat`.

### `GET /`
- Health metadata:
  - `status`
  - `service`
  - `model`
  - `dataset` (always `rentifypro_chatbot_dataset_v6.json`)

### `GET /health`
- Returns `{ "status": "ok" }`

### `POST /chat`
- Body:
  - `message` (required)
  - `vehicles` (optional array for recommendations)
- Response:
  - `intent_id`
  - `reply_lang` (`en|fil`)
  - `score`
  - `reply`
  - `top_preds`
  - optional `recommendations`
  - optional `slots`

---

## 9. Error Reference

Common status codes used across the project:

- `200` OK
- `201` Created
- `400` Validation/business-rule error
- `401` Not authenticated / invalid credentials
- `403` Not allowed (role or verification requirement)
- `404` Not found
- `409` Conflict (duplicate data/schedule conflict)
- `410` Expired OTP
- `429` Too many requests
- `500` Internal server error
- `502` Upstream dependency failed (PayMongo/chatbot)
- `503` Service unavailable

Generic backend error format from global error handler:

```json
{
  "success": false,
  "message": "Request failed."
}
```

Validation errors may include:

```json
{
  "success": false,
  "message": "Validation failed.",
  "errors": {
    "field": "message"
  }
}
```

---

## 10. WebSocket Side Effects (Non-HTTP)

Several booking/chat endpoints also emit socket events:

- `booking:updated` to renter/owner on booking/payment/walk-in state changes.
- `chat:message` to sender/receiver on new messages.

These are event side effects and not separate HTTP endpoints.
