import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum PaymentStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

@Entity('payments')
@Index('idx_payments_user_id', ['userId'])
@Index('idx_payments_stripe_payment_intent', ['stripePaymentIntent'])
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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
