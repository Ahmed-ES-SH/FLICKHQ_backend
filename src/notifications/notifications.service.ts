import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inject } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { NotificationsGateway } from './notifications.gateway';
import { Notification } from './schema/notification.schema';
import { NotificationPreferences } from './schema/notification-preferences.schema';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { PaginationQueryDto } from './dto/paginate-notifications.dto';
import { NOTIFICATION_EVENTS } from './events/notification.events';
import { NotificationType } from './enums/notification-type.enum';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,
    @InjectRepository(NotificationPreferences)
    private preferencesRepository: Repository<NotificationPreferences>,
    private eventEmitter: EventEmitter2,
    @Inject(NotificationsGateway)
    private notificationsGateway: NotificationsGateway,
  ) {}

  async create(dto: CreateNotificationDto): Promise<Notification> {
    try {
      const notification = this.notificationRepository.create({
        userId: dto.userId,
        type: dto.type,
        title: dto.title,
        message: dto.message,
        data: dto.data || null,
        isRead: false,
      });

      const saved = await this.notificationRepository.save(notification);

      // Emit real-time notification
      this.notificationsGateway.emitToUser(dto.userId, saved);

      return saved;
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new InternalServerErrorException(error.message);
      }
      throw new InternalServerErrorException('Failed to create notification');
    }
  }

  async findAllForUser(
    userId: string,
    pagination: PaginationQueryDto,
  ): Promise<{
    data: Notification[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const { page = 1, limit = 20 } = pagination;
      const skip = (page - 1) * limit;

      const [data, total] = await this.notificationRepository.findAndCount({
        where: { userId, isDeleted: false },
        order: { createdAt: 'DESC' },
        take: limit,
        skip,
      });

      return { data, total, page, limit };
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new InternalServerErrorException(error.message);
      }
      throw new InternalServerErrorException('Failed to fetch notifications');
    }
  }

  async countUnread(userId: string): Promise<number> {
    try {
      return await this.notificationRepository.count({
        where: { userId, isRead: false, isDeleted: false },
      });
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new InternalServerErrorException(error.message);
      }
      throw new InternalServerErrorException(
        'Failed to count unread notifications',
      );
    }
  }

  async markAsRead(id: string, userId: string): Promise<Notification> {
    try {
      const notification = await this.notificationRepository.findOne({
        where: { id, isDeleted: false },
      });

      if (!notification) {
        throw new NotFoundException('Notification not found');
      }

      if (notification.userId !== userId) {
        throw new ForbiddenException(
          'You can only mark your own notifications as read',
        );
      }

      notification.isRead = true;
      notification.readAt = new Date();

      const updated = await this.notificationRepository.save(notification);

      // Emit read update
      this.notificationsGateway.emitReadUpdate(userId, id);

      return updated;
    } catch (error: unknown) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      if (error instanceof Error) {
        throw new InternalServerErrorException(error.message);
      }
      throw new InternalServerErrorException(
        'Failed to mark notification as read',
      );
    }
  }

  async markAllAsRead(userId: string): Promise<void> {
    try {
      await this.notificationRepository.update(
        { userId, isRead: false, isDeleted: false },
        { isRead: true, readAt: new Date() },
      );

      // Emit read update for all
      this.notificationsGateway.emitReadAllUpdate(userId);
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new InternalServerErrorException(error.message);
      }
      throw new InternalServerErrorException(
        'Failed to mark all notifications as read',
      );
    }
  }

  async softDelete(id: string, userId: string): Promise<void> {
    try {
      const notification = await this.notificationRepository.findOne({
        where: { id, isDeleted: false },
      });

      if (!notification) {
        throw new NotFoundException('Notification not found');
      }

      if (notification.userId !== userId) {
        throw new ForbiddenException(
          'You can only delete your own notifications',
        );
      }

      notification.isDeleted = true;
      await this.notificationRepository.save(notification);
    } catch (error: unknown) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      if (error instanceof Error) {
        throw new InternalServerErrorException(error.message);
      }
      throw new InternalServerErrorException('Failed to delete notification');
    }
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    try {
      let preferences = await this.preferencesRepository.findOne({
        where: { userId },
      });

      if (!preferences) {
        // Create default preferences
        preferences = this.preferencesRepository.create({
          userId,
          orderNotifications: true,
          paymentNotifications: true,
          systemNotifications: true,
          emailEnabled: true,
          pushEnabled: true,
        });
        await this.preferencesRepository.save(preferences);
      }

      return preferences;
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new InternalServerErrorException(error.message);
      }
      throw new InternalServerErrorException('Failed to get preferences');
    }
  }

  async updatePreferences(
    userId: string,
    updates: UpdatePreferencesDto,
  ): Promise<NotificationPreferences> {
    try {
      const preferences = await this.getPreferences(userId);

      Object.assign(preferences, updates);
      return await this.preferencesRepository.save(preferences);
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new InternalServerErrorException(error.message);
      }
      throw new InternalServerErrorException('Failed to update preferences');
    }
  }

  // Admin methods

  async adminSendToUser(dto: CreateNotificationDto): Promise<Notification> {
    return this.create(dto);
  }

  async adminBroadcast(
    title: string,
    message: string,
    data?: Record<string, unknown>,
    targetUserIds?: string[],
  ): Promise<void> {
    try {
      if (targetUserIds && targetUserIds.length > 0) {
        // Send to specific users
        const notifications = targetUserIds.map((userId) =>
          this.notificationRepository.create({
            userId,
            type: NotificationType.BROADCAST,
            title,
            message,
            data: data || null,
            isRead: false,
          }),
        );

        await this.notificationRepository.save(notifications);

        // Emit to each user
        for (const userId of targetUserIds) {
          const userNotifications = notifications.filter(
            (n) => n.userId === userId,
          );
          this.notificationsGateway.emitToUser(userId, userNotifications[0]);
        }
      } else {
        // This would require fetching all users - use event emitter for system-wide
        this.eventEmitter.emit(NOTIFICATION_EVENTS.ORDER_UPDATED, {
          title,
          message,
          data,
        });
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new InternalServerErrorException(error.message);
      }
      throw new InternalServerErrorException(
        'Failed to broadcast notification',
      );
    }
  }

  async adminFindAll(pagination: PaginationQueryDto): Promise<{
    data: Notification[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const { page = 1, limit = 20 } = pagination;
      const skip = (page - 1) * limit;

      const [data, total] = await this.notificationRepository.findAndCount({
        where: { isDeleted: false },
        order: { createdAt: 'DESC' },
        take: limit,
        skip,
      });

      return { data, total, page, limit };
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new InternalServerErrorException(error.message);
      }
      throw new InternalServerErrorException('Failed to fetch notifications');
    }
  }

  async adminHardDelete(id: string): Promise<void> {
    try {
      const result = await this.notificationRepository.delete(id);
      if (result.affected === 0) {
        throw new NotFoundException('Notification not found');
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (error instanceof Error) {
        throw new InternalServerErrorException(error.message);
      }
      throw new InternalServerErrorException('Failed to delete notification');
    }
  }

  // Event handlers

  @OnEvent(NOTIFICATION_EVENTS.ORDER_UPDATED)
  async handleOrderUpdated(payload: {
    userId: string;
    orderId: string;
    status: string;
    title: string;
    message: string;
  }): Promise<void> {
    await this.create({
      userId: payload.userId,
      type: NotificationType.ORDER_UPDATED,
      title: payload.title,
      message: payload.message,
      data: { orderId: payload.orderId, status: payload.status },
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.PAYMENT_SUCCESS)
  async handlePaymentSuccess(payload: {
    userId: string;
    paymentId: string;
    amount: number;
    title: string;
    message: string;
  }): Promise<void> {
    await this.create({
      userId: payload.userId,
      type: NotificationType.PAYMENT_SUCCESS,
      title: payload.title,
      message: payload.message,
      data: { paymentId: payload.paymentId, amount: payload.amount },
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.PAYMENT_FAILED)
  async handlePaymentFailed(payload: {
    userId: string;
    paymentId: string;
    amount: number;
    reason: string;
    title: string;
    message: string;
  }): Promise<void> {
    await this.create({
      userId: payload.userId,
      type: NotificationType.PAYMENT_FAILED,
      title: payload.title,
      message: payload.message,
      data: {
        paymentId: payload.paymentId,
        amount: payload.amount,
        reason: payload.reason,
      },
    });
  }
}
