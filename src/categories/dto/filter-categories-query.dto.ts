import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

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
  @ApiPropertyOptional({ description: 'Items per page', default: 10 })
  limit?: number = 10;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Search by name' })
  search?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'Sort by field (name, order, createdAt)',
  })
  sortBy?: string = 'order';

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'Sort order (ASC or DESC)',
    enum: ['ASC', 'DESC'],
  })
  sortOrder?: 'ASC' | 'DESC' = 'ASC';
}
