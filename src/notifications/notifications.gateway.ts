import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { WebSocketData } from '../config/ws.config';

export enum WsEvent {
  NOTIFICATION_NEW = 'notification:new',
  NOTIFICATION_READ = 'notification:read',
  NOTIFICATION_READ_ALL = 'notification:read_all',
  NOTIFICATION_COUNT = 'notification:count',
  NOTIFICATION_DELETE = 'notification:delete',
}

export interface ClientToServerEvents {
  [WsEvent.NOTIFICATION_READ]: (payload: { notificationId: string }) => void;
  [WsEvent.NOTIFICATION_READ_ALL]: () => void;
}

export interface ServerToClientEvents {
  [WsEvent.NOTIFICATION_NEW]: (payload: unknown) => void;
  [WsEvent.NOTIFICATION_READ]: (payload: { notificationId: string }) => void;
  [WsEvent.NOTIFICATION_READ_ALL]: () => void;
  [WsEvent.NOTIFICATION_COUNT]: (payload: { unreadCount: number }) => void;
  [WsEvent.NOTIFICATION_DELETE]: (payload: { notificationId: string }) => void;
}

export interface InterServerEvents {}

export type TypedWsServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  WebSocketData
>;

export type TypedWsSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  WebSocketData
>;

@WebSocketGateway()
@UseGuards(WsJwtGuard)
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: TypedWsServer;

  constructor(
    private readonly jwtService: JwtService,
    @Inject(ConfigService)
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: TypedWsSocket): Promise<void> {
    try {
      // Join user to their personal room for direct notifications
      await client.join(`user:${client.data.userId}`);
      console.log(
        `Client connected: ${client.id} - User: ${client.data.userId}`,
      );
    } catch (error) {
      console.error('WebSocket connection error:', error);
      client.disconnect();
    }
  }

  handleDisconnect(client: TypedWsSocket): void {
    console.log(`Client disconnected: ${client.id}`);
  }

  // Emit to specific user
  emitToUser(userId: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit(WsEvent.NOTIFICATION_NEW, payload);
  }

  // Emit read update to specific user
  emitReadUpdate(userId: string, notificationId: string): void {
    this.server.to(`user:${userId}`).emit(WsEvent.NOTIFICATION_READ, {
      notificationId,
    });
  }

  // Emit read all update to specific user
  emitReadAllUpdate(userId: string): void {
    this.server.to(`user:${userId}`).emit(WsEvent.NOTIFICATION_READ_ALL);
  }

  // Emit unread count update to specific user
  emitCountUpdate(userId: string, unreadCount: number): void {
    this.server.to(`user:${userId}`).emit(WsEvent.NOTIFICATION_COUNT, {
      unreadCount,
    });
  }

  // Emit delete update to specific user
  emitDelete(userId: string, notificationId: string): void {
    this.server.to(`user:${userId}`).emit(WsEvent.NOTIFICATION_DELETE, {
      notificationId,
    });
  }

  // Broadcast to all connected clients
  broadcast(payload: unknown): void {
    this.server.emit(WsEvent.NOTIFICATION_NEW, payload);
  }

  // Handle client marking a notification as read
  @SubscribeMessage(WsEvent.NOTIFICATION_READ)
  async handleMarkRead(
    @ConnectedSocket() client: TypedWsSocket,
    @MessageBody() payload: { notificationId: string },
  ): Promise<void> {
    // This is handled by the REST API, but we can add WebSocket support here if needed
    console.log(
      `User ${client.data.userId} marked notification ${payload.notificationId} as read via WebSocket`,
    );
  }

  // Handle client marking all notifications as read
  @SubscribeMessage(WsEvent.NOTIFICATION_READ_ALL)
  async handleMarkAllRead(
    @ConnectedSocket() client: TypedWsSocket,
  ): Promise<void> {
    // This is handled by the REST API, but we can add WebSocket support here if needed
    console.log(
      `User ${client.data.userId} marked all notifications as read via WebSocket`,
    );
  }
}
