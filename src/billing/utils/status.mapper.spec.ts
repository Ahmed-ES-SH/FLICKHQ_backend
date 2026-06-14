import { mapStripeStatus } from './status.mapper';
import { SubscriptionStatus } from '../user-subscription.entity';

describe('mapStripeStatus', () => {
  it('maps "incomplete" → INCOMPLETE', () => {
    expect(mapStripeStatus('incomplete')).toBe(SubscriptionStatus.INCOMPLETE);
  });

  it('maps "trialing" → TRIALING', () => {
    expect(mapStripeStatus('trialing')).toBe(SubscriptionStatus.TRIALING);
  });

  it('maps "active" → ACTIVE', () => {
    expect(mapStripeStatus('active')).toBe(SubscriptionStatus.ACTIVE);
  });

  it('maps "past_due" → PAST_DUE', () => {
    expect(mapStripeStatus('past_due')).toBe(SubscriptionStatus.PAST_DUE);
  });

  it('maps "canceled" → CANCELED', () => {
    expect(mapStripeStatus('canceled')).toBe(SubscriptionStatus.CANCELED);
  });

  it('maps "unpaid" → UNPAID', () => {
    expect(mapStripeStatus('unpaid')).toBe(SubscriptionStatus.UNPAID);
  });

  it('maps "incomplete_expired" → INCOMPLETE_EXPIRED', () => {
    expect(mapStripeStatus('incomplete_expired')).toBe(
      SubscriptionStatus.INCOMPLETE_EXPIRED,
    );
  });

  it('returns INCOMPLETE for an unknown status string', () => {
    expect(mapStripeStatus('bogus_status')).toBe(SubscriptionStatus.INCOMPLETE);
  });

  it('returns INCOMPLETE for an empty string', () => {
    expect(mapStripeStatus('')).toBe(SubscriptionStatus.INCOMPLETE);
  });
});
