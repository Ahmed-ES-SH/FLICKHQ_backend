# Notifications Module Audit Report

> **Project:** NestJS Boilerplate Backend  
> **Scope:** `src/notifications/` plus related config and auth wiring  
> **Date:** 2026-06-06  
> **Target:** Free hosting with serverless functions, Pusher-based realtime, reusable across projects  

## Executive Summary

The notifications module is already mostly aligned with a Pusher-based realtime design, which is the right direction for serverless deployment. However, the current implementation still has several correctness, security, performance, and maintainability issues that should be fixed before production release.

The most important risks are:

1. The module still contains a broken system-wide broadcast path.
2. The Pusher auth endpoint does not inherit the custom blacklist check, so revoked users may still subscribe.
3. Several endpoints lack endpoint-specific throttling, while the global throttler is in-memory and IP-based.
4. The retry logic is synchronous and can waste serverless execution time.
5. Pagination and database indexing are not strong enough for larger datasets.

## Scope Notes

- Current `src/notifications/` code is already Pusher-based.
- I did **not** find Socket.IO usage inside `src/notifications/`.
- If Socket.IO exists in older branches or other modules, it should be removed from the realtime path and from dependency lists, because this module should stay Pusher-only.

---

## Findings Summary

| ID | Severity | Area | Short Summary |
|---|---:|---|---|
| NTF-01 | Critical | Security | Pusher auth bypasses the app's token blacklist check |
| NTF-02 | Critical | Correctness | System-wide admin broadcast emits incompatible payload |
| NTF-03 | High | Rate limiting | No endpoint-specific throttling for sensitive routes |
| NTF-04 | High | Performance / Serverless | Retry logic blocks the request path with `setTimeout` delays |
| NTF-05 | High | Performance | Common notification queries need composite indexes |
| NTF-06 | Medium | Correctness / API design | Preferences update uses `@Query()` on `PATCH` instead of `@Body()` |
| NTF-07 | Medium | Pagination | Cursor pagination uses only `createdAt`, which can skip or duplicate rows |
| NTF-08 | Medium | Security / Clean code | Internal error messages are returned to the client |
| NTF-09 | Medium | Reusability | Service is too coupled to Pusher-specific and project-specific details |
| NTF-10 | Medium | Performance / Reliability | Realtime failures are only logged; there is no durable fallback |

---

## Detailed Findings

### NTF-01. Pusher auth does not enforce the same blacklist check as the rest of the app

**Files:** `src/notifications/pusher.auth.controller.ts`, `src/auth/guards/auth.guard.ts`, `src/auth/strategies/jwt.strategy.ts`

**Problem**

`PusherAuthController` uses `@UseGuards(AuthGuard('jwt'))`, which validates the JWT but does not apply the custom blacklist logic implemented in the app-level `AuthGuard`. A revoked token can still authorize a private Pusher channel until it expires.

**Evidence**

- `src/notifications/pusher.auth.controller.ts:34-90`
- `src/auth/guards/auth.guard.ts:25-53`

**Why this matters**

This is a real security gap. Private channel access should be denied immediately after logout or token revocation, not only after JWT expiry.

**Solve**

- Replace `AuthGuard('jwt')` here with the app's custom auth guard, or wrap the passport guard with the blacklist check.
- Keep the user/channel ownership check, but make revocation state part of the authorization decision.
- Add a test that verifies a blacklisted user cannot authenticate to `private-user-<id>`.

---

### NTF-02. System-wide admin broadcast is broken because it emits the wrong event payload

**Files:** `src/notifications/notifications.service.ts`, `src/notifications/events/notification.events.ts`

**Problem**

When `adminBroadcast()` is called without `targetUserIds`, it emits `NOTIFICATION_EVENTS.ORDER_UPDATED` with only `{ title, message, data }`. The `handleOrderUpdated()` listener expects `userId`, `orderId`, `status`, `title`, and `message`. The payload does not match, so the event path is functionally broken.

**Evidence**

- `src/notifications/notifications.service.ts:361-367`
- `src/notifications/notifications.service.ts:424-438`
- `src/notifications/events/notification.events.ts`

**Why this matters**

The "broadcast to all users" path will not create valid notifications. It may fail at runtime, emit malformed rows, or silently do nothing useful.

**Solve**

- Introduce a dedicated broadcast event and handler with a matching payload contract.
- Do not reuse `ORDER_UPDATED` for generic broadcasts.
- If the intended behavior is to create notifications for every user, move that logic into a dedicated broadcast workflow with chunking and background processing.

---

### NTF-03. The module needs endpoint-specific throttling, not only a global IP-based limiter

**Files:** `src/config/throttler.config.ts`, `src/notifications/notifications.client.controller.ts`, `src/notifications/notifications.controller.ts`, `src/notifications/pusher.auth.controller.ts`

**Problem**

The app uses a global throttler, but it is:

- in-memory, which is weak for serverless and multi-instance deployments
- IP-based, which is a poor fit for authenticated user actions
- not tuned per endpoint

Sensitive endpoints like `read-all`, `mark-as-read`, `preferences`, admin broadcast, and Pusher auth should not share the same limit policy as list endpoints.

**Evidence**

- `src/config/throttler.config.ts`
- `src/notifications/notifications.client.controller.ts:33-124`
- `src/notifications/notifications.controller.ts:37-70`
- `src/notifications/pusher.auth.controller.ts:34-90`

**Why this matters**

On free hosting, the service is more exposed to abuse, and the current config can either be bypassed across instances or unfairly throttle many users behind one IP.

**Solve**

- Move throttling state to a shared store if the platform is multi-instance.
- Add route-level limits for notifications:
  - `GET /notifications`: moderate read limit
  - `GET /notifications/unread-count`: small frequent-read limit
  - `PATCH /notifications/:id/read`: strict write limit
  - `PATCH /notifications/read-all`: very strict write limit
  - `PATCH /notifications/preferences`: strict write limit
  - `POST /pusher/auth`: low burst limit because clients reconnect
  - `POST /admin/notifications/send` and `POST /admin/notifications/broadcast`: very strict admin-only limit
- Prefer user-based throttling for authenticated routes, with IP as a fallback.

---

### NTF-04. Retry logic blocks the request path and wastes serverless execution time

**Files:** `src/notifications/pusher.service.ts`, `src/notifications/notifications.service.ts`

**Problem**

`PusherService.triggerWithRetry()` retries in-process with `setTimeout` delays of 500ms, 1000ms, and 2000ms. Because notification creation waits on these retries, each Pusher failure increases response time and consumes serverless runtime.

**Evidence**

- `src/notifications/pusher.service.ts:39-111`
- `src/notifications/notifications.service.ts:49-53`, `185-192`, `218-223`, `253-259`, `352-359`

**Why this matters**

On free serverless hosting, blocking retry loops can push requests into timeout territory and increase cost/latency for unrelated user actions.

**Solve**

- Keep the database write synchronous, but move realtime publish to an async job, queue, or outbox processor.
- If retries stay in-process, reduce them sharply and cap total wait time.
- Record failed publish attempts for later recovery instead of only logging them.

---

### NTF-05. Notification queries need composite indexes for the real access pattern

**Files:** `src/notifications/schema/notification.schema.ts`, `src/notifications/notifications.service.ts`

**Problem**

The schema has single-column indexes on `userId`, `isRead`, `type`, and `createdAt`, but the module queries by combined predicates like:

- `userId + isDeleted + createdAt`
- `userId + isRead + isDeleted`
- `isDeleted + createdAt`

Single-column indexes are not enough for these repeated query shapes once the table grows.

**Evidence**

- `src/notifications/schema/notification.schema.ts:10-15`
- `src/notifications/notifications.service.ts:67-87`
- `src/notifications/notifications.service.ts:149-153`
- `src/notifications/notifications.service.ts:211-257`
- `src/notifications/notifications.service.ts:379-397`

**Why this matters**

Performance will degrade as the notifications table grows, especially on a free Postgres tier with limited IO and CPU.

**Solve**

- Add composite indexes that match the real queries.
- Good candidates:
  - `(user_id, is_deleted, created_at DESC)`
  - `(user_id, is_deleted, is_read)`
  - `(is_deleted, created_at DESC)` for admin listing
- Verify with `EXPLAIN ANALYZE` before and after the change.

---

### NTF-06. Preferences update endpoint is wired as a query-string patch instead of a JSON body update

**Files:** `src/notifications/notifications.client.controller.ts`, `src/notifications/dto/update-preferences.dto.ts`

**Problem**

`PATCH /notifications/preferences` reads `updates` from `@Query()` instead of `@Body()`. For a mutation endpoint this is awkward, and it is especially brittle for boolean values because query parameters arrive as strings unless carefully transformed.

**Evidence**

- `src/notifications/notifications.client.controller.ts:116-124`
- `src/notifications/dto/update-preferences.dto.ts`

**Why this matters**

The endpoint is easy to misuse and may reject otherwise valid requests. It also breaks the normal REST shape that other projects will expect.

**Solve**

- Switch the endpoint contract to JSON body input.
- Keep the DTO, but accept it from `@Body()`.
- Add explicit boolean transformation if you want to support partial update payloads from browser clients.

---

### NTF-07. Cursor pagination can duplicate or skip rows when multiple items share the same timestamp

**Files:** `src/notifications/notifications.service.ts`, `src/notifications/dto/cursor-pagination.dto.ts`

**Problem**

The cursor pagination logic uses only `createdAt` as the cursor. If two notifications share the same timestamp, page boundaries can become unstable. This is more likely under high throughput or coarse timestamp precision.

**Evidence**

- `src/notifications/notifications.service.ts:100-132`
- `src/notifications/dto/cursor-pagination.dto.ts`

**Why this matters**

Users can see duplicate notifications or miss notifications when scrolling through the feed.

**Solve**

- Use a stable compound cursor such as `(createdAt, id)`.
- Order by `createdAt DESC, id DESC`.
- Encode both values in the cursor token and filter using both fields.

---

### NTF-08. Internal exception messages are being returned to clients

**Files:** `src/notifications/notifications.service.ts`

**Problem**

Many catch blocks rethrow `InternalServerErrorException(error.message)`. This can leak database details, Pusher client errors, or other internal implementation details to the API caller.

**Evidence**

- `src/notifications/notifications.service.ts:56-61`
- `src/notifications/notifications.service.ts:88-93`
- `src/notifications/notifications.service.ts:141-146`
- `src/notifications/notifications.service.ts:195-207`
- `src/notifications/notifications.service.ts:224-231`
- `src/notifications/notifications.service.ts:261-272`

**Why this matters**

This is a security and cleanliness issue. End users should not receive low-level error details from infrastructure or database failures.

**Solve**

- Log the real error on the server.
- Return a generic message to the client.
- Standardize the pattern with Nest `Logger` instead of `console.error`.

---

### NTF-09. The module is too tightly coupled to project-specific and Pusher-specific details

**Files:** `src/notifications/notifications.service.ts`, `src/notifications/pusher.service.ts`, `src/notifications/notifications.gateway.ts`

**Problem**

The module mixes:

- notification persistence
- preference storage
- admin workflows
- event handling
- realtime publishing

It also hardcodes Pusher channel names such as `private-user-${userId}` and event names like `notification:new`. That works here, but it is not easy to lift into another project without modifying multiple files.

**Evidence**

- `src/notifications/notifications.service.ts`
- `src/notifications/pusher.service.ts`
- `src/notifications/notifications.gateway.ts`

**Why this matters**

Reusability is a stated requirement. The current shape forces another project to adopt the same channel conventions and the same internal service structure.

**Solve**

- Split the module into smaller services:
  - query/read service
  - command/write service
  - preference service
  - realtime publisher adapter
- Move channel names and event names to constants or config.
- Expose an interface like `NotificationRealtimePort` so Pusher can be swapped later without touching business logic.

---

### NTF-10. Realtime publish failures are only logged, so there is no durable delivery fallback

**Files:** `src/notifications/notifications.service.ts`, `src/notifications/pusher.service.ts`

**Problem**

Notification rows are saved first, then realtime emission is attempted. If Pusher fails, the user may miss the live event and there is no queued retry, outbox table, or background recovery path.

**Evidence**

- `src/notifications/notifications.service.ts:47-55`
- `src/notifications/notifications.service.ts:185-192`
- `src/notifications/notifications.service.ts:218-223`
- `src/notifications/notifications.service.ts:253-259`
- `src/notifications/pusher.service.ts:87-108`

**Why this matters**

On serverless and free hosting, transient failures are common. Logging alone is not enough if realtime delivery is part of the user experience contract.

**Solve**

- Add an outbox table or queue-backed publisher.
- Keep notification persistence and realtime delivery decoupled.
- Make the frontend resilient by always fetching unread counts and notification lists on page load, not only relying on push events.

---

## Per-Endpoint Rate Limit Review

The table below shows a practical serverless-friendly throttle profile. The exact numbers can be tuned, but the key point is that each endpoint should have its own policy.

| Endpoint | Current Risk | Recommended Policy |
|---|---|---|
| `GET /notifications` | Medium read pressure | Moderate user-based limit, cache-friendly |
| `GET /notifications/paginated` | Legacy path, same read pressure | Keep low or deprecate hard |
| `GET /notifications/unread-count` | Often polled | Small burst limit, short cache TTL |
| `PATCH /notifications/:id/read` | Write spam / abuse | Strict per-user limit |
| `PATCH /notifications/read-all` | High-impact write | Very strict per-user limit |
| `DELETE /notifications/:id` | Write spam / abuse | Strict per-user limit |
| `GET /notifications/preferences` | Low risk | Moderate read limit |
| `PATCH /notifications/preferences` | Write spam / abuse | Strict per-user limit |
| `POST /admin/notifications/send` | Privileged write | Very strict admin limit |
| `POST /admin/notifications/broadcast` | Highest blast radius | Extremely strict admin limit with audit logging |
| `GET /admin/notifications` | Admin listing | Moderate admin limit |
| `DELETE /admin/notifications/:id` | Privileged destructive action | Strict admin limit |
| `POST /pusher/auth` | Reconnect spam | Low burst limit, user-based if possible |

---

## Socket.IO Cleanup Check

I did not find Socket.IO usage in `src/notifications/`.

That means the module is already in the correct Pusher direction. If Socket.IO exists elsewhere in the codebase or in stale dependencies, remove it from the realtime path entirely to keep deployment simpler and avoid maintaining two realtime stacks.

---

## Reusability Checklist

To make this module easy to reuse in another project:

- Keep persistence, realtime transport, and controller shape separate.
- Move event names and channel names into constants or config.
- Replace hardcoded project terms with neutral names where possible.
- Add a `NotificationRealtimePort` interface so Pusher is just one adapter.
- Avoid leaking domain-specific event contracts into the broadcast API.
- Keep DTOs focused on API input, not transport internals.

---

## Recommended Priority Order

1. Fix the Pusher auth blacklist gap.
2. Repair the broken system-wide broadcast path.
3. Add endpoint-specific throttling and move throttling state to a shared store if needed.
4. Remove blocking realtime retry from the request path.
5. Add composite indexes for the common notification queries.
6. Fix `PATCH /notifications/preferences` to accept a body payload.
7. Stabilize cursor pagination with a compound cursor.
8. Replace internal error leakage with generic client errors and structured server logs.
9. Split the module into reusable pieces and isolate the Pusher adapter.

