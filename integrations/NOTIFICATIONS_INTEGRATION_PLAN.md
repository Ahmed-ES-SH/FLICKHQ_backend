# Notifications Module Frontend Integration Plan

This document is a comprehensive integration guide for the frontend developer connecting to the NestJS Backend **Notifications** APIs. It maps to the backend files in [src/notifications](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications).

> **Two transports — same module**
> 1. **REST** under the global prefix `/api` — source of truth for reads/writes.
> 2. **Pusher** — realtime push for `new / read / read_all / count / delete / payment:status` and public system-wide broadcasts.
>
> The frontend must implement **both**: REST for any user interaction, Pusher for live UI updates.

---

## Core Authentication & Authorization

The notifications module exposes three groups of routes:

1. **Client routes (`/notifications/*`)** – Any authenticated user. Operates on `req.user.id`.
   - Authentication: JWT delivered via the cookie `sanad_auth_token` (or `AUTH_TOKEN` env override). Issued by [auth.public.controller.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/auth/auth.public.controller.ts).
   - API client: must enable `withCredentials: true` (Axios) / `credentials: 'include'` (Fetch).
2. **Admin routes (`/admin/notifications/*`)** – Restricted to `ADMIN` only.
   - Authentication: same cookie.
   - Role: enforced by [`RolesGuard`](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/auth/guards/roles.guard.ts) + `@Roles(UserRoleEnum.ADMIN)`.
3. **Pusher auth route (`/pusher/auth`)** – Any authenticated user (passes the same cookie). Verifies that the requested Pusher channel's user id equals the JWT's user id.

> Global `AuthGuard` and global `ValidationPipe` are mounted in [src/main.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/main.ts). All bodies are `application/json` and all unknown fields are rejected (`forbidNonWhitelisted: true`).

---

## Response & Error Envelopes

### Success envelope
The global [`TransformInterceptor`](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/common/interceptors/transform.interceptor.ts) wraps every successful response in a `{ data, meta? }` shape. The `meta` block is present only on paginated endpoints.

```json
{
  "data": [ /* the actual payload */ ]
}
```

```json
{
  "data": [ /* items */ ],
  "meta": {
    "nextCursor": "2026-06-07T09:00:00.000Z",
    "hasMore": true,
    "limit": 20
  }
}
```

> The `204 No Content` endpoints (soft-delete, hard-delete) have **no body**.

### Error envelope
The global [`GlobalExceptionFilter`](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/common/filters/global-exception.filter.ts) normalizes every error to:

```json
{
  "statusCode": 400,
  "message": "title should not be empty",
  "errors": [
    { "field": "title", "message": "title should not be empty" }
  ],
  "timestamp": "2026-06-07T10:30:00.000Z",
  "path": "/api/notifications"
}
```

`message` is `string` for one error, or `string[]` for validation errors from `class-validator`. The `errors` array is added when the underlying `HttpException` provides an array `message`.

---

## Data Models

### 1. `Notification` (entity → `notifications` table)
Mapped from [notification.schema.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/schema/notification.schema.ts).

| Field | Type | Nullable | Description |
| :--- | :--- | :---: | :--- |
| `id` | `string` (UUID) | No | Primary key |
| `userId` | `string` (UUID) | No | Owner of the notification |
| `type` | `NotificationType` (enum) | No | One of: `ORDER_UPDATED`, `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `SYSTEM`, `BROADCAST` |
| `title` | `string` | No | Short headline, max 255 chars |
| `message` | `string` | No | Full body, text |
| `data` | `Record<string, unknown> \| null` | Yes | Free-form per-type metadata (JSONB) |
| `isRead` | `boolean` | No | Default `false` |
| `readAt` | `string` (ISO 8601) \| `null` | Yes | Timestamp of first read |
| `isDeleted` | `boolean` | No | Used for **soft** delete — never returned by REST |
| `createdAt` | `string` (ISO 8601) | No | Creation timestamp |
| `updatedAt` | `string` (ISO 8601) | No | Last modification timestamp |

> Soft-deleted rows are filtered out by every list endpoint. `isDeleted` is **not** exposed in REST responses.

### 2. `NotificationPreferences` (entity → `notification_preferences` table)
Mapped from [notification-preferences.schema.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/schema/notification-preferences.schema.ts).

| Field | Type | Nullable | Default | Description |
| :--- | :--- | :---: | :---: | :--- |
| `id` | `string` (UUID) | No | — | Primary key |
| `userId` | `string` (UUID) | No | — | One row per user (unique) |
| `orderNotifications` | `boolean` | No | `true` | Receive order updates |
| `paymentNotifications` | `boolean` | No | `true` | Receive payment updates |
| `systemNotifications` | `boolean` | No | `true` | Receive system / broadcast messages |
| `emailEnabled` | `boolean` | No | `true` | Allow future email delivery |
| `pushEnabled` | `boolean` | No | `true` | Allow realtime Pusher push |
| `createdAt` | `string` (ISO 8601) | No | — | Creation timestamp |
| `updatedAt` | `string` (ISO 8601) | No | — | Last modification timestamp |

> If no row exists for a user, the backend **auto-creates** the row with all flags `true` and returns it.

### 3. Enums

```ts
// notification-type.enum.ts
export enum NotificationType {
  ORDER_UPDATED   = 'ORDER_UPDATED',
  PAYMENT_SUCCESS = 'PAYMENT_SUCCESS',
  PAYMENT_FAILED  = 'PAYMENT_FAILED',
  SYSTEM          = 'SYSTEM',
  BROADCAST       = 'BROADCAST',
}
```

```ts
// auth/types/UserRoleEnum.ts
export enum UserRoleEnum {
  USER  = 'USER',
  ADMIN = 'ADMIN',
}
```

### 4. Internal Nest events (for backend reference)
`events/notification.events.ts` — emitted by other modules and consumed by `NotificationsService` to auto-create notifications:

```ts
export enum NOTIFICATION_EVENTS {
  ORDER_UPDATED   = 'notification.order.updated',
  PAYMENT_SUCCESS = 'notification.payment.success',
  PAYMENT_FAILED  = 'notification.payment.failed',
}
```

---

## Endpoint Summary Table

| HTTP Method | Route | Auth | Role | Description |
| :--- | :--- | :---: | :---: | :--- |
| **GET** | `/notifications` | Yes | Any | Cursor-paginated list of the current user's notifications (recommended) |
| **GET** | `/notifications/paginated` | Yes | Any | Offset-paginated list (deprecated — do not use) |
| **GET** | `/notifications/unread-count` | Yes | Any | Returns the unread count for the bell badge |
| **PATCH** | `/notifications/:id/read` | Yes | Any | Mark a single notification as read |
| **PATCH** | `/notifications/read-all` | Yes | Any | Mark all of the current user's notifications as read |
| **DELETE** | `/notifications/:id` | Yes | Any | Soft-delete a single notification |
| **GET** | `/notifications/preferences` | Yes | Any | Get the current user's notification preferences |
| **PATCH** | `/notifications/preferences` | Yes | Any | Update the current user's notification preferences (see note) |
| **POST** | `/admin/notifications/send` | Yes | `ADMIN` | Create a notification for a specific user |
| **POST** | `/admin/notifications/broadcast` | Yes | `ADMIN` | Send to a list of users OR emit a system-wide event |
| **GET** | `/admin/notifications` | Yes | `ADMIN` | List all notifications in the system (paginated) |
| **DELETE** | `/admin/notifications/:id` | Yes | `ADMIN` | Hard-delete a notification |
| **POST** | `/pusher/auth` | Yes | Any | Pusher private channel auth (called automatically by `pusher-js`) |

> **Important — `PATCH /notifications/preferences` quirk**
> The controller binds the `UpdatePreferencesDto` with `@Query()` (not `@Body()`), so the five boolean flags **must be sent as query-string parameters** (e.g. `?orderNotifications=true&pushEnabled=false`). A `Content-Type: application/json` body will be ignored.

---

## Endpoint Specifications — Client (Authenticated User)

### 1. List My Notifications — Cursor (Recommended)
Returns the current user's notifications, newest first. Use the cursor pattern for infinite scroll.

* **Endpoint:** `GET /api/notifications`
* **Authentication:** Required (Cookie: `sanad_auth_token`)
* **Source:** [notifications.client.controller.ts:30](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.client.controller.ts)
* **DTO:** [cursor-pagination.dto.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/dto/cursor-pagination.dto.ts)

#### Query Parameters

| Parameter | Type | Required | Default | Constraints | Description |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `cursor` | `string` (ISO 8601) | No | — | `IsDateString` | Pass `meta.nextCursor` from the previous page. Omit for the first page. |
| `limit` | `integer` | No | `20` | `1 ≤ limit ≤ 50` | Page size. |

#### Responses

* **`200 OK`** — Paginated notifications.
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
        "nextCursor": "2026-06-07T10:18:00.000Z",
        "hasMore": true,
        "limit": 20
      }
    }
    ```
* **Empty first page**
    ```json
    {
      "data": [],
      "meta": { "nextCursor": null, "hasMore": false, "limit": 20 }
    }
    ```
* **`401 Unauthorized`** — Cookie missing or expired.
    ```json
    { "statusCode": 401, "message": "Authentication cookie not found" }
    ```

#### Frontend Recipe
```ts
let cursor: string | null = null;
async function loadNextPage() {
  const qs = new URLSearchParams();
  if (cursor) qs.set('cursor', cursor);
  qs.set('limit', '20');
  const { data, meta } = await api.get(`/notifications?${qs}`);
  // append data, then:
  cursor = meta.hasMore ? meta.nextCursor : null;
}
```

---

### 2. List My Notifications — Offset (Deprecated)
* **Endpoint:** `GET /api/notifications/paginated`
* **Authentication:** Required
* **Source:** [notifications.client.controller.ts:53](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.client.controller.ts)
* **Status:** `@deprecated` — backend comment instructs using the cursor endpoint.

#### Query Parameters

| Parameter | Type | Required | Default | Constraints |
| :--- | :--- | :---: | :---: | :--- |
| `page` | `integer` | No | `1` | `≥ 1` |
| `limit` | `integer` | No | `20` | `1 ≤ limit ≤ 100` |

#### Responses

* **`200 OK`**
    ```json
    {
      "data": [ /* Notification objects, same shape as endpoint 1 */ ],
      "total": 142,
      "page": 1,
      "limit": 20
    }
    ```
* **`401 Unauthorized`**

> ⚠️ Do not call this endpoint in new code.

---

### 3. Get Unread Count
* **Endpoint:** `GET /api/notifications/unread-count`
* **Authentication:** Required
* **Source:** [notifications.client.controller.ts:67](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.client.controller.ts)

#### Query Parameters
None.

#### Responses

* **`200 OK`**
    ```json
    { "data": { "unreadCount": 7 } }
    ```
* **`401 Unauthorized`**

#### Use Case
Badge on the bell icon. Initialise once on app load, then keep in sync with the realtime `notification:count` event (see Realtime section).

---

### 4. Mark One Notification as Read
* **Endpoint:** `PATCH /api/notifications/:id/read`
* **Authentication:** Required
* **Source:** [notifications.client.controller.ts:75](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.client.controller.ts)

#### Path Parameters

| Parameter | Type | Required | Validation | Description |
| :--- | :--- | :---: | :--- | :--- |
| `id` | `string` (UUID) | Yes | `ParseUUIDPipe` | Target notification id |

#### Request Body
None.

#### Responses

* **`200 OK`** — Updated notification.
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
* **`400 Bad Request`** — `id` is not a valid UUID.
    ```json
    { "statusCode": 400, "message": "Validation failed (uuid is expected)" }
    ```
* **`401 Unauthorized`**
* **`403 Forbidden`** — Notification belongs to another user.
    ```json
    { "statusCode": 403, "message": "You can only mark your own notifications as read" }
    ```
* **`404 Not Found`** — Notification missing or already soft-deleted.
    ```json
    { "statusCode": 404, "message": "Notification not found" }
    ```

#### Realtime Side Effects
- `notification:read` is emitted on `private-user-{userId}`.
- `notification:count` is emitted on the same channel with the new unread count.

---

### 5. Mark All Notifications as Read
* **Endpoint:** `PATCH /api/notifications/read-all`
* **Authentication:** Required
* **Source:** [notifications.client.controller.ts:86](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.client.controller.ts)

#### Path / Body
None.

#### Responses

* **`200 OK`**
    ```json
    { "data": { "success": true } }
    ```
* **`401 Unauthorized`**

#### Realtime Side Effects
- `notification:read_all` is emitted.
- `notification:count` is emitted with `unreadCount: 0`.

---

### 6. Soft-Delete a Notification
* **Endpoint:** `DELETE /api/notifications/:id`
* **Authentication:** Required
* **Source:** [notifications.client.controller.ts:95](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.client.controller.ts)

#### Path Parameters

| Parameter | Type | Required | Validation |
| :--- | :--- | :---: | :--- |
| `id` | `string` (UUID) | Yes | `ParseUUIDPipe` |

#### Request Body
None.

#### Responses

* **`204 No Content`** — Empty body.
* **`400 Bad Request`** — Invalid UUID.
* **`401 Unauthorized`**
* **`403 Forbidden`** — Notification belongs to another user.
* **`404 Not Found`**

#### Realtime Side Effects
- `notification:delete` is emitted.
- `notification:count` is emitted with the new unread count.

---

### 7. Get Notification Preferences
* **Endpoint:** `GET /api/notifications/preferences`
* **Authentication:** Required
* **Source:** [notifications.client.controller.ts:106](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.client.controller.ts)

#### Responses

* **`200 OK`**
    ```json
    {
      "data": {
        "id": "0c4f0c5b-1234-4abc-9999-aabbccddeeff",
        "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
        "orderNotifications": true,
        "paymentNotifications": true,
        "systemNotifications": true,
        "emailEnabled": true,
        "pushEnabled": true,
        "createdAt": "2026-06-01T08:00:00.000Z",
        "updatedAt": "2026-06-01T08:00:00.000Z"
      }
    }
    ```
* **`401 Unauthorized`**

> If the user has no row yet, the backend auto-creates a default row (all flags `true`) and returns it.

---

### 8. Update Notification Preferences  *(query-string PATCH)*
* **Endpoint:** `PATCH /api/notifications/preferences`
* **Authentication:** Required
* **Source:** [notifications.client.controller.ts:113](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.client.controller.ts)
* **DTO:** [update-preferences.dto.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/dto/update-preferences.dto.ts)

> ⚠️ The controller binds the DTO with `@Query()` — send booleans as **query-string parameters**, not a JSON body.

#### Query Parameters (all optional, partial update)

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `orderNotifications` | `boolean` (`"true"` / `"false"`) | No | Receive order updates |
| `paymentNotifications` | `boolean` | No | Receive payment updates |
| `systemNotifications` | `boolean` | No | Receive system / broadcast messages |
| `emailEnabled` | `boolean` | No | Allow email delivery |
| `pushEnabled` | `boolean` | No | Allow realtime Pusher push |

#### Request Example
```http
PATCH /api/notifications/preferences?emailEnabled=false&pushEnabled=true
```

#### Responses

* **`200 OK`**
    ```json
    {
      "data": {
        "id": "0c4f0c5b-1234-4abc-9999-aabbccddeeff",
        "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
        "orderNotifications": true,
        "paymentNotifications": true,
        "systemNotifications": true,
        "emailEnabled": false,
        "pushEnabled": true,
        "createdAt": "2026-06-01T08:00:00.000Z",
        "updatedAt": "2026-06-07T10:30:00.000Z"
      }
    }
    ```
* **`400 Bad Request`** — Any value that is not the string `"true"` / `"false"`.
    ```json
    {
      "statusCode": 400,
      "message": ["emailEnabled must be a boolean value"],
      "errors": [{ "field": "emailEnabled", "message": "emailEnabled must be a boolean value" }]
    }
    ```
* **`401 Unauthorized`**

---

## Endpoint Specifications — Admin (`ADMIN` role)

> All admin routes require the same JWT cookie **and** role `ADMIN`. The `RolesGuard` returns `403 Forbidden` if the role does not match.

### 9. Send Notification to a Specific User
* **Endpoint:** `POST /api/admin/notifications/send`
* **Authentication:** Required
* **Role Required:** `ADMIN`
* **Source:** [notifications.controller.ts:37](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.controller.ts)
* **DTO:** [create-notification.dto.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/dto/create-notification.dto.ts)

#### Request Body (JSON)

| Field | Type | Required | Validation | Description |
| :--- | :--- | :---: | :--- | :--- |
| `userId` | `string` (UUID) | Yes | `@IsNotEmpty @IsString` | Target user id |
| `type` | `NotificationType` (enum) | Yes | `@IsEnum` | One of `ORDER_UPDATED`, `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `SYSTEM`, `BROADCAST` |
| `title` | `string` | Yes | `@IsNotEmpty @IsString` | Headline (max 255) |
| `message` | `string` | Yes | `@IsNotEmpty @IsString` | Full body (text) |
| `data` | `object` | No | `@IsObject` | Free-form metadata, stored as JSONB |

#### Request Example
```json
{
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "type": "SYSTEM",
  "title": "Maintenance window",
  "message": "We will be down 30 minutes at 02:00 UTC.",
  "data": { "windowStart": "2026-06-10T02:00:00.000Z" }
}
```

#### Responses

* **`201 Created`** — The created notification row.
    ```json
    {
      "data": {
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
    }
    ```
* **`400 Bad Request`** — Validation error.
    ```json
    {
      "statusCode": 400,
      "message": ["type must be a valid enum value", "title should not be empty"],
      "errors": [
        { "field": "type", "message": "type must be a valid enum value" },
        { "field": "title", "message": "title should not be empty" }
      ]
    }
    ```
* **`401 Unauthorized`**
* **`403 Forbidden`** — Caller is not `ADMIN`.
    ```json
    { "statusCode": 403, "message": "Forbidden resource" }
    ```

#### Realtime Side Effects
- `notification:new` is emitted on `private-user-{userId}` (per the `NotificationsGateway.emitToUser` path).

---

### 10. Broadcast Notification
* **Endpoint:** `POST /api/admin/notifications/broadcast`
* **Authentication:** Required
* **Role Required:** `ADMIN`
* **Source:** [notifications.controller.ts:44](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.controller.ts)
* **DTO:** [broadcast-notification.dto.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/dto/broadcast-notification.dto.ts)

This endpoint has **two modes** based on `targetUserIds`:

#### Mode A — Targeted (per-user rows + per-user Pusher events)

#### Request Body (JSON)

| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `title` | `string` | Yes | Non-empty headline |
| `message` | `string` | Yes | Non-empty body |
| `targetUserIds` | `string[]` (UUID[]) | No | If provided & non-empty → creates one DB row per user (type `BROADCAST`) and emits one Pusher event per user. |
| `data` | `object` | No | Free-form metadata stored on each row |

#### Request Example (targeted)
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

#### Mode B — System-wide (no DB rows; emits internal event)

#### Request Example (system-wide)
```json
{ "title": "Heads up", "message": "New feature released." }
```

#### Responses (both modes)

* **`200 OK`**
    ```json
    { "data": { "success": true } }
    ```
* **`400 Bad Request`** — `title` or `message` missing/empty.
* **`401 Unauthorized`**
* **`403 Forbidden`**

#### Realtime Side Effects
- **Mode A (targeted):** One `notification:new` event per `userId` on `private-user-{userId}` + one DB row per user (type `BROADCAST`).
- **Mode B (system-wide):** Backend emits the **internal** Nest event `notification.order.updated` (handled by `NotificationsService.handleOrderUpdated`). This module **does not** fan out a Pusher event in this branch — other consumer modules may translate it.

---

### 11. List All Notifications (Admin)
* **Endpoint:** `GET /api/admin/notifications`
* **Authentication:** Required
* **Role Required:** `ADMIN`
* **Source:** [notifications.controller.ts:58](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.controller.ts)
* **DTO:** [paginate-notifications.dto.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/dto/paginate-notifications.dto.ts)

#### Query Parameters

| Parameter | Type | Required | Default | Constraints |
| :--- | :--- | :---: | :---: | :--- |
| `page` | `integer` | No | `1` | `≥ 1` |
| `limit` | `integer` | No | `20` | `1 ≤ limit ≤ 100` |

#### Responses

* **`200 OK`**
    ```json
    {
      "data": [ /* Notification objects */ ],
      "total": 1024,
      "page": 1,
      "limit": 20
    }
    ```
* **`401 Unauthorized`**
* **`403 Forbidden`**

> No realtime event is emitted on this read endpoint.

---

### 12. Hard-Delete a Notification (Admin)
* **Endpoint:** `DELETE /api/admin/notifications/:id`
* **Authentication:** Required
* **Role Required:** `ADMIN`
* **Source:** [notifications.controller.ts:65](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.controller.ts)

#### Path Parameters

| Parameter | Type | Required | Validation |
| :--- | :--- | :---: | :--- |
| `id` | `string` (UUID) | Yes | `ParseUUIDPipe` |

#### Responses

* **`204 No Content`** — Empty body.
* **`400 Bad Request`** — Invalid UUID.
* **`401 Unauthorized`**
* **`403 Forbidden`**
* **`404 Not Found`**
    ```json
    { "statusCode": 404, "message": "Notification not found" }
    ```

> No realtime event is emitted for admin hard-delete. Frontend admin tables should re-fetch after success.

---

## Endpoint Specifications — Pusher Auth

### 13. Authorize a Pusher Private Channel
This endpoint is **called automatically by `pusher-js`** whenever the client subscribes to a `private-*` channel. You normally do not call it manually.

* **Endpoint:** `POST /api/pusher/auth`
* **Authentication:** Required (Cookie: `sanad_auth_token`)
* **Source:** [pusher.auth.controller.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/pusher.auth.controller.ts)

#### Request Body (sent by pusher-js, `application/x-www-form-urlencoded`)

| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `socket_id` | `string` | Yes | Pusher socket id (e.g. `1234.5678`) |
| `channel_name` | `string` | Yes | Must be `private-user-{currentUserId}` |

#### Request Example
```json
{
  "socket_id": "1234.5678",
  "channel_name": "private-user-0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b"
}
```

#### Responses

* **`200 OK`** — Pusher's standard auth shape (returned as the raw body, **not** wrapped in the `{ data }` envelope — this endpoint is a passthrough to `pusher.authorizeChannel`).
    ```json
    { "auth": "APP_KEY:HMAC_SIGNATURE" }
    ```
* **`400 Bad Request`** — `channel_name` or `socket_id` missing.
* **`401 Unauthorized`** — Cookie missing/expired.
* **`403 Forbidden`** — `channel_name` user id ≠ JWT user id (anti-snooping).
    ```json
    { "statusCode": 403, "message": "You can only subscribe to your own notification channel" }
    ```

---

## Realtime Integration (Pusher)

### 13.1 Environment / Config

| Key | Example | Where the frontend gets it |
| :--- | :--- | :--- |
| `PUSHER_KEY` | Public Pusher app key | Backend `/api` config endpoint or frontend env |
| `PUSHER_CLUSTER` | `eu`, `us2`, `ap3`, … | Same as above |
| `PUSHER_AUTH_URL` | `https://api.example.com/api/pusher/auth` | Build-time env |
| Current `userId` | From logged-in user (JWT `id`) | App state |
| `PUSHER_SECRET` | — | **NEVER** exposed to the frontend |

### 13.2 Channels

| Channel | Auth | Purpose |
| :--- | :--- | :--- |
| `private-user-{userId}` | Required (this user only) | Personal notifications + read/count/delete deltas + `payment:status` |
| `broadcast` | None (public) | System-wide admin broadcasts (no per-user rows) |

> The backend will **403** any `private-user-{X}` subscription where `X` ≠ authenticated user id.

### 13.3 Frontend Initialization (TypeScript)

```ts
import Pusher from 'pusher-js';

const pusher = new Pusher(import.meta.env.VITE_PUSHER_KEY, {
  cluster: import.meta.env.VITE_PUSHER_CLUSTER,
  authEndpoint: `${import.meta.env.VITE_API_URL}/api/pusher/auth`,
  forceTLS: true,
  withCredentials: true,           // sends the auth cookie
});

const channel = pusher.subscribe(`private-user-${currentUserId}`);

pusher.connection.bind('error', (err) => {
  console.error('Pusher error', err);
});
```

### 13.4 Realtime Event Payloads

All payloads include `eventId` (UUID), `userId` (where relevant), and `timestamp` (ISO 8601). The backend injects these server-side — do not generate them on the client.

#### `notification:new` — on `private-user-{userId}`
Emitted whenever a new notification is created for this user (admin send, broadcast-targeted, or internal Nest event).
```json
{
  "eventId": "f3c1c2a0-1234-4abc-9999-aabbccddeeff",
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "notificationId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "type": "PAYMENT_SUCCESS",
  "title": "Payment received",
  "message": "We charged $19.99 successfully.",
  "data": { "paymentId": "pi_123", "amount": 19.99 },
  "timestamp": "2026-06-07T10:40:00.000Z"
}
```

#### `notification:read` — on `private-user-{userId}`
Emitted after `PATCH /:id/read`.
```json
{
  "eventId": "a7c1c2a0-1234-4abc-9999-aabbccddeeff",
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "notificationId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "timestamp": "2026-06-07T10:41:00.000Z"
}
```

#### `notification:read_all` — on `private-user-{userId}`
Emitted after `PATCH /read-all`.
```json
{
  "eventId": "b8d2c2a0-1234-4abc-9999-aabbccddeeff",
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "timestamp": "2026-06-07T10:42:00.000Z"
}
```

#### `notification:count` — on `private-user-{userId}`
Emitted after **any** state change that affects the unread count: new, mark-read, mark-all-read, delete.
```json
{
  "eventId": "c9e3c2a0-1234-4abc-9999-aabbccddeeff",
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "unreadCount": 3,
  "timestamp": "2026-06-07T10:43:00.000Z"
}
```

#### `notification:delete` — on `private-user-{userId}`
Emitted after `DELETE /:id`.
```json
{
  "eventId": "d0f4c2a0-1234-4abc-9999-aabbccddeeff",
  "userId": "0c0a1f2e-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
  "notificationId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "timestamp": "2026-06-07T10:44:00.000Z"
}
```

#### `payment:status` — on `private-user-{userId}`
Emitted by the billing module on Stripe webhook outcomes (independent of the notifications feed).
```json
{
  "eventId": "e1a5c2a0-1234-4abc-9999-aabbccddeeff",
  "status": "succeeded",                 // "succeeded" | "failed" | "refunded"
  "amount": 1999,                        // minor units (e.g. cents)
  "description": "Pro plan monthly",
  "timestamp": "2026-06-07T10:45:00.000Z"
}
```

#### `notification:new` on `broadcast` (public channel)
System-wide broadcast payload — **no `userId` field** is present.
```json
{
  "eventId": "f2b6c2a0-1234-4abc-9999-aabbccddeeff",
  "title": "New feature released",
  "message": "Try the new dashboard!",
  "data": { "version": "2.0" },
  "timestamp": "2026-06-07T10:46:00.000Z"
}
```

### 13.5 Recommended Frontend Subscription Pattern

```ts
channel.bind('notification:new',   (p) => { /* prepend to list, badge++ */ });
channel.bind('notification:read',  (p) => { /* patch row in cache      */ });
channel.bind('notification:read_all', () => { /* mark all read in cache */ });
channel.bind('notification:count', (p) => { /* set badge = p.unreadCount */ });
channel.bind('notification:delete',(p) => { /* remove from cache        */ });
channel.bind('payment:status',     (p) => { /* toast + open billing UI */ });

const broadcast = pusher.subscribe('broadcast');
broadcast.bind('notification:new', (p) => { /* show global banner */ });
```

### 13.6 Reconnection & Error Handling
- `pusher-js` auto-reconnects; bind a global `pusher.connection.bind('error', …)` to surface a UI banner.
- The backend uses **3-retry exponential backoff** (500/1000/2000 ms) before giving up — see [pusher.service.ts:39](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/pusher.service.ts).
- If Pusher is down, **REST still works**. On `visibilitychange` (tab focus) and after every mutation, refetch the notifications list and unread count to recover any missed events.
- On logout: `pusher.unsubscribe(channelName)` and `pusher.disconnect()`.

---

## TypeScript Contracts (Copy-Paste Ready)

```ts
// ---------- Enums ----------
export type NotificationType =
  | 'ORDER_UPDATED'
  | 'PAYMENT_SUCCESS'
  | 'PAYMENT_FAILED'
  | 'SYSTEM'
  | 'BROADCAST';

// ---------- REST payloads ----------
export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;   // ISO 8601
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
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

// Note: UpdatePreferencesDto is bound to @Query() on the controller,
// so the frontend sends these as query-string params, not a JSON body.
export interface UpdatePreferencesQuery {
  orderNotifications?: boolean;
  paymentNotifications?: boolean;
  systemNotifications?: boolean;
  emailEnabled?: boolean;
  pushEnabled?: boolean;
}

// ---------- Pusher realtime payloads ----------
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
  amount: number;          // minor units
  description: string;
  timestamp: string;
}

// Public broadcast payload has no userId
export interface PusherBroadcastNew {
  eventId: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}
```

---

## Quick Cheat-Sheet

| Method | Path | Auth | Body / Query | Success |
| :--- | :--- | :---: | :--- | :---: |
| GET | `/api/notifications` | User | `cursor?`, `limit?` | 200 cursor |
| GET | `/api/notifications/paginated` | User (legacy) | `page?`, `limit?` | 200 offset |
| GET | `/api/notifications/unread-count` | User | — | 200 `{unreadCount}` |
| PATCH | `/api/notifications/:id/read` | User | — | 200 Notification |
| PATCH | `/api/notifications/read-all` | User | — | 200 `{success:true}` |
| DELETE | `/api/notifications/:id` | User | — | 204 |
| GET | `/api/notifications/preferences` | User | — | 200 Preferences |
| PATCH | `/api/notifications/preferences` | User | query-string booleans | 200 Preferences |
| POST | `/api/admin/notifications/send` | Admin | `CreateNotificationPayload` | 201 Notification |
| POST | `/api/admin/notifications/broadcast` | Admin | `BroadcastNotificationPayload` | 200 `{success:true}` |
| GET | `/api/admin/notifications` | Admin | `page?`, `limit?` | 200 offset |
| DELETE | `/api/admin/notifications/:id` | Admin | — | 204 |
| POST | `/api/pusher/auth` | User | `{socket_id, channel_name}` (form) | 200 pusher `{auth}` |

---

## Implementation Checklist for the Frontend

- [ ] Configure HTTP client (`axios` / `fetch`) with `baseURL = <backend>` and `withCredentials = true`.
- [ ] Ensure the `sanad_auth_token` HttpOnly cookie is set by the auth flow (backend sets it on login).
- [ ] Read public Pusher config (`PUSHER_KEY`, `PUSHER_CLUSTER`, auth URL) from a frontend env file.
- [ ] Create a **single Pusher instance per app load**; subscribe to `private-user-{me.id}` **after** auth state is known.
- [ ] Build a `useNotifications` (or equivalent) module that:
  - Calls `GET /notifications` (cursor) for the first page.
  - Maintains a normalized cache keyed by `id`.
  - Maintains a `unreadCount` (initialised from `GET /unread-count`, kept in sync via `notification:count`).
  - Applies optimistic updates for mark-as-read / delete, then reconciles with the REST response and any realtime events.
  - Implements infinite scroll by re-fetching with `meta.nextCursor` when `hasMore === true`.
- [ ] Settings page: GET / PATCH `/preferences` (remember: PATCH sends booleans via query string).
- [ ] Admin pages (gated by a frontend role check): call admin endpoints and render a system-wide banner on the public `broadcast` channel.
- [ ] Graceful failure: if Pusher is offline, refetch on `visibilitychange` and after every mutation.
- [ ] On logout: `pusher.unsubscribe(...)` for every channel and `pusher.disconnect()`.
- [ ] Reuse the TypeScript types from the **TypeScript Contracts** section in the shared types package.
- [ ] Manual test matrix:
  - [ ] New notification appears without refresh (realtime)
  - [ ] Mark one as read → row updates + badge decrements
  - [ ] Mark all as read → badge = 0, all rows show as read
  - [ ] Delete → row disappears + badge decrements
  - [ ] Preferences toggles persist after refresh
  - [ ] Admin sends to self → realtime fires on own channel
  - [ ] Admin broadcasts (targeted) → only listed users receive
  - [ ] Admin broadcasts (system-wide) → global banner shows for everyone
  - [ ] Attempting to subscribe to another user's channel → 403 (handled silently)
  - [ ] `payment:status` toasts trigger on Stripe webhook outcomes

---

## Source Map (Backend Reference)

| Concern | File |
| :--- | :--- |
| Bootstrap, global prefix `/api`, CORS, cookies | [src/main.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/main.ts) |
| Module wiring (TypeORM, JwtModule, Pusher client) | [src/notifications/notifications.module.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.module.ts) |
| Client REST controller | [src/notifications/notifications.client.controller.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.client.controller.ts) |
| Admin REST controller | [src/notifications/notifications.controller.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.controller.ts) |
| Business logic & Nest event handlers | [src/notifications/notifications.service.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.service.ts) |
| Pusher REST auth (channel ownership check) | [src/notifications/pusher.auth.controller.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/pusher.auth.controller.ts) |
| Pusher client wrapper + retry logic | [src/notifications/pusher.service.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/pusher.service.ts) |
| Gateway façade around PusherService | [src/notifications/notifications.gateway.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/notifications.gateway.ts) |
| Pusher client factory (env-driven) | [src/config/pusher.config.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/config/pusher.config.ts) |
| DTOs (validation) | [src/notifications/dto/](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/dto) |
| Entities | [src/notifications/schema/](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/schema) |
| Enums | [src/notifications/enums/notification-type.enum.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/enums/notification-type.enum.ts) |
| Internal Nest event names | [src/notifications/events/notification.events.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/notifications/events/notification.events.ts) |
| Auth — cookie name resolution | [src/auth/strategies/jwt.strategy.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/auth/strategies/jwt.strategy.ts) |
| Auth — global guard | [src/auth/guards/auth.guard.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/auth/guards/auth.guard.ts) |
| Auth — roles guard | [src/auth/guards/roles.guard.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/auth/guards/roles.guard.ts) |
| Response envelope | [src/common/interceptors/transform.interceptor.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/common/interceptors/transform.interceptor.ts) |
| Error envelope | [src/common/filters/global-exception.filter.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/common/filters/global-exception.filter.ts) |
