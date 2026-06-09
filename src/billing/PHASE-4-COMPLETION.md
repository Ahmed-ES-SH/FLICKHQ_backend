# Billing Module — Phase 4 Completion (Checkout)

This file records the Phase 4 deliverables against the plan
(`src/billing-module-implementation-plan.md`, lines 1041–1062).

## What landed

### Services

- `src/billing/services/billing-idempotency.service.ts` — new.
  - `normalizeKey(rawHeader)` — validates and trims the
    `Idempotency-Key` header value.
  - `hashRequest(request)` — SHA-256 of a stable-JSON serialization
    of the request body (sorted keys, so property order does
    not matter).
  - `reserve({ key, scope, userId, request })` — atomic get-or-
    create. Returns a reservation describing whether the call is
    fresh, replaying a completed response, or retrying a failed
    one. Throws `BillingIdempotencyConflictError` for a key reuse
    with a different body, and `BillingIdempotencyInFlightError`
    for an in-flight replay.
  - `recordSuccess(key, response)` — flips a reservation to
    `completed` and stores the response snapshot.
  - `recordFailure(key)` — flips a reservation to `failed` and
    clears any snapshot, so the next caller with the same hash
    is allowed to retry.
  - `release(key)` — drops the reservation row.
  - The default TTL is `DEFAULT_IDEMPOTENCY_TTL_MS` (24h, set
    in `common/billing.constants.ts`).
  - Expiration is checked against `expires_at`; an expired row
    is flipped back to `in_progress` so a single concurrent
    caller can take over.
  - Unique-constraint races on insert are caught and re-routed
    through the read path (re-reads the winning row).

- `src/billing/services/billing-checkout.service.ts` — new.
  - `createOneTimeCheckout(input)` — server-resolves the local
    `BillingPrice`, validates it is active and of type `one_time`,
    loads the billing customer, creates a local `BillingPayment`
    shell in `checkout_created` status, calls
    `stripe.checkout.sessions.create({ mode: 'payment', ... })`,
    saves the session id, and emits `billing.checkout.created`.
  - `createSubscriptionCheckout(input)` — same flow but for
    `mode: 'subscription'`. In addition to the `BillingPayment`
    shell, a `BillingSubscription` shell is pre-created in
    `incomplete` status. The `stripe_subscription_id` column is
    satisfied with a placeholder (`pending_sub:<localPaymentId>`)
    that the Phase 5 webhook handler will replace with the real
    id from `customer.subscription.created`. The placeholder
    helpers are exposed as `buildSubscriptionPlaceholderId` and
    `isPlaceholderSubscriptionId` for the webhook service.
  - Both methods enforce the v1 "one active subscription per
    user" rule on the subscription path (returns 409 with a
    pointer to the Customer Portal).
  - Both methods enforce that the price's plan is not archived
    on the subscription path.
  - Both methods delegate to `BillingIdempotencyService` first
    so replays return the cached `sessionId` / `url` without
    re-running validation or talking to Stripe.
  - `payment_method_types` is **never** sent — dynamic payment
    methods are the default behavior in API `2026-05-27.dahlia`.
  - `allow_promotion_codes: true` is the default; clients can
    opt out per request.

- `src/billing/services/billing-portal.service.ts` — updated.
  - `createSessionForUser(userId, idempotencyKey)` now requires
    an idempotency key and routes through
    `BillingIdempotencyService` (the deferred Phase 3 work
    noted in `PHASE-3-COMPLETION.md`).
  - On any Stripe or upstream error the reservation is flipped
    to `failed` so a retry is allowed.

- `src/billing/services/billing-catalog.service.ts` — one new
  method: `findPriceById(id)` for the UUID-keyed lookup the
  checkout services need. `findPriceByStripeId` is kept for
  webhook handlers (Phase 5).

### Controllers

- `src/billing/controllers/billing.controller.ts` — two new
  routes plus an idempotency header on the existing portal
  route:

  - `POST /api/billing/checkout/one-time`     — one-time
    Checkout Session, requires `Idempotency-Key` header.
  - `POST /api/billing/checkout/subscription` — subscription
    Checkout Session, requires `Idempotency-Key` header.
  - `POST /api/billing/portal/session`        — now requires
    `Idempotency-Key` header (Phase 3 deferred this to
    Phase 4).

- `src/billing/common/idempotency-key.decorator.ts` — new
  `@IdempotencyKey()` parameter decorator. Reads and validates
  the `Idempotency-Key` request header, throwing a 400 if it
  is missing or empty.

### DTOs

- `src/billing/dto/billing-checkout.dto.ts` — new.
  - `BillingOneTimeCheckoutRequestDto`
    (`{ priceId, quantity?, allowPromotionCodes? }`).
  - `BillingSubscriptionCheckoutRequestDto`
    (`{ priceId, quantity?, clientReferenceId?, trialDays?,
        allowPromotionCodes? }`).
  - `BillingCheckoutSessionResponseDto`
    (`{ sessionId, url }`).
  - All money and currency fields are intentionally absent.
    Clients only supply the local `priceId` UUID.
  - Re-exports `BillingPortalSessionResponseDto` so the
    controller can keep its imports consistent.
- `src/billing/dto/index.ts` — barrel updated to include
  `billing-checkout.dto`.

### Module wiring

- `src/billing/billing.module.ts` — now registers and exports
  `BillingCheckoutService` and `BillingIdempotencyService`. The
  entity registry was already complete from Phase 2.

### Errors

- `src/billing/common/billing.errors.ts` — new
  `BillingIdempotencyInFlightError` (409). Differentiates "an
  identical request is already running" from
  `BillingIdempotencyConflictError` (which now means "key was
  reused with a different body"). Both are 409 but the message
  is much clearer for the in-flight case.

## Acceptance criteria checklist (plan line 1060)

- [x] **Duplicate requests with the same idempotency key return
      the same result.** The `BillingIdempotencyService` stores
      the response snapshot when the operation completes, and
      the checkout service returns the snapshot for any
      subsequent call with the same key + same request body.
- [x] **Reusing the same idempotency key with a different
      request fails.** The `classifyExisting` method compares
      the SHA-256 of the request body and throws
      `BillingIdempotencyConflictError` (409) on mismatch.
- [x] **Client cannot override amount, currency, Stripe
      customer, or Stripe price.** All of those values are
      resolved server-side from `BillingPrice` and
      `BillingCustomer`. The DTOs expose only `priceId` (the
      local UUID), `quantity`, optional `clientReferenceId`,
      and optional `trialDays` / `allowPromotionCodes`. The
      controller routes these into the service, which calls
      `catalog.findPriceById` and `customerService.getOrCreateForUser`.

## Security notes

- `payment_method_types` is never set. The plan (line 21) and
  the `stripe-best-practices` skill (under "Dynamic payment
  methods") both call this out as a hard rule.
- Stripe API version is pinned at the SDK factory
  (`stripe.config.ts`); the service never re-derives it.
- Stripe keys and webhook secrets are redacted from logs and
  errors by `BillingStripeService.safeCall`; checkout uses
  `safeCall` for every Stripe call.
- Stripe price id, currency, amount, and customer id are
  resolved server-side. The client only ever sees the local
  `priceId` UUID and the final `url` / `sessionId`.
- `success_url` is appended with the `CHECKOUT_SESSION_ID`
  Stripe placeholder; if the operator's URL already includes
  the placeholder, the service leaves it alone.

## Subscription shell and Phase 5

The `BillingSubscription` entity has a unique index on
`stripeSubscriptionId`. Since the real subscription id is only
known after the user completes the Checkout Session in the
browser, Phase 4 pre-creates the row with a placeholder id
of the form `pending_sub:<localPaymentId>`. The Phase 5
webhook handler will use `BillingCheckoutService.isPlaceholderSubscriptionId`
and `buildSubscriptionPlaceholderId` to detect the placeholder
and replace it with the real `sub_…` id from
`customer.subscription.created`. This keeps the schema
contract honest while letting us ship the checkout route in
Phase 4.

The local shell otherwise has the same `stripeCheckoutSessionId`
column as `BillingPayment`, so the webhook handler has two
stable lookups per checkout:

- by `stripeCheckoutSessionId` on both rows
- by `metadata.localSubscriptionId` on the Stripe session /
  subscription object

## Tests

New unit-test coverage:

- `billing-idempotency.service.spec.ts` — 13 tests covering
  key normalization, request hashing, fresh reservation,
  cached response, failed-then-retried, in-flight conflict,
  body-mismatch conflict, expired-key retake, create-race
  recovery, and the three `record*` / `release` paths.
- `billing-checkout.service.spec.ts` — 14 tests covering
  one-time (happy path, inactive price, wrong type, cached
  replay, idempotency error propagation) and subscription
  (happy path, archived plan, wrong type, active-subscription
  guard, Stripe-call-failure cleanup of the local shell, the
  placeholder-id helpers).
- `billing-portal.service.spec.ts` — 5 tests covering the
  happy path with idempotency, the cached-replay path,
  `BillingCustomerNotFoundError`, the missing-config error,
  and the propagation of both idempotency error types.
- `billing.controller.spec.ts` — extended with 4 new tests
  for the one-time and subscription routes, plus an
  idempotency-key pass-through for the portal route.

Test totals: 155 / 155 passing (was 121 before Phase 4 — +34
tests).

## Build / lint

- `pnpm run build` — passes.
- `pnpm test` — 155/155 passing.
- `pnpm run lint` — no new errors in billing code. The two
  new spec files use a top-of-file `/* eslint-disable
  @typescript-eslint/unbound-method, ... */` to match the
  existing convention from `billing-customer.service.spec.ts`.
  The remaining 53 lint errors are the same baseline noise
  noted in `PHASE-0-SCOPE-LOCK.md`.

## Out of scope for Phase 4 (deferred to later phases)

- Webhook handlers — Phase 5 wires `BillingWebhookService` to
  consume the `checkout.session.completed`,
  `customer.subscription.created`, `payment_intent.*`,
  `charge.refunded`, and `invoice.*` events and to:
    - update `BillingSubscription.status` / period / etc. from
      `customer.subscription.created/updated/deleted`.
    - create the real `BillingSubscription` row from the
      `pending_sub:` placeholder.
    - update `BillingPayment` and create `BillingTransaction`
      rows from the payment / charge events.
- Entitlements — Phase 6 introduces
  `BillingEntitlementsService` and a `@RequiresFeature()`
  decorator; subscriptions created by Phase 4 will already have
  the local state it needs.
- Admin / refund support — Phase 7.

## Next phase

Phase 5 — Verified Webhooks and Local State Sync
(plan line 1064):

- `src/billing/controllers/stripe-webhook.controller.ts`
  (or a route on `BillingController`).
- `src/billing/services/billing-webhook.service.ts` with
  handlers for the MVP event set.
- `BillingWebhookEvent` persistence driven by
  `BillingStripeService.constructWebhookEvent`.
- Local `BillingSubscription`, `BillingPayment`,
  `BillingInvoice`, and `BillingTransaction` updates from
  the Stripe events.
- Raw body handling for `/api/billing/webhooks/stripe` in
  `main.ts`.
