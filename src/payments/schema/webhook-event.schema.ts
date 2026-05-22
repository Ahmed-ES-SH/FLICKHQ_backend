import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { WebhookEventStatus } from '../types/webhook-event-status.enum';

@Entity('webhook_events')
@Index('idx_webhook_events_stripe_event_id', ['stripeEventId'], {
  unique: true,
})
@Index('idx_webhook_events_status', ['status'])
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'varchar',
    length: 255,
    unique: true,
    name: 'stripe_event_id',
  })
  stripeEventId: string;

  @Column({ type: 'varchar', length: 100, name: 'event_type' })
  eventType: string;

  @Column({
    type: 'enum',
    enum: WebhookEventStatus,
    default: WebhookEventStatus.PENDING,
  })
  status: WebhookEventStatus;

  @Column({ type: 'int', name: 'processing_attempts', default: 0 })
  processingAttempts: number;

  @Column({ type: 'timestamp', nullable: true, name: 'processed_at' })
  processedAt: Date | null;

  @Column({ type: 'jsonb', name: 'payload_snapshot' })
  payloadSnapshot: Record<string, unknown>;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
