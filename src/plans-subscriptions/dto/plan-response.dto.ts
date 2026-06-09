import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PriceResponseDto } from './price-response.dto';
import { BillingPlanStatus } from '../../billing/common/billing.enums';

export class PlanResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiProperty({ enum: BillingPlanStatus })
  status: BillingPlanStatus;

  @ApiProperty({ type: [String] })
  features: string[];

  @ApiProperty({ description: 'Sort order for pricing page.' })
  displayOrder: number;

  @ApiPropertyOptional({ nullable: true })
  icon: string | null;

  @ApiProperty({ description: 'Recommended plan flag.' })
  highlight: boolean;

  @ApiProperty({ type: [PriceResponseDto] })
  prices: PriceResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PlanMutationResultDto {
  @ApiProperty({ type: PlanResponseDto })
  plan: PlanResponseDto;
}
