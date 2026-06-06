import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import {
  BillingTransactionStatus,
  BillingTransactionType,
} from '../common/billing.enums';
import { BillingPayment } from './billing-payment.entity';
import { BillingInvoice } from './billing-invoice.entity';
import { BillingSubscription } from './billing-subscription.entity';

@Entity('billing_transactions')
@Index(['userId'])
@Index(['type'])
@Index(['status'])
@Index(['stripeChargeId'])
@Index(['stripeRefundId'])
@Index(['stripePaymentIntentId'])
export class BillingTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', name: 'user_id' })
  userId: number;

  @Column({ type: 'uuid', nullable: true, name: 'payment_id' })
  paymentId: string | null;

  @ManyToOne(() => BillingPayment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'payment_id' })
  payment?: BillingPayment | null;

  @Column({ type: 'uuid', nullable: true, name: 'invoice_id' })
  invoiceId: string | null;

  @ManyToOne(() => BillingInvoice, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invoice_id' })
  invoice?: BillingInvoice | null;

  @Column({ type: 'uuid', nullable: true, name: 'subscription_id' })
  subscriptionId: string | null;

  @ManyToOne(() => BillingSubscription, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'subscription_id' })
  subscription?: BillingSubscription | null;

  @Column({
    type: 'enum',
    enum: BillingTransactionType,
  })
  type: BillingTransactionType;

  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({
    type: 'enum',
    enum: BillingTransactionStatus,
    default: BillingTransactionStatus.PENDING,
  })
  status: BillingTransactionStatus;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'stripe_payment_intent_id',
  })
  stripePaymentIntentId: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'stripe_charge_id',
  })
  stripeChargeId: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'stripe_refund_id',
  })
  stripeRefundId: string | null;

  @Column({ type: 'timestamp', name: 'occurred_at' })
  occurredAt: Date;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
