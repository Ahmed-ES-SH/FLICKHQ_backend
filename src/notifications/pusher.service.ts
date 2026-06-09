import { Injectable, Logger } from '@nestjs/common';
import Pusher from 'pusher';
import { v4 as uuidv4 } from 'uuid';

export interface NotificationEventPayload {
  eventId: string;
  userId: string;
  notificationId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface PaymentStatusPayload {
  eventId: string;
  status: 'succeeded' | 'failed' | 'refunded';
  amount: number;
  description: string;
  timestamp: string;
}

@Injectable()
export class PusherService {
  private readonly logger = new Logger(PusherService.name);
  private readonly pusher: Pusher;
  private readonly maxRetries = 3;
  private readonly retryDelays = [500, 1000, 2000];

  constructor(pusherClient: Pusher) {
    this.pusher = pusherClient;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async triggerWithRetry(
    channel: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const eventId = payload.eventId as string;
    const userId = payload.userId as string;
    const startTime = Date.now();

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.retryDelays[attempt - 1] ?? 1000;
          this.logger.log(
            JSON.stringify({
              timestamp: new Date().toISOString(),
              level: 'info',
              service: 'pusher',
              event,
              channel,
              userId,
              eventId,
              attempt,
              maxAttempts: this.maxRetries,
              delay,
              status: 'retrying',
            }),
          );
          await this.delay(delay);
        }

        await this.pusher.trigger(channel, event, payload);

        const latency = Date.now() - startTime;
        this.logger.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'pusher',
            event,
            channel,
            userId,
            eventId,
            latency,
            status: 'success',
          }),
        );
        return;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';

        if (attempt === this.maxRetries) {
          this.logger.error(
            JSON.stringify({
              timestamp: new Date().toISOString(),
              level: 'error',
              service: 'pusher',
              event,
              channel,
              userId,
              eventId,
              error: errorMessage,
              attempt: attempt + 1,
              maxAttempts: this.maxRetries,
              status: 'failed',
            }),
          );
          return;
        }
      }
    }
  }

  async emitToUser(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const enrichedPayload: NotificationEventPayload = {
      eventId: uuidv4(),
      userId,
      notificationId: (payload.notificationId as string) || '',
      type: (payload.type as string) || '',
      title: (payload.title as string) || '',
      message: (payload.message as string) || '',
      data: payload.data as Record<string, unknown> | undefined,
      timestamp: new Date().toISOString(),
    };

    await this.triggerWithRetry(
      `private-user-${userId}`,
      'notification:new',
      enrichedPayload as unknown as Record<string, unknown>,
    );
  }

  async emitReadUpdate(userId: string, notificationId: string): Promise<void> {
    const payload = {
      eventId: uuidv4(),
      userId,
      notificationId,
      timestamp: new Date().toISOString(),
    };

    await this.triggerWithRetry(
      `private-user-${userId}`,
      'notification:read',
      payload,
    );
  }

  async emitReadAllUpdate(userId: string): Promise<void> {
    const payload = {
      eventId: uuidv4(),
      userId,
      timestamp: new Date().toISOString(),
    };

    await this.triggerWithRetry(
      `private-user-${userId}`,
      'notification:read_all',
      payload,
    );
  }

  async emitCountUpdate(userId: string, unreadCount: number): Promise<void> {
    const payload = {
      eventId: uuidv4(),
      userId,
      unreadCount,
      timestamp: new Date().toISOString(),
    };

    await this.triggerWithRetry(
      `private-user-${userId}`,
      'notification:count',
      payload,
    );
  }

  async emitDelete(userId: string, notificationId: string): Promise<void> {
    const payload = {
      eventId: uuidv4(),
      userId,
      notificationId,
      timestamp: new Date().toISOString(),
    };

    await this.triggerWithRetry(
      `private-user-${userId}`,
      'notification:delete',
      payload,
    );
  }

  async emitPaymentStatus(
    userId: string,
    payload: Omit<PaymentStatusPayload, 'eventId' | 'timestamp'>,
  ): Promise<void> {
    const enrichedPayload: PaymentStatusPayload = {
      eventId: uuidv4(),
      status: payload.status,
      amount: payload.amount,
      description: payload.description,
      timestamp: new Date().toISOString(),
    };

    await this.triggerWithRetry(
      `private-user-${userId}`,
      'payment:status',
      enrichedPayload as unknown as Record<string, unknown>,
    );
  }

  async broadcast(payload: Record<string, unknown>): Promise<void> {
    const enrichedPayload = {
      eventId: uuidv4(),
      ...payload,
      timestamp: new Date().toISOString(),
    };

    await this.triggerWithRetry(
      'broadcast',
      'notification:new',
      enrichedPayload,
    );
  }
}
