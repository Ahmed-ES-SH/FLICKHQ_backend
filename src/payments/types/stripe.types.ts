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

export interface StripeCheckoutSession {
  id: string;
  object: 'checkout.session';
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  status: 'open' | 'complete' | 'expired';
  amount_total?: number;
  currency?: string;
  customer?: string;
  payment_intent?: string;
  metadata?: Record<string, string>;
  customer_details?: {
    email?: string;
    address?: {
      country?: string;
    };
  };
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: StripePaymentIntent | StripeCharge | StripeCheckoutSession;
  };
}

export function isPaymentIntent(
  obj: StripePaymentIntent | StripeCharge | StripeCheckoutSession,
): obj is StripePaymentIntent {
  return 'object' in obj && obj.object === 'payment_intent';
}

export function isCharge(
  obj: StripePaymentIntent | StripeCharge | StripeCheckoutSession,
): obj is StripeCharge {
  return 'object' in obj && obj.object === 'charge';
}

export function isCheckoutSession(
  obj: StripePaymentIntent | StripeCharge | StripeCheckoutSession,
): obj is StripeCheckoutSession {
  return 'object' in obj && obj.object === 'checkout.session';
}
