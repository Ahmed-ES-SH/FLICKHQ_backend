import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  BeforeInsert,
  BeforeUpdate,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Category } from '../../categories/schema/category.schema';

// ── JSONB shape types ──────────────────────────────────────────────

export interface ProductDimensions {
  width: number;
  height: number;
  depth: number;
}

export interface ProductReview {
  rating: number;
  comment: string;
  date: string;
  reviewerName: string;
  reviewerEmail: string;
}

// ── Entity ─────────────────────────────────────────────────────────

@Entity('products')
@Index('idx_products_slug', ['slug'], { unique: true })
@Index('idx_products_sku', ['sku'], { unique: true })
@Index('idx_products_category_id', ['categoryId'])
@Index('idx_products_is_published', ['isPublished'])
@Index('idx_products_price', ['price'])
@Index('idx_products_rating', ['rating'])
@Index('idx_products_title_description_search', ['title', 'description'])
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Identification ─────────────────────────────────────────────

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'varchar', length: 350, unique: true })
  slug: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text', nullable: true })
  shortDescription: string | null;

  // ── Pricing (DECIMAL — never Float for money) ──────────────────

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({
    name: 'discount_percentage',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
  })
  discountPercentage: number;

  /** Computed from price & discountPercentage — never written directly */
  @Column({
    name: 'discounted_price',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  discountedPrice: number;

  // ── Inventory ──────────────────────────────────────────────────

  @Column({ type: 'int', default: 0 })
  stock: number;

  @Column({ type: 'int', name: 'reserved_quantity', default: 0 })
  reservedQuantity: number;

  @Column({ type: 'varchar', length: 50, unique: true })
  sku: string;

  @Column({
    name: 'minimum_order_quantity',
    type: 'int',
    default: 1,
  })
  minimumOrderQuantity: number;

  @Column({
    name: 'availability_status',
    type: 'varchar',
    length: 50,
    default: 'In Stock',
  })
  availabilityStatus: string;

  // ── Classification ─────────────────────────────────────────────

  @Column({ type: 'uuid', name: 'category_id', nullable: true })
  categoryId: string | null;

  @ManyToOne(() => Category, (category) => category.products, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'category_id' })
  category: Category | null;

  @Column({ type: 'text', array: true, default: [] })
  tags: string[];

  @Column({ type: 'varchar', length: 100, nullable: true })
  brand: string | null;

  // ── Physical ───────────────────────────────────────────────────

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  weight: number | null;

  @Column({ type: 'jsonb', nullable: true })
  dimensions: ProductDimensions | null;

  // ── Media ──────────────────────────────────────────────────────

  @Column({ type: 'text', array: true, default: [] })
  images: string[];

  @Column({ type: 'varchar', nullable: true })
  thumbnail: string | null;

  // ── Policies ───────────────────────────────────────────────────

  @Column({
    name: 'warranty_information',
    type: 'text',
    nullable: true,
  })
  warrantyInformation: string | null;

  @Column({
    name: 'shipping_information',
    type: 'text',
    nullable: true,
  })
  shippingInformation: string | null;

  @Column({ name: 'return_policy', type: 'text', nullable: true })
  returnPolicy: string | null;

  // ── Reviews (JSONB — normalize to a separate table later if needed) ─

  @Column({ type: 'jsonb', default: [] })
  reviews: ProductReview[];

  /** Computed average rating from reviews */
  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  rating: number;

  // ── Meta ───────────────────────────────────────────────────────

  @Column({ type: 'varchar', nullable: true })
  barcode: string | null;

  @Column({ name: 'qr_code', type: 'varchar', nullable: true })
  qrCode: string | null;

  @Column({ name: 'is_published', type: 'boolean', default: false })
  isPublished: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date | null;

  // ── Hooks ──────────────────────────────────────────────────────

  /** Generate slug from title if not already set */
  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  @BeforeInsert()
  generateSlugOnInsert() {
    if (!this.slug && this.title) {
      this.slug = this.generateSlug(this.title);
    }
  }

  /** Normalize tags: trim, lowercase, remove empties */
  @BeforeInsert()
  @BeforeUpdate()
  normalizeTags() {
    if (this.tags) {
      this.tags = this.tags
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);
    }
  }

  /** Compute discountedPrice from price & discountPercentage */
  @BeforeInsert()
  @BeforeUpdate()
  computeDiscountedPrice() {
    if (this.price != null && this.discountPercentage != null) {
      const priceNum = Number(this.price);
      const discountNum = Number(this.discountPercentage);
      this.discountedPrice =
        Math.round((priceNum - (priceNum * discountNum) / 100) * 100) / 100;
    }
  }

  /** Compute average rating from reviews array */
  @BeforeInsert()
  @BeforeUpdate()
  computeRating() {
    if (this.reviews && this.reviews.length > 0) {
      const sum = this.reviews.reduce((acc, r) => acc + Number(r.rating), 0);
      this.rating = Math.round((sum / this.reviews.length) * 100) / 100;
    } else {
      this.rating = 0;
    }
  }
}
