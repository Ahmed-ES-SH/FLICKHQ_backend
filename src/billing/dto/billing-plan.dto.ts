/**
 * DTOs for managing local `BillingPlan` rows and their `BillingPrice`
 * children. Used by the admin controller and consumed by
 * `BillingCatalogService`.
 *
 * Constraints:
 *
 * - `code` is a stable identifier that other parts of the application
 *   can reference (e.g. seeding, admin UIs, plan features). Once a
 *   plan is sold against a Stripe Price, the `code` is effectively
 *   immutable — create a new plan instead of renaming an old one.
 * - `features` is a JSON array of stable feature keys
 *   (e.g. `["premium_reports", "team_export"]`). Application code
 *   references these strings via `BillingEntitlementsService` in
 *   Phase 6.
 */

import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BillingPlanStatus,
  BillingPriceType,
  BillingRecurringInterval,
} from '../common/billing.enums';

/**
 * DTO for creating a new plan.
 *
 * Plan records are essentially metadata for a Stripe Product; they
 * are inexpensive to create and don't require any Stripe API call.
 * Prices are added separately via `AddBillingPriceDto`.
 */
export class CreateBillingPlanDto {
  @ApiProperty({
    description: 'Stable plan code. Lowercase letters, digits and dashes only.',
    example: 'pro_monthly',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-z0-9_-]+$/, {
    message:
      'Plan code must contain only lowercase letters, digits, underscores and dashes.',
  })
  code: string;

  @ApiProperty({ example: 'Pro Plan' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @IsOptional()
  description?: string | null;

  @ApiPropertyOptional({
    enum: BillingPlanStatus,
    default: BillingPlanStatus.DRAFT,
  })
  @IsEnum(BillingPlanStatus)
  @IsOptional()
  status?: BillingPlanStatus = BillingPlanStatus.DRAFT;

  @ApiPropertyOptional({
    description: 'Stable feature keys enabled by this plan.',
    type: [String],
    example: ['premium_reports'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  features?: string[] = [];
}

/**
 * DTO for partial updates of a plan. `code` is intentionally not
 * updatable — see the file header for the rationale.
 */
export class UpdateBillingPlanDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @IsOptional()
  description?: string | null;

  @ApiPropertyOptional({ enum: BillingPlanStatus })
  @IsEnum(BillingPlanStatus)
  @IsOptional()
  status?: BillingPlanStatus;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  features?: string[];
}

/**
 * DTO for adding a Stripe-backed price to an existing plan.
 *
 * The Stripe price id is supplied by the caller (typically after
 * creating the price in the Stripe dashboard) and stored as a
 * reference. We do not call Stripe from this endpoint — Stripe
 * remains the source of truth for price data.
 */
export class AddBillingPriceDto {
  @ApiProperty({
    description: 'Stripe Price id (price_*).',
    example: 'price_1ABC...',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  stripePriceId: string;

  @ApiPropertyOptional({
    description: 'Stripe Product id (prod_*).',
    nullable: true,
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  stripeProductId?: string | null;

  @ApiProperty({
    description:
      'Lowercase ISO-4217 3-letter currency code, e.g. "usd", "eur".',
    example: 'usd',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  @Matches(/^[a-z]{3}$/, {
    message: 'Currency must be a 3-letter lowercase ISO-4217 code.',
  })
  currency: string;

  @ApiProperty({ description: 'Amount in the smallest currency unit.' })
  @IsInt()
  @Min(0)
  unitAmount: number;

  @ApiProperty({ enum: BillingPriceType })
  @IsEnum(BillingPriceType)
  type: BillingPriceType;

  @ApiPropertyOptional({
    enum: BillingRecurringInterval,
    nullable: true,
    description: 'Required when type=recurring.',
  })
  @IsEnum(BillingRecurringInterval)
  @IsOptional()
  interval?: BillingRecurringInterval | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  trialPeriodDays?: number | null;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  active?: boolean = true;
}

/**
 * Response DTO for a `BillingPrice` row. Only non-secret fields.
 */
export class BillingPriceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  planId: string;

  @ApiProperty()
  stripePriceId: string;

  @ApiProperty({ nullable: true, required: false })
  stripeProductId: string | null;

  @ApiProperty({ example: 'usd' })
  currency: string;

  @ApiProperty({ description: 'Unit amount in minor currency units.' })
  unitAmount: number;

  @ApiProperty({ enum: BillingPriceType })
  type: BillingPriceType;

  @ApiProperty({
    enum: BillingRecurringInterval,
    nullable: true,
    required: false,
  })
  interval: BillingRecurringInterval | null;

  @ApiProperty({ nullable: true, required: false })
  trialPeriodDays: number | null;

  @ApiProperty()
  active: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * Response DTO for a `BillingPlan` row.
 *
 * The admin variant embeds the full price list; the public variant
 * is restricted to active plans and active prices only.
 */
export class BillingPlanResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true, required: false })
  description: string | null;

  @ApiProperty({ enum: BillingPlanStatus })
  status: BillingPlanStatus;

  @ApiProperty({ type: [String] })
  features: string[];

  @ApiProperty({ type: [BillingPriceResponseDto] })
  prices: BillingPriceResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * Variant of the plan response used for public endpoints.
 *
 * Only plans with `status = active` and at least one active price
 * are returned. Price data is included so the marketing site can
 * render prices without a second round-trip.
 */
export class BillingPublicPlanResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true, required: false })
  description: string | null;

  @ApiProperty({ type: [String] })
  features: string[];

  @ApiProperty({ type: [BillingPriceResponseDto] })
  prices: BillingPriceResponseDto[];
}

/**
 * Used by the public plans endpoint when the client wants to
 * filter by a specific currency. The default behavior returns all
 * currencies; the marketing site can ask for one to render a
 * localized price list.
 */
export class ListBillingPublicPlansQueryDto {
  @ApiPropertyOptional({
    description: 'Filter prices to a specific currency. Defaults to all.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(3)
  @Matches(/^[a-z]{3}$/, {
    message: 'Currency must be a 3-letter lowercase ISO-4217 code.',
  })
  currency?: string;
}

/**
 * Query DTO for the admin list-all endpoint. Status filter is the
 * only v1 filter; pagination is intentionally not applied (a
 * project has at most a few dozen plans).
 */
export class ListBillingPlansQueryDto {
  @ApiPropertyOptional({ enum: BillingPlanStatus })
  @IsEnum(BillingPlanStatus)
  @IsOptional()
  status?: BillingPlanStatus;
}

/**
 * Common response DTO for admin POST/PATCH endpoints. The route
 * returns the full plan+prices representation so the client doesn't
 * need a follow-up fetch.
 */
export class BillingPlanMutationResultDto {
  @ApiProperty({ type: BillingPlanResponseDto })
  plan: BillingPlanResponseDto;
}
