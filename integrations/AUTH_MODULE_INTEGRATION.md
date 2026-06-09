# Auth Module — Frontend Integration Plan

> **Base URL:** `/api` (global prefix configured in `src/main.ts`)
> **Module file:** `src/auth`
> **Swagger tag:** `auth`

---

## 1. Authentication Architecture — HttpOnly Cookies

This backend uses **HttpOnly cookies** for JWT transport. The frontend **never reads or stores JWT tokens** — authentication is handled transparently by the browser.

### How It Works

```
Login:
  Frontend → POST /api/auth/login { email, password }
  Backend  → Validates credentials
           → Generates JWT
           → Sets HttpOnly cookie (Set-Cookie header)
           → Response: { user }   (no token!)

Subsequent requests:
  Browser  → Automatically sends cookie with every request 🎉
  Backend  → Reads JWT from cookie, validates, processes request

Logout:
  Frontend → POST /api/auth/logout
  Backend  → Blacklists the JWT
           → Clears the cookie (Set-Cookie: <name>=; Max-Age=0)
           → Response: { message }
```

### Critical Frontend Setup

**Every HTTP client must include credentials in requests:**

```ts
// fetch
fetch('/api/auth/current-user', { credentials: 'include' })

// axios
axios.get('/api/auth/current-user', { withCredentials: true })
```

### Cookie Configuration (server-side)

| Property    | Value                        | Notes                                      |
|-------------|------------------------------|--------------------------------------------|
| Name        | `AUTH_TOKEN` env variable    | Default: `flick_auth_token`                |
| httpOnly    | `true`                       | Not accessible via `document.cookie`       |
| secure      | `true` in production         | Requires HTTPS in production               |
| sameSite    | `lax`                        | CSRF protection; allows top-level GET      |
| path        | `/`                          | Available across the entire site           |
| maxAge      | 5 days                       | Matches common JWT expiry                  |

> **The cookie name is configurable via the `AUTH_TOKEN` environment variable.** The frontend does not need to know the cookie name — the browser manages it automatically. Just ensure `credentials: 'include'` is set.

### CORS Configuration (server-side)

```ts
// The server allows:
origin: process.env.FRONTEND_URL   // e.g. http://localhost:3000
credentials: true                    // Required for cookies!
allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
```

---

## 2. Response Envelope

All successful responses (except Google OAuth redirects) are wrapped by a global `TransformInterceptor`:

```ts
// If the controller returns a plain object:
{ "data": <response_body> }

// If the controller returns an object that already has a "data" key,
// it passes through unwrapped.
```

### Error Response Format

All errors go through a global `ExceptionFilter`:

```json
{
  "statusCode": 400,
  "message": "Human-readable error message",
  "errors": ["optional validation error array"],
  "timestamp": "2026-06-09T12:00:00.000Z",
  "path": "/api/auth/login"
}
```

| HTTP  | Meaning                    | Typical `message`                        |
|-------|----------------------------|------------------------------------------|
| 400   | Validation error / business rule | `"Invalid email or password"`      |
| 401   | Missing / invalid / expired auth | `"Authentication cookie not found"` |
| 401   | Revoked token              | `"This token has been revoked"`          |
| 403   | Email not verified         | `"You need to verify your email first"`  |
| 429   | Rate limit exceeded        | `"ThrottlerException: Too Many Requests"` |
| 500   | Internal server error      | `"Internal server error"`                |

---

## 3. Rate Limiting

| Endpoint                              | Limit                  | Window     |
|---------------------------------------|------------------------|------------|
| `POST /api/auth/login`                | 5 attempts             | 15 minutes |
| `POST /api/auth/verify-email`         | 5 attempts             | 15 minutes |
| `POST /api/auth/reset-password/send`  | 3 attempts             | 15 minutes |
| `POST /api/auth/reset-password/verify`| 5 attempts             | 15 minutes |
| `POST /api/auth/reset-password`       | 5 attempts             | 1 hour     |
| `POST /api/auth/logout`               | No rate limit          | —          |
| `GET  /api/auth/current-user`         | No rate limit          | —          |

Rate-limited endpoints respond with `429 Too Many Requests` when exceeded.

---

## 4. Endpoints

---

### Endpoint 1 — Login (Email/Password)

- **Method:** `POST`
- **Path:** `/api/auth/login`
- **Auth:** Public
- **Throttle:** 5 attempts / 15 min
- **Description:** Authenticates a user. On success, sets an HttpOnly cookie with the JWT. Returns user data **without** the access token.

#### Request Body

| Field      | Type     | Required | Validation       |
|------------|----------|:--------:|------------------|
| `email`    | `string` | ✅       | Valid email      |
| `password` | `string` | ✅       | Non-empty string |

#### Example Request

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "mySecurePassword123"
}
```

#### Success Response — `200 OK`

```json
{
  "data": {
    "user": {
      "id": 1,
      "email": "user@example.com",
      "name": "Jane Doe",
      "avatar": "https://cdn.example.com/avatars/jane.png",
      "role": "user",
      "status": "active",
      "isEmailVerified": true,
      "isPremium": false,
      "googleId": null,
      "stripeCustomerId": "cus_xxx",
      "createdAt": "2026-06-01T10:00:00.000Z",
      "updatedAt": "2026-06-09T12:00:00.000Z"
    }
  }
}
```

**Also sets cookie:** `Set-Cookie: flick_auth_token=<JWT>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=432000`

> ⚠️ **The `password` field is never returned.** The backend explicitly strips it from the response.

#### Error Responses

- **`400 Bad Request`** — Invalid credentials
  ```json
  {
    "statusCode": 400,
    "message": "Invalid email or password",
    "timestamp": "2026-06-09T12:00:00.000Z",
    "path": "/api/auth/login"
  }
  ```

- **`403 Forbidden`** — Email not verified (also sends verification email)
  ```json
  {
    "statusCode": 403,
    "message": "You need to verify your email first",
    "timestamp": "2026-06-09T12:00:00.000Z",
    "path": "/api/auth/login"
  }
  ```

- **`429 Too Many Requests`** — Rate limit exceeded
  ```json
  {
    "statusCode": 429,
    "message": "ThrottlerException: Too Many Requests",
    "timestamp": "2026-06-09T12:00:00.000Z",
    "path": "/api/auth/login"
  }
  ```

#### Frontend Implementation Notes

```ts
// Example: Login function
async function login(email: string, password: string): Promise<User> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    credentials: 'include',     // ← REQUIRED: accepts Set-Cookie
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message);
  }

  const json = await res.json();
  return json.data.user;        // ← Only user data, no token
}
```

> **Previously:** Frontend had to extract `access_token` from the response body, store it in `localStorage`, and inject it as `Authorization: Bearer <token>` on every request.
>
> **Now:** The browser handles the cookie automatically. No token storage, no Authorization header injection needed.

---

### Endpoint 2 — Logout

- **Method:** `POST`
- **Path:** `/api/auth/logout`
- **Auth:** **Required** (cookie must be present)
- **Throttle:** None
- **Description:** Blacklists the current JWT and clears the HttpOnly cookie. No request body needed — the token is read from the cookie.

#### Request

No request body. The JWT is read from the HttpOnly cookie.

```http
POST /api/auth/logout
Cookie: flick_auth_token=<JWT>    ← browser sends this automatically
```

#### Success Response — `200 OK`

```json
{
  "data": {
    "message": "User logged out successfully"
  }
}
```

**Also sets cookie (clearing):** `Set-Cookie: flick_auth_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`

#### Error Responses

- **`401 Unauthorized`** — No cookie found
  ```json
  {
    "statusCode": 401,
    "message": "Authentication cookie not found",
    "timestamp": "2026-06-09T12:00:00.000Z",
    "path": "/api/auth/logout"
  }
  ```

#### Frontend Implementation Notes

```ts
// Example: Logout function
async function logout(): Promise<void> {
  const res = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',     // ← sends the cookie
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message);
  }

  // Cookie is cleared by the server.
  // No client-side token clearing needed.
  // Redirect to login page.
}
```

> **Previously:** Frontend had to send `{ token: "..." }` in the request body and manually clear `localStorage`.
>
> **Now:** The token is read from the cookie and the cookie is cleared server-side. No body, no client-side cleanup.

---

### Endpoint 3 — Get Current User

- **Method:** `GET`
- **Path:** `/api/auth/current-user`
- **Auth:** **Required** (cookie must be present)
- **Throttle:** None
- **Description:** Returns the authenticated user's JWT payload (`id`, `email`, `role`). This is not the full user entity — it's the data encoded in the JWT.

#### Request

```http
GET /api/auth/current-user
Cookie: flick_auth_token=<JWT>    ← browser sends this automatically
```

#### Success Response — `200 OK`

```json
{
  "data": {
    "id": 1,
    "email": "user@example.com",
    "role": "user"
  }
}
```

> ⚠️ This endpoint returns the **JWT payload**, which contains only `id`, `email`, and `role`. For the full user profile (name, avatar, isPremium, etc.), use the **User module** endpoint `GET /api/user/:id` (requires authentication).

#### Error Responses

- **`401 Unauthorized`** — No cookie or invalid/expired token
  ```json
  {
    "statusCode": 401,
    "message": "Authentication cookie not found",
    "timestamp": "2026-06-09T12:00:00.000Z",
    "path": "/api/auth/current-user"
  }
  ```

#### Frontend Implementation Notes

Use this endpoint to:
1. **Check auth status** on app load (if it returns 200, user is logged in)
2. **Get basic user info** (id, email, role) for UI state
3. **Determine if user is admin** (`role === 'admin'`)

```ts
// Example: Get current user
async function getCurrentUser(): Promise<{ id: number; email: string; role: string } | null> {
  try {
    const res = await fetch('/api/auth/current-user', {
      credentials: 'include',
    });

    if (!res.ok) return null;

    const json = await res.json();
    return json.data;
  } catch {
    return null;
  }
}
```

---

### Endpoint 4 — Verify Email

- **Method:** `POST`
- **Path:** `/api/auth/verify-email?token=<token>`
- **Auth:** Public
- **Throttle:** 5 attempts / 15 min
- **Description:** Consumes an email verification token (sent via email on signup or when trying to log in with unverified email).

#### Query Parameters

| Param   | Type     | Required | Description                      |
|---------|----------|:--------:|----------------------------------|
| `token` | `string` | ✅       | Verification token from email    |

#### Example Request

```http
POST /api/auth/verify-email?token=abc123def456...
```

#### Success Response — `200 OK`

```json
{
  "data": {
    "message": "Email verified successfully"
  }
}
```

#### Error Responses

- **`400 Bad Request`** — Invalid/expired/missing token
  ```json
  {
    "statusCode": 400,
    "message": "Invalid or expired token",
    "timestamp": "2026-06-09T12:00:00.000Z",
    "path": "/api/auth/verify-email"
  }
  ```

- **`400 Bad Request`** — Already verified
  ```json
  {
    "statusCode": 400,
    "message": "The user is already verified",
    "timestamp": "2026-06-09T12:00:00.000Z",
    "path": "/api/auth/verify-email"
  }
  ```

#### Frontend Notes

After successful verification, the frontend should:
1. Show a success message to the user
2. Redirect to login page (user still needs to log in if not already)

The verification token is typically included in a link in the verification email:
```
https://frontend.com/verify-email?token=<token>
```
The frontend reads `token` from the URL and calls this endpoint.

---

### Endpoint 5 — Send Password Reset Email

- **Method:** `POST`
- **Path:** `/api/auth/reset-password/send`
- **Auth:** Public
- **Throttle:** 3 attempts / 15 min
- **Description:** Sends a password reset email with a reset token. Always returns the same message regardless of whether the email exists (to prevent email enumeration).

#### Request Body

| Field   | Type     | Required | Validation   |
|---------|----------|:--------:|--------------|
| `email` | `string` | ✅       | Valid email  |

#### Example Request

```http
POST /api/auth/reset-password/send
Content-Type: application/json

{
  "email": "user@example.com"
}
```

#### Success Response — `200 OK`

```json
{
  "data": {
    "message": "If an account exists with this email, a reset link has been sent."
  }
}
```

> ⚠️ The response is **identical** whether the email exists or not. This prevents attackers from discovering which emails are registered.

#### Error Responses

- **`408 Request Timeout`** — Email sending failed
  ```json
  {
    "statusCode": 408,
    "message": "Failed to send reset email. Please try again.",
    "timestamp": "2026-06-09T12:00:00.000Z",
    "path": "/api/auth/reset-password/send"
  }
  ```

#### Frontend Notes

After calling this endpoint, show a "Check your inbox" message. The email contains a link like:
```
https://frontend.com/reset-password?token=<32-byte-hex>&email=user@example.com
```

---

### Endpoint 6 — Verify Reset Token

- **Method:** `POST`
- **Path:** `/api/auth/reset-password/verify`
- **Auth:** Public
- **Throttle:** 5 attempts / 15 min
- **Description:** Validates that a password reset token is still valid and not expired. Used by the frontend to check if the token from the reset email link is still usable before showing the password reset form.

#### Request Body

| Field   | Type     | Required | Validation   |
|---------|----------|:--------:|--------------|
| `token` | `string` | ✅       | Non-empty    |
| `email` | `string` | ✅       | Valid email  |

#### Example Request

```http
POST /api/auth/reset-password/verify
Content-Type: application/json

{
  "token": "a1b2c3d4e5f6...",
  "email": "user@example.com"
}
```

#### Success Response — `200 OK`

```json
{
  "data": {
    "message": "This token is valid",
    "userId": 1
  }
}
```

#### Error Responses

- **`400 Bad Request`** — Invalid token or expired
  ```json
  {
    "statusCode": 400,
    "message": "Invalid token or user not found",
    "timestamp": "2026-06-09T12:00:00.000Z",
    "path": "/api/auth/reset-password/verify"
  }
  ```

- **`400 Bad Request`** — Token expired (1 hour TTL)
  ```json
  {
    "statusCode": 400,
    "message": "Token has expired",
    "timestamp": "2026-06-09T12:00:00.000Z",
    "path": "/api/auth/reset-password/verify"
  }
  ```

#### Frontend Notes

1. User clicks reset link in email → lands on `/reset-password?token=<token>&email=<email>`
2. Frontend extracts `token` and `email` from URL
3. Calls `POST /api/auth/reset-password/verify` to check if token is valid
4. If valid → show password reset form
5. If invalid/expired → show "Link expired, request a new one" message

---

### Endpoint 7 — Reset Password

- **Method:** `POST`
- **Path:** `/api/auth/reset-password`
- **Auth:** Public
- **Throttle:** 5 attempts / hour
- **Description:** Resets the user's password using the verified reset token. Requires the same token and email used in the verification step.

#### Request Body

| Field      | Type     | Required | Validation          |
|------------|----------|:--------:|---------------------|
| `email`    | `string` | ✅       | Valid email         |
| `password` | `string` | ✅       | Min 6 characters    |
| `token`    | `string` | ✅       | Non-empty           |

#### Example Request

```http
POST /api/auth/reset-password
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "newSecurePassword123",
  "token": "a1b2c3d4e5f6..."
}
```

#### Success Response — `200 OK`

```json
{
  "data": {
    "message": "Password changed successfully"
  }
}
```

#### Error Responses

- **`400 Bad Request`** — Invalid/expired token
  ```json
  {
    "statusCode": 400,
    "message": "Invalid request",
    "timestamp": "2026-06-09T12:00:00.000Z",
    "path": "/api/auth/reset-password"
  }
  ```

- **`400 Bad Request`** — Token expired
  ```json
  {
    "statusCode": 400,
    "message": "Token has expired",
    "timestamp": "2026-06-09T12:00:00.000Z",
    "path": "/api/auth/reset-password"
  }
  ```

#### Frontend Flow (Full Password Reset)

```
1. User clicks "Forgot Password"
2. Frontend calls POST /api/auth/reset-password/send { email }
   → Shows "Check your inbox"
3. User opens email, clicks link: https://frontend.com/reset-password?token=xxx&email=user@example.com
4. Frontend calls POST /api/auth/reset-password/verify { token, email }
   → If valid: shows password reset form
   → If invalid: shows "Link expired"
5. User enters new password
6. Frontend calls POST /api/auth/reset-password { email, password, token }
   → Shows success message, redirects to login
```

---

### Endpoint 8 — Google OAuth Login (Initiation)

- **Method:** `GET`
- **Path:** `/api/auth/google`
- **Auth:** Public
- **Description:** Redirects the user to Google's OAuth consent screen. This is a standard browser redirect — not an API call via `fetch`/`axios`.

#### Usage

```html
<!-- Simple link -->
<a href="http://localhost:5000/api/auth/google">Sign in with Google</a>

<!-- Or programmatically -->
<button onClick={() => window.location.href = 'http://localhost:5000/api/auth/google'}>
  Sign in with Google
</button>
```

> The base URL and port depend on the backend server configuration. Use `process.env.NEXT_PUBLIC_API_URL` or similar.

#### What Happens

1. Frontend redirects the browser to `/api/auth/google`
2. Backend redirects to Google's OAuth consent screen
3. User authorizes the app
4. Google redirects back to `/api/auth/google/callback` on the **backend**

---

### Endpoint 9 — Google OAuth Login (Callback)

- **Method:** `GET`
- **Path:** `/api/auth/google/callback`
- **Auth:** Public (handled by Passport Google strategy)
- **Description:** Handles the Google OAuth callback. The backend:
  1. Validates the authorization code with Google
  2. Creates or links the user account
  3. Sets the JWT as an HttpOnly cookie
  4. Redirects the browser to the frontend

#### This endpoint is NOT called by frontend JavaScript.

The entire flow is **server-side redirects**. The frontend never calls this endpoint directly.

#### What the Frontend Receives

After successful Google authentication, the **browser is redirected** to:

```
https://frontend.com/?refresh=1
```

With the HttpOnly cookie already set. The `?refresh=1` query parameter signals to the frontend that the user just authenticated and the app should refresh its state (call `GET /api/auth/current-user`).

#### Frontend Flow

```ts
// On app initialization:
// 1. Check URL for ?refresh=1
const urlParams = new URLSearchParams(window.location.search);
const justLoggedIn = urlParams.get('refresh') === '1';

// 2. If refresh=1, clean the URL and fetch user data
if (justLoggedIn) {
  window.history.replaceState({}, '', window.location.pathname);
  const user = await getCurrentUser();  // GET /api/auth/current-user
  // Update app state with user data
}
```

#### Error Handling

If Google authentication fails, Google displays an error page. The frontend should provide a fallback button to try again.

---

## 5. Complete Frontend Auth Service Example

```ts
// lib/auth.ts — Example frontend auth service

export interface User {
  id: number;
  email: string;
  name?: string;
  avatar?: string;
  role: 'user' | 'admin';
  status: 'active' | 'inactive' | 'banned';
  isEmailVerified: boolean;
  isPremium: boolean;
  googleId?: string;
  stripeCustomerId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CurrentUser {
  id: number;
  email: string;
  role: 'user' | 'admin';
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',     // ← CRITICAL: sends/receives cookies
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message);
  }

  // Handle 204 No Content
  if (res.status === 204) return undefined as T;

  const json = await res.json();
  return json.data ?? json;
}

export const authApi = {
  /** Login with email/password. Sets HttpOnly cookie automatically. */
  login(email: string, password: string): Promise<{ user: User }> {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  /** Logout. Reads token from cookie, clears cookie server-side. */
  logout(): Promise<{ message: string }> {
    return request('/auth/logout', { method: 'POST' });
  },

  /** Get current user JWT payload (id, email, role). */
  getCurrentUser(): Promise<CurrentUser> {
    return request('/auth/current-user');
  },

  /** Verify email using token from verification email. */
  verifyEmail(token: string): Promise<{ message: string }> {
    return request(`/auth/verify-email?token=${encodeURIComponent(token)}`, {
      method: 'POST',
    });
  },

  /** Send password reset email. */
  sendResetPassword(email: string): Promise<{ message: string }> {
    return request('/auth/reset-password/send', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  /** Verify password reset token. */
  verifyResetToken(token: string, email: string): Promise<{ message: string; userId: number }> {
    return request('/auth/reset-password/verify', {
      method: 'POST',
      body: JSON.stringify({ token, email }),
    });
  },

  /** Reset password using verified token. */
  resetPassword(email: string, password: string, token: string): Promise<{ message: string }> {
    return request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, password, token }),
    });
  },
};
```

---

## 6. Frontend App Initialization Flow

```ts
// app.ts or _app.tsx — On app mount

async function initializeApp() {
  // 1. Check if there's a ?refresh=1 from Google OAuth
  const params = new URLSearchParams(window.location.search);
  const fromGoogleOAuth = params.get('refresh') === '1';
  if (fromGoogleOAuth) {
    window.history.replaceState({}, '', window.location.pathname);
  }

  // 2. Try to get current user (cookie may or may not exist)
  try {
    const currentUser = await authApi.getCurrentUser();
    // User is authenticated — set app state
    appState.user = currentUser;
  } catch {
    // No valid auth cookie — user is not logged in
    appState.user = null;
  }

  // 3. Render the app
  renderApp();
}
```

---

## 7. What the Frontend No Longer Needs

After this refactor, the following frontend patterns are **eliminated**:

| ❌ Removed Pattern                                      | ✅ Replaced By                           |
|---------------------------------------------------------|------------------------------------------|
| `localStorage.setItem('token', access_token)`           | Browser manages cookie automatically     |
| `Authorization: Bearer <token>` header injection        | Browser sends cookie automatically       |
| Parsing `access_token` from login response              | Login returns only `{ user }`            |
| Sending `{ token }` in logout request body              | Logout reads token from cookie           |
| `localStorage.removeItem('token')` on logout            | Server clears cookie via `Set-Cookie`    |
| Checking `localStorage` for token on app load           | Cookie already present if logged in      |
| Interceptor that attaches token to every request        | `credentials: 'include'` on fetch/axios  |

### What the Frontend MUST Do

| ✅ Required                                              | Why                                      |
|---------------------------------------------------------|------------------------------------------|
| `credentials: 'include'` on all fetch requests          | Sends HttpOnly cookie to the server      |
| `withCredentials: true` on all axios requests           | Same as above for axios                  |
| Handle `401` responses by redirecting to login          | Token expired or invalid                 |
| Call `GET /api/auth/current-user` on app init           | Check if user is authenticated           |
| Store user data in app state                            | For UI rendering                         |

---

## 8. Endpoint Quick Reference

| #  | Method | Path                                  | Auth Required | Rate Limited | Description                      |
|----|--------|---------------------------------------|:-------------:|:------------:|----------------------------------|
| 1  | POST   | `/api/auth/login`                     | ❌            | ✅ 5/15min   | Login, sets HttpOnly cookie      |
| 2  | POST   | `/api/auth/logout`                    | ✅ (cookie)   | ❌           | Logout, clears cookie            |
| 3  | GET    | `/api/auth/current-user`              | ✅ (cookie)   | ❌           | Get JWT payload (id, email, role)|
| 4  | POST   | `/api/auth/verify-email?token=`       | ❌            | ✅ 5/15min   | Verify email address             |
| 5  | POST   | `/api/auth/reset-password/send`       | ❌            | ✅ 3/15min   | Send password reset email        |
| 6  | POST   | `/api/auth/reset-password/verify`     | ❌            | ✅ 5/15min   | Verify reset token validity      |
| 7  | POST   | `/api/auth/reset-password`            | ❌            | ✅ 5/hour    | Reset password                   |
| 8  | GET    | `/api/auth/google`                    | ❌            | ❌           | Redirect to Google OAuth         |
| 9  | GET    | `/api/auth/google/callback`           | ❌            | ❌           | Google OAuth callback (redirect) |

---

## 9. Auth State Machine for UI

```
[App Loads]
    │
    ├─ GET /api/auth/current-user
    │
    ├─ 200 OK ────→ [Authenticated] ──→ Show app with user data
    │
    └─ 401        → [Not Authenticated]
                       │
                       ├─ Show login page
                       ├─ Show sign-up page
                       └─ Show forgot-password flow

[Login Success] ──→ Cookie set by browser ──→ [Authenticated]
[Google OAuth]  ──→ Cookie set by server  ──→ [Authenticated]
[Logout]        ──→ Cookie cleared         ──→ [Not Authenticated]
[401 on any request] → [Not Authenticated]
```
