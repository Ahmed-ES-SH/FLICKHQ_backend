import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiProperty({ description: 'Category name', maxLength: 100 })
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, numbers, and hyphens',
  })
  @ApiPropertyOptional({
    description: 'Category slug (auto-generated if not provided)',
  })
  slug?: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({ description: 'Category description' })
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(7)
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'Color must be a valid hex color code (e.g., #FF5733)',
  })
  @ApiPropertyOptional({ description: 'Hex color code (e.g., #FF5733)' })
  color?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  @ApiPropertyOptional({ description: 'Icon name' })
  icon?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({ description: 'Display order', default: 0 })
  order?: number;
}
