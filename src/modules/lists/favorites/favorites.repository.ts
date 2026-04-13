import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { UserList, ListType } from '../schema/user-list.schema';

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

@Injectable()
export class FavoritesRepository {
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
   * Get user's favorites list with movie data and pagination
   */
  async findByUserAndType(
    userId: string,
    listType: ListType,
    skip: number,
    take: number,
  ): Promise<[FavoriteItem[], number]> {
    const qb = this.dataSource.manager
      .createQueryBuilder(UserList, 'ul')
      .innerJoinAndSelect('ul.movie', 'm')
      .where('ul.userId = :userId', { userId })
      .andWhere('ul.listType = :listType', { listType })
      .orderBy('ul.createdAt', 'DESC')
      .skip(skip)
      .take(take);

    const [items, total] = await qb.getManyAndCount();

    const result: FavoriteItem[] = items.map((item) => ({
      id: item.id,
      movieId: item.movieId,
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
