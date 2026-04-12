import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplication } from '@nestjs/common';
import type { ServerOptions } from 'socket.io';
import type { Server, Socket } from 'socket.io';

export interface WebSocketData {
  userId: string;
  userName: string;
}

export const createWsConfig = () => ({
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket'],
});

// Use default Socket.IO adapter (in-memory)
// WebSocket gateway works on the same application port without external adapters
export class SanadIoAdapter extends IoAdapter {
  constructor(app: INestApplication) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: process.env.FRONTEND_URL || '*',
        credentials: true,
      },
      transports: ['websocket'],
    });
  }
}

// Typed server and socket for use throughout the application
export type TypedIoServer = Server<
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  WebSocketData
>;

export type TypedIoSocket = Socket<
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  WebSocketData
>;
