# 🎬 Movie Website — Complete NestJS Backend Execution Plan

> **Role:** Senior Backend Architect & System Designer (NestJS)
> **Scope:** Backend Only — REST API + Socket.IO
> **Stack:** NestJS · PostgreSQL · Socket.IO · Stripe
> **Constraints:** No Redis · No heavy queues · Low RAM · Free hosting

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Database Schema Design](#2-database-schema-design)
3. [API Architecture](#3-api-architecture)
4. [Realtime System Design (Socket.IO)](#4-realtime-system-design-socketio)
5. [Payment Integration (Stripe)](#5-payment-integration-stripe)
6. [Background Jobs — Lightweight Approach](#6-background-jobs--lightweight-approach)
7. [Performance Optimization Without Caching](#7-performance-optimization-without-caching)
8. [Security Considerations](#8-security-considerations)
9. [Deployment Checklist](#9-deployment-checklist)
10. [Milestones → Phases → Tasks](#10-milestones--phases--tasks)

---

## 1. Project Overview

### System Features
| Feature | Type | Priority |
|---|---|---|
| Watchlist | REST + Realtime | High |
| Watched List | REST + Realtime | High |
| Favorites | REST + Realtime | High |
| Real-time Notifications | Socket.IO | High |
| Stripe Payment Integration | REST + Webhooks | Medium |

### NestJS Module Structure
```
src/
├── app.module.ts
├── common/
│   ├── decorators/
│   ├── filters/
│   ├── guards/
│   ├── interceptors/
│   └── pipes/
├── config/
│   └── database.config.ts
├── database/
│   └── migrations/
├── modules/
│   ├── users/
│   ├── movies/
│   ├── lists/
│   │   ├── watchlist/
│   │   ├── watched/
│   │   └── favorites/
│   ├── notifications/
│   ├── payments/
│   └── socket/
└── main.ts
```

---

## 2. Database Schema Design

### 2.1 Tables & Relationships

#### `users`
```sql
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) NOT NULL UNIQUE,
  username    VARCHAR(100) NOT NULL,
  avatar_url  TEXT,
  stripe_customer_id VARCHAR(100),
  is_premium  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_stripe_customer_id ON users(stripe_customer_id);
```

#### `movies`
```sql
CREATE TABLE movies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tmdb_id         INTEGER NOT NULL UNIQUE,
  title           VARCHAR(500) NOT NULL,
  overview        TEXT,
  poster_path     TEXT,
  backdrop_path   TEXT,
  release_date    DATE,
  vote_average    DECIMAL(3,1),
  genres          JSONB DEFAULT '[]',
  runtime         INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_movies_tmdb_id ON movies(tmdb_id);
CREATE INDEX idx_movies_title ON movies USING gin(to_tsvector('english', title));
CREATE INDEX idx_movies_release_date ON movies(release_date DESC);
```

#### `user_lists` (unified table for watchlist / watched / favorites)
```sql
CREATE TYPE list_type AS ENUM ('watchlist', 'watched', 'favorites');

CREATE TABLE user_lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id    UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  list_type   list_type NOT NULL,
  watched_at  TIMESTAMPTZ,          -- only relevant for list_type = 'watched'
  rating      SMALLINT CHECK (rating BETWEEN 1 AND 10),  -- optional user rating
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, movie_id, list_type)
);

CREATE INDEX idx_user_lists_user_id        ON user_lists(user_id);
CREATE INDEX idx_user_lists_user_list_type ON user_lists(user_id, list_type);
CREATE INDEX idx_user_lists_movie_id       ON user_lists(movie_id);
CREATE INDEX idx_user_lists_created_at     ON user_lists(user_id, list_type, created_at DESC);
```

#### `notifications`
```sql
CREATE TYPE notification_type AS ENUM (
  'movie_added_to_watchlist',
  'movie_watched',
  'payment_success',
  'payment_failed',
  'system'
);

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  title       VARCHAR(255) NOT NULL,
  body        TEXT,
  metadata    JSONB DEFAULT '{}',
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id       ON notifications(user_id);
CREATE INDEX idx_notifications_user_unread   ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_created_at    ON notifications(user_id, created_at DESC);
```

#### `payments`
```sql
CREATE TYPE payment_status AS ENUM ('pending', 'succeeded', 'failed', 'refunded');

CREATE TABLE payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  stripe_payment_intent VARCHAR(255) NOT NULL UNIQUE,
  stripe_charge_id      VARCHAR(255),
  amount                INTEGER NOT NULL,   -- in cents
  currency              VARCHAR(10) DEFAULT 'usd',
  status                payment_status DEFAULT 'pending',
  description           TEXT,
  metadata              JSONB DEFAULT '{}',
  idempotency_key       VARCHAR(255) UNIQUE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_user_id               ON payments(user_id);
CREATE INDEX idx_payments_stripe_payment_intent  ON payments(stripe_payment_intent);
CREATE INDEX idx_payments_status                 ON payments(status);
CREATE INDEX idx_payments_idempotency_key        ON payments(idempotency_key);
```

### 2.2 Query Optimization Strategies

- **Select only needed columns** — never use `SELECT *` in services; always specify fields via QueryBuilder or TypeORM `select`.
- **Pagination over full scans** — all list endpoints use `LIMIT/OFFSET` or cursor-based pagination.
- **Covering indexes** — indexes include all columns referenced in `WHERE` + `ORDER BY` to avoid heap fetches.
- **Partial indexes** — e.g., `WHERE is_read = FALSE` on notifications dramatically reduces index size.
- **JSONB for flexible data** — genres and metadata stored as JSONB avoid extra join tables while remaining queryable.
- **Avoid N+1** — use TypeORM `relations` or explicit JOINs in a single query; never fetch related data in loops.
- **Connection pool cap** — limit pg pool to `max: 5` on free hosting to prevent OOM.

---

## 3. API Architecture

### 3.1 Conventions
- Base path: `/api/v1`
- JSON request/response everywhere
- HTTP status codes strictly followed
- Consistent error envelope:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    { "field": "movieId", "message": "movieId must be a UUID" }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/api/v1/watchlist"
}
```

- Successful list response envelope:

```json
{
  "data": [...],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  }
}
```

### 3.2 Endpoint Summary

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/movies` | Browse/search movies |
| GET | `/api/v1/movies/:id` | Movie detail |
| GET | `/api/v1/watchlist` | Get user's watchlist |
| POST | `/api/v1/watchlist` | Add to watchlist |
| DELETE | `/api/v1/watchlist/:movieId` | Remove from watchlist |
| GET | `/api/v1/watched` | Get watched list |
| POST | `/api/v1/watched` | Mark as watched |
| PATCH | `/api/v1/watched/:movieId` | Update rating |
| DELETE | `/api/v1/watched/:movieId` | Remove from watched |
| GET | `/api/v1/favorites` | Get favorites |
| POST | `/api/v1/favorites` | Add to favorites |
| DELETE | `/api/v1/favorites/:movieId` | Remove from favorites |
| GET | `/api/v1/notifications` | Get notifications (paginated) |
| PATCH | `/api/v1/notifications/:id/read` | Mark one as read |
| PATCH | `/api/v1/notifications/read-all` | Mark all as read |
| GET | `/api/v1/notifications/unread-count` | Unread count |
| POST | `/api/v1/payments/intent` | Create payment intent |
| POST | `/api/v1/payments/webhook` | Stripe webhook |
| GET | `/api/v1/payments/history` | Payment history |

---

## 4. Realtime System Design (Socket.IO)

### 4.1 Gateway Structure

```typescript
// src/modules/socket/socket.gateway.ts
@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL, credentials: true },
  transports: ['websocket'],  // avoid long-polling to save RAM
  pingInterval: 25000,
  pingTimeout: 60000,
})
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  handleConnection(client: Socket) {
    const userId = this.extractUserIdFromCookie(client);
    if (!userId) { client.disconnect(); return; }
    client.join(`user:${userId}`);    // user-specific room
  }

  handleDisconnect(client: Socket) {
    // cleanup is automatic via room leave
  }
}
```

### 4.2 Events Naming Convention

**Server → Client (emit):**

| Event | Payload | Trigger |
|---|---|---|
| `notification:new` | `{ id, type, title, body, metadata, createdAt }` | Any new notification |
| `notification:unread_count` | `{ count: number }` | After any read/unread change |
| `list:updated` | `{ listType, action, movieId }` | Add/remove from any list |
| `payment:status` | `{ status, amount, description }` | Payment webhook received |

**Client → Server (listen):**

| Event | Description |
|---|---|
| `notification:mark_read` | Client marks a notification read via socket |

### 4.3 Efficient Event Emission

```typescript
// Emit only to specific user room — never broadcast to all
this.server.to(`user:${userId}`).emit('notification:new', payload);

// Helper in SocketGateway
emitToUser(userId: string, event: string, payload: any) {
  this.server.to(`user:${userId}`).emit(event, payload);
}
```

- Never use `this.server.emit()` (broadcasts to all connected clients).
- One room per user (`user:{userId}`), no shared topic rooms needed.
- Emit only from service layer after DB write confirms success.

---

## 5. Payment Integration (Stripe)

### 5.1 Payment Intent Flow

```
Client                  Backend                     Stripe
  │                        │                           │
  │  POST /payments/intent  │                           │
  │───────────────────────>│                           │
  │                        │  createPaymentIntent()     │
  │                        │──────────────────────────>│
  │                        │<── { clientSecret }        │
  │<── { clientSecret }     │                           │
  │                        │                           │
  │  [Stripe.js confirms]   │                           │
  │───────────────────────────────────────────────────>│
  │                        │                           │
  │                        │<── Webhook: payment_intent │
  │                        │    .succeeded / .failed    │
  │                        │                           │
  │                        │  Update DB + Emit socket   │
  │<── socket: payment:status                          │
```

### 5.2 Idempotency & Retry Safety

```typescript
// Generate idempotency key from userId + amount + timestamp (day-level)
const idempotencyKey = crypto
  .createHash('sha256')
  .update(`${userId}:${amount}:${dayjs().format('YYYY-MM-DD')}`)
  .digest('hex');

// Check existing payment with same key before creating new one
const existing = await this.paymentRepo.findOne({ where: { idempotencyKey } });
if (existing) return existing;
```

### 5.3 Webhook Security

```typescript
@Post('webhook')
@HttpCode(200)
async handleWebhook(
  @Req() req: RawBodyRequest<Request>,
  @Headers('stripe-signature') sig: string,
) {
  const event = this.stripe.webhooks.constructEvent(
    req.rawBody,      // must use raw body middleware
    sig,
    process.env.STRIPE_WEBHOOK_SECRET,
  );
  // handle event.type switch
}
```

**Webhook events handled:**
- `payment_intent.succeeded` → update payment to `succeeded`, set `is_premium = true`, emit socket
- `payment_intent.payment_failed` → update to `failed`, emit socket
- `charge.refunded` → update to `refunded`, optionally revoke premium

---

## 6. Background Jobs — Lightweight Approach

### Strategy: NestJS `@Cron` + `ScheduleModule` (no external queue)

```typescript
// Built into NestJS — zero extra RAM overhead
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class JobsService {
  // Clean old read notifications (keep last 100 per user)
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanOldNotifications() {
    await this.dataSource.query(`
      DELETE FROM notifications
      WHERE id NOT IN (
        SELECT id FROM notifications n2
        WHERE n2.user_id = notifications.user_id
        ORDER BY created_at DESC
        LIMIT 100
      )
      AND is_read = TRUE
    `);
  }

  // Sync pending payments older than 1 hour to Stripe for status check
  @Cron(CronExpression.EVERY_HOUR)
  async reconcilePendingPayments() {
    const stale = await this.paymentRepo.find({
      where: { status: 'pending', createdAt: LessThan(subHours(new Date(), 1)) },
    });
    for (const p of stale) {
      const intent = await this.stripe.paymentIntents.retrieve(p.stripePaymentIntent);
      if (intent.status === 'succeeded') await this.markSucceeded(p);
      if (intent.status === 'canceled')  await this.markFailed(p);
    }
  }
}
```

**Jobs list:**

| Job | Frequency | Purpose |
|---|---|---|
| `cleanOldNotifications` | Daily midnight | Prevent notifications table bloat |
| `reconcilePendingPayments` | Every hour | Catch missed webhooks |
| `pruneOrphanMovies` | Weekly | Remove movies not in any list |

---

## 7. Performance Optimization Without Caching

### 7.1 Pagination Contract

**Offset/Limit (default for lists):**
```
GET /api/v1/watchlist?page=1&limit=20
```

**Cursor-based (for notifications feed — avoids offset on large tables):**
```
GET /api/v1/notifications?cursor=2024-01-10T12:00:00Z&limit=20
```
```sql
WHERE user_id = $1 AND created_at < $2  -- cursor = last item's created_at
ORDER BY created_at DESC
LIMIT 20
```

### 7.2 Select Only Needed Fields

```typescript
// TypeORM QueryBuilder — never SELECT *
const items = await this.userListRepo
  .createQueryBuilder('ul')
  .select(['ul.id', 'ul.createdAt', 'ul.rating'])
  .addSelect(['m.tmdbId', 'm.title', 'm.posterPath', 'm.voteAverage'])
  .innerJoin('ul.movie', 'm')
  .where('ul.userId = :userId AND ul.listType = :listType', { userId, listType })
  .orderBy('ul.createdAt', 'DESC')
  .skip((page - 1) * limit)
  .take(limit)
  .getManyAndCount();
```

### 7.3 Avoid N+1

```typescript
// BAD — N+1
const lists = await this.userListRepo.find({ where: { userId } });
for (const item of lists) {
  item.movie = await this.movieRepo.findOne(item.movieId); // N queries!
}

// GOOD — single JOIN query
const lists = await this.userListRepo.find({
  where: { userId, listType },
  relations: ['movie'],
  select: { id: true, createdAt: true, movie: { id: true, title: true, posterPath: true } },
});
```

### 7.4 Database Connection Pool (Free Hosting)

```typescript
// config/database.config.ts
TypeOrmModule.forRoot({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  extra: {
    max: 5,           // low cap to avoid OOM
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
  synchronize: false,
  migrationsRun: true,
})
```

---

## 8. Security Considerations

### 8.1 Rate Limiting (Lightweight — no Redis)

```typescript
// Use @nestjs/throttler with in-memory store (suitable for single instance)
ThrottlerModule.forRoot([
  { name: 'short', ttl: 1000,  limit: 5  },   // 5 req/sec
  { name: 'long',  ttl: 60000, limit: 100 },   // 100 req/min
])

// Stripe webhook exempt from rate limiting
@SkipThrottle()
@Post('webhook')
handleWebhook() {}

// Extra strict on payment intent creation
@Throttle({ short: { limit: 2, ttl: 5000 } })
@Post('intent')
createPaymentIntent() {}
```

### 8.2 Input Validation (Global Pipe)

```typescript
// main.ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,           // strip unknown fields
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
}));
```

### 8.3 Security Headers

```typescript
// main.ts
import helmet from 'helmet';
app.use(helmet());
app.enableCors({ origin: process.env.FRONTEND_URL, credentials: true });
```

### 8.4 Stripe Webhook — Raw Body

```typescript
// main.ts
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));
```

### 8.5 Data Protection

- All user-specific endpoints guarded with `JwtAuthGuard`
- `userId` always extracted from JWT — never trusted from request body
- Payment amounts validated server-side — never trust client-sent amount
- Stripe customer IDs stored in DB, never exposed to frontend

---

## 9. Deployment Checklist

### 9.1 Environment Variables

```env
# App
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://your-frontend.vercel.app

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require

# JWT (already implemented)
JWT_SECRET=your_jwt_secret
JWT_EXPIRATION=7d

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Socket.IO
SOCKET_CORS_ORIGIN=https://your-frontend.vercel.app
```

### 9.2 PostgreSQL Connection Optimization

```typescript
// Limit pool, enable SSL, set statement timeout
extra: {
  max: 5,
  statement_timeout: 10000,   // 10s max query time
  idle_in_transaction_session_timeout: 30000,
}
```

### 9.3 Memory Optimization for Free Hosting

```typescript
// main.ts — reduce NestJS overhead
const app = await NestFactory.create(AppModule, { bufferLogs: false });

// package.json start script
"start:prod": "node --max-old-space-size=256 dist/main"
```

### 9.4 Socket.IO on Free Hosting

- Use `transports: ['websocket']` only — disables long-polling fallback (saves RAM).
- If host doesn't support persistent connections (e.g., serverless), move Socket.IO to a dedicated lightweight service or use SSE as fallback.
- Set appropriate `pingInterval` / `pingTimeout` to handle cold restarts.

### 9.5 Cold Start Handling

```typescript
// Keep DB connection alive with periodic lightweight query
@Cron('*/10 * * * *')
async keepAlive() {
  await this.dataSource.query('SELECT 1');
}
```

### 9.6 Pre-deployment Checklist

- [ ] All migrations run (`npm run migration:run`)
- [ ] Indexes verified in production DB
- [ ] Stripe webhook URL registered in Stripe dashboard
- [ ] CORS origin set to exact production frontend URL
- [ ] `synchronize: false` in TypeORM config
- [ ] `NODE_ENV=production` set
- [ ] `--max-old-space-size` flag set
- [ ] Raw body middleware applied before Stripe webhook route
- [ ] All secrets in environment variables — zero hardcoding
- [ ] Health check endpoint at `GET /health` returns `200 OK`

---

## 10. Milestones → Phases → Tasks

---

### 🏁 Milestone 1 — Foundation & Core Infrastructure

---

#### Phase 1.1 — Project Bootstrap & Database Setup

**Objective:** Initialize NestJS project with all required dependencies, configure database connection, and run initial migrations.

**Priority:** Critical
**Estimated Effort:** 1–2 days
**Dependencies:** PostgreSQL instance available

**Tasks:**
1. Initialize NestJS project (`nest new`)
2. Install dependencies: `@nestjs/typeorm`, `pg`, `@nestjs/config`, `@nestjs/throttler`, `@nestjs/schedule`, `class-validator`, `class-transformer`, `helmet`, `stripe`, `@nestjs/websockets`, `socket.io`
3. Configure `ConfigModule` with `.env` validation using `Joi`
4. Configure `TypeOrmModule` with connection pool limits
5. Create initial migration with all tables
6. Set up global `ValidationPipe`, `HttpExceptionFilter`, `ResponseInterceptor`
7. Set up `ScheduleModule`
8. Add `/health` endpoint

**Deliverables:**
- Running NestJS app connecting to PostgreSQL
- All tables created via migration
- Global middleware and pipes configured

---

#### Phase 1.2 — Movies Module

**Objective:** Allow searching and retrieving movie data (sourced from TMDB API or pre-seeded). Upsert movies to local DB when users interact with them.

**Priority:** High
**Estimated Effort:** 1–2 days
**Dependencies:** Phase 1.1

**Tasks:**
1. Create `MoviesModule` with `MoviesController`, `MoviesService`, `Movie` entity
2. Implement TMDB proxy (fetch from TMDB, upsert into local `movies` table)
3. Implement movie upsert helper used by list modules
4. Add full-text search index on `title`

**API Design:**

```
GET /api/v1/movies?query=inception&page=1&limit=20
```

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "tmdbId": 27205,
      "title": "Inception",
      "overview": "A thief who steals...",
      "posterPath": "/poster.jpg",
      "releaseDate": "2010-07-16",
      "voteAverage": 8.4,
      "genres": ["Action", "Sci-Fi"]
    }
  ],
  "meta": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
}
```

```
GET /api/v1/movies/:id
```

Response: full movie object including `runtime`.

**Validation (DTO):**
```typescript
export class MovieQueryDto {
  @IsOptional() @IsString() query?: string;
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) page: number = 1;
  @IsOptional() @IsInt() @Min(1) @Max(50) @Type(() => Number) limit: number = 20;
}
```

**Frontend Integration Plan:**
- Fetch movie list on mount and on search input debounce (300ms).
- Use React Query: `useQuery(['movies', query, page], fetchMovies)`.
- On movie detail page, call `GET /api/v1/movies/:id`.
- Errors: show "Movie not found" on 404; show generic error toast on 500.
- Pagination: render page controls from `meta.totalPages`.

**Deliverables:**
- Movie browse + detail endpoints functional
- TMDB upsert helper reusable across modules

---

### 🏁 Milestone 2 — User Lists (Watchlist, Watched, Favorites)

---

#### Phase 2.1 — Watchlist Module

**Objective:** Allow authenticated users to add/remove movies from their watchlist and retrieve it paginated.

**Priority:** High
**Estimated Effort:** 1.5 days
**Dependencies:** Phase 1.2, JWT Auth (pre-existing)

**Tasks:**
1. Create `WatchlistModule` with entity referencing `user_lists` (filter by `list_type = 'watchlist'`)
2. Implement `GET`, `POST`, `DELETE` endpoints
3. On `POST`: upsert movie to `movies` table first, then insert into `user_lists`
4. Emit `list:updated` socket event after successful add/remove
5. Create notification record + emit `notification:new` on add

**API Design:**

```
GET /api/v1/watchlist?page=1&limit=20
Authorization: Cookie (JWT)
```

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "movie": { "tmdbId": 27205, "title": "Inception", "posterPath": "/img.jpg" },
      "createdAt": "2024-01-10T10:00:00Z"
    }
  ],
  "meta": { "total": 45, "page": 1, "limit": 20, "totalPages": 3 }
}
```

```
POST /api/v1/watchlist
Body: { "tmdbId": 27205, "title": "Inception", "posterPath": "/img.jpg", ... }
```

Response `201`:
```json
{ "id": "uuid", "movieId": "uuid", "createdAt": "..." }
```

```
DELETE /api/v1/watchlist/:movieId   → 204 No Content
```

**Validation (DTO):**
```typescript
export class AddToListDto {
  @IsInt() @IsPositive() tmdbId: number;
  @IsString() @MaxLength(500) title: string;
  @IsOptional() @IsString() posterPath?: string;
  @IsOptional() @IsString() overview?: string;
  @IsOptional() @IsDateString() releaseDate?: string;
  @IsOptional() @IsNumber() voteAverage?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) genres?: string[];
}
```

**Business Logic:**
- Check for duplicate before inserting (`UNIQUE(user_id, movie_id, list_type)` handles DB-level; catch unique constraint error and return 409).
- On successful add: create notification + emit socket.
- `movieId` path param is the internal UUID (not tmdbId).

**Socket Events emitted:**
- `list:updated` → `{ listType: 'watchlist', action: 'added' | 'removed', movieId }`
- `notification:new` → `{ id, type: 'movie_added_to_watchlist', title: 'Added to Watchlist', body: 'Inception was added to your watchlist', metadata: { tmdbId } }`

**Frontend Integration Plan:**
- Use React Query with `invalidateQueries(['watchlist'])` after mutation.
- Optimistic update: immediately add item to list, rollback on error.
- Listen to `list:updated` via Socket.IO → call `queryClient.invalidateQueries(['watchlist'])`.
- On 409: show "Already in watchlist" toast.
- On 404 (remove): already removed, treat as success silently.
- Debounce remove button to prevent double-click double-delete.

**Deliverables:**
- Watchlist CRUD endpoints
- Socket emission on changes
- Notification creation on add

---

#### Phase 2.2 — Watched List Module

**Objective:** Allow users to mark movies as watched, optionally rate them (1–10), and retrieve their watched history.

**Priority:** High
**Estimated Effort:** 1.5 days
**Dependencies:** Phase 2.1

**Tasks:**
1. Reuse `user_lists` table with `list_type = 'watched'`
2. `POST /watched` — upsert movie + insert list record with `watched_at = NOW()`
3. `PATCH /watched/:movieId` — update `rating` field
4. `DELETE /watched/:movieId`
5. Move from watchlist to watched (if exists in watchlist, remove it + add to watched in a transaction)

**API Design:**

```
POST /api/v1/watched
Body: { "tmdbId": 27205, "title": "Inception", ..., "rating": 8 }
```

Response `201`:
```json
{ "id": "uuid", "movieId": "uuid", "watchedAt": "...", "rating": 8 }
```

```
PATCH /api/v1/watched/:movieId
Body: { "rating": 9 }
```

Response `200`:
```json
{ "id": "uuid", "rating": 9, "updatedAt": "..." }
```

**Validation (DTO):**
```typescript
export class UpdateWatchedDto {
  @IsOptional() @IsInt() @Min(1) @Max(10) rating?: number;
}
```

**Business Logic:**
- Use DB transaction: remove from watchlist (if exists) + insert into watched atomically.
- Emit `list:updated` with `action: 'watched'` and `listType: 'watched'`.

**Frontend Integration Plan:**
- "Mark as watched" button: POST to `/watched`, invalidate `['watchlist']` and `['watched']`.
- Rating component: PATCH on rating select, show optimistic update.
- Edge cases: if movie is in favorites AND being removed from watched, keep favorites intact.
- Socket `list:updated` → refresh watched feed.

**Deliverables:**
- Watched list with rating support
- Atomic watchlist→watched transition

---

#### Phase 2.3 — Favorites Module

**Objective:** Allow users to add/remove movies from favorites. Identical to watchlist module in structure.

**Priority:** High
**Estimated Effort:** 0.5 days
**Dependencies:** Phase 2.1

**Tasks:**
1. Reuse `AddToListDto` and list logic with `list_type = 'favorites'`
2. Endpoints: `GET`, `POST`, `DELETE` — same pattern as watchlist
3. Socket emit on changes

**API Design:**

```
GET  /api/v1/favorites?page=1&limit=20
POST /api/v1/favorites       Body: AddToListDto
DELETE /api/v1/favorites/:movieId
```

**Frontend Integration Plan:**
- Heart icon toggle with optimistic update.
- React Query key: `['favorites']`.
- `list:updated` socket event → refresh favorites count in nav badge.

**Deliverables:**
- Favorites CRUD functional with socket emission

---

### 🏁 Milestone 3 — Notifications System

---

#### Phase 3.1 — Notifications Module + Socket Gateway

**Objective:** Persist notifications to DB and deliver them in real-time via Socket.IO user rooms.

**Priority:** High
**Estimated Effort:** 2 days
**Dependencies:** Phase 2.1, JWT Auth

**Tasks:**
1. Create `NotificationsModule` with entity, service, controller
2. Create `SocketGateway` in `SocketModule` — extract userId from JWT cookie on connection
3. Implement `NotificationsService.create()` called internally by other modules
4. Implement `emitToUser()` helper in `SocketGateway`
5. REST endpoints: `GET`, `PATCH /:id/read`, `PATCH /read-all`, `GET /unread-count`
6. Cursor-based pagination for notifications feed

**API Design:**

```
GET /api/v1/notifications?cursor=2024-01-10T12:00:00Z&limit=20
```

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "movie_added_to_watchlist",
      "title": "Added to Watchlist",
      "body": "Inception was added to your watchlist",
      "isRead": false,
      "metadata": { "tmdbId": 27205 },
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ],
  "meta": { "nextCursor": "2024-01-10T09:00:00Z", "hasMore": true }
}
```

```
GET /api/v1/notifications/unread-count
Response: { "count": 5 }

PATCH /api/v1/notifications/:id/read → 200 { "id": "...", "isRead": true }
PATCH /api/v1/notifications/read-all → 200 { "updatedCount": 5 }
```

**Socket Events:**

| Event | Direction | Payload |
|---|---|---|
| `notification:new` | Server→Client | `{ id, type, title, body, metadata, createdAt }` |
| `notification:unread_count` | Server→Client | `{ count: number }` |

**Business Logic:**
- `NotificationsService.create(userId, type, title, body, metadata)` — insert to DB, emit `notification:new`, emit updated unread count.
- Auth in gateway: parse JWT from `handshake.auth.token` or cookie header.

**Frontend Integration Plan:**
- On app load: connect Socket.IO client.
- Listen to `notification:new` → append to notifications list + show toast.
- Listen to `notification:unread_count` → update badge in nav.
- `GET /notifications/unread-count` on mount for initial badge value.
- Infinite scroll using cursor pagination: `useInfiniteQuery`.
- Click notification → mark as read via PATCH + update local state optimistically.
- "Mark all read" button → PATCH `/read-all`.
- Edge cases: if socket disconnects, fall back to polling `unread-count` every 60s.

**Deliverables:**
- Socket gateway with user rooms
- Notification persistence + real-time emission
- Full notifications REST API

---

### 🏁 Milestone 4 — Payment Integration

---

#### Phase 4.1 — Stripe Payment Module

**Objective:** Implement Stripe payment intent flow for premium access, handle webhooks securely, update user premium status.

**Priority:** Medium
**Estimated Effort:** 2–3 days
**Dependencies:** Phase 3.1

**Tasks:**
1. Install and configure Stripe SDK
2. Create `PaymentsModule` with `PaymentsService`, `PaymentsController`, `Payment` entity
3. `POST /payments/intent` — create or retrieve existing Stripe customer + create payment intent
4. `POST /payments/webhook` — verify signature, handle `payment_intent.succeeded`, `payment_intent.payment_failed`
5. `GET /payments/history` — paginated payment history for user
6. Update `users.is_premium = true` on success
7. Emit `payment:status` socket event after webhook
8. Create notification on payment success/failure

**API Design:**

```
POST /api/v1/payments/intent
Body: { "amount": 999, "currency": "usd", "description": "Premium access" }
```

Response `201`:
```json
{
  "clientSecret": "pi_xxx_secret_yyy",
  "paymentIntentId": "pi_xxx",
  "amount": 999,
  "currency": "usd"
}
```

```
GET /api/v1/payments/history?page=1&limit=10
```

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "amount": 999,
      "currency": "usd",
      "status": "succeeded",
      "description": "Premium access",
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ],
  "meta": { "total": 3, "page": 1, "limit": 10, "totalPages": 1 }
}
```

**Validation (DTO):**
```typescript
export class CreatePaymentIntentDto {
  @IsInt() @IsPositive() @Min(50) amount: number; // in cents, min $0.50
  @IsString() @IsIn(['usd', 'eur', 'gbp']) currency: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}
```

**Business Logic:**
1. Extract `userId` from JWT.
2. Find or create Stripe customer for user (store `stripe_customer_id` in DB).
3. Check idempotency key for duplicate request.
4. Create `PaymentIntent` via Stripe SDK.
5. Insert `payment` record with `status: 'pending'`.
6. Return `clientSecret` to frontend.

**Webhook Handler:**
```typescript
switch (event.type) {
  case 'payment_intent.succeeded':
    await this.handleSuccess(event.data.object);
    break;
  case 'payment_intent.payment_failed':
    await this.handleFailure(event.data.object);
    break;
}
```

**Socket Events emitted after webhook:**
- `payment:status` → `{ status: 'succeeded' | 'failed', amount, description }`

**Frontend Integration Plan:**
- Use Stripe.js + `@stripe/react-stripe-js` for card element.
- Step 1: POST `/payments/intent` → receive `clientSecret`.
- Step 2: `stripe.confirmCardPayment(clientSecret, { payment_method: { card } })`.
- Step 3: Listen to `payment:status` socket event for real-time confirmation UI.
- Do NOT rely solely on Stripe.js callback — always wait for socket event from backend webhook for authoritative status.
- Error handling: `card_declined` → show "Card declined", `insufficient_funds` → specific message.
- Show loading spinner between payment confirmation and socket event receipt.
- Timeout: if no socket event within 15s, poll `GET /payments/history` for status.

**Deliverables:**
- Payment intent creation endpoint
- Secure webhook handler with signature verification
- Premium status update flow
- Socket + notification on payment events

---

### 🏁 Milestone 5 — Polish & Production Readiness

---

#### Phase 5.1 — Cross-cutting Concerns

**Priority:** High
**Estimated Effort:** 1 day

**Tasks:**
1. Global exception filter — standardized error envelope
2. Response interceptor — wrap all responses in `{ data, meta }` envelope
3. Request logging middleware (lightweight — log method, path, status, duration)
4. Throttler guards applied globally + per-route overrides
5. Helmet security headers
6. CORS configuration
7. Graceful shutdown handling

**Global Exception Filter:**
```typescript
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = exception instanceof HttpException
      ? exception.getResponse()
      : 'Internal server error';
    response.status(status).json({
      statusCode: status,
      message: typeof message === 'string' ? message : (message as any).message,
      errors: typeof message === 'object' ? (message as any).errors : undefined,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
```

---

#### Phase 5.2 — Database Migrations & Seeding

**Priority:** High
**Estimated Effort:** 0.5 days

**Tasks:**
1. Write TypeORM migration for all tables
2. Write seed script for development (sample movies, test user)
3. `migration:generate`, `migration:run`, `migration:revert` scripts in `package.json`
4. Verify all indexes exist in production DB via `\d table_name`

---

#### Phase 5.3 — Background Jobs & Keep-Alive

**Priority:** Medium
**Estimated Effort:** 0.5 days

**Tasks:**
1. `cleanOldNotifications` cron (daily)
2. `reconcilePendingPayments` cron (hourly)
3. `keepAlive` DB ping cron (every 10 minutes — prevents connection drop on free tier)

---

## Milestone & Timeline Summary

| Milestone | Phases | Effort | Priority |
|---|---|---|---|
| 1 — Foundation | 1.1 Bootstrap, 1.2 Movies | 3–4 days | Critical |
| 2 — Lists | 2.1 Watchlist, 2.2 Watched, 2.3 Favorites | 3.5 days | High |
| 3 — Notifications | 3.1 Notifications + Socket | 2 days | High |
| 4 — Payments | 4.1 Stripe | 2–3 days | Medium |
| 5 — Polish | 5.1 Cross-cutting, 5.2 Migrations, 5.3 Jobs | 2 days | High |
| **Total** | | **~13–14 days** | |

---

## Appendix — Key DTOs Reference

```typescript
// Pagination query (base)
export class PaginationDto {
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) page: number = 1;
  @IsOptional() @IsInt() @Min(1) @Max(50) @Type(() => Number) limit: number = 20;
}

// Cursor pagination (notifications)
export class CursorPaginationDto {
  @IsOptional() @IsDateString() cursor?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) @Type(() => Number) limit: number = 20;
}

// Add to any list
export class AddToListDto {
  @IsInt() @IsPositive() tmdbId: number;
  @IsString() @MaxLength(500) title: string;
  @IsOptional() @IsString() posterPath?: string;
  @IsOptional() @IsString() overview?: string;
  @IsOptional() @IsDateString() releaseDate?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(10) voteAverage?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) genres?: string[];
}

// Update watched rating
export class UpdateWatchedDto {
  @IsOptional() @IsInt() @Min(1) @Max(10) rating?: number;
}

// Payment intent creation
export class CreatePaymentIntentDto {
  @IsInt() @IsPositive() @Min(50) amount: number;
  @IsString() @IsIn(['usd', 'eur', 'gbp']) currency: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}
```

---

*Generated plan for: NestJS Movie Website Backend — Portfolio Project*
*Stack: NestJS · PostgreSQL · Socket.IO · Stripe | Constraint: No Redis · Low RAM*