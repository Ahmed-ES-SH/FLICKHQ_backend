import { IsOptional, IsString, IsInt, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum CategorySortField {
  name = 'name',
  order = 'order',
  createdAt = 'createdAt',
}

export enum CategorySortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class FilterCategoriesQueryDto {
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
  @ApiPropertyOptional({ description: 'Search by name' })
  search?: string;

  @IsOptional()
  @IsEnum(CategorySortField)
  @ApiPropertyOptional({
    description: 'Sort by field',
    enum: CategorySortField,
    default: CategorySortField.order,
  })
  sortBy?: CategorySortField = CategorySortField.order;

  @IsOptional()
  @IsEnum(CategorySortOrder)
  @ApiPropertyOptional({
    description: 'Sort order',
    enum: CategorySortOrder,
    default: CategorySortOrder.ASC,
  })
  sortOrder?: CategorySortOrder = CategorySortOrder.ASC;
}
