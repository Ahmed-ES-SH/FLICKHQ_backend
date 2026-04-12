import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateArticleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  @ApiProperty({ maxLength: 300 })
  title: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  content: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  excerpt?: string;

  @IsUrl()
  @IsOptional()
  @ApiPropertyOptional()
  coverImageUrl?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ApiPropertyOptional({ type: [String] })
  tags?: string[];

  @IsUUID()
  @IsOptional()
  @ApiPropertyOptional({ description: 'Category ID' })
  categoryId?: string;
}
