import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @ApiPropertyOptional({ description: 'New list name', maxLength: 80 })
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, numbers, and hyphens',
  })
  @ApiPropertyOptional({ description: 'Custom slug', maxLength: 100 })
  slug?: string;
}
