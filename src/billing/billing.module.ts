/**
 * BillingModule — root of the v1 Stripe Billing integration.
 *
 * This module is the single DI boundary for everything billing-related.
 *
 * Phase status (per `src/billing-module-implementation-plan.md`):
 *
 * - Phase 0: compile baseline + scope lock. ✅
 * - Phase 1: skeleton, config, Stripe client. ✅
 * - Phase 2: lean persistence + migration. ✅
 * - Phase 3: customer, catalog, portal. ✅
 * - Phase 4: checkout for one-time and subscription flows. ✅
 * - Phase 5: verified webhook ingestion + local state sync. ✅
 * - Phase 6: entitlements and feature access. ✅
 * - Phase 7: admin / refund support. ✅ (this commit)
 * - Phase 8: tests and hardening.
 *
 * Module boundary rules (enforced by the architecture, not by code):
 *
 * - All Stripe SDK access goes through BillingStripeService.
 * - Controllers do not accept price, currency, amount, or
 *   customer identifiers directly from clients without server-side
 *   lookup. That logic lives in BillingCatalogService and
 *   BillingCustomerService.
 * - Application modules that need to gate features depend on
 *   BillingEntitlementsService, not on Stripe directly. The
 *   `FeatureAccessGuard` + `@RequiresFeature` decorator pair is
 *   exported from this module for that purpose.
 * - Stripe webhooks are mounted at `/api/billing/webhooks/stripe`.
 *   Nest is created with `rawBody: true` (see `src/main.ts`), so the
 *   raw body is available on `req.rawBody` for signature verification
 *   in Phase 5.
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  DEFAULT_STRIPE_API_VERSION,
  StripeProvider,
  isWellFormedWebhookSecret,
} from '../config/stripe.config';
import { UserModule } from '../user/user.module';
import { AuthModule } from '../auth/auth.module';

import { BillingStripeService } from './services/billing-stripe.service';
import { BillingCustomerService } from './services/billing-customer.service';
import { BillingCatalogService } from './services/billing-catalog.service';
import { BillingPortalService } from './services/billing-portal.service';
import { BillingCheckoutService } from './services/billing-checkout.service';
import { BillingIdempotencyService } from './services/billing-idempotency.service';
import { BillingWebhookService } from './services/billing-webhook.service';
import { BillingEntitlementsService } from './services/billing-entitlements.service';
import { BillingAdminService } from './services/billing-admin.service';

import { BillingCustomer } from './entities/billing-customer.entity';
import { BillingPlan } from './entities/billing-plan.entity';
import { BillingPrice } from './entities/billing-price.entity';
import { BillingSubscription } from './entities/billing-subscription.entity';
import { BillingPayment } from './entities/billing-payment.entity';
import { BillingInvoice } from './entities/billing-invoice.entity';
import { BillingTransaction } from './entities/billing-transaction.entity';
import { BillingWebhookEvent } from './entities/billing-webhook-event.entity';
import { BillingIdempotencyKey } from './entities/billing-idempotency-key.entity';
import { BillingEntitlement } from './entities/billing-entitlement.entity';

import { BillingController } from './controllers/billing.controller';
import { BillingAdminController } from './controllers/billing.admin.controller';
import { BillingPublicController } from './controllers/billing.public.controller';
import { StripeWebhookController } from './controllers/stripe-webhook.controller';
import { FeatureAccessGuard } from './guards/feature-access.guard';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      BillingCustomer,
      BillingPlan,
      BillingPrice,
      BillingSubscription,
      BillingPayment,
      BillingInvoice,
      BillingTransaction,
      BillingWebhookEvent,
      BillingIdempotencyKey,
      BillingEntitlement,
    ]),
    UserModule,
    AuthModule,
  ],
  providers: [
    StripeProvider,
    BillingStripeService,
    BillingCustomerService,
    BillingCatalogService,
    BillingPortalService,
    BillingCheckoutService,
    BillingIdempotencyService,
    BillingWebhookService,
    BillingEntitlementsService,
    BillingAdminService,
    FeatureAccessGuard,
  ],
  controllers: [
    BillingController,
    BillingAdminController,
    BillingPublicController,
    StripeWebhookController,
  ],
  exports: [
    BillingStripeService,
    BillingCustomerService,
    BillingCatalogService,
    BillingPortalService,
    BillingCheckoutService,
    BillingIdempotencyService,
    BillingWebhookService,
    BillingEntitlementsService,
    BillingAdminService,
    FeatureAccessGuard,
    StripeProvider,
    TypeOrmModule,
  ],
})
export class BillingModule {
  /**
   * Validate the runtime configuration for the billing module.
   *
   * Called from main.ts / a configuration hook so we can fail fast
   * with a clear error if BillingModule is enabled but env vars are
   * missing. The check is intentionally split from `StripeProvider`
   * so the provider can be unit-tested with mocks.
   */
  static validateConfig(config: ConfigService): readonly string[] {
    const errors: string[] = [];

    const enabled = config.get<string>('BILLING_ENABLED') !== 'false';
    if (!enabled) {
      return errors;
    }

    const nodeEnv = config.get<string>('NODE_ENV') ?? 'development';
    const isTest = nodeEnv === 'test';

    const restricted = config.get<string>('STRIPE_RESTRICTED_KEY');
    const secret = config.get<string>('STRIPE_SECRET_KEY');
    if (!restricted && !secret) {
      errors.push(
        'BillingModule is enabled but no Stripe key is configured. Set STRIPE_RESTRICTED_KEY (preferred) or STRIPE_SECRET_KEY.',
      );
    }

    const webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret && !isTest) {
      errors.push(
        'BillingModule is enabled but STRIPE_WEBHOOK_SECRET is not configured. Webhook signature verification will not work.',
      );
    }
    if (webhookSecret && !isWellFormedWebhookSecret(webhookSecret)) {
      errors.push(
        'STRIPE_WEBHOOK_SECRET must start with "whsec_" (use the value from the Stripe dashboard).',
      );
    }

    const successUrl = config.get<string>('STRIPE_SUCCESS_URL');
    const cancelUrl = config.get<string>('STRIPE_CANCEL_URL');
    const portalReturn = config.get<string>('STRIPE_PORTAL_RETURN_URL');

    if (!successUrl) {
      errors.push(
        'STRIPE_SUCCESS_URL is required for Checkout redirects. Set it to the URL the user lands on after a successful Checkout.',
      );
    }
    if (!cancelUrl) {
      errors.push(
        'STRIPE_CANCEL_URL is required for Checkout redirects. Set it to the URL the user lands on when they cancel Checkout.',
      );
    }
    if (!portalReturn) {
      errors.push(
        'STRIPE_PORTAL_RETURN_URL is required for the Stripe Customer Portal.',
      );
    }

    const apiVersion =
      config.get<string>('STRIPE_API_VERSION') ?? DEFAULT_STRIPE_API_VERSION;
    if (apiVersion !== DEFAULT_STRIPE_API_VERSION) {
      // The plan explicitly pins 2026-05-27.dahlia. Allow override only
      // by setting STRIPE_API_VERSION explicitly — log a warning so the
      // operator knows they are drifting from the plan.

      console.warn(
        `[BillingModule] STRIPE_API_VERSION=${apiVersion} differs from the planned ${DEFAULT_STRIPE_API_VERSION}. Make sure this is intentional.`,
      );
    }

    return errors;
  }
}
