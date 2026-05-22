# Orders Module — Frontend Integration Plan

> **Backend:** NestJS v11 · TypeORM · PostgreSQL · Stripe Checkout
> **Last Updated:** 2026-05-21
> **Audience:** Frontend / Full-Stack Developers

---

## Table of Contents

1. [Orders Overview](#1-orders-overview)
2. [API Endpoint Map](#2-api-endpoint-map)
3. [TypeScript Types & Interfaces](#3-typescript-types--interfaces)
4. [Order Lifecycle & Status Flow](#4-order-lifecycle--status-flow)
5. [API Client Setup](#5-api-client-setup)
6. [React Query Hooks](#6-react-query-hooks)
7. [Error Handling & Validation Mapping](#7-error-handling--validation-mapping)
8. [Example Usage (Next.js / React)](#8-example-usage-nextjs--react)
9. [Gotchas & Edge Cases](#9-gotchas--edge-cases)

---

## 1. Orders Overview

### 1.1 How Orders Work

Orders represent e-commerce purchases created from the user's cart via Stripe Checkout Sessions:

1. The user adds products to their cart (`POST /cart/items`).
2. The user initiates checkout (`POST /payments/checkout-session`).
3. The backend creates an **Order** from the cart, then creates a **Stripe Checkout Session**.
4. The order starts in `AWAITING_CHECKOUT_SESSION` → immediately transitions to `PENDING_PAYMENT`.
5. The frontend redirects the user to the Stripe-hosted checkout page.
6. After payment, Stripe sends a webhook to the backend.
7. The backend marks the order as `PAID` and clears the user's cart.
8. The user can view their order history (`GET /orders`) and order details (`GET /orders/:id`).

### 1.2 Order Statuses

| Status | Description | User-Facing Label |
|--------|-------------|-------------------|
| `awaiting_checkout_session` | Order created, Stripe session not yet created | "Preparing checkout..." |
| `pending_payment` | Stripe session created, awaiting payment | "Awaiting payment" |
| `paid` | Payment confirmed | "Paid" |
| `failed` | Payment failed | "Payment failed" |
| `canceled` | Order was canceled | "Canceled" |
| `refunded` | Full refund issued | "Refunded" |
| `partially_refunded` | Partial refund issued | "Partially refunded" |
| `expired` | Checkout session expired (20 min timeout) | "Expired" |

### 1.3 Status Transition Diagram

```
awaiting_checkout_session
    ├──→ pending_payment
    │       ├──→ paid ──→ refunded ──→ partially_refunded
    │       ├──→ failed (terminal)
    │       ├──→ canceled (terminal)
    │       └──→ expired (terminal)
    └──→ failed (terminal)
```

> **Terminal states** (`failed`, `canceled`, `expired`, `refunded`) cannot transition to any other state. `partially_refunded` can only transition to `refunded`.

### 1.4 Security Model

- **All order endpoints require JWT authentication.**
- Orders are scoped to the authenticated user — a user can only see their own orders.
- `GET /orders/:id` uses a **compound WHERE clause** (`orderId + userId`) in a single query to prevent order-existence leakage (i.e., an attacker cannot determine if an order ID exists for another user).

---

## 2. API Endpoint Map

### 2.1 Protected Endpoints (JWT cookie required)

| Method | Path | Description | Request Body | Success Response | Error Codes | Rate Limit |
|--------|------|-------------|-------------|------------------|-------------|------------|
| `GET` | `/orders` | Get user order history (paginated) | Query: `?page=1&limit=20` | [`OrderHistoryResponse`](#orderhistoryresponse) | `401` | 20 / 60s |
| `GET` | `/orders/:id` | Get single order detail | Path: `id` (UUID) | [`OrderResponse`](#orderresponse) | `401`, `404` | 30 / 60s |

### 2.2 Related Endpoints (in Payments Module)

| Method | Path | Description | Request Body | Success Response |
|--------|------|-------------|-------------|------------------|
| `POST` | `/payments/checkout-session` | Create Stripe Checkout Session from cart | [`CreateCheckoutSessionDto`](#createcheckoutsessiondto) | [`CheckoutSessionResponse`](#checkoutsessionresponse) |

---

## 3. TypeScript Types & Interfaces

### 3.1 Response Types

```typescript
// ─── Order Item in Response ─────────────────────────────────────────────
export interface OrderItemResponse {
  id: string;                    // Order item UUID
  productId: string;             // Product UUID
  productTitleSnapshot: string;  // Product title at time of purchase
  productThumbnailSnapshot: string | null; // Thumbnail at time of purchase
  unitPrice: number;             // Price in cents at time of purchase
  quantity: number;              // Quantity purchased
  subtotal: number;              // unitPrice * quantity (in cents)
  currency: string;              // Always "usd"
}

// ─── Single Order Response ──────────────────────────────────────────────
export interface OrderResponse {
  id: string;                    // Order UUID
  userId: string;                // User ID (stringified number)
  status: OrderStatus;           // See OrderStatus enum
  subtotal: number;              // Sum of item subtotals (in cents)
  taxAmount: number;             // Tax amount in cents (currently 0)
  discountAmount: number;        // Discount amount in cents (currently 0)
  totalAmount: number;           // subtotal + taxAmount - discountAmount
  paymentId: string | null;      // Linked payment record UUID (null until paid)
  currency: string;              // Always "usd"
  stripeCheckoutSessionId: string | null; // Stripe session ID
  reservationExpiresAt: Date | null; // When the pending reservation expires
  createdAt: Date;               // Order creation timestamp
  items: OrderItemResponse[];    // Line items in the order
}

// ─── Order History Response (Paginated) ─────────────────────────────────
export interface OrderHistoryResponse {
  data: OrderResponse[];
  total: number;                 // Total number of orders
  page: number;                  // Current page
  limit: number;                 // Items per page
  totalPages: number;            // Total number of pages
}

// ─── Checkout Session Response ──────────────────────────────────────────
export interface CheckoutSessionResponse {
  checkoutUrl: string;           // Stripe-hosted checkout page URL
  orderId: string;               // Order UUID (for tracking)
  sessionId: string;             // Stripe session ID (cs_...)
  expiresAt: Date;               // When the session expires (20 min from creation)
}
```

### 3.2 Request DTOs

```typescript
// ─── Create Checkout Session ────────────────────────────────────────────
export interface CreateCheckoutSessionDto {
  successUrl?: string;           // Optional: custom success redirect URL
  cancelUrl?: string;            // Optional: custom cancel redirect URL
}
```

### 3.3 Enums

```typescript
// ─── Order Status Enum ──────────────────────────────────────────────────
export enum OrderStatus {
  AWAITING_CHECKOUT_SESSION = 'awaiting_checkout_session',
  PENDING_PAYMENT = 'pending_payment',
  PAID = 'paid',
  FAILED = 'failed',
  CANCELED = 'canceled',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
  EXPIRED = 'expired',
}
```

### 3.4 Error Response Shape (Global)

```typescript
export interface ApiError {
  statusCode: number;
  message: string | string[];
  errors?: Array<{ field: string; message: string }>;
  timestamp: string;
  path: string;
}
```

---

## 4. Order Lifecycle & Status Flow

### 4.1 Complete Checkout Flow Diagram

```
┌──────────┐          ┌──────────┐          ┌──────────┐          ┌──────────┐
│  Client  │          │  Backend │          │  Stripe  │          │  Webhook │
│          │          │          │          │          │          │  Handler │
│          │          │          │          │          │          │          │
│ POST     │          │          │          │          │          │          │
│ /payments│          │          │          │          │          │          │
│ /checkout│          │          │          │          │          │          │
│ -session │          │          │          │          │          │          │
│─────────►│          │          │          │          │          │          │
│          │ 1.Validate cart      │          │          │          │
│          │ 2.Create Order       │          │          │          │
│          │   (AWAITING_         │          │          │          │
│          │    CHECKOUT_SESSION) │          │          │          │
│          │ 3.Create Stripe      │          │          │          │
│          │    Checkout Session  │          │          │          │
│          │──────────────────────────────►│          │          │
│          │ 4.Mark Order         │          │          │          │
│          │   PENDING_PAYMENT    │          │          │          │
│          │ 5.Return checkoutUrl │          │          │          │
│          │◄─────────│          │          │          │          │
│          │          │          │          │          │          │
│          │ Redirect to Stripe Checkout    │          │          │
│          │───────────────────────────────►│          │          │
│          │          │          │          │          │          │
│          │ User completes payment         │          │          │
│          │          │          │          │          │          │
│          │          │          │  Webhook:│          │          │
│          │          │          │  checkout│          │          │
│          │          │          │  .session│          │          │
│          │          │          │  .completed         │          │
│          │          │          │─────────────────────────────►│
│          │          │          │          │          │ 6.Create/update Payment   │
│          │          │          │          │          │ 7.Mark Order PAID         │
│          │          │          │          │          │ 8.Clear cart              │
│          │          │          │          │          │ 9.Emit notifications      │
│          │          │          │          │          │          │
│          │ Redirect to successUrl         │          │          │
│          │◄───────────────────────────────│          │          │
│          │          │          │          │          │          │
│ GET      │          │          │          │          │          │
│ /orders  │          │          │          │          │          │
│ /:id     │          │          │          │          │          │
│─────────►│          │          │          │          │          │
│          │ Return OrderResponse (PAID)    │          │          │
│          │◄─────────│          │          │          │          │
└──────────┘          └──────────┘          └──────────┘          └──────────┘
```

### 4.2 Step-by-Step Flow

```
1. User reviews cart and clicks "Checkout"
2. Frontend calls: POST /payments/checkout-session { successUrl?, cancelUrl? }
3. Backend validates cart (items exist, stock available, not empty)
4. Backend creates Order with status AWAITING_CHECKOUT_SESSION
5. Backend creates Stripe Checkout Session with cart line items
6. Backend marks Order as PENDING_PAYMENT (same transaction)
7. Backend returns { checkoutUrl, orderId, sessionId, expiresAt }
8. Frontend redirects user to checkoutUrl (Stripe-hosted page)
9. User enters payment details on Stripe page
10. Stripe processes payment
11. Stripe sends webhook: checkout.session.completed
12. Backend validates webhook signature
13. Backend creates/updates Payment record
14. Backend marks Order as PAID (pessimistic lock for concurrency safety)
15. Backend clears user's cart (idempotent — safe if already empty)
16. Backend emits real-time notification via Pusher
17. Stripe redirects user to successUrl
18. Frontend can fetch order detail: GET /orders/:id
```

### 4.3 Expiration Flow

```
1. User creates checkout session → Order is PENDING_PAYMENT
2. Session expires after 20 minutes without payment
3. (Future) Cron job marks expired orders as EXPIRED
4. Frontend should check reservationExpiresAt to show expiration warning
```

---

## 5. API Client Setup

### 5.1 Orders API Functions

```typescript
// lib/api/orders.ts
import api from './client';  // Assumes axios instance with withCredentials: true
import type {
  OrderResponse,
  OrderHistoryResponse,
} from '@/types/orders';

/**
 * Get paginated order history for the authenticated user.
 */
export async function getOrderHistory(
  page = 1,
  limit = 20,
): Promise<OrderHistoryResponse> {
  const { data } = await api.get<OrderHistoryResponse>('/orders', {
    params: { page, limit },
  });
  return data;
}

/**
 * Get a single order by ID.
 * Returns 404 if the order doesn't exist or doesn't belong to the user.
 */
export async function getOrderById(orderId: string): Promise<OrderResponse> {
  const { data } = await api.get<OrderResponse>(`/orders/${orderId}`);
  return data;
}
```

### 5.2 Checkout Session API Function

```typescript
// lib/api/checkout.ts
import api from './client';
import type {
  CheckoutSessionResponse,
  CreateCheckoutSessionDto,
} from '@/types/orders';

/**
 * Create a Stripe Checkout Session from the user's cart.
 * Returns a redirect URL to the Stripe-hosted checkout page.
 */
export async function createCheckoutSession(
  dto: CreateCheckoutSessionDto = {},
): Promise<CheckoutSessionResponse> {
  const { data } = await api.post<CheckoutSessionResponse>(
    '/payments/checkout-session',
    dto,
  );
  return data;
}
```

---

## 6. React Query Hooks

### 6.1 Query Keys Factory

```typescript
// lib/api/orders-keys.ts
export const ordersKeys = {
  all: ['orders'] as const,
  history: () => [...ordersKeys.all, 'history'] as const,
  historyPage: (page: number, limit: number) =>
    [...ordersKeys.history(), { page, limit }] as const,
  detail: (orderId: string) =>
    [...ordersKeys.all, 'detail', orderId] as const,
};
```

### 6.2 Order Hooks

```typescript
// hooks/use-orders.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { ordersKeys } from '@/lib/api/orders-keys';
import {
  getOrderHistory,
  getOrderById,
} from '@/lib/api/orders';
import { createCheckoutSession } from '@/lib/api/checkout';
import type { CreateCheckoutSessionDto } from '@/types/orders';

// ─── Order History Query ────────────────────────────────────────────────

export function useOrderHistory(page = 1, limit = 20) {
  return useQuery({
    queryKey: ordersKeys.historyPage(page, limit),
    queryFn: () => getOrderHistory(page, limit),
    staleTime: 10_000, // 10 seconds — orders change on payment
  });
}

// ─── Order Detail Query ─────────────────────────────────────────────────

export function useOrderDetail(orderId: string) {
  return useQuery({
    queryKey: ordersKeys.detail(orderId),
    queryFn: () => getOrderById(orderId),
    staleTime: 5_000, // 5 seconds — poll for status changes
    refetchInterval: (query) => {
      // Keep polling while order is pending
      const status = query.state.data?.status;
      if (status === 'pending_payment' || status === 'awaiting_checkout_session') {
        return 3_000; // Poll every 3s while pending
      }
      return false; // Stop polling once settled
    },
  });
}

// ─── Create Checkout Session Mutation ───────────────────────────────────

export function useCreateCheckoutSession() {
  return useMutation({
    mutationFn: createCheckoutSession,
  });
}
```

---

## 7. Error Handling & Validation Mapping

### 7.1 HTTP Status Codes & Meanings

| Status | When | Frontend Action |
|--------|------|-----------------|
| `400` | Cart is empty, invalid items, stock unavailable | Show inline error, prevent checkout |
| `401` | Missing/expired JWT cookie | Redirect to login page |
| `404` | Order not found or doesn't belong to user | Show "Order not found" |
| `429` | Rate limit exceeded | Show "too many attempts" message |
| `500` | Server error, Stripe unavailable | Show generic error toast |

### 7.2 Known Backend Error Messages

| Endpoint | Error Message | Trigger |
|----------|--------------|---------|
| `POST /payments/checkout-session` | `"Cart is empty. Add items before checkout."` | User has no cart items |
| `POST /payments/checkout-session` | `"Product not available: {name}"` | Product was deleted/unpublished |
| `POST /payments/checkout-session` | `"Insufficient stock for: {name}"` | Product stock < requested quantity |
| `POST /payments/checkout-session` | `"Failed to create checkout session"` | Stripe API error |
| `GET /orders/:id` | `"Order not found"` | Order doesn't exist or belongs to another user |

### 7.3 Checkout Session Error Handling

```typescript
// lib/api/checkout-errors.ts
export function getCheckoutErrorMessage(error: { statusCode: number; message: string }): string {
  if (error.statusCode === 400) {
    if (error.message.includes('Cart is empty')) {
      return 'Your cart is empty. Add some items before checking out.';
    }
    if (error.message.includes('Product not available')) {
      return 'One or more items in your cart are no longer available.';
    }
    if (error.message.includes('Insufficient stock')) {
      return 'Some items in your cart have insufficient stock. Please update quantities.';
    }
    return error.message;
  }
  if (error.statusCode === 429) {
    return 'Too many checkout attempts. Please wait a moment and try again.';
  }
  return 'Failed to start checkout. Please try again.';
}
```

---

## 8. Example Usage (Next.js / React)

### 8.1 Checkout Flow (Cart → Stripe → Success)

```typescript
// app/checkout/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/hooks/use-cart';
import { useCreateCheckoutSession } from '@/hooks/use-orders';
import { getCheckoutErrorMessage } from '@/lib/api/checkout-errors';

export default function CheckoutPage() {
  const router = useRouter();
  const { data: cart, isLoading } = useCart();
  const createSession = useCreateCheckoutSession();
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = async () => {
    setError(null);
    try {
      const result = await createSession.mutateAsync({
        successUrl: `${window.location.origin}/orders/success`,
        cancelUrl: `${window.location.origin}/cart`,
      });

      // Redirect to Stripe-hosted checkout page
      window.location.href = result.checkoutUrl;
    } catch (err: unknown) {
      const apiError = err as { statusCode: number; message: string };
      setError(getCheckoutErrorMessage(apiError));
    }
  };

  if (isLoading) return <div>Loading cart...</div>;
  if (!cart || cart.items.length === 0) {
    return (
      <div>
        <h1>Your cart is empty</h1>
        <button onClick={() => router.push('/products')}>Browse Products</button>
      </div>
    );
  }

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Checkout</h1>

      {/* Cart summary */}
      <div className="mb-6">
        {cart.items.map((item) => (
          <div key={item.id} className="flex justify-between py-2">
            <span>{item.productTitle} × {item.quantity}</span>
            <span>${(item.subtotal / 100).toFixed(2)}</span>
          </div>
        ))}
        <div className="border-t pt-2 mt-2 font-bold">
          <div className="flex justify-between">
            <span>Total</span>
            <span>${(cart.subtotal / 100).toFixed(2)}</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded mb-4">
          {error}
        </div>
      )}

      <button
        onClick={handleCheckout}
        disabled={createSession.isPending}
        className="w-full bg-green-600 text-white py-3 rounded hover:bg-green-700 disabled:opacity-50"
      >
        {createSession.isPending ? 'Preparing checkout...' : 'Proceed to Payment'}
      </button>
    </main>
  );
}
```

### 8.2 Order Success Page (After Stripe Redirect)

```typescript
// app/orders/success/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOrderDetail } from '@/hooks/use-orders';
import { OrderStatus } from '@/types/orders';

const STATUS_MESSAGES: Record<OrderStatus, string> = {
  awaiting_checkout_session: 'Preparing your order...',
  pending_payment: 'Waiting for payment confirmation...',
  paid: 'Payment confirmed! Your order is being processed.',
  failed: 'Payment failed. Please contact support.',
  canceled: 'Order was canceled.',
  refunded: 'Order has been refunded.',
  partially_refunded: 'Order has been partially refunded.',
  expired: 'Checkout session expired. Please try again.',
};

export default function OrderSuccessPage() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('order_id');
  const [pollCount, setPollCount] = useState(0);

  // useOrderDetail auto-polls while order is pending
  const { data: order, isLoading, error } = useOrderDetail(orderId ?? '');

  // Fallback: if polling doesn't resolve after 30s, show a message
  useEffect(() => {
    if (pollCount > 10) {
      // After ~30 seconds of polling (3s interval × 10)
      // Show a message telling user to check order history
    }
    const timer = setTimeout(() => setPollCount((c) => c + 1), 3000);
    return () => clearTimeout(timer);
  }, [pollCount]);

  if (!orderId) return <div>No order ID provided.</div>;
  if (isLoading) return <div>Confirming your payment...</div>;
  if (error) return <div>Failed to load order details.</div>;
  if (!order) return <div>Order not found.</div>;

  return (
    <main className="max-w-2xl mx-auto p-6 text-center">
      {order.status === OrderStatus.PAID ? (
        <>
          <h1 className="text-3xl font-bold text-green-600 mb-4">
            Payment Confirmed!
          </h1>
          <p className="text-lg mb-6">
            Thank you for your purchase. Your order #{order.id.slice(0, 8)} is being processed.
          </p>
          <a href={`/orders/${order.id}`} className="text-blue-600 hover:underline">
            View Order Details
          </a>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold mb-4">
            {STATUS_MESSAGES[order.status] ?? 'Processing...'}
          </h1>
          <p className="text-gray-500">
            Please wait while we confirm your payment. This may take a moment.
          </p>
          {pollCount > 10 && (
            <p className="mt-4 text-gray-600">
              Still waiting? Check your{' '}
              <a href="/orders" className="text-blue-600 hover:underline">
                order history
              </a>{' '}
              for updates.
            </p>
          )}
        </>
      )}
    </main>
  );
}
```

### 8.3 Order History Page

```typescript
// app/orders/page.tsx
'use client';

import { useState } from 'react';
import { useOrderHistory } from '@/hooks/use-orders';
import { OrderStatus } from '@/types/orders';
import Link from 'next/link';

const STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_checkout_session: 'Preparing',
  pending_payment: 'Awaiting Payment',
  paid: 'Paid',
  failed: 'Failed',
  canceled: 'Canceled',
  refunded: 'Refunded',
  partially_refunded: 'Partially Refunded',
  expired: 'Expired',
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  awaiting_checkout_session: 'blue',
  pending_payment: 'yellow',
  paid: 'green',
  failed: 'red',
  canceled: 'gray',
  refunded: 'purple',
  partially_refunded: 'purple',
  expired: 'orange',
};

export default function OrderHistoryPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useOrderHistory(page, 20);

  if (isLoading) return <div>Loading orders...</div>;
  if (error) return <div>Failed to load orders.</div>;
  if (!data || data.total === 0) {
    return (
      <main className="max-w-4xl mx-auto p-6 text-center">
        <h1 className="text-2xl font-bold mb-4">No orders yet</h1>
        <Link href="/products" className="text-blue-600 hover:underline">
          Start Shopping
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Order History</h1>

      <div className="space-y-4">
        {data.data.map((order) => (
          <Link
            key={order.id}
            href={`/orders/${order.id}`}
            className="block p-4 border rounded hover:shadow transition-shadow"
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium">
                  Order #{order.id.slice(0, 8)}
                </p>
                <p className="text-sm text-gray-500">
                  {new Date(order.createdAt).toLocaleDateString()}
                </p>
                <p className="text-sm text-gray-500">
                  {order.items.length} item(s)
                </p>
              </div>
              <div className="text-right">
                <Badge color={STATUS_COLORS[order.status]}>
                  {STATUS_LABELS[order.status]}
                </Badge>
                <p className="font-bold mt-1">
                  ${(order.totalAmount / 100).toFixed(2)}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {data.totalPages > 1 && (
        <div className="flex justify-center gap-4 mt-6">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="px-4 py-2 border rounded disabled:opacity-50"
          >
            Previous
          </button>
          <span className="py-2">
            Page {page} of {data.totalPages}
          </span>
          <button
            disabled={page >= data.totalPages}
            onClick={() => setPage(page + 1)}
            className="px-4 py-2 border rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </main>
  );
}
```

### 8.4 Order Detail Page

```typescript
// app/orders/[id]/page.tsx
'use client';

import { useParams } from 'next/navigation';
import { useOrderDetail } from '@/hooks/use-orders';
import { OrderStatus } from '@/types/orders';

export default function OrderDetailPage() {
  const { id } = useParams();
  const { data: order, isLoading, error } = useOrderDetail(id as string);

  if (isLoading) return <div>Loading order...</div>;
  if (error) return <div>Failed to load order.</div>;
  if (!order) return <div>Order not found.</div>;

  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">
        Order #{order.id.slice(0, 8)}
      </h1>

      {/* Status */}
      <div className="mb-6">
        <p className="text-sm text-gray-500">Status</p>
        <Badge color={STATUS_COLORS[order.status]}>
          {STATUS_LABELS[order.status]}
        </Badge>
      </div>

      {/* Items */}
      <div className="border rounded overflow-hidden mb-6">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3">Product</th>
              <th className="text-right p-3">Price</th>
              <th className="text-right p-3">Qty</th>
              <th className="text-right p-3">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="p-3">
                  <div className="flex items-center gap-3">
                    {item.productThumbnailSnapshot && (
                      <img
                        src={item.productThumbnailSnapshot}
                        alt={item.productTitleSnapshot}
                        className="w-12 h-12 object-cover rounded"
                      />
                    )}
                    <span>{item.productTitleSnapshot}</span>
                  </div>
                </td>
                <td className="text-right p-3">
                  ${(item.unitPrice / 100).toFixed(2)}
                </td>
                <td className="text-right p-3">{item.quantity}</td>
                <td className="text-right p-3 font-medium">
                  ${(item.subtotal / 100).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="border-t pt-4 space-y-2">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>${(order.subtotal / 100).toFixed(2)}</span>
        </div>
        {order.taxAmount > 0 && (
          <div className="flex justify-between">
            <span>Tax</span>
            <span>${(order.taxAmount / 100).toFixed(2)}</span>
          </div>
        )}
        {order.discountAmount > 0 && (
          <div className="flex justify-between text-green-600">
            <span>Discount</span>
            <span>-${(order.discountAmount / 100).toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-lg border-t pt-2">
          <span>Total</span>
          <span>${(order.totalAmount / 100).toFixed(2)}</span>
        </div>
      </div>

      {/* Metadata */}
      <div className="mt-6 text-sm text-gray-500">
        <p>Order ID: {order.id}</p>
        <p>Created: {new Date(order.createdAt).toLocaleString()}</p>
        {order.stripeCheckoutSessionId && (
          <p>Stripe Session: {order.stripeCheckoutSessionId}</p>
        )}
        {order.reservationExpiresAt && (
          <p>
            Reservation expires:{' '}
            {new Date(order.reservationExpiresAt).toLocaleString()}
          </p>
        )}
      </div>
    </main>
  );
}
```

---

## 9. Gotchas & Edge Cases

### 9.1 Order Ownership is Enforced Server-Side

The backend uses a **compound WHERE clause** (`orderId + userId`) for `GET /orders/:id`. If a user tries to access another user's order, they get `404 Not Found` — not `403 Forbidden`. This prevents attackers from enumerating order IDs.

### 9.2 Prices are Snapshots

Order items store `productTitleSnapshot` and `productThumbnailSnapshot` — these are the values **at the time of purchase**, not the current product values. This ensures order history remains accurate even if products are updated or deleted.

### 9.3 Amounts are in Cents

All price fields (`unitPrice`, `subtotal`, `totalAmount`, `taxAmount`, `discountAmount`) are **integers in cents**. Always divide by 100 for display:

```typescript
const displayPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;
```

### 9.4 Tax and Discount are Currently $0

The backend has explicit `TODO` comments for tax and discount integration. Currently:
- `taxAmount` is always `0`
- `discountAmount` is always `0`
- `totalAmount` equals `subtotal`

The frontend should still display these fields (for future-proofing) but can hide them when they are `0`.

### 9.5 Checkout Session Expires in 20 Minutes

Stripe Checkout Sessions expire after 20 minutes. The `reservationExpiresAt` field on the order indicates when the pending reservation expires. If the user doesn't complete payment by then:
- The order remains in `PENDING_PAYMENT` until a cron job marks it as `EXPIRED`
- The cart items are NOT automatically restored (stock reservation is not yet implemented)

### 9.6 Cart is Cleared After Payment

After a successful payment, the backend clears the user's cart. The `clearCart` operation is **idempotent** — it returns silently if the cart is already empty. The frontend should invalidate the cart query after a successful payment.

### 9.7 No Cancel/Refund Endpoints Yet

The backend has `markOrderRefunded` and `markOrderFailed`/`markOrderCanceled` service methods, but **no HTTP endpoints** expose them yet. Refunds and cancellations are currently handled internally (via webhooks or admin operations).

### 9.8 Rate Limiting

| Endpoint | Limit |
|----------|-------|
| `GET /orders` | 20 requests / 60 seconds |
| `GET /orders/:id` | 30 requests / 60 seconds |
| `POST /payments/checkout-session` | 5 requests / 60 seconds |

### 9.9 Currency is Hardcoded

All orders are in **USD**. The `currency` field is always `"usd"`.

### 9.10 Environment Variables Required

| Variable | Description | Example |
|----------|-------------|---------|
| `STRIPE_SECRET_KEY` | Stripe secret key (server-side) | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret | `whsec_...` |
| `FRONTEND_URL` | Base URL for success/cancel redirects | `https://myapp.com` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (frontend) | `pk_test_...` |

---

## Appendix A: Complete File Structure (Frontend)

```
frontend/
├── types/
│   └── orders.ts                     # All TypeScript interfaces + enums
├── lib/
│   ├── api/
│   │   ├── client.ts                 # Axios instance (shared)
│   │   ├── orders.ts                 # Orders API functions
│   │   ├── checkout.ts               # Checkout session API function
│   │   └── orders-keys.ts            # React Query keys
│   └── api/
│       └── checkout-errors.ts        # Checkout error message helpers
├── hooks/
│   └── use-orders.ts                 # Order query + mutation hooks
├── components/
│   └── orders/
│       ├── order-history-table.tsx   # Order history list
│       ├── order-detail-card.tsx     # Single order display
│       ├── order-status-badge.tsx    # Status color badge
│       └── checkout-summary.tsx      # Checkout page summary
└── app/
    ├── checkout/
    │   └── page.tsx                  # Checkout page (redirects to Stripe)
    ├── orders/
    │   ├── page.tsx                  # Order history page
    │   ├── [id]/
    │   │   └── page.tsx              # Order detail page
    │   └── success/
    │       └── page.tsx              # Payment success page (polls for status)
    └── cart/
        └── page.tsx                  # Cart page (links to checkout)
```

---

## Appendix B: Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│  ORDERS MODULE — QUICK REFERENCE                                │
├─────────────────────────────────────────────────────────────────┤
│  Base URL:      /orders                                         │
│  Auth Type:     Cookie-based JWT (httpOnly)                     │
│  Payment SDK:   Stripe Checkout Sessions (redirect flow)        │
│  Currency:      USD only                                        │
│  Amount Format: Cents (divide by 100 for display)               │
├─────────────────────────────────────────────────────────────────┤
│  GET  /orders              → Paginated order history            │
│  GET  /orders/:id          → Single order detail                │
│  POST /payments/checkout-session → Create Stripe session        │
├─────────────────────────────────────────────────────────────────┤
│  Order Statuses:                                                │
│    awaiting_checkout_session → pending_payment → paid           │
│    pending_payment → failed/canceled/expired (terminal)         │
│    paid → refunded → partially_refunded                         │
├─────────────────────────────────────────────────────────────────┤
│  Rate Limits: 20/min (history), 30/min (detail),               │
│               5/min (checkout-session)                          │
│  Session Expiry: 20 minutes                                     │
│  Cart: Cleared automatically after successful payment           │
│  Security: Compound WHERE prevents order-existence leakage      │
│  Error Shape: { statusCode, message, timestamp, path }          │
└─────────────────────────────────────────────────────────────────┘
```
