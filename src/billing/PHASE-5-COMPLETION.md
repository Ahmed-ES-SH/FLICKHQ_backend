# Phase 5 — Verified Webhooks + Local State Sync

Status: ✅ Complete (2026-06-06)

Phase 5 turns Stripe webhooks into the authoritative source of truth for local billing state. The webhook controller verifies signatures, persists the event row, and dispatches to 16 typed handlers that keep `BillingPayment`, `BillingSubscription`, `BillingInvoice`, `BillingTransaction`, and `BillingCustomer` in sync with Stripe. Duplicate deliveries are absorbed by a unique constraint on `stripe_event_id`; transient errors surface as 5xx so Stripe retries.

## Deliverables

### Source
| File | Purpose |
| --- | --- |
| `src/billing/common/billing.errors.ts` | Adds `BillingWebhookHandlerError` (handler-thrown, non-retryable, surfaced as 500 in case of a future phase-7 replay tool that wants to surface it). Signature-verification and already-processed errors already existed. |
| `src/billing/common/stripe-snapshot.util.ts` | Structural TypeScript types (`StripeCheckoutSessionSnapshot`, `StripePaymentIntentSnapshot`, `StripeChargeSnapshot`, `StripeSubscriptionSnapshot`, `StripeCustomerSnapshot`, `StripeInvoiceSnapshot`) plus mappers (`checkoutSessionToPayment`, `paymentIntentSnapshotToPayment`, `chargeSnapshotToPayment`, `chargeSnapshotToRefundTransaction`, `subscriptionSnapshotToSubscription`, `customerSnapshotToCustomer`, `invoiceSnapshotToStorable`) and `extractLocalBillingIds(metadata)`. Decouples handlers from the live `Stripe.*` types. |
| `src/billing/services/billing-webhook.service.ts` | `receiveEvent(rawBody, signature)`, 16 private handlers, idempotency via unique `stripe_event_id`, unique-violation race → `kind: 'duplicate'`. |
| `src/billing/controllers/stripe-webhook.controller.ts` | `POST /api/billing/webhooks/stripe` — `@Public()` + `@SkipThrottle()`, reads `req.rawBody` and the `Stripe-Signature` header, returns 200 on processed/duplicate/ignored, 400 on bad signature, 5xx on transient handler error. |
| `src/billing/billing.module.ts` | Registers `BillingWebhookService` and `StripeWebhookController`; exports the service for Phase 7 admin replay. Phase status docblock updated to `✅ Phase 5`. |
| `src/billing/dto/billing-webhook.dto.ts` | `BillingWebhookAckResponseDto` + `BillingAdminWebhookReplayRequestDto` / `BillingAdminWebhookReplayResponseDto` (pre-wired for Phase 7). |
| `src/billing/dto/index.ts` | Barrel updated to export the new DTOs. |
| `src/main.ts` | Confirmed `rawBody: true` on `NestFactory.create`; docblock comment notes the raw-body contract for the Stripe webhook route. |

### Tests
| File | Cases |
| --- | --- |
| `src/billing/services/billing-webhook.service.spec.ts` | 25 — signature failure, duplicate event id, every MVP handler happy path, placeholder subscription id replacement (real `sub_…` and `pending_sub:<localPaymentId>` paths), refund-as-`BillingTransaction` aggregation, partial vs full refund status mapping, invoice summary-only persistence (no lines), unknown Stripe status string fallback, orphan invoice → `ignored`, unhandled event type → `kind: 'ignored'`. |
| `src/billing/controllers/stripe-webhook.controller.spec.ts` | 10 — 200 on success, 400 on invalid signature, 200 on duplicate (no double writes), 200 on unhandled event type, 5xx when service throws transient, `BillingWebhookHandlerError` mapping, missing signature header, body consumed as raw `Buffer`, no throttling applied, `@Public()` set. |

Total unit tests: **190 / 190 passing** (was 155 before Phase 5; +35 new).

### Deferred (follow-up)
- `test/billing-webhook.e2e-spec.ts` (supertest + real Stripe HMAC signatures) was attempted but the project is PostgreSQL-only and there is no `pg-mem` or `sqlite` driver installed. A full e2e needs a disposable Postgres test database (Docker or testcontainers) — tracked in `src/billing/PHASE-0-SCOPE-LOCK.md` and the existing `test/jest-e2e.json` alias gap. The signature/HMAC verification itself is exercised by the unit tests with a mocked `BillingStripeService.constructWebhookEvent`, and the controller's `rawBody` plumbing is covered by the controller unit tests asserting that the buffer is forwarded verbatim.

## Acceptance Criteria

- [x] Webhooks are verified with `STRIPE_WEBHOOK_SECRET`; invalid signature → 400 (no retry).
- [x] Verified event is persisted to `billing_webhook_events` with `stripe_event_id` unique.
- [x] Duplicate delivery (same `stripe_event_id`) → 200 `kind: 'duplicate'`, no second handler run.
- [x] Unhandled event type → 200 `kind: 'ignored'`, no row written to a domain table.
- [x] Transient handler error → 5xx so Stripe retries.
- [x] `checkout.session.completed` reconciles the `BillingPayment` row keyed by `localPaymentId` in metadata; unlinks the local cache from the `cs_test_…` id.
- [x] `payment_intent.succeeded` updates payment intent id, status, latest charge id, and emits a `BillingTransaction(type=charge)` if missing.
- [x] `payment_intent.payment_failed` marks the payment `failed` with the failure code and message.
- [x] `charge.succeeded` updates the charge id, status, receipt url, and balance transaction id.
- [x] `charge.refunded` aggregates the refund total via `createQueryBuilder` `SUM` and sets the payment to `refunded` or `partially_refunded`; writes a `BillingTransaction(type=refund)`. No `BillingRefund` table.
- [x] `customer.created/updated` upserts a `BillingCustomer` via `BillingCustomerService.applyCustomerUpdate`.
- [x] `customer.subscription.created/updated` upsert matches (in order): real `sub_…` id → `subscription.metadata.localSubscriptionId` → placeholder `pending_sub:<localPaymentId>`; placeholder is replaced with the real id on the linked `BillingPayment`.
- [x] `customer.subscription.deleted` marks the subscription `canceled` and the linked payment subscription id cleared (kept as a historical record).
- [x] `invoice.{created,finalized,paid,voided,marked_uncollectible,payment_failed}` upserts a `BillingInvoice` summary (no lines, no `BillingInvoiceLine`). Orphans (no local customer match) are `ignored`.
- [x] `checkout.session.expired` is a no-op persistence-wise (logged + ack), matching MVP scope.
- [x] Secret values (`client_secret`, `customer.id` of any non-local PII) are scrubbed via `BillingStripeService.redactSecrets` before persistence.
- [x] Webhook controller is `@Public()` + `@SkipThrottle()` (Stripe must always reach us; throttler is per-IP and would cause false-positive 429s).
- [x] All 16 MVP event types handled; the Stripe event types list lives in `STRIPE_WEBHOOK_EVENT_TYPES` (`src/billing/common/billing.constants.ts`).
- [x] `pnpm run build` passes.
- [x] `pnpm test` passes: 190 / 190.
- [x] `pnpm run lint` passes.

## Notes & Gotchas

- The webhook route is public, but the auth guard still runs by default; the `@Public()` decorator is required (already wired in `src/auth/decorators/public.decorator.ts` and respected by `src/auth/guards/auth.guard.ts`).
- `BILLING_ENABLED=false` does **not** gate the webhook route — we must always accept events so the local DB converges with Stripe when billing is later turned back on.
- A unique-violation race on `stripe_event_id` (two Stripe deliveries in flight) is caught and the second one becomes `kind: 'duplicate'`. No second handler invocation.
- `persistEventRow` returns `null` on unique-violation; `receiveEvent` converts that to `kind: 'duplicate'` and short-circuits the dispatch.
- `extractLocalBillingIds` accepts a partial metadata record so the same util works for checkout sessions, payment intents, subscriptions, and invoices.
- Refund aggregation: when Stripe sends `charge.refunded` with multiple partial refunds, we sum the per-payment refund transactions and compare to the payment amount to set `refunded` vs `partially_refunded`.

## Next Phase

→ **Phase 6 — Entitlements** (`src/billing-module-implementation-plan.md`, search for the next "Phase" heading after the Phase 5 marker). The plan introduces a `BillingEntitlement` model and the `BillingEntitlementService` that maps active subscriptions + paid invoices to feature flags consumed by the rest of the app.
