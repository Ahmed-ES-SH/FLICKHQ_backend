/**
 * Unit tests for the Stripe snapshot utility functions in
 * `stripe-snapshot.util.ts`. These are pure functions — no I/O,
 * no NestJS DI — so the test setup is minimal.
 */

import {
  toBillingSubscriptionStatus,
  toBillingPaymentStatus,
  toBillingInvoiceStatus,
  toBillingTransactionStatus,
  epochSecondsToDate,
  extractLocalBillingIds,
  customerIdOf,
  subscriptionIdOf,
  chargeIdOf,
  invoiceIdOf,
  invoiceSnapshotToStorable,
} from './stripe-snapshot.util';

import {
  BillingSubscriptionStatus,
  BillingPaymentStatus,
  BillingInvoiceStatus,
  BillingTransactionStatus,
} from './billing.enums';

// ─────────────────────────────────────────────────────────────────
// toBillingSubscriptionStatus
// ─────────────────────────────────────────────────────────────────

describe('toBillingSubscriptionStatus', () => {
  it('maps known Stripe statuses to the local enum', () => {
    expect(toBillingSubscriptionStatus('incomplete')).toBe(
      BillingSubscriptionStatus.INCOMPLETE,
    );
    expect(toBillingSubscriptionStatus('trialing')).toBe(
      BillingSubscriptionStatus.TRIALING,
    );
    expect(toBillingSubscriptionStatus('active')).toBe(
      BillingSubscriptionStatus.ACTIVE,
    );
    expect(toBillingSubscriptionStatus('past_due')).toBe(
      BillingSubscriptionStatus.PAST_DUE,
    );
    expect(toBillingSubscriptionStatus('canceled')).toBe(
      BillingSubscriptionStatus.CANCELED,
    );
    expect(toBillingSubscriptionStatus('unpaid')).toBe(
      BillingSubscriptionStatus.UNPAID,
    );
    expect(toBillingSubscriptionStatus('paused')).toBe(
      BillingSubscriptionStatus.PAUSED,
    );
    expect(toBillingSubscriptionStatus('incomplete_expired')).toBe(
      BillingSubscriptionStatus.INCOMPLETE_EXPIRED,
    );
  });

  it('falls back to INCOMPLETE for null / undefined', () => {
    expect(toBillingSubscriptionStatus(null)).toBe(
      BillingSubscriptionStatus.INCOMPLETE,
    );
    expect(toBillingSubscriptionStatus(undefined)).toBe(
      BillingSubscriptionStatus.INCOMPLETE,
    );
  });

  it('falls back to INCOMPLETE for unknown status strings', () => {
    expect(toBillingSubscriptionStatus('some_future_status')).toBe(
      BillingSubscriptionStatus.INCOMPLETE,
    );
    expect(toBillingSubscriptionStatus('all_good')).toBe(
      BillingSubscriptionStatus.INCOMPLETE,
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// toBillingPaymentStatus
// ─────────────────────────────────────────────────────────────────

describe('toBillingPaymentStatus', () => {
  it('maps "succeeded" and "paid" to SUCCEEDED', () => {
    expect(toBillingPaymentStatus('succeeded')).toBe(
      BillingPaymentStatus.SUCCEEDED,
    );
    expect(toBillingPaymentStatus('paid')).toBe(BillingPaymentStatus.SUCCEEDED);
  });

  it('maps pending-like statuses to PENDING', () => {
    const pendingStatuses = [
      'requires_payment_method',
      'requires_confirmation',
      'requires_action',
      'requires_capture',
      'processing',
      'in_progress',
    ];
    for (const s of pendingStatuses) {
      expect(toBillingPaymentStatus(s)).toBe(BillingPaymentStatus.PENDING);
    }
  });

  it('maps "canceled" / "cancelled" to CANCELED', () => {
    expect(toBillingPaymentStatus('canceled')).toBe(
      BillingPaymentStatus.CANCELED,
    );
    expect(toBillingPaymentStatus('cancelled')).toBe(
      BillingPaymentStatus.CANCELED,
    );
  });

  it('maps "failed" / "unpaid" to FAILED', () => {
    expect(toBillingPaymentStatus('failed')).toBe(BillingPaymentStatus.FAILED);
    expect(toBillingPaymentStatus('unpaid')).toBe(BillingPaymentStatus.FAILED);
  });

  it('maps "refunded" and "partially_refunded" correctly', () => {
    expect(toBillingPaymentStatus('refunded')).toBe(
      BillingPaymentStatus.REFUNDED,
    );
    expect(toBillingPaymentStatus('partially_refunded')).toBe(
      BillingPaymentStatus.PARTIALLY_REFUNDED,
    );
  });

  it('falls back to PENDING for null / undefined / unknown', () => {
    expect(toBillingPaymentStatus(null)).toBe(BillingPaymentStatus.PENDING);
    expect(toBillingPaymentStatus(undefined)).toBe(
      BillingPaymentStatus.PENDING,
    );
    expect(toBillingPaymentStatus('unknown_thing')).toBe(
      BillingPaymentStatus.PENDING,
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// toBillingInvoiceStatus
// ─────────────────────────────────────────────────────────────────

describe('toBillingInvoiceStatus', () => {
  it('maps known Stripe invoice statuses', () => {
    expect(toBillingInvoiceStatus('draft')).toBe(BillingInvoiceStatus.DRAFT);
    expect(toBillingInvoiceStatus('open')).toBe(BillingInvoiceStatus.OPEN);
    expect(toBillingInvoiceStatus('paid')).toBe(BillingInvoiceStatus.PAID);
    expect(toBillingInvoiceStatus('void')).toBe(BillingInvoiceStatus.VOID);
    expect(toBillingInvoiceStatus('uncollectible')).toBe(
      BillingInvoiceStatus.UNCOLLECTIBLE,
    );
  });

  it('falls back to DRAFT for null / undefined / unknown', () => {
    expect(toBillingInvoiceStatus(null)).toBe(BillingInvoiceStatus.DRAFT);
    expect(toBillingInvoiceStatus(undefined)).toBe(BillingInvoiceStatus.DRAFT);
    expect(toBillingInvoiceStatus('unknown')).toBe(BillingInvoiceStatus.DRAFT);
  });
});

// ─────────────────────────────────────────────────────────────────
// toBillingTransactionStatus
// ─────────────────────────────────────────────────────────────────

describe('toBillingTransactionStatus', () => {
  it('maps "succeeded" to SUCCEEDED', () => {
    expect(toBillingTransactionStatus('succeeded')).toBe(
      BillingTransactionStatus.SUCCEEDED,
    );
  });

  it('maps "failed" / "canceled" / "cancelled" to FAILED', () => {
    expect(toBillingTransactionStatus('failed')).toBe(
      BillingTransactionStatus.FAILED,
    );
    expect(toBillingTransactionStatus('canceled')).toBe(
      BillingTransactionStatus.FAILED,
    );
    expect(toBillingTransactionStatus('cancelled')).toBe(
      BillingTransactionStatus.FAILED,
    );
  });

  it('maps pending / requires_action to PENDING', () => {
    expect(toBillingTransactionStatus('pending')).toBe(
      BillingTransactionStatus.PENDING,
    );
    expect(toBillingTransactionStatus('requires_action')).toBe(
      BillingTransactionStatus.PENDING,
    );
  });

  it('falls back to PENDING for null / undefined / unknown', () => {
    expect(toBillingTransactionStatus(null)).toBe(
      BillingTransactionStatus.PENDING,
    );
    expect(toBillingTransactionStatus(undefined)).toBe(
      BillingTransactionStatus.PENDING,
    );
    expect(toBillingTransactionStatus('unknown')).toBe(
      BillingTransactionStatus.PENDING,
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// epochSecondsToDate
// ─────────────────────────────────────────────────────────────────

describe('epochSecondsToDate', () => {
  it('converts a valid epoch seconds value to Date', () => {
    const result = epochSecondsToDate(1_700_000_000);
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBe(1_700_000_000 * 1000);
  });

  it('returns null for null / undefined', () => {
    expect(epochSecondsToDate(null)).toBeNull();
    expect(epochSecondsToDate(undefined)).toBeNull();
  });

  it('returns null for NaN and Infinity', () => {
    expect(epochSecondsToDate(NaN)).toBeNull();
    expect(epochSecondsToDate(Infinity)).toBeNull();
    expect(epochSecondsToDate(-Infinity)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// extractLocalBillingIds
// ─────────────────────────────────────────────────────────────────

describe('extractLocalBillingIds', () => {
  it('extracts all ids from a full metadata record', () => {
    const result = extractLocalBillingIds({
      localPaymentId: 'pay-1',
      localSubscriptionId: 'sub-1',
      localPriceId: 'price-1',
      billingCustomerId: 'cust-1',
      userId: '42',
    });
    expect(result.localPaymentId).toBe('pay-1');
    expect(result.localSubscriptionId).toBe('sub-1');
    expect(result.localPriceId).toBe('price-1');
    expect(result.billingCustomerId).toBe('cust-1');
    expect(result.userId).toBe(42);
  });

  it('parses userId from a number', () => {
    const result = extractLocalBillingIds({
      userId: 99,
    });
    expect(result.userId).toBe(99);
  });

  it('returns nulls for empty / missing metadata', () => {
    const result = extractLocalBillingIds({});
    expect(result.localPaymentId).toBeNull();
    expect(result.localSubscriptionId).toBeNull();
    expect(result.localPriceId).toBeNull();
    expect(result.billingCustomerId).toBeNull();
    expect(result.userId).toBeNull();
  });

  it('returns nulls when metadata is null', () => {
    const result = extractLocalBillingIds(null);
    expect(result.localPaymentId).toBeNull();
    expect(result.userId).toBeNull();
  });

  it('returns nulls when metadata is undefined', () => {
    const result = extractLocalBillingIds(undefined);
    expect(result.localPaymentId).toBeNull();
    expect(result.userId).toBeNull();
  });

  it('handles empty string values as null', () => {
    const result = extractLocalBillingIds({ localPaymentId: '' });
    expect(result.localPaymentId).toBeNull();
  });

  it('returns null userId for non-numeric strings', () => {
    const result = extractLocalBillingIds({ userId: 'abc' });
    expect(result.userId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// customerIdOf
// ─────────────────────────────────────────────────────────────────

describe('customerIdOf', () => {
  it('returns the string when given a string', () => {
    expect(customerIdOf('cus_1')).toBe('cus_1');
  });

  it('extracts the id when given an object', () => {
    expect(customerIdOf({ id: 'cus_obj_1' })).toBe('cus_obj_1');
  });

  it('returns null for null / undefined', () => {
    expect(customerIdOf(null)).toBeNull();
    expect(customerIdOf(undefined)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// subscriptionIdOf
// ─────────────────────────────────────────────────────────────────

describe('subscriptionIdOf', () => {
  it('returns the string when given a string', () => {
    expect(subscriptionIdOf('sub_1')).toBe('sub_1');
  });

  it('extracts the id when given an object', () => {
    expect(subscriptionIdOf({ id: 'sub_obj_1', status: 'active' })).toBe('sub_obj_1');
  });

  it('returns null for null / undefined', () => {
    expect(subscriptionIdOf(null)).toBeNull();
    expect(subscriptionIdOf(undefined)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// chargeIdOf
// ─────────────────────────────────────────────────────────────────

describe('chargeIdOf', () => {
  it('returns the string when given a string', () => {
    expect(chargeIdOf('ch_1')).toBe('ch_1');
  });

  it('extracts the id when given an object', () => {
    expect(chargeIdOf({ id: 'ch_obj_1' })).toBe('ch_obj_1');
  });

  it('returns null for null / undefined', () => {
    expect(chargeIdOf(null)).toBeNull();
    expect(chargeIdOf(undefined)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// invoiceIdOf
// ─────────────────────────────────────────────────────────────────

describe('invoiceIdOf', () => {
  it('returns the string when given a string', () => {
    expect(invoiceIdOf('in_1')).toBe('in_1');
  });

  it('extracts the id when given an object', () => {
    expect(invoiceIdOf({ id: 'in_obj_1' })).toBe('in_obj_1');
  });

  it('returns null for null / undefined', () => {
    expect(invoiceIdOf(null)).toBeNull();
    expect(invoiceIdOf(undefined)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// invoiceSnapshotToStorable
// ─────────────────────────────────────────────────────────────────

describe('invoiceSnapshotToStorable', () => {
  it('returns a flat object with the expected fields', () => {
    const result = invoiceSnapshotToStorable({
      id: 'in_1',
      status: 'paid',
      currency: 'usd',
      subtotal: 900,
      total: 1000,
      amount_paid: 1000,
      amount_due: 0,
      number: 'INV-0001',
      customer: 'cus_1',
      subscription: 'sub_1',
      payment_intent: 'pi_1',
      hosted_invoice_url: 'https://invoice.stripe.com/i/in_1',
      invoice_pdf: 'https://invoice.stripe.com/i/in_1.pdf',
      period_start: 1_700_000_000,
      period_end: 1_700_604_800,
      paid_at: 1_700_000_100,
      created: 1_700_000_000,
      metadata: { localPaymentId: 'pay-1' },
    });

    expect(result.id).toBe('in_1');
    expect(result.status).toBe('paid');
    expect(result.currency).toBe('usd');
    expect(result.subtotal).toBe(900);
    expect(result.total).toBe(1000);
    expect(result.amount_paid).toBe(1000);
    expect(result.amount_due).toBe(0);
    expect(result.number).toBe('INV-0001');
    expect(result.customer).toBe('cus_1');
    expect(result.subscription).toBe('sub_1');
    expect(result.payment_intent).toBe('pi_1');
    expect(result.hosted_invoice_url).toBe('https://invoice.stripe.com/i/in_1');
    expect(result.invoice_pdf).toBe('https://invoice.stripe.com/i/in_1.pdf');
    expect(result.period_start).toBe(1_700_000_000);
    expect(result.period_end).toBe(1_700_604_800);
    expect(result.paid_at).toBe(1_700_000_100);
    expect(result.created).toBe(1_700_000_000);
    // The metadata field should NOT appear in the result.
    expect(result).not.toHaveProperty('metadata');
  });

  it('uses defaults for missing fields', () => {
    const result = invoiceSnapshotToStorable({
      id: 'in_default',
      total: 500,
    });
    expect(result.id).toBe('in_default');
    expect(result.status).toBeNull();
    expect(result.currency).toBeNull();
    expect(result.subtotal).toBe(0);
    expect(result.total).toBe(500);
    expect(result.amount_paid).toBe(0);
    expect(result.amount_due).toBe(0);
    expect(result.number).toBeNull();
    expect(result.customer).toBeNull();
    expect(result.subscription).toBeNull();
    expect(result.payment_intent).toBeNull();
    expect(result.hosted_invoice_url).toBeNull();
    expect(result.invoice_pdf).toBeNull();
  });

  it('resolves customer from an object rather than a string', () => {
    const result = invoiceSnapshotToStorable({
      id: 'in_2',
      customer: { id: 'cus_expanded', email: 'test@example.com', name: 'Test' },
      total: 0,
    });
    expect(result.customer).toBe('cus_expanded');
  });
});
