# Notifications Module – Frontend Integration Plan

> **Module path:** `src/notifications`
> **Base URL (global prefix):** `/api`
> **Auth:** All routes are protected by the global `AuthGuard` — frontend must send the JWT via HttpOnly cookie named `flick_auth_token` (or `AUTH_TOKEN` env override). Use `withCredentials: true` on every request. Admin routes additionally require `RolesGuard` + role `ADMIN`.
> **Realtime transport:** Pusher (private channels + auth endpoint).
> **Content-Type:** `application/json` for all request bodies.

---

## 1. Architecture Overview

```
┌──────────────────┐                ┌────────────────────────┐
│  Frontend (Web)  │  REST (cookie) │  NestJS Notifications  │
│                  │ ─────────────► │  - /notifications      │
│   pusher-js      │ ◄───────────── │  - /admin/notifications│
│   (realtime)     │  Pusher events │  - /pusher/auth        │
└──────────────────┘                └────────────────────────┘
```

- **REST** is the source of truth for reads / writes.
- **Pusher** pushes realtime deltas (new notification, read, count, delete, payment status). The frontend should treat Pusher events as **optimistic updates** and reconcile with REST on next refetch / page focus.
- All admin actions that create notifications (send / broadcast) also fire Pusher events automatically — the frontend does **not** need to subscribe to admin events.

---

## 2. Auth Requirements (applies to every endpoint)

| Header / Cookie               | Required                  | Notes                                                                                     |
| ----------------------------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| Cookie `flick_auth_token`     | Yes                       | HttpOnly JWT issued at login. Send automatically by browser when `withCredentials: true`. |
| `Authorization: Bearer <jwt>` | Optional fallback         | Global guard currently reads from cookie only — prefer cookie flow.                       |
| `Content-Type`                | Yes (for POST/PATCH body) | `application/json`                                                                        |

> CORS allows `credentials: true` and `origin = FRONTEND_URL`. Make sure axios/fetch is configured with `withCredentials: true`.

---

## 3. Endpoints – Client (Authenticated User)

Base: `/api/notifications`
Auth: any authenticated user (operates on `req.user.id`)

### 3.1 List my notifications (cursor, **recommended**)

`GET /api/notifications`

| Param    | In    | Type              | Required | Default | Constraints      | Description                                                             |
| -------- | ----- | ----------------- | -------- | ------- | ---------------- | ----------------------------------------------------------------------- |
| `cursor` | query | string (ISO 8601) | No       | —       | `IsDateString`   | Pass `meta.nextCursor` from the previous response. Omit for first page. |
| `limit`  | query | integer           | No       | `20`    | `1 ≤ limit ≤ 50` | Page size.                                                              |

**200 OK – Response example**

```json
{
  "data": [
    {
      "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
      "type": "ORDER_UPDATED",
      "title": "Order shipped",
      "message": "Your order #1023 has been shipped.",
      "data": { "orderId": "1023", "status": "SHIPPED" },
      "isRead": false,
      "readAt": null,
      "createdAt": "2026-06-07T10:21:11.000Z",
      "updatedAt": "2026-06-07T10:21:11.000Z"
    }
  ],
  "meta": {
    "nextCursor": "2026-06-07T09:00:00.000Z",
    "hasMore": true,
    "limit": 20
  }
}
```

**Empty / first page**

```json
{
  "data": [],
  "meta": { "nextCursor": null, "hasMore": false, "limit": 20 }
}
```

**Possible errors**

- `401 Unauthorized` – missing/expired cookie.

---

### 3.2 List my notifications (offset, **DEPRECATED** – do not use in new code)

`GET /api/notifications/paginated`

| Param   | In    | Type    | Required | Default | Constraints       |
| ------- | ----- | ------- | -------- | ------- | ----------------- |
| `page`  | query | integer | No       | `1`     | `≥ 1`             |
| `limit` | query | integer | No       | `20`    | `1 ≤ limit ≤ 100` |

**200 OK – Response example**

```json
{
  "data": [
    /* same shape as 3.1 */
  ],
  "total": 142,
  "page": 1,
  "limit": 20
}
```

> The backend marks this as deprecated. Use cursor endpoint (3.1) for infinite scroll.

---

### 3.3 Unread count

`GET /api/notifications/unread-count`

No params.

**200 OK**

```json
{ "unreadCount": 7 }
```

**Use case:** badge on the bell icon. Refresh on page focus + on every `notification:count` realtime event.

---

### 3.4 Mark one as read

`PATCH /api/notifications/:id/read`

| Param | In   | Type | Required | Notes           |
| ----- | ---- | ---- | -------- | --------------- |
| `id`  | path | UUID | Yes      | `ParseUUIDPipe` |

No body.

**200 OK – Response example**

```json
{
  "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "type": "ORDER_UPDATED",
  "title": "Order shipped",
  "message": "Your order #1023 has been shipped.",
  "data": { "orderId": "1023", "status": "SHIPPED" },
  "isRead": true,
  "readAt": "2026-06-07T10:25:00.000Z",
  "createdAt": "2026-06-07T10:21:11.000Z",
  "updatedAt": "2026-06-07T10:25:00.000Z"
}
```

**Possible errors**

- `400 BadRequest` – `id` is not a UUID.
- `401 Unauthorized`.
- `403 Forbidden` – notification belongs to another user.
- `404 NotFound` – notification not found (or soft-deleted).

**Side effects (realtime):** server emits `notification:read` and `notification:count` on the same user's private channel.

---

### 3.5 Mark all as read

`PATCH /api/notifications/read-all`

No params, no body.

**200 OK**

```json
{ "success": true }
```

**Side effects (realtime):** `notification:read_all` and `notification:count` (`unreadCount: 0`).

---

### 3.6 Soft-delete a notification

`DELETE /api/notifications/:id`

| Param | In   | Type | Required | Notes           |
| ----- | ---- | ---- | -------- | --------------- |
| `id`  | path | UUID | Yes      | `ParseUUIDPipe` |

No body.

**204 No Content** on success (empty body).

**Possible errors**

- `400 BadRequest` – invalid UUID.
- `401 Unauthorized`.
- `403 Forbidden` – not your notification.
- `404 NotFound`.

**Side effects (realtime):** `notification:delete` + `notification:count` (recomputed).

---

### 3.7 Get notification preferences

`GET /api/notifications/preferences`

No params.

**200 OK – Response example**

```json
{
  "id": "0c4f...",
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "orderNotifications": true,
  "paymentNotifications": true,
  "systemNotifications": true,
  "emailEnabled": true,
  "pushEnabled": true,
  "createdAt": "2026-06-01T08:00:00.000Z",
  "updatedAt": "2026-06-01T08:00:00.000Z"
}
```

> If no row exists, backend auto-creates defaults (all `true`) and returns them.

---

### 3.8 Update notification preferences

`PATCH /api/notifications/preferences`

All fields optional, partial update (any combination accepted). Body must be a JSON object.

| Field                  | Type    | Required | Notes                                     |
| ---------------------- | ------- | -------- | ----------------------------------------- |
| `orderNotifications`   | boolean | No       | Receive order updates.                    |
| `paymentNotifications` | boolean | No       | Receive payment updates.                  |
| `systemNotifications`  | boolean | No       | Receive system / broadcast messages.      |
| `emailEnabled`         | boolean | No       | Allow email delivery (future email jobs). |
| `pushEnabled`          | boolean | No       | Allow realtime push via Pusher.           |

**Request example**

```json
{ "emailEnabled": false, "pushEnabled": true }
```

**200 OK – Response example**

```json
{
  "id": "0c4f...",
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "orderNotifications": true,
  "paymentNotifications": true,
  "systemNotifications": true,
  "emailEnabled": false,
  "pushEnabled": true,
  "createdAt": "2026-06-01T08:00:00.000Z",
  "updatedAt": "2026-06-07T10:30:00.000Z"
}
```

**Possible errors**

- `400 BadRequest` – any value not a boolean.

---

## 4. Endpoints – Admin

Base: `/api/admin/notifications`
Auth: `JwtAuthGuard` (cookie) + `RolesGuard` + role `ADMIN`.

### 4.1 Send notification to a specific user

`POST /api/admin/notifications/send`

**Request body (JSON)** – `CreateNotificationDto`

| Field     | Type                    | Required | Notes                                                                                |
| --------- | ----------------------- | -------- | ------------------------------------------------------------------------------------ |
| `userId`  | string (UUID)           | Yes      | Target user.                                                                         |
| `type`    | enum `NotificationType` | Yes      | One of: `ORDER_UPDATED`, `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `SYSTEM`, `BROADCAST`. |
| `title`   | string                  | Yes      | Non-empty.                                                                           |
| `message` | string                  | Yes      | Non-empty.                                                                           |
| `data`    | object                  | No       | Free-form metadata. Serialized as JSONB.                                             |

**Request example**

```json
{
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "type": "SYSTEM",
  "title": "Maintenance window",
  "message": "We will be down 30 minutes at 02:00 UTC.",
  "data": { "windowStart": "2026-06-10T02:00:00.000Z" }
}
```

**201 Created – Response example** (the created `Notification` row)

```json
{
  "id": "1f0e9b6c-7c3a-4b6e-8f1b-0a9d8c7b6e5d",
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "type": "SYSTEM",
  "title": "Maintenance window",
  "message": "We will be down 30 minutes at 02:00 UTC.",
  "data": { "windowStart": "2026-06-10T02:00:00.000Z" },
  "isRead": false,
  "readAt": null,
  "createdAt": "2026-06-07T10:35:00.000Z",
  "updatedAt": "2026-06-07T10:35:00.000Z"
}
```

**Possible errors**

- `400 BadRequest` – validation error (missing field, bad enum, etc.).
- `401 Unauthorized`.
- `403 Forbidden` – not admin.

**Side effects (realtime):** `notification:new` is emitted to `private-user-{userId}` automatically.

---

### 4.2 Broadcast notification

`POST /api/admin/notifications/broadcast`

| Field           | Type     | Required | Notes                                                                                                                                                                                      |
| --------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`         | string   | Yes      | Non-empty.                                                                                                                                                                                 |
| `message`       | string   | Yes      | Non-empty.                                                                                                                                                                                 |
| `targetUserIds` | string[] | No       | If provided & non-empty → send only to these users (DB rows + per-user Pusher). If omitted/empty → emit system-wide event (`notification.order.updated`); no per-user DB rows are created. |
| `data`          | object   | No       | Free-form metadata.                                                                                                                                                                        |

**Request example (targeted)**

```json
{
  "title": "Beta access",
  "message": "Your beta slot is open.",
  "targetUserIds": [
    "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
    "1d1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d"
  ],
  "data": { "campaign": "beta-2026" }
}
```

**Request example (system-wide)**

```json
{ "title": "Heads up", "message": "New feature released." }
```

**200 OK – Response example**

```json
{ "success": true }
```

**Possible errors**

- `400 BadRequest` – title/message empty.
- `401 Unauthorized`.
- `403 Forbidden` – not admin.

**Side effects (realtime)**

- Targeted: one `notification:new` per user on `private-user-{userId}` + DB row per user (type = `BROADCAST`).
- System-wide: emits internal event `notification.order.updated` (no Pusher fanout in this module — consumer modules may translate it).

---

### 4.3 List all notifications (admin, paginated)

`GET /api/admin/notifications`

| Param   | In    | Type    | Required | Default | Constraints       |
| ------- | ----- | ------- | -------- | ------- | ----------------- |
| `page`  | query | integer | No       | `1`     | `≥ 1`             |
| `limit` | query | integer | No       | `20`    | `1 ≤ limit ≤ 100` |

**200 OK – Response example**

```json
{
  "data": [
    /* Notification objects, see 3.1 shape */
  ],
  "total": 1024,
  "page": 1,
  "limit": 20
}
```

---

### 4.4 Hard delete a notification (admin)

`DELETE /api/admin/notifications/:id`

| Param | In   | Type | Required | Notes           |
| ----- | ---- | ---- | -------- | --------------- |
| `id`  | path | UUID | Yes      | `ParseUUIDPipe` |

No body.

**204 No Content** on success (empty body).

**Possible errors**

- `400 BadRequest` – invalid UUID.
- `401 Unauthorized`.
- `403 Forbidden` – not admin.
- `404 NotFound` – no such row.

> No realtime event is emitted for admin hard-delete.

---

## 5. Pusher Realtime Integration

### 5.1 Prerequisites (env / config the frontend must know)

The frontend needs to read these from a public env file or `/api` health endpoint exposed by backend:

| Key               | Source / Example                          |
| ----------------- | ----------------------------------------- |
| `PUSHER_KEY`      | Public Pusher app key                     |
| `PUSHER_CLUSTER`  | e.g. `eu`, `us2`, `ap3`                   |
| `PUSHER_AUTH_URL` | `https://api.example.com/api/pusher/auth` |
| Current `userId`  | From logged-in user (JWT `id`)            |

> `PUSHER_SECRET` is **never** exposed.

### 5.2 Channels

| Channel                 | Who subscribes          | Purpose                                                             |
| ----------------------- | ----------------------- | ------------------------------------------------------------------- |
| `private-user-{userId}` | The user with that `id` | Personal notifications + read/count/delete deltas + payment status. |
| `broadcast`             | Anyone (public channel) | System-wide broadcasts (no auth required).                          |

> Frontend **must** subscribe **only** to `private-user-{currentUserId}`. The backend will reject auth for any other user id.

### 5.3 Initializing pusher-js

```ts
import Pusher from 'pusher-js';

const pusher = new Pusher(import.meta.env.VITE_PUSHER_KEY, {
  cluster: import.meta.env.VITE_PUSHER_CLUSTER,
  authEndpoint: `${import.meta.env.VITE_API_URL}/api/pusher/auth`,
  auth: { headers: {} }, // cookie sent automatically
  forceTLS: true,
  withCredentials: true,
});

const channel = pusher.subscribe(`private-user-${currentUserId}`);
```

### 5.4 Auth endpoint – `POST /api/pusher/auth`

Triggered automatically by pusher-js on `private-*` subscription.

**Request body** (sent by pusher-js)

```json
{
  "socket_id": "1234.5678",
  "channel_name": "private-user-0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b"
}
```

**200 OK – Response example** (Pusher's standard shape)

```json
{ "auth": "APP_KEY:HMAC_SIGNATURE" }
```

**Possible errors**

- `400 BadRequest` – missing `channel_name` / `socket_id`.
- `401 Unauthorized` – missing/expired cookie.
- `403 Forbidden` – `channel_name` user id ≠ authenticated user id (anti-snooping).

### 5.5 Realtime events (payloads)

All payloads include `eventId` (uuid), `userId`, and ISO `timestamp`.

#### `notification:new` – on `private-user-{userId}`

Emitted when a notification is created for this user.

```json
{
  "eventId": "f3c1...",
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "notificationId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "type": "PAYMENT_SUCCESS",
  "title": "Payment received",
  "message": "We charged $19.99 successfully.",
  "data": { "paymentId": "pi_123", "amount": 19.99 },
  "timestamp": "2026-06-07T10:40:00.000Z"
}
```

#### `notification:read` – on `private-user-{userId}`

Emitted after `PATCH /:id/read`.

```json
{
  "eventId": "a7c1...",
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "notificationId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "timestamp": "2026-06-07T10:41:00.000Z"
}
```

#### `notification:read_all` – on `private-user-{userId}`

Emitted after `PATCH /read-all`.

```json
{
  "eventId": "b8d2...",
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "timestamp": "2026-06-07T10:42:00.000Z"
}
```

#### `notification:count` – on `private-user-{userId}`

Emitted after any state change affecting unread count (mark read, mark all, delete, new).

```json
{
  "eventId": "c9e3...",
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "unreadCount": 3,
  "timestamp": "2026-06-07T10:43:00.000Z"
}
```

#### `notification:delete` – on `private-user-{userId}`

Emitted after `DELETE /:id`.

```json
{
  "eventId": "d0f4...",
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "notificationId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "timestamp": "2026-06-07T10:44:00.000Z"
}
```

#### `payment:status` – on `private-user-{userId}`

Emitted by the billing module on Stripe webhook outcomes.

```json
{
  "eventId": "e1a5...",
  "status": "succeeded", // "succeeded" | "failed" | "refunded"
  "amount": 1999, // minor units
  "description": "Pro plan monthly",
  "timestamp": "2026-06-07T10:45:00.000Z"
}
```

#### `notification:new` on `broadcast` channel (public)

System-wide broadcast payload. No `userId` is present.

```json
{
  "eventId": "f2b6...",
  "title": "New feature released",
  "message": "Try the new dashboard!",
  "data": { "version": "2.0" },
  "timestamp": "2026-06-07T10:46:00.000Z"
}
```

### 5.6 Recommended frontend subscription pattern

```ts
channel.bind('notification:new',   (p) => /* prepend + increment badge */);
channel.bind('notification:read',  (p) => /* patch row in cache     */);
channel.bind('notification:read_all', () => /* mark all read in cache */);
channel.bind('notification:count', (p) => /* set badge = p.unreadCount */);
channel.bind('notification:delete',(p) => /* remove from cache       */);
channel.bind('payment:status',     (p) => /* toast + open billing UI */);

const broadcast = pusher.subscribe('broadcast');
broadcast.bind('notification:new', (p) => /* global banner */);
```

### 5.7 Reconnection / error handling

- Pusher SDK auto-reconnects. Bind a global error handler to surface UI banners:
  ```ts
  pusher.connection.bind('error', (err) => console.error('Pusher error', err));
  ```
- Backend uses 3-retry exponential backoff (500/1000/2000 ms) before giving up. If Pusher is down, REST still works — refresh on `visibilitychange` to recover missed events.

---

## 6. Data Model Reference

### 6.1 `Notification` (TypeORM entity → `notifications` table)

| Column      | Type                     | Notes                                                                       |
| ----------- | ------------------------ | --------------------------------------------------------------------------- |
| `id`        | UUID PK                  |                                                                             |
| `userId`    | UUID indexed             |                                                                             |
| `type`      | enum `NotificationType`  | `ORDER_UPDATED`, `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `SYSTEM`, `BROADCAST` |
| `title`     | varchar(255)             |                                                                             |
| `message`   | text                     |                                                                             |
| `data`      | jsonb, nullable          | Free-form per type.                                                         |
| `isRead`    | boolean, default `false` | DB column `is_read`.                                                        |
| `readAt`    | timestamp, nullable      | DB column `read_at`.                                                        |
| `isDeleted` | boolean, default `false` | Used for **soft** delete (client).                                          |
| `createdAt` | timestamp                | DB column `created_at`.                                                     |
| `updatedAt` | timestamp                | DB column `updated_at`.                                                     |

> ⚠️ The notification object returned by REST **does not** include `isDeleted` — soft-deleted rows are simply filtered out.

### 6.2 `NotificationPreferences` (TypeORM entity → `notification_preferences` table)

| Column                    | Type         | Default | Notes                             |
| ------------------------- | ------------ | ------- | --------------------------------- |
| `id`                      | UUID PK      |         |                                   |
| `userId`                  | UUID, unique |         | One row per user.                 |
| `orderNotifications`      | boolean      | `true`  | DB column `order_notifications`   |
| `paymentNotifications`    | boolean      | `true`  | DB column `payment_notifications` |
| `systemNotifications`     | boolean      | `true`  | DB column `system_notifications`  |
| `emailEnabled`            | boolean      | `true`  | DB column `email_enabled`         |
| `pushEnabled`             | boolean      | `true`  | DB column `push_enabled`          |
| `createdAt` / `updatedAt` | timestamp    |         |                                   |

---

## 7. TypeScript Contracts (copy-paste ready)

```ts
// NotificationType
export type NotificationType =
  | 'ORDER_UPDATED'
  | 'PAYMENT_SUCCESS'
  | 'PAYMENT_FAILED'
  | 'SYSTEM'
  | 'BROADCAST';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null; // ISO
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface CursorPaginated<T> {
  data: T[];
  meta: { nextCursor: string | null; hasMore: boolean; limit: number };
}

export interface OffsetPaginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface NotificationPreferences {
  id: string;
  userId: string;
  orderNotifications: boolean;
  paymentNotifications: boolean;
  systemNotifications: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNotificationPayload {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface BroadcastNotificationPayload {
  title: string;
  message: string;
  targetUserIds?: string[];
  data?: Record<string, unknown>;
}

export interface UpdatePreferencesPayload {
  orderNotifications?: boolean;
  paymentNotifications?: boolean;
  systemNotifications?: boolean;
  emailEnabled?: boolean;
  pushEnabled?: boolean;
}

// Pusher realtime payloads
export interface PusherNotificationNew {
  eventId: string;
  userId: string;
  notificationId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface PusherNotificationRead {
  eventId: string;
  userId: string;
  notificationId: string;
  timestamp: string;
}

export interface PusherNotificationReadAll {
  eventId: string;
  userId: string;
  timestamp: string;
}

export interface PusherNotificationCount {
  eventId: string;
  userId: string;
  unreadCount: number;
  timestamp: string;
}

export interface PusherNotificationDelete {
  eventId: string;
  userId: string;
  notificationId: string;
  timestamp: string;
}

export type PaymentStatus = 'succeeded' | 'failed' | 'refunded';

export interface PusherPaymentStatus {
  eventId: string;
  status: PaymentStatus;
  amount: number; // minor units
  description: string;
  timestamp: string;
}
```

---

## 8. Error Responses (global shape)

`GlobalExceptionFilter` produces a normalized error envelope (see `src/common/filters/global-exception.filter.ts`). Example bodies:

```json
// 400
{
  "statusCode": 400,
  "message": ["title should not be empty", "type must be a valid enum value"],
  "error": "Bad Request"
}

// 401
{ "statusCode": 401, "message": "Authentication cookie not found", "error": "Unauthorized" }

// 403
{ "statusCode": 403, "message": "You can only subscribe to your own notification channel", "error": "Forbidden" }

// 404
{ "statusCode": 404, "message": "Notification not found", "error": "Not Found" }

// 500
{ "statusCode": 500, "message": "Failed to create notification", "error": "Internal Server Error" }
```

> Note: Pusher auth errors return the raw Nest exception (no envelope), so handle both shapes if you wrap calls.

---

## 9. Full Endpoint Cheat-Sheet

| Method | Path                                 | Auth          | Body / Query                   | Success              |
| ------ | ------------------------------------ | ------------- | ------------------------------ | -------------------- |
| GET    | `/api/notifications`                 | User          | `cursor?`, `limit?`            | 200 cursor           |
| GET    | `/api/notifications/paginated`       | User (legacy) | `page?`, `limit?`              | 200 offset           |
| GET    | `/api/notifications/unread-count`    | User          | —                              | 200 `{unreadCount}`  |
| PATCH  | `/api/notifications/:id/read`        | User          | —                              | 200 Notification     |
| PATCH  | `/api/notifications/read-all`        | User          | —                              | 200 `{success:true}` |
| DELETE | `/api/notifications/:id`             | User          | —                              | 204                  |
| GET    | `/api/notifications/preferences`     | User          | —                              | 200 Preferences      |
| PATCH  | `/api/notifications/preferences`     | User          | partial prefs object           | 200 Preferences      |
| POST   | `/api/admin/notifications/send`      | Admin         | `CreateNotificationPayload`    | 201 Notification     |
| POST   | `/api/admin/notifications/broadcast` | Admin         | `BroadcastNotificationPayload` | 200 `{success:true}` |
| GET    | `/api/admin/notifications`           | Admin         | `page?`, `limit?`              | 200 offset           |
| DELETE | `/api/admin/notifications/:id`       | Admin         | —                              | 204                  |
| POST   | `/api/pusher/auth`                   | User          | `{socket_id, channel_name}`    | 200 pusher auth      |

---

## 10. Implementation Checklist for the Frontend

- [ ] Configure HTTP client (`axios` / `fetch`) with `baseURL = <backend>` and `withCredentials = true`.
- [ ] On login, ensure `flick_auth_token` cookie is set (HttpOnly, set by backend on auth).
- [ ] Read public Pusher config (`PUSHER_KEY`, `PUSHER_CLUSTER`, `auth URL`) from frontend env.
- [ ] Initialize a single Pusher instance per app load; subscribe to `private-user-{me.id}` **after** auth.
- [ ] Build a `useNotifications` (or equivalent) hook that:
  - Calls `GET /notifications` (cursor) for the first page.
  - Caches notifications in a normalized store keyed by `id`.
  - Maintains a `unreadCount` (initialized from `GET /unread-count`, kept in sync via `notification:count`).
  - Applies optimistic updates for mark-as-read / delete, then reconciles with the REST response and any realtime events.
  - Implements infinite scroll by re-fetching with `meta.nextCursor`.
- [ ] Settings page: GET / PATCH `/preferences`.
- [ ] Admin pages: separate guard on the frontend; call admin endpoints and render a system-wide toast on the public `broadcast` channel.
- [ ] Graceful failure: if Pusher is offline, refetch on `visibilitychange` and after every mutation.
- [ ] On logout, call `pusher.unsubscribe(...)` and `pusher.disconnect()`.
- [ ] TypeScript types in section 7 imported / re-declared in your shared types package.
- [ ] Manual test matrix:
  - new notification appears without refresh (realtime)
  - mark one as read → row updates + badge decrements
  - mark all as read → badge = 0, all rows show as read
  - delete → row disappears + badge decrements
  - preferences toggles persist after refresh
  - admin send to self → realtime fires on own channel
  - admin broadcast (targeted) → only listed users receive
  - attempting to subscribe to another user's channel → 403 (handled silently)

---

## 11. Source Map (for backend reference)

| Concern                         | File                                                   |
| ------------------------------- | ------------------------------------------------------ |
| Bootstrap, global prefix `/api` | `src/main.ts`                                          |
| Module wiring                   | `src/notifications/notifications.module.ts`            |
| Client REST                     | `src/notifications/notifications.client.controller.ts` |
| Admin REST                      | `src/notifications/notifications.controller.ts`        |
| Business logic                  | `src/notifications/notifications.service.ts`           |
| DTOs (validation)               | `src/notifications/dto/*.dto.ts`                       |
| Entities                        | `src/notifications/schema/*.schema.ts`                 |
| Enums                           | `src/notifications/enums/notification-type.enum.ts`    |
| Internal event names            | `src/notifications/events/notification.events.ts`      |
| Pusher integration              | `src/notifications/pusher.service.ts`                  |
| Pusher auth REST                | `src/notifications/pusher.auth.controller.ts`          |
| Pusher client factory           | `src/config/pusher.config.ts`                          |
