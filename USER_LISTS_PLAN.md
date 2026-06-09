# User Lists System — Implementation Plan (v3, interview-ready)

> Senior NestJS backend architect plan for a **portfolio-quality** user lists system on a movie/TV app.
> Stack: NestJS 11 + TypeORM 0.3.x + PostgreSQL. Deployed on free hosting, no Redis.
>
> v3: critically reviewed and simplified for interview clarity. Two tables only, no extra services,
> no event-driven architecture, no background jobs. Designed to be explained in a 10-minute portfolio review.

---

## 0. Critical Review & Simplification Rationale

This design was reviewed against 9 common over-engineering patterns. Each issue was addressed by **removing complexity** rather than optimizing it.

### 0.1 Review Summary

| Issue | Problem | Solution | Rationale |
|-------|---------|----------|-----------|
| **1. Architecture** | Too many moving parts (events, cron, caching) | 2 tables only, no event bus, no background jobs | Portfolio projects need clarity, not distributed systems |
| **2. TMDB Integration** | Snapshot system + lazy refresh + caching | Fetch once at insert time, store minimal snapshot | No refresh system, no cache table, no retry logic |
| **3. Redundant Tables** | media_cache, history tables, system helpers | Remove all extra tables | Only `user_lists` and `user_list_items` needed |
| **4. item_count** | Counter maintenance via transactions | Use `COUNT(*)` when needed | Avoid denormalized counters for MVP |
| **5. Index Over-Optimization** | Too many indexes for early-stage | Keep only 3 essential indexes | PRIMARY KEYs + unique constraint + pagination index |
| **6. Pagination Overthinking** | OFFSET + cursor planning | Simple OFFSET only | No cursor pagination, no premature optimization |
| **7. Unnecessary Endpoints** | exists, move, system special endpoints | Remove exists and move endpoints | System lists behave like normal lists |
| **8. Event-Driven System** | user.created event, ensureSystemLists handler | Simple synchronous creation in user service | No event bus usage |
| **9. Snapshot Data Overload** | Too much TMDB data per item | Keep only 4 minimal fields | title, poster_path, release_date, vote_average |

### 0.2 Design Principles (Final)

1. **Two tables only** — `user_lists` and `user_list_items`. No extra tables.
2. **Minimal API surface** — only essential CRUD operations.
3. **No event-driven architecture** — synchronous service calls only.
4. **No background jobs** — snapshots frozen on insert.
5. **Interview-ready clarity** — can be explained in 10 minutes.

---

## 1. Context & Decisions

- The current `user_lists` table (migration `1775975939705`) will be **replaced** with the new schema.
- TMDB strategy: **denormalized snapshot stored on each list item, fetched once on insert**. No refresh, no cache.
- Default system lists: **Favorites, Watchlist, Watched** — seeded via migration (existing users) and service call (new users).
- v1: **private only**. No public/unlisted lists. Adding `visibility` later is non-breaking.
- ORM: **TypeORM** (already in use).
- IDs: `uuid v4` for `user_lists` and `user_list_items`; `(media_type, tmdb_id)` is the natural key for media references.
- The existing `movies` table is preserved but the new design does **not** depend on it.

### What was removed (and why)

| Removed | Why |
|---------|-----|
| `media_cache` table | Two tables are easier to reason about than three |
| In-process memory cache | Single-process assumption is fragile on free hosting |
| `user_list_item_history` table | Out of scope for v1 |
| Cron snapshot-refresh job | Snapshots are static-on-add; TMDB is a one-shot cost |
| `@nestjs/event-emitter` system-list creation | Replaced by direct service call |
| `BEFORE UPDATE` DB trigger on system lists | Service-level checks are enough |
| `item_count` column + reconciliation | `COUNT(*)` is fine on small lists |
| `/exists` and `/move` endpoints | YAGNI; trivially expressed via existing operations |
| Snapshot fields `overview`, `backdrop_path`, `genres` | Heavy; not needed to render a list |
| `position` (lexorank) column | Default sort by `added_at` is enough |
| Soft delete on lists | Hard delete is fine for user-initiated actions |

---

## 1. Database Design

### 1.1 Tables

#### `user_lists` — list definitions (one row per list)

| Column       | Type                                 | Notes                                                                |
| ------------ | ------------------------------------ | -------------------------------------------------------------------- |
| `id`         | `uuid` PK                            | `DEFAULT uuid_generate_v4()`                                         |
| `user_id`    | `uuid` NOT NULL                      | FK → `users(id)` ON DELETE CASCADE                                   |
| `name`       | `varchar(80)` NOT NULL               | Display name, trimmed                                               |
| `slug`       | `varchar(100)` NOT NULL              | URL-safe; auto-generated from `name`                                 |
| `list_key`   | `varchar(40)` NOT NULL               | Stable machine key: `favorites`, `watchlist`, `watched`, or `custom:<uuid>` |
| `is_system`  | `boolean` NOT NULL DEFAULT false     | System lists cannot be deleted/renamed by the user                   |
| `created_at` | `timestamptz` NOT NULL DEFAULT now() |                                                                      |
| `updated_at` | `timestamptz` NOT NULL DEFAULT now() |                                                                      |

**Indexes (only 3, as per review point #5):**
- `PRIMARY KEY (id)` — clustered index.
- `UNIQUE (user_id, list_key)` — one row per system list per user.
- `INDEX (user_id, created_at DESC)` — supports the default sort of the "my lists" index.

> **Note:** The `UNIQUE (user_id, lower(name))` constraint was removed per review point #5 (index over-optimization). For a portfolio project, this is unnecessary complexity.

#### `user_list_items` — items inside a list

| Column        | Type                              | Notes                                              |
| ------------- | --------------------------------- | -------------------------------------------------- |
| `id`          | `uuid` PK                         | `DEFAULT uuid_generate_v4()`                       |
| `list_id`     | `uuid` NOT NULL                   | FK → `user_lists(id)` ON DELETE CASCADE            |
| `user_id`     | `uuid` NOT NULL                   | FK → `users(id)` ON DELETE CASCADE (denormalized)  |
| `media_type`  | `enum('movie','tv')` NOT NULL     | PostgreSQL enum                                    |
| `tmdb_id`     | `integer` NOT NULL                | TMDB id for that media type                        |
| `title`       | `varchar(500)` NOT NULL           | Snapshot                                           |
| `poster_path` | `varchar(255)` NULL               | Snapshot                                           |
| `release_date`| `date` NULL                       | Snapshot (for tv: `first_air_date`)                |
| `vote_average`| `numeric(3,1)` NULL               | Snapshot                                           |
| `added_at`    | `timestamptz` NOT NULL DEFAULT now() | When the user added it                           |

**Indexes (only 2, as per review point #5):**
- `PRIMARY KEY (id)` — clustered index.
- `UNIQUE (list_id, media_type, tmdb_id)` — **the duplicate guard**.
- `INDEX (list_id, added_at DESC, id DESC)` — the only pagination path.

> **Note:** The `snapshot_at` column was removed per review point #9 (snapshot data overload). Snapshots are frozen on insert; tracking when they were captured adds no value for a portfolio project.

### 1.2 Migration strategy

A single migration `<ts>-ReplaceUserListsWithNewSchema.ts` does, in order:

1. Drop the existing `user_lists` table and its enum (no production data to preserve).
2. Create the new `user_list_items_media_type_enum`.
3. Create `user_lists` with constraints and indexes.
4. Create `user_list_items` with constraints and indexes.
5. **Seed system lists for every existing user**: for each row in `users`, insert the three system lists with `list_key IN ('favorites','watchlist','watched')`. Done in a single SQL with a `CROSS JOIN` over `users` and a literal list of system keys, then `INSERT … ON CONFLICT (user_id, list_key) DO NOTHING`. Idempotent.
6. Future signups go through `ListsService.ensureSystemLists(userId)` (simple service call — no events).

### 1.3 Item count

- **No `item_count` column** (per review point #4). Use `COUNT(*)` when needed.
- A user has 3 system lists + typically 0–10 custom lists, and each list is ≤ a few hundred items. `COUNT(*)` on an indexed column is sub-millisecond at this size.
- This removes: counter increments, decrements, clamps at 0, drift, reconciliation.

### 1.4 Soft delete

- None. `DELETE /api/me/lists/:id` is a hard delete; `user_lists` and `user_list_items` cascade through the FK on the user.
- For v1 (private lists, free hosting, no compliance requirement) this is the right tradeoff.

### 1.5 Why a denormalized snapshot on each item

- The list-detail endpoint returns the snapshot directly — no join to TMDB, no second table, no cache lookup.
- Each row is small (~150 bytes) without `overview`/`genres`. A 500-item list is ~75 KB, comfortably inside a single Postgres page set.
- Trade-off we accept: the same movie added by 1000 users is stored 1000 times. Storage is cheap; **read latency** is what kills free hosting.
- Snapshots are **frozen on insert**. No background refresh.

---

## 2. NestJS Architecture

### 2.1 Module layout — `src/modules/lists/`

```
src/modules/lists/
├── lists.module.ts
├── lists.controller.ts                # all /api/me/lists/* endpoints
├── lists.service.ts                  # all business logic
├── tmdb/
│   ├── tmdb.service.ts               # @nestjs/axios wrapper
│   ├── tmdb.types.ts                 # narrow internal types
│   └── tmdb.mapper.ts                # TMDB → internal snapshot
├── schema/
│   ├── user-list.entity.ts
│   └── user-list-item.entity.ts
├── dto/
│   ├── create-list.dto.ts
│   ├── update-list.dto.ts
│   ├── add-item.dto.ts
│   ├── filter-lists.dto.ts
│   ├── filter-list-items.dto.ts
│   ├── list-response.dto.ts
│   ├── list-item-response.dto.ts
│   └── list-summary.dto.ts
├── enums/
│   ├── list-key.enum.ts              # FAVORITES, WATCHLIST, WATCHED
│   └── media-type.enum.ts            # movie, tv
└── helpers/
    └── slug.helper.ts
```

> **Minimal module structure** — only essential files. No repository layer, no cache entities, no public controllers.

### 2.2 Module wiring (`lists.module.ts`)

```ts
@Module({
  imports: [
    TypeOrmModule.forFeature([UserList, UserListItem]),
    AuthModule,          // JwtAuthGuard + @GetUser()
    HttpModule,          // @nestjs/axios for TMDB calls
    ConfigModule,        // TMDB_API_KEY, TMDB_BASE_URL
  ],
  controllers: [ListsController],
  providers: [ListsService, TmdbService],
  exports: [ListsService],
})
export class ListsModule {}
```

`ListsService.ensureSystemLists(userId)` is called directly from the user creation path (the auth service that creates the user). This is a synchronous call, not an event (per review point #8).

### 2.3 Entity sketch (TypeORM)

```ts
// user-list.entity.ts
@Entity('user_lists')
@Index('uq_user_lists_user_key', ['userId', 'listKey'], { unique: true })
@Index('ix_user_lists_user_recent', ['userId', 'createdAt'])
export class UserList {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ length: 80 }) name: string;
  @Column({ length: 100 }) slug: string;
  @Column({ name: 'list_key', length: 40 }) listKey: string;
  @Column({ name: 'is_system', default: false }) isSystem: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
```

```ts
// user-list-item.entity.ts
@Entity('user_list_items')
@Index('uq_list_item', ['listId', 'mediaType', 'tmdbId'], { unique: true })
@Index('ix_list_recent', ['listId', 'addedAt', 'id'])
export class UserListItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'list_id', type: 'uuid' }) listId: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'media_type', type: 'enum', enum: MediaType })
  mediaType: MediaType;
  @Column({ name: 'tmdb_id', type: 'int' }) tmdbId: number;
  @Column({ length: 500 }) title: string;
  @Column({ name: 'poster_path', length: 255, nullable: true })
  posterPath: string | null;
  @Column({ name: 'release_date', type: 'date', nullable: true })
  releaseDate: string | null;
  @Column({ name: 'vote_average', type: 'numeric', precision: 3, scale: 1, nullable: true })
  voteAverage: number | null;
  @CreateDateColumn({ name: 'added_at' }) addedAt: Date;
}
```

### 2.4 DTOs (class-validator + Swagger)

```ts
// create-list.dto.ts
export class CreateListDto {
  @IsString() @IsNotEmpty() @MaxLength(80) @Trim() name: string;
}

// update-list.dto.ts
export class UpdateListDto {
  @IsOptional() @IsString() @MaxLength(80) @Trim() name?: string;
}

// add-item.dto.ts
export class AddItemDto {
  @IsEnum(MediaType) mediaType: MediaType;
  @IsInt() @Min(1) tmdbId: number;
}

// filter-lists.dto.ts
export class FilterListsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

// filter-list-items.dto.ts
export class FilterListItemsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsEnum(MediaType) mediaType?: MediaType;
}
```

Response DTOs:
- `ListSummaryDto` — `id, name, slug, listKey, isSystem, createdAt, updatedAt`.
- `ListResponseDto` — summary fields + `items: ListItemResponseDto[]` + `page, limit, total, lastPage`.
- `ListItemResponseDto` — `id, mediaType, tmdbId, title, posterPath, releaseDate, voteAverage, addedAt`.

> **Note:** The `note` field was removed from `AddItemDto` per review point #9 (snapshot data overload). This is unnecessary metadata for a portfolio project.

---

## 3. Business Logic

### 3.1 Create list (`POST /api/me/lists`)

- Service generates `slug` from `name` (slugify, lower-case, replace non-alphanumerics, cap at 100).
- `list_key` is set to `custom:<uuid>`.
- `is_system = false`.
- Wrapped in a `dataSource.transaction`. On `23505` (unique violation) return `409 Conflict`.

System lists are **not** created here — they come from the migration (existing users) or `ensureSystemLists` on signup (new users).

### 3.2 System lists

Two paths, both idempotent:

1. **Existing users** — handled by the migration, which inserts the three system lists for every user with `INSERT … ON CONFLICT (user_id, list_key) DO NOTHING`.
2. **New users** — the auth/user service that creates the user calls `ListsService.ensureSystemLists(userId)` after the user row is committed. This is a **direct function call**, not an event (per review point #8). Same `INSERT … ON CONFLICT DO NOTHING` pattern.

```ts
async ensureSystemLists(userId: string): Promise<void> {
  await this.listRepo
    .createQueryBuilder()
    .insert()
    .values(SYSTEM_LISTS.map((l) => ({ ...l, userId, isSystem: true })))
    .orIgnore()
    .execute();
}
```

`ensureSystemLists` is fire-and-forget wrapped in a `try/catch`; failures must not block signup.

### 3.3 Add item — TMDB call **outside** the transaction

```ts
async addItem(userId, listId, dto) {
  // 1. Authorize: list must exist, belong to user.
  const list = await this.assertOwnedList(userId, listId);

  // 2. Fetch the snapshot BEFORE opening a transaction. This is the only TMDB call.
  const snapshot = await this.tmdbService.getMedia(dto.mediaType, dto.tmdbId);
  //    On failure, throw ServiceUnavailableException(502).

  // 3. Short transaction: insert the item, no counter, no second table.
  return this.dataSource.transaction(async (tx) => {
    const result = await tx
      .createQueryBuilder()
      .insert()
      .into(UserListItem)
      .values({
        listId, userId,
        mediaType: dto.mediaType, tmdbId: dto.tmdbId,
        title: snapshot.title,
        posterPath: snapshot.posterPath ?? null,
        releaseDate: snapshot.releaseDate ?? null,
        voteAverage: snapshot.voteAverage ?? null,
      })
      .orIgnore()
      .returning(['id', 'addedAt'])
      .execute();

    if (result.identifiers.length === 0) {
      // Duplicate — return the existing item, 200 with { duplicate: true }.
      const existing = await tx.findOne(UserListItem, {
        where: { listId, mediaType: dto.mediaType, tmdbId: dto.tmdbId },
      });
      return { duplicate: true, item: existing };
    }
    return { duplicate: false, item: { ...snapshot, id: result.identifiers[0].id } };
  });
}
```

Why outside the transaction:
- The transaction holds a DB connection; an HTTP call to TMDB inside it would tie up the pool (capped at 5).
- TMDB can be slow / fail; we want a 502, not a stuck connection.
- A duplicate insert is the **only** "external" thing that could race, and the unique index handles it.

### 3.4 Remove item

```ts
async removeItem(userId, listId, mediaType, tmdbId) {
  await this.assertOwnedList(userId, listId);
  const result = await this.itemRepo.delete({ listId, mediaType, tmdbId });
  if (!result.affected) throw new NotFoundException();
}
```

No counter to update.

### 3.5 System-list rules

- **Create** — only via the migration / `ensureSystemLists`. The `POST /api/me/lists` endpoint cannot create system lists.
- **Rename** — rejected for `is_system = true` with `403`.
- **Delete** — rejected for `is_system = true` with `403`.
- **Add/remove items** — works normally.
- The check is at the service level. No DB trigger.

### 3.6 Rename / delete

- **Rename** (`PATCH /api/me/lists/:id` with `{ name }`): regenerate `slug`, update `name`/`slug`/`updated_at`; reject if `is_system`.
- **Delete** (`DELETE /api/me/lists/:id`): hard delete; reject if `is_system`. Cascade removes the items.

### 3.7 Counting items efficiently

- Just `COUNT(*)` on `user_list_items WHERE list_id = :listId`. With the unique index `(list_id, media_type, tmdb_id)` Postgres can use an index-only scan. Sub-millisecond.
- The "list summary" endpoint includes the count (one extra query per list). The index is a flat list of names; counts happen on detail.

### 3.8 Fetching list items efficiently

```sql
SELECT *
  FROM user_list_items
 WHERE list_id = :listId
   AND (:mediaType::user_list_items_media_type_enum IS NULL OR media_type = :mediaType)
 ORDER BY added_at DESC, id DESC
 LIMIT :limit OFFSET :offset;
```

Plus a `COUNT(*)` for `total`. Both are bounded by the `(list_id, added_at DESC, id DESC)` index. No joins, no extra round trips.

---

## 4. Performance Strategy (no Redis)

1. **Selective denormalization** — snapshot lives on the item. Reads never call TMDB, never join a cache table.
2. **Minimal indexes** — exactly the 5 indexes listed in §1.1 (2 on `user_lists`, 3 on `user_list_items`). Each one earns its place (per review point #5).
3. **`COUNT(*)` for counts** — no counter column, no reconciliation, no drift (per review point #4).
4. **Pagination** — simple OFFSET only (per review point #6). No cursor pagination, no premature optimization.
5. **No in-process cache** — explicit decision. A single-process assumption is fragile on free hosting.
6. **No N+1** — every endpoint is a fixed 1–3 queries.
7. **No background jobs** — snapshots are frozen on insert. No event-driven architecture (per review point #8).
8. **TMDB call minimization** — at most 1 call to TMDB per add, ever. On duplicate adds, the unique index short-circuits before any work.

### 4.1 When to call TMDB

| Trigger                          | TMDB call?                  |
| -------------------------------- | --------------------------- |
| Add item to list                 | Yes, exactly once per add   |
| Render a list / render an item   | **No** — use snapshot       |
| Refresh / cron                   | **No** (no job in v1)       |

---

## 5. API Design (REST)

All endpoints are mounted at `/api`. Auth is required (`@GetUser()`).

**Minimal API surface** — only essential CRUD operations (per review point #7).

| Method | Path                                          | Purpose                                |
| ------ | --------------------------------------------- | -------------------------------------- |
| POST   | `/api/me/lists`                               | Create custom list                     |
| GET    | `/api/me/lists`                               | Get all my lists (summary)             |
| GET    | `/api/me/lists/:id`                           | Get one list with paginated items      |
| PATCH  | `/api/me/lists/:id`                           | Rename                                 |
| DELETE | `/api/me/lists/:id`                           | Delete list (hard, custom only)        |
| POST   | `/api/me/lists/:id/items`                     | Add item                               |
| DELETE | `/api/me/lists/:id/items/:mediaType/:tmdbId`  | Remove item                            |

**Removed endpoints (per review point #7):**
- `GET /api/me/lists/system/:key` — system lists behave like normal lists, accessed via `GET /api/me/lists/:id`
- `GET /api/me/lists/:id/items` — redundant with list detail endpoint
- `/exists` endpoint — YAGNI
- `/move` endpoint — YAGNI

### 5.1 Endpoint contracts

#### `POST /api/me/lists` — create custom list
**Body** `{ "name": "Best Sci-Fi of the Decade" }`
**201** — full list row, `listKey = "custom:<uuid>"`, `isSystem = false`.

#### `GET /api/me/lists` — get all lists
**Query** `?page=1&limit=20`
**200** — `{ data: ListSummaryDto[], total, page, limit, lastPage }`. System lists first (`is_system DESC, created_at ASC`).

#### `GET /api/me/lists/:id` — list detail
**Query** `?page=1&limit=50&mediaType=movie`
**200** — `{ ...summary, items: ListItemResponseDto[], total, page, limit, lastPage }`.
**404** not found / not owned.

#### `POST /api/me/lists/:id/items` — add item
**Body** `{ "mediaType": "movie", "tmdbId": 27205 }`
**201** — full item.
**200** `{ "duplicate": true, "item": {...} }` if already in list (idempotent).
**404** list not found, **403** not owner, **502** TMDB upstream error.

#### `DELETE /api/me/lists/:id/items/:mediaType/:tmdbId`
**204** on success. **404** if not in list.

#### `PATCH /api/me/lists/:id` — rename
**Body** `{ "name": "Favorites v2" }` (only `name` is supported)
**200** — updated list. **403** for system lists.

#### `DELETE /api/me/lists/:id`
**204**. **403** for system lists. Items are removed by cascade.

---

## 6. Data Modeling Details

### 6.1 User (existing — no change)
Cascade on delete removes the user's lists and items.

### 6.2 UserList — see §1.1 and §2.3
### 6.3 UserListItem — see §1.1 and §2.3

### 6.4 Enums

```ts
// media-type.enum.ts
export enum MediaType { MOVIE = 'movie', TV = 'tv' }

// list-key.enum.ts (only for system lists; custom lists use `custom:<uuid>`)
export enum SystemListKey { FAVORITES = 'favorites', WATCHLIST = 'watchlist', WATCHED = 'watched' }
```

`list_key` is a `varchar(40)`, not an enum, so it can hold `custom:<uuid>` too.

---

## 7. Query Examples

### 7.1 Create list
```sql
INSERT INTO user_lists (user_id, name, slug, list_key, is_system)
VALUES (:userId, :name, :slug, :listKey, FALSE)
ON CONFLICT (user_id, list_key) DO NOTHING
RETURNING *;
```

### 7.2 Insert list item (idempotent, no counter)
```sql
INSERT INTO user_list_items (
  list_id, user_id, media_type, tmdb_id, title, poster_path, release_date, vote_average
)
VALUES (
  :listId, :userId, :mt, :tmdbId, :title, :posterPath, :releaseDate, :voteAverage
)
ON CONFLICT (list_id, media_type, tmdb_id) DO NOTHING
RETURNING *;
```

If `RETURNING` is empty → duplicate; service fetches the existing row and returns `{ duplicate: true }`.

### 7.3 Fetch lists for a user
```sql
SELECT id, name, slug, list_key, is_system, created_at, updated_at
  FROM user_lists
 WHERE user_id = :userId
 ORDER BY is_system DESC, created_at ASC
 LIMIT :limit OFFSET :offset;
```

### 7.4 Fetch items with pagination
```sql
SELECT *
  FROM user_list_items
 WHERE list_id = :listId
   AND (:mediaType::user_list_items_media_type_enum IS NULL OR media_type = :mediaType)
 ORDER BY added_at DESC, id DESC
 LIMIT :limit OFFSET :offset;

SELECT COUNT(*) FROM user_list_items WHERE list_id = :listId;
```

### 7.5 Seed system lists (migration, existing users)
```sql
INSERT INTO user_lists (user_id, name, slug, list_key, is_system)
SELECT u.id, k.name, k.slug, k.list_key, TRUE
  FROM users u
  CROSS JOIN (VALUES
    ('Favorites', 'favorites', 'favorites'),
    ('Watchlist', 'watchlist', 'watchlist'),
    ('Watched',   'watched',   'watched')
  ) AS k(name, slug, list_key)
ON CONFLICT (user_id, list_key) DO NOTHING;
```

---

## 8. Best Practices

- **Indexes** — exactly the 5 listed in §1.1. Nothing more (per review point #5).
- **Unique constraints**:
  - `(user_id, list_key)` on `user_lists`
  - `(list_id, media_type, tmdb_id)` on `user_list_items` ← **the duplicate guard**
- **Pagination** — simple OFFSET only (per review point #6). No cursor pagination.
- **Sorting** — server-defined, never user-supplied. Default `added_at DESC, id DESC` for items; `is_system DESC, created_at ASC` for the list index.
- **Transactions** — used for create list, add item, delete list. The transaction is short and contains no HTTP calls.
- **ID generation** — Postgres `uuid_generate_v4()` (matches existing project style).
- **Response payload size** — list summary excludes `items`; list detail caps `limit = 50` for items; snapshot fields are 4 columns only.
- **Deployment on free hosting**:
  - 5-connection pool, `statement_timeout = 10s`, `idle_in_transaction_session_timeout = 30s` — already configured in `src/config/database.config.ts`, keep.
  - No `cache-manager` use anywhere in this module.
  - TMDB calls happen outside transactions so they don't hold a DB connection.

---

## 9. Implementation Plan (Step-by-Step)

> Each step is independently shippable and reviewed.

### Step 1 — TMDB HTTP wrapper
Files: `src/modules/lists/tmdb/tmdb.service.ts`, `tmdb.types.ts`, `tmdb.mapper.ts`.
- Inject `HttpService` + `ConfigService`.
- `getMedia(mediaType, tmdbId): Promise<TmdbSnapshot>` — one endpoint, throws `ServiceUnavailableException` on failure.
- Unit tests: mapper correctness.

### Step 2 — Entities, DTOs, module skeleton
- `schema/user-list.entity.ts`, `schema/user-list-item.entity.ts`.
- All DTOs from §2.4.
- `lists.module.ts` registered in `app.module.ts`.
- `database.config.ts`: add the two new entities.
- `lists.controller.ts` skeleton with Swagger annotations.
- Lint clean, no DB changes yet.

### Step 3 — Migration
File: `db/migrations/<ts>-ReplaceUserListsWithNewSchema.ts`
- Drops the old `user_lists` table + enum.
- Creates `user_lists` and `user_list_items` with constraints and indexes.
- Seeds system lists for every existing user (see §7.5).
- `up()` and `down()` both implemented.
- Local verification: dev DB, app starts, no other module references the old table.

### Step 4 — `ListsService` core (create / list / detail)
- `create(userId, dto)`, `findAllForUser(userId, filters)`, `findOneForUser(userId, listId, filters)`.
- `ensureSystemLists(userId)` (used by signup and exposed for ops).
- Use the `paginate()` helper from `src/helpers/paginate.helper.ts`.
- Tests: `lists.service.spec.ts` with mocked repos.

### Step 5 — Add / remove items + TMDB integration
- `addItem(userId, listId, dto)` — fetch TMDB snapshot **outside** the transaction, then a short insert.
- `removeItem(userId, listId, mediaType, tmdbId)` — simple delete.
- Wrap only the insert in `dataSource.transaction()`.
- `PG_UNIQUE_VIOLATION` (`23505`) on `uq_list_item` → 200 with `duplicate: true`.

### Step 6 — System-list wiring on signup
- After user creation in `AuthModule` / `UserModule`, call `ListsService.ensureSystemLists(userId)` directly. `try/catch` so a failure does not block signup.
- Document this contract in the service header.

### Step 7 — Rename / delete
- `update(userId, listId, dto)` rejects on system lists.
- `remove(userId, listId)` rejects on system lists.

### Step 8 — Tests
- Unit: `lists.service.spec.ts` (mocked repos + mocked `TmdbService`).
- E2E (`test/lists.e2e-spec.ts`): signup → ensure system lists → add item → fetch detail → remove → delete a custom list. Use a real Postgres (testcontainers) or a local instance.

### Step 9 — Documentation
- Update `AGENTS.md` with the new `lists/` module structure.
- Add Swagger decorators so `/api/docs` shows the new endpoints.

---

## 10. Open / Deferred Items

> These items are intentionally deferred. The current design is complete for a portfolio project.

- **Public/unlisted lists** — add a `visibility` column + a public controller. Non-breaking.
- **Snapshot refresh** — if metadata staleness becomes a problem, add a `@Cron` job that batched-updates items where `snapshot_at < now() - interval '30 days'`.
- **`user_list_item_history`** — for "recently removed" or analytics. Add when there's a concrete need.
- **Cursor pagination** — switch to `(added_at, id)` keyset if any user exceeds ~5k items per list.
- **Redis** — out of scope. If ever added, the natural cache target would be list-detail payloads, keyed by `(userId, listId, page)`.
- **`media_cache` table** — if TMDB rate-limits become a problem, reintroduce it.
- **Item reordering / `position` column** — not in v1; default `added_at` ordering is enough.
- **Archiving lists** — out of scope for v1; can be added as a boolean column.
- **Soft delete on lists** — out of scope; hard delete is fine on a user-initiated action.

---

## 11. Files to Add / Change

**New (under `src/modules/lists/`)**
- `lists.module.ts`
- `lists.controller.ts`
- `lists.service.ts`
- `tmdb/tmdb.service.ts`, `tmdb.types.ts`, `tmdb.mapper.ts`
- `schema/user-list.entity.ts`
- `schema/user-list-item.entity.ts`
- `dto/create-list.dto.ts`
- `dto/update-list.dto.ts`
- `dto/add-item.dto.ts`
- `dto/filter-lists.dto.ts`
- `dto/filter-list-items.dto.ts`
- `dto/list-response.dto.ts`
- `dto/list-item-response.dto.ts`
- `dto/list-summary.dto.ts`
- `enums/list-key.enum.ts`
- `enums/media-type.enum.ts`
- `helpers/slug.helper.ts`
- `tests/lists.service.spec.ts`

**New migration**
- `db/migrations/<ts>-ReplaceUserListsWithNewSchema.ts`

**Modified**
- `src/app.module.ts` — import `ListsModule`.
- `src/config/database.config.ts` — register the two new entities.
- `src/user/user.module.ts` (or `src/auth/auth.module.ts`) — call `ListsService.ensureSystemLists(userId)` after user creation.
- `AGENTS.md` — document the new module.
