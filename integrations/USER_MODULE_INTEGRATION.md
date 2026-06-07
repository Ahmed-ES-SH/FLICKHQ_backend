# User Module – Frontend Integration Plan

> Base URL: `/api/v1` (or whatever global prefix the app is bootstrapped with — see `src/main.ts`)
> Resource: `user`
> Module file: `src/user`
> Swagger tag: `Users`

---

## 1. Overview

The **User** module manages user accounts: registration, email verification, profile retrieval, profile updates, admin-only listing & stats, and admin-only deletion.

All endpoints return JSON. The standard Nest response envelope is the raw object/array (no wrapping). Validation errors are returned as `400 Bad Request` with a `message` array, and authorization errors as `401`/`403` (see Common Error Responses below).

### 1.1 Authentication

| Type             | Header                                |
| ---------------- | ------------------------------------- |
| Bearer JWT (Authorization) | `Authorization: Bearer <access_token>` |

Public endpoints do not require a token. Protected endpoints require a valid JWT issued by the **Auth** module (`/auth/login`).

### 1.2 Authorization Matrix

| Endpoint              | Public | Authenticated | Admin only |
| --------------------- | :----: | :-----------: | :--------: |
| `POST   /user`              | ✅ |  |  |
| `POST   /user/verify-email` | ✅ |  |  |
| `GET    /user`              |  |  | ✅ |
| `GET    /user/stats`        |  |  | ✅ |
| `GET    /user/:id`          |  | ✅ (own) | ✅ (any) |
| `PATCH  /user/:id`          |  | ✅ (own) | ✅ (any) |
| `DELETE /user/:id`          |  |  | ✅ |

### 1.3 Enums (shared with backend)

```ts
// UserRoleEnum
enum UserRoleEnum {
  ADMIN = 'admin',
  USER  = 'user',
}

// StatusEnum
enum StatusEnum {
  ACTIVE   = 'active',
  INACTIVE = 'inactive',
  BANNED   = 'banned',
}
```

### 1.4 Common Error Responses

| HTTP | Meaning                                | Body shape                                         |
| ---- | -------------------------------------- | -------------------------------------------------- |
| 400  | Validation error / business rule       | `{ "statusCode": 400, "message": "...", "error": "Bad Request" }` |
| 401  | Missing / invalid JWT                  | `{ "statusCode": 401, "message": "Unauthorized" }` |
| 403  | Forbidden (role / ownership)           | `{ "statusCode": 403, "message": "Forbidden ..." }` |
| 404  | Resource not found                     | `{ "statusCode": 404, "message": "Not found ..." }` |
| 409  | Conflict (duplicate email/name)        | `{ "statusCode": 400, "message": "User already exists" }` (currently returned as 400 — see Endpoint 1) |

---

## 2. Data Model

### 2.1 `User` Entity

> `password`, `emailVerificationToken`, `passwordResetToken`, `emailVerificationTokenExpiry`, `passwordResetTokenExpiry` are hidden from API responses (Swagger `@ApiHideProperty` / TypeORM `select: false`).

| Field                            | Type                            | Notes                                           |
| -------------------------------- | ------------------------------- | ----------------------------------------------- |
| `id`                             | `number`                        | Auto-incremented primary key                    |
| `email`                          | `string`                        | **Unique**, valid email                         |
| `password`                       | `string`                        | Hashed (argon2). **Never sent to client**       |
| `name`                           | `string?`                       | Optional, unique when present                   |
| `avatar`                         | `string?`                       | Optional, URL/path                              |
| `role`                           | `UserRoleEnum`                  | `admin` \| `user` (default: `user`)             |
| `status`                         | `StatusEnum`                    | `active` \| `inactive` \| `banned` (default: `active`) |
| `googleId`                       | `string?`                       | Optional, populated on Google OAuth              |
| `isEmailVerified`                | `boolean`                       | Default: `false`                                |
| `stripeCustomerId`               | `string?`                       | Populated on Stripe linkage                     |
| `isPremium`                      | `boolean`                       | Default: `false`                                |
| `createdAt`                      | `string (ISO 8601)`             | Auto                                            |
| `updatedAt`                      | `string (ISO 8601)`             | Auto                                            |
| `emailVerificationToken`         | `string?` (hidden)              | Internal only                                   |
| `emailVerificationTokenExpiry`   | `string?` (hidden)              | Internal only                                   |
| `passwordResetToken`             | `string?` (hidden)              | Internal only                                   |
| `passwordResetTokenExpiry`       | `string?` (hidden)              | Internal only                                   |

---

## 3. Endpoints

### Endpoint 1 — Register a new user

- **Method:** `POST`
- **Path:** `/user`
- **Auth:** Public
- **Description:** Creates a new user. Sends a verification email (handled by the auth/mail module).

#### Request Body (`CreateUserDto`)

| Field      | Type     | Required | Validation                                                     |
| ---------- | -------- | :------: | -------------------------------------------------------------- |
| `email`    | `string` |   ✅     | Valid email format                                             |
| `password` | `string` |   ✅     | Min 8 chars; must contain upper, lower, and a digit (regex: `^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)`) |
| `name`     | `string` |          | Optional                                                       |
| `avatar`   | `string` |          | Optional URL/path                                             |

#### Example Request

```http
POST /user
Content-Type: application/json

{
  "email": "jane.doe@example.com",
  "password": "Secret123",
  "name": "Jane Doe",
  "avatar": "https://cdn.example.com/avatars/jane.png"
}
```

#### Success Response — `201 Created`

```json
{
  "id": 42,
  "email": "jane.doe@example.com",
  "name": "Jane Doe",
  "avatar": "https://cdn.example.com/avatars/jane.png",
  "role": "user",
  "status": "active",
  "isEmailVerified": false,
  "isPremium": false,
  "createdAt": "2026-06-07T10:15:00.000Z",
  "updatedAt": "2026-06-07T10:15:00.000Z"
}
```

#### Error Responses

- **`400 Bad Request`** — validation error or duplicate email
  ```json
  {
    "statusCode": 400,
    "message": "User already exists",
    "error": "Bad Request"
  }
  ```
- **`400 Bad Request`** — invalid payload
  ```json
  {
    "statusCode": 400,
    "message": [
      "email must be an email",
      "Password must contain at least one lowercase letter, one uppercase letter, and one number"
    ],
    "error": "Bad Request"
  }
  ```

#### Frontend Notes

- On success, the user is logged out — they still need to call `/auth/login` after verifying their email.
- A verification email is dispatched. Frontend should display a "Check your inbox" screen and offer a "Resend verification" CTA (see Auth module).

---

### Endpoint 2 — Verify email

- **Method:** `POST`
- **Path:** `/user/verify-email`
- **Auth:** Public
- **Description:** Consumes a token sent in the verification email and marks the user as verified.

#### Request Body (`VerifyEmailDto`)

| Field   | Type     | Required | Validation             |
| ------- | -------- | :------: | ---------------------- |
| `token` | `string` |   ✅     | Min 6 chars            |

#### Example Request

```http
POST /user/verify-email
Content-Type: application/json

{
  "token": "8c4f1a2b9d6e7f30"
}
```

#### Success Response — `200 OK`

```json
{
  "id": 42,
  "email": "jane.doe@example.com",
  "name": "Jane Doe",
  "avatar": "https://cdn.example.com/avatars/jane.png",
  "role": "user",
  "status": "active",
  "isEmailVerified": true,
  "isPremium": false,
  "createdAt": "2026-06-07T10:15:00.000Z",
  "updatedAt": "2026-06-07T10:20:00.000Z"
}
```

#### Error Responses

- **`404 Not Found`** — token not associated with any user
  ```json
  {
    "statusCode": 404,
    "message": "Invalid verification token",
    "error": "Not Found"
  }
  ```
- **`400 Bad Request`** — token has expired
  ```json
  {
    "statusCode": 400,
    "message": "Verification token has expired",
    "error": "Bad Request"
  }
  ```

#### Frontend Notes

- The verification link from email usually points to a frontend route like `/verify-email?token=...`. Read the `token` from the URL and POST it as JSON.
- On 404/400, render an error state with a "Request a new email" action that triggers the Auth module's resend flow.

---

### Endpoint 3 — Get all users (Admin)

- **Method:** `GET`
- **Path:** `/user`
- **Auth:** Bearer JWT — **`role: admin` required** (enforced by `RolesGuard`)
- **Description:** Paginated list of users with optional filters.

#### Query Parameters (`FilterOptionsDto`, extends `PaginationDto`)

| Param    | Type     | Required | Default | Description                                                                 |
| -------- | -------- | :------: | ------- | --------------------------------------------------------------------------- |
| `page`   | `number` |          | `1`     | Page number (min 1)                                                         |
| `limit`  | `number` |          | `10`    | Page size (min 1, max 100)                                                 |
| `role`   | `string` |          | —       | Filter by role: `admin` \| `user`                                           |
| `status` | `string` |          | —       | Filter by status: `active` \| `inactive` \| `banned`                       |
| `search` | `string` |          | —       | Case-insensitive `ILIKE` match against `name` **OR** `email`                |

> The search filter performs an OR across `name` and `email`; combined with `role`/`status` as AND.

#### Example Request

```http
GET /user?page=1&limit=20&role=user&status=active&search=jane
Authorization: Bearer <admin_access_token>
```

#### Success Response — `200 OK`

```json
{
  "data": [
    {
      "id": 42,
      "email": "jane.doe@example.com",
      "name": "Jane Doe",
      "avatar": "https://cdn.example.com/avatars/jane.png",
      "role": "user",
      "status": "active",
      "isEmailVerified": true,
      "isPremium": false,
      "createdAt": "2026-06-07T10:15:00.000Z",
      "updatedAt": "2026-06-07T10:20:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "perPage": 20,
  "lastPage": 1
}
```

#### Empty Result — `200 OK`

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "perPage": 20,
  "lastPage": 1
}
```

#### Error Responses

- **`401 Unauthorized`** — missing/invalid token
- **`403 Forbidden`** — caller is not an admin
  ```json
  {
    "statusCode": 403,
    "message": "Forbidden resource",
    "error": "Forbidden"
  }
  ```

#### Frontend Notes

- Default order is `createdAt DESC` (newest first) — non-configurable.
- For a debounced search input, debounce ~300ms before re-issuing the request and reset `page` to 1 when the query changes.

---

### Endpoint 4 — Get user statistics (Admin)

- **Method:** `GET`
- **Path:** `/user/stats`
- **Auth:** Bearer JWT — **`role: admin` required**
- **Description:** Returns aggregate counts for the admin dashboard.

#### Example Request

```http
GET /user/stats
Authorization: Bearer <admin_access_token>
```

#### Success Response — `200 OK`

```json
{
  "adminsNumber": 3,
  "verifiedUsersNumber": 128,
  "unverifiedUsersNumber": 17
}
```

#### Error Responses

- **`401 Unauthorized`** — missing/invalid token
- **`403 Forbidden`** — caller is not an admin

#### Frontend Notes

- Counts are returned as plain numbers; render them as KPI cards. There is no pagination or filters on this endpoint.
- Suggested polling interval: 30–60s for live dashboards.

---

### Endpoint 5 — Get user by ID

- **Method:** `GET`
- **Path:** `/user/:id`
- **Auth:** Bearer JWT required.
  - Admin → can view **any** user
  - Non-admin → can only view **their own** profile (ownership enforced in service)
- **Path params:** `id` (`number`, parsed via `ParseIntPipe`)

#### Example Request

```http
GET /user/42
Authorization: Bearer <access_token>
```

#### Success Response — `200 OK`

```json
{
  "id": 42,
  "email": "jane.doe@example.com",
  "name": "Jane Doe",
  "avatar": "https://cdn.example.com/avatars/jane.png",
  "role": "user",
  "status": "active",
  "isEmailVerified": true,
  "isPremium": false,
  "createdAt": "2026-06-07T10:15:00.000Z",
  "updatedAt": "2026-06-07T10:20:00.000Z"
}
```

#### Error Responses

- **`400 Bad Request`** — id is not a valid integer
  ```json
  { "statusCode": 400, "message": "Validation failed (numeric string is expected)" }
  ```
- **`401 Unauthorized`** — missing/invalid token
- **`403 Forbidden`** — non-admin trying to view another user
  ```json
  { "statusCode": 403, "message": "You can only view your own profile" }
  ```
- **`404 Not Found`**
  ```json
  { "statusCode": 404, "message": "User with ID 42 not found" }
  ```

#### Frontend Notes

- For the "My Profile" page, the frontend already knows the current user's id (from the auth/session store) — pass that value.
- For admin "User detail" pages, the id comes from the route param.

---

### Endpoint 6 — Update user

- **Method:** `PATCH`
- **Path:** `/user/:id`
- **Auth:** Bearer JWT required.
  - Admin → can update **any** user (including `role` and `status`)
  - Non-admin → can only update **their own** profile; attempts to set `role` or `status` are silently ignored
- **Path params:** `id` (`number`)

#### Request Body (`UpdateUserDto`)

> All fields are optional. Send only the fields you want to change. Backend applies the same `merge` semantics — unknown fields are ignored.

| Field      | Type     | Required | Validation (if present)                                                                                       | Writable by                |
| ---------- | -------- | :------: | ------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `name`     | `string` |          | —                                                                                                             | self & admin               |
| `email`    | `string` |          | Valid email; **changing email resets `isEmailVerified` to `false`** and triggers a re-verification email     | self & admin               |
| `avatar`   | `string` |          | —                                                                                                             | self & admin               |
| `password` | `string` |          | Min 8 chars; upper + lower + digit                                                                           | self & admin               |
| `role`     | `UserRoleEnum` |    | `admin` \| `user`                                                                                       | **admin only**             |
| `status`   | `StatusEnum`   |    | `active` \| `inactive` \| `banned`                                                                       | **admin only**             |

#### Example Request — User updates own name and avatar

```http
PATCH /user/42
Authorization: Bearer <user_access_token>
Content-Type: application/json

{
  "name": "Jane D. Doe",
  "avatar": "https://cdn.example.com/avatars/jane-v2.png"
}
```

#### Example Request — User changes password

```http
PATCH /user/42
Authorization: Bearer <user_access_token>
Content-Type: application/json

{
  "password": "NewSecret456"
}
```

#### Example Request — Admin promotes a user to admin

```http
PATCH /user/42
Authorization: Bearer <admin_access_token>
Content-Type: application/json

{
  "role": "admin"
}
```

#### Example Request — Admin bans a user

```http
PATCH /user/42
Authorization: Bearer <admin_access_token>
Content-Type: application/json

{
  "status": "banned"
}
```

#### Success Response — `200 OK`

```json
{
  "id": 42,
  "email": "jane.doe@example.com",
  "name": "Jane D. Doe",
  "avatar": "https://cdn.example.com/avatars/jane-v2.png",
  "role": "user",
  "status": "active",
  "isEmailVerified": true,
  "isPremium": false,
  "createdAt": "2026-06-07T10:15:00.000Z",
  "updatedAt": "2026-06-07T11:00:00.000Z"
}
```

#### Error Responses

- **`400 Bad Request`** — validation error (e.g. weak password, invalid email, invalid enum value)
- **`401 Unauthorized`** — missing/invalid token
- **`403 Forbidden`** — non-admin attempting to update another user
  ```json
  { "statusCode": 403, "message": "You can only update your own profile" }
  ```
- **`404 Not Found`**
  ```json
  { "statusCode": 404, "message": "User with ID 42 not found" }
  ```

#### Frontend Notes

- Treat the response as the new canonical user — update the local store/cache with the returned object.
- After a successful **email change**, the response will show `isEmailVerified: false`. Surface a banner prompting the user to check their inbox.
- After a successful **password change**, force re-authentication (e.g. redirect to `/login` and clear the session) — the existing access token may be invalidated by the backend's password-change policy.

---

### Endpoint 7 — Delete user (Admin)

- **Method:** `DELETE`
- **Path:** `/user/:id`
- **Auth:** Bearer JWT — **`role: admin` required**
- **Path params:** `id` (`number`)

#### Example Request

```http
DELETE /user/42
Authorization: Bearer <admin_access_token>
```

#### Success Response — `200 OK`

> The backend returns the **deleted** user object (TypeORM `remove` result).

```json
{
  "id": 42,
  "email": "jane.doe@example.com",
  "name": "Jane D. Doe",
  "avatar": "https://cdn.example.com/avatars/jane-v2.png",
  "role": "user",
  "status": "active",
  "isEmailVerified": true,
  "isPremium": false,
  "createdAt": "2026-06-07T10:15:00.000Z",
  "updatedAt": "2026-06-07T11:00:00.000Z"
}
```

#### Error Responses

- **`400 Bad Request`** — id is not a valid integer
- **`401 Unauthorized`** — missing/invalid token
- **`403 Forbidden`** — caller is not an admin
- **`404 Not Found`**
  ```json
  { "statusCode": 404, "message": "User with ID 42 not found" }
  ```

#### Frontend Notes

- Deletion is **hard delete** — there is no soft-delete/restore in this module. Always show a confirmation modal that includes the user's email and id.
- The endpoint is idempotent: re-deleting a non-existent user returns `404`, not `200`.
- Optimistically remove the row from the list and invalidate the user-detail cache.

---

## 4. Pagination Convention (used by Endpoint 3)

```ts
interface PaginatedResult<T> {
  data: T[];        // page items
  total: number;    // total matching items (across all pages)
  page: number;     // current page (echoed from request)
  perPage: number;  // page size (echoed from request)
  lastPage: number; // ceil(total / perPage); 0 when total is 0
}
```

When `total === 0`, `lastPage` is `0` (not `1`).

---

## 5. TypeScript Type Hints (for FE)

```ts
// Copy-paste ready types
export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'inactive' | 'banned';

export interface User {
  id: number;
  email: string;
  name?: string;
  avatar?: string;
  role: UserRole;
  status: UserStatus;
  isEmailVerified: boolean;
  isPremium: boolean;
  createdAt: string;
  updatedAt: string;
  // googleId / stripeCustomerId are also returned by the entity but
  // not heavily used in the UI — keep them optional if you read them.
  googleId?: string;
  stripeCustomerId?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  lastPage: number;
}

export interface CreateUserPayload {
  email: string;
  password: string;
  name?: string;
  avatar?: string;
}

export interface UpdateUserPayload {
  name?: string;
  email?: string;
  avatar?: string;
  password?: string;
  role?: UserRole;     // ignored for non-admin callers
  status?: UserStatus; // ignored for non-admin callers
}

export interface VerifyEmailPayload {
  token: string;
}

export interface ListUsersQuery {
  page?: number;     // default 1
  limit?: number;    // default 10, max 100
  role?: UserRole;
  status?: UserStatus;
  search?: string;
}

export interface UserStats {
  adminsNumber: number;
  verifiedUsersNumber: number;
  unverifiedUsersNumber: number;
}
```

---

## 6. End-to-End User Flows

### 6.1 Sign-up → Verify → Login

1. FE collects `email`, `password`, optional `name`/`avatar` and calls `POST /user`.
2. On `201`, FE navigates to a "Check your inbox" screen.
3. User clicks the link in the email → FE extracts `token` from the URL → calls `POST /user/verify-email`.
4. On `200`, FE redirects to `POST /auth/login` (Auth module) to obtain JWTs.

### 6.2 "My Profile" page

1. FE reads the current user id from the auth store (no extra call needed if the store already has the user).
2. On edit, `PATCH /user/:id` with only changed fields.
3. If `isEmailVerified` flips to `false`, show a "Please verify your new email" banner.
4. On password change, force a re-login.

### 6.3 Admin — User management

1. List page: `GET /user` with filters and pagination.
2. Stats card: `GET /user/stats` (re-fetch on demand or poll).
3. Detail page: `GET /user/:id`.
4. Promote / ban: `PATCH /user/:id` with `role` or `status`.
5. Delete: `DELETE /user/:id` with confirmation modal.

---

## 7. Cross-Module Touchpoints

| Concern         | Module               | What the FE should know                                                                              |
| --------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| Authentication  | `auth`               | All non-public endpoints require a JWT obtained from `auth/login`.                                    |
| Roles / Guards  | `auth/guards`        | Admin role is required for endpoints 3, 4, 7 and for cross-user `GET /:id` / `PATCH /:id`.          |
| Email sending   | `mail`               | Registration and email change trigger verification emails; password reset is also email-driven.     |
| Stripe billing  | `payments` / Stripe  | `stripeCustomerId` and `isPremium` are managed by the payments module — FE should treat them as read-only here. |
| OAuth (Google)  | `auth`               | `googleId` is set when a user signs in via Google; not directly editable through the user endpoints. |

---

## 8. Endpoint Quick-Reference

| # | Method | Path                | Auth   | Purpose                                     |
| - | ------ | ------------------- | ------ | ------------------------------------------- |
| 1 | POST   | `/user`             | Public | Register a new user                         |
| 2 | POST   | `/user/verify-email`| Public | Verify email with token                     |
| 3 | GET    | `/user`             | Admin  | List users (paginated, filterable)          |
| 4 | GET    | `/user/stats`       | Admin  | Aggregate user counts                       |
| 5 | GET    | `/user/:id`         | Auth   | Get user by ID (admin: any, user: self)     |
| 6 | PATCH  | `/user/:id`         | Auth   | Update user (admin: any+role+status, user: self) |
| 7 | DELETE | `/user/:id`         | Admin  | Hard-delete a user                          |

---

## 9. Implementation Checklist (Frontend)

- [ ] Define TypeScript types from section 5.
- [ ] Create an `api/users.ts` (or equivalent) wrapper that:
  - Attaches the bearer token from the auth store on every protected call.
  - Maps `400/401/403/404` into a normalized error structure for the UI.
- [ ] Sign-up form with email + password validation matching backend rules (8+ chars, upper, lower, digit).
- [ ] "Verify email" route that reads `?token=` from the URL and calls Endpoint 2.
- [ ] "My Profile" page (read + edit) — guard against sending `role`/`status` for non-admin sessions.
- [ ] Admin user list (table with server-side pagination, search, role/status filters).
- [ ] Admin dashboard widgets using `/user/stats`.
- [ ] Admin user detail / edit / delete with confirmations.
- [ ] Handle the "email changed → re-verify" UX after a successful PATCH that mutates `email`.
- [ ] Force re-login after a password change.
- [ ] Optimistic UI updates for delete; refresh list on error.
- [ ] Caching strategy (e.g. TanStack Query keys: `['users', page, limit, filters]`, `['user', id]`, `['users', 'stats']`).
