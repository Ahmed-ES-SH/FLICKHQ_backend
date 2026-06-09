import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { BillingWebhookEventStatus } from '../common/billing.enums';

@Entity('billing_webhook_events')
@Index(['stripeEventId'], { unique: true })
@Index(['eventType'])
@Index(['status'])
@Index(['receivedAt'])
export class BillingWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, name: 'stripe_event_id' })
  stripeEventId: string;

  @Column({ type: 'varchar', length: 150, name: 'event_type' })
  eventType: string;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'api_version' })
  apiVersion: string | null;

  @Column({ type: 'boolean', default: false })
  livemode: boolean;

  @Column({
    type: 'enum',
    enum: BillingWebhookEventStatus,
    default: BillingWebhookEventStatus.RECEIVED,
  })
  status: BillingWebhookEventStatus;

  @Column({ type: 'int', default: 0, name: 'processing_attempts' })
  processingAttempts: number;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @Column({ type: 'timestamp', name: 'received_at' })
  receivedAt: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'processed_at' })
  processedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
