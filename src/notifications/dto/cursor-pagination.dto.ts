import { IsOptional, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Cursor-based pagination DTO for notifications feed
 * Uses createdAt timestamp as cursor (cursor = last item's createdAt)
 */
export class CursorPaginationDto {
  @ApiPropertyOptional({
    description: 'Cursor timestamp (ISO 8601) - use last item createdAt',
    example: '2024-01-15T10:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Number of items to return',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

/**
 * Response type for cursor-based pagination
 */
export interface CursorPaginatedResponse<T> {
  data: T[];
  meta: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
  };
}
