# Plans & Subscriptions Module – Frontend Integration Plan

> **Base URL:** `/api` (set in `src/main.ts` via `app.setGlobalPrefix('api')`)
> **Module path:** `src/plans-subscriptions`
> **Swagger tags:** `Plans & Subscriptions - Public`, `Plans & Subscriptions - Admin`, `Plans & Subscriptions - User`
> **Auth cookie:** `flick_auth_token` (JWT set via HTTP-only cookie)

The **Plans & Subscriptions** module serves the public pricing page, the admin plan/price management panel, and the user's subscription/payment history pages. It wraps data from the **Billing** module (plans, prices, subscriptions, payments, invoices, transactions) plus its own `PlanSubscriptionHistory` entity.

> [!IMPORTANT]
> **Key frontend rules**
>
> 1. The **public plans endpoint** (`GET /api/plans`) is unauthenticated — call it on the pricing/marketing page.
> 2. All **user** endpoints (`/api/subscriptions/*`, `/api/payments/*`) require the JWT auth cookie (`flick_auth_token`).
> 3. All **admin** endpoints (`/api/admin/plans/*`) require JWT + `ADMIN` role.
> 4. The admin plan management endpoints are CRUD for plans and prices. Deactivation is done via `PATCH` on a price to set it inactive, not a delete.
> 5. The currency is presented in **minor units** (cents for `usd`). Divide by 100 for display (e.g. `unitAmount: 1900` → `$19.00`).
> 6. **Checkout endpoints live in the Billing module** (`/api/billing/checkout/*`). The Plans & Subscriptions module provides the pricing catalog and post-purchase history views. See Section 9 for the full end-to-end checkout flow.
> 7. **Idempotency-Key is mandatory** for all checkout and portal endpoints. Generate a fresh UUID per user action and reuse it on retries.
> 8. **Never send raw Stripe IDs, amounts, or currencies from the frontend.** You only send the local `priceId` (UUID from the plans list). Everything else is resolved server-side.

---

## 1. Module Overview

| Concern            | Detail                                                                      |
| ------------------ | --------------------------------------------------------------------------- |
| Base path (public) | `/api/plans`                                                                |
| Base path (user)   | `/api/subscriptions/*`, `/api/payments/*` (require JWT)                     |
| Base path (admin)  | `/api/admin/plans/*` (require JWT + role `ADMIN`)                           |
| Auth (user)        | JWT cookie `flick_auth_token` (validated by `AuthGuard`)                    |
| Auth (admin)       | JWT cookie + `Roles(UserRoleEnum.ADMIN)` + `RolesGuard`                     |
| Public access      | `@Public()` decorator — no JWT required                                     |
| Persistence        | See entities used from `billing` module + `plan_subscription_history` table |
| User ID source     | Extracted from JWT via `@GetUser('id')` — frontend **never** sends user ID  |

### 1.1 Authorization Matrix

| Endpoint                                          | Public | User | Admin |
| ------------------------------------------------- | :----: | :--: | :---: |
| `GET  /api/plans`                                 |   ✅   |      |       |
| `POST /api/admin/plans`                           |        |      |  ✅   |
| `GET  /api/admin/plans`                           |        |      |  ✅   |
| `GET  /api/admin/plans/:id`                       |        |      |  ✅   |
| `PATCH /api/admin/plans/:id`                      |        |      |  ✅   |
| `POST /api/admin/plans/:id/archive`               |        |      |  ✅   |
| `POST /api/admin/plans/:id/prices`                |        |      |  ✅   |
| `GET  /api/admin/plans/:id/prices`                |        |      |  ✅   |
| `PATCH /api/admin/plans/prices/:id`               |        |      |  ✅   |
| `GET  /api/subscriptions/current`                 |        |  ✅  |       |
| `GET  /api/subscriptions/history`                 |        |  ✅  |       |
| `GET  /api/subscriptions/history/:subscriptionId` |        |  ✅  |       |
| `GET  /api/payments/history`                      |        |  ✅  |       |
| `GET  /api/payments/:id`                          |        |  ✅  |       |

### 1.2 Enums (shared with frontend)

```ts
// Plan lifecycle
enum BillingPlanStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

// Price shape
enum BillingPriceType {
  ONE_TIME = 'one_time',
  RECURRING = 'recurring',
}

enum BillingRecurringInterval {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

// Subscription lifecycle (mirrors Stripe)
enum BillingSubscriptionStatus {
  INCOMPLETE = 'incomplete',
  TRIALING = 'trialing',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  UNPAID = 'unpaid',
  PAUSED = 'paused',
  INCOMPLETE_EXPIRED = 'incomplete_expired',
}

// Payment lifecycle
enum BillingPaymentStatus {
  CHECKOUT_CREATED = 'checkout_created',
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELED = 'canceled',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
}

// Transaction types (derived from BillingTransaction)
enum TransactionType {
  CHARGE = 'charge',
  REFUND = 'refund',
}
```

### 1.3 Common Error Responses

All errors are handled by the global `GlobalExceptionFilter`.

| HTTP | Meaning                                                               | Body shape                                                        |
| ---- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 400  | Validation error (`ValidationPipe`, `BadRequestException`)            | `{ "statusCode": 400, "message": "...", "error": "Bad Request" }` |
| 401  | Missing or invalid JWT                                                | `{ "statusCode": 401, "message": "Unauthorized" }`                |
| 403  | Forbidden — admin-only route without ADMIN role                       | `{ "statusCode": 403, "message": "Forbidden..." }`                |
| 404  | Resource not found (plan, price, subscription, payment)               | `{ "statusCode": 404, "message": "... not found." }`              |
| 409  | Conflict (e.g., updating an archived plan, duplicate plan code, etc.) | `{ "statusCode": 409, "message": "..." }`                         |

### 1.4 Required Headers

| Header          | Where                        | Notes                                                                |
| --------------- | ---------------------------- | -------------------------------------------------------------------- |
| `Authorization` | User & Admin endpoints       | `Bearer <access_token>` (cookie `flick_auth_token` is also accepted) |
| `Content-Type`  | All `POST`/`PATCH` endpoints | `application/json`                                                   |

---

## 2. End-to-End Checkout Flow

This section describes the **complete lifecycle** of a subscription purchase — from the user clicking "Subscribe" on the pricing page, through Stripe Checkout, the server-side webhook processing, and finally seeing the active subscription in their account. Both the **Plans & Subscriptions** and **Billing** modules work together to make this happen.

### 2.1 Flow Diagram

```
  ┌──────────┐     ┌────────────────┐     ┌──────────────┐     ┌────────────┐
  │  Browser  │     │  Your Backend  │     │   Stripe     │     │   Your DB  │
  │ (React)   │     │  (NestJS)      │     │ (Checkout)   │     │ (Postgres) │
  └─────┬─────┘     └───────┬────────┘     └──────┬───────┘     └──────┬─────┘
        │                   │                      │                    │
        │  ── Step 1 ──►    │                      │                    │
        │  GET /api/plans   │                      │                    │
        │◄── plans[] ───────│                      │                    │
        │                   │                      │                    │
        │  ── Step 2 ──►    │                      │                    │
        │  GET /api/billing/ │                      │                    │
        │  customer         │                      │                    │
        │◄── customer ──────│                      │                    │
        │                   │                      │                    │
        │  ── Step 3 ──►    │                      │                    │
        │  POST /api/billing/│                      │                    │
        │  checkout/        │                      │                    │
        │  subscription     │                      │                    │
        │  { priceId }      │                      │                    │
        │  Idempotency-Key  │                      │                    │
        │                   │──── Create Stripe ──►│                    │
        │                   │    Checkout Session  │                    │
        │                   │◄── session/url ──────│                    │
        │                   │                      │                    │
        │  ◄── { url } ──── │                      │                    │
        │                   │                      │                    │
        │  ── Step 4 ──►    │                      │                    │
        │  REDIRECT to      │                      │                    │
        │  Stripe Checkout  │                      │                    │
        │  (stripe.com)     │                      │                    │
        │                   │                      │                    │
        │  ╔══════════════════════════════════════╗ │                    │
        │  ║  USER FILLS PAYMENT DETAILS          ║ │                    │
        │  ║  ON STRIPE HOSTED PAGE               ║ │                    │
        │  ╚══════════════════════════════════════╝ │                    │
        │                   │                      │                    │
        │  ── Step 5 ──►    │                      │                    │
        │  Redirect back to │                      │                    │
        │  success_url      │                      │                    │
        │  with ?session_id │                      │                    │
        │                   │                      │                    │
        │                   │  ── Step 6 (server) ──►                    │
        │                   │  Webhook: checkout.    │                    │
        │                   │  session.completed     │                    │
        │                   │◄──── Stripe webhook ───│                    │
        │                   │                        │                    │
        │                   │──── payment/subs ─────►│── UPDATE DB ──────►│
        │                   │    updated locally     │  payment: succeeded│
        │                   │                        │  subscription:     │
        │                   │                        │  active/trialing   │
        │                   │                        │                    │
        │                   │  ── Step 7 (server) ──►                    │
        │                   │  Webhook: customer.    │                    │
        │                   │  subscription.created  │                    │
        │                   │◄──── Stripe webhook ───│                    │
        │                   │                        │                    │
        │                   │──── subscription ─────►│── UPDATE DB ──────►│
        │                   │    synced locally      │  subscription:     │
        │                   │                        │  real status/period│
        │                   │                        │  plan_subscription_│
        │                   │                        │  history entry     │
        │                   │                        │                    │
        │                   │  ── Step 8 ──►         │                    │
        │  ── POLL ────────►│  GET /api/             │                    │
        │                   │  subscriptions/current │                    │
        │  ◄── subscription │                        │                    │
        │       or null ────│                        │                    │
        │                   │                        │                    │
        │  ── Step 9 ──►    │                        │                    │
        │  GET /api/        │                        │                    │
        │  payments/:id     │                        │                    │
        │  (using session_id)│                       │                    │
        │◄── payment detail │                        │                    │
```

### 2.2 Step-by-Step Details

#### Step 1: Fetch Available Plans

Before the user can subscribe, fetch the available plans and prices. You can use either endpoint:

- **`GET /api/plans`** — from Plans & Subscriptions module (simpler, no currency filter)
- **`GET /api/billing/plans/public?currency=usd`** — from Billing module (supports currency filtering)

```ts
const plans = await fetch('/api/plans').then((r) => r.json());
// Each plan has prices[].id — this is the local UUID the user selects
```

#### Step 2: Ensure Billing Customer Exists

Before creating a checkout session, ensure the current user has a billing customer record in Stripe. This is done via the **Billing module**:

```http
GET /api/billing/customer HTTP/1.1
Authorization: Bearer <access_token>
```

The backend lazily creates a Stripe Customer on first call. This endpoint is safe to call any time after login. The response includes `stripeCustomerId` (for debugging), but the frontend never needs to send it back.

#### Step 3: Create a Checkout Session

When the user clicks "Subscribe" (or "Buy"), call the appropriate checkout endpoint in the **Billing module**. **The frontend only sends the local price UUID** — never the Stripe price ID, amount, or currency.

##### Subscription Checkout

```http
POST /api/billing/checkout/subscription HTTP/1.1
Authorization: Bearer <access_token>
Idempotency-Key: a1b2c3d4-e5f6-7890-abcd-ef1234567890
Content-Type: application/json

{
  "priceId": "1d2b6c91-9b9b-4d1d-9c08-2f2a3b4c5d6e",
  "quantity": 1,
  "trialDays": 14,
  "allowPromotionCodes": true
}
```

**Parameters (`BillingSubscriptionCheckoutRequestDto`)**:

| Field                 | Type    | Required | Default | Constraints                                         |
| --------------------- | ------- | :------: | ------- | --------------------------------------------------- |
| `priceId`             | UUID    |    ✅    |         | Local recurring `BillingPrice` UUID from plans list |
| `quantity`            | integer |          | `1`     | 1–100 (seats)                                       |
| `clientReferenceId`   | string  |          |         | Max 100 chars; `[A-Za-z0-9._:-]+` only              |
| `trialDays`           | integer |          |         | 1–730; overrides the price-level trial period       |
| `allowPromotionCodes` | boolean |          | `true`  | Whether Checkout accepts Stripe promo codes         |

**Response (`BillingCheckoutSessionResponseDto`) — `200 OK`**:

```json
{
  "sessionId": "cs_test_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "url": "https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6#fidkdWxOYHwnPyd1blpxYHZxWjA0TjE0PWF..."
}
```

##### One-Time Checkout

```http
POST /api/billing/checkout/one-time HTTP/1.1
Authorization: Bearer <access_token>
Idempotency-Key: b2c3d4e5-f6a7-8901-bcde-f12345678901
Content-Type: application/json

{
  "priceId": "0f0e0d0c-0b0a-0908-0706-050403020100",
  "quantity": 1,
  "allowPromotionCodes": true
}
```

**Parameters (`BillingOneTimeCheckoutRequestDto`)**:

| Field                 | Type    | Required | Default | Constraints                                        |
| --------------------- | ------- | :------: | ------- | -------------------------------------------------- |
| `priceId`             | UUID    |    ✅    |         | Local one-time `BillingPrice` UUID from plans list |
| `quantity`            | integer |          | `1`     | 1–100                                              |
| `allowPromotionCodes` | boolean |          | `true`  | Whether Checkout accepts Stripe promo codes        |

**Response — `200 OK`**: Same shape as subscription checkout — `{ sessionId, url }`.

> [!IMPORTANT]
> **Idempotency-Key contract:**
>
> - The `Idempotency-Key` header is **mandatory** (400 if missing).
> - Generate one UUID v4 per user action (button click).
> - **Reuse the same key on retries** — the server caches the response for 24h.
> - Same key + **same body** → returns cached response (safe retry).
> - Same key + **different body** → `409 Conflict`.

##### Backend logic during checkout creation (server-side, for understanding):

| Action                                                                                                                                                                                                   | Detail |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Validates `priceId` exists, `active=true`, type matches (`recurring` vs `one_time`)                                                                                                                      |        |
| For subscriptions: validates plan is not `archived`                                                                                                                                                      |        |
| For subscriptions: validates user has no existing active subscription                                                                                                                                    |        |
| Gets/Creates a Stripe Customer for the user                                                                                                                                                              |        |
| Creates a `BillingPayment` row with `status: 'checkout_created'`                                                                                                                                         |        |
| **For subscriptions only**: pre-creates a `BillingSubscription` row with `status: 'incomplete'` and a placeholder `stripeSubscriptionId: 'pending_sub:<paymentId>'` — this is the **subscription shell** |        |
| Calls Stripe API to create the Checkout Session                                                                                                                                                          |        |
| Updates the payment (and subscription) rows with the Stripe `session_id`                                                                                                                                 |        |
| Returns `{ sessionId, url }`                                                                                                                                                                             |        |

#### Step 4: Redirect to Stripe Checkout

Immediately after receiving the response, redirect the user to the `url`:

```ts
window.location.href = session.url;
// OR for SPA with external navigation:
window.open(session.url, '_self');
```

The URL is short-lived (Stripe default: 24h). Do not store it for later — redirect right away.

> [!NOTE]
> The `url` starts with `https://checkout.stripe.com/`. On mobile, Stripe Checkout automatically adapts to the device. No additional SDK is needed.

#### Step 5: User Completes Payment on Stripe

Stripe hosts the entire payment flow:

- Card details, Apple Pay, Google Pay, etc. (dynamic payment methods)
- Promotion code entry (if enabled)
- Trial period acknowledgment (if applicable)

**After completion, Stripe redirects the browser back to the `success_url`**, which is configured server-side via `STRIPE_SUCCESS_URL` env variable. The backend appends `?session_id={CHECKOUT_SESSION_ID}` to the URL, so the success page receives the Stripe session ID in the query string.

If the user cancels, Stripe redirects to `cancel_url` (configured as `STRIPE_CANCEL_URL` env variable).

**The frontend success page should:**

1. Read `session_id` from the URL query parameter
2. Poll for the subscription status (Step 8)
3. Display a success/confirmation message

```ts
// On the success page (e.g., /checkout/success?session_id=cs_test_...)
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('session_id'); // Stripe session ID
```

#### Step 6-7: Server-Side Webhook Processing (Invisible to Frontend)

After the redirect, Stripe sends **webhook events** to your backend at `POST /api/billing/webhooks/stripe`. These events update local database state. The table below shows what happens for each event — the frontend doesn't need to handle these directly, but you should understand the timing:

| Order  | Webhook Event                   | What the Backend Does                                                                                                                                                                                                                                                                                                                        | State After                                                                  |
| ------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **6a** | `checkout.session.completed`    | Sets `BillingPayment.status → 'succeeded' \| 'pending'`. Attaches `stripePaymentIntentId`. For subscriptions: replaces the placeholder `pending_sub:…` with the real Stripe `sub_…` id on the subscription shell.                                                                                                                            | Payment shows as succeeded. Subscription still `incomplete`.                 |
| **6b** | `payment_intent.succeeded`      | Creates a `BillingTransaction(type='charge')` row. Sets payment to `succeeded`.                                                                                                                                                                                                                                                              | Full charge record exists.                                                   |
| **6c** | `charge.succeeded`              | Confirms payment succeeded (idempotent with above).                                                                                                                                                                                                                                                                                          | Payment confirmed.                                                           |
| **7a** | `customer.subscription.created` | Replaces placeholder subscription id with real `sub_*` if not already done. Sets status to `active` or `trialing`. Sets `currentPeriodStart`, `currentPeriodEnd`, `trialEnd`, `cancelAtPeriodEnd`. Emits `billing.subscription.created` event → `SubscriptionHistoryService` records the status change in `plan_subscription_history` table. | **Subscription is now active/trialing in DB.** User is entitled to features. |
| **7b** | `customer.subscription.updated` | Syncs any changes to subscription status/period.                                                                                                                                                                                                                                                                                             | Subscription stays in sync.                                                  |
| **7c** | `invoice.*` events              | Creates/updates `BillingInvoice` rows.                                                                                                                                                                                                                                                                                                       | Invoice records available.                                                   |

> [!TIP]
> **Timeline expectation:**
>
> - Stripe typically sends `checkout.session.completed` within 1–5 seconds of payment.
> - `customer.subscription.created` follows shortly after (another 1–5 seconds).
> - In rare cases (Stripe retries, network delays), webhooks can arrive up to several minutes later.
> - **The backend emits internal `billing.*` events** that `SubscriptionHistoryService` listens to, so the `plan_subscription_history` table gets entries automatically.

#### Step 8: Poll for Subscription Confirmation

After the user returns from Stripe Checkout, the subscription may not be immediately visible because webhooks are asynchronous. The frontend should **poll** the subscription endpoint to wait for the webhook to be processed:

```ts
/**
 * Poll for the user's active subscription after checkout.
 * Continues until a subscription is found or timeout.
 */
async function waitForSubscription(
  maxAttempts = 15,
  intervalMs = 2000,
): Promise<object | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const sub = await fetch('/api/subscriptions/current', {
      credentials: 'include',
    }).then((r) => r.json());

    if (sub !== null) {
      return sub; // Subscription is active/trialing!
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null; // Timeout — show a "check back later" message
}

// Usage on the success page:
const subscription = await waitForSubscription();
if (subscription) {
  showSuccess(subscription);
} else {
  showPendingMessage();
}
```

**What the endpoint returns:**

| State                           | Response                                                | Meaning                                     |
| ------------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| Webhooks processed              | `{ id: "...", status: "active", planName: "Pro", ... }` | Subscription is active — show confirmation  |
| Still processing                | `null`                                                  | Webhooks haven't arrived yet — keep polling |
| No subscription (never started) | `null` after many retries                               | Something went wrong — show support link    |

#### Step 9: Fetch Payment Detail (Optional)

After the subscription is confirmed, the user may want to see the payment receipt. The `session_id` from the success URL can be used to find the payment:

```http
GET /api/payments/history?page=1&limit=5 HTTP/1.1
Authorization: Bearer <access_token>
```

The most recent payment will be the first item. Alternatively, you can fetch a specific payment detail if you have the payment UUID:

```http
GET /api/payments/a3b1c2d3-4e5f-6a7b-8c9d-0e1f2a3b4c5d HTTP/1.1
Authorization: Bearer <access_token>
```

### 2.3 Full End-to-End Sequence Diagram (Text)

```
FRONTEND                              BACKEND                          STRIPE                          DB
────────                              ───────                          ──────                          ──
  │                                      │                               │                              │
  │  GET /api/plans                       │                               │                              │
  │─────────────────────────────────────►│                               │                              │
  │◄──────────────────── plans[] ────────│                               │                              │
  │                                      │                               │                              │
  │  GET /api/billing/customer            │                               │                              │
  │─────────────────────────────────────►│                               │                              │
  │  (create Stripe Customer lazily)     │── stripe.customers.create ───►│                              │
  │                                      │◄──── cus_xxx ────────────────│                              │
  │                                      │── save BillingCustomer ─────────────────────────────────────►│
  │◄────────── billing customer ────────│                               │                              │
  │                                      │                               │                              │
  │  POST /api/billing/checkout/         │                               │                              │
 │    subscription                       │                               │                              │
 │  { priceId, Idempotency-Key }        │                               │                              │
  │─────────────────────────────────────►│                               │                              │
  │                                      │── save payment ─────(checkout_created)─────────────────────►│
  │                                      │── save subscription ─(incomplete, pending_sub:xxx)──────────►│
  │                                      │── stripe.checkout.sessions.create ────────────────────────►│
  │                                      │◄──── session { id, url } ─────────────────────────────────│                              │
  │                                      │── update payment/subs with session_id ────────────────────►│
  │◄────────── { sessionId, url } ──────│                               │                              │
  │                                      │                               │                              │
  │  window.location.href = url          │                               │                              │
  │──────────────────────────────────────────────────────────────────────►                              │
  │                                      │                               │                              │
  │  ╔══════════════════════════════════════════════════════════════╗     │                              │
  │  ║      USER FILLS PAYMENT FORM ON STRIPE CHECKOUT PAGE       ║     │                              │
  │  ╚══════════════════════════════════════════════════════════════╝     │                              │
  │                                      │                               │                              │
  │◄──── redirect to success_url ────────────────────────────────────────│                              │
  │       ?session_id=cs_test_xxx        │                               │                              │
  │                                      │                               │                              │
  │  ╔══════════════════════════════════════╗                            │                              │
  │  ║  WEBHOOKS (server-to-server)        ║                            │                              │
  │  ╚══════════════════════════════════════╝                            │                              │
  │                                      │                               │                              │
  │                                      │◄──── checkout.session.completed ────                        │
  │                                      │── update payment (succeeded) ──────────────────────────────►│
  │                                      │── update subscription (replace placeholder) ───────────────►│
  │                                      │                               │                              │
  │                                      │◄──── payment_intent.succeeded ────                          │
  │                                      │── create transaction (charge) ─────────────────────────────►│
  │                                      │                               │                              │
  │                                      │◄──── customer.subscription.created ────                      │
  │                                      │── update subscription (active/trialing, period) ───────────►│
  │                                      │── emit billing.subscription.created event                   │
  │                                      │── SubscriptionHistoryService records status change ────────►│
  │                                      │── recompute entitlements ─────────────────────────────────►│
  │                                      │                               │                              │
  │  ╔══════════════════════════════════════╗                            │                              │
  │  ║  FRONTEND POLLING                  ║                            │                              │
  │  ╚══════════════════════════════════════╝                            │                              │
  │                                      │                               │                              │
  │  GET /api/subscriptions/current (poll)│                              │                              │
  │─────────────────────────────────────►│                               │                              │
  │◄────────── subscription data ────────│                               │                              │
  │  (or null if webhooks not yet done)  │                               │                              │
  │                                      │                               │                              │
  │  GET /api/payments/history            │                               │                              │
  │─────────────────────────────────────►│                               │                              │
  │◄────────── paginated payments ──────│                               │                              │
```

### 2.4 Error & Edge Cases

| Scenario                                                  | What Happens                                                                                                                                                                                                           | Frontend Handling                                                                                                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **User cancels on Stripe**                                | Stripe redirects to `cancel_url`. `checkout.session.expired` webhook fires → backend marks payment as `canceled` and subscription shell as `incomplete_expired`.                                                       | Show the pricing page again. No poll needed.                                                                                                                             |
| **Payment fails (card declined)**                         | Stripe redirects to `success_url` (Stripe always does this for subscription checkouts). But `payment_intent.payment_failed` fires → backend marks payment as `failed`, subscription may be `incomplete` or `past_due`. | Poll `GET /api/subscriptions/current` — it may return `null` or a subscription with status `incomplete`. Show "Payment failed" message and a link to retry (via portal). |
| **Idempotency-Key reused with different body**            | Backend returns `409 Conflict`.                                                                                                                                                                                        | Show a generic error message. Do not retry automatically — ask the user to try again (which generates a fresh key).                                                      |
| **User already has an active subscription**               | Backend returns `409 Conflict` on checkout creation.                                                                                                                                                                   | Show "You already have an active subscription. Use the billing portal to manage it." Provide link to portal.                                                             |
| **Price becomes inactive between page load and checkout** | Backend returns `404 Not Found` or `409 Conflict`.                                                                                                                                                                     | Show "This plan is no longer available." Refresh plans list.                                                                                                             |
| **User closes browser during Stripe checkout**            | No redirect happens. `checkout.session.expired` fires after 24h → cleanup.                                                                                                                                             | No action needed. User can start again.                                                                                                                                  |
| **Webhook delayed (>30s)**                                | Polling loop times out. Subscription eventually becomes active when webhook arrives.                                                                                                                                   | Show "Your subscription is being activated. We'll notify you when it's ready." Or let them check back.                                                                   |
| **Stripe Customer creation fails**                        | Backend returns 500.                                                                                                                                                                                                   | Show a generic error. Ask user to try again later.                                                                                                                       |

### 2.5 Post-Purchase: Customer Portal for Subscription Management

For ongoing subscription management (upgrade, downgrade, cancel, change payment method), use the Stripe Customer Portal — **not** custom REST endpoints:

```http
POST /api/billing/portal/session HTTP/1.1
Authorization: Bearer <access_token>
Idempotency-Key: c3d4e5f6-a7b8-9012-cdef-123456789012
```

**Request body**: none.

**Response — `200 OK`**:

```json
{
  "url": "https://billing.stripe.com/p/session/test_YWNjY291bnQ"
}
```

Redirect the user to `url`. Stripe manages plan changes, cancellations, payment methods, and invoices inside the portal.

> [!NOTE]
> For the MVP, the Stripe Customer Portal is the only way to change or cancel a subscription. There are no REST endpoints for these operations.

### 2.6 Complete Frontend Checkout Flow Code

Here is a complete example of the checkout flow from pricing page to confirmation:

```ts
// ==========================================
// 1. PRICING PAGE — Fetch and display plans
// ==========================================
interface Plan {
  id: string;
  name: string;
  description: string | null;
  features: string[];
  displayOrder: number;
  highlight: boolean;
  icon: string | null;
  prices: Price[];
}

interface Price {
  id: string; // ← This is the local UUID to send to checkout
  currency: string;
  unitAmount: number; // cents
  type: 'one_time' | 'recurring';
  interval: string | null;
  trialPeriodDays: number | null;
}

async function fetchPlans(): Promise<Plan[]> {
  const res = await fetch('/api/plans');
  return res.json();
}

// ==========================================
// 2. SUBSCRIBE BUTTON CLICK
// ==========================================
async function handleSubscribe(priceId: string, isRecurring: boolean) {
  const idempotencyKey = crypto.randomUUID();

  try {
    // 2a. Create checkout session
    const body = isRecurring
      ? { priceId, quantity: 1, allowPromotionCodes: true }
      : { priceId, quantity: 1, allowPromotionCodes: true };

    const endpoint = isRecurring
      ? '/api/billing/checkout/subscription'
      : '/api/billing/checkout/one-time';

    const res = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json();
      if (res.status === 409) {
        // User already has subscription or price conflict
        showError(err.message);
        return;
      }
      if (res.status === 404) {
        showError('This plan is no longer available.');
        return;
      }
      throw new Error(err.message);
    }

    const { sessionId, url } = await res.json();

    // 2b. Store sessionId for success page (e.g., in sessionStorage)
    sessionStorage.setItem('checkout_session_id', sessionId);

    // 2c. Redirect to Stripe immediately
    window.location.href = url;
  } catch (err) {
    showError('Something went wrong. Please try again.');
  }
}

// ==========================================
// 3. SUCCESS PAGE (after Stripe redirect)
// ==========================================
async function handleCheckoutSuccess() {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId =
    urlParams.get('session_id') ||
    sessionStorage.getItem('checkout_session_id');

  if (!sessionId) {
    showError('No session information found.');
    return;
  }

  // Show a loading state
  showConfirmationLoading();

  // Poll for subscription to become active
  const subscription = await pollForSubscription();

  if (subscription) {
    // Show success with plan details
    showSubscriptionConfirmation(subscription);
  } else {
    // Webhooks may be delayed — show pending state
    showPendingConfirmation(sessionId);
  }

  // Clean up
  sessionStorage.removeItem('checkout_session_id');
}

async function pollForSubscription(
  maxAttempts = 15,
  intervalMs = 2000,
): Promise<object | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch('/api/subscriptions/current', {
      credentials: 'include',
    });
    const sub = await res.json();
    if (sub !== null) return sub;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

// ==========================================
// 4. SUBSCRIPTION MANAGEMENT PAGE
// ==========================================
async function loadSubscriptionManagement() {
  // Load current subscription
  const subscription = await fetch('/api/subscriptions/current', {
    credentials: 'include',
  }).then((r) => r.json());

  if (!subscription) {
    showNoSubscription();
    return;
  }

  // Display subscription details
  renderSubscription(subscription);

  // Open Stripe Customer Portal for changes
  document.getElementById('manage-btn')?.addEventListener('click', async () => {
    const idempotencyKey = crypto.randomUUID();
    const res = await fetch('/api/billing/portal/session', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    const { url } = await res.json();
    window.location.href = url;
  });
}
```

### 2.7 Checkout Flow Error Codes

| HTTP | Code/Message                                                  | Meaning                       | Frontend Action                |
| ---- | ------------------------------------------------------------- | ----------------------------- | ------------------------------ |
| 400  | `Idempotency-Key header is required`                          | Missing header                | Regenerate key and retry       |
| 400  | Validation error (body)                                       | Invalid field(s)              | Fix form fields                |
| 401  | `Unauthorized`                                                | Not logged in                 | Redirect to login              |
| 404  | `Billing price ... not found`                                 | Price UUID invalid/removed    | Refresh plans, show error      |
| 404  | `Billing plan ... not found`                                  | Plan deleted                  | Refresh plans, show error      |
| 409  | `Billing price ... has type "recurring", expected "one_time"` | Wrong endpoint for price type | Use correct checkout endpoint  |
| 409  | `Billing price ... is not active`                             | Price deactivated             | Refresh plans, show error      |
| 409  | `Billing plan ... is archived and cannot be sold`             | Plan archived                 | Refresh plans, show error      |
| 409  | `User ... already has an active subscription`                 | One-subscription limit        | Open Customer Portal to manage |

---

## 3. Public Endpoints

### 3.1 `GET /api/plans` – List active plans with prices (pricing page)

Used by the marketing/pricing page. **No authentication required.**

Only returns plans where:

- `status === 'active'`
- Has at least one `active === true` price

**Query parameters**: none.

**Example request**

```http
GET /api/plans HTTP/1.1
Host: api.example.com
```

**Example response — `200 OK`**

```json
[
  {
    "id": "5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f",
    "code": "pro_monthly",
    "name": "Pro",
    "description": "Pro features billed monthly.",
    "status": "active",
    "features": ["premium_reports", "team_export", "priority_support"],
    "displayOrder": 0,
    "icon": "https://cdn.example.com/icons/pro.svg",
    "highlight": true,
    "prices": [
      {
        "id": "1d2b6c91-9b9b-4d1d-9c08-2f2a3b4c5d6e",
        "planId": "5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f",
        "stripePriceId": "price_1ABCxyz",
        "stripeProductId": "prod_1ABCxyz",
        "currency": "usd",
        "unitAmount": 1900,
        "type": "recurring",
        "interval": "month",
        "trialPeriodDays": 7,
        "active": true,
        "createdAt": "2026-05-01T10:00:00.000Z",
        "updatedAt": "2026-05-01T10:00:00.000Z"
      }
    ],
    "createdAt": "2026-05-01T10:00:00.000Z",
    "updatedAt": "2026-05-01T10:00:00.000Z"
  },
  {
    "id": "7a91c2bf-1234-4abc-9def-0123456789ab",
    "code": "starter_monthly",
    "name": "Starter",
    "description": "Basic features for getting started.",
    "status": "active",
    "features": ["basic_reports"],
    "displayOrder": 1,
    "icon": null,
    "highlight": false,
    "prices": [
      {
        "id": "0f0e0d0c-0b0a-0908-0706-050403020100",
        "planId": "7a91c2bf-1234-4abc-9def-0123456789ab",
        "stripePriceId": "price_1DEFxyz",
        "stripeProductId": "prod_1DEFxyz",
        "currency": "usd",
        "unitAmount": 999,
        "type": "recurring",
        "interval": "month",
        "trialPeriodDays": null,
        "active": true,
        "createdAt": "2026-05-01T10:00:00.000Z",
        "updatedAt": "2026-05-01T10:00:00.000Z"
      }
    ],
    "createdAt": "2026-05-01T10:00:00.000Z",
    "updatedAt": "2026-05-01T10:00:00.000Z"
  }
]
```

**Empty case — `200 OK`**

```json
[]
```

**Errors**: none (no auth, no params).

> [!TIP]
> **Frontend usage:** Use `displayOrder` (ascending) to sort plans on the pricing page. Use `highlight === true` to visually emphasise the recommended plan. Use the `prices[].id` (local UUID) when calling the checkout endpoints in the Billing module.

---

## 4. Authenticated User Endpoints

All endpoints in this section require a valid JWT. The current user is resolved from the JWT `id` claim — the frontend never sends the user ID.

### 4.1 `GET /api/subscriptions/current` – Get current active subscription

Returns the user's current subscription if its status is `active`, `trialing`, or `past_due`. Returns `null` if the user has no active subscription.

**Query parameters**: none.

**Example request**

```http
GET /api/subscriptions/current HTTP/1.1
Authorization: Bearer <access_token>
```

**Example response — `200 OK` (has subscription)**

```json
{
  "id": "b4a9c1e2-7d3f-4f3b-8a92-1b2c3d4e5f6a",
  "status": "active",
  "planName": "Pro",
  "priceCurrency": "usd",
  "priceUnitAmount": 1900,
  "priceInterval": "month",
  "currentPeriodStart": "2026-06-01T10:00:00.000Z",
  "currentPeriodEnd": "2026-07-01T10:00:00.000Z",
  "trialEnd": null,
  "cancelAtPeriodEnd": false,
  "canceledAt": null,
  "createdAt": "2026-05-15T10:00:00.000Z"
}
```

**Example response — `200 OK` (trialing)**

```json
{
  "id": "b4a9c1e2-7d3f-4f3b-8a92-1b2c3d4e5f6a",
  "status": "trialing",
  "planName": "Pro",
  "priceCurrency": "usd",
  "priceUnitAmount": 1900,
  "priceInterval": "month",
  "currentPeriodStart": "2026-06-01T10:00:00.000Z",
  "currentPeriodEnd": "2026-07-01T10:00:00.000Z",
  "trialEnd": "2026-06-08T10:00:00.000Z",
  "cancelAtPeriodEnd": false,
  "canceledAt": null,
  "createdAt": "2026-06-01T10:00:00.000Z"
}
```

**Example response — `200 OK` (no subscription)**

```json
null
```

**Errors**

| Status | When                |
| ------ | ------------------- |
| 401    | Missing/invalid JWT |

> [!TIP]
> **Frontend usage:** Use this endpoint to show the user their current plan badge/status. If `null`, show a "Subscribe Now" CTA. The `cancelAtPeriodEnd` flag tells you if the user has scheduled cancellation. Display `planName` and format `priceUnitAmount / 100` with `priceCurrency` for the price display.

### 4.2 `GET /api/subscriptions/history` – Get paginated subscription history

Returns all past and current subscriptions for the user, ordered by `createdAt DESC`.

**Query parameters (`PaginationQueryDto`)**

| Field   | Type    | Required | Default | Constraints    |
| ------- | ------- | :------: | ------- | -------------- |
| `page`  | integer |          | `1`     | min 1          |
| `limit` | integer |          | `20`    | min 1, max 100 |

**Example request**

```http
GET /api/subscriptions/history?page=1&limit=10 HTTP/1.1
Authorization: Bearer <access_token>
```

**Example response — `200 OK`**

```json
{
  "items": [
    {
      "id": "b4a9c1e2-7d3f-4f3b-8a92-1b2c3d4e5f6a",
      "status": "active",
      "planName": "Pro",
      "priceCurrency": "usd",
      "priceUnitAmount": 1900,
      "priceInterval": "month",
      "currentPeriodStart": "2026-06-01T10:00:00.000Z",
      "currentPeriodEnd": "2026-07-01T10:00:00.000Z",
      "trialEnd": null,
      "cancelAtPeriodEnd": false,
      "canceledAt": null,
      "createdAt": "2026-05-15T10:00:00.000Z"
    },
    {
      "id": "a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "status": "canceled",
      "planName": "Starter",
      "priceCurrency": "usd",
      "priceUnitAmount": 999,
      "priceInterval": "month",
      "currentPeriodStart": "2026-04-01T10:00:00.000Z",
      "currentPeriodEnd": "2026-05-01T10:00:00.000Z",
      "trialEnd": null,
      "cancelAtPeriodEnd": true,
      "canceledAt": "2026-04-15T10:00:00.000Z",
      "createdAt": "2026-04-01T10:00:00.000Z"
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 10,
  "totalPages": 1
}
```

**Empty case — `200 OK`**

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "limit": 20,
  "totalPages": 0
}
```

**Errors**

| Status | When                |
| ------ | ------------------- |
| 401    | Missing/invalid JWT |

> [!TIP]
> **Frontend usage:** Render the items in a table or list. Each row shows the plan name, period dates, and status (with appropriate colour badges). The `id` can be used as a link to the subscription timeline (3.3).

### 4.3 `GET /api/subscriptions/history/:subscriptionId` – Get subscription timeline

Returns the full status change timeline for a single subscription, ordered by `occurredAt DESC`.

**Path parameters**

| Field            | Type | Notes                   |
| ---------------- | ---- | ----------------------- |
| `subscriptionId` | UUID | Local subscription UUID |

**Example request**

```http
GET /api/subscriptions/history/b4a9c1e2-7d3f-4f3b-8a92-1b2c3d4e5f6a HTTP/1.1
Authorization: Bearer <access_token>
```

**Example response — `200 OK`**

```json
[
  {
    "id": "h1a2b3c4-d5e6-f7a8-b9c0-d1e2f3a4b5c6",
    "subscriptionId": "b4a9c1e2-7d3f-4f3b-8a92-1b2c3d4e5f6a",
    "previousStatus": "trialing",
    "newStatus": "active",
    "planId": "5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f",
    "priceId": "1d2b6c91-9b9b-4d1d-9c08-2f2a3b4c5d6e",
    "reason": "event: billing.subscription.updated",
    "occurredAt": "2026-06-08T10:00:00.000Z",
    "createdAt": "2026-06-08T10:00:01.000Z"
  },
  {
    "id": "h2b3c4d5-e6f7-a8b9-c0d1-e2f3a4b5c6d7",
    "subscriptionId": "b4a9c1e2-7d3f-4f3b-8a92-1b2c3d4e5f6a",
    "previousStatus": null,
    "newStatus": "trialing",
    "planId": null,
    "priceId": null,
    "reason": "event: billing.subscription.created",
    "occurredAt": "2026-06-01T10:00:00.000Z",
    "createdAt": "2026-06-01T10:00:01.000Z"
  }
]
```

**Empty case — `200 OK`**

```json
[]
```

**Errors**

| Status | When                |
| ------ | ------------------- |
| 401    | Missing/invalid JWT |

> [!TIP]
> **Frontend usage:** Render a vertical timeline UI. Each entry shows the transition `previousStatus → newStatus` with the timestamp. Use `occurredAt` for the timeline position, and `createdAt` as a secondary display. The `reason` field describes what triggered the change (e.g. webhook event name).

### 4.4 `GET /api/payments/history` – Get paginated payment history

Returns all payments for the user, ordered by `createdAt DESC`. Includes derived fields like `transactionType` (charge or refund) by examining related transactions and invoices.

**Query parameters (`PaginationQueryDto`)**

| Field   | Type    | Required | Default | Constraints    |
| ------- | ------- | :------: | ------- | -------------- |
| `page`  | integer |          | `1`     | min 1          |
| `limit` | integer |          | `20`    | min 1, max 100 |

**Example request**

```http
GET /api/payments/history?page=1&limit=20 HTTP/1.1
Authorization: Bearer <access_token>
```

**Example response — `200 OK`**

```json
{
  "items": [
    {
      "id": "a3b1c2d3-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      "amount": 1900,
      "amountRefunded": 0,
      "currency": "usd",
      "status": "succeeded",
      "description": "Subscription: Pro ($19.00 / month)",
      "subscriptionId": "b4a9c1e2-7d3f-4f3b-8a92-1b2c3d4e5f6a",
      "invoiceNumber": "A1B2C3D4-0001",
      "transactionType": "charge",
      "createdAt": "2026-06-01T10:05:00.000Z"
    },
    {
      "id": "d4e5f6a7-b8c9-0d1e-2f3a-4b5c6d7e8f9a",
      "amount": 999,
      "amountRefunded": 999,
      "currency": "usd",
      "status": "refunded",
      "description": "Subscription: Starter ($9.99 / month)",
      "subscriptionId": "a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "invoiceNumber": "E5F6A7B8-0001",
      "transactionType": "refund",
      "createdAt": "2026-04-01T10:05:00.000Z"
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

**Empty case — `200 OK`**

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "limit": 20,
  "totalPages": 0
}
```

**Errors**

| Status | When                |
| ------ | ------------------- |
| 401    | Missing/invalid JWT |

> [!TIP]
> **Frontend usage:** Render a payment history table. Show the amount (divide minor units by 100), status, and `transactionType` (charge vs refund). For refunded payments (`transactionType === 'refund'`), show the refunded amount. `invoiceNumber` links to the Stripe invoice if needed.

### 4.5 `GET /api/payments/:id` – Get payment detail

Returns a single payment with its full detail (amount, refund amount, status, linked subscription and invoice).

**Path parameters**

| Field | Type | Notes              |
| ----- | ---- | ------------------ |
| `id`  | UUID | Local payment UUID |

**Example request**

```http
GET /api/payments/a3b1c2d3-4e5f-6a7b-8c9d-0e1f2a3b4c5d HTTP/1.1
Authorization: Bearer <access_token>
```

**Example response — `200 OK`**

```json
{
  "id": "a3b1c2d3-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
  "amount": 1900,
  "amountRefunded": 0,
  "currency": "usd",
  "status": "succeeded",
  "description": "Subscription: Pro ($19.00 / month)",
  "subscriptionId": "b4a9c1e2-7d3f-4f3b-8a92-1b2c3d4e5f6a",
  "invoiceNumber": "A1B2C3D4-0001",
  "transactionType": "charge",
  "createdAt": "2026-06-01T10:05:00.000Z"
}
```

**Example response — partial refund**

```json
{
  "id": "a3b1c2d3-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
  "amount": 1900,
  "amountRefunded": 500,
  "currency": "usd",
  "status": "partially_refunded",
  "description": "Subscription: Pro ($19.00 / month)",
  "subscriptionId": "b4a9c1e2-7d3f-4f3b-8a92-1b2c3d4e5f6a",
  "invoiceNumber": "A1B2C3D4-0001",
  "transactionType": "charge",
  "createdAt": "2026-06-01T10:05:00.000Z"
}
```

**Example response — `200 OK` (not found / not owned by user)**

```json
null
```

**Errors**

| Status | When                |
| ------ | ------------------- |
| 401    | Missing/invalid JWT |

> [!TIP]
> **Frontend usage:** Use this endpoint to show a payment detail / receipt page. Display the amount, transaction type, status, linked subscription, and invoice number. The `amountRefunded` field shows how much was refunded (if any).

---

## 5. Admin Endpoints

All routes require JWT + `UserRoleEnum.ADMIN`. Auth is enforced by `AuthGuard` + `RolesGuard` + `@Roles(UserRoleEnum.ADMIN)` on the controller class.

### 5.1 `POST /api/admin/plans` – Create a plan

**Request body (`CreatePlanDto`)**

| Field          | Type           | Required | Default | Constraints                               |
| -------------- | -------------- | :------: | ------- | ----------------------------------------- |
| `code`         | string         |    ✅    |         | 1–50 chars, slug format                   |
| `name`         | string         |    ✅    |         | 1–255 chars                               |
| `description`  | string \| null |          | `null`  | max 2000 chars                            |
| `features`     | `string[]`     |          | `[]`    | Feature keys (e.g. `["premium_reports"]`) |
| `displayOrder` | integer        |          | `0`     | min 0; sort order for pricing page        |
| `icon`         | string \| null |          | `null`  | max 255 chars (URL or icon class)         |
| `highlight`    | boolean        |          | `false` | Recommended plan flag                     |
| `metadata`     | object         |          | `{}`    | Arbitrary JSON metadata                   |

**Example request**

```http
POST /api/admin/plans HTTP/1.1
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "code": "pro_monthly",
  "name": "Pro",
  "description": "Pro features billed monthly.",
  "features": ["premium_reports", "team_export", "priority_support"],
  "displayOrder": 0,
  "icon": "https://cdn.example.com/icons/pro.svg",
  "highlight": true
}
```

**Example response — `201 Created`**

```json
{
  "plan": {
    "id": "5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f",
    "code": "pro_monthly",
    "name": "Pro",
    "description": "Pro features billed monthly.",
    "status": "draft",
    "features": ["premium_reports", "team_export", "priority_support"],
    "displayOrder": 0,
    "icon": "https://cdn.example.com/icons/pro.svg",
    "highlight": true,
    "prices": [],
    "createdAt": "2026-06-01T10:00:00.000Z",
    "updatedAt": "2026-06-01T10:00:00.000Z"
  }
}
```

**Errors**

| Status | When                                          |
| ------ | --------------------------------------------- |
| 400    | Validation error (missing fields, max length) |
| 401    | Missing/invalid JWT                           |
| 403    | Authenticated user is not `ADMIN`             |

> [!NOTE]
> The plan is created with `status: 'draft'` by default. Use `PATCH` to update the status to `active` when ready.

### 5.2 `GET /api/admin/plans` – List all plans (with optional status filter)

**Query parameters**

| Field    | Type                | Required | Constraints                           |
| -------- | ------------------- | :------: | ------------------------------------- |
| `status` | `BillingPlanStatus` |          | One of: `draft`, `active`, `archived` |

**Example request**

```http
GET /api/admin/plans?status=active HTTP/1.1
Authorization: Bearer <admin_token>
```

**Example response — `200 OK`**

```json
[
  {
    "id": "5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f",
    "code": "pro_monthly",
    "name": "Pro",
    "description": "Pro features billed monthly.",
    "status": "active",
    "features": ["premium_reports", "team_export", "priority_support"],
    "displayOrder": 0,
    "icon": "https://cdn.example.com/icons/pro.svg",
    "highlight": true,
    "prices": [
      {
        "id": "1d2b6c91-9b9b-4d1d-9c08-2f2a3b4c5d6e",
        "planId": "5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f",
        "stripePriceId": "price_1ABCxyz",
        "stripeProductId": "prod_1ABCxyz",
        "currency": "usd",
        "unitAmount": 1900,
        "type": "recurring",
        "interval": "month",
        "trialPeriodDays": 7,
        "active": true,
        "createdAt": "2026-05-01T10:00:00.000Z",
        "updatedAt": "2026-05-01T10:00:00.000Z"
      }
    ],
    "createdAt": "2026-05-01T10:00:00.000Z",
    "updatedAt": "2026-06-01T10:00:00.000Z"
  }
]
```

**Example request — without filter (returns all statuses)**

```http
GET /api/admin/plans HTTP/1.1
Authorization: Bearer <admin_token>
```

**Example response — `200 OK` (all statuses)**

```json
[
  { "id": "...", "code": "pro_monthly", "status": "active", "prices": [...], ... },
  { "id": "...", "code": "starter_monthly", "status": "draft", "prices": [], ... },
  { "id": "...", "code": "legacy_basic", "status": "archived", "prices": [...], ... }
]
```

**Empty case — `200 OK`**

```json
[]
```

**Errors**

| Status | When                   |
| ------ | ---------------------- |
| 400    | Invalid `status` value |
| 401    | Missing/invalid JWT    |
| 403    | Not admin              |

### 5.3 `GET /api/admin/plans/:id` – Get plan detail with prices

**Path parameters**

| Field | Type | Notes           |
| ----- | ---- | --------------- |
| `id`  | UUID | Local plan UUID |

**Example request**

```http
GET /api/admin/plans/5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f HTTP/1.1
Authorization: Bearer <admin_token>
```

**Example response — `200 OK`**

```json
{
  "id": "5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f",
  "code": "pro_monthly",
  "name": "Pro",
  "description": "Pro features billed monthly.",
  "status": "active",
  "features": ["premium_reports", "team_export", "priority_support"],
  "displayOrder": 0,
  "icon": "https://cdn.example.com/icons/pro.svg",
  "highlight": true,
  "prices": [
    {
      "id": "1d2b6c91-9b9b-4d1d-9c08-2f2a3b4c5d6e",
      "planId": "5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f",
      "stripePriceId": "price_1ABCxyz",
      "stripeProductId": "prod_1ABCxyz",
      "currency": "usd",
      "unitAmount": 1900,
      "type": "recurring",
      "interval": "month",
      "trialPeriodDays": 7,
      "active": true,
      "createdAt": "2026-05-01T10:00:00.000Z",
      "updatedAt": "2026-05-01T10:00:00.000Z"
    }
  ],
  "createdAt": "2026-05-01T10:00:00.000Z",
  "updatedAt": "2026-06-01T10:00:00.000Z"
}
```

**Errors**

| Status | When                      |
| ------ | ------------------------- |
| 401    | Missing/invalid JWT       |
| 403    | Not admin                 |
| 404    | Plan not found (bad UUID) |

### 5.4 `PATCH /api/admin/plans/:id` – Update a plan

The `code` is **not** updatable (not included in `UpdatePlanDto`). Only the fields provided in the body are changed.

**Path parameters**

| Field | Type | Notes           |
| ----- | ---- | --------------- |
| `id`  | UUID | Local plan UUID |

**Request body (`UpdatePlanDto`) — all fields optional**

| Field          | Type           | Required | Constraints             |
| -------------- | -------------- | :------: | ----------------------- |
| `name`         | string         |          | 1–255 chars             |
| `description`  | string \| null |          | max 2000 chars          |
| `features`     | `string[]`     |          | Feature keys            |
| `displayOrder` | integer        |          | min 0                   |
| `icon`         | string \| null |          | max 255 chars           |
| `highlight`    | boolean        |          |                         |
| `metadata`     | object         |          | Arbitrary JSON metadata |

**Example request**

```http
PATCH /api/admin/plans/5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f HTTP/1.1
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "name": "Pro Plus",
  "features": ["premium_reports", "team_export", "priority_support", "advanced_analytics"],
  "highlight": true
}
```

**Example response — `200 OK`**

```json
{
  "plan": {
    "id": "5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f",
    "code": "pro_monthly",
    "name": "Pro Plus",
    "description": "Pro features billed monthly.",
    "status": "active",
    "features": [
      "premium_reports",
      "team_export",
      "priority_support",
      "advanced_analytics"
    ],
    "displayOrder": 0,
    "icon": "https://cdn.example.com/icons/pro.svg",
    "highlight": true,
    "prices": [{ "...": "(see 4.3 for full shape)" }],
    "createdAt": "2026-05-01T10:00:00.000Z",
    "updatedAt": "2026-06-08T12:00:00.000Z"
  }
}
```

**Errors**

| Status | When                                              |
| ------ | ------------------------------------------------- |
| 400    | Validation error                                  |
| 401    | Missing/invalid JWT                               |
| 403    | Not admin                                         |
| 404    | Plan not found                                    |
| 409    | Plan is `archived` (cannot update archived plans) |

### 5.5 `POST /api/admin/plans/:id/archive` – Archive a plan

Sets the plan's status to `archived`. Archived plans are not returned by the public endpoint.

**Path parameters**

| Field | Type | Notes           |
| ----- | ---- | --------------- |
| `id`  | UUID | Local plan UUID |

**Request body**: none.

**Example request**

```http
POST /api/admin/plans/5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f/archive HTTP/1.1
Authorization: Bearer <admin_token>
```

**Example response — `200 OK`**

```json
{
  "plan": {
    "id": "5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f",
    "code": "pro_monthly",
    "name": "Pro",
    "description": "Pro features billed monthly.",
    "status": "archived",
    "features": ["premium_reports", "team_export", "priority_support"],
    "displayOrder": 0,
    "icon": "https://cdn.example.com/icons/pro.svg",
    "highlight": true,
    "prices": [{ "...": "(see 4.3 for full shape)" }],
    "createdAt": "2026-05-01T10:00:00.000Z",
    "updatedAt": "2026-06-08T13:00:00.000Z"
  }
}
```

**Errors**

| Status | When                |
| ------ | ------------------- |
| 401    | Missing/invalid JWT |
| 403    | Not admin           |
| 404    | Plan not found      |

### 5.6 `POST /api/admin/plans/:id/prices` – Add a price to a plan

Attaches a Stripe price (created in Stripe Dashboard) to the local plan.

**Path parameters**

| Field | Type | Notes           |
| ----- | ---- | --------------- |
| `id`  | UUID | Local plan UUID |

**Request body (`CreatePriceDto`)**

| Field             | Type                       | Required | Default | Constraints                                        |
| ----------------- | -------------------------- | :------: | ------- | -------------------------------------------------- |
| `stripePriceId`   | string                     |    ✅    |         | Max 255 chars; the `price_*` id from Stripe        |
| `currency`        | string                     |    ✅    |         | Exactly 3 lowercase letters (e.g. `usd`)           |
| `unitAmount`      | integer                    |    ✅    |         | Amount in **minor units** (cents for `usd`); min 1 |
| `type`            | `BillingPriceType`         |    ✅    |         | `one_time` or `recurring`                          |
| `interval`        | `BillingRecurringInterval` |          |         | **Required** if `type` is `recurring`              |
| `trialPeriodDays` | integer \| null            |          | `null`  | 0–365; only valid for `recurring` type             |
| `active`          | boolean                    |          | `true`  |                                                    |

**Example request — recurring**

```http
POST /api/admin/plans/5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f/prices HTTP/1.1
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "stripePriceId": "price_1ABCxyz",
  "currency": "usd",
  "unitAmount": 1900,
  "type": "recurring",
  "interval": "month",
  "trialPeriodDays": 7,
  "active": true
}
```

**Example request — one-time**

```http
POST /api/admin/plans/7a91c2bf-1234-4abc-9def-0123456789ab/prices HTTP/1.1
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "stripePriceId": "price_1DEFxyz",
  "currency": "usd",
  "unitAmount": 999,
  "type": "one_time",
  "active": true
}
```

**Example response — `201 Created`**

```json
{
  "id": "1d2b6c91-9b9b-4d1d-9c08-2f2a3b4c5d6e",
  "planId": "5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f",
  "stripePriceId": "price_1ABCxyz",
  "stripeProductId": null,
  "currency": "usd",
  "unitAmount": 1900,
  "type": "recurring",
  "interval": "month",
  "trialPeriodDays": 7,
  "active": true,
  "createdAt": "2026-06-08T10:05:00.000Z",
  "updatedAt": "2026-06-08T10:05:00.000Z"
}
```

**Errors**

| Status | When                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------- |
| 400    | Validation error; `interval` missing when `type=recurring`; `interval` present when `type=one_time` |
| 401    | Missing/invalid JWT                                                                                 |
| 403    | Not admin                                                                                           |
| 404    | Plan not found (bad UUID)                                                                           |

### 5.7 `GET /api/admin/plans/:id/prices` – List prices for a plan

**Path parameters**

| Field | Type | Notes           |
| ----- | ---- | --------------- |
| `id`  | UUID | Local plan UUID |

**Example request**

```http
GET /api/admin/plans/5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f/prices HTTP/1.1
Authorization: Bearer <admin_token>
```

**Example response — `200 OK`**

```json
[
  {
    "id": "1d2b6c91-9b9b-4d1d-9c08-2f2a3b4c5d6e",
    "planId": "5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f",
    "stripePriceId": "price_1ABCxyz",
    "stripeProductId": "prod_1ABCxyz",
    "currency": "usd",
    "unitAmount": 1900,
    "type": "recurring",
    "interval": "month",
    "trialPeriodDays": 7,
    "active": true,
    "createdAt": "2026-05-01T10:00:00.000Z",
    "updatedAt": "2026-05-01T10:00:00.000Z"
  }
]
```

**Empty case — `200 OK`**

```json
[]
```

**Errors**

| Status | When                |
| ------ | ------------------- |
| 401    | Missing/invalid JWT |
| 403    | Not admin           |

### 5.8 `PATCH /api/admin/plans/prices/:id` – Deactivate a price

Sets the price's `active` flag to `false`. This hides it from the public plans listing.

> [!NOTE]
> Prices are **deactivated** not deleted. This is intentional — existing subscriptions referencing a deactivated price continue to work.

**Path parameters**

| Field | Type | Notes                              |
| ----- | ---- | ---------------------------------- |
| `id`  | UUID | Local **price** UUID (not plan id) |

**Request body**: none.

**Example request**

```http
PATCH /api/admin/plans/prices/1d2b6c91-9b9b-4d1d-9c08-2f2a3b4c5d6e HTTP/1.1
Authorization: Bearer <admin_token>
```

**Example response — `200 OK`**

```json
{
  "id": "1d2b6c91-9b9b-4d1d-9c08-2f2a3b4c5d6e",
  "planId": "5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f",
  "stripePriceId": "price_1ABCxyz",
  "stripeProductId": "prod_1ABCxyz",
  "currency": "usd",
  "unitAmount": 1900,
  "type": "recurring",
  "interval": "month",
  "trialPeriodDays": 7,
  "active": false,
  "createdAt": "2026-05-01T10:00:00.000Z",
  "updatedAt": "2026-06-08T14:00:00.000Z"
}
```

**Errors**

| Status | When                |
| ------ | ------------------- |
| 401    | Missing/invalid JWT |
| 403    | Not admin           |
| 404    | Price not found     |

---

## 6. Data Model – Response Shapes

### 6.1 `PlanResponseDto`

| Field          | Type                 | Nullable | Notes                                   |
| -------------- | -------------------- | :------: | --------------------------------------- |
| `id`           | UUID                 |          | Local plan UUID                         |
| `code`         | string               |          | Stable slug code (e.g. `pro_monthly`)   |
| `name`         | string               |          | Display name                            |
| `description`  | string               |    ✅    | Long description text                   |
| `status`       | `BillingPlanStatus`  |          | `draft` / `active` / `archived`         |
| `features`     | `string[]`           |          | List of feature keys                    |
| `displayOrder` | integer              |          | Sort order on pricing page              |
| `icon`         | string               |    ✅    | Icon URL or class name                  |
| `highlight`    | boolean              |          | Recommended plan flag                   |
| `prices`       | `PriceResponseDto[]` |          | Associated prices (empty array if none) |
| `createdAt`    | ISO 8601             |          |                                         |
| `updatedAt`    | ISO 8601             |          |                                         |

### 6.2 `PriceResponseDto`

| Field             | Type                               | Nullable | Notes                                            |
| ----------------- | ---------------------------------- | :------: | ------------------------------------------------ |
| `id`              | UUID                               |          | Local price UUID — **use this for checkout**     |
| `planId`          | UUID                               |          | Parent plan UUID                                 |
| `stripePriceId`   | string                             |          | Stripe `price_*` id                              |
| `stripeProductId` | string                             |    ✅    | Stripe `prod_*` id                               |
| `currency`        | string                             |          | 3-letter lowercase ISO-4217 (e.g. `usd`)         |
| `unitAmount`      | integer                            |          | Amount in **minor units** (cents for `usd`)      |
| `type`            | `BillingPriceType`                 |          | `one_time` or `recurring`                        |
| `interval`        | `BillingRecurringInterval \| null` |    ✅    | `day`/`week`/`month`/`year`; null for `one_time` |
| `trialPeriodDays` | integer \| null                    |    ✅    | Trial period in days                             |
| `active`          | boolean                            |          | Whether this price is currently active           |
| `createdAt`       | ISO 8601                           |          |                                                  |
| `updatedAt`       | ISO 8601                           |          |                                                  |

### 6.3 `UserSubscriptionHistoryItemDto`

| Field                | Type                        | Nullable | Notes                                          |
| -------------------- | --------------------------- | :------: | ---------------------------------------------- |
| `id`                 | UUID                        |          | Local subscription UUID                        |
| `status`             | `BillingSubscriptionStatus` |          | `active`/`trialing`/`past_due`/`canceled`/etc. |
| `planName`           | string                      |    ✅    | Plan display name                              |
| `priceCurrency`      | string                      |    ✅    | 3-letter currency code                         |
| `priceUnitAmount`    | integer                     |    ✅    | Amount in minor units                          |
| `priceInterval`      | string                      |    ✅    | `day`/`week`/`month`/`year`                    |
| `currentPeriodStart` | ISO 8601                    |    ✅    | Start of current billing period                |
| `currentPeriodEnd`   | ISO 8601                    |    ✅    | End of current billing period                  |
| `trialEnd`           | ISO 8601                    |    ✅    | End of trial period (if trialing)              |
| `cancelAtPeriodEnd`  | boolean                     |          | Whether cancellation is scheduled              |
| `canceledAt`         | ISO 8601                    |    ✅    | When the subscription was canceled             |
| `createdAt`          | ISO 8601                    |          | When the subscription was created              |

### 6.4 `SubscriptionHistoryResponseDto`

| Field            | Type     | Nullable | Notes                                              |
| ---------------- | -------- | :------: | -------------------------------------------------- |
| `id`             | UUID     |          | History record UUID                                |
| `subscriptionId` | UUID     |    ✅    | Related subscription UUID                          |
| `previousStatus` | string   |    ✅    | Previous subscription status (null on first event) |
| `newStatus`      | string   |          | New subscription status                            |
| `planId`         | UUID     |    ✅    | Related plan UUID                                  |
| `priceId`        | UUID     |    ✅    | Related price UUID                                 |
| `reason`         | string   |    ✅    | Description of what triggered the change           |
| `occurredAt`     | ISO 8601 |          | When the status change occurred                    |
| `createdAt`      | ISO 8601 |          | When the record was created                        |

### 6.5 `UserPaymentHistoryItemDto`

| Field             | Type     | Nullable | Notes                                         |
| ----------------- | -------- | :------: | --------------------------------------------- |
| `id`              | UUID     |          | Local payment UUID                            |
| `amount`          | integer  |          | Total amount in minor units                   |
| `amountRefunded`  | integer  |          | Amount refunded in minor units                |
| `currency`        | string   |          | 3-letter lowercase ISO-4217                   |
| `status`          | string   |          | Payment status (e.g. `succeeded`, `refunded`) |
| `description`     | string   |    ✅    | Human-readable description                    |
| `subscriptionId`  | UUID     |    ✅    | Related subscription UUID                     |
| `invoiceNumber`   | string   |    ✅    | Stripe invoice number                         |
| `transactionType` | string   |          | `charge` or `refund` (derived)                |
| `createdAt`       | ISO 8601 |          | When the payment was created                  |

---

## 7. Frontend Integration Patterns

### 7.1 Pricing Page

```ts
// 1. Fetch plans on page load
const plans = await fetch('/api/plans').then((r) => r.json());

// 2. Sort by displayOrder
plans.sort((a, b) => a.displayOrder - b.displayOrder);

// 3. Render plan cards
plans.forEach((plan) => {
  const isHighlighted = plan.highlight;
  const prices = plan.prices.filter((p) => p.active);

  // For each price, show formatted amount
  prices.forEach((price) => {
    const displayAmount = price.unitAmount / 100;
    const currency = price.currency.toUpperCase();
    const interval = price.interval ? `/${price.interval}` : '';
    // Display: $19.00/month
  });

  // When user selects a price, use price.id for the checkout endpoint
  // in the billing module
});
```

### 7.2 Subscription Status Badge

Map `status` to visual badges:

| Status               | Badge colour | Notes                                    |
| -------------------- | ------------ | ---------------------------------------- |
| `active`             | 🟢 Green     | Active subscription                      |
| `trialing`           | 🔵 Blue      | In trial period; show trial end date     |
| `past_due`           | 🟡 Yellow    | Payment overdue; show warning            |
| `canceled`           | ⚪ Gray      | No longer active                         |
| `unpaid`             | 🔴 Red       | Payment failed; access may be restricted |
| `incomplete`         | 🟠 Orange    | Initial checkout not completed           |
| `paused`             | ⚪ Gray      | Subscription paused by user              |
| `incomplete_expired` | ⚪ Gray      | Checkout session expired                 |

### 7.3 Payment History

```ts
// Fetch paginated payment history
const { items, total, page, limit, totalPages } = await fetch(
  '/api/payments/history?page=1&limit=20',
).then((r) => r.json());

// Render transaction rows
items.forEach((payment) => {
  const isRefund = payment.transactionType === 'refund';
  const netAmount = isRefund ? -payment.amountRefunded : payment.amount;
  const formattedAmount = `$${(payment.amount / 100).toFixed(2)}`;
});
```

### 7.4 Admin Plan Management

```ts
// Plan list page
const plans = await fetch('/api/admin/plans').then((r) => r.json());

// Create a plan
const newPlan = await fetch('/api/admin/plans', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    code: 'enterprise_yearly',
    name: 'Enterprise',
    description: 'Enterprise features billed yearly.',
    features: ['all_features', 'dedicated_support'],
    displayOrder: 0,
    highlight: true,
  }),
}).then((r) => r.json());
// Response: { plan: { id, code, name, ... } }

// Update a plan (partial update)
const updated = await fetch(`/api/admin/plans/${planId}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Updated Name',
    features: ['feat_a', 'feat_b'],
  }),
}).then((r) => r.json());

// Archive a plan
const archived = await fetch(`/api/admin/plans/${planId}/archive`, {
  method: 'POST',
}).then((r) => r.json());

// Add a price
const newPrice = await fetch(`/api/admin/plans/${planId}/prices`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    stripePriceId: 'price_1ABCxyz',
    currency: 'usd',
    unitAmount: 1900,
    type: 'recurring',
    interval: 'month',
    trialPeriodDays: 7,
    active: true,
  }),
}).then((r) => r.json());

// Deactivate a price
const deactivated = await fetch(`/api/admin/plans/prices/${priceId}`, {
  method: 'PATCH',
}).then((r) => r.json());
```

### 7.5 Error Handling

```ts
async function apiCall(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    credentials: 'include', // send JWT cookie
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    switch (res.status) {
      case 401:
        // Redirect to login
        window.location.href = '/login';
        break;
      case 403:
        // Show "Access denied" toast
        break;
      case 404:
        // Show "Not found" message
        break;
      case 409:
        // Show conflict error message
        break;
      case 400:
        // Show validation errors
        break;
    }
    throw new Error(error.message || `HTTP ${res.status}`);
  }

  return res.json();
}
```

---

## 8. Complete Endpoint Reference

| #   | Method  | Path                                         | Auth   | Description                             |
| --- | ------- | -------------------------------------------- | ------ | --------------------------------------- |
| 1   | `GET`   | `/api/plans`                                 | Public | List active plans with prices           |
| 2   | `POST`  | `/api/admin/plans`                           | Admin  | Create a plan                           |
| 3   | `GET`   | `/api/admin/plans`                           | Admin  | List all plans (optional status filter) |
| 4   | `GET`   | `/api/admin/plans/:id`                       | Admin  | Get plan detail with prices             |
| 5   | `PATCH` | `/api/admin/plans/:id`                       | Admin  | Update a plan                           |
| 6   | `POST`  | `/api/admin/plans/:id/archive`               | Admin  | Archive a plan                          |
| 7   | `POST`  | `/api/admin/plans/:id/prices`                | Admin  | Add a price to a plan                   |
| 8   | `GET`   | `/api/admin/plans/:id/prices`                | Admin  | List prices for a plan                  |
| 9   | `PATCH` | `/api/admin/plans/prices/:id`                | Admin  | Deactivate a price                      |
| 10  | `GET`   | `/api/subscriptions/current`                 | User   | Get current active subscription         |
| 11  | `GET`   | `/api/subscriptions/history`                 | User   | Get paginated subscription history      |
| 12  | `GET`   | `/api/subscriptions/history/:subscriptionId` | User   | Get subscription timeline               |
| 13  | `GET`   | `/api/payments/history`                      | User   | Get paginated payment history           |
| 14  | `GET`   | `/api/payments/:id`                          | User   | Get payment detail                      |

---

## 9. Related Billing Module Endpoints

These are **not** part of the Plans & Subscriptions module but are critical for the end-to-end flow. They live in the **Billing module** (`src/billing`). Refer to `integrations/BILLING_MODULE_INTEGRATION.md` for full details.

| Method | Path                                 | Purpose                             |
| ------ | ------------------------------------ | ----------------------------------- |
| `GET`  | `/api/billing/plans/public`          | Public plans (with currency filter) |
| `POST` | `/api/billing/checkout/subscription` | Start subscription checkout         |
| `POST` | `/api/billing/checkout/one-time`     | Start one-time payment checkout     |
| `POST` | `/api/billing/portal/session`        | Open Stripe Customer Portal         |
| `GET`  | `/api/billing/entitlements`          | Get user's feature entitlements     |
| `GET`  | `/api/billing/customer`              | Get billing customer record         |

> [!IMPORTANT]
> For subscribing or making one-time purchases, use the **Billing module checkout endpoints** (which require the local price UUID from `GET /api/plans`). For managing active subscriptions (upgrade, downgrade, cancel payment methods), use the **Stripe Customer Portal** via the billing portal session endpoint. The two modules work together: **Plans & Subscriptions** shows what's available and what the user has; **Billing** handles the Stripe transaction flow.
