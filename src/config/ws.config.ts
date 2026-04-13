/**
 * WebSocket Configuration for Flick HQ Backend
 *
 * This file configures Socket.IO for real-time communication.
 * Uses WebSocket transport only (no long-polling) for RAM efficiency.
 *
 * The gateway handles:
 * - Real-time notifications
 * - Payment status updates
 * - List updates (watchlist, watched, favorites)
 *
 * Optional env variables:
 * - FRONTEND_URL: Used for CORS configuration
 */

import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplication } from '@nestjs/common';
import type { ServerOptions } from 'socket.io';
import type { Server, Socket } from 'socket.io';

/**
 * WebSocket data structure
 * Attached to every socket connection after JWT authentication
 */
export interface WebSocketData {
  userId: string;
  userName: string;
}

/**
 * Creates WebSocket configuration
 * - Uses WebSocket transport only (efficient)
 * - CORS enabled for frontend origin
 */
export const createWsConfig = () => ({
  // CORS configuration - allow credentials from frontend
  cors: {
    origin: '*',
    credentials: true,
  },
  // Use WebSocket only (no HTTP long-polling)
  // This saves RAM on free hosting
  transports: ['websocket'],
});

/**
 * Custom Socket.IO adapter for NestJS
 * Extends default adapter with custom CORS and transport settings
 */
export class SanadIoAdapter extends IoAdapter {
  constructor(app: INestApplication) {
    super(app);
  }

  /**
   * Create Socket.IO server with custom configuration
   * @param port - Port number for WebSocket server
   * @param options - Additional Socket.IO options
   * @returns Configured Socket.IO server instance
   */
  createIOServer(port: number, options?: ServerOptions): Server {
    return super.createIOServer(port, {
      ...options,
      cors: {
        // Use FRONTEND_URL for CORS, fallback to '*' for development
        origin: process.env.FRONTEND_URL || '*',
        credentials: true,
      },
      // WebSocket only for memory efficiency
      transports: ['websocket'],
    });
  }
}

/**
 * Typed Server type for Socket.IO
 * Used throughout the application for type-safe WebSocket operations
 */
export type TypedIoServer = Server<
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  WebSocketData
>;

/**
 * Typed Socket type for Socket.IO
 * Used in gateways for type-safe event handling
 */
export type TypedIoSocket = Socket<
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  WebSocketData
>;
