# Billing Module Implementation Plan

## Purpose

Create a production-ready, reusable Stripe Billing module for this NestJS backend. The module should cover the most common SaaS billing needs with low operational burden: Stripe Checkout, subscriptions, one-time payments, webhook processing, customer portal sessions, lightweight payment/invoice history, idempotency for sensitive operations, minimal audit trails, and feature access checks.

The module is not intended to be a standalone billing platform, enterprise billing system, marketplace billing engine, or generalized financial ledger. The default design should optimize for adoption across many SaaS projects, implementation speed, and maintainability.

This plan is based on:

- `billing-platform-roadmap.md`
- Local Stripe skills in `.agents/skills/stripe-best-practices`
- Current project conventions in `src/app.module.ts`, `src/config`, TypeORM migrations, guards, DTOs, and tests

## Stripe Integration Rules

- Use Stripe as the only payment provider in v1.
- Use Stripe Checkout Sessions for one-time and subscription checkout flows.
- Use Stripe Billing APIs for recurring subscriptions.
- Use Stripe Prices, not deprecated Stripe Plans.
- Do not pass `payment_method_types` to Stripe APIs except for Terminal payments, which are out of scope.
- Use Stripe webhooks as the authoritative source of truth for payment, invoice, refund, and subscription state.
- Verify webhook signatures using `STRIPE_WEBHOOK_SECRET`.
- Use raw webhook payloads for signature verification and persist parsed event payloads for idempotency/troubleshooting. Store raw payloads only if the project accepts the PII/retention tradeoff.
- Configure the Stripe SDK with an explicit API version: `2026-05-27.dahlia`.
- Prefer Stripe restricted API keys with the `rk_` prefix and minimum required permissions. Environment variables can hold keys when no secret manager is available.
- Never trust client-provided amounts, currency, price IDs, or customer IDs.

## Current Project Observations

- The project uses NestJS 11, TypeScript, TypeORM 0.3, PostgreSQL, class-validator, Swagger, and Jest.
- `src/config/stripe.config.ts` already defines `StripeProvider`, but it initializes Stripe without an explicit API version.
- `src/main.ts` enables `rawBody: true` and currently registers raw body middleware for `/api/payments/webhook`.
- `src/user/schema/user.entity.ts` already contains `stripeCustomerId` and `isPremium`, but the roadmap requires a separate billing identity.
- `src/app.module.ts` imports `PaymentsModule`, `ProductsModule`, `CartModule`, and `OrderModule`, but those source directories are currently missing from `src/`.
- `src/config/database.config.ts` imports payment, order, cart, and product entities that are also currently missing from `src/`.
- Existing migrations include historical tables for `payments`, `refunds`, `webhook_events`, `outbox_events`, `checkout_session_states`, `orders`, and `order_items`.
- Existing e2e tests reference `/payments/*` endpoints and cart/order concepts.

## Required Pre-Implementation Cleanup

Before adding the billing module, resolve the missing-source mismatch:

1. Decide whether the missing `payments`, `products`, `cart`, and `orders` modules should be restored from history or removed from current application wiring.
2. Make `src/app.module.ts` and `src/config/database.config.ts` compile before adding billing.
3. Decide whether v1 billing should expose compatibility routes for old `/payments/*` endpoints or replace them with `/billing/*`.
4. Decide whether historical `payments`, `refunds`, `webhook_events`, and `outbox_events` tables will be migrated into the new billing schema or retained temporarily.

Recommended decision: create the new module under `src/billing` and use `/billing/*` routes. Add compatibility redirects or wrappers for `/payments/*` only if an existing client still depends on them.

## Lean Architecture Review

The initial roadmap covers many valid billing concepts, but several are too heavy for a reusable NestJS boilerplate module. Most SaaS projects adopting this backend need a dependable Stripe integration that answers four questions:

- Can this user start or manage a subscription?
- Did Stripe confirm payment or subscription status?
- What plan or feature access does the user currently have?
- Can support/admin users inspect enough billing state to troubleshoot?

They usually do not need a normalized financial document system, local discount engine, multi-party account model, immutable ledger, or enterprise reporting layer in v1. Stripe already owns most financial state and provides hosted billing operations, invoices, discounts, tax, refunds, and customer portal functionality.

### Recommended MVP Principle

Persist only local state required for application behavior, authorization, webhook idempotency, and useful support screens. Keep detailed financial data in Stripe unless the application has an immediate product requirement to query or mutate it locally.

### Over-Engineering Findings

| Area | Why it is excessive for a boilerplate MVP | Complexity introduced | Decision | Leaner alternative | Expected impact |
| --- | --- | --- | --- | --- | --- |
| `BillingAccount` separate from `BillingCustomer` and `User` | Most boilerplate SaaS apps bill one `User` directly. A separate account layer mainly helps organizations, workspaces, B2B contracts, and multi-tenant billing. | Extra table, ownership joins, guard logic, migrations, backfills, and mental overhead for every billing query. | Postpone. | Use `User` as the v1 billing owner and create one `BillingCustomer` row keyed by `user_id`. Add `BillingAccount` later only when an organization/workspace module exists. | Faster implementation, fewer joins, easier adoption. Extensibility remains possible through a later migration from `user_id` to `billing_account_id`. |
| Dedicated `BillingInvoiceLine` entity | Stripe already stores invoice line details and exposes hosted invoice URLs/PDFs. Most SaaS apps only need invoice status, amount, currency, period, and links. | More tables, sync logic, line-level webhook mapping, and report complexity. | Remove from MVP. | Store an invoice summary plus optional `stripe_invoice_snapshot jsonb` on `BillingInvoice`. Retrieve full invoice details from Stripe on demand for admin/support. | Lower schema and webhook complexity. Good enough for history screens and support. |
| `BillingDiscount` local aggregate | Stripe Coupons and Promotion Codes already manage eligibility, duration, redemption, and application in Checkout/Portal. | Local discount lifecycle, sync drift, validation rules, and admin UI burden. | Postpone. | Accept `promotionCode` or `allow_promotion_codes: true` in Checkout. Store applied discount summaries from invoice/session snapshots only. | Avoids duplicating Stripe Billing. Faster to ship and less likely to diverge from Stripe behavior. |
| `BillingRefund` aggregate/table | Refunds are usually infrequent support operations. Stripe owns refund lifecycle and emits references through charge/refund events. | Extra service, controller, state machine, table, joins, and webhook mapping. | Merge into transactions/payment metadata for MVP. | Expose a refund command that calls Stripe and creates a `BillingTransaction` row of type `refund`; store Stripe refund ID in transaction metadata and update payment refunded amounts. | Keeps refund support without another aggregate. Easier reporting and fewer tables. |
| Full immutable `BillingTransaction` ledger | A full ledger with settlements, disputes, adjustments, and corrections is beyond typical boilerplate needs. | Accounting semantics, append-only constraints, reconciliation workflows, correction events, and support obligations. | Simplify. | Use a lightweight `BillingTransaction` table for payment/refund events only: type, amount, currency, status, Stripe references, user ID, and timestamps. Defer settlements/disputes/adjustments. | Useful operational history without pretending to be accounting infrastructure. |
| Reporting module | Revenue intelligence, success rates, refund counts, and invoice reports can grow quickly and are not core billing behavior. | Many queries, permissions, date bucketing, accuracy expectations, and maintenance burden. | Reduce. | Add minimal operational endpoints: subscription count by status, recent failed webhooks, recent failed payments, MRR estimate from active local subscriptions if needed. Use Stripe Dashboard for financial reporting. | Lower maintenance and avoids inaccurate local finance reports. |
| Large module tree | Many submodules/controllers create boilerplate overhead before behavior exists. | More files, DI wiring, tests, and cross-module dependencies. | Merge. | Use one `BillingModule` with focused services: `StripeService`, `BillingCustomerService`, `BillingCheckoutService`, `BillingSubscriptionService`, `BillingWebhookService`, `BillingEntitlementsService`, and optional `BillingAdminService`. | Better developer experience and faster onboarding. |
| Local normalized financial schema | Normalizing invoices, invoice lines, refunds, settlements, discounts, and audit records duplicates Stripe. | Drift risk, migrations, webhooks, reconciliation, and support burden. | Keep only operational snapshots. | Store Stripe IDs, statuses, amounts, links, and selected snapshots. Pull detailed financial data from Stripe when needed. | Reduces database complexity and webhook handler surface. |
| Future B2B/multi-org/marketplace readiness | Most boilerplate adopters are single-product SaaS apps. | Premature account abstraction, multi-owner permissions, and generalized resource ownership. | Defer. | Keep v1 user-owned. Document migration path to account/workspace ownership. | Maintains extensibility without penalizing common use cases. |
| Replay and dead-letter tooling | Useful, but full replay UI/toolkit is not needed on day one. | Admin APIs, retry scheduling, locking, and operational runbooks. | Simplify. | Persist webhook events and support manual replay through a service method or CLI/internal admin route later. Add scheduled retries only after real need. | Keeps webhook reliability while reducing operational code. |
| Broad audit subsystem | Full before/after audit snapshots across all billing resources are heavy for a boilerplate. | Extra table volume, PII concerns, redaction rules, and audit semantics. | Simplify. | Store minimal audit events for admin-initiated sensitive actions: refund, manual sync, subscription cancel/change, webhook replay. | Preserves traceability where it matters without audit-platform complexity. |

### Detailed Simplification Decisions

#### BillingAccount vs BillingCustomer vs User

The three-layer owner model is the biggest source of premature abstraction. It is useful when the product has companies, teams, workspaces, seats, invoices addressed to legal entities, or multiple payers per application account. This boilerplate does not currently have those concepts. Adding `BillingAccount` in v1 would force every service, controller, guard, migration, and query to answer account-ownership questions before the product has account-level billing requirements.

Decision: remove `BillingAccount` from MVP and link `BillingCustomer` directly to `User`.

Leaner alternative:

- `User` owns billing in v1.
- `BillingCustomer.user_id` is unique.
- Routes use the authenticated user ID for ownership.
- Future organization support can add `BillingAccount` through a migration when a real project introduces organizations.

Impact:

- Fewer joins and less guard code.
- Easier onboarding for projects that just need user subscriptions.
- Faster implementation without blocking future migration to workspace billing.

#### BillingInvoiceLine

A dedicated invoice-line table optimizes for local invoice rendering, finance queries, and detailed accounting workflows. Stripe already stores invoice line items, hosted invoice pages, PDFs, taxes, discounts, and adjustments. Most SaaS apps only show a list of invoices and link to the hosted invoice or PDF.

Decision: remove `BillingInvoiceLine` from MVP.

Leaner alternative:

- Store invoice summary columns on `BillingInvoice`.
- Store optional `stripe_snapshot` for support/debugging.
- Fetch full invoice details from Stripe on demand for admin screens if needed.

Impact:

- Avoids line-level webhook synchronization.
- Reduces schema size and drift risk.
- Keeps user billing history useful without becoming an accounting subsystem.

#### BillingDiscount

Local discount modeling duplicates Stripe Coupons and Promotion Codes. Stripe already manages discount duration, redemption limits, promotion-code validation, coupon application, and interaction with Checkout. A local discount aggregate adds an admin surface and sync correctness burden without immediate value.

Decision: postpone `BillingDiscount`.

Leaner alternative:

- Use `allow_promotion_codes: true` in Checkout when promotion codes should be accepted.
- Or accept a Stripe promotion code reference and pass it to Checkout after server-side validation.
- Store applied discount summaries from Stripe invoice/session snapshots only.

Impact:

- Less code and fewer admin requirements.
- Fewer mismatches between local rules and Stripe rules.
- Projects can still use common coupon workflows from day one.

#### BillingRefund

Refunds matter, but a dedicated refund aggregate is unnecessary for most boilerplate adopters. Stripe owns refund state and emits refund/charge events. Local applications usually need to know that a refund happened, for how much, and which payment it relates to.

Decision: do not create `BillingRefund` table in MVP.

Leaner alternative:

- Implement an admin refund command.
- Call Stripe refunds API.
- Record a `BillingTransaction` row with `type = refund`.
- Update `BillingPayment.amount_refunded` and payment status from webhooks.

Impact:

- Refund support still exists.
- No separate refund state machine or controller family.
- Transaction history remains enough for support and basic account history.

#### Reporting

The original reporting scope leans toward revenue analytics. Financial reports are hard to make correct because refunds, disputes, taxes, proration, coupons, failed invoices, currency, and timing all affect revenue. Stripe Dashboard already provides finance-grade reporting for most teams.

Decision: reduce reporting to operational admin visibility.

Leaner alternative:

- Show active subscriptions by status.
- Show recent failed payments.
- Show recent failed webhooks.
- Show recent invoices and payments.
- Use Stripe Dashboard for revenue, tax, discount, and invoice-line analytics.

Impact:

- Avoids inaccurate finance reports.
- Lowers maintenance cost.
- Still gives developers and support staff enough visibility to debug billing issues.

#### Entity, Service, and Controller Count

The original module tree creates many folders and services before the behavior requires them. This increases DI wiring, test setup, file navigation, and cognitive load. For a boilerplate, adoption speed matters more than perfectly separated subdomains.

Decision: collapse the module structure.

Leaner alternative:

- One `BillingModule`.
- Three controllers: user billing, public plans, admin/support, plus webhook controller.
- Focused services instead of many submodules.
- Only split into submodules after a project grows enough to justify the boundary.

Impact:

- Less boilerplate and easier customization.
- Faster implementation.
- Clearer developer experience for most SaaS projects.

#### Database Schema Scope

The original schema is optimized for future enterprise use cases: multi-owner billing, local financial documents, line-item normalization, audit trails, refund aggregates, and ledger semantics. Those are expensive to maintain and mostly unnecessary for a common SaaS starter.

Decision: store operational snapshots, not normalized financial truth.

Leaner alternative:

- Store Stripe IDs, statuses, amounts, periods, links, and selected snapshots.
- Let Stripe remain the source for detailed invoices, discounts, tax, refund objects, and payment method details.

Impact:

- Lower database complexity.
- Lower webhook handler complexity.
- Lower risk of local state diverging from Stripe.

#### Postponed Stations and Deliverables

Several roadmap stations should move to post-MVP:

- Discount system
- Tax module
- Invoice-line engine
- Full transaction ledger
- Dunning workflow beyond Stripe Billing defaults
- Dead-letter queue handling
- Advanced reporting
- Full audit logging
- Multi-tenant billing
- Marketplace billing

Decision: ship a strong Stripe Billing integration first, then add these only when a product needs them.

Impact:

- The first version is feasible to implement and test.
- Projects can adopt the boilerplate without inheriting enterprise workflows.
- Future features can be added from real requirements instead of guesses.

#### Local State vs Stripe State

Duplicating Stripe state locally should be intentional. Local state is valuable for access control, fast account screens, support summaries, and webhook idempotency. It is less valuable for data Stripe already renders, calculates, and audits.

Decision: keep detailed financial state in Stripe unless local application behavior depends on it.

Keep locally:

- Customer ID
- Active subscription status and period
- Payment status and amount
- Invoice summary and hosted links
- Transaction history for charges/refunds
- Webhook event state
- Entitlements

Leave in Stripe:

- Payment method details
- Invoice lines
- Coupon and promotion-code lifecycle
- Detailed tax calculation
- Refund object lifecycle
- Finance-grade revenue reports
- Customer portal operations

Impact:

- Less data retention risk.
- Less sync and reconciliation code.
- Better alignment with Stripe-hosted billing features.

#### Developer Experience vs Flexibility

A boilerplate should be easy to understand, copy, and adapt. Excess flexibility creates abstract concepts new projects must understand before they can accept payments. The v1 module should expose direct SaaS primitives: plans, checkout, subscription, portal, webhook sync, and entitlements.

Decision: prioritize developer experience over broad future flexibility.

Leaner alternative:

- Use clear `User` ownership.
- Keep route names predictable.
- Keep Stripe wrappers simple.
- Provide guards and services for feature access.
- Document post-MVP migration paths instead of implementing them early.

Impact:

- Higher adoption across typical SaaS projects.
- Faster time to first successful checkout.
- Lower maintenance cost for the boilerplate.

### Missing Piece: Entitlements

The original roadmap underemphasizes entitlements. For most SaaS applications, the most important billing output is not invoice normalization; it is deciding whether a user can access premium functionality.

Add a lightweight Entitlements component to v1.

Responsibilities:

- Map active Stripe subscription or one-time purchase state to application features.
- Provide `canAccess(userId, featureKey)` and `getUserEntitlements(userId)` methods.
- Expose guards/decorators for protected routes, for example `@RequiresFeature('premium_reports')`.
- Keep feature definitions local and simple.
- Recompute user entitlements when subscription/payment webhooks are processed.
- Preserve existing `users.is_premium` only as a compatibility shortcut or derived field, not as the source of truth.

Recommended fit:

- Add entitlements after subscription webhook handling and before minimal admin reporting.
- Treat entitlements as Phase 6 in the revised implementation order because app access depends on it.

## Revised MVP Scope

### Include in v1

- Stripe SDK provider with explicit API version and safe key handling
- Billing customer linked directly to `User`
- Local product/price catalog or Stripe Price references
- Checkout Sessions for subscriptions and one-time payments
- Customer Portal session creation
- Subscription status persistence
- Payment status persistence
- Invoice summary persistence
- Lightweight transaction history for charges and refunds
- Verified webhook ingestion with idempotent event storage
- Minimal admin/support operations
- Lightweight entitlements and feature access checks
- Focused tests with mocked Stripe calls and webhook fixtures

### Postpone

- `BillingAccount`
- `BillingInvoiceLine`
- `BillingDiscount`
- `BillingRefund` table
- Full ledger semantics
- Settlement tracking
- Dispute/chargeback automation
- Advanced reporting
- Dead-letter queue UI
- Full audit subsystem
- Multi-currency strategy beyond storing Stripe currency
- Organization/workspace billing
- Marketplace or Connect billing
- Enterprise contracts
- Usage-based billing

## Target Module Structure

```text
src/billing/
├── controllers/
│   ├── billing.controller.ts
│   ├── billing.admin.controller.ts
│   ├── billing.public.controller.ts
│   └── stripe-webhook.controller.ts
├── dto/
├── entities/
│   ├── billing-customer.entity.ts
│   ├── billing-plan.entity.ts
│   ├── billing-price.entity.ts
│   ├── billing-subscription.entity.ts
│   ├── billing-payment.entity.ts
│   ├── billing-invoice.entity.ts
│   ├── billing-transaction.entity.ts
│   ├── billing-webhook-event.entity.ts
│   ├── billing-idempotency-key.entity.ts
│   └── billing-entitlement.entity.ts
├── services/
│   ├── stripe.service.ts
│   ├── billing-customer.service.ts
│   ├── billing-checkout.service.ts
│   ├── billing-subscription.service.ts
│   ├── billing-payment.service.ts
│   ├── billing-webhook.service.ts
│   ├── billing-entitlements.service.ts
│   └── billing-admin.service.ts
├── guards/
│   ├── billing-owner.guard.ts
│   └── feature-access.guard.ts
├── common/
│   ├── billing.constants.ts
│   ├── billing-events.ts
│   ├── billing.enums.ts
│   ├── money.util.ts
│   └── stripe-reference.util.ts
└── billing.module.ts
```

## Module Boundary Rules

- Controllers validate input and delegate to services.
- Stripe calls live only in `BillingStripeService` or clearly named Stripe wrapper methods.
- Webhook handlers write canonical local state and emit internal events.
- Business services never accept amount or customer identifiers directly from clients without server-side lookup.
- User-facing billing ownership is `User`-based in v1.
- Reporting is minimal and operational, not financial analytics.
- Transactions are lightweight history records, not a full accounting ledger.
- Existing application modules should depend on `BillingEntitlementsService` and checkout/subscription services, not Stripe directly.

## Domain Model

The MVP should use a small schema that mirrors common SaaS behavior and avoids duplicating Stripe's financial system. The recommended v1 tables are:

- `billing_customers`
- `billing_plans`
- `billing_prices`
- `billing_subscriptions`
- `billing_payments`
- `billing_invoices`
- `billing_transactions`
- `billing_webhook_events`
- `billing_idempotency_keys`
- `billing_entitlements`

Postponed tables:

- `billing_accounts`
- `billing_invoice_lines`
- `billing_discounts`
- `billing_refunds`
- broad `billing_audit_events`

### BillingCustomer

Represents the Stripe customer linked to the application user. In v1, this is enough ownership modeling for most SaaS projects.

Core columns:

- `id uuid primary key`
- `user_id integer unique not null`
- `stripe_customer_id varchar(255) unique not null`
- `email varchar(255) not null`
- `name varchar(255) nullable`
- `metadata jsonb not null default '{}'`
- `created_at timestamp`
- `updated_at timestamp`

Why this is leaner:

- It avoids a separate `BillingAccount` abstraction until the app actually supports organizations or workspaces.
- It matches the existing `User` entity and current `users.stripe_customer_id` field.
- It keeps route ownership checks simple: current user owns rows with matching `user_id`.

Migration note:

- Backfill from `users.stripe_customer_id` when present.
- Keep `users.stripe_customer_id` temporarily as a compatibility field or derived shortcut.
- Defer removing `users.stripe_customer_id` until the app no longer references it.

Future path:

- If organization billing is later required, introduce `BillingAccount` and migrate `billing_customers.user_id` into `billing_accounts.owner_user_id` or `billing_accounts.organization_id`.

### BillingPlan

Represents a local display and entitlement grouping for a Stripe product.

Core columns:

- `id uuid primary key`
- `code varchar(100) unique not null`
- `name varchar(255) not null`
- `description text nullable`
- `status enum(draft, active, archived)`
- `features jsonb not null default '[]'`
- `metadata jsonb not null default '{}'`
- `created_at timestamp`
- `updated_at timestamp`

Notes:

- `features` should contain stable feature keys such as `["premium_reports", "team_export"]`.
- Avoid building an admin-heavy catalog manager in v1 unless needed. Seed plans or manage them through simple admin endpoints.

### BillingPrice

Stores the Stripe Price IDs the backend is allowed to sell.

Core columns:

- `id uuid primary key`
- `plan_id uuid not null`
- `stripe_price_id varchar(255) unique not null`
- `stripe_product_id varchar(255) nullable`
- `currency varchar(3) not null`
- `unit_amount integer not null`
- `type enum(one_time, recurring)`
- `interval enum(day, week, month, year) nullable`
- `trial_period_days integer nullable`
- `active boolean not null default true`
- `created_at timestamp`
- `updated_at timestamp`

Rules:

- Store amounts in minor units.
- Treat prices as immutable once sold. Create a new row when Stripe Price changes.
- Use Stripe Prices, not deprecated Stripe Plans.

### BillingSubscription

Stores the current local subscription state needed for access checks, support, and user account screens.

Core columns:

- `id uuid primary key`
- `user_id integer not null`
- `billing_customer_id uuid not null`
- `plan_id uuid nullable`
- `price_id uuid nullable`
- `stripe_subscription_id varchar(255) unique not null`
- `stripe_checkout_session_id varchar(255) unique nullable`
- `status enum(incomplete, trialing, active, past_due, canceled, unpaid, paused, incomplete_expired)`
- `current_period_start timestamp nullable`
- `current_period_end timestamp nullable`
- `trial_end timestamp nullable`
- `cancel_at_period_end boolean not null default false`
- `canceled_at timestamp nullable`
- `latest_invoice_id varchar(255) nullable`
- `metadata jsonb not null default '{}'`
- `created_at timestamp`
- `updated_at timestamp`

Rules:

- Webhooks are the source of truth for status and period dates.
- Implement one active subscription per user in v1.
- Defer multiple concurrent subscriptions unless a real product requirement appears.

### BillingPayment

Stores one-time checkout/payment state for SaaS add-ons or paid one-off actions.

Core columns:

- `id uuid primary key`
- `user_id integer not null`
- `billing_customer_id uuid not null`
- `price_id uuid nullable`
- `stripe_checkout_session_id varchar(255) unique nullable`
- `stripe_payment_intent_id varchar(255) unique nullable`
- `amount integer not null`
- `amount_refunded integer not null default 0`
- `currency varchar(3) not null`
- `status enum(checkout_created, pending, succeeded, failed, canceled, refunded, partially_refunded)`
- `description text nullable`
- `metadata jsonb not null default '{}'`
- `created_at timestamp`
- `updated_at timestamp`

Rules:

- Do not accept client-provided amounts.
- Store enough state for account history and support.
- Do not model line items locally unless the business resource requires it.

### BillingInvoice

Stores a lightweight Stripe invoice summary.

Core columns:

- `id uuid primary key`
- `user_id integer not null`
- `subscription_id uuid nullable`
- `stripe_invoice_id varchar(255) unique not null`
- `stripe_payment_intent_id varchar(255) nullable`
- `number varchar(100) nullable`
- `status enum(draft, open, paid, void, uncollectible)`
- `currency varchar(3) not null`
- `subtotal integer not null default 0`
- `total integer not null default 0`
- `amount_paid integer not null default 0`
- `amount_due integer not null default 0`
- `hosted_invoice_url text nullable`
- `invoice_pdf text nullable`
- `period_start timestamp nullable`
- `period_end timestamp nullable`
- `paid_at timestamp nullable`
- `stripe_snapshot jsonb nullable`
- `created_at timestamp`
- `updated_at timestamp`

Why no `BillingInvoiceLine` in MVP:

- Stripe owns invoice line details and hosted invoices.
- A summary supports user history, admin support, and access decisions.
- Full line normalization adds sync drift and query complexity without common SaaS value.

### BillingTransaction

Stores lightweight operational history for charges and refunds. This is not a full accounting ledger.

Core columns:

- `id uuid primary key`
- `user_id integer not null`
- `payment_id uuid nullable`
- `invoice_id uuid nullable`
- `subscription_id uuid nullable`
- `type enum(charge, refund)`
- `amount integer not null`
- `currency varchar(3) not null`
- `status enum(pending, succeeded, failed)`
- `stripe_payment_intent_id varchar(255) nullable`
- `stripe_charge_id varchar(255) nullable`
- `stripe_refund_id varchar(255) nullable`
- `occurred_at timestamp not null`
- `metadata jsonb not null default '{}'`
- `created_at timestamp`

Why no `BillingRefund` table in MVP:

- Refunds can be represented as `type = refund` transaction rows.
- Stripe remains the authoritative refund lifecycle owner.
- Payment rows can store `amount_refunded` and status for quick history screens.

### BillingWebhookEvent

Stores Stripe events for idempotent processing, troubleshooting, and minimal replay support.

Core columns:

- `id uuid primary key`
- `stripe_event_id varchar(255) unique not null`
- `event_type varchar(150) not null`
- `api_version varchar(50) nullable`
- `livemode boolean not null`
- `status enum(received, processed, failed, ignored)`
- `processing_attempts integer not null default 0`
- `payload jsonb not null`
- `error_message text nullable`
- `received_at timestamp not null`
- `processed_at timestamp nullable`
- `created_at timestamp`
- `updated_at timestamp`

Indexes:

- Unique `stripe_event_id`
- Index `event_type`
- Index `status`
- Index `received_at`

Notes:

- Store raw payload only if needed for debugging or replay. If raw storage is enabled, ensure PII retention expectations are understood.
- Full dead-letter UI is postponed.

### BillingIdempotencyKey

Prevents duplicate sensitive operations.

Core columns:

- `id uuid primary key`
- `key varchar(255) unique not null`
- `scope varchar(100) not null`
- `user_id integer nullable`
- `request_hash varchar(255) not null`
- `response_snapshot jsonb nullable`
- `status enum(in_progress, completed, failed, expired)`
- `expires_at timestamp not null`
- `created_at timestamp`
- `updated_at timestamp`

Rules:

- Require idempotency for checkout creation, subscription changes, cancellation, portal session creation, and refund commands.
- Reject key reuse with a different request hash.

### BillingEntitlement

Represents the current feature access granted to a user.

Core columns:

- `id uuid primary key`
- `user_id integer not null`
- `source_type enum(subscription, one_time_payment, manual)`
- `source_id uuid nullable`
- `feature_key varchar(100) not null`
- `active boolean not null default true`
- `starts_at timestamp nullable`
- `ends_at timestamp nullable`
- `metadata jsonb not null default '{}'`
- `created_at timestamp`
- `updated_at timestamp`

Indexes and constraints:

- Index `user_id`
- Index `feature_key`
- Unique active entitlement per `user_id`, `feature_key`, and `source_type` where practical.

Rules:

- Recompute entitlements when subscription/payment webhooks change local billing state.
- Application code should ask `BillingEntitlementsService`, not inspect subscription statuses directly.
- Keep feature keys stable and documented.

### Minimal Audit Strategy

Do not create a broad audit subsystem in MVP. Instead:

- Use application logs plus webhook event records for Stripe-driven changes.
- Store minimal audit rows only if implementing admin actions such as manual refund, manual sync, or webhook replay.
- If audit rows are added, keep them generic and small: actor, action, resource type, resource ID, metadata, timestamp.

## Environment Configuration

Add or update validation in `src/config/env.validation.ts`:

- `STRIPE_SECRET_KEY` or `STRIPE_RESTRICTED_KEY`, required when billing module is enabled
- `STRIPE_WEBHOOK_SECRET`, required outside test
- `STRIPE_API_VERSION`, default `2026-05-27.dahlia`
- `STRIPE_SUCCESS_URL`, required for Checkout
- `STRIPE_CANCEL_URL`, required for Checkout
- `STRIPE_PORTAL_RETURN_URL`, required for Customer Portal
- `BILLING_ENABLED`, default `true`
- `BILLING_DEFAULT_CURRENCY`, default `usd`

Update Stripe provider:

- Prefer `STRIPE_RESTRICTED_KEY` over `STRIPE_SECRET_KEY`.
- Instantiate `new Stripe(key, { apiVersion: '2026-05-27.dahlia' })`.
- Redact keys from all logs and thrown errors.
- Validate test/live mismatch using `NODE_ENV` and key prefix where possible.

## HTTP API Surface

Use global prefix `/api`, so route examples below are effective paths.

### Public Plans

- `GET /api/billing/plans/public`
- Returns active published plans and active prices.
- No authentication required if pricing is public.

### Admin Plans

- `POST /api/billing/plans`
- `PATCH /api/billing/plans/:id`
- `POST /api/billing/plans/:id/archive`
- `POST /api/billing/plans/:id/prices`
- Protected by admin role.

### Billing Customer

- `GET /api/billing/customer`
- `POST /api/billing/customer/sync`
- Authenticated user only.

### Checkout

- `POST /api/billing/checkout/one-time`
- `POST /api/billing/checkout/subscription`
- Returns `{ sessionId, url }`.
- Requires an idempotency key.
- Does not accept raw amount from client.

### Customer Portal

- `POST /api/billing/portal/session`
- Returns `{ url }`.
- Requires authenticated customer and idempotency key.

### Payments

- `GET /api/billing/payments`
- `GET /api/billing/payments/:id`
- `POST /api/billing/payments/:id/refund`
- Refund requires idempotency key and permission checks.

### Subscriptions

- `GET /api/billing/subscriptions/current`
- `POST /api/billing/subscriptions`
- `POST /api/billing/subscriptions/:id/cancel`
- `POST /api/billing/subscriptions/:id/portal`
- Subscription create/cancel and portal creation require idempotency keys.
- Prefer Stripe Customer Portal for plan changes, payment method updates, and resume flows in v1.

### Invoices

- `GET /api/billing/invoices`
- `GET /api/billing/invoices/:id`

### Transactions

- `GET /api/billing/transactions`
- `GET /api/billing/transactions/:id`

### Entitlements

- `GET /api/billing/entitlements`
- Returns active feature keys for the current user.
- Main application modules should usually use `BillingEntitlementsService` or `FeatureAccessGuard` instead of calling this endpoint internally.

### Minimal Admin Operations

- `GET /api/billing/admin/overview`
- `GET /api/billing/admin/webhooks/failed`
- `POST /api/billing/admin/webhooks/:id/replay`
- `POST /api/billing/admin/payments/:id/refund`
- Keep admin reporting operational. Use Stripe Dashboard for financial reports.

### Webhooks

- `POST /api/billing/webhooks/stripe`
- No auth guard. Verification is by Stripe signature.
- Must receive raw body.

Update `src/main.ts` raw body setup from `/api/payments/webhook` to include `/api/billing/webhooks/stripe`.

## Checkout Flow

### One-Time Payment

1. Authenticated user requests checkout with a server-known item, plan price, or business resource reference.
2. Service loads the price/resource from database.
3. Service creates or loads `BillingCustomer` for the current `User`.
4. Service creates `BillingPayment` with `checkout_created` status.
5. Service calls `stripe.checkout.sessions.create` with:
   - `mode: 'payment'`
   - `customer`
   - `line_items`
   - `success_url`
   - `cancel_url`
   - `client_reference_id`
   - `metadata` containing local IDs
   - No `payment_method_types`
6. Service updates payment to `checkout_created` and stores `stripe_checkout_session_id`.
7. Client redirects to Stripe Checkout.
8. Webhook handlers process `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, and related events.
9. Local status, lightweight transactions, and entitlements are finalized from webhooks.

### Subscription

1. Authenticated user selects a local `BillingPrice` where `billing_type = recurring`.
2. Service creates or loads `BillingCustomer` for the current `User`.
3. Service validates the user does not already have an active subscription unless the project explicitly opts into multiple subscriptions.
4. Service creates a local `BillingSubscription` in `incomplete` state.
5. Service calls `stripe.checkout.sessions.create` with:
   - `mode: 'subscription'`
   - `customer`
   - `line_items: [{ price: stripePriceId, quantity: 1 }]`
   - Optional `subscription_data.trial_period_days`
   - `success_url`
   - `cancel_url`
   - `client_reference_id`
   - `metadata` containing local IDs
   - No `payment_method_types`
6. Webhook handlers process `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, and `invoice.finalized`.
7. Local subscription status, period dates, invoice summaries, and entitlements are updated from Stripe webhook payloads.

## Webhook Processing Plan

### Controller

- Read raw body.
- Verify `stripe-signature` using `stripe.webhooks.constructEvent`.
- Persist `BillingWebhookEvent` before dispatch.
- Return `2xx` after durable persistence and successful or intentionally ignored processing.
- Return non-2xx only when Stripe should retry.

### Idempotency

- Use `stripe_event_id` unique constraint to prevent duplicate event processing.
- Wrap handler execution in a database transaction.
- Mark duplicate events as ignored or return the existing event processing result.

### Handler Set for MVP

- `checkout.session.completed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.succeeded`
- `charge.refunded`
- `customer.created`
- `customer.updated`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.created`
- `invoice.finalized`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.voided`
- `invoice.marked_uncollectible`

### Replay and Recovery

- Persist failed events with error messages.
- Add an admin-only replay service or endpoint for failed events.
- Postpone scheduled retries until operational evidence shows they are needed.
- Keep failed events queryable with error messages.

## Security Plan

- Protect all billing routes with the existing global auth guard except the Stripe webhook endpoint and public plan listing.
- Add owner checks for user-facing billing resources.
- Add admin role checks for plan management, refunds, webhook replay, and operational overview.
- Redact Stripe keys, webhook signatures, and customer-sensitive data from logs.
- Never expose raw Stripe objects directly to clients. Map to response DTOs.
- Do not store full card data. Store only Stripe IDs and non-sensitive summaries returned by Stripe when needed.
- Use minimal audit records only for admin-initiated sensitive actions, such as manual refund, manual sync, or webhook replay.
- Use entitlements guards for feature access instead of duplicating subscription checks across application modules.

## Migration Plan

### Migration 1: Lean Billing Tables

Create:

- `billing_customers`
- `billing_plans`
- `billing_prices`
- `billing_payments`
- `billing_subscriptions`
- `billing_invoices`
- `billing_transactions`
- `billing_webhook_events`
- `billing_idempotency_keys`
- `billing_entitlements`

Backfill:

- Create `billing_customers` for existing users with `users.stripe_customer_id`.
- Optionally derive initial premium entitlement from `users.is_premium`, but treat it as a temporary compatibility bridge.

### Migration 2: Compatibility and Cleanup Preparation

Compatibility:

- If historical `payments`, `refunds`, and `webhook_events` tables exist in target environments, either:
  - migrate only summary rows needed for user history and support, or
  - leave them read-only and expose no new writes.

Recommended: migrate only if production data exists. Otherwise keep old tables untouched until a later cleanup migration.

### Migration 3: Cleanup

Only after the module is stable:

- Remove old `users.stripe_customer_id` and `users.is_premium` direct usage.
- Remove old `/payments/*` compatibility code if no clients use it.
- Drop old payment tables only after data migration, backups, and explicit approval.
- Add `billing_accounts` only if the product introduces organizations/workspaces.

## Implementation Phases

### Phase 0: Compile Baseline and Scope Lock

Deliverables:

- Project compiles before billing work.
- Missing module imports resolved.
- Decision made for `/payments/*` compatibility.
- Lean MVP scope accepted.

Tasks:

- Run `pnpm run build`.
- Restore or remove missing modules referenced by `app.module.ts` and `database.config.ts`.
- Run current tests to establish baseline failures.
- Confirm that v1 is user-owned billing, not organization/workspace billing.
- Confirm that Stripe Dashboard remains the source for advanced finance reports, discounts, tax management, and detailed invoice inspection.

Acceptance criteria:

- Billing implementation does not start until compile blockers are known.
- No `BillingAccount`, `BillingDiscount`, `BillingInvoiceLine`, or `BillingRefund` table is planned for MVP.

### Phase 1: Billing Skeleton, Config, and Stripe Client

Deliverables:

- `BillingModule`
- Lean folder structure
- Stripe client provider
- Environment validation
- Shared enums and money utilities

Tasks:

- Create `src/billing/billing.module.ts`.
- Add controllers/services/entities folders from the lean module structure.
- Update Stripe provider to use explicit API version and prefer restricted keys.
- Add billing env validation.
- Add `money.util.ts` for minor-unit validation and currency normalization.
- Keep Stripe API calls isolated behind `BillingStripeService`.

Acceptance criteria:

- `pnpm run build` passes after skeleton wiring.
- Tests can mock Stripe calls without network access.
- No code logs keys or raw Stripe errors containing secrets.

### Phase 2: Lean Persistence and Migrations

Deliverables:

- Core billing entities
- Initial migration
- TypeORM registration

Tasks:

- Implement `BillingCustomer`, `BillingPlan`, `BillingPrice`, `BillingSubscription`, `BillingPayment`, `BillingInvoice`, `BillingTransaction`, `BillingWebhookEvent`, `BillingIdempotencyKey`, and `BillingEntitlement`.
- Add entities to `src/config/database.config.ts`.
- Create migration for the lean billing tables.
- Backfill `BillingCustomer` from `users.stripe_customer_id` when present.

Acceptance criteria:

- Migration creates only MVP tables.
- Schema uses `user_id integer` to match the current `User` entity.
- No table models enterprise-only concepts.

### Phase 3: Customer, Catalog, and Portal

Deliverables:

- Billing customer service
- Plan/price catalog
- Customer Portal session creation

Tasks:

- Implement get-or-create Stripe customer for the current user.
- Implement simple plan and price listing.
- Add admin endpoints or seed flow for plan/price setup.
- Implement Customer Portal session creation.

Acceptance criteria:

- Existing users can create billing customers without duplicates.
- Public plans expose only active safe pricing data.
- Portal route returns a Stripe URL from mocked Stripe service.

### Phase 4: Checkout for Subscriptions and One-Time Payments

Deliverables:

- Subscription Checkout Session creation
- One-time Checkout Session creation
- Idempotency enforcement

Tasks:

- Implement `POST /billing/checkout/subscription`.
- Implement `POST /billing/checkout/one-time`.
- Resolve all prices server-side from `BillingPrice`.
- Create Checkout Sessions without `payment_method_types`.
- Store local payment/subscription shells and Stripe session IDs.
- Enforce idempotency keys for checkout creation.

Acceptance criteria:

- Duplicate requests with the same idempotency key return the same result.
- Reusing the same idempotency key with a different request fails.
- Client cannot override amount, currency, Stripe customer, or Stripe price.

### Phase 5: Verified Webhooks and Local State Sync

Deliverables:

- Stripe webhook endpoint
- Webhook event persistence
- Local subscription/payment/invoice/transaction sync

Tasks:

- Implement `POST /billing/webhooks/stripe`.
- Register raw body handling in `main.ts`.
- Verify signatures with `STRIPE_WEBHOOK_SECRET`.
- Persist events idempotently by `stripe_event_id`.
- Handle MVP event set for checkout, subscriptions, payments, invoices, and refunds-as-transactions.
- Store invoice summaries, not invoice lines.

Acceptance criteria:

- Invalid signatures are rejected.
- Duplicate Stripe events do not duplicate writes.
- Webhook tests drive subscription status, payment status, invoice summary, and transaction updates.

### Phase 6: Entitlements and Feature Access

Deliverables:

- `BillingEntitlementsService`
- Feature access guard/decorator
- Entitlement recomputation from billing state

Tasks:

- Map `BillingPlan.features` to active user entitlements.
- Recompute entitlements after subscription and one-time payment webhooks.
- Add `canAccess(userId, featureKey)` and `getUserEntitlements(userId)`.
- Add `FeatureAccessGuard` and decorator such as `@RequiresFeature('feature_key')`.
- Treat `users.is_premium` as a derived compatibility shortcut only if needed.

Acceptance criteria:

- Application modules can protect premium features without knowing Stripe statuses.
- Canceling or failing a subscription eventually removes expired entitlements.
- Active subscriptions grant the expected feature keys.

### Phase 7: Minimal Admin and Refund Support

Deliverables:

- Operational admin overview
- Failed webhook listing/replay
- Refund command
- Minimal audit for admin actions

Tasks:

- Add admin-only failed webhook list and replay.
- Add admin-only refund command that calls Stripe and records a `refund` transaction.
- Add minimal audit rows or structured logs for refund and replay.
- Keep financial reporting in Stripe Dashboard.

Acceptance criteria:

- Admin can troubleshoot failed webhooks.
- Refunds do not require a `BillingRefund` table.
- Support users can inspect payment, subscription, invoice, transaction, and webhook summaries.

### Phase 8: Testing and Hardening

Deliverables:

- Unit tests
- Integration tests
- E2E tests
- Stripe webhook fixture tests

Tasks:

- Unit test money utilities, idempotency logic, entitlement resolution, and status mapping.
- Integration test repositories and webhook idempotency.
- E2E test plan listing, checkout creation, portal session creation, subscription history, invoice history, and webhook-driven updates.
- Mock Stripe SDK calls.
- Add fixtures for common Stripe events.
- Test duplicate webhook delivery and invalid signatures.

Acceptance criteria:

- `pnpm run build` passes.
- `pnpm run test` passes.
- `pnpm run test:e2e` passes in the configured test environment.
- No test requires live Stripe network access.

### Post-MVP Phases

Add only after a real project needs them:

- Organization/workspace billing with `BillingAccount`
- Local invoice line normalization
- Local discount administration
- Dedicated refund aggregate
- Scheduled webhook retry workers
- Usage-based billing
- Tax administration beyond Stripe settings
- Multi-currency product strategy
- Advanced reporting and revenue analytics
- Marketplace/Connect billing

## DTO Guidelines

- Use `class-validator` and `class-transformer`.
- Never expose internal raw metadata unless needed.
- Use explicit response DTOs for every controller response.
- Validate UUID params with Nest pipes or DTO validators.
- For money fields, validate positive integer minor units.
- For public plan APIs, expose only active prices and safe metadata.

## Event Naming

Internal events should use this namespace:

- `billing.customer.created`
- `billing.checkout.created`
- `billing.payment.succeeded`
- `billing.payment.failed`
- `billing.refund.succeeded`
- `billing.subscription.created`
- `billing.subscription.updated`
- `billing.subscription.canceled`
- `billing.invoice.paid`
- `billing.invoice.payment_failed`
- `billing.webhook.failed`

Use `@nestjs/event-emitter`, already available in `AppModule`, for internal side effects such as notifications.

## Integration With Existing Notifications

Emit notification events after local billing state changes:

- Payment success
- Payment failure
- Subscription activated
- Subscription canceled
- Invoice paid
- Invoice payment failed
- Refund completed

Do not send user notifications directly from Stripe webhook handlers. Webhook handlers should update billing state and emit internal events.

## Backward Compatibility Options

### Option A: New Billing Routes Only

- Add `/api/billing/*`.
- Remove old `/api/payments/*` tests or rewrite them.
- Recommended if no production client depends on `/payments/*`.

### Option B: Compatibility Wrapper

- Keep `/api/payments/history` as a wrapper over `/billing/payments`.
- Keep `/api/payments/webhook` temporarily, forwarding to the new webhook handler.
- Deprecate `/api/payments/intent` because the new Checkout flow returns Checkout Session data, not PaymentIntent client secrets.

Recommended: Option A for clean architecture, Option B only if required by frontend compatibility.

## Risks and Mitigations

- Missing source modules block compilation.
  - Mitigation: fix compile baseline before billing.
- Existing migrations use `user_id uuid`, while current `User.id` is integer.
  - Mitigation: design new billing schema against current entity types.
- Historical payments use PaymentIntents directly.
  - Mitigation: use Checkout Sessions for new flows and migrate old data only if needed.
- Webhook body parsing can break signature verification.
  - Mitigation: ensure raw body is used for `/api/billing/webhooks/stripe` and add signature tests.
- Duplicate webhooks can create duplicate transactions.
  - Mitigation: unique Stripe event IDs and transactional handlers.
- Client-side price tampering can undercharge.
  - Mitigation: resolve all prices server-side from `BillingPrice`.
- Stripe live/test key mixups can affect production data.
  - Mitigation: validate key mode against `NODE_ENV` and keep separate envs.
- Reintroducing enterprise entities can slow adoption.
  - Mitigation: keep `BillingAccount`, invoice lines, local discounts, refund tables, and full ledgers out of MVP unless a real project needs them.
- Billing state without entitlements can leave application access inconsistent.
  - Mitigation: make `BillingEntitlementsService` the single access-check API for premium features.
- Local reports can be mistaken for finance-grade revenue reporting.
  - Mitigation: label admin reporting as operational and use Stripe Dashboard for authoritative financial reporting.

## Definition of Done for MVP

- Billing module compiles and is imported by `AppModule`.
- All billing entities are included in TypeORM config.
- Migrations create required billing tables.
- Stripe SDK uses explicit API version and validated config.
- Public plan listing works.
- Customer sync works.
- One-time Checkout Session creation works.
- Subscription Checkout Session creation works.
- Customer Portal session creation works.
- Stripe webhook signature verification works.
- Webhook event persistence and idempotency work.
- Payments, subscriptions, invoice summaries, and lightweight transactions persist locally.
- Refund workflow works through Stripe and creates refund transaction records without a dedicated refund aggregate.
- Entitlements are computed from active billing state and usable by guards/services.
- Minimal admin overview and failed webhook inspection work.
- Minimal audit or structured logs exist for admin-sensitive operations.
- Unit, integration, and e2e tests cover MVP flows with mocked Stripe calls.

## First Execution Checklist

1. Run `pnpm run build` and document current baseline errors.
2. Resolve missing module imports or restore deleted module source.
3. Create `src/billing` skeleton and core shared files.
4. Add billing env validation and Stripe provider updates.
5. Add core entities and migrations.
6. Add Stripe service wrappers with mocks in tests.
7. Implement customer and plan modules.
8. Implement Checkout for one-time payments and subscriptions.
9. Implement verified webhook endpoint and event handlers.
10. Implement invoice summaries, lightweight transactions, refund command, and entitlements.
11. Add minimal admin overview, failed webhook inspection, and replay.
12. Add tests and run `pnpm run build`, `pnpm run test`, and `pnpm run test:e2e`.
