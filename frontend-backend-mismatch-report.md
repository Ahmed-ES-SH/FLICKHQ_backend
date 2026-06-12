# Frontend ↔ Backend Payment Workflow Mismatch Report

**Date:** 2026-06-12
**Source:** `payment-workflow.md` (frontend) vs `src/billing/` + `src/plans-subscriptions/` (backend)

---

## Critical Finding: Missing `POST /api/billing/subscriptions/create` Step

This is the **root cause of users never getting their plan** after subscription checkout via embedded Elements.

### What the Backend Expects (Documented in Swagger)

`src/billing/controllers/billing.controller.ts:252-255`:
```
After stripe.confirmPayment() succeeds, call POST /api/billing/subscriptions/create
with the returned paymentIntentId to create the actual subscription.
```

The intended flow for subscription via embedded Elements:

```
1. POST /api/billing/checkout/embedded-elements
   → { paymentIntentId: "pi_xxx", clientSecret: "pi_xxx_secret_xxx" }

2. stripe.confirmPayment({ clientSecret, return_url: "/checkout/success" })
   → PaymentIntent is confirmed on Stripe
   → User redirected to /checkout/success?payment_intent=pi_xxx&...

3. POST /api/billing/subscriptions/create  ← MISSING in frontend!
   { paymentIntentId: "pi_xxx" }
   → Backend creates Stripe subscription with confirmed payment method
   → Returns { subscriptionId: "sub_xxx", status: "active" }

4. GET /api/subscriptions/current
   → Poll until active subscription is found
```

### What the Frontend Actually Does
```
1. POST /api/billing/checkout/embedded-elements                  → payment-workflow.md:44
   → { clientSecret: "pi_xxx_secret_xxx", sessionId?: "cs_xxx" }

2. stripe.confirmPayment({ return_url: "/checkout/success" })    → payment-workflow.md:63-64
   → Stores sessionId in sessionStorage
   → Stripe redirects to /checkout/success?session_id=...&payment_intent=pi_xxx

3. Poll GET /api/subscriptions/current                            → payment-workflow.md:77
   → NEVER calls POST /api/billing/subscriptions/create
   → Times out after MAX_POLL_ATTEMPTS because subscription doesn't exist
```

**Result:** The PaymentIntent succeeds (money moves), but no subscription is created in the billing module because `createSubscriptionFromPayment()` at `src/billing/services/billing-checkout.service.ts:566` is never called. The success page polls `GET /api/subscriptions/current` which returns `null` (no `BillingSubscription` with ACTIVE/TRIALING/PAST_DUE status exists), so it times out.

---

## Detailed Discrepancy Table

| # | Aspect | Frontend Expects (`payment-workflow.md`) | Backend Reality (`src/billing/`) | Impact |
|---|--------|------------------------------------------|----------------------------------|--------|
| 1 | **Post-payment step** | Polls `GET /api/subscriptions/current` only (step 5) | Requires `POST /api/billing/subscriptions/create` with `paymentIntentId` after `confirmPayment()` | **User never gets subscription → success page times out** |
| 2 | **`sessionId` in subscription Elements response** | `POST /api/billing/checkout/embedded-elements` returns `{ clientSecret, sessionId? }` (step 3.5) | Returns `EmbeddedElementsCheckoutResponseDto` with only `paymentIntentId` + `clientSecret` (NO `sessionId`). Only `OneTimeElementsCheckoutResponseDto` has `sessionId`. | Frontend stores `undefined` in `sessionStorage` |
| 3 | **Success page URL params read** | Reads `session_id` from URL (step 5.1) | Subscription Elements flow puts `payment_intent` in URL, NOT `session_id`. The `session_id` param is only added by hosted Checkout redirect. | Success page can't find `session_id` → gets `null` |
| 4 | **`paymentIntentId` usage** | Never referenced after checkout creation | Is the key identifier needed for `POST /api/billing/subscriptions/create` | Frontend has the value but never uses it |
| 5 | **Webhook dependency for subscription creation** | Implicitly relies on webhooks to create subscription | Webhooks (`checkout.session.completed`, `payment_intent.succeeded`, `customer.subscription.created`) should process events, but subscription flow is designed as **frontend-initiated** via `createSubscriptionFromPayment` | If webhook arrives before frontend calls `createSubscriptionFromPayment`, `assertNoActiveSubscription` at line 637 **blocks** the frontend call with ConflictException (race condition) |
| 6 | **`appendSessionId` usage** | Not mentioned at all | `appendSessionId()` at line 811 adds `?session_id={CHECKOUT_SESSION_ID}` to hosted checkout success URLs. Not used in embedded-elements flow. | Only relevant for hosted checkout, not Elements |

---

## 1. Missing `POST /api/billing/subscriptions/create` — Deep Dive

### Backend Code Path

| File | Line | What |
|------|------|------|
| `billing.controller.ts` | 389-404 | `createSubscriptionFromPayment()` — controller entry point |
| `billing-checkout.service.ts` | 566-684 | `createSubscriptionFromPayment()` — service method |
| `billing-checkout.service.ts` | 584-596 | Retrieves PaymentIntent from Stripe, verifies status is `"succeeded"` |
| `billing-checkout.service.ts` | 598-603 | Extracts `paymentMethodId` from the PaymentIntent |
| `billing-checkout.service.ts` | 606-613 | Finds local `BillingPayment` by `stripePaymentIntentId` |
| `billing-checkout.service.ts` | 637 | `assertNoActiveSubscription()` — rejects if user already has one |
| `billing-checkout.service.ts` | 640-657 | Creates Stripe subscription with the confirmed payment method |
| `billing-checkout.service.ts` | 668-684 | Creates local `BillingSubscription` row with status `ACTIVE` |
| `billing-checkout.service.ts` | 685+ | Updates `BillingPayment` status, emits events |

### What Gets Created When It Works
- Stripe subscription (`sub_xxx`) linked to the customer
- `BillingSubscription` row in `billing_subscriptions` table with `status = 'active'`
- `BillingPayment` row updated with `status = 'completed'` and linked to the subscription
- `BillingEntitlement` rows created via event handler (if `recomputeEntitlements()` runs)

### What Happens When It's Missing
- `BillingPayment` stays in `PENDING` status (not `COMPLETED`)
- No `BillingSubscription` row is created
- `GET /api/subscriptions/current` returns `null` (no rows match the ACTIVE/TRIALING/PAST_DUE filter)
- `GET /api/auth/current-user` returns subscription with `status: 'free'`
- Success polling times out after `MAX_POLL_ATTEMPTS`

---

## 2. `sessionId` Confusion in the Subscription Elements Flow

### Frontend's Expectation (step 4.1)
```ts
// CustomCheckoutForm.tsx:56
sessionStorage.setItem('checkout_session_id', sessionId);
```

### Backend's Subscription Elements Response DTO
```ts
// billing-checkout.dto.ts:192-206
export class EmbeddedElementsCheckoutResponseDto {
  paymentIntentId: string;  // ← exists
  clientSecret: string;     // ← exists
  // NO sessionId field
}
```

### Backend's One-Time Elements Response DTO
```ts
// billing-checkout.dto.ts:215-228
export class OneTimeElementsCheckoutResponseDto {
  sessionId: string;        // ← only here
  clientSecret: string;
}
```

The frontend's step 3.5 documents `sessionId?` as an optional field in the response, but for the **subscription** embedded-elements flow, the backend never returns `sessionId`. The frontend stores `undefined` to `sessionStorage`.

The frontend's `CustomCheckoutForm.tsx` likely reads `sessionId` from:
```ts
const { sessionId } = await createElementsCheckoutSessionAction({ priceId });
```
This will be `undefined` for subscriptions. On the success page, the frontend tries to recover it from `sessionStorage` (which has `undefined`) or URL params:

```ts
// useCheckoutSuccess.ts:48-61
const sessionId = searchParams.get('session_id') || sessionStorage.getItem('checkout_session_id');
```

For the subscription Elements flow, Stripe's `confirmPayment` redirects to:
```
/checkout/success?payment_intent=pi_xxx&payment_intent_client_secret=pi_xxx_secret_xxx&redirect_status=succeeded
```

There is NO `session_id` in the URL for this flow. `session_id` is only present in the URL after a **hosted Checkout Session** redirect.

---

## 3. The Race Condition Between Webhook and `createSubscriptionFromPayment`

The backend creates a **PaymentIntent** (not a Checkout Session) in the embedded-elements flow. After `confirmPayment()` succeeds, Stripe sends these webhooks:

1. `payment_intent.succeeded` — arrives immediately
2. `customer.subscription.created` — only if Stripe auto-creates a subscription (which it doesn't in this flow, since the subscription is created server-side later)

**If `payment_intent.succeeded` webhook arrives BEFORE** the frontend calls `POST /api/billing/subscriptions/create`:

The webhook handler `handlePaymentIntentSucceeded` at `billing-webhook.service.ts:603` attempts to process the PaymentIntent. It may try to:
- Find the local `BillingPayment` by `stripePaymentIntentId`
- Update payment status to `completed`
- Potentially create a subscription if metadata says so

But the backend's subscription creation flow is designed as **frontend-driven** (`createSubscriptionFromPayment`). The webhook handler might update the `BillingPayment` to `completed` status, which could cause `createSubscriptionFromPayment` to behave unexpectedly.

**Conversely**, if the frontend calls `createSubscriptionFromPayment` FIRST and the webhook arrives later:
- The webhook may try to process an already-completed payment
- The Stripe subscription created by `createSubscriptionFromPayment` triggers `customer.subscription.created` webhook, which should detect the duplicate and respond with `'ignored'`

---

## 4. Hosted Checkout Subscription Flow (Not Embedded)

The frontend `payment-workflow.md` only documents the **embedded Elements** flow (step 3.5), but the backend also supports a **hosted Checkout Session** flow:

### Backend Routes for Hosted Flow
| Endpoint | Response DTO | After Redirect |
|----------|-------------|---------------|
| `POST /api/billing/checkout/subscription` | `{ sessionId: "cs_xxx", url: "https://..." }` | Stripe handles everything via webhooks |
| `POST /api/billing/checkout/one-time` | `{ sessionId: "cs_xxx", url: "https://..." }` | Stripe handles everything via webhooks |

In the hosted flow:
- The frontend redirects the user to `url` (Stripe Checkout page)
- Stripe handles the payment UI
- After completion, Stripe redirects to `success_url?session_id={CHECKOUT_SESSION_ID}`
- Webhooks (`checkout.session.completed`, `customer.subscription.created`) create the subscription
- No `POST /api/billing/subscriptions/create` step is needed

This flow works correctly because the `appendSessionId()` method at `billing-checkout.service.ts:811` appends `?session_id={CHECKOUT_SESSION_ID}` to the success URL, and the webhooks handle everything.

---

## 5. `User.isPremium` Never Updated

Even if the subscription IS created (e.g., via hosted Checkout or if the frontend were to call `createSubscriptionFromPayment`), the `User.isPremium` column at `src/user/schema/user.entity.ts:63` is **never written by the billing module**. As documented in `billing-entitlements.service.ts:47`:

```
`users.is_premium` is intentionally never written by this
service. It is a pre-existing compatibility column and will be
removed in a future cleanup migration.
```

If the frontend's `useAuthStore` or `subscriptionStore` (mentioned at `payment-workflow.md:122`) reads `user.isPremium` from the `GET /api/auth/current-user` response, it will always see `false`, even for authenticated paying users.

The correct way to check premium status is:
- `GET /api/billing/entitlements` → returns feature keys the user has access to
- `BillingEntitlementsService.canAccess(userId, featureKey)` → checks if a specific feature is granted
- `Subscription` status from `GET /api/auth/current-user` → the `subscription` object in the response has `status` field

---

## 6. Endpoint Path Verification

| Frontend (`payment-workflow.md`) | Backend Controller | Match? |
|----------------------------------|-------------------|--------|
| `GET /api/plans` | `PublicPlansController` (`src/plans-subscriptions/controllers/public-plans.controller.ts:13`) | ✅ |
| `GET /api/billing/customer` | `BillingController.getCustomer()` (`src/billing/controllers/billing.controller.ts:96`) | ✅ |
| `POST /api/billing/checkout/embedded-elements` | `BillingController.createEmbeddedElementsCheckout()` (`src/billing/controllers/billing.controller.ts:240`) | ✅ Path matches, but **request/response shape differs** (no `sessionId` in response) |
| `POST /api/billing/portal/session` | `BillingController.createPortalSession()` (`src/billing/controllers/billing.controller.ts:130`) | ✅ |
| `GET /api/subscriptions/current` | `UserSubscriptionsController.getCurrentSubscription()` (`src/plans-subscriptions/controllers/user-subscriptions.controller.ts:34`) | ✅ |
| `GET /api/subscriptions/history` | `UserSubscriptionsController.getSubscriptionHistory()` (`src/plans-subscriptions/controllers/user-subscriptions.controller.ts:48`) | ✅ |
| `GET /api/subscriptions/history/:id` | `UserSubscriptionsController.getSubscriptionTimeline()` | ✅ |
| `GET /api/payments/history` | `UserPaymentsController.getPaymentHistory()` (`src/plans-subscriptions/controllers/user-payments.controller.ts:29`) | ✅ |
| `GET /api/payments/:id` | `UserPaymentsController.getPaymentDetail()` | ✅ |
| `GET /api/auth/current-user` | `AuthController.getProfile()` (`src/auth/auth.controller.ts:59`) | ✅ |
| `POST /api/billing/checkout/subscription` | `BillingController.createSubscriptionCheckout()` (`src/billing/controllers/billing.controller.ts:197`) | Not documented in frontend workflow (hosted flow) |
| `POST /api/billing/checkout/one-time` | `BillingController.createOneTimeCheckout()` (`src/billing/controllers/billing.controller.ts:157`) | Not documented in frontend workflow (hosted flow) |
| `POST /api/billing/subscriptions/create` | `BillingController.createSubscriptionFromPayment()` (`src/billing/controllers/billing.controller.ts:389`) | **NOT in frontend workflow at all** ❌ |

---

## 7. Success Page Polling Logic — Comparison

### Backend's `GET /api/subscriptions/current` (`user-billing-history.service.ts:31-47`)
```ts
const subscription = await this.subscriptionRepository.findOne({
  where: [
    { userId, status: BillingSubscriptionStatus.ACTIVE },
    { userId, status: BillingSubscriptionStatus.TRIALING },
    { userId, status: BillingSubscriptionStatus.PAST_DUE },
  ],
  relations: ['plan', 'price'],
  order: { createdAt: 'DESC' },
});
```

### Frontend's Polling (`useCheckoutSuccess.ts:72-102`)
```ts
// Pseudocode based on payment-workflow.md
const POLL_INTERVAL_MS = 2000;  // (assumed)
const MAX_POLL_ATTEMPTS = 15;   // (assumed)
let attempts = 0;

while (attempts < MAX_POLL_ATTEMPTS) {
  const subscription = await fetchCurrentSubscriptionAction();
  if (subscription) {
    setStatus('confirmed');
    return;
  }
  await sleep(POLL_INTERVAL_MS);
  attempts++;
}
setStatus('error'); // Max attempts reached
```

**Maximum wait time:** ~30 seconds (15 attempts × 2 seconds). If the subscription isn't created within 30 seconds, the user sees an error even though payment succeeded.

---

## 8. Summary of Required Fixes

### Critical (blocks subscription checkout from working)

| # | Fix | File(s) | Description |
|---|-----|---------|-------------|
| 1 | **Add `POST /api/billing/subscriptions/create` call** after `stripe.confirmPayment()` succeeds | Frontend: `CustomCheckoutForm.tsx` or success page | The frontend must call `createSubscriptionFromPaymentAction({ paymentIntentId })` after payment confirmation **before** polling for the subscription. The `paymentIntentId` is in the redirect URL param `payment_intent`. |
| 2 | **Fix success URL parameter reading** for subscription Elements flow | Frontend: `useCheckoutSuccess.ts` | For subscription Elements flow, read `payment_intent` from URL (not `session_id`). There is no `session_id` in the redirect URL for this flow. |

### High (broken after the above is fixed)

| # | Fix | File(s) | Description |
|---|-----|---------|-------------|
| 3 | **Update `User.isPremium`** in `recomputeEntitlements()` or webhook success path | `billing-entitlements.service.ts` | Any legacy code checking `user.isPremium` sees `false` even after successful subscription. Either update this column, or migrate all frontend checks to use entitlements. |
| 4 | **Handle race condition** between `createSubscriptionFromPayment` and webhook | `billing-checkout.service.ts:637` | `assertNoActiveSubscription` at line 637 rejects if webhook already created the subscription. Need a more graceful handling (idempotency check by `paymentIntentId`). |

### Medium (robustness)

| # | Fix | File(s) | Description |
|---|-----|---------|-------------|
| 5 | **Add sessionId to subscription Elements response** for consistency | `EmbeddedElementsCheckoutResponseDto` | The one-time variant has `sessionId`; the subscription variant doesn't. Adding it would let the frontend use a uniform approach across both flows. |
| 6 | **Add explicit `POST /api/billing/checkout/verify` endpoint** | New endpoint in `BillingController` | Accept `paymentIntentId` or `sessionId`, verify the Stripe session/PaymentIntent status, and return the current subscription state. This gives the frontend a safe, idempotent endpoint to replace polling. |
| 7 | **Extend success polling timeout** or add exponential backoff | Frontend: `useCheckoutSuccess.ts` | 15 attempts × 2s = 30s may not be enough for webhook processing + subscription creation. |

---

## 9. End-to-End Corrected Flow Diagram (Subscription via Elements)

```
Frontend                                     Backend
─────────────────────────────────────        ─────────────────────────────
1. POST /api/billing/checkout/embedded-elements
   ─────────────────────────────────────►    Creates BillingPayment
                                              Creates Stripe PaymentIntent
   ◄─────────────────────────────────────    { paymentIntentId, clientSecret }

2. stripe.confirmPayment({ clientSecret, return_url })
   ─────── Stripe.js (browser) ────────►     Stripe processes payment
   ◄────── Redirect to /checkout/success?payment_intent=pi_xxx
   
3. Read payment_intent=pi_xxx from URL
   
4. POST /api/billing/subscriptions/create    ◄── THIS STEP IS MISSING
   { paymentIntentId: "pi_xxx" }
   ─────────────────────────────────────►    Verifies PaymentIntent status
                                              Creates Stripe subscription
                                              Creates BillingSubscription row
                                              Creates BillingEntitlement rows
   ◄─────────────────────────────────────    { subscriptionId, status }

5. Poll GET /api/subscriptions/current
   ─────────────────────────────────────►    Returns active subscription
   ◄─────────────────────────────────────    { id, status: "active", ... }

6. User sees success UI
```

---

## 10. Code References (All Backend)

| Component | File | Key Lines |
|-----------|------|-----------|
| Embedded Elements endpoint (controller) | `src/billing/controllers/billing.controller.ts` | 240-291 |
| Embedded Elements response DTO | `src/billing/dto/billing-checkout.dto.ts` | 192-206 |
| One-time Elements response DTO | `src/billing/dto/billing-checkout.dto.ts` | 215-228 |
| `createSubscriptionFromPayment` (controller) | `src/billing/controllers/billing.controller.ts` | 389-404 |
| `createSubscriptionFromPayment` DTO | `src/billing/dto/billing-checkout.dto.ts` | 238-245 |
| `createSubscriptionPaymentIntent` (service) | `src/billing/services/billing-checkout.service.ts` | 463-554 |
| `createSubscriptionFromPayment` (service) | `src/billing/services/billing-checkout.service.ts` | 566-684 |
| `appendSessionId` (service) | `src/billing/services/billing-checkout.service.ts` | 811-822 |
| `assertNoActiveSubscription` (service) | `src/billing/services/billing-checkout.service.ts` | 785-798 |
| `getCurrentSubscription` (history service) | `src/plans-subscriptions/services/user-billing-history.service.ts` | 31-47 |
| Current subscription DTO | `src/plans-subscriptions/dto/user-subscription-history.dto.ts` | 4-40 |
| `getCurrentUserWithPlan` (auth service) | `src/auth/auth.service.ts` | 368-441 |
| `isPremium` on User entity (never written) | `src/user/schema/user.entity.ts` | 63-64 |
| Entitlements service (isPremium not written) | `src/billing/services/billing-entitlements.service.ts` | 47 |
| Webhook `handlePaymentIntentSucceeded` | `src/billing/services/billing-webhook.service.ts` | 603+ |
| Webhook `handleCheckoutSessionCompleted` | `src/billing/services/billing-webhook.service.ts` | 469-552 |
| Webhook `handleCustomerUpsert` | `src/billing/services/billing-webhook.service.ts` | 820-832 |
