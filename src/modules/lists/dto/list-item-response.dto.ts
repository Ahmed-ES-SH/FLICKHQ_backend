import { ApiProperty } from '@nestjs/swagger';
import { MediaType } from '../enums/media-type.enum.js';

export class ListItemResponseDto {
  @ApiProperty({ description: 'Item UUID' })
  id: string;

  @ApiProperty({ enum: MediaType, description: 'Media type' })
  mediaType: MediaType;

  @ApiProperty({ description: 'TMDB ID' })
  tmdbId: number;

  @ApiProperty({ description: 'Media title' })
  title: string;

  @ApiProperty({ description: 'TMDB poster path', nullable: true })
  posterPath: string | null;

  @ApiProperty({ description: 'Release / first air date', nullable: true })
  releaseDate: string | null;

  @ApiProperty({ description: 'TMDB vote average', nullable: true })
  voteAverage: number | null;

  @ApiProperty({ description: 'Timestamp when item was added' })
  addedAt: Date;
}
