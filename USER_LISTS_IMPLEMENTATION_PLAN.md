# User Lists System — Implementation Plan

> Phased implementation with milestones. Based on `USER_LISTS_PLAN.md` (v3).
> Stack: NestJS 11 + TypeORM 0.3.x + PostgreSQL. No Redis, no event bus, no background jobs.

---

## Pre-Implementation Summary

**Key findings from codebase exploration:**
- `src/modules/` directory does **not exist** — must be created
- Current `user_lists` table is a junction-style table (user + movie + list_type) — will be **completely replaced**
- `@nestjs/axios` is installed but **not imported anywhere**
- `EventEmitterModule` is already initialized in `AppModule`
- Google OAuth is the **only active user creation path** (no email signup route)
- No TMDB service exists yet
- `paginate()` helper exists at `src/helpers/paginate.helper.ts`
- `database.config.ts` entities list needs updating

---

## Phase 1: Foundation (TMDB + Schema + Migration)

**Goal:** TMDB service works, migration runs, entities compile.

| # | Task | Files | Verify |
|---|------|-------|--------|
| 1.1 | Add TMDB env vars to validation | `src/config/env.validation.ts` | App boots with new envs |
| 1.2 | Create enums: `MediaType`, `SystemListKey` | `src/modules/lists/enums/media-type.enum.ts`, `list-key.enum.ts` | Lint clean |
| 1.3 | Create `TmdbService` + types + mapper | `src/modules/lists/tmdb/tmdb.service.ts`, `tmdb.types.ts`, `tmdb.mapper.ts` | Unit test the mapper |
| 1.4 | Create `UserList` entity | `src/modules/lists/schema/user-list.entity.ts` | Compiles |
| 1.5 | Create `UserListItem` entity | `src/modules/lists/schema/user-list-item.entity.ts` | Compiles |
| 1.6 | Create migration (drop old + create new + seed) | `db/migrations/<ts>-ReplaceUserListsWithNewSchema.ts` | Migration runs, system lists seeded |
| 1.7 | Register entities in `database.config.ts` | `src/config/database.config.ts` | CLI can see entities |

**Milestone 1 gate:** Migration runs cleanly on dev DB. TMDB service can fetch a movie by ID.

---

## Phase 2: Module Skeleton + DTOs + Controller

**Goal:** Module wired, DTOs validate, controller endpoints exist (return stubs).

| # | Task | Files | Verify |
|---|------|-------|--------|
| 2.1 | Create all DTOs (request + response) | `src/modules/lists/dto/*.ts` (8 files) | Lint clean |
| 2.2 | Create `slug.helper.ts` | `src/modules/lists/helpers/slug.helper.ts` | Unit test slug generation |
| 2.3 | Create `ListsModule` skeleton | `src/modules/lists/lists.module.ts` | Compiles |
| 2.4 | Register `ListsModule` in `AppModule` | `src/app.module.ts` | App boots with new module |
| 2.5 | Create `ListsController` with all 7 endpoints (stubs) | `src/modules/lists/lists.controller.ts` | Swagger shows endpoints |

**Milestone 2 gate:** App boots, `GET /api/docs` shows all 7 list endpoints.

---

## Phase 3: Core Business Logic (Service)

**Goal:** All service methods working with real DB.

| # | Task | Files | Verify |
|---|------|-------|--------|
| 3.1 | Create `ListsService` — `ensureSystemLists()` | `src/modules/lists/lists.service.ts` | Idempotent insert of 3 system lists |
| 3.2 | Service — `create(userId, dto)` | same | Custom list created with slug + `custom:<uuid>` key |
| 3.3 | Service — `findAllForUser(userId, filters)` | same | Paginated lists, system first |
| 3.4 | Service — `findOneForUser(userId, listId, filters)` | same | List + paginated items + total count |
| 3.5 | Service — `addItem(userId, listId, dto)` | same | TMDB fetch outside tx, idempotent insert |
| 3.6 | Service — `removeItem(userId, listId, mediaType, tmdbId)` | same | Hard delete, 404 if not found |
| 3.7 | Service — `update(userId, listId, dto)` | same | Rename, reject system lists |
| 3.8 | Service — `remove(userId, listId)` | same | Delete list, reject system lists, cascade |

**Milestone 3 gate:** All service methods work against a real DB. Manual testing via controller stubs confirms CRUD.

---

## Phase 4: Wire Controller + System Lists on Signup

**Goal:** Full HTTP flow working end-to-end.

| # | Task | Files | Verify |
|---|------|-------|--------|
| 4.1 | Wire `ListsController` to `ListsService` (replace stubs) | `src/modules/lists/lists.controller.ts` | All 7 endpoints return real data |
| 4.2 | Hook `ensureSystemLists` into Google OAuth creation path | `src/auth/auth.service.ts` | New Google user gets 3 system lists automatically |
| 4.3 | Hook `ensureSystemLists` into `UserService.create()` | `src/user/user.service.ts` | Programmatic user creation also gets system lists |

**Milestone 4 gate:** Full HTTP flow: signup via Google -> system lists created -> add item to list -> fetch list -> remove item -> rename list -> delete list.

---

## Phase 5: Tests + Documentation

**Goal:** Test coverage, Swagger docs, AGENTS.md updated.

| # | Task | Files | Verify |
|---|------|-------|--------|
| 5.1 | Unit tests: `TmdbService` mapper | `src/modules/lists/tmdb/tmdb.service.spec.ts` | Tests pass |
| 5.2 | Unit tests: `ListsService` (mocked repos + TmdbService) | `src/modules/lists/tests/lists.service.spec.ts` | Tests pass |
| 5.3 | E2E test: full flow (signup -> lists -> items -> delete) | `test/lists.e2e-spec.ts` | Tests pass |
| 5.4 | Swagger decorators on all controller endpoints | `src/modules/lists/lists.controller.ts` | `/api/docs` shows full contracts |
| 5.5 | Update `AGENTS.md` with new module structure | `AGENTS.md` | Documented |

**Milestone 5 gate:** `pnpm run test` passes, `pnpm run lint` clean, Swagger docs complete.

---

## Dependency Graph

```
Phase 1 --> Phase 2 --> Phase 3 --> Phase 4 --> Phase 5
(foundation)  (skeleton)  (logic)     (wiring)    (tests)
```

Each phase is independently shippable. Phase 3 depends on Phase 1 (entities + migration) and Phase 2 (DTOs + module). Phase 4 depends on Phase 3 (service). Phase 5 depends on Phase 4 (working endpoints).

---

## Files to Create / Modify

### New files (under `src/modules/lists/`)

```
src/modules/lists/
├── lists.module.ts
├── lists.controller.ts
├── lists.service.ts
├── tmdb/
│   ├── tmdb.service.ts
│   ├── tmdb.types.ts
│   └── tmdb.mapper.ts
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
│   ├── list-key.enum.ts
│   └── media-type.enum.ts
├── helpers/
│   └── slug.helper.ts
└── tests/
    └── lists.service.spec.ts
```

### New migration

- `db/migrations/<ts>-ReplaceUserListsWithNewSchema.ts`

### Modified

- `src/config/env.validation.ts` — add TMDB env vars
- `src/config/database.config.ts` — register new entities
- `src/app.module.ts` — import `ListsModule`
- `src/auth/auth.service.ts` — hook `ensureSystemLists` on Google OAuth signup
- `src/user/user.service.ts` — hook `ensureSystemLists` on programmatic user creation
- `AGENTS.md` — document new module
