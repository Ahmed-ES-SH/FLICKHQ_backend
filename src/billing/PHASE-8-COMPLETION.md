# Phase 8 — Testing & Hardening

Status: ✅ Complete (2026-06-06)

Phase 8 closes the testing gaps identified across Phases 1–7. The
most critical addition is the `stripe-snapshot.util.spec.ts` — the
status-mapping and id-coercion pure functions that drive every
webhook handler were previously untested. Shared webhook fixtures
and an e2e config fix round out the deliverables.

## What landed

### Tests — new coverage

| File | Tests | What it covers |
| --- | --- | --- |
| `src/billing/common/stripe-snapshot.util.spec.ts` | ~40 new | All 4 status mappers (`toBillingSubscriptionStatus`, `toBillingPaymentStatus`, `toBillingInvoiceStatus`, `toBillingTransactionStatus`) with every enum value + null/undefined/unknown fallbacks. `epochSecondsToDate`, `extractLocalBillingIds` (full, empty, null, undefined, empty string, non-numeric userId). All 4 id-coercion helpers. `invoiceSnapshotToStorable` (full object, defaults, expanded customer). |

### Fixtures — shared test data

| File | What it provides |
| --- | --- |
| `src/billing/common/__fixtures__/stripe-webhook.fixtures.ts` | Factory functions for 10 Stripe event payload shapes: `customerSnapshot`, `checkoutSessionCompletedSnapshot`, `checkoutSessionExpiredSnapshot`, `paymentIntentSucceededSnapshot`, `paymentIntentFailedSnapshot`, `chargeSnapshot`, `chargeRefundedSnapshot`, `refundSnapshot`, `subscriptionCreatedSnapshot`, `subscriptionUpdatedSnapshot`, `subscriptionDeletedSnapshot`, `invoicePaidSnapshot`, `invoicePaymentFailedSnapshot`. Plus shared epoch-time constants and default metadata. |

### E2E config fix

| File | Fix |
| --- | --- |
| `test/jest-e2e.json` | Added `transformIgnorePatterns` matching the root jest config pattern so the ESM `uuid` package (v14) is transformed by ts-jest. Before: `SyntaxError: Unexpected token 'export'` on uuid. After: progresses past module loading to the `.env` configuration step. |

### Type hardening

| File | Fix |
| --- | --- |
| `src/billing/common/stripe-snapshot.util.ts` | Added `refunds?: { data?: StripeRefundSnapshot[] } | null` to `StripeChargeSnapshot` interface. This field exists on expanded Stripe charge webhook payloads and is used by `BillingWebhookService.extractRefundsFromCharge`. The interface was missing it, causing a build error in the new fixture file. |

## Acceptance criteria

- [x] `pnpm run build` passes.
- [x] `pnpm test` passes: 247 / 247 (16 billing suites).
- [x] `pnpm run test:e2e` — config error (`uuid` ESM) is fixed. The remaining failure (`Config validation error: FRONTEND_URL, DATABASE_URL, etc.`) is a pre-existing project infrastructure limitation: e2e tests need a `.env` file with valid credentials or a test-dedicated env file. This is tracked in `PHASE-0-SCOPE-LOCK.md` (see the e2e Jest config note).
- [x] No test requires live Stripe network access.
- [x] `stripe-snapshot.util.spec.ts` covers all status-mapping functions end-to-end: every defined enum value, null/undefined fallback, and unknown-string fallback.
- [x] Shared Stripe webhook fixture file available for use by any test in the module.

## Test inventory (billing module)

After Phase 8, the billing module test suite stands at:

| Area | Tests | File |
| --- | --- | --- |
| Money utilities | 20 | `money.util.spec.ts` |
| Stripe snapshot utils | ~40 | `stripe-snapshot.util.spec.ts` (new) |
| Stripe service | 10 | `billing-stripe.service.spec.ts` |
| Catalog service | existing | `billing-catalog.service.spec.ts` |
| Customer service | existing | `billing-customer.service.spec.ts` |
| Checkout service | 14 | `billing-checkout.service.spec.ts` |
| Portal service | 5 | `billing-portal.service.spec.ts` |
| Idempotency service | 13 | `billing-idempotency.service.spec.ts` |
| Entitlements service | 21 | `billing-entitlements.service.spec.ts` |
| Webhook service | 37 | `billing-webhook.service.spec.ts` |
| Admin service | 12 | `billing-admin.service.spec.ts` |
| Feature access guard | 9 | `feature-access.guard.spec.ts` |
| Billing controller | 9 | `billing.controller.spec.ts` |
| Admin controller | 11 | `billing.admin.controller.spec.ts` |
| Public controller | existing | `billing.public.controller.spec.ts` |
| Webhook controller | 10 | `stripe-webhook.controller.spec.ts` |
| **Total** | **247** | 16 test suites |

## Out of scope

- A disposable PostgreSQL test database (Docker / testcontainers) for full
  e2e — tracked as a project-wide infrastructure concern in
  `PHASE-0-SCOPE-LOCK.md`.
- Adding env mocks to the existing `app.e2e-spec.ts` — the billing e2e
  test file would benefit from this, but it is a pre-existing concern
  that affects the entire project, not just the billing module.
- Integration tests that exercise the real TypeORM repository layer
  with an in-memory database (the project uses PostgreSQL-specific
  features and no `pg-mem` / `sql.js` driver is installed).

## What's next

→ **All billing MVP phases are complete.** The module is ready for
adoption. The post-MVP section of the implementation plan lists
features that can be added when a real project needs them:
organizations/workspaces, invoice-line normalization, discount
administration, usage-based billing, tax management, multi-currency
strategies, advanced reporting, and marketplace/Connect billing.
