import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { of, throwError } from 'rxjs';
import { TmdbService } from './tmdb.service';
import { mapMovieToSnapshot, mapTvToSnapshot } from './tmdb.mapper';
import { MediaType } from '../enums/media-type.enum';
import { TmdbMovieResponse, TmdbTvResponse } from './tmdb.types';

describe('TmdbService', () => {
  let service: TmdbService;
  let httpService: jest.Mocked<HttpService>;
  let cacheManager: jest.Mocked<{ get: jest.Mock; set: jest.Mock }>;

  const mockMovieResponse: TmdbMovieResponse = {
    id: 550,
    title: 'Fight Club',
    poster_path: '/pB8BM7pdSp6B6Ih7QI4S2t0POoT.jpg',
    release_date: '1999-10-15',
    vote_average: 8.4,
  };

  const mockTvResponse: TmdbTvResponse = {
    id: 1399,
    name: 'Game of Thrones',
    poster_path: '/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg',
    first_air_date: '2011-04-17',
    vote_average: 8.4,
  };

  beforeEach(async () => {
    cacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TmdbService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              if (key === 'TMDB_API_KEY') return 'test-api-key';
              if (key === 'TMDB_BASE_URL')
                return 'https://api.themoviedb.org/3';
              return undefined;
            }),
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
      ],
    }).compile();

    service = module.get<TmdbService>(TmdbService);
    httpService = module.get(HttpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getMedia', () => {
    it('should fetch a movie and return a snapshot', async () => {
      const mockGet = httpService.get as jest.Mock;
      mockGet.mockReturnValueOnce(
        of({
          data: mockMovieResponse,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {},
        }),
      );

      const result = await service.getMedia(MediaType.MOVIE, 550);

      expect(mockGet).toHaveBeenCalledWith(
        'https://api.themoviedb.org/3/movie/550',
        { params: { api_key: 'test-api-key', language: 'en-US' } },
      );
      expect(result).toEqual({
        title: 'Fight Club',
        posterPath: '/pB8BM7pdSp6B6Ih7QI4S2t0POoT.jpg',
        releaseDate: '1999-10-15',
        voteAverage: 8.4,
      });
    });

    it('should fetch a TV show and return a snapshot', async () => {
      httpService.get.mockReturnValueOnce(
        of({
          data: mockTvResponse,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {} as any,
        }),
      );

      const result = await service.getMedia(MediaType.TV, 1399);

      expect(httpService.get).toHaveBeenCalledWith(
        'https://api.themoviedb.org/3/tv/1399',
        { params: { api_key: 'test-api-key', language: 'en-US' } },
      );
      expect(result).toEqual({
        title: 'Game of Thrones',
        posterPath: '/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg',
        releaseDate: '2011-04-17',
        voteAverage: 8.4,
      });
    });

    it('should throw ServiceUnavailableException on HTTP error', async () => {
      httpService.get.mockReturnValueOnce(
        throwError(() => new Error('Network error')),
      );

      await expect(service.getMedia(MediaType.MOVIE, 999)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should handle null poster_path gracefully', async () => {
      const movieWithNullPoster = { ...mockMovieResponse, poster_path: null };
      httpService.get.mockReturnValueOnce(
        of({
          data: movieWithNullPoster,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {} as any,
        }),
      );

      const result = await service.getMedia(MediaType.MOVIE, 550);

      expect(result.posterPath).toBeNull();
    });

    it('should handle null vote_average gracefully', async () => {
      const movieWithNullRating = { ...mockMovieResponse, vote_average: null };
      httpService.get.mockReturnValueOnce(
        of({
          data: movieWithNullRating,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {} as any,
        }),
      );

      const result = await service.getMedia(MediaType.MOVIE, 550);

      expect(result.voteAverage).toBeNull();
    });

    it('should return cached result on cache hit', async () => {
      const cachedSnapshot = {
        title: 'Fight Club',
        posterPath: '/poster.jpg',
        releaseDate: '1999-10-15',
        voteAverage: 8.4,
      };
      cacheManager.get.mockResolvedValueOnce(cachedSnapshot);

      const result = await service.getMedia(MediaType.MOVIE, 550);

      expect(result).toEqual(cachedSnapshot);
      expect(httpService.get).not.toHaveBeenCalled();
    });

    it('should cache result after successful fetch', async () => {
      httpService.get.mockReturnValueOnce(
        of({
          data: mockMovieResponse,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {} as any,
        }),
      );

      await service.getMedia(MediaType.MOVIE, 550);

      expect(cacheManager.set).toHaveBeenCalledWith(
        'tmdb:movie:550',
        expect.objectContaining({ title: 'Fight Club' }),
        60_000,
      );
    });

    it('should include error message in exception', async () => {
      httpService.get.mockReturnValueOnce(
        throwError(() => new Error('TMDB timeout')),
      );

      await expect(service.getMedia(MediaType.MOVIE, 999)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('TMDB timeout'),
        }),
      );
    });
  });
});

describe('tmdb.mapper', () => {
  describe('mapMovieToSnapshot', () => {
    it('should map movie response to snapshot', () => {
      const input: TmdbMovieResponse = {
        id: 550,
        title: 'Fight Club',
        poster_path: '/poster.jpg',
        release_date: '1999-10-15',
        vote_average: 8.4,
      };

      const result = mapMovieToSnapshot(input);

      expect(result).toEqual({
        title: 'Fight Club',
        posterPath: '/poster.jpg',
        releaseDate: '1999-10-15',
        voteAverage: 8.4,
      });
    });

    it('should handle null fields', () => {
      const input: TmdbMovieResponse = {
        id: 1,
        title: 'Unknown Movie',
        poster_path: null,
        release_date: null,
        vote_average: null,
      };

      const result = mapMovieToSnapshot(input);

      expect(result).toEqual({
        title: 'Unknown Movie',
        posterPath: null,
        releaseDate: null,
        voteAverage: null,
      });
    });
  });

  describe('mapTvToSnapshot', () => {
    it('should map TV response to snapshot', () => {
      const input: TmdbTvResponse = {
        id: 1399,
        name: 'Game of Thrones',
        poster_path: '/poster.jpg',
        first_air_date: '2011-04-17',
        vote_average: 8.4,
      };

      const result = mapTvToSnapshot(input);

      expect(result).toEqual({
        title: 'Game of Thrones',
        posterPath: '/poster.jpg',
        releaseDate: '2011-04-17',
        voteAverage: 8.4,
      });
    });

    it('should handle null fields', () => {
      const input: TmdbTvResponse = {
        id: 1,
        name: 'Unknown Show',
        poster_path: null,
        first_air_date: null,
        vote_average: null,
      };

      const result = mapTvToSnapshot(input);

      expect(result).toEqual({
        title: 'Unknown Show',
        posterPath: null,
        releaseDate: null,
        voteAverage: null,
      });
    });
  });
});
