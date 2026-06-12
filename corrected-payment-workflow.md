# Corrected Payment Workflow — FlickHQ Frontend-to-Backend

This document replaces `payment-workflow.md`. It reflects the **actual** backend implementation traced from source code, not assumptions or partial documentation.

**Key corrections vs the old document:**

| Old Document | Reality | Impact |
|---|---|---|
| `GET /api/billing/customer` called on checkout page | Backend auto-creates customer lazily on any billing endpoint — explicit call is optional but harmless | Low |
| Success page reads `session_id` from URL | **Only correct for Hosted Checkout flows.** Elements subscription flow passes `payment_intent` — never `session_id` | **High — breaks Elements subscription** |
| No `POST /api/billing/subscriptions/create` | **Mandatory** for Embedded Elements subscription flow after `confirmPayment()` | **Critical — subscription never created** |
| Flow diagram shows `?session_id=&payment_intent=` on success URL | Elements subscription redirect has only `?payment_intent=pi_xxx` | **High — wrong contract** |
| Write endpoints table missing `POST /api/billing/subscriptions/create` | Endpoint exists and is required for Elements flow | Medium |

---

## 1. Plan Discovery (Browsing)

**Trigger:** User visits `/pricing` or `/`.

| Step | Action | File | Endpoint |
|------|--------|------|----------|
| 1.1 | Fetch all active plans with prices | `app/_actions/plans.ts` | `GET /api/plans` |
| 1.2 | Resolve active price for billing cycle (monthly/annual) | Client-side logic | _(no API call)_ |

**No changes from old doc.** This section is correct.

---

## 2. Initiating Checkout (Subscribe Button)

**Trigger:** User clicks "Get Started" / "Go Premium" on a pricing card.

| Step | Action | File | Endpoint |
|------|--------|------|----------|
| 2.1 | Redirect to `/checkout?priceId=xxx&isRecurring=true` | `SubscribeButton.tsx` | _(client-side navigation)_ |

Redirect happens with the `priceId` and `isRecurring` flag. The frontend must preserve `isRecurring` to distinguish which flow to execute on the checkout page.

**No changes from old doc.** This section is correct.

---

## 3. Checkout Page Load (Embedded Elements Flow)

**Trigger:** User lands on `/checkout?priceId=xxx` with `isRecurring=true`.

| Step | Action | Endpoint | Notes |
|------|--------|----------|-------|
| 3.1 | Validate `priceId` in query params | _(client-side)_ | — |
| 3.2 | Fetch plans | `GET /api/plans` | Find matching plan + price |
| 3.3 | **Ensure billing customer** | `GET /api/billing/customer` | Creates Stripe Customer lazily if first visit |
| 3.4 | Find matching plan + price by `priceId` | _(client-side)_ | — |
| 3.5 | **Create Elements PaymentIntent** | **`POST /api/billing/checkout/embedded-elements`** | Returns `{ paymentIntentId, clientSecret }` — **no `sessionId`** |
| 3.6 | Initialize Stripe.js with publishable key | _(Stripe.js CDN)_ | — |
| 3.7 | Mount `<Elements>` wrapper with `clientSecret` | _(client-side)_ | Use `clientSecret` from step 3.5 |

**Critical difference from old doc:** The backend response for `POST /api/billing/checkout/embedded-elements` is `{ paymentIntentId: "pi_xxx", clientSecret: "pi_xxx_secret_xxx" }`. There is **no** `sessionId` field. The old doc incorrectly shows `sessionId?` in the response shape.

**Request body:**
```json
{
  "priceId": "uuid",
  "idempotencyKey": "client-generated-uuid",
  "quantity": 1,
  "trialDays": null,
  "allowPromotionCodes": false
}
```

---

## 4. Payment Form Submission — Elements Subscriptions

**Trigger:** User fills in card details and clicks "Pay Now".

This is the **Embedded Elements subscription flow** (path B in the backend architecture).

| Step | Action | Endpoint | Notes |
|------|--------|----------|-------|
| 4.1 | Store `paymentIntentId` in `sessionStorage` | _(client-side)_ | Not `sessionId` — there is no session |
| 4.2 | Call `stripe.confirmPayment({ elements, confirmParams: { return_url } })` | **Stripe API** | `return_url` must be `window.location.origin + "/checkout/success"` |
| 4.3 | On success → **Stripe redirects** to `return_url` | Stripe redirect | URL has **`?payment_intent=pi_xxx&payment_intent_client_secret=...&redirect_status=succeeded`** — no `session_id` |

**⚠️ Critical:** The redirect URL for this flow is:
```
/checkout/success?payment_intent=pi_xxx&payment_intent_client_secret=pi_xxx_secret_xxx&redirect_status=succeeded
```

There is **no** `session_id` parameter. The old doc incorrectly shows `?session_id=cs_xxx&payment_intent=pi_xxx` — that is only correct for the **one-time** Elements flow (`/checkout/embedded-elements-one-time`) or the **Hosted Checkout** flow.

---

## 5. Success Page — Elements Subscriptions

**Trigger:** User lands on `/checkout/success?payment_intent=pi_xxx&redirect_status=succeeded`.

| Step | Action | Endpoint | Notes |
|------|--------|----------|-------|
| 5.1 | **Read `paymentIntentId` from URL** | _(client-side)_ | `searchParams.get("payment_intent")` — **NOT** `searchParams.get("session_id")` |
| 5.2 | **⚠️ Mandatory: Create the Stripe subscription** | **`POST /api/billing/subscriptions/create`** | Pass `{ paymentIntentId }` + new `Idempotency-Key` |
| 5.3 | On 200 → subscription is active, show success UI | — | Response: `{ subscriptionId, status }` |
| 5.4 | Optional: Poll `GET /api/subscriptions/current` until confirmed | `GET /api/subscriptions/current` | Only needed if you want to reload state |

**Critical difference from old doc:** The old doc has **no step 5.2**. Without calling `POST /api/billing/subscriptions/create`, the subscription is **never created** — Stripe only has a `PaymentIntent`, no subscription. Polling `GET /api/subscriptions/current` will always return `null`.

**`POST /api/billing/subscriptions/create` request:**
```json
{
  "paymentIntentId": "pi_xxx"
}
```
Header: `Idempotency-Key: <new-uuid>` (must be different from the checkout creation key)

**Response:**
```json
{
  "subscriptionId": "sub_xxx",
  "status": "active"
}
```

**Polling behavior:**
- Poll `GET /api/subscriptions/current` every 2 seconds
- Max 15 attempts (30 seconds total)
- On success: subscription status is `active` or `trialing`
- On timeout: show "Subscription pending — it may take a few moments" with retry button

---

## 5b. Success Page — Hosted Checkout (Alternative Flow)

This flow is used when the frontend calls `POST /api/billing/checkout/subscription` instead of the Elements endpoint (e.g., for the `hosted_page` `uiMode`).

| Step | Action | Endpoint | Notes |
|------|--------|----------|-------|
| 5b.1 | **Read `sessionId` from URL** | _(client-side)_ | `searchParams.get("session_id")` → `cs_xxx` |
| 5b.2 | **No API call needed** | — | Webhooks handle everything asynchronously |
| 5b.3 | Poll `GET /api/subscriptions/current` until subscription appears | `GET /api/subscriptions/current` | Webhooks typically create subscription within 2-10 seconds |

**No `POST /api/billing/subscriptions/create` is needed for the Hosted Checkout flow.** The webhooks (`checkout.session.completed` + `customer.subscription.created`) create and activate the subscription.

---

## 6. One-Time Elements Flow

**Trigger:** User visits `/checkout?priceId=xxx` with `isRecurring=false` or uses the one-time endpoint.

| Step | Action | Endpoint | Notes |
|------|--------|----------|-------|
| 6.1 | Create Elements one-time checkout | `POST /api/billing/checkout/embedded-elements-one-time` | Returns `{ sessionId, clientSecret }` — **has** `sessionId` |
| 6.2 | Mount `<Elements>` with `clientSecret` | _(client-side)_ | — |
| 6.3 | `stripe.confirmPayment({ return_url })` | Stripe API | — |
| 6.4 | Redirect to success URL | Stripe redirect | `?session_id=cs_xxx&payment_intent=pi_xxx&...` — **both** params present |
| 6.5 | Read `session_id` from URL | _(client-side)_ | `searchParams.get("session_id")` |
| 6.6 | **No API call needed** | — | Webhook `payment_intent.succeeded` updates the payment + creates entitlements |
| 6.7 | Optional: Poll `GET /api/payments/history` | `GET /api/payments/history` | Verify payment succeeded |

---

## 7. Subscription Management (Stripe Customer Portal)

**Trigger:** User clicks "Manage Subscription" on profile.

| Step | Action | Endpoint |
|------|--------|----------|
| 7.1 | Create a Stripe Customer Portal session | `POST /api/billing/portal/session` |
| 7.2 | Redirect user to the returned portal URL | Stripe-hosted portal |

Response: `{ url: "https://billing.stripe.com/p/session_xxx" }`

---

## 8. Read Operations (Subscription/Payment History)

| Step | Action | Endpoint | Auth |
|------|--------|----------|------|
| 8.1 | Fetch current subscription | `GET /api/subscriptions/current` | Yes |
| 8.2 | Fetch subscription history (paginated) | `GET /api/subscriptions/history?page=&limit=` | Yes |
| 8.3 | Fetch subscription timeline | `GET /api/subscriptions/history/:id` | Yes |
| 8.4 | Fetch payment history (paginated) | `GET /api/payments/history?page=&limit=` | Yes |
| 8.5 | Fetch payment detail | `GET /api/payments/:id` | Yes |
| 8.6 | Fetch billing customer info | `GET /api/billing/customer` | Yes |

---

## 9. Root Layout — Auth + Subscription Hydration

| Step | Action | Endpoint |
|------|--------|----------|
| 9.1 | Fetch current user + subscription | `GET /api/auth/current-user` |
| 9.2 | Hydrate `useAuthStore` + `subscriptionStore` | _(client-side)_ |

The `current-user` endpoint returns `{ user, subscription }`. If no active subscription exists, `subscription` is `null`.

---

## 10. Flow Diagrams

### 10.1 Embedded Elements Subscription (Corrected)

```
User clicks "Subscribe" on /pricing
       │
       ▼
  /checkout?priceId=xxx&isRecurring=true
       │
       ├── GET  /api/plans                    (fetch plans)
       ├── GET  /api/billing/customer         (ensure customer — optional)
       │
       ▼
  POST /api/billing/checkout/embedded-elements  { priceId, idempotencyKey }
       │
       ▼
  { paymentIntentId: "pi_xxx", clientSecret: "pi_xxx_secret_xxx" }
       │  (no sessionId returned)
       ▼
  Mount Stripe <Elements> with clientSecret
       │
       ▼
  User fills card → clicks "Pay Now"
       │
       ▼
  stripe.confirmPayment({ return_url: "/checkout/success" })
       │
       ├── Success → Stripe redirects
       │
       ▼
  /checkout/success?payment_intent=pi_xxx&redirect_status=succeeded
       │  (NO session_id in URL)
       │
       ▼
  ⚠️ MANDATORY: POST /api/billing/subscriptions/create  { paymentIntentId }
       │
       ▼
  { subscriptionId: "sub_xxx", status: "active" }
       │
       │
       └── Optional: Poll GET /api/subscriptions/current
                  │
                  ▼
            Subscription confirmed → show success UI
```

### 10.2 Hosted Checkout Subscription (Alternative)

```
  POST /api/billing/checkout/subscription  { priceId, uiMode: "hosted_page" }
       │
       ▼
  { sessionId: "cs_xxx", url: "https://checkout.stripe.com/..." }
       │
       ▼
  window.location.href = url   (redirect to Stripe)
       │
       ▼
  User pays on Stripe → redirected to success_url?session_id=cs_xxx
       │
       ▼
  /checkout/success?session_id=cs_xxx
       │  (NO payment_intent in URL — use session_id)
       │
       ▼
  (No API call needed — webhooks handle everything)
       │
       ▼
  Poll GET /api/subscriptions/current until subscription appears
       │
       ▼
  Subscription confirmed → show success UI
```

### 10.3 One-Time Elements

```
  POST /api/billing/checkout/embedded-elements-one-time  { priceId }
       │
       ▼
  { sessionId: "cs_xxx", clientSecret: "pi_xxx_secret_xxx" }
       │  (has sessionId — unlike subscription Elements)
       │
       ▼
  stripe.confirmPayment({ return_url: "/checkout/success" })
       │
       ▼
  /checkout/success?session_id=cs_xxx&payment_intent=pi_xxx
       │  (both params present)
       │
       ▼
  (No API call needed — webhooks handle it)
       │
       ▼
  Poll GET /api/payments/history to confirm
```

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
| `GET` | `/api/auth/current-user` | Current user + subscription | Yes |

### Write Endpoints

| Method | Path | Purpose | Auth Required |
|--------|------|---------|---------------|
| `POST` | `/api/billing/checkout/subscription` | Create hosted Checkout Session (recurring) | Yes |
| `POST` | `/api/billing/checkout/one-time` | Create hosted Checkout Session (one-time) | Yes |
| `POST` | `/api/billing/checkout/embedded-elements` | Create Elements PaymentIntent for subscription | Yes |
| `POST` | `/api/billing/checkout/embedded-elements-one-time` | Create Elements PaymentIntent (one-time) | Yes |
| **`POST`** | **`/api/billing/subscriptions/create`** | **Create subscription after Elements payment** | **Yes** |
| `POST` | `/api/billing/portal/session` | Create Stripe Customer Portal session | Yes |

**⚠️ `POST /api/billing/subscriptions/create` was missing from the old doc.** This endpoint is mandatory for the Embedded Elements subscription flow and must be called after `stripe.confirmPayment()` succeeds.

---

## URL Parameters Per Flow

| Flow | Redirect URL Parameters | Frontend Reads |
|------|------------------------|----------------|
| Hosted Subscription (`/checkout/subscription`) | `?session_id=cs_xxx` | `searchParams.get("session_id")` |
| Hosted One-Time (`/checkout/one-time`) | `?session_id=cs_xxx` | `searchParams.get("session_id")` |
| **Embedded Elements subscription** (`/checkout/embedded-elements`) | `?payment_intent=pi_xxx&payment_intent_client_secret=...&redirect_status=succeeded` | **`searchParams.get("payment_intent")`** |
| Embedded Elements one-time (`/checkout/embedded-elements-one-time`) | `?session_id=cs_xxx&payment_intent=pi_xxx&...` | `searchParams.get("session_id")` or `searchParams.get("payment_intent")` |

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `POST /api/billing/subscriptions/create` returns 409 (Idempotency-Key reused) | Treat as success — subscription already exists |
| `POST /api/billing/subscriptions/create` returns 4xx | Show error with retry button |
| Polling timeout (30s) | Show "Subscription pending" with retry button |
| `redirect_status=failed` on success page | Show failure UI, offer retry checkout |
| Webhook delayed (>60s) | Show "Processing payment" with support contact |

---

## Critical Rules for Frontend Developers

1. **The success page MUST distinguish which flow was used.** If the URL contains `?session_id=`, it is a Hosted Checkout. If it contains `?payment_intent=...&redirect_status=...` (without `session_id`), it is an Elements subscription.

2. **`POST /api/billing/subscriptions/create` is MANDATORY** for the Elements subscription flow. Without it, no Stripe subscription or local `BillingSubscription` row is ever created. Polling `GET /api/subscriptions/current` without this call will always return `null`.

3. **Use different `Idempotency-Key` values** for each endpoint call. The scope names prevent reuse:
   - `POST /checkout/embedded-elements` → scope `subscription.payment_intent`
   - `POST /subscriptions/create` → scope `subscription.create_from_payment`
   A key used for the first endpoint cannot be reused for the second.

4. **The legacy `user.isPremium` column is never updated** by the billing module. Always use `GET /api/subscriptions/current` (returns `null` if free) or `GET /api/billing/entitlements` to check access.

5. **One-time Elements** (`/checkout/embedded-elements-one-time`) **does** return a `sessionId` in the response, unlike the subscription Elements endpoint. This is asymmetric by design.
