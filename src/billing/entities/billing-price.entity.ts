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
import {
  BillingPriceType,
  BillingRecurringInterval,
} from '../common/billing.enums';
import { BillingPlan } from './billing-plan.entity';

@Entity('billing_prices')
@Index(['stripePriceId'], { unique: true })
@Index(['planId'])
@Index(['active'])
export class BillingPrice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'plan_id' })
  planId: string;

  @ManyToOne(() => BillingPlan, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan?: BillingPlan;

  @Column({ type: 'varchar', length: 255, name: 'stripe_price_id' })
  stripePriceId: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'stripe_product_id',
  })
  stripeProductId: string | null;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'int', name: 'unit_amount' })
  unitAmount: number;

  @Column({
    type: 'enum',
    enum: BillingPriceType,
    name: 'type',
  })
  type: BillingPriceType;

  @Column({
    type: 'enum',
    enum: BillingRecurringInterval,
    nullable: true,
  })
  interval: BillingRecurringInterval | null;

  @Column({ type: 'int', nullable: true, name: 'trial_period_days' })
  trialPeriodDays: number | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
