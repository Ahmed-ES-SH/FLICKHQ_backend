export interface TmdbMovieResponse {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string | null;
  vote_average: number | null;
}

export interface TmdbTvResponse {
  id: number;
  name: string;
  poster_path: string | null;
  first_air_date: string | null;
  vote_average: number | null;
}

export interface TmdbSnapshot {
  title: string;
  posterPath: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
}
