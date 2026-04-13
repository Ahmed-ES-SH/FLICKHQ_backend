import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('movies')
@Index('idx_movies_title_search', ['title'])
export class Movie {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', unique: true })
  tmdbId: number;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'text', nullable: true })
  overview?: string;

  @Column({ name: 'poster_path', type: 'text', nullable: true })
  posterPath?: string;

  @Column({ name: 'backdrop_path', type: 'text', nullable: true })
  backdropPath?: string;

  @Column({ name: 'release_date', type: 'date', nullable: true })
  releaseDate?: string;

  @Column({
    name: 'vote_average',
    type: 'decimal',
    precision: 3,
    scale: 1,
    nullable: true,
  })
  voteAverage?: number;

  @Column({ type: 'jsonb', default: [] })
  genres: string[];

  @Column({ type: 'int', nullable: true })
  runtime?: number;

  @CreateDateColumn()
  createdAt: Date;
}
