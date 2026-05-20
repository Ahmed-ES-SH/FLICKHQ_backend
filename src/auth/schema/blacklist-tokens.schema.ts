import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('black_list_tokens')
export class BlackList {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Index()
  token: string;

  @Column()
  userId: string;

  @Column({ type: 'timestamp' })
  @Index()
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
