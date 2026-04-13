import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserList, ListType } from '../schema/user-list.schema';
import { Movie } from '../../movies/schema/movie.schema';
import { AddToListDto } from '../common/dto/add-to-list.dto';
import { WatchedRepository } from './watched.repository';
import { WatchlistRepository } from '../watchlist/watchlist.repository';
import { NotificationsService } from '../../../notifications/notifications.service';
import { NotificationType } from '../../../notifications/enums/notification-type.enum';

export interface WatchedItem {
  id: string;
  movieId: string;
  watchedAt: Date;
  rating?: number;
  createdAt: Date;
  movie: {
    tmdbId: number;
    title: string;
    posterPath?: string;
    voteAverage?: number;
  };
}

export interface PaginatedWatchedResult {
  data: WatchedItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class WatchedService {
  constructor(
    private readonly watchedRepository: WatchedRepository,
    private readonly watchlistRepository: WatchlistRepository,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Find or create movie by TMDB ID
   */
  private async findOrCreateMovie(dto: AddToListDto): Promise<Movie> {
    let movie = await this.dataSource.manager.findOne(Movie, {
      where: { tmdbId: dto.tmdbId },
    });

    if (!movie) {
      movie = this.dataSource.manager.create(Movie, {
        tmdbId: dto.tmdbId,
        title: dto.title,
        posterPath: dto.posterPath,
        overview: dto.overview,
        releaseDate: dto.releaseDate,
        voteAverage: dto.voteAverage,
        genres: dto.genres || [],
        runtime: dto.runtime,
      });
      movie = await this.dataSource.manager.save(movie);
    }

    return movie;
  }

  /**
   * Add movie to watched list
   * If movie is in watchlist, move it to watched (atomic transaction)
   */
  async add(userId: string, dto: AddToListDto): Promise<UserList> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // First, ensure movie exists in movies table
      let movie = await queryRunner.manager.findOne(Movie, {
        where: { tmdbId: dto.tmdbId },
      });

      if (!movie) {
        movie = queryRunner.manager.create(Movie, {
          tmdbId: dto.tmdbId,
          title: dto.title,
          posterPath: dto.posterPath,
          overview: dto.overview,
          releaseDate: dto.releaseDate,
          voteAverage: dto.voteAverage,
          genres: dto.genres || [],
          runtime: dto.runtime,
        });
        movie = await queryRunner.manager.save(movie);
      }

      // Check if already in watched list
      const existingInWatched = await queryRunner.manager.findOne(UserList, {
        where: {
          userId: userId.toString(),
          movieId: movie.id.toString(),
          listType: ListType.WATCHED,
        },
      });

      if (existingInWatched) {
        throw new ConflictException('Movie already in watched list');
      }

      // If movie is in watchlist, remove it first
      await queryRunner.manager.delete(UserList, {
        userId: userId.toString(),
        movieId: movie.id.toString(),
        listType: ListType.WATCHLIST,
      });

      // Create new watched entry with rating if provided
      const watchedItem = queryRunner.manager.create(UserList, {
        userId: userId.toString(),
        movieId: movie.id.toString(),
        listType: ListType.WATCHED,
        watchedAt: new Date(),
        rating: dto.rating || undefined,
      });

      const saved = await queryRunner.manager.save(watchedItem);
      await queryRunner.commitTransaction();

      // Create notification
      try {
        await this.notificationsService.create({
          userId: userId.toString(),
          type: NotificationType.SYSTEM,
          title: 'Marked as Watched',
          message: `${dto.title} was marked as watched`,
          data: { tmdbId: dto.tmdbId, listType: 'watched' },
        });
      } catch (error) {
        console.error('Failed to create notification:', error);
      }

      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Update rating for a watched movie
   */
  async updateRating(
    userId: string,
    movieId: string,
    rating: number,
  ): Promise<UserList> {
    const item = await this.watchedRepository.updateRating(
      userId,
      movieId,
      rating,
    );

    if (!item) {
      throw new NotFoundException('Movie not found in watched list');
    }

    return item;
  }

  /**
   * Remove movie from watched list
   */
  async remove(userId: string, movieId: string): Promise<void> {
    const item = await this.watchedRepository.findByUserAndMovie(
      userId,
      movieId,
      ListType.WATCHED,
    );

    if (!item) {
      throw new NotFoundException('Movie not found in watched list');
    }

    await this.dataSource.manager.remove(item);
  }

  /**
   * Get user's watched list with pagination
   */
  async getAll(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedWatchedResult> {
    const skip = (page - 1) * limit;

    const [data, total] = await this.watchedRepository.findByUserAndType(
      userId,
      ListType.WATCHED,
      skip,
      limit,
    );

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Check if movie is in watched list
   */
  async isInWatched(userId: string, tmdbId: number): Promise<boolean> {
    const movie = await this.dataSource.manager.findOne(Movie, {
      where: { tmdbId },
    });

    if (!movie) {
      return false;
    }

    const existing = await this.watchedRepository.findByUserAndMovie(
      userId,
      movie.id.toString(),
      ListType.WATCHED,
    );

    return !!existing;
  }
}
