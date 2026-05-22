import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum OutboxEventStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('outbox_events')
@Index('idx_outbox_events_status', ['status'])
@Index('idx_outbox_events_created_at', ['createdAt'])
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, name: 'event_type' })
  eventType: string;

  @Column({ type: 'uuid', name: 'aggregate_id' })
  aggregateId: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: OutboxEventStatus,
    default: OutboxEventStatus.PENDING,
  })
  status: OutboxEventStatus;

  @Column({ type: 'int', name: 'retry_count', default: 0 })
  retryCount: number;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'processed_at' })
  processedAt: Date | null;
}
