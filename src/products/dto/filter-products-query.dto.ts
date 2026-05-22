import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SortOrder } from '../../common/dto/pagination-query.dto';

export enum ProductSortField {
  price = 'price',
  rating = 'rating',
  createdAt = 'createdAt',
  title = 'title',
  stock = 'stock',
}

export class FilterProductsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({ description: 'Items per page', default: 10 })
  limit?: number = 10;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Search by title or description' })
  search?: string;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({ description: 'Filter by category ID' })
  categoryId?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Filter by category slug' })
  categorySlug?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional({ description: 'Minimum price filter', minimum: 0 })
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional({ description: 'Maximum price filter', minimum: 0 })
  maxPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  @ApiPropertyOptional({
    description: 'Minimum rating filter',
    minimum: 0,
    maximum: 5,
  })
  minRating?: number;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Filter by tag (comma-separated)' })
  tags?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  @ApiPropertyOptional({
    description: 'Only show in-stock products',
    default: false,
  })
  inStockOnly?: boolean;

  @IsOptional()
  @IsEnum(ProductSortField)
  @ApiPropertyOptional({
    description: 'Sort by field',
    enum: ProductSortField,
    default: ProductSortField.createdAt,
  })
  sortBy?: ProductSortField = ProductSortField.createdAt;

  @IsOptional()
  @IsEnum(SortOrder)
  @ApiPropertyOptional({
    description: 'Sort order',
    enum: SortOrder,
    default: SortOrder.DESC,
  })
  sortOrder?: SortOrder = SortOrder.DESC;
}
