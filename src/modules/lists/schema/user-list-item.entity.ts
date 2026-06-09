import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { MediaType } from '../enums/media-type.enum.js';
import { UserList } from './user-list.entity.js';

@Entity('user_list_items')
@Index('uq_list_item', ['listId', 'mediaType', 'tmdbId'], { unique: true })
@Index('ix_list_recent', ['listId', 'addedAt', 'id'])
@Index('ix_list_items_list_id', ['listId'])
export class UserListItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'list_id', type: 'uuid' })
  listId: string;

  @ManyToOne(() => UserList, (list) => list.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'list_id' })
  list: UserList;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ name: 'media_type', type: 'enum', enum: MediaType })
  mediaType: MediaType;

  @Column({ name: 'tmdb_id', type: 'int' })
  tmdbId: number;

  @Column({ length: 500 })
  title: string;

  @Column({ name: 'poster_path', type: 'varchar', length: 255, nullable: true })
  posterPath: string | null;

  @Column({ name: 'release_date', type: 'date', nullable: true })
  releaseDate: string | null;

  @Column({
    name: 'vote_average',
    type: 'numeric',
    precision: 4,
    scale: 1,
    nullable: true,
  })
  voteAverage: number | null;

  @CreateDateColumn({ name: 'added_at' })
  addedAt: Date;
}
