import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { firstValueFrom } from 'rxjs';
import { MediaType } from '../enums/media-type.enum.js';
import {
  TmdbMovieResponse,
  TmdbTvResponse,
  TmdbSnapshot,
} from './tmdb.types.js';
import { mapMovieToSnapshot, mapTvToSnapshot } from './tmdb.mapper.js';

@Injectable()
export class TmdbService {
  private readonly logger = new Logger(TmdbService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  private static readonly CACHE_TTL = 60_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {
    this.apiKey = this.configService.getOrThrow<string>('TMDB_API_KEY');
    this.baseUrl = this.configService.getOrThrow<string>('TMDB_BASE_URL');
  }

  async getMedia(mediaType: MediaType, tmdbId: number): Promise<TmdbSnapshot> {
    const cacheKey = `tmdb:${mediaType}:${tmdbId}`;

    const cached = await this.cache.get<TmdbSnapshot>(cacheKey);
    if (cached) return cached;

    const endpoint = mediaType === MediaType.MOVIE ? 'movie' : 'tv';

    try {
      const response = await firstValueFrom(
        this.httpService.get<TmdbMovieResponse | TmdbTvResponse>(
          `${this.baseUrl}/${endpoint}/${tmdbId}`,
          {
            params: { language: 'en-US' },
            headers: { Authorization: `Bearer ${this.apiKey}` },
          },
        ),
      );

      let snapshot: TmdbSnapshot;
      if (mediaType === MediaType.MOVIE) {
        snapshot = mapMovieToSnapshot(response.data as TmdbMovieResponse);
      } else {
        snapshot = mapTvToSnapshot(response.data as TmdbTvResponse);
      }

      await this.cache.set(cacheKey, snapshot, TmdbService.CACHE_TTL);

      return snapshot;
    } catch (error) {
      this.logger.error(
        `TMDB fetch failed: ${endpoint}/${tmdbId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException(
        `Failed to fetch media from TMDB: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
