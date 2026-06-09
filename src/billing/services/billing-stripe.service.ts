/**
 * BillingStripeService — the only place in the codebase that talks
 * to the Stripe SDK.
 *
 * Responsibilities:
 *
 * - Owns the singleton Stripe client (resolved from the
 *   `STRIPE_CLIENT` provider defined in `src/config/stripe.config.ts`).
 * - Exposes the raw client to feature services through a single
 *   `getClient()` accessor, with the understanding that callers
 *   should never re-instantiate Stripe on their own.
 * - Provides a `redactSecrets()` helper that strips Stripe keys from
 *   arbitrary input (logs, errors, metadata) before they leave the
 *   process boundary.
 * - Surfaces a typed `constructWebhookEvent()` wrapper that
 *   `BillingWebhookService` uses to verify signatures in Phase 5.
 *   It is included here so that the verification path is colocated
 *   with the SDK client and so the secret-loading logic stays in
 *   one place.
 *
 * Design notes:
 *
 * - The service is intentionally minimal in Phase 1. Higher-level
 *   wrappers (checkout, customer, subscription) live in their own
 *   services (Phases 3-4) and depend on this one.
 * - The constructor never throws if the key is missing; the
 *   `STRIPE_CLIENT` provider does that during app bootstrap so
 *   the failure mode is a clean startup error.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import {
  redactStripeSecrets,
  isWellFormedWebhookSecret,
} from '../../config/stripe.config';
import type { StripeInstance } from '../../config/stripe.config';
import {
  BillingError,
  StripeSignatureVerificationFailedError,
} from '../common/billing.errors';

export const STRIPE_CLIENT = 'STRIPE_CLIENT';

/**
 * Convenience alias for the Stripe webhook event type. Derived from
 * the SDK's `constructEvent` return type so we don't have to import
 * a deep `stripe/resources/Events` path (which the SDK's `exports`
 * field does not allow).
 */
export type StripeWebhookEvent = ReturnType<
  StripeInstance['webhooks']['constructEvent']
>;

@Injectable()
export class BillingStripeService {
  private readonly logger = new Logger(BillingStripeService.name);
  private readonly webhookSecret: string | undefined;

  constructor(
    @Inject(STRIPE_CLIENT) private readonly client: StripeInstance,
    private readonly config: ConfigService,
  ) {
    this.webhookSecret =
      this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? undefined;

    if (this.webhookSecret && !isWellFormedWebhookSecret(this.webhookSecret)) {
      this.logger.warn(
        'STRIPE_WEBHOOK_SECRET does not start with "whsec_". Webhook signature verification may fail.',
      );
    }
  }

  /**
   * Return the configured Stripe client. Callers should not cache
   * the result across transactions, but the client itself is a
   * singleton and is safe to share.
   */
  getClient(): StripeInstance {
    return this.client;
  }

  /**
   * Verify a Stripe webhook signature against a raw request body and
   * return the parsed event. Throws StripeSignatureVerificationFailedError
   * if the signature is missing, malformed, or the secret does not
   * match.
   */
  constructWebhookEvent(
    payload: Buffer | string,
    signature: string,
  ): StripeWebhookEvent {
    if (!this.webhookSecret) {
      throw new BillingError(
        'STRIPE_WEBHOOK_SECRET is not configured; cannot verify webhook signatures.',
      );
    }

    if (!signature) {
      throw new StripeSignatureVerificationFailedError(
        'Missing Stripe-Signature header.',
      );
    }

    const body = this.normalizeWebhookPayload(payload);

    try {
      // `constructEvent` is sync in the Node SDK. The async variant
      // exists for environments with non-blocking crypto; we don't
      // need it here.
      return this.client.webhooks.constructEvent(
        body,
        signature,
        this.webhookSecret,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new StripeSignatureVerificationFailedError(
        `Stripe webhook signature verification failed: ${message}`,
      );
    }
  }

  /**
   * Strip Stripe keys / webhook secrets from any value. Use this
   * before logging raw Stripe errors, request bodies, or
   * application-thrown messages that may include SDK output.
   */
  redactSecrets(input: unknown): string {
    return redactStripeSecrets(input);
  }

  /**
   * Convenience wrapper that wraps an arbitrary Stripe SDK call and
   * redacts the thrown error so secret material cannot leak via
   * exception messages.
   */
  async safeCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      throw this.wrapStripeError(err);
    }
  }

  private wrapStripeError(err: unknown): unknown {
    if (err instanceof Error) {
      err.message = redactStripeSecrets(err.message);
      if ('raw' in err) {
        const raw = (err as { raw?: unknown }).raw;
        if (raw && typeof raw === 'object') {
          (err as { raw: unknown }).raw = this.redactRawStripeError(raw);
        }
      }
      return err;
    }

    return new Error(redactStripeSecrets(err));
  }

  private redactRawStripeError(raw: unknown): unknown {
    try {
      return JSON.parse(redactStripeSecrets(JSON.stringify(raw)));
    } catch {
      return raw;
    }
  }

  private normalizeWebhookPayload(payload: Buffer | string): string | Buffer {
    if (typeof payload === 'string') return payload;
    if (Buffer.isBuffer(payload)) return payload;
    throw new BillingError('Webhook payload must be a string or Buffer.');
  }
}

// Re-export the Stripe class type for downstream services that need
// the static namespace (e.g. for typed response mapping). Use as
// `import type Stripe from 'stripe'` in the consuming file to avoid
// the runtime dependency.
export type { Stripe };
