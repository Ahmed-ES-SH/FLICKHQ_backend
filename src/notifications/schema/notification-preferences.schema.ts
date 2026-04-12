import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('notification_preferences')
@Index(['userId'], { unique: true })
export class NotificationPreferences {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id', unique: true })
  userId: string;

  @Column({ type: 'boolean', default: true, name: 'order_notifications' })
  orderNotifications: boolean;

  @Column({ type: 'boolean', default: true, name: 'payment_notifications' })
  paymentNotifications: boolean;

  @Column({ type: 'boolean', default: true, name: 'system_notifications' })
  systemNotifications: boolean;

  @Column({ type: 'boolean', default: true, name: 'email_enabled' })
  emailEnabled: boolean;

  @Column({ type: 'boolean', default: true, name: 'push_enabled' })
  pushEnabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
