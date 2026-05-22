import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Order } from './order.schema';

@Entity('order_items')
@Index('idx_order_items_order_id', ['orderId'])
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'order_id' })
  orderId: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ type: 'uuid', name: 'product_id' })
  productId: string;

  @Column({ type: 'varchar', length: 300, name: 'product_title_snapshot' })
  productTitleSnapshot: string;

  @Column({
    type: 'varchar',
    nullable: true,
    name: 'product_thumbnail_snapshot',
  })
  productThumbnailSnapshot: string | null;

  @Column({ type: 'int', name: 'unit_price' })
  unitPrice: number;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'int' })
  subtotal: number;

  @Column({ type: 'varchar', length: 3, default: 'usd' })
  currency: string;

  @Column({ type: 'jsonb', default: {}, name: 'metadata_snapshot' })
  metadataSnapshot: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
