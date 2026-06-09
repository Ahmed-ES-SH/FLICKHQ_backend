/**
 * Payment Pricing Configuration
 *
 * This file defines server-side pricing for premium subscriptions.
 * IMPORTANT: Never trust client-sent amounts - always validate against these prices!
 *
 * All prices are in cents (Stripe format):
 * - 999 = $9.99
 * - 7999 = $79.99
 *
 * This prevents price manipulation attacks where a malicious user
 * could try to modify the payment amount on the client side.
 */

/**
 * Predefined pricing plans
 * These are the ONLY valid prices - no other amounts are accepted
 */
export const PAYMENT_PRICING = {
  /**
   * Premium Monthly Subscription
   * - Price: $9.99/month (999 cents)
   * - Currency: USD
   */
  PREMIUM_MONTHLY: {
    amount: 999, // $9.99 in cents
    currency: 'usd',
    description: 'Premium Monthly Subscription',
    productType: 'premium_monthly',
  },

  /**
   * Premium Yearly Subscription
   * - Price: $79.99/year (7999 cents) - saves ~33%
   * - Currency: USD
   */
  PREMIUM_YEARLY: {
    amount: 7999, // $79.99 in cents
    currency: 'usd',
    description: 'Premium Yearly Subscription',
    productType: 'premium_yearly',
  },
} as const;

/**
 * Type for valid product types
 * Used for type-safe product selection
 */
export type ProductType = keyof typeof PAYMENT_PRICING;

/**
 * Get pricing for a product type
 * @param productType - The product identifier
 * @returns Pricing object or null if invalid product type
 *
 * @example
 * const pricing = getProductPrice('premium_monthly');
 * // Returns: { amount: 999, currency: 'usd', description: '...', productType: 'premium_monthly' }
 */
export const getProductPrice = (
  productType: string,
): (typeof PAYMENT_PRICING)[ProductType] | null => {
  const pricing = PAYMENT_PRICING[productType as ProductType];
  return pricing || null;
};
