import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  BeforeInsert,
  BeforeUpdate,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Category } from '../../categories/schema/category.schema';

@Entity('articles')
@Index(['isPublished', 'publishedAt'])
@Index(['categoryId'])
export class Article {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'varchar', length: 350, unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  excerpt: string | null;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', nullable: true })
  coverImageUrl: string | null;

  @Column({ type: 'text', array: true, default: [] })
  tags: string[];

  @Column({ type: 'uuid', name: 'category_id', nullable: true })
  categoryId: string | null;

  @ManyToOne(() => Category, (category) => category.articles, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'category_id' })
  category: Category | null;

  @Column({ type: 'boolean', default: false })
  isPublished: boolean;

  @Column({ type: 'timestamp', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  readTimeMinutes: number;

  @Column({ type: 'int', default: 0 })
  viewsCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  @BeforeUpdate()
  normalizeTags() {
    if (this.tags) {
      this.tags = this.tags
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);
    }
  }
}
