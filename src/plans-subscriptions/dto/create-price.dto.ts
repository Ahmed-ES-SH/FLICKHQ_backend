import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BillingPriceType,
  BillingRecurringInterval,
} from '../../billing/common/billing.enums';

export {
  BillingPriceType as PriceType,
  BillingRecurringInterval as PriceInterval,
};

export class CreatePriceDto {
  @ApiProperty({ example: 'price_1ABC...' })
  @IsString()
  @Length(1, 255)
  stripePriceId: string;

  @ApiProperty({ example: 'usd' })
  @IsString()
  @Length(3, 3)
  currency: string;

  @ApiProperty({ description: 'Amount in minor currency units (cents).' })
  @IsInt()
  @Min(1)
  unitAmount: number;

  @ApiProperty({ enum: BillingPriceType })
  @IsEnum(BillingPriceType)
  type: BillingPriceType;

  @ApiPropertyOptional({ enum: BillingRecurringInterval, nullable: true })
  @ValidateIf((o: CreatePriceDto) => o.type === BillingPriceType.RECURRING)
  @IsEnum(BillingRecurringInterval)
  interval?: BillingRecurringInterval | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 365 })
  @IsInt()
  @Min(0)
  @Max(365)
  @IsOptional()
  trialPeriodDays?: number | null;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
