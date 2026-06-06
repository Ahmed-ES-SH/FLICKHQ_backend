/**
 * Shared Stripe webhook fixture factories for billing module tests.
 *
 * Each function returns a structural snapshot matching the types in
 * `stripe-snapshot.util.ts` — NOT a full `Stripe.Event` object, so
 * tests do not depend on the SDK types. Callers can spread the
 * result and override specific fields for their test case.
 *
 * Usage:
 *
 *   import { checkoutSessionCompletedSnapshot } from './__fixtures__/stripe-webhook.fixtures';
 *
 *   const snapshot = checkoutSessionCompletedSnapshot({
 *     mode: 'subscription',
 *     subscription: 'sub_real_1',
 *   });
 *
 * The `metadata` objects include `localPaymentId` and related keys
 * that the webhook handlers use to match events to local rows.
 */

import type {
  StripeCheckoutSessionSnapshot,
  StripePaymentIntentSnapshot,
  StripeChargeSnapshot,
  StripeRefundSnapshot,
  StripeSubscriptionSnapshot,
  StripeInvoiceSnapshot,
  StripeCustomerSnapshot,
} from '../stripe-snapshot.util';

// ─────────────────────────────────────────────────────────────────
// Shared constants
// ─────────────────────────────────────────────────────────────────

export const FIXTURE_EPOCH = 1_700_000_000;
export const FIXTURE_EPOCH_PLUS_WEEK = 1_700_604_800;
export const FIXTURE_DATE = new Date(FIXTURE_EPOCH * 1000);
export const FIXTURE_DATE_PLUS_WEEK = new Date(FIXTURE_EPOCH_PLUS_WEEK * 1000);

export const DEFAULT_METADATA = {
  localPaymentId: 'pay-fix-1',
  localSubscriptionId: 'sub-fix-1',
  localPriceId: 'price-fix-1',
  billingCustomerId: 'cust-fix-1',
  userId: '42',
};

// ─────────────────────────────────────────────────────────────────
// Customer
// ─────────────────────────────────────────────────────────────────

export function customerSnapshot(
  overrides?: Partial<StripeCustomerSnapshot>,
): StripeCustomerSnapshot {
  return {
    id: 'cus_fixture_1',
    email: 'fixture@example.com',
    name: 'Fixture User',
    metadata: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// Checkout Session
// ─────────────────────────────────────────────────────────────────

export function checkoutSessionCompletedSnapshot(
  overrides?: Partial<StripeCheckoutSessionSnapshot>,
): StripeCheckoutSessionSnapshot {
  return {
    id: 'cs_fixture_1',
    mode: 'payment',
    customer: 'cus_fixture_1',
    payment_intent: 'pi_fixture_1',
    payment_status: 'paid',
    subscription: null,
    amount_total: 2000,
    amount_subtotal: 2000,
    currency: 'usd',
    metadata: { ...DEFAULT_METADATA },
    ...overrides,
  };
}

export function checkoutSessionExpiredSnapshot(
  overrides?: Partial<StripeCheckoutSessionSnapshot>,
): StripeCheckoutSessionSnapshot {
  return {
    ...checkoutSessionCompletedSnapshot({ payment_status: 'unpaid' }),
    id: 'cs_fixture_expired',
    status: 'expired',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// Payment Intent
// ─────────────────────────────────────────────────────────────────

export function paymentIntentSucceededSnapshot(
  overrides?: Partial<StripePaymentIntentSnapshot>,
): StripePaymentIntentSnapshot {
  return {
    id: 'pi_fixture_1',
    amount: 2000,
    amount_received: 2000,
    currency: 'usd',
    status: 'succeeded',
    customer: 'cus_fixture_1',
    latest_charge: 'ch_fixture_1',
    metadata: { ...DEFAULT_METADATA },
    ...overrides,
  };
}

export function paymentIntentFailedSnapshot(
  overrides?: Partial<StripePaymentIntentSnapshot>,
): StripePaymentIntentSnapshot {
  return {
    ...paymentIntentSucceededSnapshot(),
    id: 'pi_fixture_failed',
    status: 'requires_payment_method',
    amount_received: 0,
    last_payment_error: { message: 'card_declined' },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// Charge & Refund
// ─────────────────────────────────────────────────────────────────

export function chargeSnapshot(
  overrides?: Partial<StripeChargeSnapshot>,
): StripeChargeSnapshot {
  return {
    id: 'ch_fixture_1',
    amount: 2000,
    amount_refunded: 0,
    currency: 'usd',
    status: 'succeeded',
    paid: true,
    refunded: false,
    payment_intent: 'pi_fixture_1',
    metadata: null,
    ...overrides,
  };
}

export function chargeRefundedSnapshot(
  refunds?: StripeRefundSnapshot[],
  overrides?: Partial<StripeChargeSnapshot>,
): StripeChargeSnapshot {
  return {
    ...chargeSnapshot(),
    id: 'ch_fixture_refunded',
    amount_refunded: (refunds ?? []).reduce(
      (sum, r) => sum + (r.amount ?? 0),
      0,
    ),
    refunded: true,
    refunds: {
      data: refunds ?? [],
    },
    ...overrides,
  };
}

export function refundSnapshot(
  overrides?: Partial<StripeRefundSnapshot>,
): StripeRefundSnapshot {
  return {
    id: 're_fixture_1',
    amount: 500,
    currency: 'usd',
    status: 'succeeded',
    reason: null,
    payment_intent: 'pi_fixture_1',
    metadata: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// Subscription
// ─────────────────────────────────────────────────────────────────

export function subscriptionCreatedSnapshot(
  overrides?: Partial<StripeSubscriptionSnapshot>,
): StripeSubscriptionSnapshot {
  return {
    id: 'sub_fixture_1',
    status: 'active',
    customer: 'cus_fixture_1',
    current_period_start: FIXTURE_EPOCH,
    current_period_end: FIXTURE_EPOCH_PLUS_WEEK,
    trial_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    latest_invoice: 'in_fixture_1',
    metadata: { ...DEFAULT_METADATA },
    items: {
      data: [{ price: { id: 'price_fixture_1' } }],
    },
    ...overrides,
  };
}

export function subscriptionUpdatedSnapshot(
  overrides?: Partial<StripeSubscriptionSnapshot>,
): StripeSubscriptionSnapshot {
  return {
    ...subscriptionCreatedSnapshot(),
    id: 'sub_fixture_1',
    status: 'past_due',
    ...overrides,
  };
}

export function subscriptionDeletedSnapshot(
  overrides?: Partial<StripeSubscriptionSnapshot>,
): StripeSubscriptionSnapshot {
  return {
    ...subscriptionCreatedSnapshot(),
    id: 'sub_fixture_deleted',
    status: 'canceled',
    canceled_at: FIXTURE_EPOCH,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// Invoice
// ─────────────────────────────────────────────────────────────────

export function invoicePaidSnapshot(
  overrides?: Partial<StripeInvoiceSnapshot>,
): StripeInvoiceSnapshot {
  return {
    id: 'in_fixture_1',
    status: 'paid',
    currency: 'usd',
    subtotal: 2000,
    total: 2000,
    amount_paid: 2000,
    amount_due: 0,
    customer: 'cus_fixture_1',
    subscription: 'sub_fixture_1',
    payment_intent: 'pi_fixture_1',
    hosted_invoice_url: 'https://invoice.stripe.com/i/in_fixture_1',
    invoice_pdf: 'https://invoice.stripe.com/i/in_fixture_1.pdf',
    number: 'INV-0001',
    period_start: FIXTURE_EPOCH,
    period_end: FIXTURE_EPOCH_PLUS_WEEK,
    paid_at: FIXTURE_EPOCH + 100,
    metadata: { ...DEFAULT_METADATA },
    ...overrides,
  };
}

export function invoicePaymentFailedSnapshot(
  overrides?: Partial<StripeInvoiceSnapshot>,
): StripeInvoiceSnapshot {
  return {
    ...invoicePaidSnapshot(),
    id: 'in_fixture_failed',
    status: 'open',
    amount_paid: 0,
    amount_due: 2000,
    paid_at: null,
    ...overrides,
  };
}
