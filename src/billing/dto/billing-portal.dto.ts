/**
 * DTOs for the customer-portal session endpoint.
 *
 * The portal session itself is opaque to clients: we just return the
 * URL Stripe gives us. Phase 4 will layer idempotency on top of this
 * endpoint; the v1 endpoint accepts an optional idempotency-key
 * header so the contract is stable.
 */

import { ApiProperty } from '@nestjs/swagger';

export class BillingPortalSessionResponseDto {
  @ApiProperty({
    description:
      'URL the client should redirect the user to in order to open the Stripe Customer Portal.',
    example: 'https://billing.stripe.com/p/session/test_xxx',
  })
  url: string;
}
