# Lists Module Audit Report

**Module:** `src/modules/lists/`
**Date:** 2026-06-07
**Auditor:** AI Code Review

---

## Table of Contents

1. [N+1 Query in `ensureSystemLists`](#1-n1-query-in-ensuresystemlists)
2. [Race Condition on Slug Uniqueness (TOCTOU)](#2-race-condition-on-slug-uniqueness-toctou)
3. [Redundant COUNT Query in `findOneForUser`](#3-redundant-count-query-in-findoneforuser)
4. [Unsafe Sort Column Mapping in `findOneForUser`](#4-unsafe-sort-column-mapping-in-findoneforuser)
5. [No Transaction in `remove` Method](#5-no-transaction-in-remove-method)
6. [No TMDB Response Caching](#6-no-tmdb-response-caching)
7. [`vote_average` Precision Too Small](#7-vote_average-precision-too-small)
8. [Missing Foreign Key Constraint at DB Level](#8-missing-foreign-key-constraint-at-db-level)
9. [Missing Unique Constraint on `(userId, slug)`](#9-missing-unique-constraint-on-userid-slug)
10. [`ListSummaryDto` Defined but Never Used](#10-listsummarydto-defined-but-never-used)
11. [No Protection Against Reserved Slug Collision](#11-no-protection-against-reserved-slug-collision)
12. [TMDB Error Swallows Original Context](#12-tmdb-error-swallows-original-context)
13. [Sequential System List Creation](#13-sequential-system-list-creation)
14. [`addItem` Doesn't Validate TMDB Response Fields](#14-additem-doesnt-validate-tmdb-response-fields)
15. [Missing `@Index` on `UserListItem.listId` for Deletion Lookups](#15-missing-index-on-userlistitemid-for-deletion-lookups)

---

## 1. N+1 Query in `ensureSystemLists`

**File:** `src/modules/lists/lists.service.ts:68-84`
**Severity:** Performance (Medium)
**Category:** Database

### Problem

`ensureSystemLists` runs **3 sequential `findOne` queries** (one per system list) inside a `for` loop. For a new user this means 3 separate DB round-trips when a single query could fetch all existing system lists at once.

```ts
// Current: 3 queries
for (const sys of ListsService.SYSTEM_LISTS) {
  const existing = await this.listRepo.findOne({
    where: { userId, listKey: sys.listKey },
  });
  // ...
}
```

### Solution

Fetch all existing system lists in **one query** using `findBy` with `In()` operator, then iterate only the missing ones to insert:

```ts
async ensureSystemLists(userId: number): Promise<UserList[]> {
  const systemKeys = ListsService.SYSTEM_LISTS.map((s) => s.listKey);

  const existing = await this.listRepo.findBy({
    userId,
    listKey: In(systemKeys),
  });

  const existingMap = new Map(existing.map((l) => [l.listKey, l]));
  const toCreate: UserList[] = [];

  for (const sys of ListsService.SYSTEM_LISTS) {
    if (existingMap.has(sys.listKey)) continue;

    toCreate.push(
      this.listRepo.create({
        userId,
        name: sys.name,
        slug: sys.slug,
        listKey: sys.listKey,
        isSystem: true,
      }),
    );
  }

  if (toCreate.length > 0) {
    await this.listRepo.save(toCreate);
  }

  return ListsService.SYSTEM_LISTS.map(
    (sys) => existingMap.get(sys.listKey) ?? toCreate.find((c) => c.listKey === sys.listKey)!,
  );
}
```

---

## 2. Race Condition on Slug Uniqueness (TOCTOU)

**File:** `src/modules/lists/lists.service.ts:53-66`
**Severity:** Logic (High)
**Category:** Concurrency

### Problem

`create` and `update` both check slug uniqueness with `findOne`, then insert/update. Between the check and the write, **another request can insert the same slug**, causing a DB unique constraint violation (if one exists) or a silent duplicate.

```ts
// TOCTOU: check → another request inserts → write
const existing = await this.listRepo.findOne({ where: { userId, slug } });
if (existing) throw new ConflictException(...);
// ← race window here
const list = this.listRepo.create({ ... });
```

### Solution

Rely on a **database unique index** on `(userId, slug)` and catch the DB error:

1. Add a unique index: `@Index('uq_user_lists_slug', ['userId', 'slug'], { unique: true })` on `UserList`.
2. In `create`/`update`, wrap the save in a try/catch and translate the constraint violation into `ConflictException`.

```ts
async create(userId: number, dto: CreateListDto): Promise<ListResponseDto> {
  const slug = dto.slug
    ? dto.slug
    : await generateUniqueListSlug(dto.name, this.listRepo, { excludeId: undefined });

  const list = this.listRepo.create({
    userId,
    name: dto.name,
    slug,
    listKey: `custom:${crypto.randomUUID()}`,
    isSystem: false,
  });

  try {
    const saved = await this.listRepo.save(list);
    return this.toListResponse(saved, 0);
  } catch (err) {
    if (err instanceof QueryFailedError && err.driverError?.code === '23505') {
      throw new ConflictException('A list with this slug already exists');
    }
    throw err;
  }
}
```

---

## 3. Redundant COUNT Query in `findOneForUser`

**File:** `src/modules/lists/lists.service.ts:121-123`
**Severity:** Performance (Low)
**Category:** Database

### Problem

`findOneForUser` calls `paginate()` (which internally calls `findAndCount`) and then **immediately calls `this.itemRepo.count(...)` again** to get the same total. This is an unnecessary extra DB query per request.

```ts
const items = await paginate<UserListItem>(this.itemRepo, ...); // already returns total
const totalItems = await this.itemRepo.count({ where: { listId: list.id } }); // duplicate!
```

### Solution

Use the `total` already returned by `paginate`:

```ts
const items = await paginate<UserListItem>(this.itemRepo, filters.page, filters.perPage, {
  where: itemWhere,
  order: { ... },
});

return {
  list: this.toListResponse(list, items.total), // reuse items.total
  items: {
    ...items,
    data: items.data.map((i) => this.toListItemResponse(i)),
  },
};
```

---

## 4. Unsafe Sort Column Mapping in `findOneForUser`

**File:** `src/modules/lists/lists.service.ts:105-118`
**Severity:** Logic (Medium)
**Category:** Code Quality

### Problem

The sort column mapping uses a deeply nested ternary chain and relies on a **non-null assertion** (`filters.sortBy!`) which is fragile. If `sortBy` somehow becomes `undefined` at runtime (e.g. due to class-transformer behavior), the order key becomes `undefined`, causing a runtime error.

```ts
const sortColumn =
  filters.sortBy === 'title' ? 'item.title'
    : filters.sortBy === 'releaseDate' ? 'item.release_date'
      : filters.sortBy === 'voteAverage' ? 'item.vote_average'
        : 'item.added_at';

order: {
  [sortColumn === 'item.added_at' ? 'addedAt' : filters.sortBy!]: filters.order,
},
```

### Solution

Use a clean mapping object:

```ts
private static readonly SORT_FIELD_MAP: Record<string, keyof UserListItem> = {
  addedAt: 'addedAt',
  title: 'title',
  releaseDate: 'releaseDate',
  voteAverage: 'voteAverage',
};

// In findOneForUser:
const sortField = ListsService.SORT_FIELD_MAP[filters.sortBy ?? 'addedAt'] ?? 'addedAt';

const items = await paginate<UserListItem>(this.itemRepo, filters.page, filters.perPage, {
  where: itemWhere,
  order: { [sortField]: filters.order },
});
```

---

## 5. No Transaction in `remove` Method

**File:** `src/modules/lists/lists.service.ts:199-211`
**Severity:** Logic (Medium)
**Category:** Data Integrity

### Problem

`remove` deletes items **then** the list, but if the list removal fails after items are deleted, the list remains with no items — or worse, if the process crashes between the two operations, the items are permanently lost.

```ts
await this.itemRepo.delete({ listId: list.id }); // items gone
await this.listRepo.remove(list);                // if this fails, orphan state
```

### Solution

Wrap both operations in a **transaction**:

```ts
async remove(userId: number, listId: string): Promise<void> {
  const list = await this.listRepo.findOne({ where: { id: listId, userId } });
  if (!list) throw new NotFoundException('List not found');
  if (list.isSystem) throw new ForbiddenException('Cannot delete system lists');

  await this.listRepo.manager.transaction(async (manager) => {
    await manager.delete(UserListItem, { listId: list.id });
    await manager.remove(list);
  });
}
```

---

## 6. No TMDB Response Caching

**File:** `src/modules/lists/tmdb/tmdb.service.ts`
**Severity:** Performance (Medium)
**Category:** External API / Caching

### Problem

Every `addItem` call hits the TMDB API even if the **same media was already fetched** for another list. This wastes API quota and adds unnecessary latency.

### Solution

Add a **short-lived in-memory cache** (or use the project's `cache-manager`) keyed by `(mediaType, tmdbId)`:

```ts
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

@Injectable()
export class TmdbService {
  private static readonly CACHE_TTL = 60_000; // 60 seconds

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) { ... }

  async getMedia(mediaType: MediaType, tmdbId: number): Promise<TmdbSnapshot> {
    const cacheKey = `tmdb:${mediaType}:${tmdbId}`;
    const cached = await this.cache.get<TmdbSnapshot>(cacheKey);
    if (cached) return cached;

    // ... fetch from TMDB ...

    await this.cache.set(cacheKey, snapshot, TmdbService.CACHE_TTL);
    return snapshot;
  }
}
```

---

## 7. `vote_average` Precision Too Small

**File:** `src/modules/lists/schema/user-list-item.entity.ts:37-42`
**Severity:** Data (Medium)
**Category:** Schema Design

### Problem

The column is defined as `numeric(3, 1)` which supports values from **-9.9 to 9.9**. TMDB vote averages can be **10.0**, which will cause a DB truncation error or silent data loss.

```ts
@Column({
  name: 'vote_average',
  type: 'numeric',
  precision: 3,  // max 9.9
  scale: 1,
  nullable: true,
})
```

### Solution

Increase precision to `numeric(4, 1)` to support values up to 10.0:

```ts
@Column({
  name: 'vote_average',
  type: 'numeric',
  precision: 4,  // max 99.9 (covers 10.0)
  scale: 1,
  nullable: true,
})
```

This requires a **TypeORM migration** to alter the column.

---

## 8. Missing Foreign Key Constraint at DB Level

**File:** `src/modules/lists/schema/user-list-item.entity.ts`
**Severity:** Data Integrity (High)
**Category:** Schema Design

### Problem

`UserListItem.listId` is a UUID column referencing `UserList.id`, but there is **no `@ManyToOne` / `@JoinColumn`** decorator and no DB-level foreign key. This means:
- Orphaned items can exist if a list is deleted outside the app (e.g. direct SQL).
- TypeORM won't enforce referential integrity.

### Solution

Add a proper relation on the entity:

```ts
@ManyToOne(() => UserList, (list) => list.items, {
  onDelete: 'CASCADE',
})
@JoinColumn({ name: 'list_id' })
list: UserList;
```

And on `UserList`:

```ts
@OneToMany(() => UserListItem, (item) => item.list)
items: UserListItem[];
```

Alternatively, if you don't want ORM-level relations, add the foreign key directly in a migration:

```sql
ALTER TABLE user_list_items
  ADD CONSTRAINT fk_user_list_items_list
  FOREIGN KEY (list_id) REFERENCES user_lists(id) ON DELETE CASCADE;
```

---

## 9. Missing Unique Constraint on `(userId, slug)`

**File:** `src/modules/lists/schema/user-list.entity.ts`
**Severity:** Logic (High)
**Category:** Schema Design

### Problem

There is no unique index on `(userId, slug)`. The app checks slug uniqueness in application code (which has a TOCTOU issue — see #2), but the database allows duplicates. Two users can have the same slug (fine), but the **same user** cannot have duplicate slugs.

### Solution

Add a unique index:

```ts
@Entity('user_lists')
@Index('uq_user_lists_user_key', ['userId', 'listKey'], { unique: true })
@Index('uq_user_lists_user_slug', ['userId', 'slug'], { unique: true })  // ADD THIS
@Index('ix_user_lists_user_recent', ['userId', 'createdAt'])
export class UserList { ... }
```

Generate a migration for this change.

---

## 10. `ListSummaryDto` Defined but Never Used

**File:** `src/modules/lists/dto/list-summary.dto.ts`
**Severity:** Code Quality (Low)
**Category:** Dead Code

### Problem

`ListSummaryDto` extends `ListResponseDto` with a `recentItems` field, but **no controller endpoint or service method** uses it. It's dead code.

### Solution

Either:
- **Remove it** if it's not planned for use, or
- **Use it** in a future endpoint (e.g. a dashboard/summary endpoint) and document its purpose.

---

## 11. No Protection Against Reserved Slug Collision

**File:** `src/modules/lists/lists.service.ts:49-66`
**Severity:** Logic (Medium)
**Category:** Business Logic

### Problem

A user can create a custom list with slug `favorites`, `watchlist`, or `watched` — the same slugs used by system lists. This can cause confusion in routing and the `findOneForUser` query could potentially return a custom list when a system list was expected (depending on query ordering).

### Solution

Add a reserved slug check in `create` and `update`:

```ts
private static readonly RESERVED_SLUGS = ListsService.SYSTEM_LISTS.map((s) => s.slug);

async create(userId: number, dto: CreateListDto): Promise<ListResponseDto> {
  const slug = dto.slug
    ? dto.slug
    : await generateUniqueListSlug(dto.name, this.listRepo, { excludeId: undefined });

  if (ListsService.RESERVED_SLUGS.includes(slug)) {
    throw new ConflictException('This slug is reserved for system lists');
  }
  // ...
}
```

---

## 12. TMDB Error Swallows Original Context

**File:** `src/modules/lists/tmdb/tmdb.service.ts:46-52`
**Severity:** Observability (Low)
**Category:** Error Handling

### Problem

The `catch` block logs the error but throws a generic `ServiceUnavailableException` that **loses the original error message**, making debugging harder in production.

```ts
} catch (error) {
  this.logger.error(`TMDB fetch failed: ${endpoint}/${tmdbId}`, ...);
  throw new ServiceUnavailableException('Failed to fetch media from TMDB');
  // ^ original message lost
}
```

### Solution

Include the original error message in the exception:

```ts
throw new ServiceUnavailableException(
  `Failed to fetch media from TMDB: ${error instanceof Error ? error.message : String(error)}`,
);
```

---

## 13. Sequential System List Creation

**File:** `src/modules/lists/lists.service.ts:74-84`
**Severity:** Performance (Low)
**Category:** Database

### Problem

When creating missing system lists, each is inserted with a **separate `save` call** in the loop. For a new user, this is 3 sequential INSERT statements.

### Solution

Batch the inserts using `save` with an array (TypeORM supports this):

```ts
const toCreate = ListsService.SYSTEM_LISTS
  .filter((sys) => !existingMap.has(sys.listKey))
  .map((sys) =>
    this.listRepo.create({
      userId,
      name: sys.name,
      slug: sys.slug,
      listKey: sys.listKey,
      isSystem: true,
    }),
  );

if (toCreate.length > 0) {
  await this.listRepo.save(toCreate); // single INSERT batch
}
```

---

## 14. `addItem` Doesn't Validate TMDB Response Fields

**File:** `src/modules/lists/lists.service.ts:138-152`
**Severity:** Logic (Low)
**Category:** Input Validation

### Problem

`addItem` blindly trusts the TMDB response. If TMDB returns a different media type's data or an empty/null title, the item is saved with invalid data. There's no validation that the fetched media **matches the requested `mediaType` and `tmdbId`**.

### Solution

Add a validation check after the TMDB fetch:

```ts
const snapshot = await this.tmdbService.getMedia(dto.mediaType, dto.tmdbId);

if (!snapshot.title) {
  throw new BadRequestException('Media not found or has no title');
}

const item = this.itemRepo.create({ ... });
```

---

## 15. Missing `@Index` on `UserListItem.listId` for Deletion Lookups

**File:** `src/modules/lists/schema/user-list-item.entity.ts`
**Severity:** Performance (Low)
**Category:** Database

### Problem

`UserListItem` has a composite index `uq_list_item` on `['listId', 'mediaType', 'tmdbId']`, but the `remove` method deletes by `{ listId, mediaType, tmdbId }` which uses this index. However, the `itemRepo.delete({ listId: list.id })` in `remove()` and the count query in `findOneForUser` only filter by `listId` **without the other columns**, which doesn't efficiently use the composite index.

### Solution

Add a standalone index on `listId`:

```ts
@Index('ix_list_items_list_id', ['listId'])
```

Or ensure the existing composite index covers single-column lookups (PostgreSQL B-tree indexes do support leftmost prefix, so this may already be fine — verify with `EXPLAIN`).

---

## Summary

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| 1 | N+1 query in `ensureSystemLists` | Medium | Performance |
| 2 | TOCTOU race on slug uniqueness | High | Concurrency |
| 3 | Redundant COUNT in `findOneForUser` | Low | Performance |
| 4 | Unsafe sort column mapping | Medium | Code Quality |
| 5 | No transaction in `remove` | Medium | Data Integrity |
| 6 | No TMDB response caching | Medium | Performance |
| 7 | `vote_average` precision too small | Medium | Schema |
| 8 | Missing FK constraint at DB level | High | Data Integrity |
| 9 | Missing unique constraint on `(userId, slug)` | High | Schema |
| 10 | `ListSummaryDto` dead code | Low | Code Quality |
| 11 | No reserved slug protection | Medium | Business Logic |
| 12 | TMDB error swallows context | Low | Observability |
| 13 | Sequential system list creation | Low | Performance |
| 14 | No TMDB response validation | Low | Input Validation |
| 15 | Missing standalone index on `listId` | Low | Performance |

**High:** 3 | **Medium:** 6 | **Low:** 6
