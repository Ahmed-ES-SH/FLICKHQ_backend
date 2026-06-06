# Billing Module — Phase 0 Scope Lock

This file records the compile-baseline and scope-lock decisions that must hold
before any billing-module code is added (Phases 1–8 of
`src/billing-module-implementation-plan.md`).

## Decision 1 — Missing source modules are removed, not restored

The source tree had references to modules that did not exist on disk:

- `src/payments/`
- `src/products/`
- `src/cart/`
- `src/orders/`

Per the plan's "Recommended decision" (line 49 of
`billing-module-implementation-plan.md`), the v1 billing module will live under
`src/billing/`. The legacy modules are **not** restored. The following wiring
was removed:

- `src/app.module.ts` — `PaymentsModule`, `ProductsModule`, `CartModule`,
  `OrderModule` imports dropped.
- `src/config/database.config.ts` — `Payment`, `Order`, `OrderItem`, `Refund`,
  `Cart`, `CartItem`, `WebhookEvent`, `OutboxEvent`, `CheckoutSessionState`
  entity imports dropped. `Product` removed.
- `src/categories/categories.module.ts` — `Product` removed from
  `TypeOrmModule.forFeature`.
- `src/categories/categories.service.ts` — `Product` repository and product
  counts removed from `delete()` and `getByIdWithCounts()`.
- `src/categories/categories.service.spec.ts` — `Product` test scaffolding
  removed.
- `src/categories/schema/category.schema.ts` — `@OneToMany(() => Product, …)`
  removed.
- `src/database/seeds/seed-runner.ts` — products table drop and recreate, and
  the `seedProducts` call, were removed.
- `src/database/seeds/seed-products.ts` — deleted.
- `src/database/seeds/verify.ts` — products verification removed.
- `src/database/seeds/factories/product.factory.ts` — deleted.
- `test/cart.e2e-spec.ts` and `test/payments.e2e-spec.ts` — deleted; the new
  billing e2e tests are introduced in Phase 8.
- `src/main.ts` — `/api/payments/webhook` raw-body middleware removed (the
  BillingModule will register a raw-body middleware for
  `/api/billing/webhooks/stripe` in Phase 1). Unused `import * as express`
  dropped. `payments` Swagger tag dropped.

## Decision 2 — No `/payments/*` compatibility routes (Option A)

Per the plan's "Backward Compatibility Options" (line 1214), the project
adopts **Option A** for v1: new billing routes only at `/api/billing/*`. No
compatibility wrappers are added for `/payments/*` because no production
client is expected to depend on them; the project is a boilerplate and the
old code is already missing from `src/`.

## Decision 3 — Historical tables are not migrated in Phase 0

Per the plan's "Migration Plan" (line 909), existing migrations may have
created historical `payments`, `refunds`, `webhook_events`, `outbox_events`,
`checkout_session_states`, `orders`, and `order_items` tables in target
environments. Those tables are **not** migrated into the new billing schema in
Phase 0. The Phase 2 migration is the only source of truth for v1 billing
data. The Migration 2 compatibility work (line 935) will be considered
later, only if production data exists that must be preserved.

## Decision 4 — v1 billing is user-owned

Per the plan's "BillingAccount vs BillingCustomer vs User" decision (line
86), v1 links `BillingCustomer` directly to `User` (one-to-one,
`billing_customers.user_id UNIQUE`). There is **no** `BillingAccount` table
in the MVP. This is the explicit, deliberate simplification; a later
migration may introduce `BillingAccount` when an organization/workspace
billing requirement actually arises.

## Decision 5 — Stripe Dashboard is the source for advanced finance data

Per the plan's "Reporting" decision (line 154) and "Local State vs Stripe
State" (line 237), the v1 module does not provide:

- revenue / MRR / ARR analytics
- local discount administration
- local tax management
- local invoice-line inspection
- finance-grade refund lifecycle

Stripe Dashboard remains the source of truth for those concerns. The local
module stores only operational snapshots (statuses, amounts, periods, hosted
links) and webhook idempotency state.

## Out-of-scope tables (post-MVP)

The following tables are explicitly **not** created in Phase 2:

- `billing_accounts`
- `billing_invoice_lines`
- `billing_discounts`
- `billing_refunds`
- broad `billing_audit_events`

## Baseline status after Phase 0

- `pnpm run build` — passes.
- `pnpm test` — passes (21/21 unit tests).
- `pnpm test:e2e` — pre-existing failure unrelated to Phase 0: Jest cannot
  resolve the `src/helpers/paginate.helper` import because `test/jest-e2e.json`
  does not define `moduleNameMapper` for the `src/` alias. The unit-test
  runner does not have this issue. Resolving this e2e Jest config is tracked
  separately and is **not** a Phase 0 deliverable.
- `pnpm run lint` — pre-existing errors in untouched files
  (`common/filters`, `common/interceptors`, `contact/*`,
  `notifications/notifications.client.controller.ts`). These are baseline
  noise, not introduced by Phase 0. They are not in scope for billing work
  but should be cleaned up in a follow-up pass.

## Acceptance criteria checklist (from plan, line 968)

- [x] Project compiles before billing work — `pnpm run build` passes.
- [x] Missing module imports resolved — `app.module.ts` and
      `database.config.ts` no longer import any of `payments`, `products`,
      `cart`, or `orders`.
- [x] Decision made for `/payments/*` compatibility — Option A (no
      compatibility routes).
- [x] Lean MVP scope accepted — see Decisions 4 and 5 above.
- [x] No `BillingAccount`, `BillingDiscount`, `BillingInvoiceLine`, or
      `BillingRefund` table is planned for MVP.

## Next phase

Phase 1 — Billing Skeleton, Config, and Stripe Client (plan line 974):

- `src/billing/billing.module.ts`
- Lean folder structure under `src/billing/`
- Stripe client provider with explicit API version `2026-05-27.dahlia` and
  restricted-key preference
- Billing env validation additions
- `money.util.ts` for minor-unit validation
- All Stripe API calls isolated behind `BillingStripeService`
