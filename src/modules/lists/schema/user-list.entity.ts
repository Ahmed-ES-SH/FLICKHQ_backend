import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { UserListItem } from './user-list-item.entity.js';

@Entity('user_lists')
@Index('uq_user_lists_user_key', ['userId', 'listKey'], { unique: true })
@Index('uq_user_lists_user_slug', ['userId', 'slug'], { unique: true })
@Index('ix_user_lists_user_recent', ['userId', 'createdAt'])
export class UserList {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ length: 80 })
  name: string;

  @Column({ length: 100 })
  slug: string;

  @Column({ name: 'list_key', length: 40 })
  listKey: string;

  @Column({ name: 'is_system', default: false })
  isSystem: boolean;

  @OneToMany(() => UserListItem, (item) => item.list)
  items: UserListItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
