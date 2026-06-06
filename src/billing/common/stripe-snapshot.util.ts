/**
 * Stripe → local entity snapshot adapters for the webhook pipeline.
 *
 * The Stripe SDK ships many deeply-nested object types whose names
 * and shapes vary across versions. To keep the webhook service
 * decoupled from any one version we accept structural "snapshot"
 * types here (the same pattern `BillingCustomerService` already
 * uses) and produce the column shapes our entities expect.
 *
 * Responsibilities:
 *
 * - Define narrow structural types for the Stripe objects we
 *   consume from webhooks (Checkout.Session, Subscription,
 *   PaymentIntent, Charge, Refund, Invoice, Customer).
 * - Map Stripe status strings to our local enums
 *   (BillingSubscriptionStatus, BillingPaymentStatus,
 *   BillingInvoiceStatus, BillingTransactionStatus).
 * - Convert Stripe's epoch-second timestamps to JS `Date` values.
 * - Extract the local UUIDs we buried in `metadata` /
 *   `subscription_data.metadata` at checkout time.
 *
 * No I/O, no Nest dependencies — pure functions, easy to unit-test.
 */

import {
  BillingInvoiceStatus,
  BillingPaymentStatus,
  BillingSubscriptionStatus,
  BillingTransactionStatus,
} from './billing.enums';

// ─────────────────────────────────────────────────────────────────────
// Structural types — the minimum we need from each Stripe object.
// ─────────────────────────────────────────────────────────────────────

/**
 * Local-id keys we set in `session.metadata` and
 * `subscription_data.metadata` at checkout time. Centralized so the
 * webhook service and the checkout service agree on the same names.
 */
export const BILLING_METADATA_KEYS = {
  LOCAL_PAYMENT_ID: 'localPaymentId',
  LOCAL_SUBSCRIPTION_ID: 'localSubscriptionId',
  LOCAL_PRICE_ID: 'localPriceId',
  BILLING_CUSTOMER_ID: 'billingCustomerId',
  USER_ID: 'userId',
} as const;

export interface StripeMetadataRecord {
  [key: string]: string | number | boolean | null | undefined;
}

export interface StripeCheckoutSessionSnapshot {
  id: string;
  mode: string;
  customer?: string | StripeCustomerSnapshot | null;
  payment_intent?: string | null;
  payment_status?: string | null;
  subscription?: string | StripeSubscriptionSnapshot | null;
  amount_total?: number | null;
  amount_subtotal?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  metadata?: StripeMetadataRecord | null;
  expires_at?: number | null;
  status?: string | null;
}

export interface StripeSubscriptionSnapshot {
  id: string;
  status: string;
  customer?: string | StripeCustomerSnapshot | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  trial_end?: number | null;
  cancel_at_period_end?: boolean | null;
  canceled_at?: number | null;
  latest_invoice?: string | StripeInvoiceSnapshot | null;
  metadata?: StripeMetadataRecord | null;
  items?: {
    data?: Array<{
      price?: { id?: string | null } | null;
    }>;
  } | null;
}

export interface StripePaymentIntentSnapshot {
  id: string;
  amount?: number | null;
  amount_received?: number | null;
  currency?: string | null;
  status?: string | null;
  customer?: string | StripeCustomerSnapshot | null;
  payment_method_types?: string[] | null;
  metadata?: StripeMetadataRecord | null;
  last_payment_error?: { message?: string | null } | null;
  latest_charge?: string | null;
  invoice?: string | null;
}

export interface StripeChargeSnapshot {
  id: string;
  amount?: number | null;
  amount_refunded?: number | null;
  currency?: string | null;
  status?: string | null;
  paid?: boolean | null;
  refunded?: boolean | null;
  customer?: string | StripeCustomerSnapshot | null;
  payment_intent?: string | null;
  invoice?: string | null;
  metadata?: StripeMetadataRecord | null;
  /**
   * Expanded refunds collection. Only present when the charge is
   * expanded via `?expand[]=data.refund` on the webhook payload.
   */
  refunds?: { data?: StripeRefundSnapshot[] } | null;
}

export interface StripeRefundSnapshot {
  id: string;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
  reason?: string | null;
  charge?: string | StripeChargeSnapshot | null;
  payment_intent?: string | null;
  metadata?: StripeMetadataRecord | null;
}

export interface StripeInvoiceSnapshot {
  id: string;
  status?: string | null;
  currency?: string | null;
  subtotal?: number | null;
  total?: number | null;
  amount_paid?: number | null;
  amount_due?: number | null;
  amount_remaining?: number | null;
  customer?: string | StripeCustomerSnapshot | null;
  subscription?: string | null;
  payment_intent?: string | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  number?: string | null;
  period_start?: number | null;
  period_end?: number | null;
  paid_at?: number | null;
  created?: number | null;
  metadata?: StripeMetadataRecord | null;
}

export interface StripeCustomerSnapshot {
  id: string;
  email?: string | null;
  name?: string | null;
  metadata?: Record<string, string | null> | null;
}

// ─────────────────────────────────────────────────────────────────────
// Local-id extraction
// ─────────────────────────────────────────────────────────────────────

export interface LocalBillingIds {
  localPaymentId: string | null;
  localSubscriptionId: string | null;
  localPriceId: string | null;
  billingCustomerId: string | null;
  userId: number | null;
}

/**
 * Pull the local ids we set in `metadata` at checkout time out of an
 * arbitrary metadata record. Returns nulls for any missing key — the
 * caller decides whether absence is an error.
 */
export function extractLocalBillingIds(
  metadata: StripeMetadataRecord | null | undefined,
): LocalBillingIds {
  if (!metadata) {
    return {
      localPaymentId: null,
      localSubscriptionId: null,
      localPriceId: null,
      billingCustomerId: null,
      userId: null,
    };
  }

  const userIdRaw = metadata[BILLING_METADATA_KEYS.USER_ID];
  let userId: number | null = null;
  if (typeof userIdRaw === 'string' && userIdRaw.length > 0) {
    const parsed = Number.parseInt(userIdRaw, 10);
    if (Number.isFinite(parsed)) {
      userId = parsed;
    }
  } else if (typeof userIdRaw === 'number' && Number.isFinite(userIdRaw)) {
    userId = userIdRaw;
  }

  return {
    localPaymentId: asString(metadata[BILLING_METADATA_KEYS.LOCAL_PAYMENT_ID]),
    localSubscriptionId: asString(
      metadata[BILLING_METADATA_KEYS.LOCAL_SUBSCRIPTION_ID],
    ),
    localPriceId: asString(metadata[BILLING_METADATA_KEYS.LOCAL_PRICE_ID]),
    billingCustomerId: asString(
      metadata[BILLING_METADATA_KEYS.BILLING_CUSTOMER_ID],
    ),
    userId,
  };
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0) return null;
  return value;
}

// ─────────────────────────────────────────────────────────────────────
// Time helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert a Stripe epoch-seconds value to a JS `Date`. Returns null
 * for missing / non-finite inputs so the entity column can be
 * nullable.
 */
export function epochSecondsToDate(
  value: number | null | undefined,
): Date | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  return new Date(value * 1000);
}

// ─────────────────────────────────────────────────────────────────────
// Status mapping
// ─────────────────────────────────────────────────────────────────────

/**
 * Map a Stripe `Subscription.status` string to the local enum. We
 * treat any unknown value as a transient state and fall back to
 * `incomplete` — the subscription row will be corrected on the next
 * status update from Stripe.
 */
export function toBillingSubscriptionStatus(
  status: string | null | undefined,
): BillingSubscriptionStatus {
  if (!status) return BillingSubscriptionStatus.INCOMPLETE;
  const candidate = Object.values(BillingSubscriptionStatus).find(
    (v) => (v as string) === status,
  );
  return candidate ?? BillingSubscriptionStatus.INCOMPLETE;
}

/**
 * Map a Stripe `PaymentIntent.status` to our local `BillingPayment`
 * lifecycle. We also accept the checkout-flow statuses Stripe emits
 * on `checkout.session.payment_status`.
 */
export function toBillingPaymentStatus(
  status: string | null | undefined,
): BillingPaymentStatus {
  if (!status) return BillingPaymentStatus.PENDING;
  switch (status) {
    case 'succeeded':
    case 'paid':
      return BillingPaymentStatus.SUCCEEDED;
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
    case 'requires_capture':
    case 'processing':
    case 'in_progress':
      return BillingPaymentStatus.PENDING;
    case 'canceled':
    case 'cancelled':
      return BillingPaymentStatus.CANCELED;
    case 'failed':
    case 'unpaid':
      return BillingPaymentStatus.FAILED;
    case 'refunded':
      return BillingPaymentStatus.REFUNDED;
    case 'partially_refunded':
      return BillingPaymentStatus.PARTIALLY_REFUNDED;
    default:
      return BillingPaymentStatus.PENDING;
  }
}

/**
 * Map a Stripe `Invoice.status` to our local enum.
 */
export function toBillingInvoiceStatus(
  status: string | null | undefined,
): BillingInvoiceStatus {
  if (!status) return BillingInvoiceStatus.DRAFT;
  const candidate = Object.values(BillingInvoiceStatus).find(
    (v) => (v as string) === status,
  );
  return candidate ?? BillingInvoiceStatus.DRAFT;
}

/**
 * Map a Stripe `Refund.status` (or `Charge.refunded` boolean) to a
 * transaction status. Refunds that are still pending or have failed
 * are persisted as such so support can see them.
 */
export function toBillingTransactionStatus(
  status: string | null | undefined,
): BillingTransactionStatus {
  if (!status) return BillingTransactionStatus.PENDING;
  switch (status) {
    case 'succeeded':
      return BillingTransactionStatus.SUCCEEDED;
    case 'failed':
    case 'canceled':
    case 'cancelled':
      return BillingTransactionStatus.FAILED;
    case 'pending':
    case 'requires_action':
    default:
      return BillingTransactionStatus.PENDING;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Snapshot normalizers
// ─────────────────────────────────────────────────────────────────────

/**
 * Coerce a Stripe customer field to its id string. The field can be
 * either a string (id only) or an expanded `Stripe.Customer` object.
 */
export function customerIdOf(
  value: string | StripeCustomerSnapshot | null | undefined,
): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.id;
}

/**
 * Coerce a Stripe subscription field to its id string.
 */
export function subscriptionIdOf(
  value: string | StripeSubscriptionSnapshot | null | undefined,
): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.id;
}

/**
 * Coerce a Stripe charge field to its id string.
 */
export function chargeIdOf(
  value: string | StripeChargeSnapshot | null | undefined,
): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.id;
}

/**
 * Coerce a Stripe invoice field to its id string.
 */
export function invoiceIdOf(
  value: string | StripeInvoiceSnapshot | null | undefined,
): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.id;
}

/**
 * Reduce a `Stripe.Invoice` snapshot to a plain JSON snapshot we can
 * stash in `BillingInvoice.stripe_snapshot` for support / debugging.
 * Strips the `metadata` field (we never round-trip our own ids) and
 * limits depth to two levels.
 */
export function invoiceSnapshotToStorable(
  invoice: StripeInvoiceSnapshot,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: invoice.id,
    status: invoice.status ?? null,
    currency: invoice.currency ?? null,
    subtotal: invoice.subtotal ?? 0,
    total: invoice.total ?? 0,
    amount_paid: invoice.amount_paid ?? 0,
    amount_due: invoice.amount_due ?? 0,
    number: invoice.number ?? null,
    customer: customerIdOf(invoice.customer ?? null),
    subscription: invoice.subscription ?? null,
    payment_intent: invoice.payment_intent ?? null,
    hosted_invoice_url: invoice.hosted_invoice_url ?? null,
    invoice_pdf: invoice.invoice_pdf ?? null,
    period_start: invoice.period_start ?? null,
    period_end: invoice.period_end ?? null,
    paid_at: invoice.paid_at ?? null,
    created: invoice.created ?? null,
  };
  return out;
}
