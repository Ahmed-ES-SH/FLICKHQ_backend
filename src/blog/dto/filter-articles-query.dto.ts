import { IsOptional, IsString, IsUUID, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class FilterArticlesQueryDto {
  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({ description: 'Filter by category ID' })
  categoryId?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ required: false })
  tag?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Search articles by title' })
  search?: string;

  @IsOptional()
  @Transform(
    ({ value }) =>
      value === 'true' || value === true || value === 1 || value === '1',
  )
  @IsBoolean()
  @ApiPropertyOptional({ description: 'Filter by publish status' })
  isPublished?: boolean;
}
