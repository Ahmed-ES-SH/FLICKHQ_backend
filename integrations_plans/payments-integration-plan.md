# Payments Module — Frontend Integration Plan

> **Backend:** NestJS v11 · TypeORM · PostgreSQL · Stripe (PaymentIntents + Checkout Sessions)
> **Last Updated:** 2026-05-21
> **Audience:** Frontend / Full-Stack Developers

---

## Table of Contents

1. [Payments Overview](#1-payments-overview)
2. [API Endpoint Map](#2-api-endpoint-map)
3. [TypeScript Types & Interfaces](#3-typescript-types--interfaces)
4. [Payment Intent Flow (Subscriptions)](#4-payment-intent-flow-subscriptions)
5. [Checkout Session Flow (E-commerce)](#5-checkout-session-flow-e-commerce)
6. [API Client Setup](#6-api-client-setup)
7. [React Query Hooks](#7-react-query-hooks)
8. [Error Handling & Validation Mapping](#8-error-handling--validation-mapping)
9. [Example Usage (Next.js / React)](#9-example-usage-nextjs--react)
10. [Webhook Architecture](#10-webhook-architecture)
11. [Gotchas & Edge Cases](#11-gotchas--edge-cases)

---

## 1. Payments Overview

### 1.1 How Payments Work

This backend supports **two payment flows**:

#### Flow A: Stripe PaymentIntents (Premium Subscriptions)
- The frontend requests a **PaymentIntent** from the backend with a `productType` (`premium_monthly` or `premium_yearly`).
- The backend **validates the price server-side** — the client never sends an amount. Prices are defined in `src/config/pricing.config.ts`.
- The backend creates a Stripe PaymentIntent and returns a `clientSecret` for the frontend to use with **Stripe Elements**.
- The frontend confirms the payment using `stripe.confirmCardPayment(clientSecret, ...)`.
- Stripe sends a webhook to the backend (`POST /payments/webhook`) when the payment succeeds or fails.
- The backend updates the payment record, activates `isPremium` on the user, and emits a real-time notification via Pusher.

#### Flow B: Stripe Checkout Sessions (E-commerce Orders)
- The frontend calls `POST /payments/checkout-session` to create a Stripe Checkout Session from the user's cart.
- The backend validates the cart, creates an **Order**, creates a Stripe Checkout Session, and marks the order `PENDING_PAYMENT`.
- The backend returns a `checkoutUrl` — the frontend redirects the user to this Stripe-hosted page.
- After payment, Stripe sends a `checkout.session.completed` webhook.
- The backend marks the order as `PAID`, creates/updates the Payment record, and clears the user's cart.
- Stripe redirects the user to the `successUrl`.

> **See [Orders Integration Plan](./orders-integration-plan.md) for the full e-commerce order lifecycle.**

### 1.2 Pricing (Server-Side Only)

| Product Type | Amount (cents) | USD Price | Description |
|-------------|---------------|-----------|-------------|
| `premium_monthly` | 999 | $9.99 | Premium Monthly Subscription |
| `premium_yearly` | 7999 | $79.99 | Premium Yearly Subscription |

> **IMPORTANT:** The frontend must **never** display or send amounts. The backend determines all pricing. If the frontend needs to show prices, it should call a dedicated pricing endpoint or hardcode the same values (with a disclaimer that the backend is authoritative).

### 1.3 Payment Statuses

| Status | Description |
|--------|-------------|
| `pending` | PaymentIntent created, awaiting customer payment |
| `succeeded` | Payment confirmed and premium activated |
| `failed` | Payment declined or errored |
| `refunded` | Payment was refunded (premium revoked) |
| `expired` | Payment timed out (stale pending > 1 hour) |

### 1.4 Idempotency

The backend generates an idempotency key from `userId + productType + date`. If the user tries to create a second payment for the same product on the same day while the first is still `pending`, the backend returns the existing PaymentIntent instead of creating a duplicate.

---

## 2. API Endpoint Map

### 2.1 Protected Endpoints (JWT cookie required)

| Method | Path | Description | Request Body | Success Response | Error Codes | Rate Limit |
|--------|------|-------------|-------------|------------------|-------------|------------|
| `POST` | `/payments/intent` | Create a Stripe PaymentIntent (subscriptions) | [`CreatePaymentIntentDto`](#createpaymentintentdto) | [`PaymentIntentResponse`](#paymentintentresponse) | `400`, `401`, `429` | 5 / 60s |
| `POST` | `/payments/checkout-session` | Create Stripe Checkout Session from cart (e-commerce) | [`CreateCheckoutSessionDto`](#createcheckoutsessiondto) | [`CheckoutSessionResponse`](#checkoutsessionresponse) | `400`, `401`, `429` | 5 / 60s |
| `GET` | `/payments/history` | Get user's payment history | Query: `?page=1&limit=20` | [`PaymentHistoryResponse`](#paymenthistoryresponse) | `401` | Default |

### 2.2 Public Endpoints (No auth required)

| Method | Path | Description | Request Body | Success Response | Error Codes |
|--------|------|-------------|-------------|------------------|-------------|
| `POST` | `/payments/webhook` | Stripe webhook handler (internal) | Raw Stripe event + `stripe-signature` header | `{ received: true }` | `400`, `500` |

> The webhook endpoint is called by Stripe, not the frontend. It is documented here for completeness.

---

## 3. TypeScript Types & Interfaces

### 3.1 Request DTOs

```typescript
// ─── Create Payment Intent (Subscriptions) ──────────────────────────────
export interface CreatePaymentIntentDto {
  productType: 'premium_monthly' | 'premium_yearly';
  description?: string;  // optional, max 500 chars
}

// ─── Create Checkout Session (E-commerce) ───────────────────────────────
export interface CreateCheckoutSessionDto {
  successUrl?: string;  // Optional: custom success redirect URL
  cancelUrl?: string;   // Optional: custom cancel redirect URL
}
```

### 3.2 Response Types

```typescript
// ─── New Payment Intent Response ────────────────────────────────────────
export interface NewPaymentIntentResponse {
  isExisting: false;
  clientSecret: string;    // Use with stripe.confirmCardPayment()
  paymentIntentId: string; // Stripe PI identifier
  amount: number;          // Amount in cents (e.g., 999 = $9.99)
  currency: string;        // Always "usd"
}

// ─── Existing Payment Intent Response (idempotency hit) ─────────────────
export interface ExistingPaymentIntentResponse {
  isExisting: true;
  paymentIntentId: string;
  amount: number;
  currency: string;
}

// ─── Union type for createPaymentIntent response ────────────────────────
export type PaymentIntentResponse =
  | NewPaymentIntentResponse
  | ExistingPaymentIntentResponse;

// ─── Payment History Response ───────────────────────────────────────────
export interface PaymentHistoryResponse {
  data: Payment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── Payment Entity ─────────────────────────────────────────────────────
export interface Payment {
  id: string;                         // UUID
  userId: string;                     // User ID (stringified number)
  stripePaymentIntent: string;        // Stripe PI ID (e.g., "pi_...")
  stripeChargeId: string | null;      // Stripe charge ID (e.g., "ch_...")
  amount: number;                     // Amount in cents
  currency: string;                   // "usd"
  status: PaymentStatus;              // See PaymentStatus enum
  description?: string;
  metadata: Record<string, unknown>;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Payment Status Enum ────────────────────────────────────────────────
export enum PaymentStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  EXPIRED = 'expired',
}

// ─── Checkout Session Response ──────────────────────────────────────────
export interface CheckoutSessionResponse {
  checkoutUrl: string;   // Stripe-hosted checkout page URL (redirect here)
  orderId: string;       // Order UUID (for tracking/fetching order detail)
  sessionId: string;     // Stripe session ID (cs_...)
  expiresAt: Date;       // When the session expires (20 min from creation)
}
```

### 3.3 Stripe Payment Status Payload (Real-time via Pusher)

```typescript
// ─── PaymentStatusPayload ───────────────────────────────────────────────
export interface PaymentStatusPayload {
  status: 'succeeded' | 'failed' | 'refunded';
  amount: number;       // Amount in cents
  description: string;
  eventId: string;      // Auto-generated unique event ID
  timestamp: string;    // ISO 8601 timestamp
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

## 4. Payment Intent Flow (Subscriptions)

### 4.1 Complete Payment Flow Diagram

```
┌──────────┐                              ┌──────────┐                    ┌──────────┐
│  Client  │                              │  Backend │                    │  Stripe  │
│          │  POST /payments/intent       │          │                    │          │
│          │  { productType }             │          │                    │          │
│          │ ───────────────────────────► │          │                    │          │
│          │                              │  Validate│                    │          │
│          │                              │  price   │                    │          │
│          │                              │  server- │                    │          │
│          │                              │  side    │                    │          │
│          │                              │          │                    │          │
│          │                              │          │  Create PI         │          │
│          │                              │          │ ─────────────────► │          │
│          │                              │          │ ◄───────────────── │          │
│          │                              │          │  { clientSecret }  │          │
│          │  { isExisting, clientSecret, │          │                    │          │
│          │    paymentIntentId, ... }    │          │                    │          │
│          │ ◄─────────────────────────── │          │                    │          │
│          │                              │          │                    │          │
│          │  stripe.confirmCardPayment(  │          │                    │          │
│          │    clientSecret, { ... }     │          │                    │          │
│          │  )                           │          │                    │          │
│          │ ───────────────────────────────────────────────────────────► │          │
│          │                              │          │                    │          │
│          │  { paymentIntent, error }    │          │                    │          │
│          │ ◄─────────────────────────────────────────────────────────── │          │
│          │                              │          │                    │          │
│          │                              │  Webhook │                    │          │
│          │                              │(internal)│ ◄───────────────── │          │
│          │                              │          │  payment_intent.   │          │
│          │                              │          │  succeeded/failed  │          │
│          │                              │          │                    │          │
│          │  Pusher event:               │          │                    │          │
│          │  payment_status              │          │                    │          │
│          │ ◄─────────────────────────── │          │                    │          │
└──────────┘                              └──────────┘                    └──────────┘
```

### 4.2 Step-by-Step Flow

```
1. User selects subscription plan (monthly or yearly)
2. Frontend calls: POST /payments/intent { productType: 'premium_monthly' }
3. Backend validates productType, looks up server-side price
4. Backend creates Stripe PaymentIntent and persists a local payment record
5. Backend returns { isExisting: false, clientSecret, paymentIntentId, amount, currency }
   OR { isExisting: true, paymentIntentId, amount, currency } (if duplicate request)
6. Frontend uses Stripe.js to confirm payment:
   const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
     payment_method: { card: cardElement, billing_details: { ... } }
   });
7. If error: show error to user
8. If success: Stripe sends webhook to backend automatically
9. Backend receives webhook, updates payment status to 'succeeded', sets user.isPremium = true
10. Backend emits real-time notification via Pusher to the user
11. Frontend receives Pusher event and updates UI (show "Premium Active" badge)
```

### 4.3 Idempotency Flow

```
1. User clicks "Subscribe" twice quickly
2. First request creates PaymentIntent → returns { isExisting: false, clientSecret: "pi_xxx_secret" }
3. Second request (same day, same product) → returns { isExisting: true, paymentIntentId: "pi_xxx" }
4. Frontend checks isExisting:
    - If false: call stripe.confirmCardPayment(clientSecret)
    - If true: the payment is already in progress, wait for webhook/Pusher event
```

---

## 5. Checkout Session Flow (E-commerce)

### 5.1 Complete Checkout Session Flow Diagram

```
┌──────────┐                              ┌──────────┐                    ┌──────────┐
│  Client  │                              │  Backend │                    │  Stripe  │
│          │  POST /payments/             │          │                    │          │
│          │  checkout-session            │          │                    │          │
│          │  { successUrl?, cancelUrl? } │          │                    │          │
│          │ ───────────────────────────► │          │                    │          │
│          │                              │  Validate│                    │          │
│          │                              │  cart    │                    │          │
│          │                              │          │                    │          │
│          │                              │  Create  │                    │          │
│          │                              │  Order   │                    │          │
│          │                              │          │                    │          │
│          │                              │  Create  │                    │          │
│          │                              │  Session │                    │          │
│          │                              │ ───────────────────────────► │          │
│          │                              │          │ ◄───────────────── │          │
│          │                              │          │  { id, url }       │          │
│          │                              │          │                    │          │
│          │  { checkoutUrl, orderId,     │          │                    │          │
│          │    sessionId, expiresAt }    │          │                    │          │
│          │ ◄─────────────────────────── │          │                    │          │
│          │                              │          │                    │          │
│          │  Redirect to checkoutUrl     │          │                    │          │
│          │ ───────────────────────────────────────────────────────────► │          │
│          │                              │          │                    │          │
│          │  User completes payment      │          │                    │          │
│          │                              │          │                    │          │
│          │                              │  Webhook │                    │          │
│          │                              │(internal)│ ◄───────────────── │          │
│          │                              │          │  checkout.session  │          │
│          │                              │          │  .completed        │          │
│          │                              │          │                    │          │
│          │  Redirect to successUrl      │          │                    │          │
│          │ ◄─────────────────────────── │          │                    │          │
│          │                              │          │                    │          │
│          │  GET /orders/:orderId        │          │                    │          │
│          │ ───────────────────────────► │          │                    │          │
│          │  { status: "paid", ... }     │          │                    │          │
│          │ ◄─────────────────────────── │          │                    │          │
└──────────┘                              └──────────┘                    └──────────┘
```

### 5.2 Step-by-Step Flow

```
1. User reviews cart and clicks "Checkout"
2. Frontend calls: POST /payments/checkout-session { successUrl?, cancelUrl? }
3. Backend validates cart (items exist, stock available, not empty)
4. Backend creates Order with status AWAITING_CHECKOUT_SESSION
5. Backend creates Stripe Checkout Session with cart line items
6. Backend marks Order as PENDING_PAYMENT (same atomic transaction)
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
18. Frontend can fetch order detail: GET /orders/:orderId
```

### 5.3 Default Redirect URLs

If `successUrl` or `cancelUrl` are not provided, the backend uses:
- **Success:** `{FRONTEND_URL}/orders/success` (or `http://localhost:3000/orders/success`)
- **Cancel:** `{FRONTEND_URL}/cart` (or `http://localhost:3000/cart`)

### 5.4 Session Expiration

Stripe Checkout Sessions expire after **20 minutes**. The `expiresAt` field in the response indicates when the session expires. If the user doesn't complete payment by then, the order remains in `PENDING_PAYMENT` until a cron job marks it as `EXPIRED`.

### 5.5 Cart Validation Errors

If the cart is invalid when creating a checkout session, the backend returns `400 Bad Request`:

| Error Message | Trigger |
|--------------|---------|
| `"Cart is empty. Add items before checkout."` | User has no cart items |
| `"Product not available: {name}"` | Product was deleted or unpublished |
| `"Insufficient stock for: {name}"` | Product stock < requested quantity |

---

## 6. API Client Setup

### 6.1 Payments API Functions

```typescript
// lib/api/payments.ts
import api from './client';  // Assumes axios instance with withCredentials: true
import type {
  CreatePaymentIntentDto,
  CreateCheckoutSessionDto,
  PaymentIntentResponse,
  CheckoutSessionResponse,
  PaymentHistoryResponse,
} from '@/types/payments';

/**
 * Create a Stripe PaymentIntent for a subscription purchase.
 * Returns clientSecret for use with stripe.confirmCardPayment().
 */
export async function createPaymentIntent(
  dto: CreatePaymentIntentDto,
): Promise<PaymentIntentResponse> {
  const { data } = await api.post<PaymentIntentResponse>(
    '/payments/intent',
    dto,
  );
  return data;
}

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

/**
 * Get paginated payment history for the authenticated user.
 */
export async function getPaymentHistory(
  page = 1,
  limit = 20,
): Promise<PaymentHistoryResponse> {
  const { data } = await api.get<PaymentHistoryResponse>('/payments/history', {
    params: { page, limit },
  });
  return data;
}
```

### 6.2 Stripe.js Setup

```typescript
// lib/stripe/stripe.ts
import { loadStripe } from '@stripe/stripe-js';

// Load Stripe with your publishable key
export const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);
```

---

## 7. React Query Hooks

### 7.1 Query Keys Factory

```typescript
// lib/api/payments-keys.ts
export const paymentsKeys = {
  all: ['payments'] as const,
  history: () => [...paymentsKeys.all, 'history'] as const,
  historyPage: (page: number, limit: number) =>
    [...paymentsKeys.history(), { page, limit }] as const,
};
```

### 7.2 Payment Hooks

```typescript
// hooks/use-payments.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { paymentsKeys } from '@/lib/api/payments-keys';
import {
  createPaymentIntent,
  createCheckoutSession,
  getPaymentHistory,
} from '@/lib/api/payments';
import type { CreatePaymentIntentDto, CreateCheckoutSessionDto } from '@/types/payments';

// ─── Payment History Query ──────────────────────────────────────────────

export function usePaymentHistory(page = 1, limit = 20) {
  return useQuery({
    queryKey: paymentsKeys.historyPage(page, limit),
    queryFn: () => getPaymentHistory(page, limit),
    staleTime: 30_000, // 30 seconds
  });
}

// ─── Create Payment Intent Mutation (Subscriptions) ─────────────────────

export function useCreatePaymentIntent() {
  return useMutation({
    mutationFn: createPaymentIntent,
  });
}

// ─── Create Checkout Session Mutation (E-commerce) ──────────────────────

export function useCreateCheckoutSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createCheckoutSession,
    onSuccess: () => {
      // Invalidate cart after checkout session is created
      // (cart will be cleared after payment completes)
      qc.invalidateQueries({ queryKey: ['cart'] });
    },
  });
}
```

---

## 8. Error Handling & Validation Mapping

### 8.1 HTTP Status Codes & Meanings

| Status | When | Frontend Action |
|--------|------|-----------------|
| `400` | Invalid product type, user not found, cart invalid, Stripe error | Show inline error or toast |
| `401` | Missing/expired JWT cookie | Redirect to login page |
| `429` | Rate limit exceeded (5 requests / 60s on `/payments/intent` or `/payments/checkout-session`) | Show "too many attempts" message, disable button |
| `500` | Server error, webhook secret not configured | Show generic error toast |

### 8.2 Known Backend Error Messages

| Endpoint | Error Message | Trigger |
|----------|--------------|---------|
| `POST /payments/intent` | `"Invalid product type"` | productType not in allowed list |
| `POST /payments/intent` | `"Invalid user ID"` | User ID is not a valid number |
| `POST /payments/intent` | `"User not found"` | User doesn't exist in database |
| `POST /payments/intent` | `"Failed to create payment intent"` | Internal server error |
| `POST /payments/intent` | _(Stripe error message)_ | Stripe API error (e.g., "Card declined") |
| `POST /payments/checkout-session` | `"Cart is empty. Add items before checkout."` | User has no cart items |
| `POST /payments/checkout-session` | `"Product not available: {name}"` | Product was deleted or unpublished |
| `POST /payments/checkout-session` | `"Insufficient stock for: {name}"` | Product stock < requested quantity |
| `POST /payments/checkout-session` | `"Failed to create checkout session"` | Stripe API error |
| `POST /payments/webhook` | `"Invalid webhook signature"` | Webhook signature verification failed |
| `POST /payments/webhook` | `"STRIPE_WEBHOOK_SECRET is not configured"` | Missing env variable |

### 8.3 Stripe.js Error Handling

```typescript
// lib/stripe/error-utils.ts
import type { StripeError } from '@stripe/stripe-js';

export function getStripeErrorMessage(error: StripeError): string {
  switch (error.type) {
    case 'card_error':
      return error.message ?? 'Your card was declined. Please try again.';
    case 'validation_error':
      return error.message ?? 'Please check your card details.';
    case 'api_error':
      return 'A temporary error occurred. Please try again later.';
    case 'rate_limit_error':
      return 'Too many requests. Please wait a moment and try again.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
}
```

---

## 9. Example Usage (Next.js / React)

### 9.1 Subscription Checkout Page

```typescript
// app/subscribe/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreatePaymentIntent } from '@/hooks/use-payments';
import { stripePromise } from '@/lib/stripe/stripe';
import { getStripeErrorMessage } from '@/lib/stripe/error-utils';
import type { CreatePaymentIntentDto } from '@/types/payments';

const PLANS = [
  { type: 'premium_monthly' as const, label: 'Monthly', price: '$9.99/mo' },
  { type: 'premium_yearly' as const, label: 'Yearly', price: '$79.99/yr' },
];

export default function SubscribePage() {
  const router = useRouter();
  const createIntent = useCreatePaymentIntent();
  const [selectedPlan, setSelectedPlan] = useState<'premium_monthly' | 'premium_yearly'>('premium_monthly');
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleSubscribe = async () => {
    setError(null);
    setProcessing(true);

    try {
      const dto: CreatePaymentIntentDto = { productType: selectedPlan };
      const response = await createIntent.mutateAsync(dto);

      if (response.isExisting) {
        // Payment already in progress — wait for webhook/Pusher event
        setError('A payment for this plan is already in progress. Please wait.');
        setProcessing(false);
        return;
      }

      const stripe = await stripePromise;
      if (!stripe) {
        setError('Failed to initialize Stripe. Please refresh and try again.');
        setProcessing(false);
        return;
      }

      const { error: stripeError } = await stripe.confirmCardPayment(
        response.clientSecret,
        {
          payment_method: {
            // Assuming you have a CardElement mounted
            // In practice, you'd pass the card element reference
          },
        },
      );

      if (stripeError) {
        setError(getStripeErrorMessage(stripeError));
        setProcessing(false);
        return;
      }

      // Payment succeeded — redirect to success page
      // The backend will have already activated premium via webhook
      router.push('/subscribe/success');
    } catch (err: unknown) {
      const apiError = err as { statusCode: number; message: string };
      if (apiError.statusCode === 429) {
        setError('Too many attempts. Please wait a moment and try again.');
      } else {
        setError(apiError.message ?? 'Failed to process payment. Please try again.');
      }
      setProcessing(false);
    }
  };

  return (
    <div>
      <h1>Upgrade to Premium</h1>

      <div>
        {PLANS.map((plan) => (
          <button
            key={plan.type}
            onClick={() => setSelectedPlan(plan.type)}
            className={selectedPlan === plan.type ? 'selected' : ''}
          >
            {plan.label} — {plan.price}
          </button>
        ))}
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <button
        onClick={handleSubscribe}
        disabled={processing || createIntent.isPending}
      >
        {processing || createIntent.isPending ? 'Processing...' : 'Subscribe'}
      </button>
    </div>
  );
}
```

### 9.2 Payment History Page

```typescript
// app/settings/payments/page.tsx
'use client';

import { usePaymentHistory } from '@/hooks/use-payments';
import { PaymentStatus } from '@/types/payments';

const STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pending',
  succeeded: 'Successful',
  failed: 'Failed',
  refunded: 'Refunded',
  expired: 'Expired',
};

const STATUS_COLORS: Record<PaymentStatus, string> = {
  pending: 'yellow',
  succeeded: 'green',
  failed: 'red',
  refunded: 'gray',
  expired: 'orange',
};

export default function PaymentHistoryPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = usePaymentHistory(page, 20);

  if (isLoading) return <div>Loading payment history...</div>;
  if (error) return <div>Failed to load payment history.</div>;
  if (!data || data.total === 0) return <div>No payments found.</div>;

  return (
    <div>
      <h1>Payment History</h1>

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((payment) => (
            <tr key={payment.id}>
              <td>{new Date(payment.createdAt).toLocaleDateString()}</td>
              <td>{payment.description || '—'}</td>
              <td>${(payment.amount / 100).toFixed(2)}</td>
              <td>
                <Badge color={STATUS_COLORS[payment.status]}>
                  {STATUS_LABELS[payment.status]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.totalPages > 1 && (
        <div>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>Page {page} of {data.totalPages}</span>
          <button disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
```

### 9.3 Real-time Payment Status Listener (Pusher)

```typescript
// hooks/use-payment-status.ts
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Pusher from 'pusher-js';
import { useQueryClient } from '@tanstack/react-query';
import { paymentsKeys } from '@/lib/api/payments-keys';

export function usePaymentStatusListener() {
  const router = useRouter();
  const qc = useQueryClient();
  const pusherRef = useRef<Pusher | null>(null);

  useEffect(() => {
    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
    });
    pusherRef.current = pusher;

    // Channel name matches user ID — backend emits to private channel
    const channel = pusher.subscribe(`private-user-${userId}`);

    channel.bind('payment_status', (payload: {
      status: 'succeeded' | 'failed' | 'refunded';
      amount: number;
      description: string;
    }) => {
      if (payload.status === 'succeeded') {
        // Premium activated — invalidate queries and redirect
        qc.invalidateQueries({ queryKey: paymentsKeys.all });
        router.push('/subscribe/success');
      } else if (payload.status === 'failed') {
        // Show failure toast
        toast.error(`Payment failed: ${payload.description}`);
      } else if (payload.status === 'refunded') {
        toast.info('Your payment has been refunded.');
        qc.invalidateQueries({ queryKey: paymentsKeys.all });
      }
    });

    return () => {
      channel.unbind_all();
      channel.unsubscribe();
      pusher.disconnect();
    };
  }, [qc, router]);
}
```

---

## 10. Webhook Architecture

### 10.1 Webhook Flow (Backend Internal)

The webhook endpoint is **not called by the frontend**. It is called by Stripe's servers when payment events occur.

```
Stripe Servers
     │
     │ POST /payments/webhook
     │ Headers: stripe-signature: sig_...
     │ Body: raw Stripe event JSON
     ▼
Backend
     │
     ├─ 1. Verify signature using STRIPE_WEBHOOK_SECRET
     ├─ 2. Parse event type
     ├─ 3. Handle event:
     │    ├─ payment_intent.succeeded  → Update payment, activate premium, emit Pusher event
     │    ├─ payment_intent.payment_failed → Mark payment failed, emit Pusher event
     │    └─ charge.refunded → Mark payment refunded, revoke premium, emit Pusher event
     └─ 4. Return { received: true }
```

### 10.2 Events Handled

| Stripe Event | Backend Action | User Notification |
|-------------|---------------|-------------------|
| `payment_intent.succeeded` | Set payment status to `succeeded`, set `user.isPremium = true` | Pusher: `payment_status` with `status: "succeeded"` |
| `payment_intent.payment_failed` | Set payment status to `failed` with reason | Pusher: `payment_status` with `status: "failed"` |
| `charge.refunded` | Set payment status to `refunded`, set `user.isPremium = false` | Pusher: `payment_status` with `status: "refunded"` |
| `checkout.session.completed` | Create/update Payment, mark Order `PAID`, clear cart | Pusher: `payment_status` with `status: "succeeded"` |

### 10.3 Webhook Security

- The webhook endpoint verifies the `stripe-signature` header using the `STRIPE_WEBHOOK_SECRET`.
- If the signature is invalid, the request is rejected with `400 Bad Request`.
- The `rawBody` of the request must be available (set by body-parser `verify` middleware). Without it, the endpoint returns `500`.

---

## 11. Gotchas & Edge Cases

### 11.1 `isExisting` Response Handling

When the backend returns `isExisting: true`, the `clientSecret` field is **not present**. The frontend must check `isExisting` before accessing `clientSecret`:

```typescript
const response = await createPaymentIntent(dto);

if (response.isExisting) {
  // No clientSecret — payment already in progress
  // Wait for webhook/Pusher event or poll payment status
  return;
}

// Safe to access clientSecret
const { error } = await stripe.confirmCardPayment(response.clientSecret, ...);
```

### 11.2 Rate Limiting

The `/payments/intent` endpoint is rate-limited to **5 requests per 60 seconds**. This is more generous than the original 2/5s limit to accommodate legitimate retries. If the user hits the limit, show a friendly message and disable the subscribe button temporarily.

### 11.3 Stripe Elements Required

The frontend must use **Stripe Elements** (CardElement, PaymentElement, etc.) to collect card details. Never collect raw card numbers — this violates PCI compliance.

```typescript
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

function CheckoutForm() {
  const stripe = useStripe();
  const elements = useElements();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    const cardElement = elements.getElement(CardElement)!;
    // ... confirm payment
  };

  return (
    <form onSubmit={handleSubmit}>
      <CardElement />
      <button type="submit" disabled={!stripe}>Pay</button>
    </form>
  );
}
```

### 11.4 Webhook Delivery Timing

Stripe webhooks are delivered **asynchronously**. After `stripe.confirmCardPayment()` succeeds on the frontend, there may be a 1-5 second delay before the webhook arrives at the backend and the Pusher event reaches the frontend. The frontend should:

1. Show a "Processing payment..." state after confirmCardPayment succeeds
2. Listen for the Pusher `payment_status` event to transition to the final state
3. Have a fallback polling mechanism in case the Pusher event is missed

### 11.5 Currency

All payments are in **USD**. The frontend should display prices with the `$` symbol.

### 11.6 Amount Formatting

Backend amounts are in **cents** (Stripe format). Always divide by 100 for display:

```typescript
const displayAmount = (payment.amount / 100).toFixed(2); // "9.99"
```

### 11.7 Premium Activation is Webhook-Driven

The frontend should **not** assume premium is activated immediately after `confirmCardPayment` succeeds. The activation happens when the backend processes the webhook. Use the Pusher event as the source of truth for premium status changes.

### 11.8 Replay Attack Prevention

The backend does **not** activate premium based solely on webhook metadata. A matching local payment record must exist. This prevents attackers from crafting fake webhook events to grant themselves free premium access.

### 11.9 Stale Payment Reconciliation

The backend has a cron job (via JobsService) that reconciles stale pending payments older than 1 hour. If a payment is stuck in `pending` for too long, it will be checked against Stripe and either marked `succeeded` or `failed` automatically.

### 11.10 Environment Variables Required

| Variable | Description | Example |
|----------|-------------|---------|
| `STRIPE_SECRET_KEY` | Stripe secret key (server-side) | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret | `whsec_...` |
| `FRONTEND_URL` | Base URL for checkout redirect fallbacks | `https://myapp.com` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (frontend) | `pk_test_...` |
| `NEXT_PUBLIC_PUSHER_KEY` | Pusher key for real-time events | `abc123...` |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | Pusher cluster region | `us2` |

### 11.11 Checkout Session vs PaymentIntent

Use **PaymentIntent** for subscriptions (recurring, in-page card collection via Stripe Elements).
Use **Checkout Session** for e-commerce orders (one-time, Stripe-hosted checkout page with redirect).

### 11.12 Cart is Cleared After Checkout Session Payment

After a successful `checkout.session.completed` webhook, the backend clears the user's cart. The `clearCart` operation is **idempotent** — it returns silently if the cart is already empty. The frontend should invalidate the cart query after a successful payment.

### 11.13 Checkout Session Expires in 20 Minutes

Stripe Checkout Sessions expire after 20 minutes. The order's `reservationExpiresAt` field indicates when the pending reservation expires. If the user doesn't complete payment by then, the order remains in `PENDING_PAYMENT` until a cron job marks it as `EXPIRED`.

### 11.14 Order ID in Checkout Session Response

The `orderId` field in the `CheckoutSessionResponse` can be used to fetch the order detail after payment completes: `GET /orders/{orderId}`. This is useful for the success page to show order confirmation.

---

## Appendix A: Complete File Structure (Frontend)

```
frontend/
├── types/
│   └── payments.ts                   # All TypeScript interfaces + enums
├── lib/
│   ├── api/
│   │   ├── client.ts                 # Axios instance with withCredentials
│   │   ├── payments.ts               # Payments API functions (intent + checkout)
│   │   └── payments-keys.ts          # React Query keys
│   └── stripe/
│       ├── stripe.ts                 # Stripe.js initialization
│       └── error-utils.ts            # Stripe error message helpers
├── hooks/
│   ├── use-payments.ts               # Payment-related React Query hooks
│   └── use-payment-status.ts         # Pusher real-time listener
├── components/
│   └── Payments/
│       ├── CheckoutForm.tsx          # Stripe Elements form (subscriptions)
│       ├── PlanSelector.tsx          # Monthly/yearly plan selection
│       ├── CheckoutButton.tsx        # E-commerce checkout button
│       └── PaymentHistoryTable.tsx   # Payment history display
└── app/
    ├── subscribe/
    │   ├── page.tsx                  # Subscription checkout page
    │   └── success/
    │       └── page.tsx              # Payment success page
    ├── checkout/
    │   └── page.tsx                  # E-commerce checkout (redirects to Stripe)
    └── settings/
        └── payments/
            └── page.tsx              # Payment history page
```

---

## Appendix B: Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│  PAYMENTS MODULE — QUICK REFERENCE                              │
├─────────────────────────────────────────────────────────────────┤
│  Base URL:      /payments                                       │
│  Auth Type:     Cookie-based JWT (httpOnly)                     │
│  Payment SDK:   Stripe.js (PaymentIntents + Checkout Sessions)  │
│  Real-time:     Pusher (payment_status events)                  │
│  Currency:      USD only                                        │
│  Amount Format: Cents (divide by 100 for display)               │
├─────────────────────────────────────────────────────────────────┤
│  POST /payments/intent             → { isExisting, clientSecret }│
│  POST /payments/checkout-session   → { checkoutUrl, orderId }   │
│  GET  /payments/history            → { data, total, page, ... } │
│  POST /payments/webhook            → { received: true } (Stripe)│
├─────────────────────────────────────────────────────────────────┤
│  Pricing (server-side):                                         │
│    premium_monthly  = $9.99  (999 cents)                        │
│    premium_yearly   = $79.99 (7999 cents)                       │
├─────────────────────────────────────────────────────────────────┤
│  Payment Statuses: pending, succeeded, failed, refunded, expired│
│  Rate Limit: 5 req/60s on /payments/intent & /checkout-session  │
│  Idempotency: 1 payment per product per day per user            │
│  Webhook Events: payment_intent.succeeded/failed,               │
│                  charge.refunded, checkout.session.completed     │
│  Session Expiry: 20 minutes (Checkout Sessions only)            │
│  Error Shape: { statusCode, message, timestamp, path }          │
└─────────────────────────────────────────────────────────────────┘
```
