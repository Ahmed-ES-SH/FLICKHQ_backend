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
import { BillingPaymentStatus } from '../common/billing.enums';
import { BillingCustomer } from './billing-customer.entity';
import { BillingPrice } from './billing-price.entity';

@Entity('billing_payments')
@Index(['userId'])
@Index(['status'])
@Index(['stripeCheckoutSessionId'], { unique: true })
@Index(['stripePaymentIntentId'], { unique: true })
export class BillingPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', name: 'user_id' })
  userId: number;

  @Column({ type: 'uuid', name: 'billing_customer_id' })
  billingCustomerId: string;

  @ManyToOne(() => BillingCustomer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'billing_customer_id' })
  billingCustomer?: BillingCustomer;

  @Column({ type: 'uuid', nullable: true, name: 'price_id' })
  priceId: string | null;

  @ManyToOne(() => BillingPrice, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'price_id' })
  price?: BillingPrice | null;

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

  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'int', default: 0, name: 'amount_refunded' })
  amountRefunded: number;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({
    type: 'enum',
    enum: BillingPaymentStatus,
    default: BillingPaymentStatus.CHECKOUT_CREATED,
  })
  status: BillingPaymentStatus;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
