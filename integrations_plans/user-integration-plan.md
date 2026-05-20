# User Module — Frontend Integration Plan

> **Backend:** NestJS v11 · TypeORM · PostgreSQL
> **Last Updated:** 2026-05-21
> **Audience:** Frontend / Full-Stack Developers

---

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [API Endpoint Map](#2-api-endpoint-map)
3. [TypeScript Types & Interfaces](#3-typescript-types--interfaces)
4. [API Client Setup](#4-api-client-setup)
5. [React Query Hooks](#5-react-query-hooks)
6. [Error Handling & Validation Mapping](#6-error-handling--validation-mapping)
7. [Example Usage (Next.js / React)](#7-example-usage-nextjs--react)
8. [Gotchas & Edge Cases](#8-gotchas--edge-cases)

---

## 1. Module Overview

### 1.1 What the User Module Does

The User module handles **user lifecycle management**:

- **Registration** — create a new user account (public endpoint)
- **Email verification** — verify a user's email with a token (public endpoint)
- **User listing** — paginated, filterable list of all users (admin only)
- **User statistics** — aggregate counts for admin dashboard (admin only)
- **Profile viewing** — get a single user by ID (admin: any user; regular: own profile only)
- **Profile updating** — update user fields (admin: any user; regular: own profile only)
- **User deletion** — soft/hard delete a user (admin only)

### 1.2 Authorization Rules

| Action | Admin | Regular User |
|--------|-------|-------------|
| Register | ✅ (public) | ✅ (public) |
| Verify email | ✅ (public) | ✅ (public) |
| List all users | ✅ | ❌ Forbidden |
| View stats | ✅ | ❌ Forbidden |
| View any user profile | ✅ | ❌ Forbidden (own only) |
| View own profile | ✅ | ✅ |
| Update any user | ✅ | ❌ Forbidden (own only) |
| Update own profile | ✅ | ✅ |
| Delete any user | ✅ | ❌ Forbidden |

### 1.3 Role & Status Enums

```typescript
export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BANNED = 'banned',
}
```

---

## 2. API Endpoint Map

### 2.1 Public Endpoints (No auth required)

| Method | Path | Description | Request Body | Success Response | Error Codes |
|--------|------|-------------|-------------|------------------|-------------|
| `POST` | `/user` | Register a new user | [`CreateUserDto`](#createuserdto) | [`User`](#user) | `400` |
| `POST` | `/user/verify-email` | Verify email with token | [`VerifyEmailDto`](#verifyemaildto) | [`User`](#user) | `400`, `404` |

### 2.2 Protected Endpoints (JWT cookie required)

| Method | Path | Description | Request Body | Query Params | Success Response | Error Codes | Roles |
|--------|------|-------------|-------------|-------------|------------------|-------------|-------|
| `GET` | `/user` | List all users (paginated) | _none_ | [`FilterOptionsDto`](#filteroptionsdto) | [`PaginatedResult<User>`](#paginatedresultuser) | `401`, `403` | Admin |
| `GET` | `/user/stats` | User statistics | _none_ | _none_ | [`UserStats`](#userstats) | `401`, `403` | Admin |
| `GET` | `/user/:id` | Get user by ID | _none_ | _none_ | [`User`](#user) | `401`, `403`, `404` | Admin / Self |
| `PATCH` | `/user/:id` | Update user | [`UpdateUserDto`](#updateuserdto) | _none_ | [`User`](#user) | `400`, `401`, `403`, `404` | Admin / Self |
| `DELETE` | `/user/:id` | Delete user | _none_ | _none_ | [`User`](#user) | `401`, `403`, `404` | Admin |

---

## 3. TypeScript Types & Interfaces

### 3.1 Request DTOs

```typescript
// ─── CreateUserDto ──────────────────────────────────────────────────────
export interface CreateUserDto {
  email: string;       // valid email format (unique)
  password: string;    // min 8 chars, must contain uppercase + lowercase + number
  name?: string;       // optional display name (unique if provided)
  avatar?: string;     // optional avatar URL
}

// ─── UpdateUserDto ──────────────────────────────────────────────────────
export interface UpdateUserDto {
  name?: string;
  email?: string;      // triggers re-verification if changed
  avatar?: string;
  password?: string;   // min 8 chars, must contain uppercase + lowercase + number
  // Admin-only fields (ignored for non-admin callers):
  role?: UserRole;
  status?: UserStatus;
}

// ─── VerifyEmailDto ─────────────────────────────────────────────────────
export interface VerifyEmailDto {
  token: string;       // min 6 characters, from verification email
}

// ─── FilterOptionsDto (extends PaginationDto) ───────────────────────────
export interface FilterOptionsDto {
  page?: number;       // default: 1, min: 1
  limit?: number;      // default: 10, min: 1, max: 100
  role?: UserRole;     // filter by role
  status?: UserStatus; // filter by status
  search?: string;     // searches name and email (case-insensitive)
}
```

### 3.2 Response Types

```typescript
// ─── User ───────────────────────────────────────────────────────────────
export interface User {
  id: number;
  email: string;
  name?: string;
  avatar?: string;
  role: UserRole;
  status: UserStatus;
  isEmailVerified: boolean;
  isPremium: boolean;
  googleId?: string;
  createdAt: string;    // ISO 8601 date
  updatedAt: string;    // ISO 8601 date
  // NOTE: password is never returned in responses
}

// ─── PaginatedResult<User> ──────────────────────────────────────────────
export interface PaginatedResult<T> {
  data: T[];
  total: number;        // total records matching the filter
  page: number;         // current page number
  perPage: number;      // items per page
  lastPage: number;     // total number of pages
}

// ─── UserStats ──────────────────────────────────────────────────────────
export interface UserStats {
  adminsNumber: number;
  verifiedUsersNumber: number;
  unverifiedUsersNumber: number;
}
```

### 3.3 Enums

```typescript
export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BANNED = 'banned',
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

## 4. API Client Setup

### 4.1 User API Functions

```typescript
// lib/api/user.ts
import api from './client';  // your axios instance with withCredentials: true
import type {
  User,
  CreateUserDto,
  UpdateUserDto,
  VerifyEmailDto,
  FilterOptionsDto,
  PaginatedResult,
  UserStats,
} from '@/types/user';

// ─── Public ─────────────────────────────────────────────────────────────

export async function register(dto: CreateUserDto): Promise<User> {
  const { data } = await api.post<User>('/user', dto);
  return data;
}

export async function verifyEmail(dto: VerifyEmailDto): Promise<User> {
  const { data } = await api.post<User>('/user/verify-email', dto);
  return data;
}

// ─── Admin Only ─────────────────────────────────────────────────────────

export async function listUsers(
  options: FilterOptionsDto = {},
): Promise<PaginatedResult<User>> {
  const { data } = await api.get<PaginatedResult<User>>('/user', {
    params: options,
  });
  return data;
}

export async function getUserStats(): Promise<UserStats> {
  const { data } = await api.get<UserStats>('/user/stats');
  return data;
}

export async function deleteUser(id: number): Promise<User> {
  const { data } = await api.delete<User>(`/user/${id}`);
  return data;
}

// ─── Protected (Admin or Self) ──────────────────────────────────────────

export async function getUserById(id: number): Promise<User> {
  const { data } = await api.get<User>(`/user/${id}`);
  return data;
}

export async function updateUser(
  id: number,
  dto: UpdateUserDto,
): Promise<User> {
  const { data } = await api.patch<User>(`/user/${id}`, dto);
  return data;
}
```

---

## 5. React Query Hooks

### 5.1 Query Keys Factory

```typescript
// lib/api/user-keys.ts
export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...userKeys.lists(), filters] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: number) => [...userKeys.details(), id] as const,
  stats: () => [...userKeys.all, 'stats'] as const,
};
```

### 5.2 User Hooks

```typescript
// hooks/use-users.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { userKeys } from '@/lib/api/user-keys';
import {
  register,
  verifyEmail,
  listUsers,
  getUserStats,
  getUserById,
  updateUser,
  deleteUser,
} from '@/lib/api/user';
import type {
  CreateUserDto,
  UpdateUserDto,
  VerifyEmailDto,
  FilterOptionsDto,
} from '@/types/user';

// ─── Registration Mutation ──────────────────────────────────────────────

export function useRegister() {
  return useMutation({
    mutationFn: register,
  });
}

// ─── Email Verification Mutation ────────────────────────────────────────

export function useVerifyEmail() {
  return useMutation({
    mutationFn: verifyEmail,
  });
}

// ─── User List Query (Admin) ────────────────────────────────────────────

export function useUsers(filters: FilterOptionsDto = {}) {
  return useQuery({
    queryKey: userKeys.list(filters),
    queryFn: () => listUsers(filters),
    staleTime: 30_000, // 30 seconds
  });
}

// ─── User Stats Query (Admin) ───────────────────────────────────────────

export function useUserStats() {
  return useQuery({
    queryKey: userKeys.stats(),
    queryFn: getUserStats,
    staleTime: 60_000, // 1 minute
  });
}

// ─── Single User Query ──────────────────────────────────────────────────

export function useUser(id: number) {
  return useQuery({
    queryKey: userKeys.detail(id),
    queryFn: () => getUserById(id),
    enabled: !!id,
    staleTime: 30_000,
  });
}

// ─── Update User Mutation ───────────────────────────────────────────────

export function useUpdateUser(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateUserDto) => updateUser(id, dto),
    onSuccess: (updatedUser) => {
      // Update the cached user detail
      qc.setQueryData(userKeys.detail(id), updatedUser);
      // Invalidate the list to reflect changes
      qc.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}

// ─── Delete User Mutation (Admin) ───────────────────────────────────────

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteUser,
    onSuccess: (_, deletedId) => {
      // Remove from cache
      qc.removeQueries({ queryKey: userKeys.detail(deletedId) });
      // Refresh the list
      qc.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}
```

---

## 6. Error Handling & Validation Mapping

### 6.1 HTTP Status Codes & Meanings

| Status | When | Frontend Action |
|--------|------|-----------------|
| `400` | Validation failure, user already exists, expired token | Show inline form errors or toast |
| `401` | Missing/expired JWT cookie | Redirect to login page |
| `403` | Insufficient permissions (non-admin accessing admin endpoint, or accessing another user's profile) | Show "access denied" message |
| `404` | User not found, invalid verification token | Show "not found" message |
| `429` | Rate limit exceeded | Show "too many attempts" message |
| `500` | Server error | Show generic error toast |

### 6.2 Known Backend Error Messages

| Endpoint | Error Message | Trigger |
|----------|--------------|---------|
| `POST /user` | `"User already exists"` | Email is already registered |
| `POST /user/verify-email` | `"Invalid verification token"` | Token not found in database |
| `POST /user/verify-email` | `"Verification token has expired"` | Token past its expiry date |
| `GET /user/:id` | `"User with ID {id} not found"` | No user with that ID |
| `GET /user/:id` | `"You can only view your own profile"` | Non-admin trying to view another user |
| `PATCH /user/:id` | `"User with ID {id} not found"` | No user with that ID |
| `PATCH /user/:id` | `"You can only update your own profile"` | Non-admin trying to update another user |
| `DELETE /user/:id` | `"User with ID {id} not found"` | No user with that ID |

### 6.3 Validation Rules (Client-Side Mirroring)

| Field | Rules |
|-------|-------|
| `email` | Valid email format, required |
| `password` | Min 8 chars, must contain: 1 lowercase, 1 uppercase, 1 number |
| `name` | Optional string, must be unique if provided |
| `avatar` | Optional URL string |
| `token` (verify) | Min 6 characters |

---

## 7. Example Usage (Next.js / React)

### 7.1 Registration Page

```typescript
// app/register/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRegister } from '@/hooks/use-users';
import type { CreateUserDto } from '@/types/user';

export default function RegisterPage() {
  const router = useRouter();
  const registerMutation = useRegister();
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormErrors({});

    const formData = new FormData(e.currentTarget);
    const dto: CreateUserDto = {
      email: formData.get('email') as string,
      password: formData.get('password') as string,
      name: (formData.get('name') as string) || undefined,
    };

    try {
      await registerMutation.mutateAsync(dto);
      // Registration succeeded — show "check your email" message
      router.push('/register/success');
    } catch (err: unknown) {
      const apiError = err as { statusCode: number; message: string | string[] };

      if (apiError.statusCode === 400) {
        if (apiError.message === 'User already exists') {
          setFormErrors({ email: 'This email is already registered' });
        } else if (Array.isArray(apiError.message)) {
          // class-validator errors: ["password must be longer than...", ...]
          apiError.message.forEach((msg) => {
            const field = msg.split(' ')[0]?.toLowerCase();
            setFormErrors((prev) => ({ ...prev, [field]: msg }));
          });
        }
      }
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>Create Account</h1>

      <div>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
        {formErrors.email && <span className="error">{formErrors.email}</span>}
      </div>

      <div>
        <label htmlFor="name">Name (optional)</label>
        <input id="name" name="name" type="text" />
      </div>

      <div>
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required minLength={8} />
        {formErrors.password && <span className="error">{formErrors.password}</span>}
        <p className="hint">
          Must be at least 8 characters with uppercase, lowercase, and a number.
        </p>
      </div>

      <button type="submit" disabled={registerMutation.isPending}>
        {registerMutation.isPending ? 'Creating account...' : 'Register'}
      </button>
    </form>
  );
}
```

### 7.2 Email Verification Page

```typescript
// app/verify-email/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useVerifyEmail } from '@/hooks/use-users';

export default function VerifyEmailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const verifyMutation = useVerifyEmail();

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('No verification token provided');
      return;
    }

    verifyMutation.mutateAsync({ token })
      .then(() => setStatus('success'))
      .catch((err: unknown) => {
        const apiError = err as { message: string };
        setStatus('error');
        setErrorMessage(apiError.message ?? 'Verification failed');
      });
  }, [token]);

  if (status === 'loading') {
    return <p>Verifying your email...</p>;
  }

  if (status === 'success') {
    return (
      <div>
        <h1>Email Verified!</h1>
        <p>Your email has been successfully verified. You can now log in.</p>
        <button onClick={() => router.push('/login')}>Go to Login</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Verification Failed</h1>
      <p>{errorMessage}</p>
      <button onClick={() => router.push('/login')}>Go to Login</button>
    </div>
  );
}
```

### 7.3 Admin User List Page

```typescript
// app/admin/users/page.tsx
'use client';

import { useState } from 'react';
import { useUsers, useDeleteUser } from '@/hooks/use-users';
import type { FilterOptionsDto } from '@/types/user';

export default function AdminUsersPage() {
  const [filters, setFilters] = useState<FilterOptionsDto>({ page: 1, limit: 10 });
  const { data, isLoading, error } = useUsers(filters);
  const deleteUserMutation = useDeleteUser();

  const handlePageChange = (newPage: number) => {
    setFilters((prev) => ({ ...prev, page: newPage }));
  };

  const handleSearch = (search: string) => {
    setFilters((prev) => ({ ...prev, search, page: 1 }));
  };

  const handleDelete = async (id: number, email: string) => {
    if (!confirm(`Delete user ${email}?`)) return;
    await deleteUserMutation.mutateAsync(id);
  };

  if (isLoading) return <p>Loading users...</p>;
  if (error) return <p>Failed to load users</p>;

  return (
    <div>
      <h1>User Management</h1>

      <input
        type="text"
        placeholder="Search by name or email..."
        onChange={(e) => handleSearch(e.target.value)}
      />

      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Verified</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data?.data.map((user) => (
            <tr key={user.id}>
              <td>{user.id}</td>
              <td>{user.name ?? '—'}</td>
              <td>{user.email}</td>
              <td>{user.role}</td>
              <td>{user.status}</td>
              <td>{user.isEmailVerified ? 'Yes' : 'No'}</td>
              <td>
                <a href={`/admin/users/${user.id}`}>Edit</a>
                <button onClick={() => handleDelete(user.id, user.email)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      {data && (
        <div>
          <button
            disabled={data.page <= 1}
            onClick={() => handlePageChange(data.page - 1)}
          >
            Previous
          </button>
          <span>Page {data.page} of {data.lastPage}</span>
          <button
            disabled={data.page >= data.lastPage}
            onClick={() => handlePageChange(data.page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
```

### 7.4 Admin User Stats Dashboard

```typescript
// app/admin/dashboard/page.tsx
'use client';

import { useUserStats } from '@/hooks/use-users';

export default function AdminDashboardPage() {
  const { data, isLoading } = useUserStats();

  if (isLoading) return <p>Loading stats...</p>;

  return (
    <div>
      <h1>User Statistics</h1>
      <div className="stats-grid">
        <StatCard label="Total Admins" value={data?.adminsNumber ?? 0} />
        <StatCard label="Verified Users" value={data?.verifiedUsersNumber ?? 0} />
        <StatCard label="Unverified Users" value={data?.unverifiedUsersNumber ?? 0} />
        <StatCard
          label="Total Users"
          value={(data?.verifiedUsersNumber ?? 0) + (data?.unverifiedUsersNumber ?? 0)}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
```

### 7.5 User Profile / Edit Page

```typescript
// app/settings/profile/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useUser, useUpdateUser } from '@/hooks/use-users';
import type { UpdateUserDto } from '@/types/user';

export default function ProfileSettingsPage() {
  // Assuming current user ID is available from auth context
  const currentUserId = 1; // replace with actual auth context
  const { data: user, isLoading } = useUser(currentUserId);
  const updateMutation = useUpdateUser(currentUserId);
  const [formData, setFormData] = useState({ name: '', email: '' });
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({ name: user.name ?? '', email: user.email });
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSuccess(false);

    const dto: UpdateUserDto = {
      name: formData.name || undefined,
      email: formData.email,
    };

    try {
      await updateMutation.mutateAsync(dto);
      setSuccess(true);
    } catch {
      // Show error toast
    }
  };

  if (isLoading) return <p>Loading profile...</p>;

  return (
    <form onSubmit={handleSubmit}>
      <h1>Profile Settings</h1>

      {success && <p className="success">Profile updated successfully!</p>}

      <div>
        <label htmlFor="name">Name</label>
        <input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
        />
      </div>

      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
        />
        {user?.email !== formData.email && (
          <p className="warning">
            Changing your email will require re-verification.
          </p>
        )}
      </div>

      <button type="submit" disabled={updateMutation.isPending}>
        {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
      </button>
    </form>
  );
}
```

---

## 8. Gotchas & Edge Cases

### 8.1 Email Change Triggers Re-Verification

When a user changes their email address via `PATCH /user/:id`, the backend:
1. Updates the email
2. Sets `isEmailVerified = false`
3. **Does NOT** automatically send a new verification email

The frontend should:
- Warn the user that re-verification is required
- Trigger a "resend verification email" flow after the update (via the auth module's resend endpoint, if available)

### 8.2 `role` and `status` Fields in UpdateUserDto

The `UpdateUserDto` includes `role` and `status` fields. These are **admin-only**:
- If a non-admin user sends these fields, the backend **silently ignores** them
- The frontend should **not** include these fields in regular user profile update forms
- Only admin user-management forms should include role/status dropdowns

### 8.3 Password Field Never Returned

The `password` column has `select: false` in the TypeORM entity. It is **never** included in API responses. The frontend should not expect it.

### 8.4 Pagination Defaults

| Parameter | Default | Min | Max |
|-----------|---------|-----|-----|
| `page` | `1` | `1` | — |
| `limit` | `10` | `1` | `100` |

Always pass `page` and `limit` as **query parameters** (not body):
```
GET /user?page=2&limit=20&role=admin&search=john
```

### 8.5 Search is Case-Insensitive

The `search` query parameter uses PostgreSQL `ILIKE`, so searches are case-insensitive. `"John"`, `"john"`, and `"JOHN"` all return the same results.

### 8.6 Admin Deletion Has No Soft-Delete

`DELETE /user/:id` performs a **hard delete**. There is no soft-delete or trash mechanism. If the user has related records (orders, payments, etc.), the deletion may fail with a foreign key constraint error. The frontend should handle this gracefully.

### 8.7 `createdAt` and `updatedAt` are ISO Strings

Both timestamp fields are returned as ISO 8601 strings (e.g., `"2026-05-21T10:30:00.000Z"`). Use `new Date(user.createdAt)` to convert to a Date object.

### 8.8 Self-Access vs Admin-Access on `GET/PATCH /user/:id`

- **Admins** can view/update **any** user by ID
- **Regular users** can only view/update **their own** profile
- If a regular user tries to access another user's profile, the backend returns `403 Forbidden` with `"You can only view/update your own profile"`
- The frontend should use the authenticated user's ID from the auth context for profile operations, not rely on URL params for self-access

### 8.9 Registration Does Not Auto-Login

After `POST /user` (registration), the backend returns the created `User` object but **does not** return an access token or set a session cookie. The user must:
1. Check their email for the verification link
2. Verify their email
3. Log in via the auth module's `POST /auth/login` endpoint

### 8.10 Name Uniqueness

The `name` field has a `unique: true` constraint in the database. If a user tries to register or update with a name that already exists, the backend will throw a database constraint error. The frontend should handle this with a user-friendly error message.

---

## Appendix A: Complete File Structure (Frontend)

```
frontend/
├── types/
│   └── user.ts                     # All TypeScript interfaces & enums
├── lib/
│   └── api/
│       ├── user.ts                 # User API functions
│       └── user-keys.ts            # React Query keys
├── hooks/
│   └── use-users.ts                # All user-related React Query hooks
├── components/
│   └── Users/
│       ├── UserList.tsx            # Admin user list table
│       ├── UserStats.tsx           # Admin stats cards
│       ├── UserProfile.tsx         # User profile view
│       └── UserForm.tsx            # Registration / edit form
└── app/
    ├── register/
    │   ├── page.tsx
    │   └── success/
    │       └── page.tsx
    ├── verify-email/
    │   └── page.tsx
    ├── settings/
    │   └── profile/
    │       └── page.tsx
    └── admin/
        ├── users/
        │   └── page.tsx
        ├── users/[id]/
        │   └── page.tsx
        └── dashboard/
            └── page.tsx
```

---

## Appendix B: Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│  USER MODULE — QUICK REFERENCE                                  │
├─────────────────────────────────────────────────────────────────┤
│  Base URL:    /user                                             │
│  Auth Type:   Cookie-based JWT (httpOnly)                       │
│  Axios:       withCredentials: true (REQUIRED)                  │
├─────────────────────────────────────────────────────────────────┤
│  POST /user                      → Register (Public)            │
│  POST /user/verify-email         → Verify email (Public)        │
│  GET  /user?page=&limit=&role=   → List users (Admin)           │
│  GET  /user/stats                → User stats (Admin)           │
│  GET  /user/:id                  → Get user (Admin / Self)      │
│  PATCH /user/:id                 → Update user (Admin / Self)   │
│  DELETE /user/:id                → Delete user (Admin)          │
├─────────────────────────────────────────────────────────────────┤
│  Roles:         user, admin                                    │
│  Statuses:      active, inactive, banned                       │
│  Password:      Min 8 chars, uppercase + lowercase + number    │
│  Email change:  Triggers isEmailVerified = false               │
│  Search:        Case-insensitive (ILIKE) on name + email       │
│  Pagination:    page (default 1), limit (default 10, max 100)  │
│  Error Shape:   { statusCode, message, timestamp, path }       │
└─────────────────────────────────────────────────────────────────┘
```
