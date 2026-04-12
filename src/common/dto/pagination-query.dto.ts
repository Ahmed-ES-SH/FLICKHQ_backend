import { IsOptional, IsInt, Min, Max, IsEnum, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Sort Order Enum
 */
export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

/**
 * Allowed Sort Fields (whitelist for security)
 */
export const SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'amount',
  'viewsCount',
  'publishedAt',
  'title',
] as const;

export type SortField = (typeof SORT_FIELDS)[number];

/**
 * Pagination Query DTO
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Page number',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page',
    default: 10,
    minimum: 1,
    maximum: 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    enum: SORT_FIELDS,
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: SortField = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: SortOrder,
    default: SortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  order?: SortOrder = SortOrder.DESC;
}
