import {
  IsInt,
  IsPositive,
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AddToListDto {
  @IsInt()
  @IsPositive()
  tmdbId!: number;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  posterPath?: string;

  @IsOptional()
  @IsString()
  overview?: string;

  @IsOptional()
  @IsString()
  releaseDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  voteAverage?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genres?: string[];
}
