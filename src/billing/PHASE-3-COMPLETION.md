# Billing Module — Phase 3 Completion (Customer, Catalog, Portal)

This file records the Phase 3 deliverables against the plan
(`src/billing-module-implementation-plan.md`, lines 1020–1039).

## What landed

### Services

- `src/billing/services/billing-customer.service.ts`
  - `findByUserId(userId)` — read-only lookup.
  - `getOrCreateForUser(userId)` — get-or-create. On first call it
    backfills from `users.stripe_customer_id` when present, and
    otherwise creates a Stripe customer and mirrors the id onto
    the user row. Emits `billing.customer.created`.
  - `syncForUser(userId)` — admin/support re-link helper.
  - `applyCustomerUpdate(stripeCustomer)` — webhook-driven sync
    helper for Phase 5.
  - Unique-violation race handled by re-reading the winning row.

- `src/billing/services/billing-catalog.service.ts`
  - Admin: `createPlan`, `updatePlan`, `archivePlan`, `addPrice`.
  - Reads: `getPlanWithPrices`, `findPriceByStripeId`,
    `listAllPlans`, `listPublicPlans`.
  - Validates the recurring/one-time interval/trial combinations
    in `assertPriceInputShape`.
  - Translates Postgres unique-violation errors on `code` and
    `stripe_price_id` into `ConflictException`s.
  - `listPublicPlans` filters at the DB level *and* re-checks
    `price.active` in memory before exposing data.

- `src/billing/services/billing-portal.service.ts`
  - `createSessionForUser(userId)` — returns `{ url }` from
    `stripe.billingPortal.sessions.create`. Requires
    `STRIPE_PORTAL_RETURN_URL` (falls back to
    `STRIPE_SUCCESS_URL`).

### Controllers

- `src/billing/controllers/billing.controller.ts` — authenticated.
  - `GET  /api/billing/customer`        (lifecycle: get-or-create)
  - `POST /api/billing/customer/sync`
  - `POST /api/billing/portal/session`

- `src/billing/controllers/billing.admin.controller.ts` — admin.
  - `POST  /api/billing/admin/plans`
  - `GET   /api/billing/admin/plans`
  - `PATCH /api/billing/admin/plans/:id`
  - `POST  /api/billing/admin/plans/:id/archive`
  - `POST  /api/billing/admin/plans/:id/prices`

- `src/billing/controllers/billing.public.controller.ts` — public.
  - `GET /api/billing/plans/public` — active plans + active prices
    (optional `?currency=usd` filter)

### DTOs

- `src/billing/dto/billing-customer.dto.ts` — `BillingCustomerResponseDto`.
- `src/billing/dto/billing-plan.dto.ts` — create / update / add-price
  DTOs, response DTOs, public DTO, list query DTOs.
- `src/billing/dto/billing-portal.dto.ts` — `BillingPortalSessionResponseDto`.
- `src/billing/dto/index.ts` — barrel export.

### Module wiring

- `src/billing/billing.module.ts` now:
  - imports `UserModule` (for the `User` repository used by
    `BillingCustomerService.getOrCreateForUser`),
  - registers the three new services,
  - registers the three controllers,
  - exports `BillingCustomerService`, `BillingCatalogService`,
    `BillingPortalService` so other application modules can
    depend on them in later phases (e.g. checkout, entitlements).

## Acceptance criteria checklist (plan line 1035)

- [x] Existing users can create billing customers without
      duplicates — handled by the unique-violation race recovery
      in `BillingCustomerService.createLocalRow`.
- [x] Public plans expose only active safe pricing data —
      `BillingCatalogService.listPublicPlans` filters by
      `status=active` and `price.active=true` (twice: at the DB
      level and in memory), and skips plans with no prices.
- [x] Portal route returns a Stripe URL from a mocked Stripe
      service — `BillingPortalService` is unit-tested with a
      mocked Stripe client and a stubbed `ConfigService`.

## Tests

New unit-test coverage:

- `billing-customer.service.spec.ts` — 12 tests covering
  find-by-user, get-or-create (existing / backfill / fresh /
  missing user / unique-violation race), sync, apply-update,
  currency normalization.
- `billing-catalog.service.spec.ts` — 14 tests covering plan
  CRUD, archive, price input shape validation, conflict
  translation, and the public / private / currency-filtered
  listings.
- `billing-portal.service.spec.ts` — 3 tests covering the
  happy path, the missing-customer error, and the
  missing-config error.
- `billing.controller.spec.ts` — 3 tests covering the user
  controller's three endpoints.
- `billing.public.controller.spec.ts` — 1 test covering query
  pass-through.
- `billing.admin.controller.spec.ts` — 5 tests covering the
  five admin endpoints. The two guards are stubbed via
  `jest.mock` at the top of the file so the test doesn't
  transitively load the `UserService` (which uses a path
  alias the unit-test Jest config does not resolve).

Test totals: 121 / 121 passing (was 79 before Phase 3 — +42 tests).

## Build / lint

- `pnpm run build` — passes.
- `pnpm test` — 121/121 passing.
- `pnpm run lint` — no new errors in billing code. The remaining
  54 errors are all in pre-existing untouched files (env.validation,
  contact/, notifications.client.controller.ts, main.ts) — the same
  baseline noise noted in `PHASE-0-SCOPE-LOCK.md`.

## Out of scope for Phase 3 (deferred to later phases)

- Idempotency keys on the portal session endpoint — Phase 4
  wires the `BillingIdempotencyKey` table into checkout and
  can do the same for portal at the same time.
- Returning `users.is_premium` as a derived entitlement —
  Phase 6 introduces `BillingEntitlementsService` and replaces
  the direct field read.
- Webhook-driven customer updates — Phase 5 wires
  `applyCustomerUpdate` into the `customer.created` /
  `customer.updated` handlers.

## Next phase

Phase 4 — Checkout for Subscriptions and One-Time Payments
(plan line 1041):

- `BillingCheckoutService` (subscription + one-time)
- `BillingCheckoutController` endpoints
- `POST /api/billing/checkout/subscription`
- `POST /api/billing/checkout/one-time`
- Idempotency enforcement via `BillingIdempotencyKey`
- Server-side price resolution through `BillingCatalogService`
