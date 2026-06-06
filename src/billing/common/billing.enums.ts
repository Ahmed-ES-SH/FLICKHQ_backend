/**
 * Status enums for the billing domain.
 *
 * The string values match Stripe's wire format so we can persist them
 * verbatim and avoid lossy translation. New states must be added in
 * both this file and the matching entity column definitions.
 */

/**
 * Local lifecycle for a BillingSubscription. Mapped from the
 * `status` field on Stripe.Subscription, with the addition of
 * `incomplete_expired` (a real Stripe status) and `paused`.
 */
export enum BillingSubscriptionStatus {
  INCOMPLETE = 'incomplete',
  TRIALING = 'trialing',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  UNPAID = 'unpaid',
  PAUSED = 'paused',
  INCOMPLETE_EXPIRED = 'incomplete_expired',
}

/**
 * Local lifecycle for a BillingPayment. Tracks Checkout progress and
 * post-payment status, including refund aggregates that the plan folds
 * into this single table.
 */
export enum BillingPaymentStatus {
  CHECKOUT_CREATED = 'checkout_created',
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELED = 'canceled',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
}

/**
 * Stripe invoice status. Persisted on BillingInvoice.
 */
export enum BillingInvoiceStatus {
  DRAFT = 'draft',
  OPEN = 'open',
  PAID = 'paid',
  VOID = 'void',
  UNCOLLECTIBLE = 'uncollectible',
}

/**
 * Lifecycle for a lightweight BillingTransaction. Refunds are stored
 * as transactions of type `refund`; the dedicated BillingRefund
 * table is intentionally out of scope for the MVP.
 */
export enum BillingTransactionType {
  CHARGE = 'charge',
  REFUND = 'refund',
}

export enum BillingTransactionStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

/**
 * Status for the local webhook event record. Drives idempotent
 * processing and admin/replay tooling.
 */
export enum BillingWebhookEventStatus {
  RECEIVED = 'received',
  PROCESSED = 'processed',
  FAILED = 'failed',
  IGNORED = 'ignored',
}

/**
 * Status for an idempotency key. The unique constraint on `key` is
 * the primary correctness guarantee; the status field lets us serve
 * cached results on retries.
 */
export enum BillingIdempotencyStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

/**
 * Local plan lifecycle.
 */
export enum BillingPlanStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

/**
 * What kind of price Stripe expects. Drives Checkout Session mode
 * selection and validation in the service layer.
 */
export enum BillingPriceType {
  ONE_TIME = 'one_time',
  RECURRING = 'recurring',
}

/**
 * Stripe recurring intervals. Mirrors Stripe.Price.Recurring.Interval.
 */
export enum BillingRecurringInterval {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

/**
 * Source of a granted entitlement. Computed from local billing state
 * — never written directly by user-facing controllers.
 */
export enum BillingEntitlementSourceType {
  SUBSCRIPTION = 'subscription',
  ONE_TIME_PAYMENT = 'one_time_payment',
  MANUAL = 'manual',
}
