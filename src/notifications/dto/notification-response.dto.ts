import { Expose } from 'class-transformer';
import { NotificationType } from '../enums/notification-type.enum';

export class NotificationResponseDto {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  type: NotificationType;

  @Expose()
  title: string;

  @Expose()
  message: string;

  @Expose()
  data: Record<string, unknown> | null;

  @Expose()
  isRead: boolean;

  @Expose()
  readAt: Date | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
