import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { BillingSubscriptionStatus } from '../../billing/common/billing.enums';

@Entity('plan_subscription_history')
@Index(['userId', 'occurredAt'])
@Index(['subscriptionId'])
export class PlanSubscriptionHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', name: 'user_id' })
  userId: number;

  @Column({ type: 'uuid', nullable: true, name: 'subscription_id' })
  subscriptionId: string | null;

  @Column({
    type: 'enum',
    enum: BillingSubscriptionStatus,
    nullable: true,
    name: 'previous_status',
  })
  previousStatus: BillingSubscriptionStatus | null;

  @Column({
    type: 'enum',
    enum: BillingSubscriptionStatus,
    name: 'new_status',
  })
  newStatus: BillingSubscriptionStatus;

  @Column({ type: 'uuid', nullable: true, name: 'plan_id' })
  planId: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'price_id' })
  priceId: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'stripe_event_id',
    unique: true,
  })
  stripeEventId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @Column({ type: 'timestamp', name: 'occurred_at' })
  occurredAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
