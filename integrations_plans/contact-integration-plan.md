# Contact Module — Frontend Integration Plan

> **Backend:** NestJS v11 · TypeORM · PostgreSQL
> **Last Updated:** 2026-05-20
> **Audience:** Frontend / Full-Stack Developers

---

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [API Endpoint Map](#2-api-endpoint-map)
3. [TypeScript Types & Interfaces](#3-typescript-types--interfaces)
4. [Public Contact Submission Flow](#4-public-contact-submission-flow)
5. [Admin Contact Management Flow](#5-admin-contact-management-flow)
6. [API Client Setup](#6-api-client-setup)
7. [React Query Hooks](#7-react-query-hooks)
8. [Error Handling & Validation Mapping](#8-error-handling--validation-mapping)
9. [Example Usage (Next.js / React)](#9-example-usage-nextjs--react)
10. [Gotchas & Edge Cases](#10-gotchas--edge-cases)

---

## 1. Module Overview

### 1.1 How Contact Works

The Contact module provides two surfaces:

- **Public endpoint** (`POST /contact`) — anyone can submit a contact message. Rate-limited to 5 submissions per hour per IP. No authentication required.
- **Admin endpoints** (`GET/PATCH/DELETE /admin/contact/*`) — authenticated admin users can list, view, mark as read/replied, and delete messages.

### 1.2 Data Model

```
ContactMessage
├── id            UUID (auto-generated)
├── fullName      varchar(100)
├── email         varchar(255)
├── subject       varchar(200)
├── message       text
├── isRead        boolean (default: false)
├── repliedAt     timestamp | null
├── ipAddress     varchar(45) | null
├── createdAt     timestamp (auto)
└── updatedAt     timestamp (auto)
```

### 1.3 Module Architecture

```
src/contact/
├── contact.module.ts              # Module wiring
├── contact.controller.ts          # Admin endpoints (JWT + ADMIN role)
├── contact.public.controller.ts   # Public endpoint (rate-limited, no auth)
├── contact.service.ts             # Business logic
├── dto/
│   ├── create-contact-message.dto.ts   # Public submission validation
│   └── contact-query.dto.ts            # Admin query/filter validation
└── schema/
    └── contact-message.schema.ts       # TypeORM entity
```

---

## 2. API Endpoint Map

### 2.1 Public Endpoints (No auth required)

| Method | Path | Description | Request Body | Success Response | Error Codes | Rate Limit |
|--------|------|-------------|-------------|------------------|-------------|------------|
| `POST` | `/contact` | Submit a contact message | [`CreateContactMessageDto`](#createcontactmessagedto) | [`ContactSubmitResponse`](#contactsubmitresponse) | `400`, `429` | 5 / hour |

### 2.2 Admin Endpoints (JWT cookie + ADMIN role required)

| Method | Path | Description | Request Body | Success Response | Error Codes |
|--------|------|-------------|-------------|------------------|-------------|
| `GET` | `/admin/contact` | List contact messages (paginated) | Query params | [`ContactListResponse`](#contactlistresponse) | `401`, `403` |
| `GET` | `/admin/contact/:id` | Get a single contact message | _none_ | [`ContactMessage`](#contactmessage-entity) | `401`, `403`, `404` |
| `PATCH` | `/admin/contact/:id/read` | Mark message as read | _none_ | [`ContactStatusResponse`](#contactstatusresponse) | `401`, `403`, `404` |
| `PATCH` | `/admin/contact/:id/reply` | Mark message as replied | _none_ | [`ContactRepliedResponse`](#contactrepliedresponse) | `401`, `403`, `404` |
| `DELETE` | `/admin/contact/:id` | Delete a message permanently | _none_ | [`MessageResponse`](#messageresponse) | `401`, `403`, `404` |

---

## 3. TypeScript Types & Interfaces

### 3.1 Request DTOs

```typescript
// ─── CreateContactMessageDto ────────────────────────────────────────────
export interface CreateContactMessageDto {
  fullName: string;  // 1-100 chars, trimmed
  email: string;     // valid email format, max 255 chars
  subject: string;   // 1-200 chars, trimmed
  message: string;   // 10-5000 chars
}
```

### 3.2 Response Types

```typescript
// ─── Contact Submit Response (POST /contact) ────────────────────────────
export interface ContactSubmitResponse {
  message: string;  // "Your message has been sent successfully"
  id: string;       // UUID of the created message
}

// ─── Contact Message Entity ─────────────────────────────────────────────
export interface ContactMessage {
  id: string;
  fullName: string;
  email: string;
  subject: string;
  message: string;
  isRead: boolean;
  repliedAt: string | null;   // ISO 8601 timestamp
  ipAddress: string | null;
  createdAt: string;          // ISO 8601 timestamp
  updatedAt: string;          // ISO 8601 timestamp
}

// ─── Contact List Response (GET /admin/contact) ─────────────────────────
export interface ContactListResponse {
  data: ContactMessage[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── Contact Status Response (PATCH /admin/contact/:id/read) ────────────
export interface ContactStatusResponse {
  id: string;
  isRead: boolean;
  message: string;  // "Message marked as read"
}

// ─── Contact Replied Response (PATCH /admin/contact/:id/reply) ──────────
export interface ContactRepliedResponse {
  id: string;
  isRead: boolean;
  repliedAt: string;  // ISO 8601 timestamp
  message: string;    // "Message marked as replied"
}

// ─── Generic Message Response ───────────────────────────────────────────
export interface MessageResponse {
  message: string;
}
```

### 3.3 Query Parameters (GET /admin/contact)

```typescript
export interface ContactQueryParams {
  page?: number;       // default: 1, min: 1
  limit?: number;      // default: 10, min: 1, max: 1000
  sortBy?: string;     // allowed: createdAt, updatedAt, title, amount, viewsCount, publishedAt
  order?: 'ASC' | 'DESC';  // default: DESC
  isRead?: boolean;    // filter by read status
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

## 4. Public Contact Submission Flow

```
┌──────────┐  POST /contact          ┌──────────────────┐
│  Client  │ ──────────────────────► │  Backend         │
│          │  {fullName, email,      │  1. Validates DTO│
│          │   subject, message}     │  2. Rate checks  │
│          │                         │  3. Captures IP  │
│          │                         │  4. Saves to DB  │
│          │ ◄────────────────────── │                  │
│          │  {message, id}          │                  │
└──────────┘                         └──────────────────┘
```

### 4.1 Rate Limiting

- **5 submissions per hour** per IP address
- Rate limit is enforced via `@nestjs/throttler`
- When exceeded, returns `429 Too Many Requests`
- The IP is extracted from `X-Forwarded-For` header (for proxied deployments) or falls back to `request.ip`

### 4.2 Validation Rules

| Field | Rules |
|-------|-------|
| `fullName` | Required, string, 1-100 characters |
| `email` | Required, valid email format, max 255 characters |
| `subject` | Required, string, 1-200 characters |
| `message` | Required, string, 10-5000 characters |

---

## 5. Admin Contact Management Flow

### 5.1 List Messages

```
GET /admin/contact?page=1&limit=10&sortBy=createdAt&order=DESC&isRead=false
```

Returns paginated results with metadata. The `isRead` filter allows admins to view only unread messages.

### 5.2 View Single Message

```
GET /admin/contact/:id
```

Returns the full message entity including `ipAddress`.

### 5.3 Mark as Read

```
PATCH /admin/contact/:id/read
```

Sets `isRead = true`. Single-query update (no entity fetch needed).

### 5.4 Mark as Replied

```
PATCH /admin/contact/:id/reply
```

Sets `isRead = true` and `repliedAt = NOW()`. Single-query update.

> **Note:** This endpoint only records that a reply was sent. It does NOT send an actual email reply. Email notifications (if any) are handled separately.

### 5.5 Delete Message

```
DELETE /admin/contact/:id
```

Permanently removes the message from the database.

---

## 6. API Client Setup

### 6.1 Contact API Functions

```typescript
// lib/api/contact.ts
import api from './client';  // Your axios instance with withCredentials: true
import type {
  CreateContactMessageDto,
  ContactSubmitResponse,
  ContactListResponse,
  ContactMessage,
  ContactStatusResponse,
  ContactRepliedResponse,
  MessageResponse,
  ContactQueryParams,
} from '@/types/contact';

// ─── Public ─────────────────────────────────────────────────────────────

export async function submitContact(
  dto: CreateContactMessageDto,
): Promise<ContactSubmitResponse> {
  const { data } = await api.post<ContactSubmitResponse>('/contact', dto);
  return data;
}

// ─── Admin (requires JWT cookie + ADMIN role) ───────────────────────────

export async function listContacts(
  params: ContactQueryParams = {},
): Promise<ContactListResponse> {
  const { data } = await api.get<ContactListResponse>('/admin/contact', {
    params,
  });
  return data;
}

export async function getContact(id: string): Promise<ContactMessage> {
  const { data } = await api.get<ContactMessage>(`/admin/contact/${id}`);
  return data;
}

export async function markAsRead(id: string): Promise<ContactStatusResponse> {
  const { data } = await api.patch<ContactStatusResponse>(
    `/admin/contact/${id}/read`,
  );
  return data;
}

export async function markAsReplied(
  id: string,
): Promise<ContactRepliedResponse> {
  const { data } = await api.patch<ContactRepliedResponse>(
    `/admin/contact/${id}/reply`,
  );
  return data;
}

export async function deleteContact(id: string): Promise<MessageResponse> {
  const { data } = await api.delete<MessageResponse>(`/admin/contact/${id}`);
  return data;
}
```

---

## 7. React Query Hooks

### 7.1 Query Keys Factory

```typescript
// lib/api/contact-keys.ts
export const contactKeys = {
  all: ['contacts'] as const,
  lists: () => [...contactKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) =>
    [...contactKeys.lists(), { filters }] as const,
  details: () => [...contactKeys.all, 'detail'] as const,
  detail: (id: string) => [...contactKeys.details(), id] as const,
};
```

### 7.2 Contact Hooks

```typescript
// hooks/use-contact.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { contactKeys } from '@/lib/api/contact-keys';
import {
  submitContact,
  listContacts,
  getContact,
  markAsRead,
  markAsReplied,
  deleteContact,
} from '@/lib/api/contact';
import type {
  CreateContactMessageDto,
  ContactQueryParams,
} from '@/types/contact';

// ─── Public: Submit Contact ─────────────────────────────────────────────

export function useSubmitContact() {
  return useMutation({
    mutationFn: submitContact,
  });
}

// ─── Admin: List Contacts ───────────────────────────────────────────────

export function useContactList(params: ContactQueryParams = {}) {
  return useQuery({
    queryKey: contactKeys.list(params),
    queryFn: () => listContacts(params),
    staleTime: 30_000, // 30 seconds — contact messages don't change frequently
  });
}

// ─── Admin: Single Contact Detail ───────────────────────────────────────

export function useContact(id: string) {
  return useQuery({
    queryKey: contactKeys.detail(id),
    queryFn: () => getContact(id),
    enabled: !!id,
  });
}

// ─── Admin: Mark as Read ────────────────────────────────────────────────

export function useMarkAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAsRead,
    onSuccess: (_, id) => {
      // Invalidate list to reflect updated read status
      qc.invalidateQueries({ queryKey: contactKeys.lists() });
      // Update cached detail
      qc.setQueryData(contactKeys.detail(id), (old: unknown) => {
        if (!old) return old;
        return { ...(old as Record<string, unknown>), isRead: true };
      });
    },
  });
}

// ─── Admin: Mark as Replied ─────────────────────────────────────────────

export function useMarkAsReplied() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAsReplied,
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: contactKeys.lists() });
      qc.setQueryData(contactKeys.detail(id), (old: unknown) => {
        if (!old) return old;
        return {
          ...(old as Record<string, unknown>),
          isRead: true,
          repliedAt: new Date().toISOString(),
        };
      });
    },
  });
}

// ─── Admin: Delete Contact ──────────────────────────────────────────────

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteContact,
    onSuccess: (_, id) => {
      // Remove from list cache
      qc.invalidateQueries({ queryKey: contactKeys.lists() });
      // Remove detail cache
      qc.removeQueries({ queryKey: contactKeys.detail(id) });
    },
  });
}
```

---

## 8. Error Handling & Validation Mapping

### 8.1 HTTP Status Codes & Meanings

| Status | When | Frontend Action |
|--------|------|-----------------|
| `201` | Contact message submitted successfully | Show success toast, clear form |
| `400` | Validation failure (invalid email, empty fields, message too short) | Show inline form errors |
| `401` | Missing/expired JWT (admin endpoints) | Redirect to login |
| `403` | User lacks ADMIN role (admin endpoints) | Show "access denied" message |
| `404` | Contact message not found (admin endpoints) | Show "message not found" |
| `429` | Rate limit exceeded (public endpoint) | Show "too many attempts, try again later" |
| `500` | Server error | Show generic error toast |

### 8.2 Known Backend Validation Errors

| Field | Error Message | Trigger |
|-------|--------------|---------|
| `fullName` | `"fullName should not be empty"` | Empty or whitespace-only |
| `fullName` | `"fullName must be shorter than or equal to 100 characters"` | > 100 chars |
| `email` | `"email must be an email"` | Invalid email format |
| `email` | `"email must be shorter than or equal to 255 characters"` | > 255 chars |
| `subject` | `"subject should not be empty"` | Empty or whitespace-only |
| `subject` | `"subject must be shorter than or equal to 200 characters"` | > 200 chars |
| `message` | `"message should not be empty"` | Empty or whitespace-only |
| `message` | `"message must be longer than or equal to 10 characters"` | < 10 chars |
| `message` | `"message must be shorter than or equal to 5000 characters"` | > 5000 chars |

### 8.3 Rate Limit Error

```json
{
  "statusCode": 429,
  "message": "ThrottlerException: Too Many Requests",
  "error": "Too Many Requests"
}
```

Frontend should disable the submit button and show a countdown or "try again later" message.

---

## 9. Example Usage (Next.js / React)

### 9.1 Public Contact Form

```typescript
// app/contact/page.tsx
'use client';

import { useState } from 'react';
import { useSubmitContact } from '@/hooks/use-contact';
import type { CreateContactMessageDto } from '@/types/contact';

export default function ContactPage() {
  const submitMutation = useSubmitContact();
  const [submitted, setSubmitted] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormErrors({});

    const formData = new FormData(e.currentTarget);
    const dto: CreateContactMessageDto = {
      fullName: (formData.get('fullName') as string).trim(),
      email: (formData.get('email') as string).trim(),
      subject: (formData.get('subject') as string).trim(),
      message: (formData.get('message') as string).trim(),
    };

    try {
      await submitMutation.mutateAsync(dto);
      setSubmitted(true);
    } catch (err: unknown) {
      const apiError = err as {
        statusCode: number;
        message: string | string[];
      };

      if (apiError.statusCode === 429) {
        setFormErrors({
          _global: 'Too many submissions. Please try again later.',
        });
      } else if (Array.isArray(apiError.message)) {
        // Parse NestJS validation errors
        const errors: Record<string, string> = {};
        apiError.message.forEach((msg) => {
          const field = msg.split(' ')[0];
          errors[field] = msg;
        });
        setFormErrors(errors);
      } else {
        setFormErrors({ _global: apiError.message });
      }
    }
  };

  if (submitted) {
    return (
      <div>
        <h1>Thank You!</h1>
        <p>Your message has been sent successfully. We will get back to you soon.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Contact Us</h1>

      <div>
        <label htmlFor="fullName">Full Name</label>
        <input id="fullName" name="fullName" required maxLength={100} />
        {formErrors.fullName && <span className="error">{formErrors.fullName}</span>}
      </div>

      <div>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required maxLength={255} />
        {formErrors.email && <span className="error">{formErrors.email}</span>}
      </div>

      <div>
        <label htmlFor="subject">Subject</label>
        <input id="subject" name="subject" required maxLength={200} />
        {formErrors.subject && <span className="error">{formErrors.subject}</span>}
      </div>

      <div>
        <label htmlFor="message">Message</label>
        <textarea
          id="message"
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={5}
        />
        {formErrors.message && <span className="error">{formErrors.message}</span>}
      </div>

      {formErrors._global && <Alert variant="error">{formErrors._global}</Alert>}

      <button
        type="submit"
        disabled={submitMutation.isPending}
      >
        {submitMutation.isPending ? 'Sending...' : 'Send Message'}
      </button>
    </form>
  );
}
```

### 9.2 Admin Contact List

```typescript
// app/admin/contacts/page.tsx
'use client';

import { useState } from 'react';
import { useContactList, useMarkAsRead, useDeleteContact } from '@/hooks/use-contact';
import type { ContactQueryParams } from '@/types/contact';

export default function AdminContactsPage() {
  const [filters, setFilters] = useState<ContactQueryParams>({
    page: 1,
    limit: 10,
    order: 'DESC',
  });

  const { data, isLoading, error } = useContactList(filters);
  const markRead = useMarkAsRead();
  const deleteContact = useDeleteContact();

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Error loading contacts</p>;
  if (!data) return null;

  return (
    <div>
      <h1>Contact Messages</h1>

      {/* Filter toggle */}
      <button
        onClick={() =>
          setFilters((prev) => ({
            ...prev,
            isRead: prev.isRead === false ? undefined : false,
          }))
        }
      >
        {filters.isRead === false ? 'Show All' : 'Show Unread Only'}
      </button>

      {/* Messages table */}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Subject</th>
            <th>Date</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((msg) => (
            <tr key={msg.id} style={{ opacity: msg.isRead ? 1 : 1, fontWeight: msg.isRead ? 'normal' : 'bold' }}>
              <td>{msg.fullName}</td>
              <td>{msg.email}</td>
              <td>{msg.subject}</td>
              <td>{new Date(msg.createdAt).toLocaleDateString()}</td>
              <td>
                {msg.isRead ? 'Read' : 'Unread'}
                {msg.repliedAt && ' · Replied'}
              </td>
              <td>
                {!msg.isRead && (
                  <button
                    onClick={() => markRead.mutate(msg.id)}
                    disabled={markRead.isPending}
                  >
                    Mark Read
                  </button>
                )}
                <button
                  onClick={() => {
                    if (confirm('Delete this message?')) {
                      deleteContact.mutate(msg.id);
                    }
                  }}
                  disabled={deleteContact.isPending}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      <div>
        <button
          disabled={filters.page === 1}
          onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page ?? 1) - 1 }))}
        >
          Previous
        </button>
        <span>Page {filters.page} of {data.meta.totalPages}</span>
        <button
          disabled={filters.page === data.meta.totalPages}
          onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page ?? 1) + 1 }))}
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

### 9.3 Admin Contact Detail

```typescript
// app/admin/contacts/[id]/page.tsx
'use client';

import { useParams } from 'next/navigation';
import { useContact, useMarkAsReplied } from '@/hooks/use-contact';

export default function AdminContactDetailPage() {
  const { id } = useParams() as { id: string };
  const { data: contact, isLoading } = useContact(id);
  const markReplied = useMarkAsReplied();

  if (isLoading) return <p>Loading...</p>;
  if (!contact) return <p>Message not found</p>;

  return (
    <div>
      <h1>Contact Message</h1>

      <dl>
        <dt>From</dt>
        <dd>{contact.fullName} ({contact.email})</dd>

        <dt>Subject</dt>
        <dd>{contact.subject}</dd>

        <dt>Message</dt>
        <dd>{contact.message}</dd>

        <dt>IP Address</dt>
        <dd>{contact.ipAddress ?? 'Unknown'}</dd>

        <dt>Submitted</dt>
        <dd>{new Date(contact.createdAt).toLocaleString()}</dd>

        <dt>Status</dt>
        <dd>
          {contact.isRead ? 'Read' : 'Unread'}
          {contact.repliedAt && ` · Replied at ${new Date(contact.repliedAt).toLocaleString()}`}
        </dd>
      </dl>

      {!contact.repliedAt && (
        <button
          onClick={() => markReplied.mutate(id)}
          disabled={markReplied.isPending}
        >
          Mark as Replied
        </button>
      )}
    </div>
  );
}
```

---

## 10. Gotchas & Edge Cases

### 10.1 Rate Limiting is Per-IP

The public endpoint rate limit (5/hour) is based on the client IP address. If multiple users share the same IP (corporate NAT, VPN), they share the rate limit quota.

### 10.2 IP Address Extraction

The backend extracts the client IP in this order:
1. `X-Forwarded-For` header (first IP in the chain — the original client)
2. `request.ip` (direct connection IP)
3. Falls back to `'unknown'` string if neither is available

If your deployment uses a reverse proxy (nginx, Cloudflare, etc.), ensure it forwards the `X-Forwarded-For` header correctly.

### 10.3 Message Field Minimum Length

The `message` field requires a **minimum of 10 characters**. This prevents spam submissions like "hi" or "test". Frontend should enforce this with `minLength={10}` on the textarea and show a character counter.

### 10.4 `markAsReplied` Does NOT Send Email

The `PATCH /admin/contact/:id/reply` endpoint only records that a reply was sent (sets `repliedAt` timestamp). It does **not** send an actual email to the contact's email address. If email notifications are needed, they must be implemented separately (e.g., via a mail service or queue job).

### 10.5 Pagination Sort Fields

The `sortBy` parameter is **whitelisted** to specific fields: `createdAt`, `updatedAt`, `title`, `amount`, `viewsCount`, `publishedAt`. Attempting to sort by other fields (e.g., `email`, `fullName`) will return a validation error. This is a security measure to prevent SQL injection via sort parameters.

### 10.6 Admin Role Required

All `/admin/contact/*` endpoints require:
1. A valid JWT cookie (authentication)
2. The user's role must be `admin` (authorization)

Non-admin users will receive `403 Forbidden`.

### 10.7 Delete is Permanent

`DELETE /admin/contact/:id` permanently removes the message. There is no soft-delete or trash. Consider adding a confirmation dialog in the frontend.

### 10.8 No Reply Content Stored

The current implementation only tracks *that* a reply was sent (`repliedAt` timestamp). It does **not** store the actual reply content. If reply history is needed, the schema and endpoints must be extended.

### 10.9 Character Counter UX

For the public form, show a character counter for the message field:

```typescript
const [messageLength, setMessageLength] = useState(0);

<textarea
  maxLength={5000}
  onChange={(e) => setMessageLength(e.target.value.length)}
/>
<span className={messageLength < 10 ? 'text-red-500' : 'text-gray-500'}>
  {messageLength}/5000 characters (minimum 10)
</span>
```

---

## Appendix A: Complete File Structure (Frontend)

```
frontend/
├── types/
│   └── contact.ts                    # All TypeScript interfaces
├── lib/
│   └── api/
│       ├── contact.ts                # Contact API functions
│       └── contact-keys.ts           # React Query keys
├── hooks/
│   └── use-contact.ts                # All contact-related React Query hooks
├── components/
│   └── Contact/
│       ├── ContactForm.tsx           # Public contact form
│       └── ContactList.tsx           # Admin contact list
└── app/
    ├── contact/
    │   └── page.tsx                  # Public contact page
    └── admin/
        └── contacts/
            ├── page.tsx              # Admin contact list
            └── [id]/
                └── page.tsx          # Admin contact detail
```

---

## Appendix B: Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│  CONTACT MODULE — QUICK REFERENCE                               │
├─────────────────────────────────────────────────────────────────┤
│  Public Base URL:  /contact                                     │
│  Admin Base URL:   /admin/contact                               │
│  Auth Required:    Admin endpoints (JWT + ADMIN role)           │
│  Rate Limit:       5 submissions/hour per IP (public only)      │
├─────────────────────────────────────────────────────────────────┤
│  POST /contact                    → { message, id }             │
│  GET  /admin/contact              → { data[], meta }            │
│  GET  /admin/contact/:id          → { ContactMessage }          │
│  PATCH /admin/contact/:id/read    → { id, isRead, message }     │
│  PATCH /admin/contact/:id/reply   → { id, isRead, repliedAt }   │
│  DELETE /admin/contact/:id        → { message }                 │
├─────────────────────────────────────────────────────────────────┤
│  Validation: fullName (1-100), email (valid),                   │
│              subject (1-200), message (10-5000)                 │
│  Pagination: page (default 1), limit (default 10, max 1000)     │
│  Sort: sortBy (whitelisted), order (ASC/DESC, default DESC)     │
│  Filter: isRead (boolean)                                       │
│  Error Shape: { statusCode, message, timestamp, path }          │
└─────────────────────────────────────────────────────────────────┘
```
