/**
 * DTOs for the user-facing Checkout endpoints.
 *
 * The two endpoints exposed in Phase 4 are:
 *
 * - `POST /api/billing/checkout/one-time`      — `BillingOneTimeCheckoutRequestDto`
 * - `POST /api/billing/checkout/subscription`  — `BillingSubscriptionCheckoutRequestDto`
 *
 * Both endpoints:
 *
 * - Return a `BillingCheckoutSessionResponseDto` with the
 *   `sessionId` and `url` from Stripe.
 * - Require an `Idempotency-Key` header (enforced by the
 *   controller, not by these DTOs).
 * - Accept the local `priceId` (UUID) only. The Stripe price id,
 *   amount, currency, and customer id are all resolved server-side
 *   and never accepted from the client.
 */

import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Base request body for a one-time Checkout Session.
 *
 * The client must reference the local `BillingPrice` by its UUID.
 * The amount, currency, and Stripe Price id are looked up from the
 * database.
 */
export class BillingOneTimeCheckoutRequestDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Local BillingPrice UUID. Resolved server-side; the Stripe Price id, currency, and amount are never accepted from the client.',
  })
  @IsString()
  @IsUUID()
  priceId: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 1,
    description: 'Number of units to sell. Defaults to 1.',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number = 1;

  @ApiPropertyOptional({
    description:
      'Whether Checkout should accept Stripe promotion codes. Default is true.',
  })
  @IsBoolean()
  @IsOptional()
  allowPromotionCodes?: boolean = true;
}

/**
 * Base request body for a subscription Checkout Session.
 *
 * The client must reference a local recurring `BillingPrice` by its
 * UUID. The plan enforces "one active subscription per user" in
 * v1 — multiple concurrent subscriptions are post-MVP.
 */
export class BillingSubscriptionCheckoutRequestDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Local BillingPrice UUID of a recurring Stripe Price. Resolved server-side.',
  })
  @IsString()
  @IsUUID()
  priceId: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 1,
    description: 'Number of seats. Defaults to 1.',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number = 1;

  @ApiPropertyOptional({
    description:
      'Optional client-side free-form reference, e.g. an order id. Forwarded to Stripe as `client_reference_id` and stored on the local BillingPayment / BillingSubscription metadata.',
    maxLength: 100,
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Matches(/^[A-Za-z0-9._:-]+$/, {
    message:
      'clientReferenceId may only contain letters, digits, dot, underscore, colon, and dash.',
  })
  clientReferenceId?: string;

  @ApiPropertyOptional({
    description:
      'Override of the price-level trial period (in days). Must be a positive integer; if set, the resulting subscription will start in `trialing` state.',
    minimum: 1,
    maximum: 730,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  trialDays?: number;

  @ApiPropertyOptional({
    description:
      'Whether Checkout should accept Stripe promotion codes. Default is true.',
  })
  @IsBoolean()
  @IsOptional()
  allowPromotionCodes?: boolean = true;

  @ApiPropertyOptional({
    description:
      'Checkout UI mode. "hosted_page" (default) redirects to checkout.stripe.com. "embedded_page" renders the Stripe payment form inline via an iframe.',
    enum: ['hosted_page', 'embedded_page'],
    default: 'hosted_page',
  })
  @IsString()
  @IsOptional()
  @IsIn(['hosted_page', 'embedded_page'])
  uiMode?: 'hosted_page' | 'embedded_page' = 'hosted_page';
}

/**
 * Response returned by both Checkout endpoints.
 *
 * - Hosted mode: `sessionId` + `url` (redirect to checkout.stripe.com).
 * - Embedded mode: `sessionId` + `clientSecret` (render Stripe form inline).
 */
export class BillingCheckoutSessionResponseDto {
  @ApiProperty({
    description: 'Opaque Stripe Checkout Session id (cs_*).',
    example: 'cs_test_a1b2c3',
  })
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @ApiPropertyOptional({
    description:
      'Stripe-hosted Checkout URL. Present in hosted mode. Short-lived; redirect immediately.',
    example: 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3',
  })
  @IsString()
  @IsOptional()
  url?: string;

  @ApiPropertyOptional({
    description:
      'Embedded Checkout client secret. Present in embedded mode. Pass to the Stripe Embedded Checkout component on the frontend.',
    example: 'cs_test_a1b2c3_secret_xxx',
  })
  @IsString()
  @IsOptional()
  clientSecret?: string;
}

/**
 * Re-export the portal response DTO from the same shape so the
 * controller can keep its imports consistent. The portal response
 * is just `{ url }`.
 */
export { BillingPortalSessionResponseDto } from './billing-portal.dto';
