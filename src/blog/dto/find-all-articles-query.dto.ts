import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class FindAllArticlesQueryDto extends PaginationQueryDto {
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
