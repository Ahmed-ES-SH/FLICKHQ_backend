import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { BillingSubscriptionStatus } from '../common/billing.enums';
import { BillingCustomer } from './billing-customer.entity';
import { BillingPlan } from './billing-plan.entity';
import { BillingPrice } from './billing-price.entity';

@Entity('billing_subscriptions')
@Index(['userId'])
@Index(['status'])
@Index(['stripeSubscriptionId'], { unique: true })
@Index(['stripeCheckoutSessionId'], { unique: true })
export class BillingSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', name: 'user_id' })
  userId: number;

  @Column({ type: 'uuid', name: 'billing_customer_id' })
  billingCustomerId: string;

  @ManyToOne(() => BillingCustomer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'billing_customer_id' })
  billingCustomer?: BillingCustomer;

  @Column({ type: 'uuid', nullable: true, name: 'plan_id' })
  planId: string | null;

  @ManyToOne(() => BillingPlan, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'plan_id' })
  plan?: BillingPlan | null;

  @Column({ type: 'uuid', nullable: true, name: 'price_id' })
  priceId: string | null;

  @ManyToOne(() => BillingPrice, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'price_id' })
  price?: BillingPrice | null;

  @Column({ type: 'varchar', length: 255, name: 'stripe_subscription_id' })
  stripeSubscriptionId: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'stripe_checkout_session_id',
  })
  stripeCheckoutSessionId: string | null;

  @Column({
    type: 'enum',
    enum: BillingSubscriptionStatus,
    default: BillingSubscriptionStatus.INCOMPLETE,
  })
  status: BillingSubscriptionStatus;

  @Column({ type: 'timestamp', nullable: true, name: 'current_period_start' })
  currentPeriodStart: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'current_period_end' })
  currentPeriodEnd: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'trial_end' })
  trialEnd: Date | null;

  @Column({ type: 'boolean', default: false, name: 'cancel_at_period_end' })
  cancelAtPeriodEnd: boolean;

  @Column({ type: 'timestamp', nullable: true, name: 'canceled_at' })
  canceledAt: Date | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'latest_invoice_id',
  })
  latestInvoiceId: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
