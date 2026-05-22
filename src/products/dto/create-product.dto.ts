import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  Max,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Nested DTOs ──────────────────────────────────────────────────

export class ProductDimensionsDto {
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Width in cm' })
  width: number;

  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Height in cm' })
  height: number;

  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Depth in cm' })
  depth: number;
}

export class ProductReviewDto {
  @IsNumber()
  @Min(1)
  @Max(5)
  @ApiProperty({ minimum: 1, maximum: 5 })
  rating: number;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  comment: string;

  @IsString()
  @ApiProperty()
  date: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  reviewerName: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  reviewerEmail: string;
}

// ── Main DTO ─────────────────────────────────────────────────────

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  @ApiProperty({ maxLength: 300 })
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(350)
  @ApiPropertyOptional({
    description: 'URL-friendly slug (auto-generated from title if omitted)',
  })
  slug?: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  description: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  shortDescription?: string;

  // ── Pricing ──────────────────────────────────────────────────

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @ApiProperty({ minimum: 0 })
  price: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 100 })
  discountPercentage?: number;

  // ── Inventory ────────────────────────────────────────────────

  @IsNumber()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({ default: 0 })
  stock?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @ApiProperty({ maxLength: 50 })
  sku: string;

  @IsNumber()
  @IsInt()
  @Min(1)
  @ApiPropertyOptional({ default: 1 })
  minimumOrderQuantity?: number;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  @ApiPropertyOptional({ default: 'In Stock' })
  availabilityStatus?: string;

  // ── Classification ───────────────────────────────────────────

  @IsUUID()
  @IsOptional()
  @ApiPropertyOptional({ description: 'Category ID' })
  categoryId?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ApiPropertyOptional({ type: [String] })
  tags?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(100)
  @ApiPropertyOptional({ maxLength: 100 })
  brand?: string;

  // ── Physical ─────────────────────────────────────────────────

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  @ApiPropertyOptional({ minimum: 0 })
  weight?: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ProductDimensionsDto)
  @ApiPropertyOptional()
  dimensions?: ProductDimensionsDto;

  // ── Media ────────────────────────────────────────────────────

  @IsArray()
  @IsUrl({}, { each: true })
  @IsOptional()
  @ApiPropertyOptional({ type: [String] })
  images?: string[];

  @IsUrl()
  @IsOptional()
  @ApiPropertyOptional()
  thumbnail?: string;

  // ── Policies ─────────────────────────────────────────────────

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  warrantyInformation?: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  shippingInformation?: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  returnPolicy?: string;

  // ── Reviews ──────────────────────────────────────────────────

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProductReviewDto)
  @ApiPropertyOptional({ type: [ProductReviewDto] })
  reviews?: ProductReviewDto[];

  // ── Meta ─────────────────────────────────────────────────────

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  barcode?: string;

  @IsUrl()
  @IsOptional()
  @ApiPropertyOptional()
  qrCode?: string;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({ default: false })
  isPublished?: boolean;
}
