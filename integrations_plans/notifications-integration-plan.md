# Notifications Module — Frontend Integration Plan

> **Backend:** NestJS v11 · TypeORM · PostgreSQL · Pusher (Realtime)
> **Last Updated:** 2026-05-20
> **Audience:** Frontend / Full-Stack Developers

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [API Endpoint Map](#2-api-endpoint-map)
3. [Realtime Events (Pusher)](#3-realtime-events-pusher)
4. [TypeScript Types & Interfaces](#4-typescript-types--interfaces)
5. [Pusher Client Setup](#5-pusher-client-setup)
6. [React Query Hooks](#6-react-query-hooks)
7. [Realtime Event Handlers](#7-realtime-event-handlers)
8. [Error Handling & Validation Mapping](#8-error-handling--validation-mapping)
9. [Pagination (Cursor-Based)](#9-pagination-cursor-based)
10. [Caching & Invalidation Strategy](#10-caching--invalidation-strategy)
11. [Example Usage (Next.js / React)](#11-example-usage-nextjs--react)
12. [Gotchas & Edge Cases](#12-gotchas--edge-cases)

---

## 1. Architecture Overview

### 1.1 Communication Pattern

The notifications module uses **Pusher** for real-time communication instead of WebSockets/Socket.IO. This is optimized for serverless deployment (Vercel).

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│  Frontend   │  HTTP   │   Backend    │  Pusher │   Pusher    │
│  (React)    │◄───────►│  (NestJS)    │◄───────►│   Cloud     │
│             │  REST   │              │  SDK    │             │
└─────────────┘         └──────────────┘         └─────────────┘
       │                        │                        │
       │  Pusher JS SDK         │                        │
       └────────────────────────┼────────────────────────┘
                                │
                     private-user-{userId}
```

### 1.2 Key Differences from Socket.IO

| Aspect | Socket.IO (Old) | Pusher (New) |
|--------|-----------------|--------------|
| Connection | WebSocket (persistent) | HTTP + WebSocket (managed by Pusher) |
| Auth | JWT guard on connection | `POST /pusher/auth` endpoint |
| Channels | `user-{userId}` rooms | `private-user-{userId}` channels |
| Retry | Built-in reconnection | Pusher SDK handles reconnection |
| Serverless | Not compatible | Fully compatible |

### 1.3 Data Flow

1. **User logs in** → Frontend receives JWT
2. **Frontend initializes Pusher** → Subscribes to `private-user-{userId}`
3. **Pusher requests auth** → Frontend calls `POST /pusher/auth` with JWT
4. **Backend validates** → Returns Pusher auth token if user owns channel
5. **Realtime events flow** → Backend emits events → Pusher delivers → Frontend receives
6. **Fallback** → If Pusher fails, notifications persist in DB → REST polling fallback

---

## 2. API Endpoint Map

### 2.1 User Endpoints (JWT required)

| Method | Path | Description | Auth | Request | Success Response | Error Codes |
|--------|------|-------------|------|---------|------------------|-------------|
| `GET` | `/notifications` | Get notifications (cursor pagination) | Required | _query params_ | [`CursorPaginatedResponse<Notification>`](#cursorpaginatedresponsenotification) | `401` |
| `GET` | `/notifications/paginated` | Get notifications (offset pagination - **deprecated**) | Required | _query params_ | [`PaginatedNotifications`](#paginatednotifications) | `401` |
| `GET` | `/notifications/unread-count` | Get unread count | Required | _none_ | `{ unreadCount: number }` | `401` |
| `PATCH` | `/notifications/:id/read` | Mark as read | Required | _none_ | [`Notification`](#notification) | `401`, `403`, `404` |
| `PATCH` | `/notifications/read-all` | Mark all as read | Required | _none_ | `{ success: true }` | `401` |
| `DELETE` | `/notifications/:id` | Soft delete | Required | _none_ | `204 No Content` | `401`, `403`, `404` |
| `GET` | `/notifications/preferences` | Get preferences | Required | _none_ | [`NotificationPreferences`](#notificationpreferences) | `401` |
| `PATCH` | `/notifications/preferences` | Update preferences | Required | _query params_ | [`NotificationPreferences`](#notificationpreferences) | `401` |

### 2.2 Admin Endpoints (JWT + `ADMIN` role required)

| Method | Path | Description | Auth | Request Body | Success Response | Error Codes |
|--------|------|-------------|------|-------------|------------------|-------------|
| `POST` | `/admin/notifications/send` | Send to specific user | Required | [`CreateNotificationDto`](#createnotificationdto) | [`Notification`](#notification) | `400`, `401`, `403` |
| `POST` | `/admin/notifications/broadcast` | Broadcast to users | Required | [`BroadcastNotificationDto`](#broadcastnotificationdto) | `{ success: true }` | `400`, `401`, `403` |
| `GET` | `/admin/notifications` | List all notifications | Required | _query params_ | [`PaginatedNotifications`](#paginatednotifications) | `401`, `403` |
| `DELETE` | `/admin/notifications/:id` | Hard delete | Required | _none_ | `204 No Content` | `401`, `403`, `404` |

### 2.3 Pusher Auth Endpoint

| Method | Path | Description | Auth | Request Body | Success Response | Error Codes |
|--------|------|-------------|------|-------------|------------------|-------------|
| `POST` | `/pusher/auth` | Authenticate Pusher channel | Required | `{ channel_name, socket_id }` | Pusher auth token | `400`, `401`, `403` |

### 2.4 Query Parameters

#### User List (`GET /notifications`) — Cursor-Based (Recommended)

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `cursor` | `string` (ISO 8601) | — | — | Cursor timestamp (use last item's `createdAt`) |
| `limit` | `number` | `20` | `50` | Items per page (1–50) |

#### User List (`GET /notifications/paginated`) — Offset-Based (Deprecated)

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `page` | `number` | `1` | — | Page number (≥ 1) |
| `limit` | `number` | `20` | `100` | Items per page (1–100) |

#### Admin List (`GET /admin/notifications`) — Offset-Based

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `page` | `number` | `1` | — | Page number (≥ 1) |
| `limit` | `number` | `20` | `100` | Items per page (1–100) |

#### Update Preferences (`PATCH /notifications/preferences`)

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `orderNotifications` | `boolean` | — | Enable order notifications |
| `paymentNotifications` | `boolean` | — | Enable payment notifications |
| `systemNotifications` | `boolean` | — | Enable system notifications |
| `emailEnabled` | `boolean` | — | Enable email notifications |
| `pushEnabled` | `boolean` | — | Enable push notifications |

---

## 3. Realtime Events (Pusher)

### 3.1 Channel Structure

```
private-user-{userId}
```

Example: `private-user-550e8400-e29b-41d4-a716-446655440000`

### 3.2 Event Names & Payloads

| Event Name | When Triggered | Payload Shape |
|------------|----------------|---------------|
| `notification:new` | New notification created | [`NotificationEventPayload`](#notificationeventpayload) |
| `notification:read` | Single notification marked read | [`ReadUpdatePayload`](#readupdatepayload) |
| `notification:read_all` | All notifications marked read | [`ReadAllUpdatePayload`](#readallupdatepayload) |
| `notification:count` | Unread count changes | [`CountUpdatePayload`](#countupdatepayload) |
| `notification:delete` | Notification deleted | [`DeletePayload`](#deletepayload) |
| `payment:status` | Payment status changes | [`PaymentStatusPayload`](#paymentstatuspayload) |

### 3.3 Event Payload Details

#### NotificationEventPayload

```typescript
interface NotificationEventPayload {
  eventId: string;        // UUID — use for deduplication
  userId: string;         // UUID
  notificationId: string; // UUID
  type: string;           // NotificationType enum value
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;      // ISO 8601
}
```

#### ReadUpdatePayload

```typescript
interface ReadUpdatePayload {
  eventId: string;
  userId: string;
  notificationId: string;
  timestamp: string;
}
```

#### ReadAllUpdatePayload

```typescript
interface ReadAllUpdatePayload {
  eventId: string;
  userId: string;
  timestamp: string;
}
```

#### CountUpdatePayload

```typescript
interface CountUpdatePayload {
  eventId: string;
  userId: string;
  unreadCount: number;
  timestamp: string;
}
```

#### DeletePayload

```typescript
interface DeletePayload {
  eventId: string;
  userId: string;
  notificationId: string;
  timestamp: string;
}
```

#### PaymentStatusPayload

```typescript
interface PaymentStatusPayload {
  eventId: string;
  status: 'succeeded' | 'failed' | 'refunded';
  amount: number;
  description: string;
  timestamp: string;
}
```

---

## 4. TypeScript Types & Interfaces

### 4.1 Core Entities

```typescript
// ─── Notification ───────────────────────────────────────────────────────
export interface Notification {
  id: string;              // UUID
  userId: string;          // UUID — owner
  type: NotificationType;  // enum value
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  readAt: Date | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Notification Type Enum ─────────────────────────────────────────────
export enum NotificationType {
  ORDER_UPDATED = 'ORDER_UPDATED',
  PAYMENT_SUCCESS = 'PAYMENT_SUCCESS',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  SYSTEM = 'SYSTEM',
  BROADCAST = 'BROADCAST',
}

// ─── Notification Preferences ───────────────────────────────────────────
export interface NotificationPreferences {
  userId: string;
  orderNotifications: boolean;
  paymentNotifications: boolean;
  systemNotifications: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### 4.2 Request DTOs

```typescript
// ─── CreateNotificationDto (Admin) ──────────────────────────────────────
export interface CreateNotificationDto {
  userId: string;              // required — target user UUID
  type: NotificationType;      // required — enum value
  title: string;               // required
  message: string;             // required
  data?: Record<string, unknown>; // optional
}

// ─── BroadcastNotificationDto (Admin) ───────────────────────────────────
export interface BroadcastNotificationDto {
  title: string;                    // required
  message: string;                  // required
  targetUserIds?: string[];         // optional — omit for system-wide
  data?: Record<string, unknown>;   // optional
}

// ─── UpdatePreferencesDto ───────────────────────────────────────────────
export interface UpdatePreferencesDto {
  orderNotifications?: boolean;
  paymentNotifications?: boolean;
  systemNotifications?: boolean;
  emailEnabled?: boolean;
  pushEnabled?: boolean;
}
```

### 4.3 Response Wrappers

```typescript
// ─── Cursor-Based Paginated Response ────────────────────────────────────
export interface CursorPaginatedResponse<T> {
  data: T[];
  meta: {
    nextCursor: string | null;  // ISO 8601 timestamp or null
    hasMore: boolean;
    limit: number;
  };
}

// ─── Offset-Based Paginated Response (Deprecated) ───────────────────────
export interface PaginatedNotifications {
  data: Notification[];
  total: number;
  page: number;
  limit: number;
}

// ─── Unread Count Response ──────────────────────────────────────────────
export interface UnreadCountResponse {
  unreadCount: number;
}

// ─── Success Response ───────────────────────────────────────────────────
export interface SuccessResponse {
  success: boolean;
}
```

### 4.4 Error Response Shape (Global)

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

## 5. Pusher Client Setup

### 5.1 Installation

```bash
npm install pusher-js
# or
pnpm add pusher-js
# or
yarn add pusher-js
```

### 5.2 Pusher Client Configuration

```typescript
// lib/pusher/client.ts
import Pusher from 'pusher-js';

let pusherInstance: Pusher | null = null;

export function getPusherInstance(): Pusher {
  if (!pusherInstance) {
    pusherInstance = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
      forceTLS: true,
      authEndpoint: '/api/pusher/auth', // Proxy endpoint on your frontend
      auth: {
        headers: {},
      },
    });
  }
  return pusherInstance;
}

export function disconnectPusher(): void {
  if (pusherInstance) {
    pusherInstance.disconnect();
    pusherInstance = null;
  }
}
```

### 5.3 Frontend Auth Proxy (Next.js API Route)

Pusher's client SDK needs to authenticate private channels. Create a proxy endpoint:

```typescript
// app/api/pusher/auth/route.ts (Next.js App Router)
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const token = request.headers.get('authorization');

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Forward to backend Pusher auth endpoint
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/pusher/auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: 'Channel authorization failed' },
      { status: response.status },
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}
```

### 5.4 Pusher Hook for React

```typescript
// hooks/use-pusher.ts
import { useEffect, useRef, useCallback } from 'react';
import Pusher from 'pusher-js';
import { getPusherInstance, disconnectPusher } from '@/lib/pusher/client';

interface UsePusherOptions {
  userId: string;
  enabled?: boolean;
  onNotificationNew?: (payload: NotificationEventPayload) => void;
  onNotificationRead?: (payload: ReadUpdatePayload) => void;
  onNotificationReadAll?: (payload: ReadAllUpdatePayload) => void;
  onNotificationCount?: (payload: CountUpdatePayload) => void;
  onNotificationDelete?: (payload: DeletePayload) => void;
  onPaymentStatus?: (payload: PaymentStatusPayload) => void;
}

export function usePusher(options: UsePusherOptions) {
  const { userId, enabled = true } = options;
  const channelRef = useRef<Pusher.Channel | null>(null);
  const pusherRef = useRef<Pusher | null>(null);
  const seenEventIdsRef = useRef<Set<string>>(new Set());

  // Deduplication helper
  const processEvent = useCallback(
    <T extends { eventId: string }>(
      eventId: string,
      callback: ((payload: T) => void) | undefined,
      payload: T,
    ) => {
      if (seenEventIdsRef.current.has(eventId)) {
        return; // Skip duplicate
      }
      seenEventIdsRef.current.add(eventId);

      // Prevent memory leak — cap at 1000 events
      if (seenEventIdsRef.current.size > 1000) {
        const arr = Array.from(seenEventIdsRef.current);
        seenEventIdsRef.current = new Set(arr.slice(-500));
      }

      callback?.(payload);
    },
    [],
  );

  useEffect(() => {
    if (!enabled || !userId) return;

    const pusher = getPusherInstance();
    pusherRef.current = pusher;

    const channel = pusher.subscribe(`private-user-${userId}`);
    channelRef.current = channel;

    // Bind event handlers
    channel.bind('notification:new', (payload: NotificationEventPayload) => {
      processEvent(payload.eventId, options.onNotificationNew, payload);
    });

    channel.bind('notification:read', (payload: ReadUpdatePayload) => {
      processEvent(payload.eventId, options.onNotificationRead, payload);
    });

    channel.bind('notification:read_all', (payload: ReadAllUpdatePayload) => {
      processEvent(payload.eventId, options.onNotificationReadAll, payload);
    });

    channel.bind('notification:count', (payload: CountUpdatePayload) => {
      processEvent(payload.eventId, options.onNotificationCount, payload);
    });

    channel.bind('notification:delete', (payload: DeletePayload) => {
      processEvent(payload.eventId, options.onNotificationDelete, payload);
    });

    channel.bind('payment:status', (payload: PaymentStatusPayload) => {
      processEvent(payload.eventId, options.onPaymentStatus, payload);
    });

    // Connection state logging
    pusher.connection.bind('connected', () => {
      console.log('[Pusher] Connected');
    });

    pusher.connection.bind('disconnected', () => {
      console.log('[Pusher] Disconnected');
    });

    pusher.connection.bind('error', (error: Error) => {
      console.error('[Pusher] Error:', error);
    });

    // Cleanup
    return () => {
      if (channelRef.current) {
        channelRef.current.unbind_all();
        pusher.unsubscribe(`private-user-${userId}`);
      }
      channelRef.current = null;
    };
  }, [userId, enabled, options, processEvent]);

  // Disconnect on unmount (e.g., logout)
  useEffect(() => {
    return () => {
      disconnectPusher();
    };
  }, []);

  return {
    channel: channelRef.current,
    pusher: pusherRef.current,
  };
}
```

---

## 6. React Query Hooks

### 6.1 Query Keys Factory

```typescript
// lib/api/notifications-keys.ts
export const notificationsKeys = {
  all: ['notifications'] as const,
  lists: () => [...notificationsKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) =>
    [...notificationsKeys.lists(), { filters }] as const,
  unreadCount: (userId: string) =>
    [...notificationsKeys.all, 'unreadCount', userId] as const,
  preferences: (userId: string) =>
    [...notificationsKeys.all, 'preferences', userId] as const,
  adminLists: () => [...notificationsKeys.all, 'admin', 'list'] as const,
};
```

### 6.2 User Hooks

```typescript
// hooks/use-notifications.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { notificationsKeys } from '@/lib/api/notifications-keys';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  getPreferences,
  updatePreferences,
} from '@/lib/api/notifications';
import type {
  CursorPaginationDto,
  UpdatePreferencesDto,
} from '@/types/notifications';

export function useNotifications(userId: string, pagination: CursorPaginationDto = {}) {
  return useQuery({
    queryKey: notificationsKeys.list({ userId, ...pagination }),
    queryFn: () => getNotifications(pagination),
    staleTime: 30_000, // 30 seconds — notifications change frequently
    enabled: !!userId,
  });
}

export function useUnreadCount(userId: string) {
  return useQuery({
    queryKey: notificationsKeys.unreadCount(userId),
    queryFn: () => getUnreadCount(),
    staleTime: 10_000, // 10 seconds — badge should be fresh
    enabled: !!userId,
  });
}

export function useNotificationPreferences(userId: string) {
  return useQuery({
    queryKey: notificationsKeys.preferences(userId),
    queryFn: () => getPreferences(),
    staleTime: 5 * 60_000, // 5 minutes — preferences change rarely
    enabled: !!userId,
  });
}

export function useMarkAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAsRead,
    onSuccess: (_, notificationId) => {
      qc.invalidateQueries({ queryKey: notificationsKeys.lists() });
      qc.invalidateQueries({ queryKey: notificationsKeys.unreadCount(qc.getQueryData(['currentUser'])?.id) });
    },
  });
}

export function useMarkAllAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAllAsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsKeys.lists() });
      qc.invalidateQueries({ queryKey: notificationsKeys.unreadCount(qc.getQueryData(['currentUser'])?.id) });
    },
  });
}

export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsKeys.lists() });
      qc.invalidateQueries({ queryKey: notificationsKeys.unreadCount(qc.getQueryData(['currentUser'])?.id) });
    },
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updatePreferences,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsKeys.preferences(qc.getQueryData(['currentUser'])?.id) });
    },
  });
}
```

### 6.3 Admin Hooks

```typescript
// hooks/use-admin-notifications.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { notificationsKeys } from '@/lib/api/notifications-keys';
import {
  adminListNotifications,
  adminSendNotification,
  adminBroadcastNotification,
  adminDeleteNotification,
} from '@/lib/api/notifications';
import type {
  PaginationQueryDto,
  CreateNotificationDto,
  BroadcastNotificationDto,
} from '@/types/notifications';

export function useAdminNotifications(query: PaginationQueryDto = {}) {
  return useQuery({
    queryKey: notificationsKeys.adminLists(),
    queryFn: () => adminListNotifications(query),
    staleTime: 30_000,
  });
}

export function useAdminSendNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminSendNotification,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsKeys.adminLists() });
    },
  });
}

export function useAdminBroadcastNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminBroadcastNotification,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsKeys.adminLists() });
    },
  });
}

export function useAdminDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminDeleteNotification,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsKeys.adminLists() });
    },
  });
}
```

---

## 7. Realtime Event Handlers

### 7.1 Notification Badge Component with Realtime Updates

```typescript
// components/NotificationBadge.tsx
'use client';

import { useUnreadCount } from '@/hooks/use-notifications';
import { usePusher } from '@/hooks/use-pusher';
import { useAuth } from '@/hooks/use-auth';
import type { CountUpdatePayload } from '@/types/notifications';

export function NotificationBadge() {
  const { user } = useAuth();
  const { data: unreadData } = useUnreadCount(user?.id);
  const unreadCount = unreadData?.unreadCount ?? 0;

  // Update unread count in real-time
  usePusher({
    userId: user?.id,
    enabled: !!user,
    onNotificationCount: (payload: CountUpdatePayload) => {
      // React Query will refetch automatically via invalidation
      // Or you can optimistically update:
      // queryClient.setQueryData(
      //   notificationsKeys.unreadCount(user.id),
      //   { unreadCount: payload.unreadCount }
      // );
    },
  });

  if (unreadCount === 0) return null;

  return (
    <span className="relative">
      🔔
      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
        {unreadCount > 99 ? '99+' : unreadCount}
      </span>
    </span>
  );
}
```

### 7.2 Notification Feed with Realtime Updates

```typescript
// components/NotificationFeed.tsx
'use client';

import { useEffect, useState } from 'react';
import { useNotifications, useMarkAsRead, useDeleteNotification } from '@/hooks/use-notifications';
import { usePusher } from '@/hooks/use-pusher';
import { useAuth } from '@/hooks/use-auth';
import type {
  NotificationEventPayload,
  DeletePayload,
  ReadUpdatePayload,
  ReadAllUpdatePayload,
} from '@/types/notifications';

export function NotificationFeed() {
  const { user } = useAuth();
  const { data, fetchNextPage, hasNextPage } = useNotifications(user?.id, { limit: 20 });
  const markAsRead = useMarkAsRead();
  const deleteNotification = useDeleteNotification();

  const [optimisticNotifications, setOptimisticNotifications] = useState(
    data?.data ?? [],
  );

  // Sync with React Query data
  useEffect(() => {
    if (data?.data) {
      setOptimisticNotifications(data.data);
    }
  }, [data]);

  // Realtime event handlers
  usePusher({
    userId: user?.id,
    enabled: !!user,
    onNotificationNew: (payload: NotificationEventPayload) => {
      // Prepend new notification to list
      setOptimisticNotifications((prev) => [
        {
          id: payload.notificationId,
          userId: payload.userId,
          type: payload.type,
          title: payload.title,
          message: payload.message,
          data: payload.data,
          isRead: false,
          readAt: null,
          isDeleted: false,
          createdAt: new Date(payload.timestamp),
          updatedAt: new Date(payload.timestamp),
        },
        ...prev,
      ]);
    },
    onNotificationRead: (payload: ReadUpdatePayload) => {
      // Mark notification as read
      setOptimisticNotifications((prev) =>
        prev.map((n) =>
          n.id === payload.notificationId
            ? { ...n, isRead: true, readAt: new Date(payload.timestamp) }
            : n,
        ),
      );
    },
    onNotificationReadAll: (_payload: ReadAllUpdatePayload) => {
      // Mark all as read
      setOptimisticNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true, readAt: new Date() })),
      );
    },
    onNotificationDelete: (payload: DeletePayload) => {
      // Remove deleted notification
      setOptimisticNotifications((prev) =>
        prev.filter((n) => n.id !== payload.notificationId),
      );
    },
  });

  const handleMarkAsRead = async (id: string) => {
    await markAsRead.mutateAsync(id);
  };

  const handleDelete = async (id: string) => {
    await deleteNotification.mutateAsync(id);
  };

  return (
    <div>
      {optimisticNotifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          onMarkRead={() => handleMarkAsRead(notification.id)}
          onDelete={() => handleDelete(notification.id)}
        />
      ))}

      {hasNextPage && (
        <button onClick={() => fetchNextPage()}>Load More</button>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  onMarkRead,
  onDelete,
}: {
  notification: Notification;
  onMarkRead: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`p-4 border-b ${notification.isRead ? 'bg-gray-50' : 'bg-white'}`}>
      <div className="flex justify-between items-start">
        <div>
          <h4 className="font-semibold">{notification.title}</h4>
          <p className="text-sm text-gray-600">{notification.message}</p>
          <span className="text-xs text-gray-400">
            {new Date(notification.createdAt).toLocaleString()}
          </span>
        </div>
        <div className="flex gap-2">
          {!notification.isRead && (
            <button onClick={onMarkRead} className="text-blue-500 text-sm">
              Mark as read
            </button>
          )}
          <button onClick={onDelete} className="text-red-500 text-sm">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## 8. Error Handling & Validation Mapping

### 8.1 HTTP Status Codes & Meanings

| Status | When | Frontend Action |
|--------|------|-----------------|
| `400` | Validation failure | Show inline form errors from `message` array |
| `401` | Missing or expired JWT | Redirect to login |
| `403` | User lacks `ADMIN` role or owns notification | Show "Unauthorized" page |
| `404` | Notification not found | Remove from UI list |
| `500` | Server error | Show generic error toast |

### 8.2 Known Backend Validation Rules

| Field | Rule | Error Message Pattern |
|-------|------|----------------------|
| `userId` | Required, valid UUID | `"userId should not be empty"` |
| `type` | Required, must be NotificationType enum | `"type must be one of the following values: ORDER_UPDATED, PAYMENT_SUCCESS, PAYMENT_FAILED, SYSTEM, BROADCAST"` |
| `title` | Required, string | `"title should not be empty"` |
| `message` | Required, string | `"message should not be empty"` |
| `data` | Optional, object | `"data must be an object"` |
| `cursor` | Optional, ISO 8601 date string | `"cursor must be a valid ISO 8601 date string"` |
| `limit` | Min 1, Max 50 (cursor), Max 100 (offset) | `"limit must not be greater than 50"` |
| `page` | Min 1 | `"page must not be less than 1"` |

### 8.3 Pusher Auth Error Codes

| Status | When | Frontend Action |
|--------|------|-----------------|
| `400` | Missing `channel_name` or `socket_id` | Retry with correct params |
| `401` | Missing or expired JWT | Redirect to login |
| `403` | User doesn't own channel | Log error, don't subscribe |

---

## 9. Pagination (Cursor-Based)

### 9.1 Why Cursor-Based?

- **Better performance** for large datasets
- **No duplicate/missing items** when new notifications arrive during scrolling
- **Recommended** for infinite scroll patterns

### 9.2 Cursor Pagination Implementation

```typescript
// hooks/use-infinite-notifications.ts
import { useInfiniteQuery } from '@tanstack/react-query';
import { getNotifications } from '@/lib/api/notifications';
import type { CursorPaginatedResponse, Notification } from '@/types/notifications';

export function useInfiniteNotifications(userId: string) {
  return useInfiniteQuery<CursorPaginatedResponse<Notification>>({
    queryKey: ['notifications', 'infinite', userId],
    queryFn: ({ pageParam }) =>
      getNotifications({
        cursor: pageParam as string | undefined,
        limit: 20,
      }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasMore ? lastPage.meta.nextCursor : undefined,
    enabled: !!userId,
    staleTime: 30_000,
  });
}
```

### 9.3 Usage in Component

```typescript
// components/InfiniteNotificationFeed.tsx
'use client';

import { useInfiniteNotifications } from '@/hooks/use-infinite-notifications';
import { useAuth } from '@/hooks/use-auth';
import { useEffect, useRef } from 'react';

export function InfiniteNotificationFeed() {
  const { user } = useAuth();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteNotifications(user?.id);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!loadMoreRef.current) return;

    observerRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    });

    observerRef.current.observe(loadMoreRef.current);

    return () => observerRef.current?.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const allNotifications = data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div>
      {allNotifications.map((notification) => (
        <NotificationItem key={notification.id} notification={notification} />
      ))}

      <div ref={loadMoreRef} className="h-10">
        {isFetchingNextPage && <LoadingSpinner />}
      </div>
    </div>
  );
}
```

---

## 10. Caching & Invalidation Strategy

### 10.1 Cache Durations

| Query Type | `staleTime` | Rationale |
|------------|-------------|-----------|
| Notification list | `30_000` (30 sec) | Notifications change frequently |
| Unread count | `10_000` (10 sec) | Badge should be very fresh |
| Preferences | `300_000` (5 min) | Preferences change rarely |
| Admin list | `30_000` (30 sec) | Admin needs fresh data |

### 10.2 Invalidation Rules

| Mutation | Invalidates |
|----------|-------------|
| `markAsRead` | `notificationsKeys.lists()`, `notificationsKeys.unreadCount(userId)` |
| `markAllAsRead` | `notificationsKeys.lists()`, `notificationsKeys.unreadCount(userId)` |
| `deleteNotification` | `notificationsKeys.lists()`, `notificationsKeys.unreadCount(userId)` |
| `updatePreferences` | `notificationsKeys.preferences(userId)` |
| `adminSendNotification` | `notificationsKeys.adminLists()` |
| `adminBroadcastNotification` | `notificationsKeys.adminLists()` |
| `adminDeleteNotification` | `notificationsKeys.adminLists()` |

### 10.3 Realtime + Cache Sync Strategy

When Pusher events arrive, you have two options:

**Option A: Invalidate & Refetch (Recommended)**

```typescript
onNotificationNew: () => {
  qc.invalidateQueries({ queryKey: notificationsKeys.lists() });
  qc.invalidateQueries({ queryKey: notificationsKeys.unreadCount(userId) });
}
```

**Option B: Optimistic Update**

```typescript
onNotificationNew: (payload) => {
  qc.setQueryData(notificationsKeys.lists(), (old: any) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((page: any, i: number) =>
        i === 0
          ? {
              ...page,
              data: [newNotificationFromPayload(payload), ...page.data],
            }
          : page,
      ),
    };
  });
}
```

---

## 11. Example Usage (Next.js / React)

### 11.1 Notification Page with Realtime Updates

```typescript
// app/notifications/page.tsx
'use client';

import { useAuth } from '@/hooks/use-auth';
import { useInfiniteNotifications } from '@/hooks/use-infinite-notifications';
import { useUnreadCount } from '@/hooks/use-notifications';
import { usePusher } from '@/hooks/use-pusher';
import { NotificationFeed } from '@/components/NotificationFeed';

export default function NotificationsPage() {
  const { user } = useAuth();
  const { data: unreadData } = useUnreadCount(user?.id);

  // Enable Pusher when user is authenticated
  usePusher({
    userId: user?.id,
    enabled: !!user,
  });

  if (!user) {
    return <div>Please log in to view notifications</div>;
  }

  return (
    <main className="max-w-2xl mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Notifications</h1>
        {unreadData && (
          <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
            {unreadData.unreadCount} unread
          </span>
        )}
      </div>

      <NotificationFeed />
    </main>
  );
}
```

### 11.2 Admin Notification Management

```typescript
// app/admin/notifications/page.tsx
'use client';

import { useState } from 'react';
import {
  useAdminNotifications,
  useAdminSendNotification,
  useAdminBroadcastNotification,
} from '@/hooks/use-admin-notifications';
import type {
  CreateNotificationDto,
  BroadcastNotificationDto,
  NotificationType,
} from '@/types/notifications';

export default function AdminNotificationsPage() {
  const { data, isLoading } = useAdminNotifications({ page: 1, limit: 20 });
  const sendNotification = useAdminSendNotification();
  const broadcastNotification = useAdminBroadcastNotification();

  const [showSendForm, setShowSendForm] = useState(false);
  const [showBroadcastForm, setShowBroadcastForm] = useState(false);

  const handleSend = async (dto: CreateNotificationDto) => {
    await sendNotification.mutateAsync(dto);
    setShowSendForm(false);
  };

  const handleBroadcast = async (dto: BroadcastNotificationDto) => {
    await broadcastNotification.mutateAsync(dto);
    setShowBroadcastForm(false);
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <main className="max-w-4xl mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Admin — Notifications</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowSendForm(true)}>Send to User</button>
          <button onClick={() => setShowBroadcastForm(true)}>Broadcast</button>
        </div>
      </div>

      {showSendForm && (
        <SendNotificationForm
          onSubmit={handleSend}
          onClose={() => setShowSendForm(false)}
        />
      )}

      {showBroadcastForm && (
        <BroadcastNotificationForm
          onSubmit={handleBroadcast}
          onClose={() => setShowBroadcastForm(false)}
        />
      )}

      <NotificationTable notifications={data?.data ?? []} />
    </main>
  );
}

function SendNotificationForm({
  onSubmit,
  onClose,
}: {
  onSubmit: (dto: CreateNotificationDto) => void;
  onClose: () => void;
}) {
  const [userId, setUserId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<NotificationType>(NotificationType.SYSTEM);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ userId, title, message, type });
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4 p-4 border rounded">
      <h2 className="text-lg font-semibold mb-4">Send Notification to User</h2>

      <input
        type="text"
        placeholder="User ID (UUID)"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        required
      />

      <select value={type} onChange={(e) => setType(e.target.value as NotificationType)}>
        <option value={NotificationType.SYSTEM}>System</option>
        <option value={NotificationType.ORDER_UPDATED}>Order Updated</option>
        <option value={NotificationType.PAYMENT_SUCCESS}>Payment Success</option>
        <option value={NotificationType.PAYMENT_FAILED}>Payment Failed</option>
        <option value={NotificationType.BROADCAST}>Broadcast</option>
      </select>

      <input
        type="text"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />

      <textarea
        placeholder="Message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        required
      />

      <div className="flex gap-2">
        <button type="submit">Send</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

function BroadcastNotificationForm({
  onSubmit,
  onClose,
}: {
  onSubmit: (dto: BroadcastNotificationDto) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [targetUserIds, setTargetUserIds] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      title,
      message,
      targetUserIds: targetUserIds
        ? targetUserIds.split(',').map((id) => id.trim())
        : undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4 p-4 border rounded">
      <h2 className="text-lg font-semibold mb-4">Broadcast Notification</h2>

      <input
        type="text"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />

      <textarea
        placeholder="Message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        required
      />

      <input
        type="text"
        placeholder="Target User IDs (comma-separated, optional)"
        value={targetUserIds}
        onChange={(e) => setTargetUserIds(e.target.value)}
      />

      <div className="flex gap-2">
        <button type="submit">Broadcast</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

function NotificationTable({
  notifications,
}: {
  notifications: Notification[];
}) {
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th>User ID</th>
          <th>Type</th>
          <th>Title</th>
          <th>Message</th>
          <th>Read</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {notifications.map((n) => (
          <tr key={n.id}>
            <td className="text-sm">{n.userId.slice(0, 8)}...</td>
            <td>{n.type}</td>
            <td>{n.title}</td>
            <td>{n.message}</td>
            <td>{n.isRead ? '✅' : '❌'}</td>
            <td>{new Date(n.createdAt).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

### 11.3 API Client Functions

```typescript
// lib/api/notifications.ts
import api from './client';
import type {
  Notification,
  NotificationPreferences,
  CursorPaginatedResponse,
  PaginatedNotifications,
  UnreadCountResponse,
  SuccessResponse,
  CursorPaginationDto,
  PaginationQueryDto,
  CreateNotificationDto,
  BroadcastNotificationDto,
  UpdatePreferencesDto,
} from '@/types/notifications';

// ─── User Endpoints ─────────────────────────────────────────────────────

export async function getNotifications(
  pagination: CursorPaginationDto = {},
): Promise<CursorPaginatedResponse<Notification>> {
  const { data } = await api.get<CursorPaginatedResponse<Notification>>(
    '/notifications',
    { params: pagination },
  );
  return data;
}

export async function getUnreadCount(): Promise<UnreadCountResponse> {
  const { data } = await api.get<UnreadCountResponse>('/notifications/unread-count');
  return data;
}

export async function markAsRead(id: string): Promise<Notification> {
  const { data } = await api.patch<Notification>(`/notifications/${id}/read`);
  return data;
}

export async function markAllAsRead(): Promise<SuccessResponse> {
  const { data } = await api.patch<SuccessResponse>('/notifications/read-all');
  return data;
}

export async function deleteNotification(id: string): Promise<void> {
  await api.delete(`/notifications/${id}`);
}

export async function getPreferences(): Promise<NotificationPreferences> {
  const { data } = await api.get<NotificationPreferences>('/notifications/preferences');
  return data;
}

export async function updatePreferences(
  updates: UpdatePreferencesDto,
): Promise<NotificationPreferences> {
  const { data } = await api.patch<NotificationPreferences>(
    '/notifications/preferences',
    null,
    { params: updates },
  );
  return data;
}

// ─── Admin Endpoints ────────────────────────────────────────────────────

export async function adminListNotifications(
  query: PaginationQueryDto = {},
): Promise<PaginatedNotifications> {
  const { data } = await api.get<PaginatedNotifications>('/admin/notifications', {
    params: query,
  });
  return data;
}

export async function adminSendNotification(
  dto: CreateNotificationDto,
): Promise<Notification> {
  const { data } = await api.post<Notification>('/admin/notifications/send', dto);
  return data;
}

export async function adminBroadcastNotification(
  dto: BroadcastNotificationDto,
): Promise<SuccessResponse> {
  const { data } = await api.post<SuccessResponse>(
    '/admin/notifications/broadcast',
    dto,
  );
  return data;
}

export async function adminDeleteNotification(id: string): Promise<void> {
  await api.delete(`/admin/notifications/${id}`);
}
```

---

## 12. Gotchas & Edge Cases

### 12.1 Event Deduplication

**Problem:** Pusher may deliver duplicate events during reconnection or network instability.

**Solution:** Use `eventId` (UUID) to deduplicate:

```typescript
const seenEventIds = new Set<string>();

function processEvent<T extends { eventId: string }>(payload: T, handler: (p: T) => void) {
  if (seenEventIds.has(payload.eventId)) return;
  seenEventIds.add(payload.eventId);

  // Prevent memory leak
  if (seenEventIds.size > 1000) {
    const arr = Array.from(seenEventIds);
    seenEventIds.clear();
    arr.slice(-500).forEach((id) => seenEventIds.add(id));
  }

  handler(payload);
}
```

### 12.2 Pusher Auth Endpoint Proxy

**Problem:** Pusher's client SDK requires an auth endpoint, but your backend's `/pusher/auth` needs JWT in headers.

**Solution:** Create a Next.js API route that proxies the request and forwards the JWT (see section 5.3).

### 12.3 Channel Subscription Timing

**Problem:** Subscribing to Pusher channel before JWT is available.

**Solution:** Only enable Pusher when user is authenticated:

```typescript
usePusher({
  userId: user?.id,
  enabled: !!user, // Only subscribe when user exists
});
```

### 12.4 Cursor Pagination vs Offset Pagination

**Problem:** The backend supports both cursor-based and offset-based pagination.

**Solution:**
- **Use cursor-based** (`GET /notifications`) for new implementations
- **Offset-based** (`GET /notifications/paginated`) is deprecated
- Cursor = `createdAt` timestamp of last item
- First request: omit `cursor`
- Subsequent requests: use `meta.nextCursor` from previous response

### 12.5 Soft Delete vs Hard Delete

**Problem:** Users can soft-delete, admins can hard-delete.

**Solution:**
- **User endpoints** (`DELETE /notifications/:id`): Soft delete — notification marked `isDeleted = true`
- **Admin endpoints** (`DELETE /admin/notifications/:id`): Hard delete — notification permanently removed
- Soft-deleted notifications are excluded from queries automatically

### 12.6 Graceful Degradation

**Problem:** Pusher may fail to deliver events (network issues, service outage).

**Solution:**
- Backend persists all notifications to DB regardless of Pusher status
- Frontend should periodically poll `GET /notifications` to catch missed events
- Use React Query's `refetchInterval` for fallback polling:

```typescript
useQuery({
  queryKey: notificationsKeys.list({ userId }),
  queryFn: () => getNotifications(),
  refetchInterval: 60_000, // Poll every 60 seconds as fallback
  staleTime: 30_000,
});
```

### 12.7 Notification Preferences

**Problem:** Preferences are created on-demand if they don't exist.

**Solution:**
- First call to `GET /notifications/preferences` creates default preferences
- All preference fields default to `true`
- Update via `PATCH /notifications/preferences` with query params (not body)

### 12.8 Payment Status Events

**Problem:** Payment status events have a different payload shape than notification events.

**Solution:**
- Handle `payment:status` events separately
- Payload includes `status`, `amount`, `description` (no `notificationId`)
- Use for updating payment UI in real-time

### 12.9 Environment Variables

**Required frontend environment variables:**

```env
NEXT_PUBLIC_API_URL=https://your-api-domain.com
NEXT_PUBLIC_PUSHER_KEY=your-pusher-key
NEXT_PUBLIC_PUSHER_CLUSTER=your-pusher-cluster
```

### 12.10 Cleanup on Logout

**Problem:** Pusher connection persists after logout.

**Solution:** Disconnect Pusher when user logs out:

```typescript
import { disconnectPusher } from '@/lib/pusher/client';

function handleLogout() {
  disconnectPusher();
  // ... rest of logout logic
}
```

### 12.11 Connection State Monitoring

**Problem:** Users may not realize Pusher is disconnected.

**Solution:** Monitor connection state and show UI indicator:

```typescript
pusher.connection.bind('state_change', (states: { current: string }) => {
  if (states.current === 'disconnected') {
    showToast('Real-time notifications temporarily unavailable');
  }
});
```

---

## Appendix A: Complete File Structure (Frontend)

```
frontend/
├── types/
│   └── notifications.ts              # All TypeScript interfaces
├── lib/
│   └── api/
│       ├── client.ts                 # Axios instance
│       ├── notifications.ts          # API functions
│       └── notifications-keys.ts     # React Query keys
│   └── pusher/
│       └── client.ts                 # Pusher client setup
├── hooks/
│   ├── use-notifications.ts          # User query/mutation hooks
│   ├── use-admin-notifications.ts    # Admin hooks
│   ├── use-infinite-notifications.ts # Infinite scroll hook
│   └── use-pusher.ts                 # Pusher realtime hook
├── components/
│   ├── notifications/
│   │   ├── NotificationBadge.tsx
│   │   ├── NotificationFeed.tsx
│   │   ├── InfiniteNotificationFeed.tsx
│   │   └── NotificationItem.tsx
│   └── admin/
│       ├── AdminNotificationsPage.tsx
│       ├── SendNotificationForm.tsx
│       └── BroadcastNotificationForm.tsx
└── app/
    ├── notifications/
    │   └── page.tsx                  # User notification feed
    └── admin/
        └── notifications/
            └── page.tsx              # Admin notification management
```

---

## Appendix B: Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│  NOTIFICATIONS MODULE — QUICK REFERENCE                         │
├─────────────────────────────────────────────────────────────────┤
│  User Base:    GET/PATCH/DELETE /notifications                  │
│  Admin Base:   POST/GET/DELETE /admin/notifications             │
│  Pusher Auth:  POST /pusher/auth                                │
│  Auth:         JWT (user), JWT + ADMIN (admin)                  │
│  Realtime:     Pusher (private-user-{userId})                   │
│  Pagination:   Cursor-based (recommended), offset (deprecated)  │
│  Cursor:       createdAt timestamp (ISO 8601)                   │
│  Max limit:    50 (cursor), 100 (offset)                        │
│  Events:       notification:new, notification:read,             │
│                notification:read_all, notification:count,       │
│                notification:delete, payment:status              │
│  Dedup:        Use eventId (UUID) to prevent duplicates         │
│  Fallback:     Poll GET /notifications every 60s                │
│  Error shape:  { statusCode, message, errors?, timestamp, path }│
│  List shape:   { data: Notification[], meta: { nextCursor,      │
│                hasMore, limit } }                               │
│  Preferences:  Created on first GET, update via PATCH query     │
│  Delete:       Soft (user), Hard (admin)                        │
│  Cleanup:      Disconnect Pusher on logout                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Appendix C: Pusher Event Flow Diagram

```
User Action (Backend)          Pusher Service              Frontend
      │                              │                        │
      │  create notification         │                        │
      ├─────────────────────────────►│                        │
      │                              │  trigger event         │
      │                              ├───────────────────────►│
      │                              │  notification:new      │
      │                              │                        │
      │                              │  ◄──── check eventId ──│
      │                              │  (deduplication)       │
      │                              │                        │
      │                              │  update UI             │
      │                              │  ◄─────────────────────┤
      │                              │                        │
      │  mark as read                │                        │
      ├─────────────────────────────►│                        │
      │                              │  trigger event         │
      │                              ├───────────────────────►│
      │                              │  notification:read     │
      │                              │  notification:count    │
      │                              │                        │
      │                              │  update UI             │
      │                              │  ◄─────────────────────┤
```

---

## Appendix D: Migration from Socket.IO

If your frontend previously used Socket.IO, here's the migration path:

### Before (Socket.IO)

```typescript
import io from 'socket.io-client';

const socket = io(API_URL, {
  auth: { token: jwtToken },
});

socket.on('notification:new', (payload) => {
  // handle
});
```

### After (Pusher)

```typescript
import Pusher from 'pusher-js';

const pusher = new Pusher(PUSHER_KEY, {
  cluster: PUSHER_CLUSTER,
  authEndpoint: '/api/pusher/auth',
});

const channel = pusher.subscribe(`private-user-${userId}`);

channel.bind('notification:new', (payload) => {
  // handle (same payload shape, plus eventId for dedup)
});
```

### Key Changes

1. **Connection:** Socket.IO persistent → Pusher managed
2. **Auth:** Socket.IO connection auth → `POST /pusher/auth` endpoint
3. **Channels:** `user-{userId}` rooms → `private-user-{userId}` channels
4. **Events:** Same event names, but now include `eventId` for deduplication
5. **Reconnection:** Socket.IO built-in → Pusher SDK handles automatically

---

**End of Integration Plan**
