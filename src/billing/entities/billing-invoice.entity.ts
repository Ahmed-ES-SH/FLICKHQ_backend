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
import { BillingInvoiceStatus } from '../common/billing.enums';
import { BillingSubscription } from './billing-subscription.entity';

@Entity('billing_invoices')
@Index(['userId'])
@Index(['status'])
@Index(['stripeInvoiceId'], { unique: true })
export class BillingInvoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', name: 'user_id' })
  userId: number;

  @Column({ type: 'uuid', nullable: true, name: 'subscription_id' })
  subscriptionId: string | null;

  @ManyToOne(() => BillingSubscription, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'subscription_id' })
  subscription?: BillingSubscription | null;

  @Column({ type: 'varchar', length: 255, name: 'stripe_invoice_id' })
  stripeInvoiceId: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'stripe_payment_intent_id',
  })
  stripePaymentIntentId: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  number: string | null;

  @Column({
    type: 'enum',
    enum: BillingInvoiceStatus,
    default: BillingInvoiceStatus.DRAFT,
  })
  status: BillingInvoiceStatus;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'int', default: 0 })
  subtotal: number;

  @Column({ type: 'int', default: 0 })
  total: number;

  @Column({ type: 'int', default: 0, name: 'amount_paid' })
  amountPaid: number;

  @Column({ type: 'int', default: 0, name: 'amount_due' })
  amountDue: number;

  @Column({ type: 'text', nullable: true, name: 'hosted_invoice_url' })
  hostedInvoiceUrl: string | null;

  @Column({ type: 'text', nullable: true, name: 'invoice_pdf' })
  invoicePdf: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'period_start' })
  periodStart: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'period_end' })
  periodEnd: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'paid_at' })
  paidAt: Date | null;

  @Column({ type: 'jsonb', nullable: true, name: 'stripe_snapshot' })
  stripeSnapshot: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
