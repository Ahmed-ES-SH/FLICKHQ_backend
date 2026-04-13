import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Movie } from './schema/movie.schema';

export interface PaginatedMovieResult {
  data: Movie[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

@Injectable()
export class MoviesService {
  private readonly tmdbBaseUrl = 'https://api.themoviedb.org/3';

  constructor(
    @InjectRepository(Movie)
    private readonly movieRepository: Repository<Movie>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Search movies by query with pagination
   * Falls back to local DB if query is empty, fetches from TMDB otherwise
   */
  async searchMovies(
    query?: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedMovieResult> {
    if (query && query.trim()) {
      // Fetch from TMDB and upsert
      const tmdbResults = await this.fetchFromTmdb(query, page);
      const movies = await Promise.all(
        tmdbResults.map((tmdbMovie) => this.upsert(tmdbMovie)),
      );
      return {
        data: movies,
        meta: {
          total: tmdbResults.length,
          page,
          limit,
          totalPages: Math.ceil(tmdbResults.length / limit),
        },
      };
    }

    // Return from local DB with full-text search
    const skip = (page - 1) * limit;
    const [data, total] = await this.movieRepository
      .createQueryBuilder('m')
      .orderBy('m.releaseDate', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get movie detail by internal ID
   */
  async findOne(id: number): Promise<Movie> {
    const movie = await this.movieRepository.findOne({ where: { id } });
    if (!movie) {
      throw new NotFoundException('Movie not found');
    }
    return movie;
  }

  /**
   * Get movie by TMDB ID
   */
  async findOneByTmdbId(tmdbId: number): Promise<Movie | null> {
    return this.movieRepository.findOne({ where: { tmdbId } });
  }

  /**
   * Upsert movie from TMDB data — insert if not exists, update if exists
   */
  async upsert(tmdbMovie: {
    id: number;
    title: string;
    overview?: string;
    poster_path?: string;
    backdrop_path?: string;
    release_date?: string;
    vote_average?: number;
    genre_ids?: number[];
    genres?: { id: number; name: string }[];
    runtime?: number;
  }): Promise<Movie> {
    const existing = await this.movieRepository.findOne({
      where: { tmdbId: tmdbMovie.id },
    });

    const genres = tmdbMovie.genres
      ? tmdbMovie.genres.map((g) => g.name)
      : [];

    const movieData: Partial<Movie> = {
      tmdbId: tmdbMovie.id,
      title: tmdbMovie.title,
      overview: tmdbMovie.overview || undefined,
      posterPath: tmdbMovie.poster_path || undefined,
      backdropPath: tmdbMovie.backdrop_path || undefined,
      releaseDate: tmdbMovie.release_date || undefined,
      voteAverage: tmdbMovie.vote_average || undefined,
      genres,
      runtime: tmdbMovie.runtime || undefined,
    };

    if (existing) {
      Object.assign(existing, movieData);
      return this.movieRepository.save(existing);
    }

    const newMovie = this.movieRepository.create(movieData);
    return this.movieRepository.save(newMovie);
  }

  /**
   * Fetch movies from TMDB search API
   */
  private async fetchFromTmdb(
    query: string,
    page: number = 1,
  ): Promise<
    {
      id: number;
      title: string;
      overview?: string;
      poster_path?: string;
      backdrop_path?: string;
      release_date?: string;
      vote_average?: number;
      genre_ids?: number[];
      genres?: { id: number; name: string }[];
      runtime?: number;
    }[]
  > {
    const apiKey = this.configService.get<string>('TMDB_API_KEY');
    if (!apiKey) {
      return [];
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.tmdbBaseUrl}/search/movie`, {
          params: {
            api_key: apiKey,
            query,
            page,
          },
        }),
      );

      return response.data.results || [];
    } catch {
      return [];
    }
  }

  /**
   * Fetch single movie detail from TMDB (includes runtime and genres)
   */
  async fetchTmdbDetail(tmdbId: number): Promise<{
    id: number;
    title: string;
    overview?: string;
    poster_path?: string;
    backdrop_path?: string;
    release_date?: string;
    vote_average?: number;
    genres?: { id: number; name: string }[];
    runtime?: number;
  } | null> {
    const apiKey = this.configService.get<string>('TMDB_API_KEY');
    if (!apiKey) return null;

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.tmdbBaseUrl}/movie/${tmdbId}`, {
          params: { api_key: apiKey },
        }),
      );
      return response.data;
    } catch {
      return null;
    }
  }
}
