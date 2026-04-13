import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Movie } from '../../movies/schema/movie.schema';

export enum ListType {
  WATCHLIST = 'watchlist',
  WATCHED = 'watched',
  FAVORITES = 'favorites',
}

@Entity('user_lists')
@Unique(['userId', 'movieId', 'listType'])
@Index('idx_user_lists_user_id', ['userId'])
@Index('idx_user_lists_user_list_type', ['userId', 'listType'])
@Index('idx_user_lists_movie_id', ['movieId'])
@Index('idx_user_lists_created_at', ['userId', 'listType', 'createdAt'])
export class UserList {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', name: 'movie_id' })
  movieId: string;

  @Column({
    type: 'enum',
    enum: ListType,
    name: 'list_type',
  })
  listType: ListType;

  @Column({ type: 'timestamp', nullable: true, name: 'watched_at' })
  watchedAt?: Date;

  @Column({ type: 'smallint', nullable: true })
  rating?: number;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Movie, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'movie_id' })
  movie: Movie;
}
