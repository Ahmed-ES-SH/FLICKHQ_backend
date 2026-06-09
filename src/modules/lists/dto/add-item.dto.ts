import { IsEnum, IsInt, IsNotEmpty, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MediaType } from '../enums/media-type.enum.js';

export class AddItemDto {
  @IsEnum(MediaType)
  @IsNotEmpty()
  @ApiProperty({ enum: MediaType, description: 'Media type (movie or tv)' })
  mediaType: MediaType;

  @IsInt()
  @Min(1)
  @IsNotEmpty()
  @ApiProperty({ description: 'TMDB ID of the media', minimum: 1 })
  tmdbId: number;
}
