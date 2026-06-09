# Phase 7 — Minimal Admin & Refund Support

Status: ✅ Complete (2026-06-06)

Phase 7 adds the operational admin surface and refund command that
the MVP plan deferred from Phase 3/4/5. Admins can now get an
overview of billing health, inspect and replay failed webhooks, and
issue refunds directly from the API — all without leaving the
application.

## What landed

### Service
| File | Purpose |
| --- | --- |
| `src/billing/services/billing-admin.service.ts` | The single service for admin operations: overview snapshot, failed-webhook listing, webhook replay, and refund command. |
| `src/billing/services/billing-admin.service.spec.ts` | 11 + 1 reused = 12 cases — overview counts, failed-webhook listing, replay delegation, refund with idempotency, not-found, not-refundable status, fully-refunded guard, missing PaymentIntent, partial refund, full refund, amount-over-limit validation, Stripe error propagation. |

### Webhook replay
| File | Purpose |
| --- | --- |
| `src/billing/services/billing-webhook.service.ts` | New `replayEvent(eventId)` public method that reconstructs the event from the stored payload JSONB and re-dispatches through the existing handler pipeline, bypassing signature verification. Best-effort: updates the event row to `processed` / `failed` / `ignored` based on the replay outcome. |
| `src/billing/services/billing-webhook.service.spec.ts` | 3 new replay cases (existing 34 → 37 total). |

### Controller
| File | Purpose |
| --- | --- |
| `src/billing/controllers/billing.admin.controller.ts` | 4 new Phase 7 routes alongside the existing Phase 3 plan-management routes. |
| `src/billing/controllers/billing.admin.controller.spec.ts` | 6 new cases (existing 5 → 11 total). |

### DTOs
| File | Purpose |
| --- | --- |
| `src/billing/dto/billing-admin.dto.ts` | New — `BillingAdminOverviewResponseDto`, `BillingAdminListFailedWebhooksResponseDto`, `BillingAdminRefundRequestDto`, `BillingAdminRefundResponseDto`. |
| `src/billing/dto/index.ts` | Re-exports the new DTO. |

### Wiring
| File | Purpose |
| --- | --- |
| `src/billing/billing.module.ts` | Registers and exports `BillingAdminService`. Docblock bumped to `✅ Phase 7`. |

## HTTP surface

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/billing/admin/overview` | Operational snapshot: total customers, subscriptions by status, 10 most recent failed payments, failed webhook count. |
| `GET` | `/api/billing/admin/webhooks/failed` | Paginated list of FAILED webhook events with error messages (default 100, max 500). |
| `POST` | `/api/billing/admin/webhooks/:id/replay` | Re-dispatch a failed event from its stored payload. Returns `processed` / `duplicate` / `ignored` / `failed`. |
| `POST` | `/api/billing/admin/payments/:id/refund` | Issue a refund via Stripe. Requires `Idempotency-Key` header. Optional `amount` in minor units (defaults to full remaining balance). Records a `BillingTransaction(type=refund)`. |

## Acceptance criteria

- [x] `GET /api/billing/admin/overview` returns customers count, subscription breakdown, recent failed payments, and failed webhooks count.
- [x] `GET /api/billing/admin/webhooks/failed` returns failed webhook events with error messages, ordered by receivedAt descending.
- [x] `POST /api/billing/admin/webhooks/:id/replay` re-dispatches a failed event without signature verification. Returns the dispatch outcome.
- [x] Replay marks the event row as `processed` / `failed` / `ignored` based on the handler outcome.
- [x] Replay returns null/failed when the event id does not exist or the payload cannot be reconstructed.
- [x] `POST /api/billing/admin/payments/:id/refund` calls `stripe.refunds.create` and records a `BillingTransaction(type=refund)`.
- [x] Refund validates the payment is refundable (`succeeded` or `partially_refunded`), not fully refunded, and has a Stripe PaymentIntent.
- [x] Refund defaults to the full remaining refundable amount when `amount` is not provided.
- [x] Refund enforces idempotency to prevent duplicate Stripe refunds on network retry.
- [x] All new routes are admin-only (`AuthGuard` + `RolesGuard` with `ADMIN` role).
- [x] `pnpm run build` passes.
- [x] `pnpm test` passes: 207 / 207 (15 billing suites).
- [x] No new migration. No new dependencies.
- [x] `src/billing/PHASE-7-COMPLETION.md` (this file) records the deliverables.

## Out of scope (post-MVP)

- Scheduled retry workers for failed webhooks (manual replay is sufficient for v1).
- A dedicated `BillingRefund` table (refunds are `BillingTransaction(type=refund)`).
- Admin UI (API-only; frontend integration is separate).
- Revenue / MRR / ARR reporting (Stripe Dashboard is authoritative).
- Bulk operations (one refund at a time).
- Webhook dead-letter queue beyond the `FAILED` status listing.
- Audit table (structured logs via the `EventEmitter2` + logger calls).

## Next Phase

→ **Phase 8 — Testing and Hardening**
(`src/billing-module-implementation-plan.md`, search for the next
"Phase" heading). The plan introduces unit, integration, and e2e
tests for the complete billing module, Stripe webhook fixture tests,
and hardening of error paths and edge cases.
