/**
 * `Idempotency-Key` header parameter decorator.
 *
 * Reads the value of the request's `Idempotency-Key` header.
 * Throws a 400 if the header is missing or empty, because the
 * endpoints that use this decorator treat idempotency keys as
 * mandatory.
 *
 * Example:
 *
 * ```ts
 * @Post('checkout/subscription')
 * async createSubscriptionCheckout(
 *   @GetUser() user: AuthenticatedUserShape,
 *   @IdempotencyKey() idempotencyKey: string,
 *   @Body() dto: BillingSubscriptionCheckoutRequestDto,
 * ): Promise<BillingCheckoutSessionResponseDto> { ... }
 * ```
 */

import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { Request } from 'express';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(
        `${IDEMPOTENCY_KEY_HEADER} header is required for this endpoint.`,
      );
    }
    if (value.length > 255) {
      throw new BadRequestException(
        `${IDEMPOTENCY_KEY_HEADER} header is too long (max 255 chars).`,
      );
    }
    return value.trim();
  },
);
