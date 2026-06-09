import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BillingPriceType,
  BillingRecurringInterval,
} from '../../billing/common/billing.enums';

export class PriceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  planId: string;

  @ApiProperty()
  stripePriceId: string;

  @ApiPropertyOptional({ nullable: true })
  stripeProductId: string | null;

  @ApiProperty({ example: 'usd' })
  currency: string;

  @ApiProperty()
  unitAmount: number;

  @ApiProperty({ enum: BillingPriceType })
  type: BillingPriceType;

  @ApiPropertyOptional({ enum: BillingRecurringInterval, nullable: true })
  interval: BillingRecurringInterval | null;

  @ApiPropertyOptional({ nullable: true })
  trialPeriodDays: number | null;

  @ApiProperty()
  active: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
