/**
 * StripeWebhookController
 *
 * Receives Stripe webhook deliveries and hands them to
 * `BillingWebhookService`. The route is intentionally tiny:
 *
 * - `@Public()` — the global `AuthGuard` (set up in `app.module.ts`)
 *   must not require a JWT. Stripe authenticates us via the
 *   `Stripe-Signature` header instead.
 * - `@SkipThrottle()` — the global `ThrottlerGuard` must not
 *   rate-limit us. Stripe can legitimately send bursts of events
 *   during catch-up after an outage, and we have no per-IP
 *   identity to throttle on.
 * - The raw body is read from `req.rawBody` (Buffer), which is
 *   populated by Nest's Express adapter because `rawBody: true`
 *   is set on `NestFactory.create()` in `src/main.ts`.
 *
 * HTTP status policy:
 *
 * - 200 for `processed`, `duplicate`, and `ignored` — Stripe
 *   should stop retrying. We use the `kind` field on the response
 *   to surface the outcome to the operator.
 * - 400 for invalid signatures (Stripe will not retry; the
 *   payload is unverifiable).
 * - 5xx for unexpected handler errors so Stripe will retry with
 *   backoff. The webhook service marks the event `failed` first,
 *   so Phase 7 admin replay can pick it up.
 */

import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';

import { Public } from '../../auth/decorators/public.decorator';
import { SkipThrottle } from '../../common/decorators/throttle.decorators';
import { BillingWebhookService } from '../services/billing-webhook.service';
import { BillingWebhookAckResponseDto } from '../dto/billing-webhook.dto';
import { BILLING_STRIPE_WEBHOOK_PATH } from '../common/billing.constants';
import { StripeSignatureVerificationFailedError } from '../common/billing.errors';

export const STRIPE_SIGNATURE_HEADER = 'stripe-signature';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer | string | undefined;
}

@ApiTags('Billing - Webhooks')
@Controller('billing/webhooks')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private readonly webhookService: BillingWebhookService) {}

  @Post('stripe')
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive a Stripe webhook delivery.',
    description:
      'Public endpoint. Stripe authenticates the request via the `Stripe-Signature` header. The raw request body must be available on `req.rawBody` (this is set up in `main.ts` via `rawBody: true`).',
  })
  @ApiHeader({
    name: STRIPE_SIGNATURE_HEADER,
    required: true,
    description: 'Stripe-issued signature for the request payload.',
  })
  @ApiOkResponse({
    description: 'Webhook accepted (processed, duplicate, or ignored).',
    type: BillingWebhookAckResponseDto,
  })
  async handleStripeWebhook(
    @Req() request: RequestWithRawBody,
  ): Promise<BillingWebhookAckResponseDto> {
    const signature = this.readSignatureHeader(request);
    const rawBody = this.readRawBody(request);

    if (!signature) {
      throw new BadRequestException(
        `Missing ${STRIPE_SIGNATURE_HEADER} header.`,
      );
    }
    if (rawBody == null) {
      throw new BadRequestException(
        'Request body is empty or was already consumed by another parser.',
      );
    }

    try {
      const result = await this.webhookService.receiveEvent(rawBody, signature);
      return {
        kind: result.kind,
        stripeEventId: result.stripeEventId,
        eventType: result.eventType,
        reason:
          'reason' in result
            ? result.reason
            : 'errorMessage' in result
              ? result.errorMessage
              : null,
      };
    } catch (err) {
      if (err instanceof StripeSignatureVerificationFailedError) {
        // Stripe should NOT retry — the body is unverifiable.
        throw new BadRequestException(err.message);
      }
      this.logger.error(
        `Webhook handler threw; letting Stripe retry: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      );
      throw err;
    }
  }

  /**
   * Canonical webhook path. Exposed as a static so tests and the
   * module docblock can refer to one source of truth.
   */
  static readonly path = BILLING_STRIPE_WEBHOOK_PATH;

  private readSignatureHeader(request: Request): string | null {
    const raw = request.headers[STRIPE_SIGNATURE_HEADER];
    if (typeof raw === 'string') {
      return raw.length > 0 ? raw : null;
    }
    if (Array.isArray(raw) && typeof raw[0] === 'string') {
      return raw[0];
    }
    return null;
  }

  private readRawBody(request: RequestWithRawBody): Buffer | null {
    const raw = request.rawBody;
    if (typeof raw === 'string' && raw.length > 0) {
      return Buffer.from(raw, 'utf8');
    }
    if (Buffer.isBuffer(raw) && raw.length > 0) {
      return raw;
    }
    return null;
  }
}
