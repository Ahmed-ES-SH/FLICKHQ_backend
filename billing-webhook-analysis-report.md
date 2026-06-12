# Billing Webhook & Checkout Flow Analysis Report

**Date:** 2026-06-12
**Author:** AI Analysis
**Scope:** `src/billing/`, `src/plans-subscriptions/`

---

## 1. Executive Summary

Two linked issues have been identified:

1. **Infinite loop** when the user opens the checkout page — caused by Stripe webhook events (specifically `customer.created`) interacting with the checkout flow in a way that prevents normal completion.
2. **User never receives their plan** after a successful Stripe Checkout session — the subscription/entitlement state is not properly persisted, and the legacy `user.isPremium` flag is never updated.

---

## 2. The "Infinite Loop" — Root Cause Analysis

### 2.1 What the User Showed

**Response from Stripe (webhook event payload):**
```json
{
  "id": "cus_UgkIJwkCpBt61O",
  "object": "customer",
  "metadata": { "userId": "5" },
  "name": "ahmedismaileng99",
  "email": "ahmedismaileng99@gmail.com"
}
```

This is a `customer.created` Stripe webhook event — the full `Customer` object sent as `data.object` in the event payload.

**Request body (what was sent TO Stripe):**
```json
{
  "email": "ahmedismaileng99@gmail.com",
  "metadata": { "userId": "5" },
  "name": "ahmedismaileng99"
}
```

This is the body used when calling `stripe.customers.create()` inside `BillingCustomerService.getOrCreateForUser()`.

### 2.2 The Flow That Triggers the Loop

```
1. Frontend opens checkout page
   │
   ├──► Frontend calls POST /api/billing/checkout/subscription (or GET /api/billing/customer)
   │
   ├──► Backend: BillingCheckoutService.createSubscriptionCheckout()
   │      │
   │      └──► BillingCustomerService.getOrCreateForUser(userId=5)
   │             │
   │             └──► stripe.customers.create({ email, name, metadata: { userId: "5" } })
   │                    │
   │                    ├──► Stripe creates customer "cus_UgkIJwkCpBt61O"
   │                    │      │
   │                    │      └──► Stripe sends customer.created WEBHOOK
   │                    │             │
   │                    │             └──► POST /api/billing/webhooks/stripe
   │                    │                    │
   │                    │                    ├──► BillingWebhookService.receiveEvent()
   │                    │                    │      ├──► verify signature ✓
   │                    │                    │      ├──► persist event row (billing_webhook_events)
   │                    │                    │      ├──► dispatch(event.type='customer.created')
   │                    │                    │      └──► handleCustomerUpsert()
   │                    │                    │             └──► BillingCustomerService.applyCustomerUpdate()
   │                    │                    │                    ├──► findOne by stripeCustomerId
   │                    │                    │                    ├──► merge metadata
   │                    │                    │                    └──► save → OK
   │                    │                    │
   │                    │                    └──► Returns HTTP 200 (kind: processed)
   │                    │
   │                    └──► (continues) stripe.checkout.sessions.create(...)
   │                           │
   │                           └──► Returns { sessionId: "cs_...", url: "https://..." }
   │
   ├──► Frontend receives sessionId + url
   │
   ├──► Frontend redirects user to Stripe Checkout (url)
   │
   ├──► User completes payment on Stripe
   │
   ├──► Stripe redirects to success_url?session_id=cs_xxx
   │
   └──► INFINITE LOOP: Frontend success page calls backend again → creates another
                         checkout session → loop repeats
```

### 2.3 Likely Root Causes of the Loop

#### 2.3.1 Frontend Misconsumption of `sessionId`

The `sessionId` (Stripe Checkout Session ID `cs_*`) is returned from the backend and also appended to the success URL via `appendSessionId()` (`src/billing/services/billing-checkout.service.ts:811`):

```typescript
private appendSessionId(url: string): string {
    if (url.includes('{CHECKOUT_SESSION_ID}')) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}session_id={CHECKOUT_SESSION_ID}`;
}
```

The frontend success page reads `session_id` from the URL after Stripe redirect. **If the success page incorrectly calls the checkout creation endpoint again** (instead of calling a proper verification/completion endpoint), a new Checkout Session is created for each loop iteration.

The backend DTO (`BillingCheckoutSessionResponseDto`) already includes `sessionId` in the response, but there is **no dedicated backend endpoint** for verifying or completing a checkout session by `sessionId`. The frontend has no safe endpoint to call with just the `sessionId`.

#### 2.3.2 `customer.created` Webhook Failing

If `handleCustomerUpsert()` throws an error (e.g., the local `BillingCustomer` row doesn't exist yet because `getOrCreateForUser` hasn't committed the DB transaction), the webhook handler returns a 5xx response, causing **Stripe to retry the webhook** with exponential backoff. While Stripe's backoff alone wouldn't cause an "infinite loop" in real time, repeated failures flood the logs and can trigger frontend error-retry logic.

**Likely failure point:** Race condition between `getOrCreateForUser` (which creates the local `BillingCustomer` row and commits the transaction) and the `customer.created` webhook arriving. If the webhook arrives **before** the DB transaction commits, `applyCustomerUpdate()` won't find the local row and returns `null`, causing the handler to return `'ignored'`. This actually works correctly — but if there's any other error during the update (e.g., jsonb merge issue), it would throw.

**Another potential issue:** The `applyCustomerUpdate` merges `stripeCustomer.metadata` (which is `{ userId: "5" }` as a string key-value) into the local `BillingCustomer.metadata` jsonb. The local row already has metadata. This merge could cause issues if the metadata structure is incompatible with any DB constraints or application logic downstream.

#### 2.3.3 Missing Idempotency for the Frontend-to-Backend Session Completion

After Stripe redirects the user back to `success_url?session_id=cs_xxx`, the frontend needs to:
1. Read `sessionId` from URL
2. Call a backend endpoint to confirm completion

**There is no dedicated endpoint** in `BillingController` for post-checkout verification. The closest endpoints are:
- `POST /billing/subscriptions/create` — but this expects a `paymentIntentId`, not a `sessionId`
- `GET /billing/entitlements` — to check if entitlements were granted

If the frontend success page calls `POST /billing/checkout/subscription` again (with the same or different priceId), a **new** checkout session is created, and the loop begins anew.

---

## 3. Task 2: Where the `sessionId` Value Is / Should Be Allowed

### Answer: `frontend`

The `sessionId` (Stripe Checkout Session ID `cs_*`) flows through both layers but is **consumed** on the frontend:

| Layer | Where | How |
|-------|-------|-----|
| **Backend** | `BillingPayment.stripeCheckoutSessionId` | Unique index, stored at checkout creation |
| **Backend** | `BillingSubscription.stripeCheckoutSessionId` | Unique index, stored at checkout creation |
| **Backend** | `BillingCheckoutSessionResponseDto.sessionId` | Returned in REST response body |
| **Frontend** | Success URL `?session_id={CHECKOUT_SESSION_ID}` | Stripe replaces placeholder on redirect |
| **Frontend** | URL query param reading | Frontend success page reads `sessionId` from URL |

The frontend success page **must** read the `session_id` from the URL and use it to call a dedicated verification endpoint (which does not yet exist in the API). Currently there is no safe, idempotent endpoint for the frontend to call with just the `sessionId`.

---

## 4. Why the User Never Gets Their Plan

### 4.1 Issue A: `User.isPremium` Is Never Updated

The `User` entity has a legacy column `is_premium` (`src/user/schema/user.entity.ts:63`):

```typescript
@Column({ default: false, name: 'is_premium' })
isPremium: boolean;
```

The billing module's `BillingEntitlementsService` **explicitly states it never writes to this column** (`src/billing/services/billing-entitlements.service.ts:47`):

```
* `users.is_premium` is intentionally never written by this
* service. It is a pre-existing compatibility column and will be
* removed in a future cleanup migration.
```

**If the frontend or any other service checks `user.isPremium` to determine premium status, it will ALWAYS be `false`.**

The correct way to check premium access is through:
- `BillingEntitlementsService.canAccess(userId, 'premium_reports')` (or whichever feature key)
- `FeatureAccessGuard` with `@RequiresFeature('premium_reports')` decorator
- `GET /api/billing/entitlements` endpoint returning active entitlements

### 4.2 Issue B: Webhook Handlers May Fail to Properly Assign the Subscription

The webhook handlers for `checkout.session.completed` (`handleCheckoutSessionCompleted`, line 469), `customer.subscription.created` (`handleSubscriptionCreated`, line 838), and `payment_intent.succeeded` (`handlePaymentIntentSucceeded`, line 603) all rely on extracting `LocalBillingIds` from the Stripe event's `metadata` field via `extractLocalBillingIds()`.

**Potential failure points:**

1. **Missing metadata**: If the Stripe event doesn't carry `metadata.localPaymentId`, the handler returns `'ignored'` — no subscription is assigned.
2. **Placeholder replacement failure**: `handleCheckoutSessionCompleted` (line 517-541) updates the subscription's placeholder ID (`pending_sub:...`) to the real `sub_...`. If `localSubscriptionId` is null in the metadata, this step is skipped.
3. **`upsertSubscriptionFromStripe` failure** (line 912-977): If neither `stripeSubscriptionId` lookup nor `localSubscriptionId`/`localPaymentId` from metadata matches a local row, the subscription event is ignored.
4. **Entitlement recompute failure** (line 1293-1298): If `recomputeEntitlements()` throws, the error propagates and the webhook handler returns 5xx → Stripe retries. But the local billing row has already been written.

### 4.3 Issue C: Plan Features Array Must Be Populated

For entitlements to be granted, the `BillingPlan.features` array must contain the relevant feature keys (e.g., `['premium_reports', 'team_export']`). If the plan was created without features, `recomputeEntitlements()` will produce zero entitlement rows.

### 4.4 Issue D: Entitlement Time Window

`canAccess()` (`billing-entitlements.service.ts:114`) checks:
```typescript
where: [
    { userId, featureKey, active: true, endsAt: IsNull() },          // No end date
    { userId, featureKey, active: true, endsAt: MoreThan(graceTime) }, // Within grace period
]
```

If the subscription's `currentPeriodEnd` has passed and no grace period applies, the entitlement is not active. The 24-hour grace period (`graceTime = now - 24h`) should cover normal clock drift, but a very old subscription might not grant access.

---

## 5. Recommended Fixes

### 5.1 Fix the Infinite Loop

| # | Fix | Location | Priority |
|---|-----|----------|----------|
| 1 | **Add a dedicated `POST /billing/checkout/verify` endpoint** that accepts `sessionId` and returns the current checkout/subscription status. The frontend success page should call THIS endpoint, not the checkout creation endpoint. | New endpoint in `BillingController` | **High** |
| 2 | **Add idempotency checking on the frontend** — after redirect from Stripe, check if a checkout was already completed for this `sessionId` before creating a new one. | Frontend | **High** |
| 3 | **Verify `customer.created` webhook processing** — ensure `applyCustomerUpdate()` handles the race condition where the webhook arrives before the local row is committed. Add proper retry/ignore logic. | `billing-customer.service.ts` `applyCustomerUpdate()` | Medium |
| 4 | **Add proper error logging** to `customer.created` webhook processing so failed events are visible in the admin dashboard. | `billing-webhook.service.ts` `handleCustomerUpsert()` | Low |

### 5.2 Fix the Plan Assignment

| # | Fix | Location | Priority |
|---|-----|----------|----------|
| 1 | **Update `User.isPremium` in the entitlements recompute or webhook handlers** so legacy code paths that check this flag work correctly. | `billing-entitlements.service.ts` `recomputeForUser()` | **High** |
| 2 | **Audit the frontend** to check if it reads `user.isPremium` or `GET /api/billing/entitlements`. Change to use entitlements endpoint. | Frontend | **High** |
| 3 | **Verify the plan features array** in the database contains the expected feature keys (e.g., `premium_reports`). | DB / seed script | **High** |
| 4 | **Add transaction logging** for the full webhook-to-entitlement pipeline — log each step so failed webhook events can be debugged. | `billing-webhook.service.ts` | Medium |
| 5 | **Verify `checkout.session.completed` handler** — ensure it always updates the subscription placeholder ID. Add a fallback if `localSubscriptionId` is null in metadata. | `billing-webhook.service.ts:517-541` | Medium |
| 6 | **Verify `upsertSubscriptionFromStripe`** handles the case where the subscription is found by `stripeSubscriptionId` but the local payment is in a different status. | `billing-webhook.service.ts:912-977` | Low |

### 5.3 Post-Checkout Verification Endpoint (Priority #1 Fix)

This is the most critical missing piece. A new endpoint should be added:

```
POST /api/billing/checkout/session-status
Body: { sessionId: "cs_test_..." }
Response: {
  status: "complete" | "processing" | "expired",
  subscriptionId?: string,
  paymentStatus?: string
}
```

This endpoint retrieves the Stripe Checkout Session, checks its status, and returns the consolidated result. The frontend calls this instead of re-creating the checkout.

---

## 6. Code Path Summary

| Component | File | Key Lines |
|-----------|------|-----------|
| Checkout creation | `billing-checkout.service.ts` | 278-446 |
| Append sessionId to URL | `billing-checkout.service.ts` | 811-822 |
| Customer creation (triggers webhook) | `billing-customer.service.ts` | 96-167, 142-148 |
| Webhook entry point | `stripe-webhook.controller.ts` | 85-127 |
| Webhook receive + dispatch | `billing-webhook.service.ts` | 187-265 |
| `checkout.session.completed` handler | `billing-webhook.service.ts` | 469-552 |
| `customer.created` handler | `billing-webhook.service.ts` | 820-832 |
| `customer.subscription.created` handler | `billing-webhook.service.ts` | 838-853 |
| `upsertSubscriptionFromStripe` | `billing-webhook.service.ts` | 912-977 |
| Placeholder subscription ID | `billing-checkout.service.ts` | 85, 334, 729-741 |
| Entitlement recompute | `billing-entitlements.service.ts` | 176-271 |
| `isPremium` on User (NEVER written) | `user.entity.ts` | 63-64 |
| `canAccess` check | `billing-entitlements.service.ts` | 114-136 |
| Checkout response DTO (has sessionId) | `billing-checkout.dto.ts` | 152-178 |

---

## 7. The `customer.created` Webhook Data — Detailed Analysis

**Stripe event triggered by:** `BillingCustomerService.getOrCreateForUser(userId=5)` → `stripe.customers.create({ email, name, metadata: { userId: "5" } })`

**Webhook received at:** `POST /api/billing/webhooks/stripe`

**Event type:** `customer.created`

**Handler:** `handleCustomerUpsert` → `BillingCustomerService.applyCustomerUpdate()`

**Processing steps:**
1. `extractLocalBillingIds(customer.metadata)` — extracts `userId: 5` from `{ userId: "5" }`
2. `applyCustomerUpdate(customer)` — looks up local `BillingCustomer` by `stripeCustomerId = "cus_UgkIJwkCpBt61O"`
3. If found: updates `email`, `name`, merges `metadata` (including `userId: "5"`)
4. If not found: returns `null` → handler returns `'ignored'` → HTTP 200

**If this handler fails (throws error):**
- The webhook event row is marked `failed`
- Stripe receives HTTP 5xx
- Stripe retries the webhook with exponential backoff
- The failure is visible in the admin dashboard under failed webhooks

---
