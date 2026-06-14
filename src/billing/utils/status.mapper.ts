import { SubscriptionStatus } from '../user-subscription.entity';

/**
 * Maps a Stripe subscription status string to the local SubscriptionStatus enum.
 * Used by both BillingService and WebhookController.
 */
export function mapStripeStatus(stripeStatus: string): SubscriptionStatus {
  const map: Record<string, SubscriptionStatus> = {
    incomplete: SubscriptionStatus.INCOMPLETE,
    trialing: SubscriptionStatus.TRIALING,
    active: SubscriptionStatus.ACTIVE,
    past_due: SubscriptionStatus.PAST_DUE,
    canceled: SubscriptionStatus.CANCELED,
    unpaid: SubscriptionStatus.UNPAID,
    incomplete_expired: SubscriptionStatus.INCOMPLETE_EXPIRED,
  };
  return map[stripeStatus] ?? SubscriptionStatus.INCOMPLETE;
}
