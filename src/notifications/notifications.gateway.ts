import { Injectable } from '@nestjs/common';
import { PusherService, PaymentStatusPayload } from './pusher.service';

export type PaymentStatusPayloadInput = Omit<
  PaymentStatusPayload,
  'eventId' | 'timestamp'
>;
export type { PaymentStatusPayload };

@Injectable()
export class NotificationsGateway {
  constructor(private readonly pusherService: PusherService) {}

  async emitToUser(userId: string, payload: unknown): Promise<void> {
    await this.pusherService.emitToUser(
      userId,
      payload as Record<string, unknown>,
    );
  }

  async emitReadUpdate(userId: string, notificationId: string): Promise<void> {
    await this.pusherService.emitReadUpdate(userId, notificationId);
  }

  async emitReadAllUpdate(userId: string): Promise<void> {
    await this.pusherService.emitReadAllUpdate(userId);
  }

  async emitCountUpdate(userId: string, unreadCount: number): Promise<void> {
    await this.pusherService.emitCountUpdate(userId, unreadCount);
  }

  async emitDelete(userId: string, notificationId: string): Promise<void> {
    await this.pusherService.emitDelete(userId, notificationId);
  }

  async emitPaymentStatus(
    userId: string,
    payload: PaymentStatusPayloadInput,
  ): Promise<void> {
    await this.pusherService.emitPaymentStatus(userId, payload);
  }

  async broadcast(payload: unknown): Promise<void> {
    await this.pusherService.broadcast(payload as Record<string, unknown>);
  }
}
