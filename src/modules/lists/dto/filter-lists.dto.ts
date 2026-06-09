import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class FilterListsDto {
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
}
