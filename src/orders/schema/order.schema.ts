import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { OrderStatus } from '../types/order-status.enum';
import { OrderItem } from './order-item.schema';
import { Payment } from '../../payments/schema/payment.schema';

@Entity('orders')
@Index('idx_orders_user_id', ['userId'])
@Index('idx_orders_stripe_session', ['stripeCheckoutSessionId'])
@Index('idx_orders_status', ['status'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.AWAITING_CHECKOUT_SESSION,
  })
  status: OrderStatus;

  @Column({ type: 'int', name: 'subtotal' })
  subtotal: number;

  @Column({ type: 'int', name: 'tax_amount', default: 0 })
  taxAmount: number;

  @Column({ type: 'int', name: 'discount_amount', default: 0 })
  discountAmount: number;

  @Column({ type: 'int', name: 'total_amount' })
  totalAmount: number;

  @Column({ type: 'varchar', length: 3, default: 'usd' })
  currency: string;

  @Column({ type: 'uuid', name: 'payment_id', nullable: true })
  paymentId: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'stripe_checkout_session_id',
  })
  stripeCheckoutSessionId: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'stripe_payment_intent_id',
  })
  stripePaymentIntentId: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'reservation_expires_at' })
  reservationExpiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];

  @OneToOne(() => Payment, (payment) => payment.order)
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;
}
