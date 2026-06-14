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
import { PriceType, RecurringInterval } from '../common/subscription.enums';
import { Plan } from './plan.entity';

@Entity('prices')
@Index(['planId'])
@Index(['active'])
export class Price {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'plan_id' })
  planId: string;

  @ManyToOne(() => Plan, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan?: Plan;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'int', name: 'unit_amount' })
  unitAmount: number;

  @Column({ type: 'enum', enum: PriceType, name: 'type' })
  type: PriceType;

  @Column({ type: 'enum', enum: RecurringInterval, nullable: true })
  interval: RecurringInterval | null;

  @Column({ type: 'int', nullable: true, name: 'trial_period_days' })
  trialPeriodDays: number | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'varchar', length: 255, name: 'stripe_price_id', unique: true })
  stripePriceId: string;

  @Column({ type: 'varchar', length: 255, name: 'stripe_product_id', nullable: true })
  stripeProductId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
