---
name: websocket-nextjs
description: >
  Production-grade Socket.IO v4 implementation for NestJS (server) + Next.js App Router
  (client), with an obsessive focus on TypeScript type safety. Use this skill whenever
  the user asks to build real-time features in a NestJS/Next.js stack — notifications,
  live chat, presence, typing indicators, or any persistent bidirectional communication.
  Trigger on any mention of: "WebSocket", "real-time", "socket.io", "live notifications",
  "chat", "ws", "push updates", "online users", "typing indicator", or "live feed"
  in a NestJS or Next.js context. Always use this skill even if the user only says
  "I want users to get notified in real time" — that is a WebSocket/Socket.IO use case.
---

# Socket.IO v4 — NestJS + Next.js — Senior WebSocket Skill

## 🧠 Identity & Philosophy

This skill produces **strictly typed, production-grade Socket.IO v4 code** for two frameworks only:

- **NestJS** — WebSocket gateway (server)
- **Next.js App Router** — socket.io-client hooks and components (client)

The Socket.IO v4 TypeScript system has four generic parameters on the server:

```ts
Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
```

All four must always be provided. `SocketData` types `socket.data` — no casting required anywhere. `InterServerEvents` types `io.serverSideEmit()` for multi-instance NestJS coordination via the Redis adapter. This is not optional ceremony — it is the only way to achieve full type safety across the stack.

> **Socket.IO is NOT a plain WebSocket implementation.** It adds a protocol layer on top (Engine.IO). A plain WebSocket client cannot connect to a Socket.IO server. Always use `socket.io-client` on the Next.js side — never the browser's native `WebSocket`.

---

## 📁 Mandatory File Structure

```
/                                        ← monorepo root (or shared package)
├── ws/
│   ├── ws.events.ts                     ← WsEvent enum — ALL event name constants
│   ├── ws.payloads.ts                   ← typed payload interfaces for every event
│   └── ws.types.ts                      ← all 4 Socket.IO generics + AppSocket alias
│
/apps/api  (NestJS)
├── src/
│   ├── config/
│   │   └── ws.config.ts                 ← RedisIoAdapter — uses ioredis, not redis pkg
│   └── modules/
│       ├── chat/
│       │   ├── chat.module.ts
│       │   ├── chat.gateway.ts
│       │   └── chat.service.ts
│       └── notifications/
│           ├── notification.module.ts
│           ├── notification.gateway.ts
│           └── notification.service.ts
│
/apps/web   (Next.js)
├── lib/
│   └── socket.ts                        ← singleton socket instance
└── hooks/
    ├── useSocket.ts
    ├── useNotifications.ts
    └── useChat.ts
```

---

## 🔑 The Type Contract — Four Generics, Zero Shortcuts

### `ws/ws.events.ts`

Event names are **never** raw strings anywhere in the codebase. Every `.emit()` and `.on()` call uses a value from this enum.

```ts
// ws/ws.events.ts
export enum WsEvent {
  // ─── Auth ───────────────────────────────────────────────────
  WS_AUTH             = "ws:auth",
  WS_UNAUTHORIZED     = "ws:unauthorized",
  WS_ERROR            = "ws:error",

  // ─── Notifications ──────────────────────────────────────────
  NOTIFICATION_NEW        = "notification:new",
  NOTIFICATION_READ       = "notification:read",
  NOTIFICATION_READ_ALL   = "notification:read_all",
  NOTIFICATION_COUNT      = "notification:count",

  // ─── Chat ───────────────────────────────────────────────────
  CHAT_JOIN_ROOM          = "chat:join_room",
  CHAT_LEAVE_ROOM         = "chat:leave_room",
  CHAT_SEND_MESSAGE       = "chat:send_message",
  CHAT_MESSAGE_RECEIVED   = "chat:message_received",
  CHAT_TYPING_START       = "chat:typing_start",
  CHAT_TYPING_STOP        = "chat:typing_stop",
  CHAT_TYPING_UPDATE      = "chat:typing_update",
  CHAT_ROOM_HISTORY       = "chat:room_history",
  CHAT_MESSAGE_READ       = "chat:message_read",

  // ─── Presence ───────────────────────────────────────────────
  PRESENCE_UPDATE         = "presence:update",

  // ─── Inter-server (for serverSideEmit across NestJS instances)
  SERVER_INVALIDATE_USER  = "server:invalidate_user",
}
```

---

### `ws/ws.payloads.ts`

```ts
// ws/ws.payloads.ts
import type { NotificationType, MessageStatus, PresenceStatus } from "./ws.types";

// ─── Auth ──────────────────────────────────────────────────────────────────
export interface WsAuthPayload    { token: string }
export interface WsAuthAckPayload { userId: string; success: boolean }
export interface WsErrorPayload   { event: string; message: string; code: number }

// ─── Notifications ─────────────────────────────────────────────────────────
export interface NotificationPayload {
  id:        string;
  type:      NotificationType;
  title:     string;
  body:      string;
  isRead:    boolean;
  createdAt: string;          // ISO 8601 string — never Date on the wire
  metadata:  Record<string, string | number | boolean>;
}
export interface NotificationReadPayload  { notificationId: string }
export interface NotificationCountPayload { unreadCount: number }

// ─── Chat ──────────────────────────────────────────────────────────────────
export interface ChatJoinRoomPayload  { roomId: string }
export interface ChatLeaveRoomPayload { roomId: string }

export interface ChatSendMessagePayload {
  roomId:           string;
  content:          string;
  replyToMessageId: string | null;
}

// Acknowledgement shape returned by the server on CHAT_SEND_MESSAGE
export interface ChatSendMessageAck {
  messageId: string;
  status:    MessageStatus;
}

export interface ChatMessagePayload {
  id:               string;
  roomId:           string;
  senderId:         string;
  senderName:       string;
  senderAvatarUrl:  string | null;
  content:          string;
  status:           MessageStatus;
  replyToMessageId: string | null;
  createdAt:        string;         // ISO 8601
}

export interface ChatTypingPayload {
  roomId:   string;
  userId:   string;
  userName: string;
}

export interface ChatTypingUpdatePayload {
  roomId:      string;
  typingUsers: Array<{ userId: string; userName: string }>;
}

export interface ChatRoomHistoryPayload {
  roomId:     string;
  messages:   ChatMessagePayload[];
  hasMore:    boolean;
  nextCursor: string | null;
}

export interface ChatMessageReadPayload {
  roomId:       string;
  messageId:    string;
  readByUserId: string;
}

// ─── Presence ──────────────────────────────────────────────────────────────
export interface PresencePayload {
  userId:   string;
  status:   PresenceStatus;
  lastSeen: string;          // ISO 8601
}
```

---

### `ws/ws.types.ts` — The Four Generics

This is the most critical file. It defines the complete Socket.IO type contract for both sides.

```ts
// ws/ws.types.ts
import type { Socket } from "socket.io-client";
import type {
  WsAuthPayload, WsAuthAckPayload, WsErrorPayload,
  NotificationPayload, NotificationReadPayload, NotificationCountPayload,
  ChatJoinRoomPayload, ChatLeaveRoomPayload, ChatSendMessagePayload,
  ChatSendMessageAck, ChatMessagePayload, ChatTypingPayload,
  ChatTypingUpdatePayload, ChatRoomHistoryPayload, ChatMessageReadPayload,
  PresencePayload,
} from "./ws.payloads";
import { WsEvent } from "./ws.events";

// ─── Shared enums ──────────────────────────────────────────────────────────
export enum NotificationType {
  INFO = "info", SUCCESS = "success", WARNING = "warning",
  ERROR = "error", MENTION = "mention", REPLY = "reply", SYSTEM = "system",
}
export enum MessageStatus {
  SENT = "sent", DELIVERED = "delivered", READ = "read", FAILED = "failed",
}
export enum PresenceStatus {
  ONLINE = "online", AWAY = "away", OFFLINE = "offline",
}

// ─── Generic 1: Client → Server ────────────────────────────────────────────
// What the server RECEIVES (@SubscribeMessage handlers)
export interface ClientToServerEvents {
  [WsEvent.WS_AUTH]:              (payload: WsAuthPayload)           => void;
  [WsEvent.NOTIFICATION_READ]:    (payload: NotificationReadPayload) => void;
  [WsEvent.NOTIFICATION_READ_ALL]: ()                                => void;
  [WsEvent.CHAT_JOIN_ROOM]:       (payload: ChatJoinRoomPayload)     => void;
  [WsEvent.CHAT_LEAVE_ROOM]:      (payload: ChatLeaveRoomPayload)    => void;
  // With acknowledgement — client uses emitWithAck; server returns the ack value
  [WsEvent.CHAT_SEND_MESSAGE]: (
    payload: ChatSendMessagePayload,
    ack: (response: ChatSendMessageAck) => void
  ) => void;
  [WsEvent.CHAT_TYPING_START]:    (payload: ChatTypingPayload)       => void;
  [WsEvent.CHAT_TYPING_STOP]:     (payload: ChatTypingPayload)       => void;
  [WsEvent.CHAT_MESSAGE_READ]:    (payload: ChatMessageReadPayload)  => void;
}

// ─── Generic 2: Server → Client ────────────────────────────────────────────
// What the server EMITS (.emit / .to().emit)
export interface ServerToClientEvents {
  [WsEvent.WS_AUTH]:               (ack: WsAuthAckPayload)         => void;
  [WsEvent.WS_UNAUTHORIZED]:       ()                              => void;
  [WsEvent.WS_ERROR]:              (e: WsErrorPayload)             => void;
  [WsEvent.NOTIFICATION_NEW]:      (n: NotificationPayload)        => void;
  [WsEvent.NOTIFICATION_COUNT]:    (n: NotificationCountPayload)   => void;
  [WsEvent.CHAT_MESSAGE_RECEIVED]: (m: ChatMessagePayload)         => void;
  [WsEvent.CHAT_TYPING_UPDATE]:    (t: ChatTypingUpdatePayload)    => void;
  [WsEvent.CHAT_ROOM_HISTORY]:     (h: ChatRoomHistoryPayload)     => void;
  [WsEvent.CHAT_MESSAGE_READ]:     (p: ChatMessageReadPayload)     => void;
  [WsEvent.PRESENCE_UPDATE]:       (p: PresencePayload)            => void;
}

// ─── Generic 3: InterServerEvents ──────────────────────────────────────────
// Typed by io.serverSideEmit() — communication between NestJS instances
// Only works when the Redis adapter is configured
export interface InterServerEvents {
  [WsEvent.SERVER_INVALIDATE_USER]: (userId: string) => void;
}

// ─── Generic 4: SocketData ─────────────────────────────────────────────────
// Types socket.data — stamped by WsJwtGuard on every connection
// Added in socket.io@4.4.0. No casts needed anywhere.
export interface SocketData {
  userId:   string;
  userName: string;
}

// ─── Typed aliases — use everywhere, never raw Server or Socket ─────────────

// Next.js client — IMPORTANT: generics are REVERSED on the client side
// Socket<what-you-receive, what-you-send> = Socket<ServerToClient, ClientToServer>
export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// NestJS server — all 4 generics required
export type TypedWsServer = import("socket.io").Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

// NestJS handler socket — all 4 generics required
export type TypedWsSocket = import("socket.io").Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
```

> **Why reversed generics on the client?** The Socket.IO docs explicitly confirm this: on the client, the type is `Socket<ServerToClientEvents, ClientToServerEvents>`. The first parameter is what the client _receives_, the second is what it _sends_. This is the opposite of the server. Swapping them is the most common TypeScript mistake with Socket.IO.

---

## 🏗️ NestJS — Server Layer

### `config/ws.config.ts` — Redis Adapter

> **From the docs — critical warnings:**
> 1. Use `ioredis`, NOT the `redis` package. The `redis` package has confirmed issues restoring subscriptions after reconnection.
> 2. When using `transports: ["websocket"]` only (no long-polling), sticky sessions are NOT required. If long-polling is enabled, sticky sessions are always required even with the Redis adapter.
> 3. The standard Redis adapter does **NOT** support Connection State Recovery (`socket.io@4.6.0+`). Use `@socket.io/redis-streams-adapter` if you need recovery of missed events after reconnection.

```ts
// config/ws.config.ts
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";                         // ← ioredis, never redis pkg
import { ConfigService } from "@nestjs/config";
import { INestApplication } from "@nestjs/common";
import type { ServerOptions } from "socket.io";

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor!: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplication,
    private readonly configService: ConfigService
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const url       = this.configService.getOrThrow<string>("REDIS_URL");
    const pubClient = new Redis(url);
    const subClient = pubClient.duplicate();
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin:      this.configService.getOrThrow<string>("FRONTEND_URL"),
        credentials: true,
      },
      // WebSocket only — eliminates the sticky session requirement
      // Remove if you need the HTTP long-polling fallback
      transports: ["websocket"],
    });
    server.adapter(this.adapterConstructor);
    return server;
  }
}
```

```ts
// main.ts
const configService    = app.get(ConfigService);
const redisIoAdapter   = new RedisIoAdapter(app, configService);
await redisIoAdapter.connectToRedis();
app.useWebSocketAdapter(redisIoAdapter);
await app.listen(3000);
```

---

### `WsJwtGuard`

`socket.data` is typed by the `SocketData` generic — no casting required after the guard stamps it.

```ts
// modules/auth/guards/ws-jwt.guard.ts
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import type { TypedWsSocket } from "../../../../ws/ws.types";

interface JwtPayload { sub: string; name: string; iat: number; exp: number }

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(
    private readonly jwtService:    JwtService,
    private readonly configService: ConfigService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<TypedWsSocket>();
    const token  = this.extractToken(client);

    if (!token) {
      client.emit(WsEvent.WS_UNAUTHORIZED);
      return false;
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>("JWT_SECRET"),
      });
      // socket.data is typed via SocketData — no type assertion needed
      client.data.userId   = payload.sub;
      client.data.userName = payload.name;
      return true;
    } catch {
      client.emit(WsEvent.WS_UNAUTHORIZED);
      return false;
    }
  }

  private extractToken(client: TypedWsSocket): string | null {
    const auth = client.handshake.auth as Record<string, unknown>;
    return typeof auth["token"] === "string" ? auth["token"] : null;
  }
}
```

---

### `chat.gateway.ts`

Key Socket.IO v4 patterns applied:

| Pattern | Used for | Doc basis |
|---|---|---|
| `socket.to(room).emit()` | `CHAT_MESSAGE_READ` — excludes sender | Rooms doc |
| `this.server.to(room).emit()` | `CHAT_MESSAGE_RECEIVED` — includes all | Rooms doc |
| `await client.join()` | `CHAT_JOIN_ROOM` | `join()` returns a Promise |
| Acknowledgement (return value from handler) | `CHAT_SEND_MESSAGE` | Acknowledgements doc |
| `volatile.emit` | Typing updates | Volatile events doc |
| No room cleanup in `handleDisconnect` | Auto-leave on disconnect | Rooms doc |
| Per-user room `user:{userId}` | Targeted notification delivery | Rooms doc |

```ts
// modules/chat/chat.gateway.ts
import {
  WebSocketGateway, WebSocketServer,
  SubscribeMessage, MessageBody, ConnectedSocket,
  OnGatewayConnection, OnGatewayDisconnect,
} from "@nestjs/websockets";
import { UseGuards } from "@nestjs/common";
import { WsJwtGuard } from "../auth/guards/ws-jwt.guard";
import { WsEvent } from "../../../../ws/ws.events";
import type {
  TypedWsServer, TypedWsSocket, PresenceStatus,
} from "../../../../ws/ws.types";
import type {
  ChatJoinRoomPayload, ChatLeaveRoomPayload,
  ChatSendMessagePayload, ChatSendMessageAck,
  ChatTypingPayload, ChatMessageReadPayload,
} from "../../../../ws/ws.payloads";
import { ChatService } from "./chat.service";

@WebSocketGateway()
@UseGuards(WsJwtGuard)   // applied at class level — covers all handlers
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: TypedWsServer;

  constructor(private readonly chatService: ChatService) {}

  handleConnection(client: TypedWsSocket): void {
    // Join personal room — used by NotificationGateway to target this user
    void client.join(`user:${client.data.userId}`);
    this.server.emit(WsEvent.PRESENCE_UPDATE, {
      userId:   client.data.userId,
      status:   "online" as PresenceStatus,
      lastSeen: new Date().toISOString(),
    });
  }

  handleDisconnect(client: TypedWsSocket): void {
    // Per Socket.IO docs: sockets auto-leave ALL rooms on disconnect —
    // no manual room.leave() calls needed here
    this.server.emit(WsEvent.PRESENCE_UPDATE, {
      userId:   client.data.userId,
      status:   "offline" as PresenceStatus,
      lastSeen: new Date().toISOString(),
    });
  }

  @SubscribeMessage(WsEvent.CHAT_JOIN_ROOM)
  async handleJoinRoom(
    @MessageBody() payload: ChatJoinRoomPayload,
    @ConnectedSocket() client: TypedWsSocket
  ): Promise<void> {
    await client.join(payload.roomId);
    const history = await this.chatService.getRoomHistory(payload.roomId);
    client.emit(WsEvent.CHAT_ROOM_HISTORY, history);
  }

  @SubscribeMessage(WsEvent.CHAT_LEAVE_ROOM)
  async handleLeaveRoom(
    @MessageBody() payload: ChatLeaveRoomPayload,
    @ConnectedSocket() client: TypedWsSocket
  ): Promise<void> {
    await client.leave(payload.roomId);
  }

  // Acknowledgement pattern — NestJS returns the ack value from the handler
  // Client uses: await socket.timeout(5000).emitWithAck(WsEvent.CHAT_SEND_MESSAGE, payload)
  // If the server doesn't ack within the timeout, the promise rejects
  @SubscribeMessage(WsEvent.CHAT_SEND_MESSAGE)
  async handleSendMessage(
    @MessageBody() payload: ChatSendMessagePayload,
    @ConnectedSocket() client: TypedWsSocket
  ): Promise<ChatSendMessageAck> {
    const message = await this.chatService.saveMessage({
      ...payload,
      senderId: client.data.userId,   // identity always from JWT, never payload
    });
    // io.to() sends to ALL sockets in the room including the sender
    this.server.to(payload.roomId).emit(WsEvent.CHAT_MESSAGE_RECEIVED, message);
    return { messageId: message.id, status: message.status };
  }

  @SubscribeMessage(WsEvent.CHAT_TYPING_START)
  async handleTypingStart(
    @MessageBody() payload: ChatTypingPayload,
    @ConnectedSocket() client: TypedWsSocket
  ): Promise<void> {
    await this.chatService.setTyping(
      payload.roomId, client.data.userId, payload.userName, true
    );
    const typingUsers = await this.chatService.getTypingUsers(payload.roomId);

    // volatile.emit — typing updates are ephemeral. Per the Socket.IO docs,
    // volatile events are dropped if the connection isn't ready. This is correct
    // behaviour: we don't want stale typing state delivered after reconnection.
    this.server
      .to(payload.roomId)
      .volatile
      .emit(WsEvent.CHAT_TYPING_UPDATE, { roomId: payload.roomId, typingUsers });
  }

  @SubscribeMessage(WsEvent.CHAT_TYPING_STOP)
  async handleTypingStop(
    @MessageBody() payload: ChatTypingPayload,
    @ConnectedSocket() client: TypedWsSocket
  ): Promise<void> {
    await this.chatService.setTyping(
      payload.roomId, client.data.userId, payload.userName, false
    );
    const typingUsers = await this.chatService.getTypingUsers(payload.roomId);
    this.server
      .to(payload.roomId)
      .volatile
      .emit(WsEvent.CHAT_TYPING_UPDATE, { roomId: payload.roomId, typingUsers });
  }

  @SubscribeMessage(WsEvent.CHAT_MESSAGE_READ)
  async handleMessageRead(
    @MessageBody() payload: ChatMessageReadPayload,
    @ConnectedSocket() client: TypedWsSocket
  ): Promise<void> {
    await this.chatService.markMessageRead(payload.messageId, client.data.userId);
    // socket.to() EXCLUDES the sender — only other room members need this event
    client.to(payload.roomId).emit(WsEvent.CHAT_MESSAGE_READ, {
      ...payload,
      readByUserId: client.data.userId,
    });
  }
}
```

---

### `notification.gateway.ts`

```ts
// modules/notifications/notification.gateway.ts
import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { WsEvent } from "../../../../ws/ws.events";
import type { TypedWsServer } from "../../../../ws/ws.types";
import type { NotificationPayload, NotificationCountPayload } from "../../../../ws/ws.payloads";

@WebSocketGateway()
export class NotificationGateway {
  @WebSocketServer()
  server!: TypedWsServer;

  // Called by NotificationService — never by a controller directly
  sendToUser(userId: string, notification: NotificationPayload): void {
    // User was joined to "user:{userId}" room in handleConnection
    this.server.to(`user:${userId}`).emit(WsEvent.NOTIFICATION_NEW, notification);
  }

  sendCountUpdate(userId: string, payload: NotificationCountPayload): void {
    this.server.to(`user:${userId}`).emit(WsEvent.NOTIFICATION_COUNT, payload);
  }

  broadcast(notification: NotificationPayload): void {
    this.server.emit(WsEvent.NOTIFICATION_NEW, notification);
  }

  // Inter-server communication typed by InterServerEvents generic
  // Propagates to all NestJS instances via the Redis adapter
  invalidateUserAcrossCluster(userId: string): void {
    this.server.serverSideEmit(WsEvent.SERVER_INVALIDATE_USER, userId);
  }
}
```

---

## 🪝 Next.js — Client Hooks

### `lib/socket.ts` — Singleton

```ts
"use client";
// lib/socket.ts
import { io } from "socket.io-client";
import type { AppSocket } from "@/ws/ws.types";

let socket: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_WS_URL!, {
      autoConnect:     false,
      withCredentials: true,
      transports:      ["websocket"],  // match server — skip long-polling
    });
  }
  return socket;
}

export function destroySocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
```

> **Rule:** `io()` is called **exactly once**, here. Per the Socket.IO docs, calling `io()` more than once for the same URL creates separate WebSocket connections — there is no multiplexing. Every hook calls `getSocket()`.

---

### `hooks/useSocket.ts`

```ts
"use client";
// hooks/useSocket.ts
import { useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { WsEvent } from "@/ws/ws.events";
import type { AppSocket } from "@/ws/ws.types";
import type { WsAuthAckPayload } from "@/ws/ws.payloads";

interface UseSocketReturn {
  socket:          AppSocket;
  isConnected:     boolean;
  isAuthenticated: boolean;
}

export function useSocket(token: string): UseSocketReturn {
  const socket          = getSocket();
  const [isConnected,     setIsConnected]     = useState<boolean>(socket.connected);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const tokenRef = useRef<string>(token);
  tokenRef.current = token;

  useEffect(() => {
    // Inject token into handshake.auth — WsJwtGuard reads it from there
    socket.auth = { token: tokenRef.current };

    function onConnect():    void { setIsConnected(true) }
    function onDisconnect(): void { setIsConnected(false); setIsAuthenticated(false) }

    function onAuthAck(ack: WsAuthAckPayload): void {
      setIsAuthenticated(ack.success);
    }

    function onUnauthorized(): void {
      setIsAuthenticated(false);
      socket.disconnect();
    }

    socket.on("connect",               onConnect);
    socket.on("disconnect",            onDisconnect);
    socket.on(WsEvent.WS_AUTH,         onAuthAck);
    socket.on(WsEvent.WS_UNAUTHORIZED, onUnauthorized);

    if (!socket.connected) socket.connect();

    // Always clean up with the exact same handler reference
    return (): void => {
      socket.off("connect",               onConnect);
      socket.off("disconnect",            onDisconnect);
      socket.off(WsEvent.WS_AUTH,         onAuthAck);
      socket.off(WsEvent.WS_UNAUTHORIZED, onUnauthorized);
    };
  }, [socket]);

  return { socket, isConnected, isAuthenticated };
}
```

---

### `hooks/useNotifications.ts`

```ts
"use client";
// hooks/useNotifications.ts
import { useEffect, useState, useCallback } from "react";
import { WsEvent } from "@/ws/ws.events";
import type { NotificationPayload, NotificationCountPayload } from "@/ws/ws.payloads";
import type { AppSocket } from "@/ws/ws.types";

interface UseNotificationsReturn {
  notifications: NotificationPayload[];
  unreadCount:   number;
  markAsRead:    (id: string) => void;
  markAllAsRead: () => void;
}

export function useNotifications(
  socket:          AppSocket,
  isAuthenticated: boolean
): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<NotificationPayload[]>([]);
  const [unreadCount,   setUnreadCount]   = useState<number>(0);

  useEffect(() => {
    if (!isAuthenticated) return;

    function onNew(n: NotificationPayload):      void { setNotifications((p) => [n, ...p]) }
    function onCount(p: NotificationCountPayload): void { setUnreadCount(p.unreadCount) }

    socket.on(WsEvent.NOTIFICATION_NEW,   onNew);
    socket.on(WsEvent.NOTIFICATION_COUNT, onCount);

    return (): void => {
      socket.off(WsEvent.NOTIFICATION_NEW,   onNew);
      socket.off(WsEvent.NOTIFICATION_COUNT, onCount);
    };
  }, [socket, isAuthenticated]);

  const markAsRead = useCallback((notificationId: string): void => {
    socket.emit(WsEvent.NOTIFICATION_READ, { notificationId });
    setNotifications((p) => p.map((n) => n.id === notificationId ? { ...n, isRead: true } : n));
    setUnreadCount((p) => Math.max(0, p - 1));
  }, [socket]);

  const markAllAsRead = useCallback((): void => {
    socket.emit(WsEvent.NOTIFICATION_READ_ALL);
    setNotifications((p) => p.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  }, [socket]);

  return { notifications, unreadCount, markAsRead, markAllAsRead };
}
```

---

### `hooks/useChat.ts`

`emitWithAck` is the Socket.IO v4 promise-based acknowledgement API. Always pair with `.timeout()` — without it, the promise may never resolve if the server is unreachable.

```ts
"use client";
// hooks/useChat.ts
import { useEffect, useState, useCallback, useRef } from "react";
import { WsEvent } from "@/ws/ws.events";
import type {
  ChatMessagePayload, ChatTypingUpdatePayload,
  ChatRoomHistoryPayload, ChatSendMessageAck,
} from "@/ws/ws.payloads";
import type { AppSocket } from "@/ws/ws.types";

interface UseChatReturn {
  messages:    ChatMessagePayload[];
  typingUsers: ChatTypingUpdatePayload["typingUsers"];
  hasMore:     boolean;
  sendMessage: (content: string, replyToId?: string | null) => Promise<ChatSendMessageAck>;
  startTyping: () => void;
  stopTyping:  () => void;
}

const TYPING_AUTO_STOP_MS = 3_000;
const SEND_TIMEOUT_MS     = 5_000;

export function useChat(
  socket:          AppSocket,
  isAuthenticated: boolean,
  roomId:          string,
  userId:          string,
  userName:        string,
): UseChatReturn {
  const [messages,    setMessages]    = useState<ChatMessagePayload[]>([]);
  const [typingUsers, setTypingUsers] = useState<ChatTypingUpdatePayload["typingUsers"]>([]);
  const [hasMore,     setHasMore]     = useState<boolean>(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !roomId) return;

    socket.emit(WsEvent.CHAT_JOIN_ROOM, { roomId });

    function onHistory(p: ChatRoomHistoryPayload): void {
      if (p.roomId !== roomId) return;
      setMessages(p.messages);
      setHasMore(p.hasMore);
    }
    function onMessage(m: ChatMessagePayload): void {
      if (m.roomId !== roomId) return;
      setMessages((prev) => [...prev, m]);
    }
    function onTypingUpdate(t: ChatTypingUpdatePayload): void {
      if (t.roomId !== roomId) return;
      setTypingUsers(t.typingUsers.filter((u) => u.userId !== userId));
    }

    socket.on(WsEvent.CHAT_ROOM_HISTORY,     onHistory);
    socket.on(WsEvent.CHAT_MESSAGE_RECEIVED, onMessage);
    socket.on(WsEvent.CHAT_TYPING_UPDATE,    onTypingUpdate);

    return (): void => {
      socket.off(WsEvent.CHAT_ROOM_HISTORY,     onHistory);
      socket.off(WsEvent.CHAT_MESSAGE_RECEIVED, onMessage);
      socket.off(WsEvent.CHAT_TYPING_UPDATE,    onTypingUpdate);
      socket.emit(WsEvent.CHAT_LEAVE_ROOM, { roomId });
    };
  }, [socket, isAuthenticated, roomId, userId]);

  const sendMessage = useCallback(
    async (content: string, replyToId: string | null = null): Promise<ChatSendMessageAck> => {
      // socket.io v4: emitWithAck returns a promise that resolves with the ack value.
      // .timeout(ms) ensures the promise rejects if the server doesn't respond in time.
      return socket
        .timeout(SEND_TIMEOUT_MS)
        .emitWithAck(WsEvent.CHAT_SEND_MESSAGE, {
          roomId, content, replyToMessageId: replyToId,
        });
    },
    [socket, roomId]
  );

  const startTyping = useCallback((): void => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    socket.emit(WsEvent.CHAT_TYPING_START, { roomId, userId, userName });
    typingTimerRef.current = setTimeout(() => {
      socket.emit(WsEvent.CHAT_TYPING_STOP, { roomId, userId, userName });
    }, TYPING_AUTO_STOP_MS);
  }, [socket, roomId, userId, userName]);

  const stopTyping = useCallback((): void => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    socket.emit(WsEvent.CHAT_TYPING_STOP, { roomId, userId, userName });
  }, [socket, roomId, userId, userName]);

  return { messages, typingUsers, hasMore, sendMessage, startTyping, stopTyping };
}
```

---

## 📡 Socket.IO v4 Doc Patterns Applied

| Concept | Where applied | Source |
|---|---|---|
| All 4 TS generics (`C→S`, `S→C`, `Inter`, `SocketData`) | `ws.types.ts` | [TypeScript guide](https://socket.io/docs/v4/typescript/) |
| Client generics reversed: `Socket<S→C, C→S>` | `AppSocket` type | [TypeScript guide](https://socket.io/docs/v4/typescript/) |
| `socket.data` typed via `SocketData` — zero casts | `WsJwtGuard` + all handlers | [TypeScript guide](https://socket.io/docs/v4/typescript/) |
| `emitWithAck` + `.timeout()` | `sendMessage` hook | [Emitting events](https://socket.io/docs/v4/emitting-events/) |
| `volatile.emit` for ephemeral state | Typing updates | [Volatile events](https://socket.io/docs/v4/emitting-events/#volatile-events) |
| `socket.to(room)` excludes sender | `CHAT_MESSAGE_READ` | [Rooms](https://socket.io/docs/v4/rooms/) |
| `io.to(room)` includes all in room | `CHAT_MESSAGE_RECEIVED` | [Rooms](https://socket.io/docs/v4/rooms/) |
| Sockets auto-leave rooms on disconnect | No cleanup in `handleDisconnect` | [Rooms - Disconnection](https://socket.io/docs/v4/rooms/#disconnection) |
| Personal rooms `user:{id}` | Notification targeting | [Rooms - Use cases](https://socket.io/docs/v4/rooms/#sample-use-cases) |
| `InterServerEvents` + `serverSideEmit` | `invalidateUserAcrossCluster` | [TypeScript guide](https://socket.io/docs/v4/typescript/) |
| `ioredis` over `redis` for adapter | `ws.config.ts` | [Redis adapter](https://socket.io/docs/v4/redis-adapter/#with-the-ioredis-package) |
| `transports: ["websocket"]` eliminates sticky sessions | client + server config | [Redis adapter](https://socket.io/docs/v4/redis-adapter/#do-i-still-need-to-enable-sticky-sessions) |
| Redis adapter ≠ Connection State Recovery | Documented caveat in `ws.config.ts` | [Connection recovery](https://socket.io/docs/v4/connection-state-recovery) |
| Single `io()` call = no duplicate connections | `lib/socket.ts` | [Namespaces](https://socket.io/docs/v4/namespaces/#client-initialization) |

---

## 🚫 Anti-Patterns — Never Do

- ❌ Raw string event names — `socket.emit("chat:message", ...)` — always use `WsEvent` enum
- ❌ `Server` or `Socket` without all 4 generics — `server: Server` is completely untyped
- ❌ Client generics in the wrong order — `Socket<ClientToServer, ServerToClient>` is silently wrong; it must be `Socket<ServerToClient, ClientToServer>`
- ❌ Reading identity from `@MessageBody()` — always read `client.data.userId` (stamped by guard)
- ❌ Storing typing state in a gateway property (`private map = new Map()`) — crashes in multi-instance; use Redis with TTL
- ❌ Using the `redis` npm package for the adapter — use `ioredis`; `redis` has confirmed subscription reconnection bugs
- ❌ Expecting Connection State Recovery to work with the Redis adapter — it does NOT; use the Redis Streams adapter if you need it
- ❌ Calling `io()` in Next.js more than once for the same URL — creates two separate WebSocket connections
- ❌ Socket hooks in Server Components — all socket code requires `"use client"`
- ❌ `socket.on()` without the same-reference `socket.off()` in `useEffect` cleanup — leaks listeners
- ❌ `socket.emit()` for operations expecting an ack without `.timeout()` — the promise may never resolve
- ❌ Passing `Date` objects in payloads — Socket.IO serializes them as strings; send explicit ISO 8601 strings
- ❌ `JSON.stringify()` before `socket.emit()` — Socket.IO serializes objects automatically; double-encoding corrupts the data

---

## 📦 Setup Checklist

- [ ] `NEXT_PUBLIC_WS_URL` set in Next.js `.env.local`, validated in env schema
- [ ] `FRONTEND_URL` and `REDIS_URL` set in NestJS `.env`, validated with `getOrThrow`
- [ ] `ioredis` + `@socket.io/redis-adapter` installed (`npm i ioredis @socket.io/redis-adapter`)
- [ ] `socket.io-client` installed in Next.js (`npm i socket.io-client`)
- [ ] `RedisIoAdapter` registered in `main.ts` before `app.listen()`
- [ ] `transports: ["websocket"]` set on both client and server (removes sticky session requirement)
- [ ] `WsJwtGuard` applied at the `@WebSocketGateway()` class level — not per-handler
- [ ] `socket.data` never cast — typed correctly via `SocketData` generic
- [ ] `ws/` shared types folder accessible from both apps (monorepo package or tsconfig path alias)
- [ ] `tsconfig` has `strict: true` and `noImplicitAny: true`
- [ ] Typing state stored in Redis with TTL — never in a gateway class property
- [ ] `ValidationPipe` registered globally to validate all `@MessageBody()` payloads