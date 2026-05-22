import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Payment } from './payment.schema';

export enum RefundStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

@Entity('refunds')
@Index('idx_refunds_order_id', ['orderId'])
@Index('idx_refunds_payment_id', ['paymentId'])
@Index('idx_refunds_stripe_refund_id', ['stripeRefundId'], { unique: true })
export class Refund {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'order_id' })
  orderId: string;

  @Column({ type: 'uuid', name: 'payment_id' })
  paymentId: string;

  @Column({ type: 'uuid', nullable: true, name: 'order_item_id' })
  orderItemId: string | null;

  @Column({ type: 'int', name: 'amount' })
  amount: number;

  @Column({ type: 'varchar', length: 3, default: 'usd' })
  currency: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    unique: true,
    name: 'stripe_refund_id',
  })
  stripeRefundId: string;

  @Column({
    type: 'enum',
    enum: RefundStatus,
    default: RefundStatus.PENDING,
  })
  status: RefundStatus;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Payment, (payment) => payment.refunds)
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;
}
