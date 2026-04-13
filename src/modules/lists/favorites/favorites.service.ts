import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserList, ListType } from '../schema/user-list.schema';
import { Movie } from '../../movies/schema/movie.schema';
import { AddToListDto } from '../common/dto/add-to-list.dto';
import { FavoritesRepository } from './favorites.repository';
import { NotificationsService } from '../../../notifications/notifications.service';
import { NotificationType } from '../../../notifications/enums/notification-type.enum';

export interface FavoriteItem {
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

export interface PaginatedFavoritesResult {
  data: FavoriteItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class FavoritesService {
  constructor(
    private readonly favoritesRepository: FavoritesRepository,
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
   * Add movie to favorites
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

      // Check if already in favorites
      const existing = await queryRunner.manager.findOne(UserList, {
        where: {
          userId: userId.toString(),
          movieId: movie.id.toString(),
          listType: ListType.FAVORITES,
        },
      });

      if (existing) {
        throw new ConflictException('Movie already in favorites');
      }

      // Create new favorites entry
      const favoriteItem = queryRunner.manager.create(UserList, {
        userId: userId.toString(),
        movieId: movie.id.toString(),
        listType: ListType.FAVORITES,
      });

      const saved = await queryRunner.manager.save(favoriteItem);
      await queryRunner.commitTransaction();

      // Create notification
      try {
        await this.notificationsService.create({
          userId: userId.toString(),
          type: NotificationType.SYSTEM,
          title: 'Added to Favorites',
          message: `${dto.title} was added to your favorites`,
          data: { tmdbId: dto.tmdbId, listType: 'favorites' },
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
   * Remove movie from favorites
   */
  async remove(userId: string, movieId: string): Promise<void> {
    const item = await this.favoritesRepository.findByUserAndMovie(
      userId,
      movieId,
      ListType.FAVORITES,
    );

    if (!item) {
      throw new NotFoundException('Movie not found in favorites');
    }

    await this.dataSource.manager.remove(item);
  }

  /**
   * Get user's favorites list with pagination
   */
  async getAll(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedFavoritesResult> {
    const skip = (page - 1) * limit;

    const [data, total] = await this.favoritesRepository.findByUserAndType(
      userId,
      ListType.FAVORITES,
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
   * Check if movie is in favorites
   */
  async isInFavorites(userId: string, tmdbId: number): Promise<boolean> {
    const movie = await this.dataSource.manager.findOne(Movie, {
      where: { tmdbId },
    });

    if (!movie) {
      return false;
    }

    const existing = await this.favoritesRepository.findByUserAndMovie(
      userId,
      movie.id.toString(),
      ListType.FAVORITES,
    );

    return !!existing;
  }
}
