# Phase 6 — Entitlements & Feature Access

Status: ✅ Complete (2026-06-06)

Phase 6 turns the local billing state into a queryable entitlement
map. Application modules can now ask "can this user use feature X?"
through `BillingEntitlementsService` (or the `FeatureAccessGuard` +
`@RequiresFeature` decorator) without referencing Stripe or
subscription rows. The webhook pipeline keeps the entitlement rows
in sync by calling `recomputeForUser` after every state-changing
event, so cancel/expire/fail paths naturally drop access.

## What landed

### Service
| File | Purpose |
| --- | --- |
| `src/billing/services/billing-entitlements.service.ts` | The single service for entitlement lookup, recompute, and access checks. Source rows: `BillingSubscription` with granting status + `BillingPayment` with `succeeded` status. Source-of-truth: the `active` boolean. Manual grants (`sourceType='manual'`) are preserved verbatim. `users.is_premium` is never written. |
| `src/billing/services/billing-entitlements.service.spec.ts` | 21 cases — granting-status set, `canAccess`, `getUserEntitlements`, full `recomputeForUser` matrix (active / trialing / past_due / paused / canceled / orphan / one-time / idempotent / deactivation / manual preservation). |

### Guard & decorator
| File | Purpose |
| --- | --- |
| `src/billing/guards/feature-access.guard.ts` | Nest guard. Reads `@RequiresFeature` metadata via `Reflector.getAllAndOverride`. Calls `entitlementsService.canAccess(userId, key)` for each required key. Throws `ForbiddenException` listing the missing keys. Throws `UnauthorizedException` if `request.user.id` is missing (the global `AuthGuard` should populate it). |
| `src/billing/guards/feature-access.guard.spec.ts` | 9 cases — no-metadata passthrough, authentication checks, multi-key enforcement, empty-key short-circuit, missing-key error message format, handler-vs-class metadata. |
| `src/billing/decorators/requires-feature.decorator.ts` | `SetMetadata` wrapper. Variadic: `@RequiresFeature('a', 'b')`. Metadata key exported as `REQUIRES_FEATURE_METADATA`. |

### HTTP surface
| File | Purpose |
| --- | --- |
| `src/billing/dto/billing-entitlement.dto.ts` | `BillingEntitlementResponseDto` — slimmed view of a `BillingEntitlement` (no internal `userId` or `metadata`). |
| `src/billing/dto/index.ts` | Re-exports the new DTO. |
| `src/billing/controllers/billing.controller.ts` | `GET /api/billing/entitlements` — returns active entitlements for the current user, mapped to the response DTO. |

### Wiring
| File | Purpose |
| --- | --- |
| `src/billing/common/billing.constants.ts` | `ENTITLEMENT_GRANTING_STATUSES = ['active', 'trialing', 'past_due']` and `REQUIRES_FEATURE_METADATA` key. |
| `src/billing/billing.module.ts` | Registers `BillingEntitlementsService` + `FeatureAccessGuard` as providers; exports both for app-wide use. Docblock bumped to `✅ Phase 6`. |
| `src/billing/services/billing-webhook.service.ts` | Injects `BillingEntitlementsService`. Calls `recomputeForUser(userId)` at the end of `handlePaymentIntentSucceeded`, `handleSubscriptionCreated`, `handleSubscriptionUpdated`, `handleSubscriptionDeleted`, and `handleInvoicePaymentFailed`. The recompute is best-effort — a thrown error is logged and swallowed so the local billing row stays written. The next webhook for the same user heals the entitlement state. |

### Tests
| File | Cases |
| --- | --- |
| `src/billing/services/billing-entitlements.service.spec.ts` | 21 (new). |
| `src/billing/guards/feature-access.guard.spec.ts` | 9 (new). |
| `src/billing/services/billing-webhook.service.spec.ts` | 25 (existing, preserved) + 9 (new) = 34. New cases cover recompute calls for the five source-of-truth handlers and the absence of recompute for `charge.refunded`, `invoice.paid`, and `checkout.session.completed`; one case covers a recompute failure being swallowed while the webhook still reports processed. |
| `src/billing/controllers/billing.controller.spec.ts` | 7 (existing) + 2 (new) = 9. New cases cover `listEntitlements` happy path + empty result. |

Total unit tests: **231 / 231 passing** (was 190 before Phase 6; +41 new).

## Policy decisions

- **Entitlement-granting subscription statuses**: `active`, `trialing`,
  `past_due`. Excluded: `incomplete`, `incomplete_expired`,
  `canceled`, `unpaid`, `paused`. Locked in via
  `ENTITLEMENT_GRANTING_STATUSES` and the static
  `BillingEntitlementsService.grantingStatuses` array (used by the
  spec).
- **`users.is_premium`**: untouched. The service never writes to
  it. The pre-existing column is left as a compatibility field
  with no reads; a future cleanup migration will drop it.
- **Manual grants**: `BillingEntitlementSourceType.MANUAL` rows are
  preserved across recomputes. The v1 module does not expose any
  API to create them — the enum slot is reserved for a future
  admin tool.

## Webhook integration

| Stripe event | Recompute? | Why |
| --- | --- | --- |
| `checkout.session.completed` | No | `payment_intent.succeeded` is the source of truth for one-time payments; double-firing would race the same entitlement row. |
| `checkout.session.expired` | No | The payment is canceled; no entitlement change. |
| `payment_intent.succeeded` | **Yes** | A succeeded one-time payment should grant the plan's features. |
| `payment_intent.payment_failed` | No | The payment never succeeded. If a previous run granted entitlements, the next `payment_intent.succeeded` heals. |
| `charge.succeeded` | No | Same as `payment_intent.succeeded` (covered by the more specific event). |
| `charge.refunded` | No | Refunds don't change feature access in v1 (a future phase may add a "refund flips off" policy). |
| `customer.*` | No | Customer metadata only; no subscription/payment state change. |
| `customer.subscription.created` | **Yes** | The subscription is now active — grant its plan features. |
| `customer.subscription.updated` | **Yes** | Status transitions (e.g. `trialing → active`, `past_due → canceled`, `paused ↔ active`) need a recompute. |
| `customer.subscription.deleted` | **Yes** | Canceled subscription — deactivate its entitlements. This is the primary deactivation trigger. |
| `invoice.created` | No | Informational. |
| `invoice.finalized` | No | Informational. |
| `invoice.paid` | No | The underlying `payment_intent.succeeded` already covered this. |
| `invoice.payment_failed` | **Yes** | A failed invoice can flip a subscription to `past_due` (still granting) or further to `unpaid` (no longer granting). The recompute converges both. |
| `invoice.voided` | No | Voided invoices don't change subscription state. |
| `invoice.marked_uncollectible` | No | Stripe keeps the subscription alive; an admin-level decision would land here. |

## Usage example

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { FeatureAccessGuard } from '@/billing/guards/feature-access.guard';
import { RequiresFeature } from '@/billing/decorators/requires-feature.decorator';
import { BillingEntitlementsService } from '@/billing/services/billing-entitlements.service';

@Controller('reports')
@UseGuards(FeatureAccessGuard)
export class ReportsController {
  constructor(private readonly entitlements: BillingEntitlementsService) {}

  @Get('premium')
  @RequiresFeature('premium_reports')
  list() {
    // The guard has already verified the user has the
    // `premium_reports` feature. The service is still available
    // for ad-hoc checks inside the handler if needed.
    return this.entitlements.canAccess(42, 'premium_reports');
  }
}
```

## Acceptance criteria

- [x] `BillingEntitlementsService` recomputes a user's entitlements
      from `active` / `trialing` / `past_due` subscriptions and
      `succeeded` one-time payments.
- [x] Application code can call `canAccess(userId, key)` or
      `getUserEntitlements(userId)` without referencing Stripe.
- [x] `@RequiresFeature('key')` +
      `@UseGuards(FeatureAccessGuard)` blocks a request with
      `403` when the user lacks the feature.
- [x] Canceling a subscription (`customer.subscription.deleted`)
      deactivates the subscription-derived entitlements on the
      next recompute.
- [x] `paused`, `canceled`, `unpaid`, `incomplete`,
      `incomplete_expired` subscriptions do **not** grant
      entitlements.
- [x] `users.is_premium` is never written by the service.
- [x] `GET /api/billing/entitlements` returns the active
      entitlements for the current user.
- [x] All 190 existing tests still pass; 41 new tests added
      (231 / 231).
- [x] No new migration. No new dependencies.
- [x] `pnpm run build` passes.
- [x] `pnpm test` passes: 231 / 231.
- [x] `pnpm run lint` passes.
- [x] `src/billing/PHASE-6-COMPLETION.md` (this file) records the
      deliverables, file list, and test counts.
- [x] `billing.module.ts` docblock reflects `✅ Phase 6`.

## Out of scope (post-MVP)

- Manual entitlement grants (`sourceType = 'manual'` admin UI). The
  enum slot is reserved; recompute never writes to it but
  preserves existing rows.
- A scheduled reconciliation job for the (rare) case where a
  webhook is permanently lost.
- A partial unique index on
  `(user_id, feature_key, source_type, source_id) WHERE active`.
  The service enforces the invariant in application logic.
- Per-feature expiry windows. The `endsAt` column is stored for
  support visibility; `canAccess` does not consult it in v1.
- Sample guarded routes in the billing module itself — the guard
  and decorator are exported for any app module to use.
- Refund-driven entitlement revocation. A future phase may flip
  a feature off when its sole one-time payment is fully refunded.

## Next Phase

→ **Phase 7 — Minimal Admin & Refund Support**
(`src/billing-module-implementation-plan.md`, search for the next
"Phase" heading after the Phase 6 marker). The plan introduces a
refund command (refund → `BillingTransaction(type=refund)`),
admin-only failed-webhook listing + replay, and operational
overview endpoints.
