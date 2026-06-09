import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingSubscriptionStatus } from '../../billing/common/billing.enums';

export class UserSubscriptionHistoryItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  status: BillingSubscriptionStatus;

  @ApiPropertyOptional({ nullable: true })
  planName: string | null;

  @ApiPropertyOptional({ nullable: true })
  priceCurrency: string | null;

  @ApiPropertyOptional({ nullable: true })
  priceUnitAmount: number | null;

  @ApiPropertyOptional({ nullable: true })
  priceInterval: string | null;

  @ApiPropertyOptional({ nullable: true })
  currentPeriodStart: Date | null;

  @ApiPropertyOptional({ nullable: true })
  currentPeriodEnd: Date | null;

  @ApiPropertyOptional({ nullable: true })
  trialEnd: Date | null;

  @ApiProperty()
  cancelAtPeriodEnd: boolean;

  @ApiPropertyOptional({ nullable: true })
  canceledAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}
