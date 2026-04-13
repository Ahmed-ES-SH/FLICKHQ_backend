import {
  IsInt,
  IsPositive,
  IsString,
  IsOptional,
  IsArray,
  IsDateString,
  IsNumber,
  Min,
  Max,
  MaxLength,
} from 'class-validator';

export class AddToListDto {
  @IsInt()
  @IsPositive()
  tmdbId!: number;

  @IsString()
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  posterPath?: string;

  @IsOptional()
  @IsString()
  overview?: string;

  @IsOptional()
  @IsDateString()
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

  @IsOptional()
  @IsInt()
  @IsPositive()
  runtime?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  rating?: number;
}
