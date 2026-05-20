# Auth Module — Frontend Integration Plan

> **Backend:** NestJS v11 · TypeORM · PostgreSQL
> **Last Updated:** 2026-05-20
> **Audience:** Frontend / Full-Stack Developers

---

## Table of Contents

1. [Authentication Overview](#1-authentication-overview)
2. [API Endpoint Map](#2-api-endpoint-map)
3. [TypeScript Types & Interfaces](#3-typescript-types--interfaces)
4. [Cookie-Based Auth Flow](#4-cookie-based-auth-flow)
5. [API Client Setup](#5-api-client-setup)
6. [React Query Hooks](#6-react-query-hooks)
7. [Error Handling & Validation Mapping](#7-error-handling--validation-mapping)
8. [Example Usage (Next.js / React)](#8-example-usage-nextjs--react)
9. [Google OAuth Flow](#9-google-oauth-flow)
10. [Gotchas & Edge Cases](#10-gotchas--edge-cases)

---

## 1. Authentication Overview

### 1.1 How Auth Works

This backend uses **cookie-based JWT authentication**:

- On **login**, the backend returns a JSON response with `{ user, access_token }`. The frontend **must store the token in a cookie** named `sanad_auth_token` (or the value of the `AUTH_TOKEN` env variable).
- On **every subsequent request**, the backend reads the JWT from the `sanad_auth_token` cookie.
- A **global `AuthGuard`** protects all routes by default. Routes decorated with `@Public()` are exempt.
- On **logout**, the frontend sends the token in the request body. The backend adds it to a blacklist table so the token cannot be reused.
- Blacklisted tokens have an **expiration** and are automatically cleaned up.

### 1.2 Token Lifecycle

```
┌──────────┐    POST /auth/login     ┌──────────────────┐
│  Client  │ ──────────────────────► │  Backend         │
│          │ ◄────────────────────── │  Returns {user,  │
│          │   { user, access_token }│   access_token }  │
└──────────┘                         └──────────────────┘
      │                                       │
      │ Store token in cookie                 │
      │ (httpOnly, secure, sameSite=strict)   │
      ▼                                       ▼
┌──────────┐   Cookie: sanad_auth_token ┌──────────────────┐
│  Client  │ ─────────────────────────► │  AuthGuard       │
│          │   (every request)          │  verifies JWT +  │
│          │                            │  checks blacklist│
└──────────┘                            └──────────────────┘
```

### 1.3 Roles

| Role | Description |
|------|-------------|
| `user` | Default role assigned on registration |
| `admin` | Elevated privileges for admin endpoints |

The JWT payload contains `{ id, email, role }`.

---

## 2. API Endpoint Map

### 2.1 Public Endpoints (No auth required)

| Method | Path | Description | Request Body | Success Response | Error Codes | Rate Limit |
|--------|------|-------------|-------------|------------------|-------------|------------|
| `POST` | `/auth/login` | Email/password login | [`LoginDto`](#logindto) | [`LoginResponse`](#loginresponse) | `400`, `403` | 5 / 15 min |
| `POST` | `/auth/verify-email` | Verify email with token | Query: `?token=...` | [`MessageResponse`](#messageresponse) | `400` | 5 / 15 min |
| `POST` | `/auth/reset-password/send` | Request password reset email | [`SendResetPasswordDto`](#sendresetpassworddto) | [`MessageResponse`](#messageresponse) | `408` | 3 / 15 min |
| `POST` | `/auth/reset-password/verify` | Validate reset token | [`VerifyResetTokenDto`](#verifyresettokendto) | [`VerifyTokenResponse`](#verifytokenresponse) | `400` | 5 / 15 min |
| `POST` | `/auth/reset-password` | Reset password with token | [`ResetPasswordDto`](#resetpassworddto) | [`MessageResponse`](#messageresponse) | `400` | 5 / 1 hr |
| `GET` | `/auth/google` | Initiate Google OAuth | _none_ | _Redirect to Google_ | — | — |
| `GET` | `/auth/google/callback` | Google OAuth callback | _none_ | _Redirect to frontend with cookie set_ | — | — |

### 2.2 Protected Endpoints (JWT cookie required)

| Method | Path | Description | Request Body | Success Response | Error Codes |
|--------|------|-------------|-------------|------------------|-------------|
| `POST` | `/auth/logout` | Logout & blacklist token | [`LogoutDto`](#logoutdto) | [`MessageResponse`](#messageresponse) | `401` |
| `GET` | `/auth/current-user` | Get current user profile | _none_ | [`CurrentUserResponse`](#currentuserresponse) | `401` |

---

## 3. TypeScript Types & Interfaces

### 3.1 Request DTOs

```typescript
// ─── LoginDto ───────────────────────────────────────────────────────────
export interface LoginDto {
  email: string;    // valid email format
  password: string; // min 1 char (backend validates with argon2)
}

// ─── LogoutDto ──────────────────────────────────────────────────────────
export interface LogoutDto {
  token: string;    // JWT access_token to blacklist
}

// ─── SendResetPasswordDto ───────────────────────────────────────────────
export interface SendResetPasswordDto {
  email: string;    // valid email format
}

// ─── VerifyResetTokenDto ────────────────────────────────────────────────
export interface VerifyResetTokenDto {
  token: string;    // reset token from email link
  email: string;    // user's email
}

// ─── ResetPasswordDto ───────────────────────────────────────────────────
export interface ResetPasswordDto {
  email: string;    // valid email format
  password: string; // min 6 characters
  token: string;    // reset token from email link
}
```

### 3.2 Response Types

```typescript
// ─── Login Response ─────────────────────────────────────────────────────
export interface LoginResponse {
  user: {
    id: number;
    email: string;
    role: 'user' | 'admin';
    isEmailVerified: boolean;
    avatar?: string;
  };
  access_token: string;  // JWT — store in httpOnly cookie
}

// ─── Current User Response ──────────────────────────────────────────────
export interface CurrentUserResponse {
  id: number | string;
  email: string;
  role: 'user' | 'admin';
}

// ─── Verify Token Response ──────────────────────────────────────────────
export interface VerifyTokenResponse {
  message: string;   // "This token is valid"
  userId: number;
}

// ─── Generic Message Response ───────────────────────────────────────────
export interface MessageResponse {
  message: string;
}
```

### 3.3 User Roles

```typescript
export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}
```

### 3.4 Error Response Shape (Global)

```typescript
export interface ApiError {
  statusCode: number;
  message: string | string[];
  errors?: Array<{ field: string; message: string }>;
  timestamp: string;   // ISO 8601
  path: string;        // request URL
}
```

---

## 4. Cookie-Based Auth Flow

### 4.1 Login Flow (Email/Password)

```
1. POST /auth/login { email, password }
2. Backend returns { user, access_token }
3. Frontend stores access_token in httpOnly cookie:
   - Name: sanad_auth_token (or AUTH_TOKEN env var)
   - httpOnly: true
   - secure: true (production only)
   - sameSite: strict
   - maxAge: 5 days (matches backend cookie config)
   - path: /
4. All subsequent requests automatically include the cookie
```

### 4.2 Logout Flow

```
1. Read the token from the cookie
2. POST /auth/logout { token: <cookie value> }
3. Backend blacklists the token
4. Frontend deletes the cookie
5. Redirect to login page
```

### 4.3 Email Verification Flow

```
1. User registers (handled by UserService, not Auth module)
2. Backend sends verification email with token
3. User clicks link: /verify-email?token=abc123
4. Frontend extracts token and calls:
   POST /auth/verify-email?token=abc123
5. On success, redirect to login
```

### 4.4 Password Reset Flow

```
1. User enters email on "Forgot Password" page
2. POST /auth/reset-password/send { email }
3. Backend sends email with reset link (token valid 1 hour)
4. User clicks link: /reset-password?token=abc123&email=user@example.com
5. Frontend extracts params and calls:
   POST /auth/reset-password/verify { token, email }
6. On success, show password change form
7. User enters new password:
   POST /auth/reset-password { email, password, token }
8. On success, redirect to login
```

---

## 5. API Client Setup

### 5.1 Base Axios Instance

```typescript
// lib/api/client.ts
import axios, { AxiosError } from 'axios';
import type { ApiError } from '@/types/auth';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,  // CRITICAL: sends cookies with requests
});

// Normalize error shape
api.interceptors.response.use(
  (res) => res,
  (error: AxiosError<ApiError>) => {
    const apiError: ApiError = error.response?.data ?? {
      statusCode: error.response?.status ?? 500,
      message: error.message ?? 'Unknown error',
      timestamp: new Date().toISOString(),
      path: error.config?.url ?? '',
    };
    return Promise.reject(apiError);
  },
);

export default api;
```

> **IMPORTANT:** `withCredentials: true` is required for cookie-based auth. Without it, the browser won't send the `sanad_auth_token` cookie with requests.

### 5.2 Auth API Functions

```typescript
// lib/api/auth.ts
import api from './client';
import type {
  LoginDto,
  LoginResponse,
  LogoutDto,
  SendResetPasswordDto,
  VerifyResetTokenDto,
  ResetPasswordDto,
  VerifyTokenResponse,
  CurrentUserResponse,
  MessageResponse,
} from '@/types/auth';

// ─── Public ─────────────────────────────────────────────────────────────

export async function login(dto: LoginDto): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', dto);
  return data;
}

export async function verifyEmail(token: string): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>('/auth/verify-email', null, {
    params: { token },
  });
  return data;
}

export async function sendResetPassword(
  dto: SendResetPasswordDto,
): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>(
    '/auth/reset-password/send',
    dto,
  );
  return data;
}

export async function verifyResetToken(
  dto: VerifyResetTokenDto,
): Promise<VerifyTokenResponse> {
  const { data } = await api.post<VerifyTokenResponse>(
    '/auth/reset-password/verify',
    dto,
  );
  return data;
}

export async function resetPassword(
  dto: ResetPasswordDto,
): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>(
    '/auth/reset-password',
    dto,
  );
  return data;
}

// ─── Protected ──────────────────────────────────────────────────────────

export async function logout(dto: LogoutDto): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>('/auth/logout', dto);
  return data;
}

export async function getCurrentUser(): Promise<CurrentUserResponse> {
  const { data } = await api.get<CurrentUserResponse>('/auth/current-user');
  return data;
}
```

### 5.3 Cookie Helper (Client-Side)

```typescript
// lib/auth/cookie.ts

const COOKIE_NAME = process.env.NEXT_PUBLIC_AUTH_COOKIE || 'sanad_auth_token';

/**
 * Get the auth token from cookies (client-side only).
 * Returns null if cookie doesn't exist.
 */
export function getAuthToken(): string | null {
  if (typeof document === 'undefined') return null;

  const match = document.cookie.match(
    new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Delete the auth cookie (client-side only).
 * Used after logout to clear the cookie.
 */
export function deleteAuthToken(): void {
  if (typeof document === 'undefined') return;

  document.cookie = `${COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; sameSite=strict`;
}
```

---

## 6. React Query Hooks

### 6.1 Query Keys Factory

```typescript
// lib/api/auth-keys.ts
export const authKeys = {
  all: ['auth'] as const,
  currentUser: () => [...authKeys.all, 'currentUser'] as const,
};
```

### 6.2 Auth Hooks

```typescript
// hooks/use-auth.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { authKeys } from '@/lib/api/auth-keys';
import {
  login,
  logout,
  getCurrentUser,
  verifyEmail,
  sendResetPassword,
  verifyResetToken,
  resetPassword,
} from '@/lib/api/auth';
import type {
  LoginDto,
  LogoutDto,
  SendResetPasswordDto,
  VerifyResetTokenDto,
  ResetPasswordDto,
} from '@/types/auth';
import { deleteAuthToken } from '@/lib/auth/cookie';

// ─── Current User Query ─────────────────────────────────────────────────

export function useCurrentUser() {
  return useQuery({
    queryKey: authKeys.currentUser(),
    queryFn: getCurrentUser,
    staleTime: 5 * 60_000, // 5 minutes
    retry: false,          // Don't retry on 401 — redirect to login instead
  });
}

// ─── Login Mutation ─────────────────────────────────────────────────────

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: () => {
      // Token is now in cookie; fetch user profile
      qc.invalidateQueries({ queryKey: authKeys.currentUser() });
    },
  });
}

// ─── Logout Mutation ────────────────────────────────────────────────────

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onMutate: () => {
      // Get token before calling API (needed for request body)
      const token = getAuthToken();
      return { token };
    },
    mutationFn: async (_, context) => {
      if (context?.token) {
        await logout({ token: context.token });
      }
    },
    onSuccess: () => {
      deleteAuthToken();
      qc.invalidateQueries({ queryKey: authKeys.currentUser() });
      qc.removeQueries({ queryKey: authKeys.currentUser() });
    },
  });
}

// ─── Email Verification Mutation ────────────────────────────────────────

export function useVerifyEmail() {
  return useMutation({
    mutationFn: verifyEmail,
  });
}

// ─── Password Reset Mutations ───────────────────────────────────────────

export function useSendResetPassword() {
  return useMutation({
    mutationFn: sendResetPassword,
  });
}

export function useVerifyResetToken() {
  return useMutation({
    mutationFn: verifyResetToken,
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: resetPassword,
  });
}
```

---

## 7. Error Handling & Validation Mapping

### 7.1 HTTP Status Codes & Meanings

| Status | When | Frontend Action |
|--------|------|-----------------|
| `400` | Validation failure, invalid credentials, expired token | Show inline form errors or toast |
| `401` | Missing/expired/revoked JWT cookie | Redirect to login page |
| `403` | Email not verified (on login) | Show "check your email" message |
| `408` | Email service timeout (on reset-password/send) | Show "try again later" message |
| `429` | Rate limit exceeded | Show "too many attempts, try again later" |
| `500` | Server error | Show generic error toast |

### 7.2 Known Backend Error Messages

| Endpoint | Error Message | Trigger |
|----------|--------------|---------|
| `POST /auth/login` | `"Invalid email or password"` | Wrong email or password |
| `POST /auth/login` | `"You need to verify your email first"` | User exists but `isEmailVerified = false` |
| `POST /auth/verify-email` | `"The token is required"` | Missing token query param |
| `POST /auth/verify-email` | `"Invalid or expired token"` | Token not found in DB |
| `POST /auth/verify-email` | `"The user is already verified"` | User already verified |
| `POST /auth/reset-password/send` | _(no error — always returns success message)_ | Email not found (intentional) |
| `POST /auth/reset-password/verify` | `"Invalid token or user not found"` | No user or no reset token |
| `POST /auth/reset-password/verify` | `"Token has expired"` | Token older than 1 hour |
| `POST /auth/reset-password/verify` | `"Invalid token"` | Token doesn't match hash |
| `POST /auth/reset-password` | `"Invalid request"` | No user or no reset token |
| `POST /auth/reset-password` | `"Token has expired"` | Token older than 1 hour |
| `POST /auth/reset-password` | `"Invalid token"` | Token doesn't match hash |
| `POST /auth/logout` | `"Authentication cookie not found"` | No cookie sent |
| `GET /auth/current-user` | `"Authentication cookie not found"` | No cookie sent |
| `GET /auth/current-user` | `"Invalid or expired token"` | Expired/invalid JWT |
| `GET /auth/current-user` | `"This token has been revoked"` | Token is blacklisted |

### 7.3 Validation Error Parsing

```typescript
// lib/api/error-utils.ts
import type { ApiError } from '@/types/auth';

export function parseValidationErrors(error: ApiError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  if (Array.isArray(error.message)) {
    // NestJS default: ["email must be an email", "password must be longer than..."]
    error.message.forEach((msg) => {
      const match = msg.match(/^(\w+)\s/);
      if (match) {
        fieldErrors[match[1]] = msg;
      }
    });
  } else if (typeof error.message === 'string') {
    // Single error message (e.g., "Invalid email or password")
    fieldErrors._global = error.message;
  }

  return fieldErrors;
}
```

---

## 8. Example Usage (Next.js / React)

### 8.1 Login Page

```typescript
// app/login/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLogin } from '@/hooks/use-auth';
import { parseValidationErrors } from '@/lib/api/error-utils';
import type { LoginDto } from '@/types/auth';

export default function LoginPage() {
  const router = useRouter();
  const loginMutation = useLogin();
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormErrors({});

    const formData = new FormData(e.currentTarget);
    const dto: LoginDto = {
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    };

    try {
      await loginMutation.mutateAsync(dto);
      router.push('/dashboard');
    } catch (err: unknown) {
      const apiError = err as { statusCode: number; message: string | string[] };

      if (apiError.statusCode === 403) {
        // Email not verified
        setFormErrors({
          _global: 'Please check your email and verify your account first.',
        });
      } else {
        setFormErrors(parseValidationErrors(apiError));
      }
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>Login</h1>

      <div>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
        {formErrors.email && <span className="error">{formErrors.email}</span>}
      </div>

      <div>
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required />
        {formErrors.password && <span className="error">{formErrors.password}</span>}
      </div>

      {formErrors._global && <Alert variant="error">{formErrors._global}</Alert>}

      <button type="submit" disabled={loginMutation.isPending}>
        {loginMutation.isPending ? 'Logging in...' : 'Login'}
      </button>

      <a href="/forgot-password">Forgot password?</a>
      <a href="/auth/google">Login with Google</a>
    </form>
  );
}
```

### 8.2 Logout Button

```typescript
// components/Auth/LogoutButton.tsx
'use client';

import { useLogout } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  const logoutMutation = useLogout();

  const handleLogout = async () => {
    await logoutMutation.mutateAsync();
    router.push('/login');
  };

  return (
    <button onClick={handleLogout} disabled={logoutMutation.isPending}>
      {logoutMutation.isPending ? 'Logging out...' : 'Logout'}
    </button>
  );
}
```

### 8.3 Protected Route Guard (Middleware)

```typescript
// middleware.ts (Next.js App Router)
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const COOKIE_NAME = process.env.NEXT_PUBLIC_AUTH_COOKIE || 'sanad_auth_token';
const PROTECTED_PATHS = ['/dashboard', '/admin', '/settings'];
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password'];

export function middleware(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PATHS.some((p) => pathname.startsWith(p));
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (isProtected && !token) {
    // Redirect to login with return URL
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isPublic && token) {
    // Already logged in — redirect to dashboard
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*', '/settings/:path*', '/login', '/register', '/forgot-password'],
};
```

### 8.4 Forgot Password Page

```typescript
// app/forgot-password/page.tsx
'use client';

import { useState } from 'react';
import { useSendResetPassword } from '@/hooks/use-auth';
import type { SendResetPasswordDto } from '@/types/auth';

export default function ForgotPasswordPage() {
  const sendMutation = useSendResetPassword();
  const [submitted, setSubmitted] = useState(false);
  const [email, setEmail] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const dto: SendResetPasswordDto = { email };

    try {
      await sendMutation.mutateAsync(dto);
      setSubmitted(true);
    } catch {
      // Backend always returns success message (even if email doesn't exist)
      // Only catches rate limits or network errors
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div>
        <h1>Check your email</h1>
        <p>If an account exists with this email, a reset link has been sent.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Forgot Password</h1>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Enter your email"
        required
      />
      <button type="submit" disabled={sendMutation.isPending}>
        {sendMutation.isPending ? 'Sending...' : 'Send Reset Link'}
      </button>
    </form>
  );
}
```

### 8.5 Reset Password Page

```typescript
// app/reset-password/page.tsx
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useVerifyResetToken, useResetPassword } from '@/hooks/use-auth';
import type { ResetPasswordDto } from '@/types/auth';

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const email = searchParams.get('email') ?? '';

  const [step, setStep] = useState<'verify' | 'reset'>('verify');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const verifyMutation = useVerifyResetToken();
  const resetMutation = useResetPassword();

  const handleVerify = async () => {
    try {
      await verifyMutation.mutateAsync({ token, email });
      setStep('reset');
    } catch (err: unknown) {
      const apiError = err as { message: string };
      setError(apiError.message ?? 'Invalid or expired token');
    }
  };

  const handleReset = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    try {
      const dto: ResetPasswordDto = { email, password, token };
      await resetMutation.mutateAsync(dto);
      router.push('/login?reset=success');
    } catch (err: unknown) {
      const apiError = err as { message: string };
      setError(apiError.message ?? 'Failed to reset password');
    }
  };

  if (step === 'verify') {
    return (
      <div>
        <h1>Verify Reset Token</h1>
        <button onClick={handleVerify} disabled={verifyMutation.isPending}>
          {verifyMutation.isPending ? 'Verifying...' : 'Verify Token'}
        </button>
        {error && <Alert variant="error">{error}</Alert>}
      </div>
    );
  }

  return (
    <form onSubmit={handleReset}>
      <h1>Reset Password</h1>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="New password"
        required
        minLength={6}
      />
      <input
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        placeholder="Confirm password"
        required
      />
      {error && <Alert variant="error">{error}</Alert>}
      <button type="submit" disabled={resetMutation.isPending}>
        {resetMutation.isPending ? 'Resetting...' : 'Reset Password'}
      </button>
    </form>
  );
}
```

---

## 9. Google OAuth Flow

### 9.1 Flow Diagram

```
┌──────────┐  GET /auth/google    ┌──────────┐   Google login   ┌──────────┐
│  Client  │ ───────────────────► │  Backend │ ───────────────► │  Google  │
│          │                      │          │ ◄─────────────── │          │
│          │   (302 redirect)     │          │   (callback)     │          │
└──────────┘                      └──────────┘                  └──────────┘
                                        │
                                        │ Sets sanad_auth_token cookie
                                        │ 302 redirect to frontend
                                        ▼
                                  ┌──────────┐
                                  │  Client  │
                                  │ (frontend│
                                  │ ?refresh=1)
                                  └──────────┘
```

### 9.2 Implementation

```typescript
// components/Auth/GoogleLoginButton.tsx
export function GoogleLoginButton() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  const handleGoogleLogin = () => {
    // Redirect to backend Google OAuth endpoint
    window.location.href = `${apiUrl}/auth/google`;
  };

  return (
    <button onClick={handleGoogleLogin}>
      Continue with Google
    </button>
  );
}
```

### 9.3 Callback Handling

After Google OAuth completes, the backend redirects to:
```
{FRONTEND_URL}?refresh=1
```

The frontend should detect the `refresh=1` query param and refetch the current user:

```typescript
// app/page.tsx (or layout.tsx)
'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { authKeys } from '@/lib/api/auth-keys';

export function OAuthCallbackHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    const refresh = searchParams.get('refresh');
    if (refresh === '1') {
      // Google OAuth just completed — refetch user
      qc.invalidateQueries({ queryKey: authKeys.currentUser() });
      // Clean up URL
      router.replace('/');
    }
  }, [searchParams, qc, router]);

  return null;
}
```

---

## 10. Gotchas & Edge Cases

### 10.1 Cookie Configuration

| Property | Value | Notes |
|----------|-------|-------|
| `name` | `sanad_auth_token` | Configurable via `AUTH_TOKEN` env var |
| `httpOnly` | `true` | JavaScript cannot read — XSS safe |
| `secure` | `true` in production, `false` in dev | Must use HTTPS in production |
| `sameSite` | `strict` | CSRF protection |
| `maxAge` | `432000000` ms (5 days) | Matches JWT expiry |
| `path` | `/` | Sent with all requests |

### 10.2 `withCredentials` is Required

All API requests **must** include `withCredentials: true` (or `credentials: 'include'` for fetch). Without this, the browser won't send the auth cookie.

```typescript
// Axios
const api = axios.create({ withCredentials: true });

// Fetch
fetch('/api/endpoint', { credentials: 'include' });
```

### 10.3 CORS Configuration

The backend must allow your frontend origin with `credentials: true`. In production, CORS should **not** be set to `*`. Ensure the backend's CORS config includes your frontend URL:

```
Access-Control-Allow-Origin: https://your-frontend.com
Access-Control-Allow-Credentials: true
```

### 10.4 Token Blacklist & Logout

- After logout, the token is added to a blacklist table with an expiration.
- The `AuthGuard` checks this table on every request.
- **Performance note:** Under high load, consider caching the blacklist in Redis (not yet implemented).
- Expired blacklist entries should be cleaned up via a scheduled job (not yet implemented).

### 10.5 Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /auth/login` | 5 attempts | 15 minutes |
| `POST /auth/verify-email` | 5 attempts | 15 minutes |
| `POST /auth/reset-password/send` | 3 attempts | 15 minutes |
| `POST /auth/reset-password/verify` | 5 attempts | 15 minutes |
| `POST /auth/reset-password` | 5 attempts | 1 hour |

When rate limited, the backend returns `429 Too Many Requests`. Show a user-friendly message and disable the form.

### 10.6 Email Not Found on Password Reset

The `POST /auth/reset-password/send` endpoint **always returns a success message**, even if the email doesn't exist. This is intentional to prevent email enumeration attacks. The frontend should display the same message regardless.

### 10.7 Password Reset Token Expiry

Reset tokens expire after **1 hour**. If the user tries to use an expired token:
- `POST /auth/reset-password/verify` returns `400` with `"Token has expired"`
- The frontend should show an error and prompt the user to request a new reset link.

### 10.8 Email Verification on Login

If a user tries to login without verifying their email:
- Backend returns `403 Forbidden` with `"You need to verify your email first"`
- Backend **also resends** the verification email automatically
- Frontend should show a message like: "Please check your email. A new verification link has been sent."

### 10.9 JWT Payload vs Full User Object

The `GET /auth/current-user` endpoint returns only the **JWT payload** (`{ id, email, role }`), not the full user entity. If the frontend needs additional user data (name, avatar, etc.), it should:
1. Store the extra data from the `POST /auth/login` response, or
2. Call a dedicated user profile endpoint (if available in the User module)

### 10.10 Google OAuth — Existing User Linking

If a user logs in with Google using an email that already exists in the system (registered via email/password):
- The backend **links** the Google account to the existing user
- Sets `isEmailVerified = true` automatically
- Updates `name` and `avatar` from Google profile

### 10.11 Server-Side Rendering (Next.js)

For SSR pages that need auth state, read the cookie from the request headers:

```typescript
// app/dashboard/page.tsx (Server Component)
import { cookies } from 'next/headers';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('sanad_auth_token')?.value;

  if (!token) {
    // Redirect to login
    redirect('/login');
  }

  // Fetch user data from backend using the token
  const user = await fetchUserFromApi(token);

  return <Dashboard user={user} />;
}
```

---

## Appendix A: Complete File Structure (Frontend)

```
frontend/
├── types/
│   └── auth.ts                     # All TypeScript interfaces
├── lib/
│   ├── api/
│   │   ├── client.ts               # Axios instance with withCredentials
│   │   ├── auth.ts                 # Auth API functions
│   │   ├── auth-keys.ts            # React Query keys
│   │   └── error-utils.ts          # Error parsing helpers
│   └── auth/
│       └── cookie.ts               # Cookie read/delete helpers
├── hooks/
│   └── use-auth.ts                 # All auth-related React Query hooks
├── components/
│   └── Auth/
│       ├── LoginForm.tsx
│       ├── LogoutButton.tsx
│       ├── GoogleLoginButton.tsx
│       └── ProtectedRoute.tsx
├── middleware.ts                    # Next.js route protection
└── app/
    ├── login/
    │   └── page.tsx
    ├── forgot-password/
    │   └── page.tsx
    ├── reset-password/
    │   └── page.tsx
    ├── verify-email/
    │   └── page.tsx
    └── dashboard/
        └── page.tsx
```

---

## Appendix B: Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│  AUTH MODULE — QUICK REFERENCE                                  │
├─────────────────────────────────────────────────────────────────┤
│  Base URL:    /auth                                             │
│  Auth Type:   Cookie-based JWT (httpOnly)                       │
│  Cookie Name: sanad_auth_token (or AUTH_TOKEN env)              │
│  Cookie TTL:  5 days                                            │
│  JWT Payload: { id, email, role }                               │
│  Roles:       user, admin                                       │
│  Axios:       withCredentials: true (REQUIRED)                  │
│  CORS:        Must allow frontend origin + credentials          │
├─────────────────────────────────────────────────────────────────┤
│  POST /auth/login              → { user, access_token }         │
│  POST /auth/logout             → { message }                    │
│  GET  /auth/current-user       → { id, email, role }            │
│  POST /auth/verify-email?token → { message }                    │
│  POST /auth/reset-password/send → { message }                   │
│  POST /auth/reset-password/verify → { message, userId }         │
│  POST /auth/reset-password     → { message }                    │
│  GET  /auth/google             → Redirect to Google             │
│  GET  /auth/google/callback    → Redirect to frontend           │
├─────────────────────────────────────────────────────────────────┤
│  Rate Limits: 5 login/15min, 3 reset-send/15min, 5 reset/1hr   │
│  Reset Token: Expires in 1 hour                                 │
│  Email Verify: Auto-resends on failed login if unverified       │
│  Google OAuth: Links to existing user by email                  │
│  Error Shape: { statusCode, message, timestamp, path }          │
└─────────────────────────────────────────────────────────────────┘
```
