import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { PaymentStatus } from './payment-status.enum';
import { PaymentType } from '../types/payment-type.enum';
import { Order } from '../../orders/schema/order.schema';
import { Refund } from './refund.schema';

@Entity('payments')
@Index('idx_payments_user_id', ['userId'])
@Index('idx_payments_stripe_payment_intent', ['stripePaymentIntent'])
@Index('idx_payments_stripe_session', ['stripeCheckoutSessionId'])
@Index('idx_payments_status', ['status'])
@Index('idx_payments_idempotency_key', ['idempotencyKey'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({
    type: 'varchar',
    length: 255,
    unique: true,
    name: 'stripe_payment_intent',
  })
  stripePaymentIntent: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'stripe_charge_id',
  })
  stripeChargeId?: string;

  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'varchar', length: 10, default: 'usd' })
  currency: string;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    unique: true,
    name: 'idempotency_key',
  })
  idempotencyKey?: string;

  @Column({ type: 'uuid', name: 'order_id', nullable: true })
  orderId: string | null;

  @OneToOne(() => Order, (order) => order.payment)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'stripe_checkout_session_id',
  })
  stripeCheckoutSessionId: string | null;

  @Column({ type: 'jsonb', nullable: true, name: 'line_items_snapshot' })
  lineItemsSnapshot: Record<string, unknown>[] | null;

  @Column({ type: 'enum', enum: PaymentType, default: PaymentType.ECOMMERCE })
  paymentType: PaymentType;

  @OneToMany(() => Refund, (refund) => refund.payment)
  refunds: Refund[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
