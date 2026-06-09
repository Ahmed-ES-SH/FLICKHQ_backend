import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @ApiProperty({ description: 'List name', maxLength: 80 })
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, numbers, and hyphens',
  })
  @ApiPropertyOptional({
    description: 'Custom slug (auto-generated if omitted)',
    maxLength: 100,
  })
  slug?: string;
}
