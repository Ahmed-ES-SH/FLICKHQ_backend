import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserList, ListType } from '../schema/user-list.schema';
import { Movie } from '../../movies/schema/movie.schema';
import { AddToListDto } from '../dto/add-to-list.dto';
import { WatchlistRepository } from './watchlist.repository';
import { NotificationsService } from '../../../notifications/notifications.service';
import { NotificationType } from '../../../notifications/enums/notification-type.enum';

export interface WatchlistItem {
  id: string;
  movieId: string;
  createdAt: Date;
  movie: {
    tmdbId: number;
    title: string;
    posterPath?: string;
    voteAverage?: number;
  };
}

export interface PaginatedWatchlistResult {
  data: WatchlistItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class WatchlistService {
  constructor(
    private readonly watchlistRepository: WatchlistRepository,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Add movie to watchlist
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
        });
        movie = await queryRunner.manager.save(movie);
      }

      // Check if already in watchlist
      const existing = await queryRunner.manager.findOne(UserList, {
        where: {
          userId,
          movieId: movie.id.toString(),
          listType: ListType.WATCHLIST,
        },
      });

      if (existing) {
        throw new ConflictException('Movie already in watchlist');
      }

      // Create new watchlist entry
      const watchlistItem = queryRunner.manager.create(UserList, {
        userId,
        movieId: movie.id.toString(),
        listType: ListType.WATCHLIST,
      });

      const saved = await queryRunner.manager.save(watchlistItem);
      await queryRunner.commitTransaction();

      // Create notification (outside transaction)
      try {
        await this.notificationsService.create({
          userId,
          type: NotificationType.SYSTEM,
          title: 'Added to Watchlist',
          message: `${dto.title} was added to your watchlist`,
          data: { tmdbId: dto.tmdbId, listType: 'watchlist' },
        });
      } catch (error) {
        console.error('Failed to create notification:', error);
      }

      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      if (error instanceof ConflictException) throw error;
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Remove movie from watchlist
   */
  async remove(userId: string, movieId: string): Promise<void> {
    const item = await this.watchlistRepository.findByUserAndMovie(
      userId,
      movieId,
      ListType.WATCHLIST,
    );

    if (!item) {
      throw new NotFoundException('Movie not found in watchlist');
    }

    await this.dataSource.manager.remove(item);
  }

  /**
   * Get user's watchlist with pagination
   */
  async getAll(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedWatchlistResult> {
    const skip = (page - 1) * limit;

    const [data, total] = await this.watchlistRepository.findByUserAndType(
      userId,
      ListType.WATCHLIST,
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
   * Check if movie is in watchlist
   */
  async isInWatchlist(userId: string, tmdbId: number): Promise<boolean> {
    const movie = await this.dataSource.manager.findOne(Movie, {
      where: { tmdbId },
    });

    if (!movie) {
      return false;
    }

    const existing = await this.watchlistRepository.findByUserAndMovie(
      userId,
      movie.id.toString(),
      ListType.WATCHLIST,
    );

    return !!existing;
  }
}
