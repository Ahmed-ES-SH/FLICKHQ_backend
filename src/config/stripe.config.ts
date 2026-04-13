/**
 * Stripe Configuration for Flick HQ Backend
 *
 * This file configures the Stripe SDK for payment processing.
 *
 * Required env variables:
 * - STRIPE_SECRET_KEY: Stripe secret key (sk_test_... or sk_live_...)
 *
 * Optional env variables:
 * - STRIPE_WEBHOOK_SECRET: Webhook signing secret (whsec_...)
 *
 * Get your keys from:
 * - API Keys: https://dashboard.stripe.com/apikeys
 * - Webhooks: https://dashboard.stripe.com/webhooks
 */

import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Type alias for Stripe instance
 * Used for proper TypeScript typing throughout the application
 */
export type StripeInstance = ReturnType<typeof Stripe>;

/**
 * Stripe provider configuration
 * - Injected as 'STRIPE_CLIENT' throughout the application
 * - Throws error if STRIPE_SECRET_KEY is not configured
 */
export const StripeProvider = {
  provide: 'STRIPE_CLIENT',

  /**
   * Factory function to create Stripe instance
   * @param configService - NestJS ConfigService for accessing env variables
   * @returns Stripe instance configured with secret key
   * @throws Error if STRIPE_SECRET_KEY is not set
   */
  useFactory: (configService: ConfigService): StripeInstance => {
    const secretKey = configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    return new Stripe(secretKey);
  },

  inject: [ConfigService],
};
