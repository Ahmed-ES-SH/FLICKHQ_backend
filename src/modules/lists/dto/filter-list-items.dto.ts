import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MediaType } from '../enums/media-type.enum.js';

export class FilterListItemsDto {
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  @IsOptional()
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  perPage?: number = 20;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  page?: number = 1;

  @IsEnum(MediaType)
  @IsOptional()
  @ApiPropertyOptional({ enum: MediaType, description: 'Filter by media type' })
  mediaType?: MediaType;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({
    enum: ['addedAt', 'title', 'releaseDate', 'voteAverage'],
    default: 'addedAt',
    description: 'Sort field',
  })
  sortBy?: 'addedAt' | 'title' | 'releaseDate' | 'voteAverage' = 'addedAt';

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  order?: 'ASC' | 'DESC' = 'DESC';
}
