import {
  TmdbMovieResponse,
  TmdbTvResponse,
  TmdbSnapshot,
} from './tmdb.types.js';

export function mapMovieToSnapshot(data: TmdbMovieResponse): TmdbSnapshot {
  return {
    title: data.title,
    posterPath: data.poster_path ?? null,
    releaseDate: data.release_date ?? null,
    voteAverage: data.vote_average ?? null,
  };
}

export function mapTvToSnapshot(data: TmdbTvResponse): TmdbSnapshot {
  return {
    title: data.name,
    posterPath: data.poster_path ?? null,
    releaseDate: data.first_air_date ?? null,
    voteAverage: data.vote_average ?? null,
  };
}
