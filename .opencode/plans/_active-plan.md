# Plan: Refactor Notifications Module to Use Pusher (Serverless-Optimized)

## Overview
Migrate the notifications module from Socket.IO to Pusher for real-time communication, optimized for Vercel serverless deployment. This plan addresses security, reliability, and production-readiness while respecting serverless constraints.

## Current State
- **Gateway**: `notifications.gateway.ts` uses Socket.IO (`@nestjs/websockets`, `socket.io`)
- **Module**: `notifications.module.ts` exports `NotificationsGateway`
- **Service**: `notifications.service.ts` calls gateway methods (`emitToUser`, `emitReadUpdate`, etc.)
- **Environment**: Pusher keys already configured:
  - `PUSHER_APP_ID`
  - `PUSHER_KEY`
  - `PUSHER_SECRET`
  - `PUSHER_CLUSTER`
- **Dependencies**: `socket.io` is in `package.json` but should be removed after migration
- **Config**: `ws.config.ts` contains Socket.IO adapter configuration
- **Deployment Target**: Vercel serverless functions

---

## Serverless Architecture Rationale

### Why Pusher Over Socket.IO on Vercel
- **Socket.IO requires persistent connections**: Vercel serverless functions are ephemeral, terminating after each request. WebSocket connections cannot be maintained.
- **Pusher is managed infrastructure**: Pusher handles persistent WebSocket connections to clients independently of backend execution.
- **Serverless-compatible**: Pusher events are triggered via HTTP API calls, which work perfectly with stateless functions.
- **No backend WebSocket server needed**: Eliminates need for long-running processes.

### WebSocket Limitations in Serverless
- Serverless functions execute per-request and terminate immediately after response
- Cannot maintain persistent WebSocket connections to clients
- Cannot run background workers or long-running processes
- In-memory state is lost between invocations
- Cold starts add latency to first request

### Why Managed Realtime Infrastructure
- Pusher manages connection lifecycle, reconnection, and scaling
- Backend only needs to trigger events via HTTP (stateless)
- Horizontal scaling is automatic (no sticky sessions needed)
- Better reliability than self-hosted WebSocket servers on serverless

### Serverless Execution Impact
- All logic must execute within request lifecycle (typically 10s timeout on Vercel)
- No background daemons or workers
- Retry logic must be inline (not queue-based)
- Database connections must be pooled efficiently
- State must be external (database, cache, not memory)

---

## Pre-Implementation Audit

### Step 0: Verify Socket.IO Usage Across Codebase
Before removing Socket.IO, audit all modules to ensure no other features depend on it:
- Search for `@WebSocketGateway`, `SubscribeMessage`, `WebSocketServer` decorators
- Search for `socket.io` imports across `src/`
- Check for: chat, live updates, typing indicators, admin dashboards, collaborative features
- **Decision Point**: If Socket.IO is used elsewhere, keep it and only refactor notifications module
- **Current Understanding**: Based on AGENTS.md, Socket.IO was already removed and migrated to Pusher, but gateway code still references it

---

## Phase 1: Install Pusher Dependencies

1. Add `pusher` (Node.js server SDK) using pnpm:
   ```bash
   pnpm add pusher
   ```

2. Verify `pusher-js` availability (client SDK for frontend migration)

---

## Phase 2: Create Pusher Configuration

### 2.1 Create `src/config/pusher.config.ts`
```typescript
- Export Pusher configuration factory using ConfigService
- Read PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER from environment
- Configure Pusher with:
  - cluster: PUSHER_CLUSTER
  - appId: PUSHER_APP_ID
  - key: PUSHER_KEY
  - secret: PUSHER_SECRET
  - useTLS: true (production)
- Export typed Pusher instance provider
- Singleton pattern for serverless (reuse across cold starts)
```

### 2.2 Update `src/config/env.validation.ts`
```typescript
- Add validation for Pusher environment variables:
  - PUSHER_APP_ID: Joi.string().required()
  - PUSHER_KEY: Joi.string().required()
  - PUSHER_SECRET: Joi.string().required()
  - PUSHER_CLUSTER: Joi.string().valid('us2', 'eu', 'ap1', 'ap2', 'ap3', 'mt1').required()
```

### 2.3 Update `.env.example`
```bash
# ==========================================
# PUSHER - Real-time Communication (required)
# ==========================================
# Get credentials from: https://dashboard.pusher.com/
PUSHER_APP_ID=your-app-id
PUSHER_KEY=your-app-key
PUSHER_SECRET=your-app-secret
PUSHER_CLUSTER=eu
```

---

## Phase 3: Create Pusher Service with Inline Retry

### 3.1 Create `src/notifications/pusher.service.ts`

**Core Features:**
- Injectable service wrapping Pusher SDK
- Initialize Pusher instance with configuration
- Implement inline retry strategy (serverless-compatible)
- Structured logging for all operations
- Lightweight startup validation

**Methods:**
```typescript
- emitToUser(userId: string, payload: NotificationPayload): Promise<void>
- emitReadUpdate(userId: string, notificationId: string): Promise<void>
- emitReadAllUpdate(userId: string): Promise<void>
- emitCountUpdate(userId: string, unreadCount: number): Promise<void>
- emitDelete(userId: string, notificationId: string): Promise<void>
- emitPaymentStatus(userId: string, payload: PaymentStatusPayload): Promise<void>
- broadcast(payload: BroadcastPayload): Promise<void>
```

**Channel Naming (Private Channels):**
- Format: `private-user-{userId}`
- Example: `private-user-abc123-def456`
- Security: Only authenticated user can subscribe to their own channel

**Inline Retry Strategy (Serverless-Compatible):**
```typescript
- Max 3 retries with exponential backoff
- Backoff delays: 500ms, 1000ms, 2000ms (short for serverless)
- Total retry time: ~3.5s (within Vercel 10s timeout)
- Use Promise-based delay (setTimeout wrapped in Promise)
- Log each retry attempt with structured logging
- If all retries fail:
  - Log failure with error details
  - Notification already saved to DB (graceful degradation)
  - Frontend can poll REST API as fallback
```

**Idempotency:**
- Generate unique event ID for each trigger (UUID v4)
- Include `eventId` in all payloads
- Frontend can deduplicate using `eventId`

**Logging:**
- Success: `{ event, channel, userId, eventId, latency: number, status: 'success' }`
- Failure: `{ event, channel, userId, eventId, error, attempt, maxAttempts, status: 'failed' }`
- Retry: `{ event, channel, userId, eventId, attempt, delay, status: 'retrying' }`
- Auth failure: `{ channel, userId, reason, status: 'auth_failed' }`

**No BullMQ or Queue Dependencies:**
- All logic executes inline within request lifecycle
- No background workers or persistent processes
- Database persistence serves as fallback if Pusher fails

---

## Phase 4: Create Pusher Authentication Endpoint

### 4.1 Create `src/notifications/pusher.auth.controller.ts`

**Purpose:** Authenticate private channel subscriptions

**Endpoint:**
```typescript
POST /pusher/auth
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>

Request Body:
{
  "channel_name": "private-user-abc123",
  "socket_id": "12345.67890"
}

Response:
{
  "auth": "app_key:signature"
}
```

**Implementation:**
```typescript
- Validate JWT token from Authorization header
- Extract userId from JWT payload
- Parse channel_name to extract requested userId
- Verify: authenticated userId === requested userId
- If mismatch: return 403 Forbidden with logging
- If match: generate Pusher auth signature using Pusher SDK
- Return auth signature to client
- Log all authorization attempts (success/failure)
- Stateless: no session or in-memory state required
```

**Security:**
- JWT validation using existing JwtService
- Channel ownership verification (critical security check)
- Rate limiting via existing throttler (if configured)
- Structured logging for audit trail
- Stateless design (serverless-compatible)

---

## Phase 5: Refactor Notifications Gateway

### 5.1 Update `src/notifications/notifications.gateway.ts`

**Changes:**
- Remove Socket.IO imports (`@nestjs/websockets`, `socket.io`)
- Remove `@WebSocketGateway()` decorator
- Remove `OnGatewayConnection`, `OnGatewayDisconnect` interfaces
- Remove `@SubscribeMessage` decorators
- Remove `handleConnection`, `handleDisconnect` methods
- Remove Socket.IO typed types (`TypedWsServer`, `TypedWsSocket`)
- Remove `WsJwtGuard` (no longer needed)
- Inject `PusherService` instead of using `Server`

**New Implementation:**
```typescript
@Injectable()
export class NotificationsGateway {
  constructor(
    private readonly pusherService: PusherService,
  ) {}

  // Delegate all emit methods to PusherService (async)
  async emitToUser(userId: string, payload: unknown): Promise<void> {
    await this.pusherService.emitToUser(userId, payload);
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

  async emitPaymentStatus(userId: string, payload: PaymentStatusPayload): Promise<void> {
    await this.pusherService.emitPaymentStatus(userId, payload);
  }

  async broadcast(payload: unknown): Promise<void> {
    await this.pusherService.broadcast(payload);
  }
}
```

**Event Names (unchanged for backward compatibility):**
- `notification:new`
- `notification:read`
- `notification:read_all`
- `notification:count`
- `notification:delete`
- `payment:status`

**Stateless Design:**
- No connection management (Pusher handles client connections)
- No in-memory state (all stateless method calls)
- Horizontally scalable (no sticky sessions needed)

---

## Phase 6: Update Notifications Module

### 6.1 Update `src/notifications/notifications.module.ts`

**Changes:**
```typescript
imports: [
  // ... existing imports
  TypeOrmModule.forFeature([Notification, NotificationPreferences]),
  JwtModule.registerAsync({ ... }), // Keep for Pusher auth endpoint
  AuthModule, // Keep for token validation
],
providers: [
  NotificationsService,
  NotificationsGateway,
  PusherService, // New
],
controllers: [
  NotificationsController,
  NotificationsClientController,
  PusherAuthController, // New
],
exports: [
  NotificationsService,
  NotificationsGateway,
  PusherService, // Export for other modules
],
```

**Keep JWT Infrastructure:**
- JWT is still required for Pusher private channel authorization
- Do not remove JwtModule or AuthModule

**Remove WebSocket-Specific Imports:**
- No need for WebSocket adapter
- No need for Socket.IO configuration

---

## Phase 7: Update Notifications Service

### 7.1 Update `src/notifications/notifications.service.ts`

**Changes:**
- Add `await` to all gateway method calls (they're now async)
- Add error handling for Pusher failures (graceful degradation)

**Example:**
```typescript
async create(dto: CreateNotificationDto): Promise<Notification> {
  try {
    const notification = this.notificationRepository.create({ ... });
    const saved = await this.notificationRepository.save(notification);

    // Emit real-time notification (async, with retry)
    await this.notificationsGateway.emitToUser(dto.userId, saved);

    return saved;
  } catch (error: unknown) {
    // If Pusher fails, notification is still saved to DB
    // Frontend can poll REST API as fallback
    if (error instanceof Error) {
      // Log Pusher failure but don't fail the request
      console.error('Failed to emit Pusher event:', error.message);
    }
    // Return saved notification regardless of Pusher status
    return saved; // or re-throw if DB save failed
  }
}
```

**Graceful Degradation:**
- If Pusher fails, notification is still persisted to database
- REST API endpoints remain functional
- Client can poll `/notifications` endpoint as fallback
- No request failure due to Pusher outage

---

## Phase 8: Database Connection Management (Serverless)

### 8.1 Connection Pooling Guidance

**Problem:** Serverless environments can exhaust database connections due to cold starts and concurrent invocations.

**Solutions:**
- Use connection pooling (already configured via Neon pooler in DATABASE_URL)
- Current DATABASE_URL includes `-pooler` endpoint: `ep-bitter-salad-ag11e808-pooler.c-2.eu-central-1.aws.neon.tech`
- Ensure TypeORM DataSource is reused across invocations (singleton pattern)
- Avoid creating new connections per request
- Set appropriate pool size limits (max 10-20 connections for serverless)

**TypeORM Configuration:**
```typescript
// In database.config.ts
{
  poolSize: 10, // Limit connections for serverless
  extra: {
    max: 10,
    min: 2,
    idleTimeoutMillis: 30000,
  }
}
```

**DataSource Reuse Pattern:**
```typescript
// Singleton pattern for serverless
let dataSource: DataSource | null = null;

export async function getDataSource(): Promise<DataSource> {
  if (!dataSource || !dataSource.isInitialized) {
    dataSource = await initializeDataSource();
  }
  return dataSource;
}
```

**Avoid Connection Leaks:**
- Always use repository pattern (TypeORM manages connections)
- Avoid manual connection creation
- Use transactions carefully (commit/rollback promptly)
- Monitor connection count in Neon dashboard

---

## Phase 9: Clean Up Socket.IO References

### 9.1 Audit Socket.IO Usage
- Search entire codebase for `socket.io` imports
- Verify no other modules depend on it
- Check `src/main.ts` for WebSocket adapter setup

### 9.2 Remove Socket.IO (if unused elsewhere)
```bash
pnpm remove socket.io @nestjs/platform-socket.io
```

### 9.3 Update `src/config/ws.config.ts`
- Remove file (no longer needed)
- Or add deprecation notice if referenced elsewhere

### 9.4 Update `src/main.ts`
- Remove Socket.IO adapter initialization
- Remove any WebSocket-specific setup
- Remove `SanadIoAdapter` import and usage

---

## Phase 10: Frontend Migration Guide

### 10.1 Client-Side Changes Required

**Old (Socket.IO):**
```javascript
import io from 'socket.io-client';
const socket = io('http://localhost:5000', {
  auth: { token: jwtToken }
});
socket.on('notification:new', (payload) => { ... });
```

**New (Pusher):**
```javascript
import Pusher from 'pusher-js';

const pusher = new Pusher('PUSHER_KEY', {
  cluster: 'PUSHER_CLUSTER',
  authEndpoint: '/pusher/auth',
  auth: {
    headers: {
      Authorization: `Bearer ${jwtToken}`
    }
  },
  forceTLS: true
});

// Subscribe to private channel
const channel = pusher.subscribe(`private-user-${userId}`);

// Bind events
channel.bind('notification:new', (payload) => {
  // Deduplicate using eventId
  if (!seenEventIds.has(payload.eventId)) {
    seenEventIds.add(payload.eventId);
    // Process notification
  }
});

// Cleanup on logout
channel.unbind_all();
pusher.unsubscribe(`private-user-${userId}`);
```

**Token Refresh Handling:**
```javascript
// Update auth headers when token refreshes
pusher.config.auth.headers.Authorization = `Bearer ${newToken}`;
```

**Reconnection Handling:**
```javascript
pusher.connection.bind('state_change', (states) => {
  if (states.current === 'connected') {
    // Re-subscribe to channels
    pusher.subscribe(`private-user-${userId}`);
  }
});
```

**Memory Leak Prevention:**
```javascript
// On component unmount / logout
channel.unbind('notification:new');
pusher.unsubscribe(`private-user-${userId}`);
pusher.disconnect();
```

**Deduplication Strategy:**
```javascript
const seenEventIds = new Set();

channel.bind('notification:new', (payload) => {
  if (payload.eventId && !seenEventIds.has(payload.eventId)) {
    seenEventIds.add(payload.eventId);
    // Process notification
    
    // Clean up old event IDs (keep last 100)
    if (seenEventIds.size > 100) {
      const firstKey = seenEventIds.values().next().value;
      seenEventIds.delete(firstKey);
    }
  }
});
```

---

## Phase 11: Monitoring & Observability

### 11.1 Structured Logging

**All Pusher operations logged with JSON format:**
```typescript
// Success
{
  timestamp: '2026-05-20T10:30:00Z',
  level: 'info',
  service: 'pusher',
  event: 'notification:new',
  channel: 'private-user-abc123',
  userId: 'abc123',
  eventId: 'uuid-v4',
  latency: 150,
  status: 'success'
}

// Failure
{
  timestamp: '2026-05-20T10:30:00Z',
  level: 'error',
  service: 'pusher',
  event: 'notification:new',
  channel: 'private-user-abc123',
  userId: 'abc123',
  eventId: 'uuid-v4',
  error: 'Pusher API timeout',
  attempt: 3,
  maxAttempts: 3,
  status: 'failed'
}

// Auth failure
{
  timestamp: '2026-05-20T10:30:00Z',
  level: 'warn',
  service: 'pusher-auth',
  channel: 'private-user-xyz789',
  requestedUserId: 'xyz789',
  authenticatedUserId: 'abc123',
  reason: 'channel_ownership_mismatch',
  status: 'auth_failed'
}
```

### 11.2 Sentry Integration

**Error Tracking:**
```typescript
import * as Sentry from '@sentry/node';

// In PusherService catch blocks
Sentry.captureException(error, {
  tags: { service: 'pusher', event: 'notification:new' },
  user: { id: userId },
  extra: { channel, eventId, attempt }
});
```

### 11.3 External Monitoring

**Synthetic Monitoring:**
- Use external uptime monitoring (e.g., Pingdom, UptimeRobot)
- Monitor `/notifications` endpoint availability
- Alert on increased error rates

**Request-Level Metrics:**
- Track Pusher trigger failures in logs
- Monitor latency percentiles (p50, p95, p99)
- Set up alerts for error rate spikes

**No Internal Health Checks:**
- Serverless instances are ephemeral
- Traditional health checks not meaningful
- Rely on external monitoring and log aggregation

---

## Phase 12: Production Hardening

### 12.1 Graceful Degradation
- If Pusher is unavailable, notifications still saved to database
- REST API endpoints remain functional
- Client can poll `/notifications` endpoint as fallback
- No request failure due to Pusher outage

### 12.2 Simplified Reliability (No Circuit Breaker)
- Remove in-memory circuit breaker (not serverless-compatible)
- Rely on inline retries + logging + graceful degradation
- If external state store needed later (Redis/Upstash), can add circuit breaker

### 12.3 Rate Limit Awareness
- Monitor Pusher plan limits (messages/sec, connections)
- Log warnings when approaching limits
- Pusher handles rate limiting on their side
- No server-side rate limiting needed (managed by Pusher)

### 12.4 Startup Validation
- Validate all Pusher env vars on application startup
- Test Pusher connection during bootstrap (lightweight)
- Fail fast if configuration is invalid
- Log warning if Pusher is in development mode

**Validation Code:**
```typescript
// In app.module.ts or main.ts
async function validatePusherConfig(configService: ConfigService) {
  const requiredVars = ['PUSHER_APP_ID', 'PUSHER_KEY', 'PUSHER_SECRET', 'PUSHER_CLUSTER'];
  const missing = requiredVars.filter(varName => !configService.get(varName));
  
  if (missing.length > 0) {
    throw new Error(`Missing Pusher configuration: ${missing.join(', ')}`);
  }
}
```

### 12.5 Strong Typings
```typescript
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

export interface PusherTriggerResponse {
  eventIds: string[];
}
```

---

## Phase 13: Comprehensive Testing

### 13.1 Unit Tests

**PusherService:**
- Test all emit methods
- Test retry logic (mock Pusher failures)
- Test exponential backoff
- Test idempotency (eventId generation)
- Test structured logging
- Test graceful degradation on failure

**PusherAuthController:**
- Test successful channel authorization
- Test unauthorized subscription (different userId)
- Test invalid JWT token
- Test missing Authorization header
- Test logging of auth failures

### 13.2 Integration Tests

**Multi-User Isolation:**
- User A cannot subscribe to User B's channel
- Events sent to User A don't reach User B
- Concurrent notifications to multiple users

**Retry Behavior:**
- Simulate Pusher API failure
- Verify retry with backoff
- Verify graceful degradation (notification still saved)
- Verify logging of failures

**Duplicate Event Tests:**
- Send same event multiple times
- Verify eventId uniqueness
- Test frontend deduplication logic

### 13.3 E2E Tests

**Pusher Outage Simulation:**
- Mock Pusher SDK to throw errors
- Verify notifications still saved to DB
- Verify REST API still functional
- Verify recovery when Pusher comes back

**Load Testing:**
- Send 1000 notifications concurrently
- Measure latency
- Verify no events lost (or gracefully degraded)
- Monitor database connection pool

### 13.4 Security Tests

**Authorization Tests:**
- Attempt subscription with invalid token
- Attempt subscription to another user's channel
- Verify 403 responses
- Verify audit logging

**Rate Limit Tests:**
- Send 100 auth requests in 1 second
- Verify rate limiting kicks in
- Verify legitimate requests still work

---

## File Changes Summary

### New Files
- `src/config/pusher.config.ts` - Pusher configuration provider
- `src/notifications/pusher.service.ts` - Pusher service with inline retry
- `src/notifications/pusher.auth.controller.ts` - Private channel auth endpoint

### Modified Files
- `src/config/env.validation.ts` - Add Pusher env validation
- `src/notifications/notifications.gateway.ts` - Replace Socket.IO with Pusher
- `src/notifications/notifications.module.ts` - Add Pusher providers
- `src/notifications/notifications.service.ts` - Add await to gateway calls + error handling
- `.env.example` - Document Pusher variables
- `package.json` - Add pusher, remove socket.io (if unused)
- `src/main.ts` - Remove WebSocket adapter setup

### Removed Files
- `src/config/ws.config.ts` - No longer needed (Socket.IO removed)

### Unchanged Files
- `src/notifications/notifications.controller.ts` - REST API unchanged
- `src/notifications/notifications.client.controller.ts` - REST API unchanged
- All DTOs, enums, events, interfaces, schemas - No changes

---

## Migration Strategy

### Backward Compatibility
- Event names remain identical
- Channel naming: `private-user-{userId}` (secure private channels)
- Client must migrate from Socket.IO to Pusher JS SDK
- REST API endpoints unchanged
- Database schema unchanged (no migration required)

### Rollout Strategy
1. Deploy backend with Pusher (Socket.IO removed)
2. Test Pusher with debug console
3. Update frontend to use Pusher
4. Monitor for 24-48 hours
5. Verify no Socket.IO dependencies remain
6. Deploy final version

### Rollback Plan
- Keep Socket.IO dependencies in package.json until Pusher verified
- Gateway can switch back by restoring Socket.IO imports if needed
- Database notifications remain functional regardless
- Frontend can fall back to polling if Pusher fails

---

## Serverless Architecture Summary

### Final Architecture Flow
```
Vercel Serverless Function (REST API)
    → Save notification to database (TypeORM)
    → Trigger Pusher event (inline, with retry)
    → Log success/failure (structured logging)
    → Return response to client

Frontend (pusher-js)
    → Subscribe to private-user-{userId} channel
    → Receive realtime event
    → Deduplicate using eventId
    → If Pusher fails, poll REST API as fallback
```

### Key Design Principles
- **Stateless**: No in-memory state, no persistent connections
- **Serverless-compatible**: All logic in request lifecycle
- **Simple**: No queues, no workers, no complex orchestration
- **Reliable**: Database persistence + inline retries + polling fallback
- **Secure**: Private channels + JWT auth + channel ownership validation
- **Scalable**: Horizontally scalable across serverless invocations
- **Observable**: Structured logging + Sentry + external monitoring

### What We Avoided
- ❌ BullMQ or queue systems (not serverless-compatible)
- ❌ In-memory circuit breakers (ephemeral instances)
- ❌ Background workers (no persistent processes)
- ❌ WebSocket server (managed by Pusher)
- ❌ Complex orchestration layers
- ❌ Distributed worker systems

### Future Enhancements (If Needed)
- External queue: Upstash QStash, Inngest, Trigger.dev
- Circuit breaker: Redis-backed state store
- Advanced metrics: Prometheus + Grafana
- Distributed tracing: OpenTelemetry

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Pusher API outage | Inline retries + DB persistence + polling fallback |
| Duplicate events | EventId + frontend deduplication |
| Security breach | Private channels + JWT auth + channel ownership verification |
| Rate limits | Monitoring + Pusher handles rate limiting |
| Client migration issues | Detailed migration guide + backward compatibility period |
| Message loss | Inline retries + DB persistence (graceful degradation) |
| Latency spikes | Structured logging + Sentry + external monitoring |
| DB connection exhaustion | Connection pooling (Neon pooler) + DataSource reuse |
| Cold start latency | Acceptable for notifications (not critical path) |

---

## Package Manager
- Use `pnpm` for all package operations:
  ```bash
  pnpm add pusher
  pnpm remove socket.io @nestjs/platform-socket.io
  ```

---

## Next Steps After Approval
1. Audit Socket.IO usage across codebase
2. Install Pusher dependencies with pnpm
3. Implement configuration and service
4. Create auth endpoint
5. Refactor gateway
6. Update notifications service (add await + error handling)
7. Clean up Socket.IO references
8. Test comprehensively
9. Update documentation & frontend migration guide
10. Deploy and monitor
