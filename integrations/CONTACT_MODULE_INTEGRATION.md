# Contact Module – Frontend Integration Plan

## 1. Module Overview

The `contact` module handles contact-form submissions from public visitors and gives administrators a back-office interface to read, triage, reply, and delete those messages.

| Concern             | Detail                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Base path (public)  | `/contact`                                                                                         |
| Base path (admin)   | `/admin/contact`                                                                                   |
| Auth (public)       | None (route is `@Public()`)                                                                        |
| Auth (admin)        | JWT Bearer + role `ADMIN` (enforced by `@Roles(UserRoleEnum.ADMIN)` + global `JwtAuthGuard`)       |
| Rate limit (public) | **5 submissions / hour / IP** (`@Throttle({ default: { ttl: 3600000, limit: 5 } })`)               |
| Persistence         | PostgreSQL table `contact_messages` (TypeORM, entity `ContactMessage`)                            |
| Swagger tags        | `Contact (Public)`, `Contact (Admin)`                                                              |

---

## 2. Data Model – `ContactMessage`

| Field        | Type             | Notes                                                         |
| ------------ | ---------------- | ------------------------------------------------------------- |
| `id`         | UUID string      | Primary key, auto-generated                                   |
| `fullName`   | string           | Max 100 chars                                                 |
| `email`      | string           | Valid email format, max 255 chars                             |
| `subject`    | string           | Max 200 chars                                                 |
| `message`    | string (text)    | 10–5000 chars                                                 |
| `isRead`     | boolean          | `false` on creation, indexed                                  |
| `repliedAt`  | Date \| null     | Set when admin marks message as replied                       |
| `ipAddress`  | string \| null   | Captured server-side from `X-Forwarded-For` / `request.ip`    |
| `createdAt`  | Date             | Server-set on insert                                          |
| `updatedAt`  | Date             | Server-set on every update                                    |

---

## 3. Public Endpoints

### 3.1 `POST /contact` – Submit a contact message

Submit a new contact-form message. Public, rate-limited, no auth.

**Request body (JSON)** – `CreateContactMessageDto`

| Field      | Type   | Required | Constraints                  | Notes                |
| ---------- | ------ | -------- | ---------------------------- | -------------------- |
| `fullName` | string | ✅       | 1–100 chars, non-empty       |                      |
| `email`    | string | ✅       | Valid email, max 255 chars   |                      |
| `subject`  | string | ✅       | 1–200 chars, non-empty       |                      |
| `message`  | string | ✅       | 10–5000 chars, non-empty     |                      |

**Example request**

```http
POST /contact HTTP/1.1
Host: api.example.com
Content-Type: application/json

{
  "fullName": "Jane Doe",
  "email": "jane.doe@example.com",
  "subject": "Question about pricing",
  "message": "Hello, I would like to know more about the enterprise plan pricing tiers."
}
```

**Success response – `201 Created`**

```json
{
  "message": "Your message has been sent successfully",
  "id": "b1f4e6a2-7c1e-4f0d-9b5e-2a1f0b9c1234"
}
```

**Error responses**

| Status | When                                                                                  | Body example                                                                                  |
| ------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `400`  | Validation failure (missing field, too short, bad email, etc.)                        | `{ "statusCode": 400, "message": ["message must be longer than or equal to 10 characters"], "error": "Bad Request" }` |
| `429`  | More than 5 submissions from the same IP within an hour                               | `{ "statusCode": 429, "message": "ThrottlerException: Too Many Requests" }`                  |

> **Frontend tip:** Show a success toast using the returned `id` if you want to support reply-tracking. Disable the submit button and show a cooldown message on `429`.

---

## 4. Admin Endpoints (require `ADMIN` JWT)

All admin endpoints require:

- Header: `Authorization: Bearer <jwt>`
- The authenticated user must have role `ADMIN`.

> The auth layer is not part of this module — the JWT must be obtained through the `/auth/*` endpoints. The contact module simply inherits the global `JwtAuthGuard` and the `@Roles(ADMIN)` decorator.

### 4.1 `GET /admin/contact` – List messages (paginated, filterable)

**Query params** – `ContactQueryDto` (extends `PaginationQueryDto`)

| Param      | Type    | Required | Default       | Allowed values / notes                                                                |
| ---------- | ------- | -------- | ------------- | ------------------------------------------------------------------------------------- |
| `page`     | number  | ❌       | `1`           | Integer, `>= 1`                                                                       |
| `limit`    | number  | ❌       | `10`          | Integer, `1`–`1000`                                                                   |
| `sortBy`   | string  | ❌       | `createdAt`   | Whitelist: `createdAt`, `updatedAt`, `amount`, `viewsCount`, `publishedAt`, `title`    |
| `order`    | string  | ❌       | `DESC`        | `ASC` or `DESC`                                                                       |
| `isRead`   | boolean | ❌       | _(none)_      | `true` or `false` — filters by read status; pass as query string `"true"` / `"false"`  |

**Example request**

```http
GET /admin/contact?page=1&limit=20&sortBy=createdAt&order=DESC&isRead=false HTTP/1.1
Host: api.example.com
Authorization: Bearer <jwt>
```

**Success response – `200 OK`**

```json
{
  "data": [
    {
      "id": "b1f4e6a2-7c1e-4f0d-9b5e-2a1f0b9c1234",
      "fullName": "Jane Doe",
      "email": "jane.doe@example.com",
      "subject": "Question about pricing",
      "message": "Hello, I would like to know more about the enterprise plan pricing tiers.",
      "isRead": false,
      "repliedAt": null,
      "ipAddress": "203.0.113.42",
      "createdAt": "2026-06-07T10:15:30.000Z",
      "updatedAt": "2026-06-07T10:15:30.000Z"
    },
    {
      "id": "a2c5f7b1-3d2e-4a91-8c6f-1b2e3d4a5678",
      "fullName": "John Smith",
      "email": "john.smith@example.com",
      "subject": "Bug report",
      "message": "I found a small UI glitch on the dashboard page when resizing.",
      "isRead": true,
      "repliedAt": "2026-06-06T14:22:01.000Z",
      "ipAddress": "198.51.100.7",
      "createdAt": "2026-06-06T13:55:00.000Z",
      "updatedAt": "2026-06-06T14:22:01.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  }
}
```

**Error responses**

| Status | When                          | Body example                                                                                                |
| ------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `400`  | Invalid `sortBy`, `page`, etc | `{ "statusCode": 400, "message": ["sortBy must be one of the following values: createdAt, updatedAt, ..."], "error": "Bad Request" }` |
| `401`  | Missing / invalid JWT         | `{ "statusCode": 401, "message": "Unauthorized" }`                                                          |
| `403`  | JWT valid but not `ADMIN`     | `{ "statusCode": 403, "message": "Forbidden resource" }`                                                    |

> **Frontend tip:** Use `meta.totalPages` to render pagination. The default sort is newest-first — keep it for inbox views.

---

### 4.2 `GET /admin/contact/:id` – Get a single message

**Path params**

| Param | Type   | Required | Notes           |
| ----- | ------ | -------- | --------------- |
| `id`  | UUID   | ✅       | Message UUID    |

**Example request**

```http
GET /admin/contact/b1f4e6a2-7c1e-4f0d-9b5e-2a1f0b9c1234 HTTP/1.1
Host: api.example.com
Authorization: Bearer <jwt>
```

**Success response – `200 OK`**

```json
{
  "id": "b1f4e6a2-7c1e-4f0d-9b5e-2a1f0b9c1234",
  "fullName": "Jane Doe",
  "email": "jane.doe@example.com",
  "subject": "Question about pricing",
  "message": "Hello, I would like to know more about the enterprise plan pricing tiers.",
  "isRead": false,
  "repliedAt": null,
  "ipAddress": "203.0.113.42",
  "createdAt": "2026-06-07T10:15:30.000Z",
  "updatedAt": "2026-06-07T10:15:30.000Z"
}
```

**Error responses**

| Status | When                          | Body example                                                                              |
| ------ | ----------------------------- | ----------------------------------------------------------------------------------------- |
| `400`  | `id` is not a valid UUID      | `{ "statusCode": 400, "message": "Validation failed (uuid is expected)", "error": "Bad Request" }` |
| `401`  | Missing / invalid JWT         | `{ "statusCode": 401, "message": "Unauthorized" }`                                       |
| `403`  | JWT valid but not `ADMIN`     | `{ "statusCode": 403, "message": "Forbidden resource" }`                                 |
| `404`  | No message with this id       | `{ "statusCode": 404, "message": "Contact message not found", "error": "Not Found" }`     |

---

### 4.3 `PATCH /admin/contact/:id/read` – Mark message as read

Sets `isRead = true`. Idempotent.

**Path params**

| Param | Type | Required | Notes        |
| ----- | ---- | -------- | ------------ |
| `id`  | UUID | ✅       | Message UUID |

**Example request**

```http
PATCH /admin/contact/b1f4e6a2-7c1e-4f0d-9b5e-2a1f0b9c1234/read HTTP/1.1
Host: api.example.com
Authorization: Bearer <jwt>
```

> No request body.

**Success response – `200 OK`**

```json
{
  "id": "b1f4e6a2-7c1e-4f0d-9b5e-2a1f0b9c1234",
  "isRead": true,
  "message": "Message marked as read"
}
```

**Error responses**

| Status | When                          | Body example                                                                          |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------- |
| `400`  | `id` is not a valid UUID      | `{ "statusCode": 400, "message": "Validation failed (uuid is expected)", "error": "Bad Request" }` |
| `401`  | Missing / invalid JWT         | `{ "statusCode": 401, "message": "Unauthorized" }`                                   |
| `403`  | JWT valid but not `ADMIN`     | `{ "statusCode": 403, "message": "Forbidden resource" }`                             |
| `404`  | No message with this id       | `{ "statusCode": 404, "message": "Contact message not found", "error": "Not Found" }` |

> **Frontend tip:** Treat the response as the new canonical state. You can optimistically set `isRead = true` in the list view after the request resolves.

---

### 4.4 `PATCH /admin/contact/:id/reply` – Mark message as replied

Sets `isRead = true` **and** `repliedAt = now()`.

**Path params**

| Param | Type | Required | Notes        |
| ----- | ---- | -------- | ------------ |
| `id`  | UUID | ✅       | Message UUID |

**Example request**

```http
PATCH /admin/contact/b1f4e6a2-7c1e-4f0d-9b5e-2a1f0b9c1234/reply HTTP/1.1
Host: api.example.com
Authorization: Bearer <jwt>
```

> No request body.

**Success response – `200 OK`**

```json
{
  "id": "b1f4e6a2-7c1e-4f0d-9b5e-2a1f0b9c1234",
  "isRead": true,
  "repliedAt": "2026-06-07T11:02:17.000Z",
  "message": "Message marked as replied"
}
```

**Error responses**

| Status | When                          | Body example                                                                          |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------- |
| `400`  | `id` is not a valid UUID      | `{ "statusCode": 400, "message": "Validation failed (uuid is expected)", "error": "Bad Request" }` |
| `401`  | Missing / invalid JWT         | `{ "statusCode": 401, "message": "Unauthorized" }`                                   |
| `403`  | JWT valid but not `ADMIN`     | `{ "statusCode": 403, "message": "Forbidden resource" }`                             |
| `404`  | No message with this id       | `{ "statusCode": 404, "message": "Contact message not found", "error": "Not Found" }` |

> **Frontend tip:** This endpoint does **not** send the reply email — it only records that the admin replied (and marks the message as read). The actual reply email is sent out-of-band; the endpoint just updates tracking state.

---

### 4.5 `DELETE /admin/contact/:id` – Delete message permanently

**Path params**

| Param | Type | Required | Notes        |
| ----- | ---- | -------- | ------------ |
| `id`  | UUID | ✅       | Message UUID |

**Example request**

```http
DELETE /admin/contact/b1f4e6a2-7c1e-4f0d-9b5e-2a1f0b9c1234 HTTP/1.1
Host: api.example.com
Authorization: Bearer <jwt>
```

> No request body.

**Success response – `200 OK`**

```json
{
  "message": "Contact message deleted successfully"
}
```

**Error responses**

| Status | When                          | Body example                                                                          |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------- |
| `400`  | `id` is not a valid UUID      | `{ "statusCode": 400, "message": "Validation failed (uuid is expected)", "error": "Bad Request" }` |
| `401`  | Missing / invalid JWT         | `{ "statusCode": 401, "message": "Unauthorized" }`                                   |
| `403`  | JWT valid but not `ADMIN`     | `{ "statusCode": 403, "message": "Forbidden resource" }`                             |
| `404`  | No message with this id (or already deleted) | `{ "statusCode": 404, "message": "Contact message not found", "error": "Not Found" }` |

> **Frontend tip:** This is a hard delete. Always show a confirmation dialog before calling it, and remove the row from the local list on success.

---

## 5. End-to-End Frontend Flows

### 5.1 Public contact form

1. Render a form with fields: `fullName`, `email`, `subject`, `message`.
2. Client-side validation (mirror backend rules):
   - `fullName`: required, max 100
   - `email`: required, valid email, max 255
   - `subject`: required, max 200
   - `message`: required, 10–5000 chars
3. On submit → `POST /contact` with JSON body.
4. On `201` → show success toast, optionally clear the form, log the returned `id`.
5. On `400` → display validation errors from the `message` array.
6. On `429` → show "You’ve reached the hourly limit, please try again later" and disable the submit button for an hour (or until next response).

### 5.2 Admin inbox

1. On page load → `GET /admin/contact?page=1&limit=20&sortBy=createdAt&order=DESC`.
2. Render table with columns: sender, subject, read status, replied status, created date.
3. Provide filters: `isRead` toggle (true/false/all), search (note: not in current API — keep as TODO).
4. Pagination controls using `meta.page`, `meta.totalPages`, `meta.total`.
5. Row click → `GET /admin/contact/:id` for the detail view.
6. Detail view action: "Mark as read" → `PATCH /:id/read`. "Mark as replied" → `PATCH /:id/reply`. "Delete" → `DELETE /:id` after confirmation.
7. After any state-mutating call, refresh the list (or update the local item optimistically with the response payload).

---

## 6. TypeScript Types (suggested for the FE)

```ts
export type ContactMessage = {
  id: string;
  fullName: string;
  email: string;
  subject: string;
  message: string;
  isRead: boolean;
  repliedAt: string | null; // ISO 8601
  ipAddress: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
};

export type Paginated<T> = {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type CreateContactMessagePayload = {
  fullName: string;
  email: string;
  subject: string;
  message: string;
};

export type ContactQueryParams = {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'amount' | 'viewsCount' | 'publishedAt' | 'title';
  order?: 'ASC' | 'DESC';
  isRead?: boolean;
};
```

---

## 7. Quick Endpoint Reference

| Method | Path                                  | Auth      | Purpose                                  |
| ------ | ------------------------------------- | --------- | ---------------------------------------- |
| POST   | `/contact`                            | Public    | Submit a new contact message             |
| GET    | `/admin/contact`                      | Admin     | List messages (paginated/filterable)     |
| GET    | `/admin/contact/:id`                  | Admin     | Get a single message                     |
| PATCH  | `/admin/contact/:id/read`             | Admin     | Mark as read                             |
| PATCH  | `/admin/contact/:id/reply`            | Admin     | Mark as replied (also marks as read)     |
| DELETE | `/admin/contact/:id`                  | Admin     | Hard-delete a message                    |

---

## 8. Edge Cases & Gotchas

- **`isRead` query string**: must be sent as `"true"` or `"false"` (string), the backend converts it to a boolean. Sending a raw boolean in JSON will fail at the `@IsBoolean()` validator.
- **`sortBy` whitelist**: only the six fields in `SORT_FIELDS` are accepted. Any other value returns `400`.
- **Rate-limit window**: 5 submissions per IP per hour, reset is rolling. Plan UX accordingly.
- **`PATCH /:id/read` and `/reply` are idempotent**: calling them on an already-read/replied message is safe and returns the same shape.
- **`ipAddress`** is captured server-side — the frontend does not (and should not) send it.
- **Hard delete**: there is no soft delete / restore endpoint.
- **No search endpoint** in the current module — FE-side filtering only.

---

## 9. Suggested FE Component Map

| Component                | Responsibility                                                            |
| ------------------------ | ------------------------------------------------------------------------- |
| `ContactForm` (public)   | Renders & validates the 4 fields, calls `POST /contact`.                  |
| `ContactInbox` (admin)   | List, filter (`isRead`), paginate, click-through to detail.              |
| `ContactDetail` (admin)  | Full message view, action buttons (mark read, mark replied, delete).      |
| `useContactApi` hook     | Thin wrapper around the 6 endpoints (handles auth header + typing).       |
| `contact.types.ts`       | TypeScript types from section 6.                                          |
