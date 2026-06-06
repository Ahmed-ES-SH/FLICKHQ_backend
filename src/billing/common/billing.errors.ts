/**
 * Domain-specific error types used by the billing module.
 *
 * These all extend NestJS `HttpException` (where appropriate) so the
 * global exception filter translates them into clean HTTP responses,
 * but they preserve a stable identity for `instanceof` checks inside
 * services and tests.
 */

import { HttpException, HttpStatus } from '@nestjs/common';

export class BillingError extends HttpException {
  constructor(message: string, status: HttpStatus = HttpStatus.BAD_REQUEST) {
    super(message, status);
  }
}

export class StripeSignatureVerificationFailedError extends BillingError {
  constructor(message = 'Stripe signature verification failed') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

export class BillingCustomerNotFoundError extends BillingError {
  constructor(userId: number) {
    super(
      `No billing customer exists for user ${userId}.`,
      HttpStatus.NOT_FOUND,
    );
  }
}

export class BillingPriceNotActiveError extends BillingError {
  constructor(priceId: string) {
    super(
      `Billing price ${priceId} is not active and cannot be sold.`,
      HttpStatus.CONFLICT,
    );
  }
}

export class BillingPriceCurrencyMismatchError extends BillingError {
  constructor(expected: string, actual: string) {
    super(
      `Billing price currency ${actual} does not match expected ${expected}.`,
      HttpStatus.CONFLICT,
    );
  }
}

export class BillingIdempotencyConflictError extends BillingError {
  constructor(key: string) {
    super(
      `Idempotency key "${key}" was reused with a different request body.`,
      HttpStatus.CONFLICT,
    );
  }
}

export class BillingIdempotencyInFlightError extends BillingError {
  constructor(key: string) {
    super(
      `An identical request with idempotency key "${key}" is already in progress. Retry later.`,
      HttpStatus.CONFLICT,
    );
  }
}

export class BillingWebhookAlreadyProcessedError extends BillingError {
  constructor(stripeEventId: string) {
    super(
      `Webhook event ${stripeEventId} has already been processed.`,
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * Raised by a webhook handler when a Stripe-driven update cannot be
 * applied (e.g. we received `customer.subscription.created` for a
 * Stripe subscription id we have never seen and have no local
 * checkout session to attach it to). The webhook service marks the
 * event `failed` and returns non-2xx so Stripe will retry.
 */
export class BillingWebhookHandlerError extends BillingError {
  constructor(
    message: string,
    public readonly stripeEventId: string,
    public readonly eventType: string,
  ) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
