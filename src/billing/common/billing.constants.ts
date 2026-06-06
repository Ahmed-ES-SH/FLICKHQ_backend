/**
 * Constants used across the billing module.
 *
 * - The `BILLING_*_EVENT` strings are the names published to the
 *   internal @nestjs/event-emitter bus. Downstream consumers
 *   (notifications, audit) should listen for these and only these.
 * - Default sizes and limits are intentionally small for a
 *   boilerplate-grade module and can be tuned in config.
 */

export const BILLING_MODULE_NAME = 'billing' as const;

/**
 * Stripe webhook event types handled by the v1 webhook pipeline.
 *
 * Adding an event here is a signal that the corresponding handler
 * is expected to exist on BillingWebhookService. The set is the
 * minimum required to keep local state in sync for Checkout,
 * subscriptions, payments, and invoices.
 */
export const STRIPE_WEBHOOK_EVENT_TYPES = {
  CHECKOUT_SESSION_COMPLETED: 'checkout.session.completed',
  CHECKOUT_SESSION_EXPIRED: 'checkout.session.expired',
  PAYMENT_INTENT_SUCCEEDED: 'payment_intent.succeeded',
  PAYMENT_INTENT_PAYMENT_FAILED: 'payment_intent.payment_failed',
  CHARGE_SUCCEEDED: 'charge.succeeded',
  CHARGE_REFUNDED: 'charge.refunded',
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_SUBSCRIPTION_CREATED: 'customer.subscription.created',
  CUSTOMER_SUBSCRIPTION_UPDATED: 'customer.subscription.updated',
  CUSTOMER_SUBSCRIPTION_DELETED: 'customer.subscription.deleted',
  INVOICE_CREATED: 'invoice.created',
  INVOICE_FINALIZED: 'invoice.finalized',
  INVOICE_PAID: 'invoice.paid',
  INVOICE_PAYMENT_FAILED: 'invoice.payment_failed',
  INVOICE_VOIDED: 'invoice.voided',
  INVOICE_MARKED_UNCOLLECTIBLE: 'invoice.marked_uncollectible',
} as const;

export type StripeWebhookEventType =
  (typeof STRIPE_WEBHOOK_EVENT_TYPES)[keyof typeof STRIPE_WEBHOOK_EVENT_TYPES];

/**
 * Internal event names published via @nestjs/event-emitter. Kept
 * stable so notification/audit consumers can subscribe without
 * needing to know about Stripe's event types directly.
 */
export const BILLING_EVENTS = {
  CUSTOMER_CREATED: 'billing.customer.created',
  CHECKOUT_CREATED: 'billing.checkout.created',
  PAYMENT_SUCCEEDED: 'billing.payment.succeeded',
  PAYMENT_FAILED: 'billing.payment.failed',
  REFUND_SUCCEEDED: 'billing.refund.succeeded',
  SUBSCRIPTION_CREATED: 'billing.subscription.created',
  SUBSCRIPTION_UPDATED: 'billing.subscription.updated',
  SUBSCRIPTION_CANCELED: 'billing.subscription.canceled',
  INVOICE_PAID: 'billing.invoice.paid',
  INVOICE_PAYMENT_FAILED: 'billing.invoice.payment_failed',
  WEBHOOK_FAILED: 'billing.webhook.failed',
} as const;

export type BillingEventName =
  (typeof BILLING_EVENTS)[keyof typeof BILLING_EVENTS];

/**
 * Default TTL for idempotency keys. Stripe webhooks have at-least-once
 * delivery and we want clients to be able to safely retry Checkout /
 * portal creation within a sensible window. 24h mirrors Stripe's own
 * default idempotency window.
 */
export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Default number of pages returned by the public plans listing. The
 * public plans endpoint is intentionally not paginated in v1 — we
 * expect fewer than a dozen plans at most.
 */
export const PUBLIC_PLANS_PAGE_LIMIT = 100;

/**
 * Subscription statuses that grant application feature entitlements.
 *
 * Policy (locked in for Phase 6):
 *
 * - `active`, `trialing`, `past_due` — the customer is being served;
 *   we keep access. `past_due` is the grace period while Stripe
 *   retries the latest invoice.
 * - `paused` — excluded. A paused subscription intentionally
 *   stops serving the user.
 * - `canceled`, `unpaid`, `incomplete`, `incomplete_expired` —
 *   excluded. No entitlement to the underlying plan features.
 *
 * `BillingEntitlementsService.recomputeForUser` uses this set as
 * the membership filter when querying `BillingSubscription` rows.
 */
export const ENTITLEMENT_GRANTING_STATUSES = [
  'active',
  'trialing',
  'past_due',
] as const;

export type EntitlementGrantingStatus =
  (typeof ENTITLEMENT_GRANTING_STATUSES)[number];

/**
 * Metadata key consumed by `FeatureAccessGuard`. Set via
 * `@RequiresFeature('feature_key')` on controller methods or
 * classes. The value is a `string[]` of stable feature keys.
 */
export const REQUIRES_FEATURE_METADATA = 'billing.requiresFeature';

/**
 * Default HTTP path segments used by the controllers. Centralized so
 * tests and clients can derive URLs without hardcoding strings.
 */
export const BILLING_ROUTES = {
  CUSTOMER: 'customer',
  CHECKOUT: 'checkout',
  ONE_TIME: 'one-time',
  SUBSCRIPTION: 'subscription',
  PORTAL: 'portal',
  PAYMENTS: 'payments',
  SUBSCRIPTIONS: 'subscriptions',
  INVOICES: 'invoices',
  TRANSACTIONS: 'transactions',
  ENTITLEMENTS: 'entitlements',
  PLANS: 'plans',
  PUBLIC: 'public',
  WEBHOOKS: 'webhooks',
  STRIPE: 'stripe',
  ADMIN: 'admin',
} as const;

/**
 * Where the Stripe webhook is exposed once the BillingModule is
 * mounted. Used by both the raw-body middleware (main.ts wiring)
 * and the BillingWebhookController route.
 */
export const BILLING_STRIPE_WEBHOOK_PATH = `/api/${BILLING_MODULE_NAME}/${BILLING_ROUTES.WEBHOOKS}/${BILLING_ROUTES.STRIPE}`;
