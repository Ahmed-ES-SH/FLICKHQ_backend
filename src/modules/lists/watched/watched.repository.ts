import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { UserList, ListType } from '../schema/user-list.schema';

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

@Injectable()
export class WatchedRepository {
  constructor(private readonly dataSource: DataSource) {}

  private get repository(): Repository<UserList> {
    return this.dataSource.manager.getRepository(UserList);
  }

  /**
   * Find a specific user list entry by user, movie, and list type
   */
  async findByUserAndMovie(
    userId: string,
    movieId: string,
    listType: ListType,
  ): Promise<UserList | null> {
    return this.repository.findOne({
      where: {
        userId,
        movieId,
        listType,
      },
    });
  }

  /**
   * Get user's watched list with movie data and pagination
   */
  async findByUserAndType(
    userId: string,
    listType: ListType,
    skip: number,
    take: number,
  ): Promise<[WatchedItem[], number]> {
    const qb = this.dataSource.manager
      .createQueryBuilder(UserList, 'ul')
      .innerJoinAndSelect('ul.movie', 'm')
      .where('ul.userId = :userId', { userId })
      .andWhere('ul.listType = :listType', { listType })
      .orderBy('ul.watchedAt', 'DESC')
      .skip(skip)
      .take(take);

    const [items, total] = await qb.getManyAndCount();

    const result: WatchedItem[] = items.map((item) => ({
      id: item.id,
      movieId: item.movieId,
      watchedAt: item.watchedAt || item.createdAt,
      rating: item.rating || undefined,
      createdAt: item.createdAt,
      movie: {
        tmdbId: item.movie.tmdbId,
        title: item.movie.title,
        posterPath: item.movie.posterPath,
        voteAverage: item.movie.voteAverage,
      },
    }));

    return [result, total];
  }

  /**
   * Update rating for a watched movie
   */
  async updateRating(
    userId: string,
    movieId: string,
    rating: number,
  ): Promise<UserList | null> {
    const item = await this.repository.findOne({
      where: {
        userId,
        movieId,
        listType: ListType.WATCHED,
      },
    });

    if (!item) {
      return null;
    }

    item.rating = rating;
    return this.repository.save(item);
  }

  /**
   * Delete entry by user, movie, and list type
   */
  async deleteByUserAndMovie(
    userId: string,
    movieId: string,
    listType: ListType,
  ): Promise<void> {
    await this.repository.delete({
      userId,
      movieId,
      listType,
    });
  }
}
