/**
 * Response DTOs for the entitlements endpoint.
 *
 * The endpoint returns one entry per active `BillingEntitlement`
 * for the current user. Internal fields (the `metadata` jsonb
 * column, the row's `user_id`) are not exposed — the caller
 * already knows the user id, and the metadata is reserved for
 * support / debugging.
 */

import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { BillingEntitlementSourceType } from '../common/billing.enums';

export class BillingEntitlementResponseDto {
  @ApiProperty({
    description:
      'Stable feature key. Application code references this string to gate features.',
    example: 'premium_reports',
  })
  @Expose()
  featureKey: string;

  @ApiProperty({
    description: 'What granted this entitlement.',
    enum: BillingEntitlementSourceType,
  })
  @Expose()
  sourceType: BillingEntitlementSourceType;

  @ApiProperty({
    description:
      'Local id of the source row (subscription or payment). `null` for `manual` grants.',
    format: 'uuid',
    nullable: true,
    required: false,
  })
  @Expose()
  sourceId: string | null;

  @ApiProperty({ nullable: true, required: false })
  @Expose()
  startsAt: Date | null;

  @ApiProperty({ nullable: true, required: false })
  @Expose()
  endsAt: Date | null;
}
