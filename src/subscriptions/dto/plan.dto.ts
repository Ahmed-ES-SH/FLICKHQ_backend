import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PlanStatus,
  PriceType,
  RecurringInterval,
} from '../common/subscription.enums';

export class CreatePlanDto {
  @ApiProperty({ maxLength: 50 })
  @IsString()
  @Length(1, 50)
  code: string;

  @ApiProperty()
  @IsString()
  @Length(1, 255)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  features?: string[];

  @ApiPropertyOptional({ default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  icon?: string | null;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  highlight?: boolean;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @Length(1, 255)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  features?: string[];

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @IsOptional()
  icon?: string | null;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  highlight?: boolean;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class CreatePriceDto {
  @ApiProperty({ example: 'price_1Q...' })
  @IsString()
  stripePriceId: string;

  @ApiPropertyOptional({ nullable: true, example: 'prod_1Q...' })
  @IsString()
  @IsOptional()
  stripeProductId?: string | null;

  @ApiProperty({ example: 'usd' })
  @IsString()
  @Length(3, 3)
  currency: string;

  @ApiProperty({ description: 'Amount in minor currency units (cents).' })
  @IsInt()
  @Min(1)
  unitAmount: number;

  @ApiProperty({ enum: PriceType })
  @IsString()
  type: PriceType;

  @ApiPropertyOptional({ enum: RecurringInterval, nullable: true })
  @IsOptional()
  interval?: RecurringInterval | null;

  @ApiPropertyOptional()
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

export class PriceResponseDto {
  id: string;
  planId: string;
  stripePriceId: string;
  stripeProductId: string | null;
  currency: string;
  unitAmount: number;
  type: PriceType;
  interval: RecurringInterval | null;
  trialPeriodDays: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class PlanResponseDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: PlanStatus;
  features: string[];
  displayOrder: number;
  icon: string | null;
  highlight: boolean;
  prices: PriceResponseDto[];
  createdAt: Date;
  updatedAt: Date;
}
