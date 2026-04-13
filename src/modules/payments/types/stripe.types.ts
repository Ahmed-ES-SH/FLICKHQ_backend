/**
 * Stripe type definitions for webhooks
 * Using simplified interface approach for stripe v22+
 */

/**
 * PaymentIntent from Stripe webhook event
 * Only includes fields we actually use - all optional for flexibility
 */
export interface StripePaymentIntent {
  id: string;
  object: 'payment_intent';
  status?: string;
  metadata?: Record<string, string>;
  latest_charge?: string | null;
  last_payment_error?: {
    message?: string;
  };
  payment_intent?: string;
  refunded?: boolean;
}

/**
 * Charge from Stripe webhook event
 * Only includes fields we actually use - all optional for flexibility
 */
export interface StripeCharge {
  id: string;
  object: 'charge';
  payment_intent?: string;
  refunded?: boolean;
  status?: string;
  metadata?: Record<string, string>;
  latest_charge?: string | null;
  last_payment_error?: {
    message?: string;
  };
}

/**
 * Webhook event type
 */
export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: StripePaymentIntent | StripeCharge;
  };
}

/**
 * Type guard for PaymentIntent
 */
export function isPaymentIntent(
  obj: StripePaymentIntent | StripeCharge,
): obj is StripePaymentIntent {
  return 'object' in obj && obj.object === 'payment_intent';
}

/**
 * Type guard for Charge
 */
export function isCharge(
  obj: StripePaymentIntent | StripeCharge,
): obj is StripeCharge {
  return 'object' in obj && obj.object === 'charge';
}
