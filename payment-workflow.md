# Payment Workflow — FlickHQ Frontend

> Full documentation of the payment/subscription/billing flow with all backend API endpoints called from the frontend.

---

## 1. Plan Discovery (Browsing)

**Trigger:** User visits `/pricing` or `/`.

| Step | Action | File | Endpoint |
|------|--------|------|----------|
| 1.1 | Fetch all active plans with prices | `app/_actions/plans.ts:56` | `GET /api/plans` |
| 1.2 | Resolve active price for billing cycle (monthly/annual) | `app/_helpers/pricing/pricing.ts:33` | _(client-side logic — no API call)_ |

**Frontend Hook:** `fetchPlansAction()` — calls `API_ENDPOINTS.PLANS.list`.

**Response shape:** `PaginatedPlansActionResult<PlanResponseDto[]>` — each plan contains `prices[]` with `stripePriceId`, `unitAmount`, `interval`, etc.

---

## 2. Initiating Checkout (Subscribe Button)

**Trigger:** User clicks "Get Started" / "Go Premium" on a pricing card.

| Step | Action | File | Endpoint |
|------|--------|------|----------|
| 2.1 | Redirect to `/checkout?priceId=xxx&isRecurring=true` | `app/_components/_website/_pricing/SubscribeButton.tsx:65` | _(client-side navigation — no API)_ |

**Flow:** `SubscribeButton` builds a URL with `priceId` and `isRecurring` params and calls `router.push("/checkout?...")`.

---

## 3. Checkout Page Load (Embedded Elements Checkout)

**Trigger:** User lands on `/checkout?priceId=xxx`.

| Step | Action | File | Endpoint |
|------|--------|------|----------|
| 3.1 | Validate `priceId` exists in query params | `app/_components/_checkout/CheckoutContent.tsx:127` | _(client-side — no API)_ |
| 3.2 | Fetch plans + ensure billing customer (parallel) | `app/_components/_checkout/CheckoutContent.tsx:65-66` | `GET /api/plans` |
| 3.3 | | | `GET /api/billing/customer` |
| 3.4 | Find matching plan + price by `priceId` | `app/_components/_checkout/CheckoutContent.tsx:83` | _(client-side — no API)_ |
| 3.5 | Create Elements checkout session (PaymentIntent) | `app/_components/_checkout/CheckoutContent.tsx:94` | `POST /api/billing/checkout/embedded-elements` |
| 3.6 | Initialize Stripe.js with publishable key | `app/_helpers/checkout/stripe.ts:12` | _(Stripe.js CDN — no backend API)_ |
| 3.7 | Mount `<Elements>` wrapper with `clientSecret` | `app/_components/_checkout/CheckoutContent.tsx:182` | _(client-side — no API)_ |

**Server Action:** `createElementsCheckoutSessionAction()` in `app/_actions/checkout.ts:30`.

**Request body:** `{ priceId, idempotencyKey?, quantity?, trialDays?, allowPromotionCodes? }`

**Response shape:** `{ clientSecret: "pi_xxx_secret_xxx", sessionId?: "cs_xxx" }`

---

## 4. Payment Form Submission

**Trigger:** User fills in card details and clicks "Pay Now".

| Step | Action | File | Endpoint |
|------|--------|------|----------|
| 4.1 | Store `sessionId` in `sessionStorage` | `app/_components/_checkout/CustomCheckoutForm.tsx:56` | _(client-side — no API)_ |
| 4.2 | Call `stripe.confirmPayment()` with `return_url` | `app/_components/_checkout/CustomCheckoutForm.tsx:64` | **Stripe API** (direct from browser) |
| 4.3 | On success → Stripe redirects to `/checkout/success?session_id=cs_xxx&payment_intent=pi_xxx` | — | Stripe redirect |

**Key:** Payment is processed directly by Stripe.js — the frontend never touches raw card data. The `return_url` is set to `window.location.origin + "/checkout/success"`.

---

## 5. Checkout Success Polling

**Trigger:** User lands on `/checkout/success?session_id=cs_xxx` after Stripe redirect.

| Step | Action | File | Endpoint |
|------|--------|------|----------|
| 5.1 | Recover `session_id` from URL params or `sessionStorage` | `app/hooks/checkout/useCheckoutSuccess.ts:48-61` | _(client-side — no API)_ |
| 5.2 | Poll `fetchCurrentSubscriptionAction()` every `POLL_INTERVAL_MS` (up to `MAX_POLL_ATTEMPTS`) | `app/hooks/checkout/useCheckoutSuccess.ts:72-102` | `GET /api/subscriptions/current` |
| 5.3 | On success → set `status = "confirmed"`, show success UI | `app/hooks/checkout/useCheckoutSuccess.ts:78-84` | — |
| 5.4 | On max attempts without subscription → show `"pending"` or `"error"` state | `app/hooks/checkout/useCheckoutSuccess.ts:87-100` | — |

**Response shape:** `PlansActionResult<UserSubscriptionHistoryItemDto | null>`

---

## 6. Subscription Management (Stripe Customer Portal)

**Trigger:** User clicks "Manage Subscription" on profile or user panel.

| Step | Action | File | Endpoint |
|------|--------|------|----------|
| 6.1 | Create a Stripe Customer Portal session | `app/_components/_profile/ManageSubscriptionButton.tsx:41` | `POST /api/billing/portal/session` |
| 6.2 | Redirect user to the returned portal URL | `app/_components/_profile/ManageSubscriptionButton.tsx:53` | Stripe-hosted portal |

**Server Action:** `createPortalSessionAction()` in `app/_actions/plans.ts:459`.

**Response shape:** `{ url: "https://billing.stripe.com/p/session_xxx" }`

---

## 7. Read Operations (Subscription/Payment History)

**Trigger:** User visits `/userpanal/subscription` or profile pages.

| Step | Action | File | Endpoint |
|------|--------|------|----------|
| 7.1 | Fetch current subscription | `app/_actions/plans.ts:99` | `GET /api/subscriptions/current` |
| 7.2 | Fetch subscription history (paginated) | `app/_actions/plans.ts:140` | `GET /api/subscriptions/history?page=&limit=` |
| 7.3 | Fetch subscription timeline (status changes) | `app/_actions/plans.ts:189` | `GET /api/subscriptions/history/:id` |
| 7.4 | Fetch payment history (paginated) | `app/_actions/plans.ts:234` | `GET /api/payments/history?page=&limit=` |
| 7.5 | Fetch payment detail | `app/_actions/plans.ts:283` | `GET /api/payments/:id` |
| 7.6 | Fetch billing customer info | `app/_actions/plans.ts:774` | `GET /api/billing/customer` |

---

## 8. Root Layout — Initial Auth + Subscription Hydration

**Trigger:** Every page load (server-side).

| Step | Action | File | Endpoint |
|------|--------|------|----------|
| 8.1 | Fetch current user + subscription | `app/layout.tsx` | `GET /api/auth/current-user` |
| 8.2 | Hydrate `useAuthStore` + `subscriptionStore` | `app/_components/_globalComponents/ClientLayout.tsx` | _(client-side — no API)_ |

The `current-user` endpoint returns `{ user, subscription }` where `subscription` includes plan info and status.

---

## 9. Route Protection (Proxy)

**Trigger:** Any navigation to protected payment routes.

| Step | Route | Protection | File |
|------|-------|-----------|------|
| 9.1 | `/checkout` | Redirect to `/signin?next=...` if unauthenticated | `proxy.ts` |
| 9.2 | `/checkout/success` | Redirect to `/signin?next=...` if unauthenticated | `proxy.ts` |
| 9.3 | `/userpanal/*` | Redirect to `/signin?next=...` if unauthenticated | `proxy.ts` |
| 9.4 | `/profile/*` | Redirect to `/signin?next=...` if unauthenticated | `proxy.ts` |

---

## Endpoint Summary

### Read Endpoints

| Method | Path | Purpose | Auth Required |
|--------|------|---------|---------------|
| `GET` | `/api/plans` | List active plans with prices | No |
| `GET` | `/api/subscriptions/current` | Current user's subscription | Yes |
| `GET` | `/api/subscriptions/history` | Paginated subscription history | Yes |
| `GET` | `/api/subscriptions/history/:id` | Subscription timeline | Yes |
| `GET` | `/api/payments/history` | Paginated payment history | Yes |
| `GET` | `/api/payments/:id` | Single payment detail | Yes |
| `GET` | `/api/billing/customer` | Current billing customer record | Yes |
| `GET` | `/api/auth/current-user` | Current user + subscription (root layout) | Yes |

### Write Endpoints

| Method | Path | Purpose | Auth Required |
|--------|------|---------|---------------|
| `POST` | `/api/billing/checkout/subscription` | Create hosted Checkout Session (recurring) | Yes |
| `POST` | `/api/billing/checkout/one-time` | Create hosted Checkout Session (one-time) | Yes |
| `POST` | `/api/billing/checkout/embedded-elements` | Create Elements PaymentIntent (embedded) | Yes |
| `POST` | `/api/billing/checkout/embedded-elements-one-time` | Create Elements PaymentIntent (one-time) | Yes |
| `POST` | `/api/billing/portal/session` | Create Stripe Customer Portal session | Yes |

### Admin Endpoints

| Method | Path | Purpose | Auth Required |
|--------|------|---------|---------------|
| `GET` | `/api/admin/plans` | List all plans (optional `?status=`) | Admin |
| `GET` | `/api/admin/plans/:id` | Plan detail with prices | Admin |
| `POST` | `/api/admin/plans` | Create plan | Admin |
| `PUT` / `PATCH` | `/api/admin/plans/:id` | Update plan | Admin |
| `POST` | `/api/admin/plans/:id/archive` | Archive plan | Admin |
| `POST` | `/api/admin/plans/:id/prices` | Add price to plan | Admin |
| `GET` | `/api/admin/plans/:id/prices` | List plan prices | Admin |
| `PATCH` | `/api/admin/plans/prices/:priceId` | Deactivate price | Admin |

---

## End-to-End Flow Diagram (Checkout)

```
User clicks "Subscribe" on /pricing
       │
       ▼
  /checkout?priceId=xxx
       │
       ├── GET  /api/plans                     (fetch plans)
       ├── GET  /api/billing/customer          (ensure customer)
       │
       ▼
  POST /api/billing/checkout/embedded-elements { priceId }
       │
       ▼
  Mount Stripe <Elements> with clientSecret
       │
       ▼
  User fills card → clicks "Pay Now"
       │
       ▼
  stripe.confirmPayment({ return_url: "/checkout/success" })
       │
       ├── On success → Stripe redirects
       │
       ▼
  /checkout/success?session_id=cs_xxx&payment_intent=pi_xxx
       │
       └── Poll GET /api/subscriptions/current until confirmed
                 │
                 ▼
           Subscription active → show success UI
```

## Key Files Reference

| File | Purpose |
|------|---------|
| `app/_actions/plans.ts` | All server actions: plans, subscriptions, payments, billing, admin |
| `app/_actions/checkout.ts` | Embedded Elements checkout server action |
| `app/_components/_checkout/CheckoutContent.tsx` | Checkout page orchestration |
| `app/_components/_checkout/CustomCheckoutForm.tsx` | Stripe PaymentElement form |
| `app/_components/_checkout/CheckoutSuccessContent.tsx` | Success page |
| `app/hooks/useCheckout.ts` | Client hook for hosted Checkout flow |
| `app/hooks/checkout/useCheckoutSuccess.ts` | Client hook for success polling |
| `app/_helpers/checkout/stripe.ts` | Stripe.js initialization |
| `app/_helpers/checkout/checkout.ts` | Checkout helper functions |
| `app/_helpers/pricing/pricing.ts` | Pricing helper functions |
| `app/constants/apis.tsx` | All endpoint definitions (`API_ENDPOINTS`) |
| `app/types/subscriptions.ts` | Type definitions for all DTOs |
| `proxy.ts` | Route protection for `/checkout`, `/profile`, `/userpanal` |
| `app/_stores/subscriptionStore.ts` | Zustand store for subscription state |
