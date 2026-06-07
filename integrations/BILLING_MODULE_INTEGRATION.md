# Billing Module – Frontend Integration Plan

> Base URL: `/api` (set in `src/main.ts` via `app.setGlobalPrefix('api')`)
> Resource: `billing`
> Module path: `src/billing`
> Swagger tags: `Billing - Public`, `Billing - Customer`, `Billing - Admin`, `Billing - Webhooks`
> Stripe API version pinned: `2026-05-27.dahlia`

The **Billing** module wraps Stripe and exposes it through a tightly-controlled HTTP surface. It implements checkout (one-time + subscription), the Stripe Customer Portal, server-side plan/price catalog management, entitlements / feature gating, webhook ingestion, and admin operations (refunds, failed-webhook replay, operational overview).

> [!IMPORTANT]
> **Key frontend rules**
> 1. The frontend **never** sends prices, amounts, currencies, or Stripe ids. It only sends the **local** `BillingPrice` UUID from the public plans endpoint and the idempotency key.
> 2. Every Checkout and Portal endpoint **requires** an `Idempotency-Key` header. Generate a new key per logical user action (button click), and **reuse the same key on retries** within a few minutes.
> 3. Checkout responses contain a short-lived `url` — redirect the user there immediately, do not store it.
> 4. Stripe webhooks are sent by Stripe, **not** by the browser. There is no frontend code path that calls `POST /api/billing/webhooks/stripe`. Configure the URL + signing secret in the Stripe dashboard (the backend verifies the `Stripe-Signature` header).
> 5. The currency is determined by the **active price** the user selects; the public plans endpoint supports `?currency=usd` to filter to a single currency.

---

## 1. Module Overview

| Concern               | Detail                                                                              |
| --------------------- | ----------------------------------------------------------------------------------- |
| Base path (public)    | `/api/billing/plans/public`                                                         |
| Base path (user)      | `/api/billing/*` (requires JWT)                                                     |
| Base path (admin)     | `/api/billing/admin/*` (requires JWT + role `ADMIN`)                                |
| Webhook path          | `/api/billing/webhooks/stripe` (called by Stripe, not the browser)                   |
| Auth (user)           | JWT Bearer (global `AuthGuard`); cookie `sanad_auth_token` is honored on web builds |
| Auth (admin)          | JWT Bearer + `Roles(UserRoleEnum.ADMIN)` + `RolesGuard`                             |
| Rate limit            | Global `@nestjs/throttler`; webhook is `@SkipThrottle()`                            |
| Persistence           | TypeORM tables: `billing_customers`, `billing_plans`, `billing_prices`, `billing_subscriptions`, `billing_payments`, `billing_invoices`, `billing_transactions`, `billing_webhook_events`, `billing_idempotency_keys`, `billing_entitlements` |
| Idempotency TTL       | 24h (mirrors Stripe's window) — `DEFAULT_IDEMPOTENCY_TTL_MS`                        |

### 1.1 Authorization Matrix

| Endpoint                                       | Public | User  | Admin | Stripe |
| ---------------------------------------------- | :----: | :---: | :---: | :----: |
| `GET  /api/billing/plans/public`               |   ✅   |       |       |        |
| `GET  /api/billing/customer`                   |        |  ✅   |       |        |
| `POST /api/billing/customer/sync`              |        |  ✅   |       |        |
| `POST /api/billing/portal/session`             |        |  ✅   |       |        |
| `POST /api/billing/checkout/one-time`          |        |  ✅   |       |        |
| `POST /api/billing/checkout/subscription`      |        |  ✅   |       |        |
| `GET  /api/billing/entitlements`               |        |  ✅   |       |        |
| `POST /api/billing/admin/plans`                |        |       |  ✅   |        |
| `GET  /api/billing/admin/plans`                |        |       |  ✅   |        |
| `PATCH /api/billing/admin/plans/:id`           |        |       |  ✅   |        |
| `POST /api/billing/admin/plans/:id/archive`    |        |       |  ✅   |        |
| `POST /api/billing/admin/plans/:id/prices`     |        |       |  ✅   |        |
| `GET  /api/billing/admin/overview`             |        |       |  ✅   |        |
| `GET  /api/billing/admin/webhooks/failed`      |        |       |  ✅   |        |
| `POST /api/billing/admin/webhooks/:id/replay`  |        |       |  ✅   |        |
| `POST /api/billing/admin/payments/:id/refund`  |        |       |  ✅   |        |
| `POST /api/billing/webhooks/stripe`            |        |       |       |  ✅    |

### 1.2 Enums (shared with frontend)

```ts
// Plan lifecycle
enum BillingPlanStatus {
  DRAFT    = 'draft',
  ACTIVE   = 'active',
  ARCHIVED = 'archived',
}

// Price shape
enum BillingPriceType {
  ONE_TIME  = 'one_time',
  RECURRING = 'recurring',
}

enum BillingRecurringInterval {
  DAY   = 'day',
  WEEK  = 'week',
  MONTH = 'month',
  YEAR  = 'year',
}

// Subscription lifecycle (mirrors Stripe)
enum BillingSubscriptionStatus {
  INCOMPLETE         = 'incomplete',
  TRIALING           = 'trialing',
  ACTIVE             = 'active',
  PAST_DUE           = 'past_due',
  CANCELED           = 'canceled',
  UNPAID             = 'unpaid',
  PAUSED             = 'paused',
  INCOMPLETE_EXPIRED = 'incomplete_expired',
}

// Payment lifecycle
enum BillingPaymentStatus {
  CHECKOUT_CREATED     = 'checkout_created',
  PENDING              = 'pending',
  SUCCEEDED            = 'succeeded',
  FAILED               = 'failed',
  CANCELED             = 'canceled',
  REFUNDED             = 'refunded',
  PARTIALLY_REFUNDED   = 'partially_refunded',
}

// Invoice lifecycle
enum BillingInvoiceStatus {
  DRAFT          = 'draft',
  OPEN           = 'open',
  PAID           = 'paid',
  VOID           = 'void',
  UNCOLLECTIBLE  = 'uncollectible',
}

// Transaction (charges + refunds)
enum BillingTransactionType   { CHARGE = 'charge', REFUND = 'refund' }
enum BillingTransactionStatus { PENDING = 'pending', SUCCEEDED = 'succeeded', FAILED = 'failed' }

// Webhook event
enum BillingWebhookEventStatus {
  RECEIVED  = 'received',
  PROCESSED = 'processed',
  FAILED    = 'failed',
  IGNORED   = 'ignored',
}

// Where an entitlement came from
enum BillingEntitlementSourceType {
  SUBSCRIPTION   = 'subscription',
  ONE_TIME_PAYMENT = 'one_time_payment',
  MANUAL         = 'manual',
}

// Webhook ACK kinds (response enum)
type BillingWebhookAckKind = 'processed' | 'duplicate' | 'ignored' | 'failed';
```

### 1.3 Common Error Responses

All errors are translated by the global `GlobalExceptionFilter`.

| HTTP | Meaning                                                                                       | Body shape                                                                                  |
| ---- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 400  | Validation / business rule (`ValidationPipe`, `BadRequestException`, custom `BillingError`)   | `{ "statusCode": 400, "message": "...", "error": "Bad Request" }`                           |
| 401  | Missing or invalid JWT                                                                        | `{ "statusCode": 401, "message": "Unauthorized" }`                                          |
| 403  | Forbidden — admin-only route, or `FeatureAccessGuard` denies a feature key                    | `{ "statusCode": 403, "message": "Forbidden ..." }`                                         |
| 404  | Resource not found (price, plan, payment, webhook event, customer)                            | `{ "statusCode": 404, "message": "... not found." }`                                        |
| 409  | Conflict — duplicate plan code, duplicate Stripe price, price not active, etc.               | `{ "statusCode": 409, "message": "..." }`                                                   |
| 422  | Webhook handler error (e.g. unrecognised subscription) — Stripe will retry                   | `{ "statusCode": 422, "message": "..." }`                                                   |
| 429  | Rate limit exceeded (global `ThrottlerGuard`); webhook is exempt                              | `{ "statusCode": 429, "message": "ThrottlerException: Too Many Requests" }`                 |

### 1.4 Required Headers

| Header               | Where                                          | Notes                                                                                  |
| -------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Authorization`      | All authed user/admin endpoints                | `Bearer <access_token>` (cookie `sanad_auth_token` is also accepted)                   |
| `Idempotency-Key`    | `portal/session`, `checkout/*`, admin refund   | Required. 1–255 chars, trimmed. Server caches the response for 24h.                    |
| `Content-Type`       | All `POST`/`PATCH` endpoints                   | `application/json`                                                                     |
| `Stripe-Signature`   | `webhooks/stripe` (set by Stripe, not browser) | Required by Stripe; missing → `400 Bad Request`                                        |

> **Idempotency contract**: same key + **same body** → cached response. Same key + **different body** → `409 Conflict`. Always send the same key on retries triggered by the same user action.

---

## 2. Data Model

The fields below are the ones the **frontend actually sees** in API responses. Internal-only columns (e.g. `metadata` jsonb, `password`, snapshot blobs) are not exposed.

### 2.1 `BillingCustomer`

| Field              | Type             | Notes                                                       |
| ------------------ | ---------------- | ----------------------------------------------------------- |
| `id`               | UUID string      | Local row id                                                |
| `userId`           | number           | Application user id                                         |
| `stripeCustomerId` | string           | `cus_*` — safe to expose, not a secret                      |
| `email`            | string           | Mirrored from the user                                      |
| `name`             | string \| null   | Mirrored from the user                                      |
| `createdAt`        | ISO 8601         |                                                             |
| `updatedAt`        | ISO 8601         |                                                             |

### 2.2 `BillingPlan` (admin + public variants)

| Field         | Type                                              | Notes                                                  |
| ------------- | ------------------------------------------------- | ------------------------------------------------------ |
| `id`          | UUID                                              |                                                        |
| `code`        | string                                            | Stable; e.g. `pro_monthly`                             |
| `name`        | string                                            | Display name                                           |
| `description` | string \| null                                    |                                                        |
| `status`      | `BillingPlanStatus`                               | `draft` \| `active` \| `archived` (admin only)         |
| `features`    | `string[]`                                        | Stable feature keys (e.g. `["premium_reports"]`)       |
| `prices`      | `BillingPrice[]`                                  | Empty array if no active prices (public omits the plan)|
| `createdAt`   | ISO 8601                                          | Admin only                                             |
| `updatedAt`   | ISO 8601                                          | Admin only                                             |

> Public variant (`BillingPublicPlanResponseDto`) returns only `id`, `code`, `name`, `description`, `features`, `prices` — no `status`/`createdAt`/`updatedAt`, and **only `status=active` plans with at least one active price are returned**.

### 2.3 `BillingPrice`

| Field              | Type                          | Notes                                                      |
| ------------------ | ----------------------------- | ---------------------------------------------------------- |
| `id`               | UUID                          | **This is the value the frontend must send back.**         |
| `planId`           | UUID                          |                                                            |
| `stripePriceId`    | string                        | `price_*` — never sent by the client                       |
| `stripeProductId`  | string \| null                | `prod_*`                                                   |
| `currency`         | string                        | 3-letter lowercase ISO-4217 (`usd`, `eur`, …)              |
| `unitAmount`       | number                        | Amount in the **smallest** currency unit (cents for `usd`)|
| `type`             | `BillingPriceType`            | `one_time` \| `recurring`                                  |
| `interval`         | `BillingRecurringInterval\|null` | `day`/`week`/`month`/`year`; required for `recurring`    |
| `trialPeriodDays`  | number \| null                | Plan-level trial default; can be overridden per checkout   |
| `active`           | boolean                       | Inactive prices are hidden on the public list              |
| `createdAt`        | ISO 8601                      |                                                            |
| `updatedAt`        | ISO 8601                      |                                                            |

### 2.4 `BillingSubscription` (internal — not directly returned)

| Field                     | Type                            |
| ------------------------- | ------------------------------- |
| `id`                      | UUID                            |
| `userId`                  | number                          |
| `billingCustomerId`       | UUID                            |
| `planId`                  | UUID \| null                    |
| `priceId`                 | UUID \| null                    |
| `stripeSubscriptionId`    | string                          |
| `stripeCheckoutSessionId` | string \| null                  |
| `status`                  | `BillingSubscriptionStatus`     |
| `currentPeriodStart`      | Date \| null                    |
| `currentPeriodEnd`        | Date \| null                    |
| `trialEnd`                | Date \| null                    |
| `cancelAtPeriodEnd`       | boolean                         |
| `canceledAt`              | Date \| null                    |
| `latestInvoiceId`         | string \| null                  |

### 2.5 `BillingPayment` (internal — surfaced indirectly)

| Field                      | Type                       |
| -------------------------- | -------------------------- |
| `id`                       | UUID                       |
| `userId`                   | number                     |
| `billingCustomerId`        | UUID                       |
| `priceId`                  | UUID \| null               |
| `stripeCheckoutSessionId`  | string \| null             |
| `stripePaymentIntentId`    | string \| null             |
| `amount`                   | number (minor units)       |
| `amountRefunded`           | number (minor units)       |
| `currency`                 | string                     |
| `status`                   | `BillingPaymentStatus`     |
| `description`              | string \| null             |

### 2.6 `BillingInvoice` (internal)

| Field               | Type                        |
| ------------------- | --------------------------- |
| `id`                | UUID                        |
| `userId`            | number                      |
| `subscriptionId`    | UUID \| null                |
| `stripeInvoiceId`   | string                      |
| `number`            | string \| null              |
| `status`            | `BillingInvoiceStatus`      |
| `currency`          | string                      |
| `subtotal`, `total` | number                      |
| `amountPaid`        | number                      |
| `amountDue`         | number                      |
| `hostedInvoiceUrl`  | string \| null              |
| `invoicePdf`        | string \| null              |
| `periodStart`       | Date \| null                |
| `periodEnd`         | Date \| null                |
| `paidAt`            | Date \| null                |

### 2.7 `BillingTransaction` (internal)

| Field                  | Type                          |
| ---------------------- | ----------------------------- |
| `id`                   | UUID                          |
| `userId`               | number                        |
| `paymentId`            | UUID \| null                  |
| `invoiceId`            | UUID \| null                  |
| `subscriptionId`       | UUID \| null                  |
| `type`                 | `BillingTransactionType`      |
| `amount`               | number                        |
| `currency`             | string                        |
| `status`               | `BillingTransactionStatus`    |
| `stripePaymentIntentId`| string \| null                |
| `stripeChargeId`       | string \| null                |
| `stripeRefundId`       | string \| null                |
| `occurredAt`           | Date                          |

### 2.8 `BillingEntitlement` (returned by `GET /entitlements`)

| Field         | Type                                  | Notes                                          |
| ------------- | ------------------------------------- | ---------------------------------------------- |
| `featureKey`  | string                                | Stable feature key (e.g. `premium_reports`)    |
| `sourceType`  | `BillingEntitlementSourceType`        |                                                |
| `sourceId`    | UUID \| null                          | Local id of the source row; `null` for `manual`|
| `startsAt`    | Date \| null                          | Stored, not enforced in v1                     |
| `endsAt`      | Date \| null                          | Stored, not enforced in v1                     |

### 2.9 `BillingWebhookEvent` (admin)

| Field                | Type                          | Notes                                          |
| -------------------- | ----------------------------- | ---------------------------------------------- |
| `id`                 | UUID                          | Local row id (use this for `replay`)           |
| `stripeEventId`      | string                        | `evt_*`                                        |
| `eventType`          | string                        | e.g. `invoice.paid`                            |
| `errorMessage`       | string \| null                | Set on `failed`                                |
| `processingAttempts` | number                        |                                                |
| `status`             | `BillingWebhookEventStatus`   |                                                |
| `receivedAt`         | Date                          |                                                |
| `processedAt`        | Date \| null                  |                                                |

---

## 3. Public Endpoints

### 3.1 `GET /api/billing/plans/public` – List active plans and prices

Used by the marketing/pricing page. No auth.

**Query (`ListBillingPublicPlansQueryDto`)**

| Field      | Type   | Required | Constraints                              |
| ---------- | ------ | :------: | ---------------------------------------- |
| `currency` | string |          | 3-letter lowercase ISO-4217 (e.g. `usd`) |

**Example request**

```http
GET /api/billing/plans/public?currency=usd HTTP/1.1
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
    "features": ["premium_reports", "team_export"],
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
    ]
  },
  {
    "id": "7a91c2bf-1234-4abc-9def-0123456789ab",
    "code": "credits_pack",
    "name": "200 Credits",
    "description": "Top up your account with 200 credits.",
    "features": [],
    "prices": [
      {
        "id": "0f0e0d0c-0b0a-0908-0706-050403020100",
        "planId": "7a91c2bf-1234-4abc-9def-0123456789ab",
        "stripePriceId": "price_1DEFxyz",
        "stripeProductId": "prod_1DEFxyz",
        "currency": "usd",
        "unitAmount": 999,
        "type": "one_time",
        "interval": null,
        "trialPeriodDays": null,
        "active": true,
        "createdAt": "2026-05-01T10:00:00.000Z",
        "updatedAt": "2026-05-01T10:00:00.000Z"
      }
    ]
  }
]
```

**Empty case — `200 OK`**

```json
[]
```

**Errors**

| Status | When                               |
| ------ | ---------------------------------- |
| 400    | `currency` is not 3 lowercase letters |

---

## 4. Authenticated User Endpoints

All endpoints in this section require a valid JWT (`Authorization: Bearer <token>` or the `sanad_auth_token` cookie). The current user is resolved from the JWT `id` claim; you never send the user id in the path or body.

### 4.1 `GET /api/billing/customer` – Get (or lazily create) the billing customer

Returns the local `BillingCustomer` row. On first call, the backend **lazily creates** a Stripe Customer (mirrored locally) for the current user, so this endpoint is safe to call as soon as the user logs in.

**Example request**

```http
GET /api/billing/customer HTTP/1.1
Authorization: Bearer <access_token>
```

**Example response — `200 OK`**

```json
{
  "id": "9b8e0a72-1f3a-4d4b-9c6e-7a5b3c2d1e0f",
  "userId": 42,
  "stripeCustomerId": "cus_QwErTy123456",
  "email": "jane.doe@example.com",
  "name": "Jane Doe",
  "createdAt": "2026-05-12T08:30:00.000Z",
  "updatedAt": "2026-05-12T08:30:00.000Z"
}
```

**Errors**

| Status | When                          |
| ------ | ----------------------------- |
| 401    | Missing/invalid JWT           |

### 4.2 `POST /api/billing/customer/sync` – Force re-link with Stripe

Same as `GET /api/billing/customer`, but always re-resolves through Stripe. Useful for "fix my account" buttons after a support ticket.

**Request body**: none.

**Example request**

```http
POST /api/billing/customer/sync HTTP/1.1
Authorization: Bearer <access_token>
```

**Example response — `200 OK`** (same shape as `GET /api/billing/customer`)

```json
{
  "id": "9b8e0a72-1f3a-4d4b-9c6e-7a5b3c2d1e0f",
  "userId": 42,
  "stripeCustomerId": "cus_QwErTy123456",
  "email": "jane.doe@example.com",
  "name": "Jane Doe",
  "createdAt": "2026-05-12T08:30:00.000Z",
  "updatedAt": "2026-05-12T08:30:00.000Z"
}
```

**Errors**: same as 4.1.

### 4.3 `POST /api/billing/portal/session` – Open the Stripe Customer Portal

Creates a short-lived Stripe Customer Portal URL and returns it. The frontend should `window.location.href = url` (or open in a new tab).

> Stripe manages subscriptions, payment methods, plan changes, cancellations, and invoice downloads inside the portal. v1 does **not** expose REST endpoints for those operations; the portal is the canonical UI.

**Required headers**

| Header            | Value         |
| ----------------- | ------------- |
| `Idempotency-Key` | `<unique key>`|

**Request body**: none.

**Example request**

```http
POST /api/billing/portal/session HTTP/1.1
Authorization: Bearer <access_token>
Idempotency-Key: 8a7c3e1d-4b21-4a2f-9a6b-1a2b3c4d5e6f
```

**Example response — `200 OK`**

```json
{
  "url": "https://billing.stripe.com/p/session/test_YWNjY291bnQ"
}
```

**Errors**

| Status | When                                                                |
| ------ | ------------------------------------------------------------------- |
| 400    | `Idempotency-Key` header missing/empty                              |
| 401    | Missing/invalid JWT                                                 |
| 409    | Idempotency key reused with a different body                        |

### 4.4 `POST /api/billing/checkout/one-time` – Start a one-time Checkout

Creates a Stripe Checkout Session for a one-time payment and returns the redirect URL.

**Required headers**

| Header            | Value         |
| ----------------- | ------------- |
| `Idempotency-Key` | `<unique key>`|

**Request body (`BillingOneTimeCheckoutRequestDto`)**

| Field                 | Type    | Required | Default | Constraints                                                                  |
| --------------------- | ------- | :------: | ------- | ---------------------------------------------------------------------------- |
| `priceId`             | UUID    |   ✅     |         | Local `BillingPrice` UUID from the public plans endpoint                    |
| `quantity`            | integer |          | `1`     | 1–100                                                                        |
| `allowPromotionCodes` | boolean |          | `true`  |                                                                              |

**Example request**

```http
POST /api/billing/checkout/one-time HTTP/1.1
Authorization: Bearer <access_token>
Idempotency-Key: 3a4b5c6d-7e8f-9a0b-1c2d-3e4f5a6b7c8d
Content-Type: application/json

{
  "priceId": "0f0e0d0c-0b0a-0908-0706-050403020100",
  "quantity": 1,
  "allowPromotionCodes": true
}
```

**Example response — `200 OK`**

```json
{
  "sessionId": "cs_test_a1b2c3d4e5f6",
  "url": "https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4e5f6#fidkdWxOYHwnPyd1blpxYHZxWjA0TjE0PWF..."
}
```

> [!NOTE]
> The success URL is configured server-side via `STRIPE_SUCCESS_URL`. The backend appends `?session_id={CHECKOUT_SESSION_ID}` (or honours the placeholder if already present), so the post-checkout page can read `session_id` from the query string to display a receipt.

**Errors**

| Status | When                                                                                          |
| ------ | --------------------------------------------------------------------------------------------- |
| 400    | `Idempotency-Key` missing; body validation                                                    |
| 401    | Missing/invalid JWT                                                                           |
| 404    | `BillingPrice` not found                                                                      |
| 409    | Price is `inactive`, price type is not `one_time`, or user already has an active subscription |

### 4.5 `POST /api/billing/checkout/subscription` – Start a subscription Checkout

Creates a Stripe Checkout Session for a recurring plan. **One active subscription per user** is enforced in v1 — to change plan, use the Customer Portal.

**Required headers**

| Header            | Value         |
| ----------------- | ------------- |
| `Idempotency-Key` | `<unique key>`|

**Request body (`BillingSubscriptionCheckoutRequestDto`)**

| Field                 | Type    | Required | Default | Constraints                                                                                                  |
| --------------------- | ------- | :------: | ------- | ------------------------------------------------------------------------------------------------------------ |
| `priceId`             | UUID    |   ✅     |         | Local `BillingPrice` UUID of a **recurring** price                                                           |
| `quantity`            | integer |          | `1`     | 1–100 (seats)                                                                                                |
| `clientReferenceId`   | string  |          |         | Max 100 chars; `[A-Za-z0-9._:-]+` only; forwarded to Stripe as `client_reference_id` and stored in metadata |
| `trialDays`           | integer |          |         | 1–730; overrides the price-level `trialPeriodDays` if set                                                    |
| `allowPromotionCodes` | boolean |          | `true`  |                                                                                                              |

**Example request**

```http
POST /api/billing/checkout/subscription HTTP/1.1
Authorization: Bearer <access_token>
Idempotency-Key: 9d8c7b6a-5e4d-3c2b-1a0f-fedcba987654
Content-Type: application/json

{
  "priceId": "1d2b6c91-9b9b-4d1d-9c08-2f2a3b4c5d6e",
  "quantity": 1,
  "clientReferenceId": "team-42-onboarding",
  "trialDays": 14,
  "allowPromotionCodes": true
}
```

**Example response — `200 OK`**

```json
{
  "sessionId": "cs_test_f0e1d2c3b4a5",
  "url": "https://checkout.stripe.com/c/pay/cs_test_f0e1d2c3b4a5#fidkdWxOYHwnPyd1blpxYHZxWjA0TjE0PWF..."
}
```

**Errors**

| Status | When                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `Idempotency-Key` missing; body validation; `clientReferenceId` contains disallowed characters                                      |
| 401    | Missing/invalid JWT                                                                                                               |
| 404    | `BillingPrice` or linked `BillingPlan` not found                                                                                  |
| 409    | Price `inactive`; price is not `recurring`; plan is `archived`; user already has an active subscription                           |

### 4.6 `GET /api/billing/entitlements` – List active feature entitlements

Returns the active `BillingEntitlement` rows for the current user. Use this to render feature gates (e.g. show/hide a "Premium" badge, gate UI behind a feature key). Subscription statuses that grant entitlements are `active`, `trialing`, and `past_due` (Stripe's grace period).

**Example request**

```http
GET /api/billing/entitlements HTTP/1.1
Authorization: Bearer <access_token>
```

**Example response — `200 OK`**

```json
[
  {
    "featureKey": "premium_reports",
    "sourceType": "subscription",
    "sourceId": "b4a9c1e2-7d3f-4f3b-8a92-1b2c3d4e5f6a",
    "startsAt": "2026-05-12T10:00:00.000Z",
    "endsAt": null
  },
  {
    "featureKey": "team_export",
    "sourceType": "subscription",
    "sourceId": "b4a9c1e2-7d3f-4f3b-8a92-1b2c3d4e5f6a",
    "startsAt": "2026-05-12T10:00:00.000Z",
    "endsAt": null
  },
  {
    "featureKey": "credits_pack_lifetime",
    "sourceType": "one_time_payment",
    "sourceId": "c1a9b2e3-4d5f-6a7b-8c9d-0e1f2a3b4c5d",
    "startsAt": "2026-05-13T14:25:00.000Z",
    "endsAt": null
  }
]
```

**Empty case — `200 OK`**

```json
[]
```

**Errors**: 401 only.

> [!TIP]
> **Application-module gating** uses `FeatureAccessGuard` + `@RequiresFeature` on the backend. The frontend should treat the `entitlements` array as the source of truth for what to show — check `featureKey` membership client-side and route accordingly.

---

## 5. Admin Endpoints

All routes require JWT + `UserRoleEnum.ADMIN`. Auth is enforced by `AuthGuard` + `RolesGuard` + `@Roles(UserRoleEnum.ADMIN)` on the controller class.

### 5.1 `POST /api/billing/admin/plans` – Create a plan

**Request body (`CreateBillingPlanDto`)**

| Field         | Type                       | Required | Default      | Constraints                                                    |
| ------------- | -------------------------- | :------: | ------------ | -------------------------------------------------------------- |
| `code`        | string                     |   ✅     |              | 2–100 chars; `^[a-z0-9_-]+$` (e.g. `pro_monthly`)              |
| `name`        | string                     |   ✅     |              | Max 255 chars                                                  |
| `description` | string \| null             |          | `null`       |                                                                |
| `status`      | `BillingPlanStatus`        |          | `draft`      |                                                                |
| `features`    | `string[]`                 |          | `[]`         | Stable feature keys (e.g. `["premium_reports"]`)               |

**Example request**

```http
POST /api/billing/admin/plans HTTP/1.1
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "code": "pro_monthly",
  "name": "Pro",
  "description": "Pro features billed monthly.",
  "status": "draft",
  "features": ["premium_reports", "team_export"]
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
    "features": ["premium_reports", "team_export"],
    "prices": [],
    "createdAt": "2026-05-12T10:00:00.000Z",
    "updatedAt": "2026-05-12T10:00:00.000Z"
  }
}
```

**Errors**

| Status | When                                            |
| ------ | ----------------------------------------------- |
| 400    | Validation error                                |
| 401    | Missing/invalid JWT                             |
| 403    | Authenticated user is not `ADMIN`               |
| 409    | `code` already exists                           |

### 5.2 `GET /api/billing/admin/plans` – List all plans

**Query (`ListBillingPlansQueryDto`)**

| Field    | Type                | Required | Notes                                    |
| -------- | ------------------- | :------: | ---------------------------------------- |
| `status` | `BillingPlanStatus` |          | Optional filter: `draft`/`active`/`archived` |

**Example request**

```http
GET /api/billing/admin/plans?status=active HTTP/1.1
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
    "features": ["premium_reports", "team_export"],
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
        "createdAt": "2026-05-12T10:00:00.000Z",
        "updatedAt": "2026-05-12T10:00:00.000Z"
      }
    ],
    "createdAt": "2026-05-12T10:00:00.000Z",
    "updatedAt": "2026-05-12T10:00:00.000Z"
  }
]
```

**Errors**: 400 (bad `status`), 401, 403.

### 5.3 `PATCH /api/billing/admin/plans/:id` – Update a plan

`code` is intentionally **not** updatable.

**Path parameters**

| Field | Type | Notes                       |
| ----- | ---- | --------------------------- |
| `id`  | UUID | Local `BillingPlan` id      |

**Request body (`UpdateBillingPlanDto`) — all fields optional**

| Field         | Type                | Notes                              |
| ------------- | ------------------- | ---------------------------------- |
| `name`        | string              | Max 255                            |
| `description` | string \| null      |                                    |
| `status`      | `BillingPlanStatus` |                                    |
| `features`    | `string[]`          |                                    |

**Example request**

```http
PATCH /api/billing/admin/plans/5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f HTTP/1.1
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "status": "active",
  "features": ["premium_reports", "team_export", "priority_support"]
}
```

**Example response — `200 OK`**

```json
{
  "plan": {
    "id": "5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f",
    "code": "pro_monthly",
    "name": "Pro",
    "description": "Pro features billed monthly.",
    "status": "active",
    "features": ["premium_reports", "team_export", "priority_support"],
    "prices": [
      { "...": "(see 5.2 for full shape)" }
    ],
    "createdAt": "2026-05-12T10:00:00.000Z",
    "updatedAt": "2026-05-12T11:42:00.000Z"
  }
}
```

**Errors**

| Status | When                              |
| ------ | --------------------------------- |
| 400    | Validation error                  |
| 401    | Missing/invalid JWT               |
| 403    | Not admin                         |
| 404    | Plan not found (bad UUID)         |

### 5.4 `POST /api/billing/admin/plans/:id/archive` – Archive a plan

Sets `status = "archived"`. Archived plans are not returned by the public list and reject checkout attempts.

**Path parameters**

| Field | Type | Notes                  |
| ----- | ---- | ---------------------- |
| `id`  | UUID | Local `BillingPlan` id |

**Request body**: none.

**Example request**

```http
POST /api/billing/admin/plans/5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f/archive HTTP/1.1
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
    "features": ["premium_reports"],
    "prices": [ { "...": "(see 5.2)" } ],
    "createdAt": "2026-05-12T10:00:00.000Z",
    "updatedAt": "2026-05-13T09:00:00.000Z"
  }
}
```

**Errors**

| Status | When                              |
| ------ | --------------------------------- |
| 401    | Missing/invalid JWT               |
| 403    | Not admin                         |
| 404    | Plan not found                    |

### 5.5 `POST /api/billing/admin/plans/:id/prices` – Add a Stripe price to a plan

Attaches a Stripe price reference (created in the Stripe Dashboard) to a local plan.

**Path parameters**

| Field | Type | Notes                  |
| ----- | ---- | ---------------------- |
| `id`  | UUID | Local `BillingPlan` id |

**Request body (`AddBillingPriceDto`)**

| Field             | Type                          | Required | Default | Constraints                              |
| ----------------- | ----------------------------- | :------: | ------- | ---------------------------------------- |
| `stripePriceId`   | string                        |   ✅     |         | Max 255; the `price_*` id from Stripe     |
| `stripeProductId` | string \| null                |          |         | Max 255; `prod_*`                        |
| `currency`        | string                        |   ✅     |         | 3 lowercase letters (`usd`)              |
| `unitAmount`      | integer                       |   ✅     |         | ≥ 0, in **smallest** currency unit       |
| `type`            | `BillingPriceType`            |   ✅     |         | `one_time` \| `recurring`                |
| `interval`        | `BillingRecurringInterval\|null` |        |         | Required if `type=recurring`; null if `one_time` |
| `trialPeriodDays` | integer \| null               |          |         | 0–365; only valid when `type=recurring`  |
| `active`          | boolean                       |          | `true`  |                                          |

**Example request — recurring**

```http
POST /api/billing/admin/plans/5b0a2f0a-7d8d-4d3a-9a4d-1b1c7a8d9e2f/prices HTTP/1.1
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "stripePriceId": "price_1ABCxyz",
  "stripeProductId": "prod_1ABCxyz",
  "currency": "usd",
  "unitAmount": 1900,
  "type": "recurring",
  "interval": "month",
  "trialPeriodDays": 7,
  "active": true
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
    "status": "active",
    "features": ["premium_reports"],
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
        "createdAt": "2026-05-12T10:05:00.000Z",
        "updatedAt": "2026-05-12T10:05:00.000Z"
      }
    ],
    "createdAt": "2026-05-12T10:00:00.000Z",
    "updatedAt": "2026-05-12T10:05:00.000Z"
  }
}
```

**Errors**

| Status | When                                                                                |
| ------ | ----------------------------------------------------------------------------------- |
| 400    | Validation; shape conflict (`one_time` with `interval`, `recurring` without interval, `trialPeriodDays` on `one_time`) |
| 401    | Missing/invalid JWT                                                                 |
| 403    | Not admin                                                                           |
| 404    | Plan not found                                                                      |
| 409    | `stripePriceId` already exists in another plan                                      |

### 5.6 `GET /api/billing/admin/overview` – Operational snapshot

Returns aggregated counts and the most recent failed payments. Use it to power the admin dashboard hero stats.

**Example request**

```http
GET /api/billing/admin/overview HTTP/1.1
Authorization: Bearer <admin_token>
```

**Example response — `200 OK`**

```json
{
  "totalCustomers": 1284,
  "subscriptionsByStatus": [
    { "status": "active", "count": 942 },
    { "status": "trialing", "count": 73 },
    { "status": "past_due", "count": 12 },
    { "status": "canceled", "count": 204 }
  ],
  "recentFailedPayments": [
    {
      "id": "a3b1c2d3-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      "amount": 1999,
      "currency": "usd",
      "description": "Subscription: price_1ABCxyz ($19.99 / month)",
      "createdAt": "2026-05-12T10:55:00.000Z"
    }
  ],
  "failedWebhooksCount": 0
}
```

**Errors**: 401, 403.

### 5.7 `GET /api/billing/admin/webhooks/failed` – List failed webhooks

Returns the 100 most recent webhook events in `status = failed`, with their error message and attempt count. Use this to drive a "Replay" workflow.

**Example request**

```http
GET /api/billing/admin/webhooks/failed HTTP/1.1
Authorization: Bearer <admin_token>
```

**Example response — `200 OK`**

```json
{
  "data": [
    {
      "id": "1f0e9d8c-7b6a-5c4d-3b2a-1f0e9d8c7b6a",
      "stripeEventId": "evt_1PqRsT",
      "eventType": "invoice.payment_failed",
      "errorMessage": "BillingWebhookHandlerError: no local subscription for stripe_subscription_id=sub_1XyZ",
      "processingAttempts": 3,
      "status": "failed",
      "receivedAt": "2026-05-12T11:00:00.000Z",
      "processedAt": null
    }
  ],
  "total": 1
}
```

**Empty case — `200 OK`**

```json
{ "data": [], "total": 0 }
```

**Errors**: 401, 403.

### 5.8 `POST /api/billing/admin/webhooks/:id/replay` – Replay a failed webhook

Re-dispatches a previously failed event through the existing handler pipeline. Signature verification is bypassed (the event was verified on first receive).

**Path parameters**

| Field | Type | Notes                                                              |
| ----- | ---- | ------------------------------------------------------------------ |
| `id`  | UUID | Local `billing_webhook_events.id` (not the Stripe `evt_*` id)      |

**Request body**: none.

**Example request**

```http
POST /api/billing/admin/webhooks/1f0e9d8c-7b6a-5c4d-3b2a-1f0e9d8c7b6a/replay HTTP/1.1
Authorization: Bearer <admin_token>
```

**Example response — `200 OK` (replayed successfully)**

```json
{
  "result": {
    "kind": "processed",
    "stripeEventId": "evt_1PqRsT",
    "eventType": "invoice.payment_failed",
    "reason": null
  }
}
```

**Example response — `200 OK` (still failing)**

```json
{
  "result": {
    "kind": "failed",
    "stripeEventId": "evt_1PqRsT",
    "eventType": "invoice.payment_failed",
    "reason": "BillingWebhookHandlerError: no local subscription for stripe_subscription_id=sub_1XyZ"
  }
}
```

**Example response — `200 OK` (idempotent duplicate)**

```json
{
  "result": {
    "kind": "duplicate",
    "stripeEventId": "evt_1PqRsT",
    "eventType": "invoice.payment_failed",
    "reason": null
  }
}
```

**Errors**

| Status | When                                |
| ------ | ----------------------------------- |
| 401    | Missing/invalid JWT                 |
| 403    | Not admin                           |
| 404    | `id` not found (response body still shaped as a `failed` result) |

> The "not found" case returns a 200 with `result.kind = "failed"` and `result.reason = "Webhook event <id> not found."` — handle both 404 and 200-with-failed in the UI.

### 5.9 `POST /api/billing/admin/payments/:id/refund` – Issue a refund

Calls Stripe `refunds.create` for the underlying PaymentIntent, records a `BillingTransaction(type=refund)`, and updates `BillingPayment.amountRefunded` and `status`. Idempotent.

**Required headers**

| Header            | Value         |
| ----------------- | ------------- |
| `Idempotency-Key` | `<unique key>`|

**Path parameters**

| Field | Type | Notes                                  |
| ----- | ---- | -------------------------------------- |
| `id`  | UUID | Local `BillingPayment` id (not the Stripe `pi_*` id) |

**Request body (`BillingAdminRefundRequestDto`)**

| Field    | Type    | Required | Default       | Constraints                                       |
| -------- | ------- | :------: | ------------- | ------------------------------------------------- |
| `amount` | integer |          | full remaining | Amount in **minor units** to refund. Must be > 0 and ≤ remaining refundable balance. |

> Send an empty body `{}` to perform a full refund. Send `{"amount": 500}` for a partial refund of 5.00 USD.

**Example request — full refund**

```http
POST /api/billing/admin/payments/a3b1c2d3-4e5f-6a7b-8c9d-0e1f2a3b4c5d/refund HTTP/1.1
Authorization: Bearer <admin_token>
Idempotency-Key: f1e2d3c4-b5a6-7988-99aa-bbccddeeff00
Content-Type: application/json

{}
```

**Example request — partial refund**

```http
POST /api/billing/admin/payments/a3b1c2d3-4e5f-6a7b-8c9d-0e1f2a3b4c5d/refund HTTP/1.1
Authorization: Bearer <admin_token>
Idempotency-Key: 0a1b2c3d-4e5f-6a7b-8c9d-9e0f1a2b3c4d
Content-Type: application/json

{ "amount": 500 }
```

**Example response — `200 OK`**

```json
{
  "transactionId": "8e7f6d5c-4b3a-2c1d-0e9f-8a7b6c5d4e3f",
  "stripeRefundId": "re_1XyZ123",
  "amount": 500,
  "currency": "usd",
  "status": "succeeded"
}
```

**Errors**

| Status | When                                                                                                            |
| ------ | --------------------------------------------------------------------------------------------------------------- |
| 400    | `Idempotency-Key` missing; `amount` ≤ 0 or > remaining refundable; payment status not refundable; no `stripePaymentIntentId` on the payment |
| 401    | Missing/invalid JWT                                                                                             |
| 403    | Not admin                                                                                                       |
| 404    | `BillingPayment` not found                                                                                      |

---

## 6. Stripe Webhook (Server-to-Server)

### 6.1 `POST /api/billing/webhooks/stripe` – Receive a Stripe webhook

> **Not called by the browser.** Stripe POSTs to this URL automatically after configuring the endpoint + signing secret in the Stripe Dashboard. The frontend should not include this URL in any HTTP client config.

- `@Public()` — JWT auth is skipped.
- `@SkipThrottle()` — throttling is skipped.
- The body must be available as `req.rawBody` (Buffer) for signature verification. The backend bootstraps Nest with `rawBody: true` in `src/main.ts`, so no frontend setup is required.
- Authenticated by Stripe via the `stripe-signature` header (validated against `STRIPE_WEBHOOK_SECRET`).

**Response policy** (HTTP 200 unless the signature is invalid)

```json
{
  "kind": "processed",
  "stripeEventId": "evt_1PqRsT",
  "eventType": "invoice.payment_failed",
  "reason": null
}
```

`kind` values:

| `kind`       | Meaning                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| `processed`  | Event applied to local state.                                                             |
| `duplicate`  | Already processed (idempotency hit on `stripeEventId`).                                  |
| `ignored`    | Recognised event type that does not apply (e.g. `customer.updated` for a customer we don't track). `reason` explains why. |
| `failed`     | Handler threw. Backend returns 5xx so Stripe retries with backoff. Admin can later replay. |

**Error cases**

| HTTP | When                                                   |
| ---- | ------------------------------------------------------ |
| 400  | `Stripe-Signature` missing or signature invalid        |
| 5xx  | Unhandled exception; Stripe will retry                 |

---

## 7. Frontend Integration Patterns

### 7.1 Idempotency-Key generation

The Checkout / Portal / Refund endpoints require an `Idempotency-Key`. Best practices for the frontend:

```ts
// On user action (button click), generate exactly ONE key.
// Reuse the SAME key on retries within the next few minutes.
function newIdempotencyKey(): string {
  // 36-char UUID v4 is fine; the backend trims and caps at 255 chars.
  return crypto.randomUUID();
}

// In a React handler:
async function onClickBuy() {
  const idempotencyKey = newIdempotencyKey();
  // Stash it so a retry (network error, then user clicks again)
  // can re-use the same key.
  setLastKey(idempotencyKey);

  const res = await api.post(
    '/api/billing/checkout/subscription',
    { priceId },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  window.location.href = res.data.url;
}
```

**Rules**

- Generate the key **at the moment of the user action**, not on the server response.
- Persist the key for the lifetime of the action (e.g. in component state / a query param / `sessionStorage`).
- Replay the same key on network retries triggered by the same action.
- A new user action (new click) must use a new key.

### 7.2 Recommended flow — subscribe to a plan

1. Render the pricing page from `GET /api/billing/plans/public?currency=usd`.
2. User clicks **Subscribe** on a plan's recurring price.
3. Generate an `Idempotency-Key`.
4. `POST /api/billing/checkout/subscription` with `{ priceId, quantity, trialDays, allowPromotionCodes }`.
5. `window.location.href = res.data.url`.
6. On the configured success page (read `?session_id=cs_...` from the URL), show a "Processing…" state and either:
   - poll `GET /api/billing/entitlements` until the new feature key appears, **or**
   - subscribe to a real-time channel (if your app uses Pusher) and listen for the post-checkout event.
7. If the user closes the tab on the Stripe-hosted page, they return to `STRIPE_CANCEL_URL` and the **subscription shell** is left in `incomplete_expired` — no orphan row.

### 7.3 Recommended flow — manage subscription / payment method

There is no REST endpoint for cancel / upgrade / change-payment-method in v1. The frontend should always route the user to the Customer Portal:

1. `POST /api/billing/portal/session` (with `Idempotency-Key`).
2. `window.open(res.data.url, '_blank')` or `window.location.href = res.data.url`.
3. Stripe returns the user to `STRIPE_PORTAL_RETURN_URL` after they're done.

### 7.4 Recommended flow — admin: create a plan, then attach a Stripe price

1. In the Stripe Dashboard, create a Product + Price; copy the `price_*` id (and `prod_*` if shown).
2. In your admin UI: `POST /api/billing/admin/plans` with `{ code, name, status, features }`. If `status = active`, the plan is **immediately** visible on the public pricing page (subject to having at least one active price — see step 3).
3. `POST /api/billing/admin/plans/:id/prices` with the Stripe price reference.
4. The plan + price appears on the public endpoint.

### 7.5 Recommended flow — admin: refund

1. Show a "Refund" button next to a payment in the admin payment list.
2. Prompt for a partial amount (or "Full refund" default).
3. `POST /api/billing/admin/payments/:id/refund` with `{ amount }` (or `{}` for full) and a fresh `Idempotency-Key`.
4. Show the returned `stripeRefundId` and the updated local `status`.

### 7.6 Recommended flow — admin: triage failed webhooks

1. `GET /api/billing/admin/overview` → check `failedWebhooksCount`.
2. If non-zero, `GET /api/billing/admin/webhooks/failed` and render the list.
3. For each row, show the `errorMessage`. A "Replay" button calls `POST /api/billing/admin/webhooks/:id/replay`.
4. The result may be `processed`, `duplicate`, `ignored`, or `failed` again — render accordingly and allow the operator to inspect the underlying Stripe dashboard event.

### 7.7 Displaying money

The backend stores and returns money in **minor units** (e.g. `1900` = $19.00 USD). Convert at the edge using a small helper — the backend exposes `formatMinorAmount(amount, currency)` for the same purpose; the frontend should use `Intl.NumberFormat`.

```ts
function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() })
    .format(minor / 100);
}
// formatMoney(1900, 'usd') => "$19.00"
// formatMoney(1999, 'eur') => "€19.99"
```

### 7.8 Feature gating on the frontend

Two options:

- **Pull-based**: fetch `GET /api/billing/entitlements` and check `featureKey` membership. Best for a small app with infrequent plan changes.
- **Push-based (preferred)**: subscribe to a Pusher channel (or your app's real-time transport) and re-fetch entitlements on each `billing.subscription.*` event. The backend already emits these via `@nestjs/event-emitter` (`BILLING_EVENTS.*`); wire them up in your notification/real-time module.

There are **no server-rendered feature flags** in the public API — the frontend owns the rendering decisions.

### 7.9 Error UX

- `409` on Checkout with the message "already has an active subscription" → hide the "Buy" button for users who already subscribe, route them to the Portal instead.
- `409` on Checkout with "price is not active" → the admin disabled the price; refresh the public plans endpoint and re-render the page.
- `404` on the price id → the price was removed; refresh the public plans endpoint.
- `400` on `Idempotency-Key` missing → the frontend failed to attach the header; log a bug report, do **not** retry without a fresh key.
- `401` → kick the user back to the login flow; the JWT expired.

---

## 8. Edge Cases & Gotchas

| Case                                                                                              | Behaviour                                                                                              | Frontend action                                                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| User reloads the success page mid-Checkout                                                        | The success page is server-rendered, no backend round-trip is required                                  | Show "Finalising your account…" and poll `/api/billing/entitlements` (max ~30s)                              |
| User clicks **Subscribe** twice within seconds                                                     | The first request may be in-flight (idempotency reservation in `in_progress`); the second gets cached  | Disable the button on click; rely on the same `Idempotency-Key` to deduplicate                                |
| Idempotency key reused with different body                                                        | `409 Conflict` (`BillingIdempotencyConflictError`)                                                     | This is a client bug — log it, surface a generic error, regenerate the key on the next click                |
| `Idempotency-Key` header missing                                                                  | `400 Bad Request`                                                                                      | Frontend bug; never retry without attaching the header                                                      |
| Public plans list returns `[]`                                                                    | No active plans (or none for the requested currency)                                                   | Render an "Our plans are being updated" empty state                                                          |
| `price.type` mismatch (e.g. calling subscription checkout with a `one_time` price)                 | `409 Conflict`                                                                                         | Client bug; the public endpoint already returns the price `type` — filter the UI before showing the button  |
| `userId` claim missing from JWT                                                                   | The `GetUser` decorator returns a shape without `id` → guarded routes 401                              | Frontend should not hit these endpoints while logged out                                                    |
| One active subscription per user                                                                   | `POST /api/billing/checkout/subscription` returns `409` for a user who already has a `BillingSubscription` in `incomplete/trialing/active/past_due/paused/unpaid` | Show "Manage your plan" pointing to the Portal                                                               |
| Refund on a refunded payment                                                                      | `400 Bad Request` "already fully refunded"                                                              | Disable the refund button once `payment.amountRefunded >= payment.amount`                                    |
| Webhook event id not found on replay                                                              | The endpoint still returns 200 with `result.kind = "failed"` and a `reason`                            | Refresh the failed-webhooks list and remove the row                                                         |
| Stripe price id conflicts during plan attach                                                      | `409 Conflict` from the unique index                                                                   | Re-fetch the admin list, check for a row with the same `stripePriceId`                                       |
| Currency filter doesn't match the active price                                                    | The plan is dropped from the public list (no prices match)                                              | Fall back to a "all currencies" call (omit `?currency=`)                                                     |
| `featureKey` is case-sensitive                                                                    | The backend returns keys exactly as configured on the plan                                             | Use the literal string from the plan payload; do not lowercase client-side                                    |
| `trialDays` requested on a `one_time` price                                                       | Checkout service throws `BillingError` (price type mismatch caught earlier, so usually `409`)         | Client bug; don't show a trial input for one-time prices                                                     |
| `user.stripeCustomerId` already exists but no `BillingCustomer` row                                | `getOrCreateForUser` and `customer/sync` both backfill automatically                                    | No action; just call `GET /api/billing/customer` after login                                                 |
| `STRIPE_PORTAL_RETURN_URL` missing in env                                                          | Portal session creation throws 500                                                                     | Server-side config issue; surface a generic "Billing is temporarily unavailable" to the user                 |
| Rate limit hit (`429`)                                                                            | Global `ThrottlerGuard`                                                                                | Back off; show a friendly "Too many requests, please try again" message                                      |
| CORS                                                                                              | `credentials: true`, allowed headers include `Content-Type`, `Authorization`, `Cookie`                 | Configure the API client with `withCredentials: true` (or `credentials: 'include'`)                          |

---

## 9. Test / Sandbox Setup

1. Create a Stripe test account; toggle **Test mode** in the dashboard.
2. Create a Product + Price; copy the `price_*` id.
3. `POST /api/billing/admin/plans` then `POST /api/billing/admin/plans/:id/prices` against the dev backend to register the plan.
4. Hit `GET /api/billing/plans/public?currency=usd` from the marketing site — confirm the new plan appears.
5. Sign up a test user, log in, click the subscribe button — verify the Checkout URL opens and a `BillingPayment` + `BillingSubscription` row are created in the DB.
6. Complete the test Checkout using `4242 4242 4242 4242` (any future expiry, any CVC). Stripe will send webhooks to `/api/billing/webhooks/stripe` (configure in dashboard under **Developers → Webhooks → Add endpoint** with the **signing secret** mirrored in the backend's `STRIPE_WEBHOOK_SECRET`).
7. After the webhook settles, `GET /api/billing/entitlements` should include the new feature keys.
8. `POST /api/billing/portal/session` to manage the subscription in the Stripe-hosted portal.
9. To test the refund flow, complete a one-time Checkout, then call `POST /api/billing/admin/payments/:id/refund` from an admin account and confirm the `BillingTransaction(type=refund)` row is created.
10. To test failed-webhook replay, temporarily set `STRIPE_WEBHOOK_SECRET` to an invalid value, send a test event from the dashboard — confirm the row is in `failed` status, then restore the secret and call `POST /api/billing/admin/webhooks/:id/replay`.

---

## 10. Quick Reference — All Endpoints

| Method | Path                                                  | Auth         | Idempotency-Key | Notes                                                       |
| :----- | :---------------------------------------------------- | :----------- | :-------------: | :---------------------------------------------------------- |
| GET    | `/api/billing/plans/public`                           | Public       |       No        | Active plans + active prices; optional `?currency=usd`      |
| GET    | `/api/billing/customer`                               | User         |       No        | Get or lazily create the local customer                     |
| POST   | `/api/billing/customer/sync`                          | User         |       No        | Force re-link with Stripe                                  |
| POST   | `/api/billing/portal/session`                         | User         |     **Yes**     | Returns the Customer Portal URL                             |
| POST   | `/api/billing/checkout/one-time`                      | User         |     **Yes**     | One-time Checkout — body `{ priceId, quantity?, allowPromotionCodes? }` |
| POST   | `/api/billing/checkout/subscription`                  | User         |     **Yes**     | Subscription Checkout — body `{ priceId, quantity?, clientReferenceId?, trialDays?, allowPromotionCodes? }` |
| GET    | `/api/billing/entitlements`                           | User         |       No        | Active feature entitlements                                 |
| POST   | `/api/billing/admin/plans`                            | Admin        |       No        | Create a plan                                               |
| GET    | `/api/billing/admin/plans`                            | Admin        |       No        | List plans; optional `?status=...`                          |
| PATCH  | `/api/billing/admin/plans/:id`                        | Admin        |       No        | Update a plan (not `code`)                                  |
| POST   | `/api/billing/admin/plans/:id/archive`                | Admin        |       No        | Archive a plan                                              |
| POST   | `/api/billing/admin/plans/:id/prices`                 | Admin        |       No        | Attach a Stripe price to a plan                             |
| GET    | `/api/billing/admin/overview`                         | Admin        |       No        | Operational snapshot                                        |
| GET    | `/api/billing/admin/webhooks/failed`                  | Admin        |       No        | List up to 100 failed webhook events                        |
| POST   | `/api/billing/admin/webhooks/:id/replay`              | Admin        |       No        | Replay a failed webhook event                               |
| POST   | `/api/billing/admin/payments/:id/refund`              | Admin        |     **Yes**     | Refund — body `{ amount? }` (omit for full refund)          |
| POST   | `/api/billing/webhooks/stripe`                        | Stripe-only  |       No        | Server-to-server; not called by the browser                 |

---

## 11. Open Questions / Future Work (per the backend's Phase plan)

- Subscription listing per user (currently not exposed — admins see everything via overview counts only).
- Per-user payment history endpoint (currently the admin refund flow is the only public surface).
- Per-user invoice download endpoint (the admin has access to `hostedInvoiceUrl` / `invoicePdf`; the user would need a dedicated endpoint).
- Multi-active-subscription support (currently one active subscription per user in v1).
- Plan switching without going through the Portal.
- Frontend-driven cancellation confirmation (Portal still required in v1).
