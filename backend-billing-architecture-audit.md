# Backend Billing Architecture Audit

**Auditor:** Senior Backend Architect
**Method:** Full code-path trace of `src/billing/` and `src/plans-subscriptions/`
**Date:** 2026-06-12
**Rule:** Backend is source of truth. No frontend assumptions.

---

## 1. Checkout Creation Flows

The backend implements **four** distinct checkout creation endpoints, each with a separate flow:

### 1.1 Hosted One-Time Checkout

| Aspect | Detail |
|--------|--------|
| **Endpoint** | `POST /api/billing/checkout/one-time` |
| **Controller** | `BillingController.createOneTimeCheckout()` `billing.controller.ts:182` |
| **Service** | `BillingCheckoutService.createOneTimeCheckout()` `billing-checkout.service.ts:164` |
| **Stripe API** | `stripe.checkout.sessions.create({ mode: 'payment' })` |
| **DB writes** | `BillingPayment` (status=`CHECKOUT_CREATED` → `stripeCheckoutSessionId` set after Stripe call) |
| **Events emitted** | `billing.checkout.created` (kind=`one_time`) |

**Local payment row created BEFORE Stripe call**. The `client_reference_id` on the session is set to `payment.id`, and metadata includes `localPaymentId`, `localPriceId`, `billingCustomerId`, `userId`.

### 1.2 Hosted Subscription Checkout

| Aspect | Detail |
|--------|--------|
| **Endpoint** | `POST /api/billing/checkout/subscription` |
| **Controller** | `BillingController.createSubscriptionCheckout()` `billing.controller.ts:222` |
| **Service** | `BillingCheckoutService.createSubscriptionCheckout()` `billing-checkout.service.ts:278` |
| **Stripe API** | `stripe.checkout.sessions.create({ mode: 'subscription', ui_mode?, ... })` |
| **DB writes** | `BillingPayment` (status=`CHECKOUT_CREATED`) + `BillingSubscription` (status=`INCOMPLETE`, `stripeSubscriptionId` = `pending_sub:<paymentId>`, `stripeCheckoutSessionId` = `null`) |
| **Events emitted** | `billing.checkout.created` (kind=`subscription`) |

**Creates a subscription shell with a placeholder id.** The `stripeSubscriptionId` is set to `pending_sub:<localPaymentId>` to satisfy the unique index on `stripe_subscription_id`. This placeholder is recognized by `isPlaceholderSubscriptionId()` at line 739 and is excluded from the `assertNoActiveSubscription()` check at line 791, allowing subsequent checkout attempts for the same user.

When `uiMode === 'embedded_page'`, returns `sessionId + clientSecret` (embedded session client secret) but NO `url`.

### 1.3 Embedded Elements Subscription (PaymentIntent-first)

| Aspect | Detail |
|--------|--------|
| **Endpoint** | `POST /api/billing/checkout/embedded-elements` |
| **Controller** | `BillingController.createEmbeddedElementsCheckout()` `billing.controller.ts:271` |
| **Service** | `BillingCheckoutService.createSubscriptionPaymentIntent()` `billing-checkout.service.ts:463` |
| **Stripe API** | `stripe.paymentIntents.create({ setup_future_usage: 'off_session' })` |
| **DB writes** | `BillingPayment` (status=`PENDING`, no subscription shell created) |
| **Events emitted** | `billing.checkout.created` (kind=`subscription_elements`) |

**Creates ONLY a PaymentIntent — NO Checkout Session, NO BillingSubscription shell.** The `clientSecret` returned is a PaymentIntent `client_secret` (`pi_*_secret_*`). The frontend uses this with `<PaymentElement>` in Elements. No `sessionId` is returned. The response DTO is `{ paymentIntentId, clientSecret }`.

### 1.4 Embedded Elements One-Time

| Aspect | Detail |
|--------|--------|
| **Endpoint** | `POST /api/billing/checkout/embedded-elements-one-time` |
| **Controller** | `BillingController.createEmbeddedElementsOneTimeCheckout()` `billing.controller.ts:322` |
| **Service** | `createOneTimeCheckout()` (reused) + Stripe `sessions.retrieve({ expand: ['payment_intent'] })` |
| **Stripe API** | Same as 1.1 + `checkout.sessions.retrieve(expand)` |
| **DB writes** | Same as 1.1 |
| **Events emitted** | Same as 1.1 |

**Reuses the Hosted One-Time flow**, then retrieves the session from Stripe expanded with `payment_intent` to extract the `client_secret`. The response DTO is `{ sessionId, clientSecret }` — note that `sessionId` IS returned here (unlike 1.3).

---

## 2. Subscription Creation Lifecycle

There are exactly **two code paths** that create `BillingSubscription` rows with real `sub_*` Stripe IDs:

### Path A: Hosted Checkout (Webhook-driven)

```
POST /api/billing/checkout/subscription
  → BillingPayment (CHECKOUT_CREATED)
  → BillingSubscription (INCOMPLETE, stripe_subscription_id = "pending_sub:<id>")
  → stripe.checkout.sessions.create (mode: subscription)
  → Updates payment.stripeCheckoutSessionId, subscription.stripeCheckoutSessionId
  → User redirects to Stripe

[Webhook] checkout.session.completed  (arrives after user pays)
  → handleCheckoutSessionCompleted() at webhook.service.ts:469
  → Updates BillingPayment: sets stripePaymentIntentId, status → PAID
  → Replaces subscription placeholder with real sub_xxx via subscriptionIdOf()
  → Updates BillingSubscription: stripeSubscriptionId = real sub_xxx
  → Emits billing.payment.succeeded

[Webhook] customer.subscription.created  (may arrive before or after)
  → handleSubscriptionCreated() at webhook.service.ts:838
  → upsertSubscriptionFromStripe() at webhook.service.ts:912
  → Matches by stripeSubscriptionId (real sub_xxx) OR by placeholder
  → Updates status, currentPeriodStart, currentPeriodEnd, trialEnd, etc.
  → Emits billing.subscription.created
  → Calls recomputeEntitlements(userId) ← ENTITLEMENTS CREATED HERE
```

**DB writes by webhooks:**
- `BillingPayment.status` → `SUCCEEDED`
- `BillingPayment.stripePaymentIntentId` → set
- `BillingSubscription.stripeSubscriptionId` → placeholder replaced with real sub_xxx
- `BillingSubscription.status` → mapped from Stripe (typically `active` or `trialing`)
- `BillingSubscription.currentPeriodStart/End` → set from Stripe
- `BillingEntitlement` rows → created/updated by `recomputeForUser()`
- `BillingTransaction` → created by `recordTransactionFromIntent()`
- `BillingInvoice` → created by `upsertInvoiceFromStripe()`

### Path B: Embedded Elements (Frontend-driven)

```
POST /api/billing/checkout/embedded-elements
  → BillingPayment (PENDING)
  → stripe.paymentIntents.create
  → Updates payment.stripePaymentIntentId

Frontend: stripe.confirmPayment(clientSecret)
  → PaymentIntent confirmed on browser
  → User redirected to success URL with ?payment_intent=pi_xxx

POST /api/billing/subscriptions/create  { paymentIntentId: "pi_xxx" }
  → createSubscriptionFromPayment() at checkout.service.ts:566
  → stripe.paymentIntents.retrieve(pi_xxx) → verifies status === "succeeded"
  → Extracts payment_method from PaymentIntent
  → stripe.subscriptions.create({ customer, items, default_payment_method })
  → Creates BillingSubscription (ACTIVE, stripeSubscriptionId = sub_xxx)
  → Updates BillingPayment: status → SUCCEEDED
  → Emits billing.subscription.created
  → DOES NOT call recomputeEntitlements() ← BUG: no entitlements created here

[Webhook] customer.subscription.created  (may arrive before or after)
  → handleSubscriptionCreated()
  → upsertSubscriptionFromStripe()
  → Finds row by stripeSubscriptionId (already set by createSubscriptionFromPayment)
  → Updates status, periods, etc.
  → Calls recomputeEntitlements(userId) ← ENTITLEMENTS CREATED HERE (if webhook arrives)
```

### Key Finding: Path B has an entitlement gap

**`createSubscriptionFromPayment()` at `billing-checkout.service.ts:566` creates the Stripe subscription and the local `BillingSubscription` row, but it never calls `recomputeEntitlements()`.** It emits `billing.subscription.created` (line 699), but **there are no event listeners** wired in the module (the `listeners/` directory doesn't exist; no `@OnEvent` decorators are registered anywhere in the billing module).

**Entitlements for Path B depend entirely on the `customer.subscription.created` webhook** arriving after `createSubscriptionFromPayment()` completes, via `handleSubscriptionCreated()` → `upsertSubscriptionFromStripe()` → `recomputeEntitlements()`.

If the webhook arrives BEFORE `createSubscriptionFromPayment()`:
- `upsertSubscriptionFromStripe()` can't find the row → returns `null` → handler returns `'ignored'`
- No entitlements are created
- `createSubscriptionFromPayment()` completes successfully but doesn't recompute
- The user gets a subscription but NO entitlements

If the webhook arrives AFTER `createSubscriptionFromPayment()`:
- `upsertSubscriptionFromStripe()` finds the row by `stripeSubscriptionId`
- Updates status/periods
- Calls `recomputeEntitlements()` → entitlements created

### Path C: Webhook-only (External subscription creation)

If a subscription is created outside the system (e.g., Stripe dashboard, admin API):
- `customer.subscription.created` fires
- `upsertSubscriptionFromStripe()` tries to find local row by `stripeSubscriptionId` → fails
- Tries by `localSubscriptionId` in metadata → fails (no metadata from external creation)
- Tries by placeholder via `localPaymentId` in metadata → fails
- Returns `null` → `'ignored'`
- No local row is created

This is correct behavior: the system only manages subscriptions it created.

---

## 3. Webhook Processing Lifecycle

### Entry Point

`POST /api/billing/webhooks/stripe` → `StripeWebhookController.handleStripeWebhook()` → `BillingWebhookService.receiveEvent()`

Processing pipeline:
1. Signature verification via `BillingStripeService.constructWebhookEvent()`
2. Event deduplication: check `billing_webhook_events` by `stripe_event_id` (unique index)
3. Persist event row (status=`RECEIVED`)
4. Dispatch to typed handler via `dispatch()`
5. Handler returns `'processed'` or `'ignored'`
6. Row status updated to `PROCESSED` or `IGNORED`
7. On throw: row marked `FAILED`, error propagates to controller → 5xx (Stripe retries)

### Handlers and Their Effects

| Webhook Event | Handler | DB Effects | Entitlements? |
|---|---|---|---|
| `checkout.session.completed` | `handleCheckoutSessionCompleted()` | Updates BillingPayment (status, PI id). Replaces subscription placeholder. | No |
| `checkout.session.expired` | `handleCheckoutSessionExpired()` | Marks BillingPayment→CANCELED, BillingSubscription→INCOMPLETE_EXPIRED | No |
| `payment_intent.succeeded` | `handlePaymentIntentSucceeded()` | Updates BillingPayment status. Creates BillingTransaction(charge). | **Yes** (line 638) |
| `payment_intent.payment_failed` | `handlePaymentIntentFailed()` | Marks BillingPayment→FAILED | No |
| `charge.succeeded` | `handleChargeSucceeded()` | Updates BillingPayment status | No |
| `charge.refunded` | `handleChargeRefunded()` | Creates BillingTransaction(refund). Updates payment.amountRefunded + status | No |
| `customer.created` / `.updated` | `handleCustomerUpsert()` | Updates BillingCustomer name/email/metadata | No |
| `customer.subscription.created` | `handleSubscriptionCreated()` | Creates/updates BillingSubscription via `upsertSubscriptionFromStripe()` | **Yes** (line 851) |
| `customer.subscription.updated` | `handleSubscriptionUpdated()` | Same as created | **Yes** (line 868) |
| `customer.subscription.deleted` | `handleSubscriptionDeleted()` | Marks BillingSubscription→CANCELED | **Yes** (line 896) |
| `invoice.*` lifecycle | `handleInvoiceLifecycle()` | Creates/updates BillingInvoice | No (except `invoice.payment_failed`) |
| `invoice.payment_failed` | `handleInvoicePaymentFailed()` | Creates/updates BillingInvoice + marks BillingPayment→FAILED | **Yes** (line 1039) |

### Entitlement recompute is triggered only by webhooks

The five calls to `recomputeEntitlements()` all happen inside webhook handlers:
- `handlePaymentIntentSucceeded()` line 638
- `handleSubscriptionCreated()` line 851
- `handleSubscriptionUpdated()` line 868
- `handleSubscriptionDeleted()` line 896
- `handleInvoicePaymentFailed()` line 1039

No frontend-facing endpoint calls `recomputeEntitlements()`.

---

## 4. Entitlement Generation Lifecycle

### Source Rows
- `BillingSubscription` with status in `['active', 'trialing', 'past_due']`
- `BillingPayment` with status `'succeeded'` AND linked to a `one_time` price

### Resolution Path
```
BillingSubscription.planId → BillingPlan.features[] → one entitlement per featureKey
BillingPayment.priceId → BillingPrice.planId → BillingPlan.features[] → one entitlement per featureKey
```

### Behavior on Recompute
```typescript
recomputeForUser(userId):
  1. Build expected entitlement tuples from granting subscriptions + succeeded one-time payments
  2. Reactivate historical rows or insert new rows for expected tuples
  3. Deactivate active rows not in expected set (active=false, endsAt=now)
  4. Manual grants (sourceType='manual') are never deactivated
```

### The `isPremium` Column

At `billing-entitlements.service.ts:47`:
> `users.is_premium` is intentionally never written by this service. It is a pre-existing compatibility column and will be removed in a future cleanup migration.

This column is never updated by the billing module. Any code checking `user.isPremium` instead of `BillingEntitlementsService.canAccess()` or `GET /api/billing/entitlements` will see stale data.

---

## 5. Customer Creation/Update Lifecycle

### Frontend-triggered

```
GET /api/billing/customer
  → BillingCustomerService.getOrCreateForUser(userId)
    1. Pessimistic write lock on User row
    2. Find local BillingCustomer by userId (re-check after lock)
    3. If absent: check users.stripe_customer_id (backfill from legacy)
    4. If still absent: stripe.customers.create({ email, name, metadata: { userId } })
    5. Persist BillingCustomer row
    6. Mirror stripeCustomerId back to users.stripe_customer_id
    7. Emit billing.customer.created
```

### Webhook-triggered

```
customer.created / customer.updated
  → handleCustomerUpsert()
  → BillingCustomerService.applyCustomerUpdate(stripeCustomer)
    1. Find local BillingCustomer by stripeCustomerId
    2. If not found: return null → 'ignored'
    3. Update email, name, metadata
    4. Save
```

### Design Decisions
- `getOrCreateForUser()` uses `pessimistic_write` lock on the User row to prevent duplicate Stripe Customer creation from concurrent requests
- `customer.created` webhook for a customer created by `getOrCreateForUser()` arrives AFTER the local row already exists. The webhook's `applyCustomerUpdate()` finds the local row and applies any Stripe-side updates (name, email).
- If the webhook arrives before `getOrCreateForUser()` returns: the webhook's `applyCustomerUpdate()` can't find a local row → returns null → `'ignored'`. This is safe: the local row will be created when the frontend calls any billing endpoint, and the `customer.created` webhook is purely informational for us.

---

## 6. Success-Page Related Flows

### Per-Endpoint Success URL Behavior

| Endpoint | `success_url` | URL Parameters After Redirect | Frontend Should Read |
|---|---|---|---|
| `checkout/one-time` (hosted) | `appendSessionId(successUrl)` → `{url}?session_id={CHECKOUT_SESSION_ID}` | `session_id=cs_xxx` | `session_id` |
| `checkout/subscription` (hosted) | `appendSessionId(successUrl)` → same | `session_id=cs_xxx` | `session_id` |
| `checkout/subscription` (embedded `ui_mode=embedded_page`) | `appendSessionId(successUrl)` → same | `session_id=cs_xxx` (Stripe embedded Checkout redirect) | `session_id` |
| `checkout/embedded-elements` (subscription Elements) | No `success_url` set (not a Checkout Session). Frontend sets `return_url` in `confirmPayment()`. | `payment_intent=pi_xxx&payment_intent_client_secret=...&redirect_status=succeeded` | `payment_intent` |
| `checkout/embedded-elements-one-time` | Same as `checkout/one-time` (reuses it) | `session_id=cs_xxx&payment_intent=pi_xxx&...` | `session_id` or `payment_intent` |

### `appendSessionId()` Behavior

At `billing-checkout.service.ts:811`:
```typescript
private appendSessionId(url: string): string {
  if (url.includes('{CHECKOUT_SESSION_ID}')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}session_id={CHECKOUT_SESSION_ID}`;
}
```

Stripe replaces `{CHECKOUT_SESSION_ID}` with the actual session id on redirect. This means the success page always gets `session_id=cs_xxx` in the URL for any hosted Checkout flow (including embedded Checkout with `ui_mode=embedded_page`).

**For the Embedded Elements subscription flow (1.3), there is NO Checkout Session.** The `return_url` is set by the frontend in `stripe.confirmPayment({ return_url })`. Stripe's `confirmPayment` redirect adds `payment_intent`, `payment_intent_client_secret`, and `redirect_status` as URL parameters. The success page MUST read `payment_intent` from the URL for this flow.

---

## 7. Idempotency Protections

### Where Required

All four checkout endpoints and the `POST /api/billing/subscriptions/create` endpoint require the `Idempotency-Key` header.

### Mechanism

| Component | File | Lines |
|-----------|------|-------|
| Controller decorator | `common/idempotency-key.decorator.ts` | Extracts header |
| Service | `billing-idempotency.service.ts` | Core logic |
| Entity | `billing-idempotency-key.entity.ts` | DB persistence |

**Flow:**
1. Frontend sends `Idempotency-Key` header with unique string
2. Service normalizes key, SHA-256 hashes the request body
3. First request: creates row with status=IN_PROGRESS, runs operation
4. Same key + same body on retry: returns cached response (COMPLETED status)
5. Same key + different body: 409 Conflict
6. Same key after failure: allowed to retry (row becomes IN_PROGRESS again)
7. Expired key (after 24h TTL): treated as fresh if failed, cached if completed

### Scope Names

Each endpoint uses a different idempotency scope string:
- `checkout.one_time` — one-time hosted
- `checkout.subscription` — subscription hosted
- `subscription.payment_intent` — embedded elements checkout creation
- `subscription.create_from_payment` — subscription creation after payment

This prevents the same key from being reused across different operations.

---

## 8. Race Condition Protections

### Identified Race Conditions

| # | Race | Participants | Protected? | Current Protection |
|---|---|---|---|---|
| 1 | Two parallel checkout calls from same user | Both call `getOrCreateForUser()` + Stripe calls | **Yes** | `pessimistic_write` lock on User row in `getOrCreateForUser()`. `assertNoActiveSubscription()` after lock. |
| 2 | Webhook arrives before local row exists | Webhook handler vs `getOrCreateForUser()` or `createSubscriptionFromPayment()` | **Yes** (by design) | Webhooks that can't find local rows return `'ignored'`. The webhook will be re-delivered if failed, or the state will be healed on next event. |
| 3 | `createSubscriptionFromPayment()` races with `payment_intent.succeeded` webhook | Webhook may update BillingPayment to SUCCEEDED before `createSubscriptionFromPayment()` reads it | **Partial** | `createSubscriptionFromPayment()` reads PaymentIntent from Stripe (not local DB) to verify status. But webhook's `recomputeEntitlements()` may run before the BillingSubscription exists. |
| 4 | `createSubscriptionFromPayment()` races with `customer.subscription.created` webhook | Webhook may try to find subscription that `createSubscriptionFromPayment()` hasn't written yet | **Partial** | Webhook returns `'ignored'` if row not found. But then no entitlements are recomputed (bug). |
| 5 | Webhook idempotency (duplicate delivery) | Two identical webhook events arrive | **Yes** | Unique index on `billing_webhook_events.stripe_event_id` + race-safe insert with `QueryFailedError` handling. |
| 6 | Idempotency key race (same key, concurrent) | Two requests with same key arrive simultaneously | **Yes** | Unique index on `billing_idempotency_keys.key` + race-safe insert with `QueryFailedError` handling. |

### Unprotected Races

| # | Race | Impact | Notes |
|---|---|---|---|
| A | Entitlement gap in Embedded Elements flow (Path B) | User pays but never gets feature access | `createSubscriptionFromPayment()` doesn't call `recomputeEntitlements()`. If webhook arrives early and can't find row → ignored → no entitlements ever created. |
| B | `assertNoActiveSubscription()` race | Two concurrent checkouts could both pass the check | The `INCOMPLETE` status is included in `ACTIVE_SUBSCRIPTION_STATES` for the check, but placeholders are excluded. Between the check and the Stripe call, no lock is held on the subscription table. |

---

## 9. Flow Diagrams

### 9.1 Hosted Subscription Checkout (Primary/Canonical Flow)

```
Frontend                    Backend                       Stripe
   │                          │                            │
   │ POST /checkout/subscription                           │
   │────────────────────────►│                            │
   │                          │ assertNoActiveSubscription │
   │                          │ getOrCreateForUser()       │
   │                          │ create BillingPayment      │
   │                          │   (CHECKOUT_CREATED)       │
   │                          │ create BillingSubscription │
   │                          │   (INCOMPLETE, placeholder)│
   │                          │ checkout.sessions.create──►│
   │                          │◄───────────────────────────│
   │◄── { sessionId, url } ──│                            │
   │                          │                            │
   │ Redirect user to Stripe URL                           │
   │──────────────────────────────────────────────────►    │
   │                          │                            │
   │                          │       [User pays on Stripe]│
   │                          │                            │
   │                          │◄── checkout.session.completed
   │                          │   handleCheckoutSessionCompleted
   │                          │   update BillingPayment    │
   │                          │   replace placeholder      │
   │                          │                            │
   │                          │◄── customer.subscription.created
   │                          │   handleSubscriptionCreated│
   │                          │   upsertSubscriptionFromStripe
   │                          │   update status/periods    │
   │                          │   recomputeEntitlements()  │
   │                          │                            │
   │ (User lands on success page with ?session_id=cs_xxx)  │
   │                          │                            │
   │ GET /subscriptions/current                            │
   │────────────────────────►│                            │
   │                          │ find ACTIVE/TRIALING/      │
   │                          │   PAST_DUE subscription    │
   │◄── subscription data ───│                            │
```

### 9.2 Embedded Elements Subscription Checkout (Secondary Flow)

```
Frontend                    Backend                       Stripe
   │                          │                            │
   │ POST /checkout/embedded-elements                      │
   │────────────────────────►│                            │
   │                          │ assertNoActiveSubscription │
   │                          │ getOrCreateForUser()       │
   │                          │ create BillingPayment      │
   │                          │   (PENDING)                │
   │                          │ paymentIntents.create──────►│
   │                          │◄───────────────────────────│
   │◄── { pi, clientSecret }─│                            │
   │                          │                            │
   │ stripe.confirmPayment({ clientSecret, return_url })   │
   │──────────────────────────────────────────────────►    │
   │                          │                            │
   │   [User confirms payment on browser]                  │
   │                          │                            │
   │   [Stripe redirects to return_url]                    │
   │   [?payment_intent=pi_xxx&redirect_status=succeeded]  │
   │                          │                            │
   │ MISSING: POST /subscriptions/create  ← required step │
   │                          │                            │
   │   [Frontend polls GET /subscriptions/current]         │
   │   → always returns null ← no subscription exists     │
   │                          │                            │
   │                          │◄── payment_intent.succeeded
   │                          │   handlePaymentIntentSucc. │
   │                          │   update BillingPayment    │
   │                          │   create BillingTransaction│
   │                          │   recomputeEntitlements()  │
   │                          │   (payment exists, no sub) │
   │                          │                            │
   │                          │◄── customer.subscription.created
   │                          │   (NEVER FIRES because     │
   │                          │    no subscription was     │
   │                          │    created on Stripe)      │
```

### 9.3 What the Embedded Elements Flow SHOULD Be

```
Frontend                    Backend                       Stripe
   │                          │                            │
   │ POST /checkout/embedded-elements                      │
   │─── (same as above) ────►│                            │
   │◄── { pi, clientSecret }─│                            │
   │                          │                            │
   │ stripe.confirmPayment()                                │
   │──────────────────────────────────────────────────►    │
   │                          │                            │
   │ [User redirected to success page]                     │
   │ [?payment_intent=pi_xxx]                              │
   │                          │                            │
   │ POST /subscriptions/create { paymentIntentId }        │
   │────────────────────────►│                            │
   │                          │ paymentIntents.retrieve───►│
   │                          │◄── status:succeeded ──────│
   │                          │ subscriptions.create───────►│
   │                          │◄── sub_xxx ───────────────│
   │                          │ create BillingSubscription │
   │                          │   (ACTIVE)                 │
   │                          │ update BillingPayment      │
   │                          │   (SUCCEEDED)              │
   │                          │ emit billing.subscription.created
   │                          │ (NO recomputeEntitlements) │
   │◄── { subId, status }────│                            │
   │                          │                            │
   │ GET /subscriptions/current                             │
   │────────────────────────►│                            │
   │◄── subscription data ───│                            │
   │                          │                            │
   │                          │◄── customer.subscription.created
   │                          │   handleSubscriptionCreated│
   │                          │   upsertSubscriptionFromStripe
   │                          │   recomputeEntitlements()  │
```

---

## 10. Answers to Explicit Questions

### Q1: Is `POST /api/billing/subscriptions/create` mandatory?

**Yes, for the Embedded Elements subscription flow.** The endpoint is required and this is explicitly documented in the Swagger/OpenAPI decorator at `billing.controller.ts:251-255`:

> "This endpoint creates a PaymentIntent directly (not a Checkout Session). The frontend uses the returned clientSecret with <Elements> + <PaymentElement>. After stripe.confirmPayment() succeeds, call POST /api/billing/subscriptions/create with the returned paymentIntentId to create the actual subscription."

For the **Hosted Checkout** flow (`/checkout/subscription`), this endpoint is NOT used. Webhooks handle everything.

### Q2: Can a subscription be created entirely through webhooks?

**Yes, for the Hosted Checkout flow (Path A).** The webhook handlers `handleCheckoutSessionCompleted()` + `handleSubscriptionCreated()` together create the complete subscription lifecycle.

**No, for the Embedded Elements flow (Path B).** The `createSubscriptionFromPayment()` frontend-facing endpoint is the only code that calls `stripe.subscriptions.create()` with the confirmed payment method. Webhooks for this flow are supplementary (they update status and recompute entitlements) but cannot create the subscription because:
- `payment_intent.succeeded` doesn't trigger a Stripe subscription creation
- `customer.subscription.created` never fires because no subscription exists on Stripe yet

### Q3: Which component is responsible for creating the local BillingSubscription record?

Two components, depending on the flow:

| Flow | Component | Method | Initial Status | Line |
|---|---|---|---|---|
| Hosted Checkout | `BillingCheckoutService` | `createSubscriptionCheckout()` | `INCOMPLETE` (placeholder) | `billing-checkout.service.ts:336` |
| Embedded Elements | `BillingCheckoutService` | `createSubscriptionFromPayment()` | `ACTIVE` (real) | `billing-checkout.service.ts:668` |
| Webhook (upsert, not create) | `BillingWebhookService` | `upsertSubscriptionFromStripe()` | Updates existing row | `billing-webhook.service.ts:912` |

### Q4: Which component is responsible for creating entitlements?

**Only `BillingEntitlementsService.recomputeForUser()`**, called exclusively from webhook handlers. There are exactly five call sites, all in `billing-webhook.service.ts`:
- Line 638 (`handlePaymentIntentSucceeded`)
- Line 851 (`handleSubscriptionCreated`)
- Line 868 (`handleSubscriptionUpdated`)
- Line 896 (`handleSubscriptionDeleted`)
- Line 1039 (`handleInvoicePaymentFailed`)

No frontend-facing endpoint triggers entitlement recomputation. The frontend-driven `createSubscriptionFromPayment()` emits an event (`billing.subscription.created`) but **no listener is registered** for this event in the module.

### Q5: What is the intended success-page flow?

Depends on the checkout flow used:

**Hosted Checkout (subscription or one-time):**
1. User redirected to `success_url?session_id=cs_xxx`
2. Page reads `session_id` from URL
3. Page polls `GET /api/subscriptions/current` until subscription is found
4. Webhooks create subscription asynchronously (typically within seconds)
5. When subscription is found, display success UI

**Embedded Elements (subscription):**
1. User redirected to `return_url?payment_intent=pi_xxx&redirect_status=succeeded`
2. Page reads `payment_intent` from URL
3. Page calls `POST /api/billing/subscriptions/create` with `paymentIntentId`
4. After successful response, page can immediately display success UI
5. Page may optionally poll `GET /api/subscriptions/current` for confirmation

### Q6: What URL parameters should the frontend consume after payment?

| Flow | URL Parameters | Read This |
|---|---|---|
| Hosted One-Time (`/checkout/one-time`) | `?session_id=cs_xxx` | `session_id` |
| Hosted Subscription (`/checkout/subscription`) | `?session_id=cs_xxx` | `session_id` |
| Hosted Subscription embedded (`ui_mode=embedded_page`) | `?session_id=cs_xxx` | `session_id` |
| Embedded Elements subscription (`/checkout/embedded-elements`) | `?payment_intent=pi_xxx&payment_intent_client_secret=...&redirect_status=succeeded` | `payment_intent` |
| Embedded Elements one-time (`/checkout/embedded-elements-one-time`) | `?session_id=cs_xxx&payment_intent=pi_xxx&...` | `session_id` or `payment_intent` |

### Q7: Is there any duplicated subscription-creation path?

**No.** The two paths (Hosted Checkout and Embedded Elements) are mutually exclusive:

- **Hosted Checkout** creates a BillingSubscription shell (INCOMPLETE) and relies on webhooks to finalize it
- **Embedded Elements** creates no shell and relies on `createSubscriptionFromPayment()` to create the subscription after payment confirmation

They cannot overlap because `assertNoActiveSubscription()` (called by both) checks for an existing subscription before either can proceed. The placeholder exclusion ensures a Hosted Checkout shell doesn't block an Embedded Elements flow, but the two can never both complete for the same user.

### Q8: Are there race conditions between frontend actions and webhooks?

**Yes, three identified:**

| # | Race | Severity | Details |
|---|---|---|---|
| 1 | Webhook updates BillingPayment before `createSubscriptionFromPayment()` reads it | **Low** | `createSubscriptionFromPayment()` reads status from Stripe API, not local DB. Webhook updates are additive (SUCCEEDED is final). No conflict. |
| 2 | Webhook arrives before `createSubscriptionFromPayment()` creates local BillingSubscription | **Medium** | If `customer.subscription.created` arrives before the BillingSubscription row is written, `upsertSubscriptionFromStripe()` returns null → 'ignored'. Entitlements never recomputed for this path. |
| 3 | `payment_intent.succeeded` webhook updates BillingPayment to SUCCEEDED between `createSubscriptionFromPayment()` writing the subscription and updating the payment | **Low** | Both set SUCCEEDED. The webhook's `recomputeEntitlements()` runs without a subscription row. No error, but no entitlements yet either. |

### Q9: What is the single canonical workflow that the system was designed around?

**The Hosted Checkout Subscription flow is the canonical/primary workflow.** Evidence:

1. **Architecture comments**: The header comment at `billing-checkout.service.ts:1-31` describes the shelf/placeholder pattern used exclusively by the Hosted Checkout flow. The Embedded Elements flow is documented as a secondary variation.

2. **Placeholder mechanism**: The `SUBSCRIPTION_PENDING_PREFIX` (`pending_sub:`) and `isPlaceholderSubscriptionId()` exist ONLY for the Hosted Checkout flow. The Embedded Elements flow creates no shell.

3. **`appendSessionId()` method**: This method appends `?session_id={CHECKOUT_SESSION_ID}` to the success URL. It is used by `createOneTimeCheckout()` (line 220), `createSubscriptionCheckout()` (lines 390, 392), but NOT by `createSubscriptionPaymentIntent()` (the Embedded Elements flow). The Embedded Elements flow has no success URL because it's a PaymentIntent, not a Checkout Session.

4. **Webhook-oriented design**: The webhook handlers handle ALL lifecycle transitions for the Hosted Checkout flow. The Embedded Elements flow requires an additional frontend API call (`POST /api/billing/subscriptions/create`) that bypasses the normal webhook pipeline.

5. **`uiMode` default**: The `BillingSubscriptionCheckoutRequestDto` defaults `uiMode` to `'hosted_page'` (line 143), indicating hosted checkout is the primary mode.

6. **Subscription shell creation**: The Hosted Checkout flow pre-creates a `BillingSubscription` shell with `INCOMPLETE` status (line 336-351). This allows the webhook handler to update the existing row rather than create it. The Embedded Elements flow creates the subscription AFTER payment, in `ACTIVE` status.

---

## 11. Inconsistencies Found

### 11.1 Entitlement gap in Embedded Elements Path B

**Location:** `billing-checkout.service.ts:566-721`

`createSubscriptionFromPayment()` creates the Stripe subscription and local `BillingSubscription` row at lines 668-692, then emits `billing.subscription.created` at line 699. It does NOT call `recomputeEntitlements()`.

If the `customer.subscription.created` webhook arrives before the local subscription row is committed (line 692 has not executed yet), the webhook's `upsertSubscriptionFromStripe()` can't find the row and returns `'ignored'`. The internal event (`billing.subscription.created`) has no listener. **Result: user has an active subscription on Stripe and in the local DB, but no entitlements are ever created.**

### 11.2 `assertNoActiveSubscription()` gap after checkout creation

**Location:** `billing-checkout.service.ts:782-798`

The check is performed at the START of checkout creation, but no lock is held on the subscription table during the Stripe API calls. Between the check and the Stripe call (e.g., lines 303-398 for Hosted Checkout, lines 485-527 for Embedded Elements), another concurrent request could create a subscription for the same user.

### 11.3 SessionId absent in Embedded Elements subscription response

**Location:** `billing-checkout.dto.ts:192-206`

`EmbeddedElementsCheckoutResponseDto` has only `paymentIntentId` and `clientSecret`. No `sessionId`. The `OneTimeElementsCheckoutResponseDto` (lines 215-228) does include `sessionId`. This is asymmetric — the one-time Elements flow returns a session identifier but the subscription Elements flow does not.

### 11.4 Event emitter registration mismatch

**Location:** `billing.module.ts:91-123` (providers)

No event listeners are registered. The `@nestjs/event-emitter` module may be configured at the app level, but within the billing module, events are emitted but never consumed. This means:
- `billing.subscription.created` — emitted but not listened to
- `billing.payment.succeeded` — emitted but not listened to
- `billing.checkout.created` — emitted but not listened to

### 11.5 `User.isPremium` staleness

**Location:** `billing-entitlements.service.ts:47-48`

The column exists on the `users` table, is never written by the billing module, and is documented as "intentionally never written." Any downstream code that checks this column will get stale data.

---

## 12. Files Referenced

| File | Path | Key Lines |
|---|---|---|
| Billing controller | `src/billing/controllers/billing.controller.ts` | 86-441 |
| Checkout service | `src/billing/services/billing-checkout.service.ts` | 1-834 |
| Webhook service | `src/billing/services/billing-webhook.service.ts` | 1-1308 |
| Customer service | `src/billing/services/billing-customer.service.ts` | 1-290 |
| Entitlements service | `src/billing/services/billing-entitlements.service.ts` | 1-389 |
| Portal service | `src/billing/services/billing-portal.service.ts` | 1-101 |
| Idempotency service | `src/billing/services/billing-idempotency.service.ts` | 1-346 |
| Stripe snapshot util | `src/billing/common/stripe-snapshot.util.ts` | 1-406 |
| Billing module | `src/billing/billing.module.ts` | 1-199 |
| Constants | `src/billing/common/billing.constants.ts` | 1-140 |
| Enums | `src/billing/common/billing.enums.ts` | 1-126 |
| Checkout DTOs | `src/billing/dto/billing-checkout.dto.ts` | 1-270 |
| Webhook controller | `src/billing/controllers/stripe-webhook.controller.ts` | 1-156 |
| Public controller | `src/billing/controllers/billing.public.controller.ts` | 1-46 |
| BillingPayment entity | `src/billing/entities/billing-payment.entity.ts` | 1-84 |
| BillingSubscription entity | `src/billing/entities/billing-subscription.entity.ts` | 1-98 |
| BillingCustomer entity | `src/billing/entities/billing-customer.entity.ts` | 1-44 |
| BillingEntitlement entity | `src/billing/entities/billing-entitlement.entity.ts` | 1-52 |
| User subscriptions controller | `src/plans-subscriptions/controllers/user-subscriptions.controller.ts` | 1-87 |
| User payments controller | `src/plans-subscriptions/controllers/user-payments.controller.ts` | 1-66 |
| User billing history service | `src/plans-subscriptions/services/user-billing-history.service.ts` | 1-226 |
| Subscription history item DTO | `src/plans-subscriptions/dto/user-subscription-history.dto.ts` | 1-40 |
| Auth service (getCurrentUserWithPlan) | `src/auth/auth.service.ts` | 368-441 |

---

## 13. Conclusion

The backend implements **two complete, intentionally separate subscription checkout workflows**:

1. **Hosted Checkout (canonical/primary)** — Designed around Stripe Checkout Sessions. Pre-creates a subscription shell with a placeholder `pending_sub:` id, redirects the user to Stripe, and relies on webhooks (`checkout.session.completed` + `customer.subscription.created`) to update the local state. Entitlements are created by webhook-triggered recomputes. No frontend API call is needed after the redirect. This flow is fully self-contained and correct.

2. **Embedded Elements (secondary)** — Designed for frontend Stripe Elements integration. Creates only a PaymentIntent and a PENDING BillingPayment. Requires the frontend to call `POST /api/billing/subscriptions/create` after `stripe.confirmPayment()` succeeds. This endpoint creates the Stripe subscription and the local `BillingSubscription` row. The flow works end-to-end IF the frontend makes this call, with one caveat: entitlements depend on the `customer.subscription.created` webhook arriving after the local row is written (race condition #2).

The **canonical workflow is the Hosted Checkout** — it is more fully featured, has better error handling (placeholder expiration, retry safety), and correctly handles entitlement generation through webhooks.
