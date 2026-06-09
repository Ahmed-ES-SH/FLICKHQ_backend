/**
 * BillingPortalService
 *
 * Creates Stripe-hosted Customer Portal sessions for the
 * authenticated user. Stripe owns the portal UI; we just hand it
 * the customer id and a return URL and Stripe does the rest.
 *
 * The portal is the recommended way to handle:
 *
 * - Updating payment methods
 * - Changing subscription plans
 * - Cancelling / resuming subscriptions
 * - Downloading invoices
 *
 * Phase 3 implemented the read-only "open the portal" flow.
 * Phase 4 wires the `Idempotency-Key` header through
 * `BillingIdempotencyService` so duplicate requests are
 * collapsed and retries are safe.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BillingStripeService } from './billing-stripe.service';
import { BillingCustomerService } from './billing-customer.service';
import { BillingIdempotencyService } from './billing-idempotency.service';
import { BillingCustomerNotFoundError } from '../common/billing.errors';

@Injectable()
export class BillingPortalService {
  private readonly logger = new Logger(BillingPortalService.name);

  constructor(
    private readonly stripeService: BillingStripeService,
    private readonly customerService: BillingCustomerService,
    private readonly idempotencyService: BillingIdempotencyService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Create a Customer Portal session for the given user. The
   * returned URL is short-lived (Stripe recommends a few minutes
   * of validity) and should be redirected to immediately.
   *
   * The `idempotencyKey` is required and is used to collapse
   * duplicate requests. Replays with the same key + same request
   * body return the cached URL; replays with the same key but a
   * different body get a 409.
   */
  async createSessionForUser(
    userId: number,
    idempotencyKey: string,
  ): Promise<{ url: string }> {
    const key = this.idempotencyService.normalizeKey(idempotencyKey);
    const reservation = await this.idempotencyService.reserve({
      key,
      scope: 'portal.session',
      userId,
      request: { userId },
    });
    if (!reservation.fresh && reservation.cachedResponse) {
      return reservation.cachedResponse as { url: string };
    }

    try {
      const customer = await this.customerService.getOrCreateForUser(userId);
      if (!customer) {
        throw new BillingCustomerNotFoundError(userId);
      }

      const returnUrl =
        this.config.get<string>('STRIPE_PORTAL_RETURN_URL') ??
        this.config.get<string>('STRIPE_SUCCESS_URL') ??
        '';

      if (!returnUrl) {
        throw new Error(
          'STRIPE_PORTAL_RETURN_URL (or STRIPE_SUCCESS_URL) is not configured.',
        );
      }

      const session = await this.stripeService.safeCall(() =>
        this.stripeService.getClient().billingPortal.sessions.create({
          customer: customer.stripeCustomerId,
          return_url: returnUrl,
        }),
      );

      this.logger.log(
        `Portal session created for user ${userId} (customer ${customer.stripeCustomerId})`,
      );

      const result = { url: session.url };
      await this.idempotencyService.recordSuccess(key, result);
      return result;
    } catch (err) {
      await this.idempotencyService.recordFailure(key);
      throw err;
    }
  }
}
