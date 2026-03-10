# RentifyPro Performance Test Plan

## Scope
- Backend API (Express + MongoDB)
- Realtime endpoints (Socket.IO)
- Chatbot service (FastAPI)
- Face/KYC service (FastAPI + DeepFace)

## Goals
- Establish baseline latency and throughput for core renter and owner flows.
- Identify bottlenecks under peak load and long-running (soak) conditions.
- Validate stability of booking concurrency controls and rate limits.

## Environment Assumptions
- Staging environment mirrors production configuration.
- MongoDB is running on equivalent hardware and indexes are built.
- External services:
  - PayMongo calls are either sandboxed or stubbed for load tests.
  - Face service runs locally or on a dedicated host to avoid CPU contention.

## Test Data Requirements
- Users: 200 renters, 50 owners (pre-verified, with JWTs cached).
- Vehicles: 1,000 vehicles spread across owners (enables booking concurrency).
- Bookings: 5,000 historical records to exercise listing queries.
- Chat: 2,000 message threads to test conversations + paging.
- KYC: 50 sample base64 image payloads (varied sizes).

## Metrics to Capture
- API: p50, p95, p99 latency, RPS, error rate, payload sizes.
- Node process: CPU, memory, event loop lag.
- MongoDB: query latency, connection pool usage, slow queries.
- Python services: request latency, CPU usage, memory.
- Socket.IO: connection count, message delivery time.

## Suggested Tools
- Load testing: k6 (preferred) or Artillery.
- System metrics: `node --inspect` or OS-level telemetry (PerfMon).
- MongoDB: slow query profiler + logs.

## Scenarios

### S1: Public Browse (Read-Heavy)
- Endpoints:
  - `GET /api/vehicles?search=&page=&limit=`
  - `GET /api/vehicles/:id`
- Mix: 70% list, 30% detail.
- Target: p95 < 400ms, error rate < 1%.

### S2: Auth + Profile
- Endpoints:
  - `POST /api/auth/login`
  - `GET /api/auth/me`
  - `PUT /api/auth/profile`
- Use pre-generated users. Do not mass-create OTP traffic.
- Target: p95 < 500ms.

### S3: Booking Create and Conflict Handling
- Endpoints:
  - `POST /api/bookings`
  - `PATCH /api/bookings/:id/cancel`
- Use randomized available vehicle IDs to avoid lock collisions.
- Expect some 409s under contention; track rate.

### S4: Owner Dashboard Reads
- Endpoints:
  - `GET /api/owner/bookings?status=all`
  - `GET /api/owner/earnings`
  - `GET /api/owner/analytics`
- Target: p95 < 800ms.

### S5: Chat + Notifications
- Endpoints:
  - `GET /api/chat/conversations`
  - `GET /api/chat/messages/:userId`
  - `POST /api/chat/messages/:userId`
  - `GET /api/notifications`
- Maintain valid renter-owner relations.
- Target: p95 < 500ms on reads, < 800ms on writes.

### S6: Payments (Low Rate Only)
- Endpoints:
  - `POST /api/bookings/:id/pay`
  - `POST /api/bookings/:id/pay/verify`
- Keep RPS low (1-2) to avoid PayMongo throttling.
- Prefer stubbed PayMongo for scale testing.

### S7: KYC (CPU-Heavy)
- Endpoints:
  - `POST /api/kyc/face/detect`
  - `POST /api/kyc/id-register`
  - `POST /api/kyc/selfie/challenge`
  - `POST /api/kyc/selfie/verify`
- Run in isolation with low concurrency (1-5 VUs).
- Track face-service CPU saturation and queueing delays.

### S8: Socket.IO Realtime
- Actions:
  - Connect 200-500 sockets.
  - Send chat messages at low rate.
  - Validate delivery time and disconnect rate.

## Load Profiles
- Smoke: 1-5 VUs, 2-3 minutes.
- Baseline: ramp to 25 VUs, hold 10 minutes.
- Peak: ramp to 100 VUs, hold 10 minutes.
- Soak: 50 VUs, hold 30-60 minutes.
- Stress: step-up until error rate > 2% or p95 doubles.
- Spike: 10s bursts at 3x peak to test resilience.

## Pass/Fail Criteria (Initial)
- Error rate: < 1% for read endpoints, < 2% for write endpoints.
- p95 latency targets:
  - Reads: < 400-500ms
  - Writes: < 800-1000ms
  - KYC: < 3-5s (CPU heavy)
- No sustained memory growth over soak test.

## Notes
- Booking creation uses vehicle locks; ensure enough available vehicles.
- Rate limiting is enabled in production; performance tests should respect limits.
- Token-based auth should use cached tokens to avoid OTP/email noise.

