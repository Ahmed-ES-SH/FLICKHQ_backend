# User Module — Comprehensive Audit Report

> **Scope:** `src/user/` (controller, service, module, DTOs, entity)
> **Date:** 2026-06-06
> **Reviewer:** Antigravity AI
> **Deployment target:** Free hosting / serverless functions (cold-start-sensitive, stateless, ephemeral)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Security Issues](#security-issues)
3. [Performance Issues](#performance-issues)
4. [Rate Limiting & Abuse Prevention](#rate-limiting--abuse-prevention)
5. [Clean Code & Maintainability Issues](#clean-code--maintainability-issues)
6. [Serverless Compatibility Issues](#serverless-compatibility-issues)
7. [Reusability Issues](#reusability-issues)
8. [Issue Summary Table](#issue-summary-table)

---

## Executive Summary

The user module is structurally sound — it uses NestJS idioms correctly, has role-based access control, and applies `argon2` for password hashing. However, a **significant number of critical and high-severity issues** exist across security, performance, serverless readiness, and reusability dimensions. All issues are documented below with exact file references, severity ratings, and concrete recommended fixes.

**Severity scale:** 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low

---

## Security Issues

---

### [SEC-01] 🔴 `POST /user` Endpoint Has No Rate Limit — Registration Abuse & Account Enumeration

**File:** `src/user/user.controller.ts` — line 39–53
**File:** `src/user/user.service.ts` — line 24–35

**Problem:**
The public registration endpoint `POST /user` is decorated with `@Public()`, which means it completely bypasses the global `AuthGuard`. The global `ThrottlerGuard` applies a shared short/long throttle (5 req/s, 100 req/min), but **this is shared across all IPs and all endpoints**. An attacker can:

1. Enumerate existing emails by watching for `'User already exists'` vs success responses, harvesting valid emails at 4 req/s.
2. Flood the DB with fake accounts (100/min per IP, trivially circumvented with rotating proxies).
3. Trigger expensive argon2 hashing (CPU intensive) on every request, causing a CPU-exhaustion DoS.

**Recommended Fix:**
Apply a dedicated, tighter `@Throttle()` decorator specifically on this endpoint. Use the `skip` option on throttler to protect only the registration route more aggressively:

```typescript
// On the POST /user endpoint
@Throttle({ short: { limit: 3, ttl: 60000 }, long: { limit: 10, ttl: 3600000 } })
@Public()
@Post()
create(@Body() createUserDto: CreateUserDto): Promise<User> { ... }
```

Additionally, return a **generic error** on email duplicate to prevent enumeration:

```typescript
// user.service.ts — create()
// Instead of: 'User already exists'
throw new BadRequestException('Invalid registration data');
```

---

### [SEC-02] 🔴 `POST /user/verify-email` Is Publicly Accessible With No Rate Limit — Token Brute-Force

**File:** `src/user/user.controller.ts` — line 55–73
**File:** `src/user/user.service.ts` — line 145–166
**File:** `src/user/dto/verify-email.dto.ts` — line 4–9

**Problem:**
The email verification endpoint accepts a token via `@Public()` with no route-specific throttle. The DTO only validates `IsString()` and `MinLength(6)`, which means:

1. Tokens as short as 6 characters are accepted — **brute-forceable** with 36^6 ≈ 2.1 billion combinations, but very feasible with weak tokens.
2. There is no maximum length (`@MaxLength`) on the token, meaning arbitrarily long strings are accepted — possible **ReDoS or memory pressure** on the DB query layer.
3. A token returned on `NotFoundException` vs `BadRequestException` (expired) **reveals whether a token ever existed** — information leakage.

**Recommended Fix:**
```typescript
// verify-email.dto.ts
import { IsString, Length } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @Length(32, 128) // enforce both min and max
  @ApiProperty()
  token: string;
}
```

Throttle the endpoint aggressively:
```typescript
@Throttle({ short: { limit: 5, ttl: 60000 }, long: { limit: 15, ttl: 3600000 } })
@Public()
@Post('verify-email')
```

Normalize the error response to avoid leaking token existence:
```typescript
// Always throw the same error regardless of whether token was expired or not found
throw new BadRequestException('Invalid or expired verification token');
```

---

### [SEC-03] 🟠 `PATCH /user/:id` — Non-Admin Users Can Change Their Own Email Without Re-authentication

**File:** `src/user/user.service.ts` — line 114–117

**Problem:**
A logged-in user can silently change their own email address. The guard only checks "is this your account?", not "do you know your current password?". This means anyone with a stolen or hijacked session cookie can silently redirect email verification to a new address, fully taking over the account without the real owner's knowledge.

**Recommended Fix:**
Require `currentPassword` confirmation in the `UpdateUserDto` when `email` or `password` is being changed:

```typescript
// update-user.dto.ts
@IsString()
@IsOptional()
@ApiProperty({ description: 'Required when changing email or password' })
currentPassword?: string;
```

In the service, when `dto.email` or `dto.password` is present and `!isAdmin`:
```typescript
if ((dto.email || dto.password) && !isAdmin) {
  if (!dto.currentPassword) throw new BadRequestException('Current password is required');
  const isValid = await argon2.verify(user.password, dto.currentPassword);
  if (!isValid) throw new UnauthorizedException('Current password is incorrect');
}
```

> **Note:** This requires fetching `password` explicitly since the entity has `select: false` on the password column. Use a query builder or `addSelect('user.password')`.

---

### [SEC-04] 🟠 Password Is Returned in `create()` Response — Sensitive Data Exposure

**File:** `src/user/user.service.ts` — line 33–34
**File:** `src/user/schema/user.entity.ts` — line 20–22

**Problem:**
The `user.entity.ts` correctly marks the `password` column with `select: false` (line 21), which means TypeORM will **exclude it from `find*` queries**. However, `this.userRepo.create({...dto, password: hashedPassword})` constructs an **in-memory entity object** that still contains the `password` field. The `.save()` returns this same object — and the `password` is present on the returned object even though it was not fetched from DB.

This hashed password is then returned in the HTTP response (the `TransformInterceptor` likely serializes the full entity). A client who registers sees their hashed password in the API response.

**Recommended Fix:**
After saving, explicitly delete the password from the returned object before returning it from the service:

```typescript
// user.service.ts — create()
const savedUser = await this.userRepo.save(user);
delete savedUser.password;
return savedUser;
```

Alternatively, use `@Exclude()` from `class-transformer` on the `password` property and enable `ClassSerializerInterceptor` globally:

```typescript
// user.entity.ts
import { Exclude } from 'class-transformer';

@ApiHideProperty()
@Exclude()
@Column({ nullable: true, select: false })
password?: string;
```

---

### [SEC-05] 🟠 Internal Token Fields Are Exposed in API Responses

**File:** `src/user/schema/user.entity.ts` — lines 48–58

**Problem:**
`emailVerificationToken`, `emailVerificationTokenExpiry`, `passwordResetToken`, and `passwordResetTokenExpiry` are all plain columns with no serialization protection. Any endpoint returning a `User` object (e.g., `GET /user/:id`, `GET /user`, `PATCH /user/:id`) will include these sensitive internal token values in the JSON response.

An admin calling `GET /user` sees every user's raw password-reset tokens — trivially enabling account takeover of any user.

**Recommended Fix:**
Apply `@Exclude()` or `@ApiHideProperty()` **and** `@Exclude()` (class-transformer) on all internal token fields:

```typescript
// user.entity.ts
import { Exclude } from 'class-transformer';

@ApiHideProperty()
@Exclude()
@Column({ type: 'varchar', nullable: true })
emailVerificationToken?: string | null;

@ApiHideProperty()
@Exclude()
@Column({ type: 'timestamp', nullable: true })
emailVerificationTokenExpiry?: Date | null;

@ApiHideProperty()
@Exclude()
@Column({ type: 'varchar', nullable: true })
passwordResetToken?: string | null;

@ApiHideProperty()
@Exclude()
@Column({ type: 'timestamp', nullable: true })
passwordResetTokenExpiry?: Date | null;
```

Enable `ClassSerializerInterceptor` globally in `main.ts`:
```typescript
app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
```

---

### [SEC-06] 🟠 `stripeCustomerId` Is Exposed in All User Responses

**File:** `src/user/schema/user.entity.ts` — lines 60–61

**Problem:**
`stripeCustomerId` is a plain column returned in every user response. Stripe customer IDs are not secrets by themselves, but exposing them leaks payment-provider linkage information to all users who view profiles or to non-admin users viewing their own profile. This also violates the principle of minimal data exposure.

**Recommended Fix:**
Apply `@Exclude()` on the field and make it admin-only viewable via a separate endpoint or a response-shaping DTO:

```typescript
@ApiHideProperty()
@Exclude()
@Column({ type: 'varchar', nullable: true, name: 'stripe_customer_id' })
stripeCustomerId?: string | null;
```

---

### [SEC-07] 🟡 `avatar` Field Accepts Any String — SSRF / XSS Vector

**File:** `src/user/dto/create-user.dto.ts` — lines 21–24
**File:** `src/user/dto/update-user.dto.ts` — lines 24–27

**Problem:**
The `avatar` field is typed as `@IsString()` with no URL validation or length constraint. An attacker can:

1. Store a `javascript:alert(1)` URL or an arbitrary external URL as their avatar.
2. Cause SSRF if any backend service (e.g., image thumbnail processor) fetches the URL.
3. Inject a very long string (no `@MaxLength`) causing column overflow or memory pressure.

**Recommended Fix:**
```typescript
// Both create-user.dto.ts and update-user.dto.ts
import { IsUrl, MaxLength } from 'class-validator';

@IsUrl({ protocols: ['https'], require_tld: true })
@MaxLength(500)
@IsOptional()
@ApiProperty()
avatar?: string;
```

---

### [SEC-08] 🟡 `name` Field Has No Length Constraint or Sanitization

**File:** `src/user/dto/create-user.dto.ts` — lines 16–19
**File:** `src/user/dto/update-user.dto.ts` — lines 13–17

**Problem:**
The `name` field is `@IsString()` only. No minimum, no maximum length. A user can register with a 100,000-character name, causing database column overflow (the column has no `length` constraint in the entity) or memory pressure during serialization. The entity column `name` also has `unique: true`, meaning a partial index is built on it — large values stress the index.

**Recommended Fix:**
```typescript
// create-user.dto.ts and update-user.dto.ts
@IsString()
@MinLength(2)
@MaxLength(100)
@Matches(/^[a-zA-Z0-9 '_-]+$/, { message: 'Name contains invalid characters' })
@IsOptional()
@ApiProperty()
name?: string;
```

Add a length constraint to the entity column:
```typescript
@Column({ nullable: true, unique: true, length: 100 })
name?: string;
```

---

### [SEC-09] 🟡 `GET /user/stats` — Missing `@ApiBearerAuth()` On Auth Guard Application

**File:** `src/user/user.controller.ts` — lines 98–117

**Problem:**
The `stats()` endpoint has `@ApiBearerAuth()` at the top but the `@UseGuards(RolesGuard)` is applied **without** the global `AuthGuard` being explicitly invoked first via the guard chain. This is actually fine at runtime (global `AuthGuard` runs first), but the Swagger documentation is misleading because the endpoint technically relies on both guards being active. If `RolesGuard` ever moves to a standalone context (e.g., different app), it will not enforce authentication — only role checking after an already-present `user` object.

**Recommended Fix:**
Apply both guards explicitly:
```typescript
@UseGuards(AuthGuard, RolesGuard)
```
This makes the dependency explicit, the module self-documenting, and safe when reused.

---

## Performance Issues

---

### [PERF-01] 🟠 `stats()` Runs 3 Separate DB Queries That Can Be Replaced With 1

**File:** `src/user/user.service.ts` — lines 37–54

**Problem:**
The `stats()` method executes three `COUNT` queries in parallel via `Promise.all`. While parallelism helps, three separate DB round-trips are still made — each consuming a connection pool slot. On serverless/free-tier platforms with limited connection pools (PgBouncer or direct Postgres), each cold-start can open new connections. Three queries instead of one is 3× the connection and query overhead.

**Recommended Fix:**
Use a single query builder with conditional aggregation:

```typescript
async stats() {
  const result = await this.userRepo
    .createQueryBuilder('u')
    .select('COUNT(*) FILTER (WHERE u.role = :admin)', 'adminsNumber')
    .addSelect('COUNT(*) FILTER (WHERE u."isEmailVerified" = true)', 'verifiedUsersNumber')
    .addSelect('COUNT(*) FILTER (WHERE u."isEmailVerified" = false)', 'unverifiedUsersNumber')
    .setParameter('admin', UserRoleEnum.ADMIN)
    .getRawOne<{ adminsNumber: string; verifiedUsersNumber: string; unverifiedUsersNumber: string }>();

  return {
    adminsNumber: parseInt(result.adminsNumber, 10),
    verifiedUsersNumber: parseInt(result.verifiedUsersNumber, 10),
    unverifiedUsersNumber: parseInt(result.unverifiedUsersNumber, 10),
  };
}
```

This is **1 DB round-trip** instead of 3.

---

### [PERF-02] 🟠 `findAll()` Uses `ILike` on Unindexed `name` and `email` Columns — Full Table Scans

**File:** `src/user/user.service.ts` — lines 56–75

**Problem:**
When `search` is provided, the service builds a `WHERE name ILIKE '%term%' OR email ILIKE '%term%'` query. The `ILIKE '%...%'` pattern with a **leading wildcard** cannot use a B-tree index — it forces a **full sequential scan** of the users table on every search request. As the users table grows, this degrades linearly.

**Recommended Fix (short-term):**
Add a PostgreSQL `GIN` index using `pg_trgm` extension, which supports leading-wildcard `ILIKE` via trigram matching. Add this in a migration:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_users_name_trgm ON users USING gin (name gin_trgm_ops);
CREATE INDEX idx_users_email_trgm ON users USING gin (email gin_trgm_ops);
```

**Recommended Fix (long-term):**
Use full-text search (`tsvector`) or a dedicated search index (e.g., Meilisearch, Typesense on free tier) for large datasets.

---

### [PERF-03] 🟠 `argon2.hash()` Is CPU-Intensive — Blocks Serverless Function Thread

**File:** `src/user/user.service.ts` — lines 31, 118

**Problem:**
`argon2.hash()` is intentionally CPU-intensive. In a serverless environment (Vercel Edge, AWS Lambda, Render free tier), each function invocation has a very limited CPU budget and execution time limit (often 10–30 seconds). Argon2's default memory cost (`64 MB`) and time cost can cause:

1. **Cold-start timeouts** — the function may be killed before hashing completes.
2. **Concurrent DoS** — two simultaneous registration requests on a single-core free-tier instance can cause the event loop to block, affecting all other requests.

**Recommended Fix:**
Use reduced argon2 parameters tuned for serverless environments, and add an explicit try/catch to handle hashing failures gracefully:

```typescript
const hashedPassword = await argon2.hash(dto.password, {
  type: argon2.argon2id,
  memoryCost: 2 ** 14,    // 16 MB instead of default 64 MB
  timeCost: 2,            // 2 iterations instead of default 3
  parallelism: 1,
});
```

> **Note:** These are still above OWASP minimum recommendations for Argon2id at `memoryCost: 2^14, timeCost: 2`. If further reduction is needed, consider switching to bcrypt with cost factor 12 which is more broadly supported in serverless runtimes.

---

### [PERF-04] 🟡 `findOne()` and `update()` Both Do Separate DB Lookups That Could Be Combined

**File:** `src/user/user.service.ts` — lines 77–91 and 94–127

**Problem:**
`update()` first calls `this.userRepo.findOne()` (line 99) to fetch the user, then calls `this.userRepo.save(user)` (line 126), which internally does another `SELECT` before the `UPDATE`. This results in **2 DB queries minimum** (find + update) when `save()` is used on an existing entity. For serverless with tight connection pools, each unnecessary round-trip is expensive.

**Recommended Fix:**
Use `this.userRepo.update({ id }, partialData)` for simple field updates, or use query builder with `UPDATE ... WHERE id = :id` and `RETURNING *` to do it in a single round-trip. Only fallback to `findOne + save` when complex logic (argon2 hashing) requires loading the full entity first.

---

### [PERF-05] 🟡 `paginate()` Helper Has No Upper-Bound Guard on `limit`

**File:** `src/helpers/paginate.helper.ts` — lines 13–32
**File:** `src/common/dto/pagination.dto.ts` — lines 14–16

**Problem:**
`PaginationDto` has `@Max(100)` on `limit`, which is good. However, the `paginate()` function itself has `limit = 10` as default but does **not** enforce a maximum if called programmatically without going through the DTO validation. Any internal call to `paginate(repo, page, 10000)` would execute a query fetching 10,000 rows with no protection. This is a defense-in-depth gap.

**Recommended Fix:**
Add a hard cap inside the `paginate()` helper itself:

```typescript
export async function paginate<T extends ObjectLiteral>(
  repo: Repository<T>,
  page = 1,
  limit = 10,
  options: FindManyOptions<T> = {},
): Promise<PaginatedResult<T>> {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(Math.max(1, limit), 100); // hard cap at 100
  // ...
}
```

---

### [PERF-06] 🟡 `GET /user/stats` Has No Caching — Expensive Aggregate Runs on Every Request

**File:** `src/user/user.controller.ts` — lines 99–117
**File:** `src/user/user.service.ts` — lines 37–54

**Problem:**
The stats endpoint runs aggregate DB queries on every single request. Admin dashboards typically poll this frequently. On a free-tier DB with limited connections and IOPS, frequent aggregate scans degrade overall app performance.

**Recommended Fix:**
Use `@nestjs/cache-manager` (already in the project) with `CacheInterceptor` or manual caching:

```typescript
// In user.service.ts, inject CacheManager
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

constructor(
  @InjectRepository(User) private readonly userRepo: Repository<User>,
  @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
) {}

async stats() {
  const cached = await this.cacheManager.get('user:stats');
  if (cached) return cached;

  const result = /* ... single query ... */;
  await this.cacheManager.set('user:stats', result, 300); // 5-minute TTL
  return result;
}
```

---

## Rate Limiting & Abuse Prevention

---

### [RATE-01] 🔴 Public Registration Endpoint Has No Dedicated Rate Limit

*(See also SEC-01)*

**File:** `src/user/user.controller.ts` — line 39–53

The global throttler applies `5 req/s / 100 req/min` across ALL endpoints and ALL IPs. This means a single IP can create 100 accounts per minute, and the shared throttle budget is consumed by normal traffic too. A dedicated, much stricter limit is needed on the registration endpoint.

**Recommended Fix:**
```typescript
@Throttle({ short: { limit: 2, ttl: 60000 }, long: { limit: 5, ttl: 3600000 } })
// 2 registrations per minute, 5 per hour per IP
```

---

### [RATE-02] 🔴 Public Email Verification Endpoint Has No Dedicated Rate Limit

*(See also SEC-02)*

**File:** `src/user/user.controller.ts` — line 55–73

Same issue as RATE-01 — shared global throttle only. Token brute-forcing is possible at global throttle speed.

**Recommended Fix:**
```typescript
@Throttle({ short: { limit: 5, ttl: 60000 }, long: { limit: 20, ttl: 3600000 } })
// 5 verification attempts per minute, 20 per hour per IP
```

---

### [RATE-03] 🟠 `PATCH /user/:id` — Password Change Has No Stricter Throttle

**File:** `src/user/user.controller.ts` — lines 146–170

Password change shares the global throttle with regular profile updates. An attacker who has a valid session can rapidly attempt password changes (e.g., testing if a known hash matches) or send large payloads to the argon2 hash path to exhaust CPU.

**Recommended Fix:**
Apply a stricter throttle specifically on the `update` endpoint. Additionally, detect when `dto.password` is present and log/alert on repeated password change attempts:

```typescript
@Throttle({ short: { limit: 5, ttl: 60000 }, long: { limit: 20, ttl: 3600000 } })
@Patch(':id')
update(...) { ... }
```

---

### [RATE-04] 🟠 In-Memory Throttler State Is Lost on Every Serverless Cold Start

**File:** `src/config/throttler.config.ts` — lines 18–37

**Problem:**
The throttler uses **in-memory storage** (the comment on line 7 acknowledges this). On serverless platforms, each function invocation may run in a fresh container with no shared state. This means:

1. Rate limits reset on every cold start.
2. Two concurrent cold-started instances have independent throttle counters.
3. An attacker can simply trigger new cold starts (by spreading requests across time) to bypass rate limiting entirely.

**Recommended Fix:**
Use a Redis-backed throttler store. The project does not currently use Redis, but for serverless deployments, use Upstash Redis (free tier) with the `@nestjs-throttler-storage-redis` adapter:

```typescript
// throttler.config.ts
ThrottlerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    throttlers: throttlerConfig.throttlers,
    storage: new ThrottlerStorageRedisService(
      new Redis(config.getOrThrow('REDIS_URL'))
    ),
  }),
});
```

> For a fully serverless deployment with **no Redis budget**, consider using Cloudflare KV or Vercel's Edge Config as the throttle store, or accepting that per-instance throttling is a known limitation of the free tier.

---

## Clean Code & Maintainability Issues

---

### [CODE-01] 🟠 `update()` Service Method Has Mixed Responsibility — Authorization + Business Logic

**File:** `src/user/user.service.ts` — lines 94–127

**Problem:**
The `update()` service method handles:
1. Fetching the user from DB
2. Authorization check (is this user allowed to update?)
3. Field-by-field mutation
4. Password hashing
5. Persisting the entity

This violates the **Single Responsibility Principle**. The authorization logic (lines 103–110) belongs in the controller layer or a dedicated guard, not in the service. Services should focus on business logic; authorization should be a cross-cutting concern.

**Recommended Fix:**
Move the ownership check to a `UserOwnershipGuard` or handle it at the controller level, leaving the service focused on data operations:

```typescript
// user.controller.ts
@Patch(':id')
async update(
  @Param('id', ParseIntPipe) id: number,
  @Body() updateUserDto: UpdateUserDto,
  @GetUser() currentUser: User,
): Promise<User> {
  if (currentUser.role !== UserRoleEnum.ADMIN && currentUser.id !== id) {
    throw new ForbiddenException('You can only update your own profile');
  }
  return this.userService.update(id, updateUserDto, currentUser);
}
```

---

### [CODE-02] 🟡 `findById()` Is a Redundant Alias for `findOne()`

**File:** `src/user/user.service.ts` — lines 137–139

**Problem:**
`findById(id)` is a one-line wrapper that just calls `findOne(id)`. This exists presumably for internal use by other modules, but it adds confusion because `findOne()` has an optional `currentUser` parameter for authorization, while `findById()` skips that. Two methods with similar names but different authorization semantics is a maintenance trap.

**Recommended Fix:**
Remove `findById()` and have callers use `findOne(id)` (with no `currentUser` for internal lookups — the authorization branch is skipped when `currentUser` is undefined). If distinct semantics are needed, name them unambiguously:

```typescript
// Rename for clarity
async findOneById(id: number): Promise<User>          // internal, no authz check
async findOneForUser(id: number, requestingUser: User) // for controller, with authz
```

---

### [CODE-03] 🟡 `isExists` Variable Name Is Non-Standard English

**File:** `src/user/user.service.ts` — line 25

**Problem:**
`const isExists` is grammatically incorrect. The conventional pattern is `const exists` or `const existingUser`.

**Recommended Fix:**
```typescript
const existingUser = await this.userRepo.findOne({ where: { email: dto.email } });
if (existingUser) throw new BadRequestException('Invalid registration data');
```

---

### [CODE-04] 🟡 No Response DTO / Serialization Shape — Entity Returned Directly

**File:** `src/user/user.controller.ts` — multiple endpoints

**Problem:**
All controller methods return the raw `User` entity directly. This tightly couples the API response shape to the database schema. Any column added to the entity is immediately exposed in the API. This makes it impossible to:

1. Evolve the DB schema independently of the API contract.
2. Add computed fields without polluting the entity.
3. Apply field-level visibility rules per role (e.g., admins see `stripeCustomerId`, regular users don't).

**Recommended Fix:**
Create dedicated response DTOs:

```typescript
// dto/user-response.dto.ts
export class UserResponseDto {
  id: number;
  email: string;
  name?: string;
  avatar?: string;
  role: UserRoleEnum;
  status: StatusEnum;
  isEmailVerified: boolean;
  isPremium: boolean;
  createdAt: Date;
  updatedAt: Date;
  // Sensitive fields EXCLUDED by default
}

// dto/admin-user-response.dto.ts
export class AdminUserResponseDto extends UserResponseDto {
  stripeCustomerId?: string; // Admin-only
}
```

Use `plainToInstance` to map entities to response DTOs in the service or via a `ClassSerializerInterceptor`.

---

### [CODE-05] 🟢 `stats()` Return Type Is Inlined — Should Be a Named Interface or DTO

**File:** `src/user/user.controller.ts` — lines 111–115
**File:** `src/user/user.service.ts` — lines 37–42

**Problem:**
The return type `Promise<{ adminsNumber: number; verifiedUsersNumber: number; unverifiedUsersNumber: number; }>` is duplicated verbatim in both the controller and service method signatures.

**Recommended Fix:**
Extract to a named interface or DTO:

```typescript
// dto/user-stats.dto.ts
export interface UserStatsDto {
  adminsNumber: number;
  verifiedUsersNumber: number;
  unverifiedUsersNumber: number;
}
```

---

### [CODE-06] 🟢 Swagger `@ApiResponse` Decorator Order on `GET /user` Is Inconsistent

**File:** `src/user/user.controller.ts` — lines 75–96

**Problem:**
`@UseGuards(RolesGuard)` is placed between `@ApiBearerAuth()` and `@Get()`, while on other endpoints the guard decorators are placed above or below `@ApiOperation`. The ordering of decorators is inconsistent across the controller. While NestJS evaluates decorators in a defined order (bottom-to-top for class decorators, evaluation differs for method decorators), inconsistency makes the code harder to read and audit.

**Recommended Fix:**
Establish a consistent decorator ordering convention:
```
@ApiBearerAuth()
@UseGuards(...)
@Roles(...)
@Get(...)         ← HTTP method decorator
@ApiOperation(...)
@ApiResponse(...)
```

---

## Serverless Compatibility Issues

---

### [SERV-01] 🔴 Global NestJS App Instance Is Recreated on Every Cold Start — DB Connections Not Pooled

**File:** `src/main.ts` — lines 12–95
**File:** `src/user/user.module.ts`

**Problem:**
On serverless platforms (Vercel, AWS Lambda, Render free tier with auto-spin-down), each cold start creates a **new NestJS application instance** with a **new TypeORM connection pool** connecting to PostgreSQL. Free-tier PostgreSQL (e.g., Supabase free, Neon free) typically allows only **5–10 concurrent connections**. With multiple cold-started function instances each opening their own pool of `min: 1, max: 10` connections, the database connection limit is rapidly exhausted.

**Recommended Fix:**

1. **Use Neon or PlanetScale** — these are serverless-native databases that support connection pooling natively (Neon uses pgbouncer built-in).
2. **Set pool size to 1** in `database.config.ts` for serverless deployments:
   ```typescript
   // database.config.ts
   extra: {
     max: 1,            // Only 1 connection per function instance
     idleTimeoutMillis: 10000,
     connectionTimeoutMillis: 3000,
   }
   ```
3. **Cache the NestJS app instance** across invocations using a module-level variable (standard serverless pattern):
   ```typescript
   // main.ts
   let cachedApp: INestApplication;

   export async function getApp(): Promise<INestApplication> {
     if (!cachedApp) {
       cachedApp = await NestFactory.create(AppModule, { ... });
       // setup...
       await cachedApp.init();
     }
     return cachedApp;
   }
   ```

---

### [SERV-02] 🟠 `argon2` Native Module May Not Be Available in All Serverless Runtimes

**File:** `src/user/user.service.ts` — line 12

**Problem:**
`argon2` is a native Node.js addon (uses C/C++ bindings). Some serverless runtimes (Vercel Edge Functions, Cloudflare Workers) **do not support native addons**. Even on AWS Lambda / Render, the binary must be compiled for the target OS/architecture. If the deployment environment differs from the build environment, `argon2` will fail to load.

**Recommended Fix:**
For broad serverless compatibility, consider `bcryptjs` (pure JavaScript, no native bindings) as a fallback with a compatibility flag, or use `@node-rs/argon2` which provides pre-compiled WASM bindings:

```bash
pnpm add @node-rs/argon2
```

```typescript
import { hash, verify } from '@node-rs/argon2';
```

---

### [SERV-03] 🟠 `ScheduleModule.forRoot()` in `app.module.ts` Spawns Cron Threads — Incompatible With Serverless

**File:** `src/app.module.ts` — line 64

**Problem:**
`@nestjs/schedule` uses Node.js `setInterval`/`cron` timers under the hood. On serverless, the function instance is destroyed after the request completes — all timers are lost. Scheduled tasks **will not run** on serverless deployments (the function isn't running between requests). This means any business logic relying on scheduled jobs (password token cleanup, etc.) **silently fails** without error.

**Recommended Fix:**
Either:
1. Use an external scheduler (Vercel Cron, Render Cron Jobs, GitHub Actions, Upstash QStash) that hits a dedicated HTTP endpoint.
2. Add a feature flag to disable scheduling in serverless mode:
   ```typescript
   ScheduleModule.forRoot({ cronJobs: process.env.ENABLE_CRON === 'true' }),
   ```
   Document this explicitly.

---

### [SERV-04] 🟡 In-Memory Token Blacklist Is Not Shared Across Serverless Instances

*(Related to RATE-04 and the `AuthGuard` blacklist check in `auth.service.ts`)*

**Problem:**
If `isTokenBlacklisted()` in `auth.service.ts` uses an in-memory store (array, Map, Set), it will not be shared between serverless instances. A user who logs out (token blacklisted in instance A) can still use their token on instance B. This is a **critical security bypass** in serverless deployments.

**Recommended Fix:**
Store the blacklist in a persistent, shared store (Redis via Upstash, or a dedicated DB table):
```typescript
// Use Redis SET with TTL equal to token expiry
await this.redis.set(`blacklist:${token}`, '1', 'EX', tokenExpirySeconds);
```

---

### [SERV-05] 🟡 `RequestLoggerMiddleware` Is Instantiated Twice — Memory Waste

**File:** `src/main.ts` — lines 65–67

```typescript
app.use(
  new RequestLoggerMiddleware().use.bind(new RequestLoggerMiddleware()),
);
```

Two instances of `RequestLoggerMiddleware` are created — the first is immediately discarded. On a normal server this is minor; on serverless where every allocation and garbage collection matters for cold-start time, this is wasteful.

**Recommended Fix:**
```typescript
const logger = new RequestLoggerMiddleware();
app.use(logger.use.bind(logger));
```

---

## Reusability Issues

---

### [REUSE-01] 🟠 Hard-Coded `src/` Absolute Imports Break Module Portability

**File:** `src/user/user.controller.ts` — lines 19–25
**File:** `src/user/dto/filter-options.dto.ts` — lines 2–4

**Problem:**
Multiple imports use the `src/` prefix (e.g., `import { Roles } from 'src/auth/decorators/Roles.decorator'`). These are TypeScript path aliases that depend on `tsconfig.json` path configuration. When copy-pasting this module into another project or publishing it as a package, these imports will break unless the exact same `tsconfig` paths are configured.

**Recommended Fix:**
Use relative imports within the module boundary:
```typescript
// Instead of: import { PaginatedResult } from 'src/helpers/paginate.helper'
import { PaginatedResult } from '../../helpers/paginate.helper';

// Instead of: import { Roles } from 'src/auth/decorators/Roles.decorator'
import { Roles } from '../auth/decorators/Roles.decorator';
```

Or, if path aliases are used, document them explicitly and provide a `tsconfig.json` snippet in the module's README.

---

### [REUSE-02] 🟠 `UserModule` Has Tight Coupling to `AuthModule` Internals

**File:** `src/user/user.controller.ts` — lines 19–25
**File:** `src/user/user.module.ts`

**Problem:**
The `UserController` directly imports decorators, guards, and enums from `src/auth/` (`Roles`, `RolesGuard`, `Public`, `GetUser`, `UserRoleEnum`). The `UserModule` does not declare `AuthModule` as an import — it relies on these being available globally. This makes the module:

1. **Not self-describing** — the dependency on `AuthModule` is invisible from `user.module.ts`.
2. **Not reusable** — anyone importing `UserModule` in another project must also configure the exact same auth infrastructure.

**Recommended Fix:**
The `UserModule` should explicitly import `AuthModule` (or a shared `AuthCoreModule`) to declare its dependencies:

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    AuthModule, // Explicit dependency declaration
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
```

Or better — extract all auth-related decorators and guards into a separate `SharedAuthModule` that both `AuthModule` and `UserModule` can import independently:

```
src/
  shared/
    auth/
      decorators/ (Roles, Public, GetUser)
      guards/     (RolesGuard, AuthGuard)
      types/      (UserRoleEnum, StatusEnum)
```

---

### [REUSE-03] 🟡 `FilterOptionsDto` and `PaginationDto` Are User-Specific But Live in Generic Paths

**File:** `src/common/dto/pagination.dto.ts`
**File:** `src/user/dto/filter-options.dto.ts`

**Problem:**
`PaginationDto` is shared across modules (good), but `FilterOptionsDto` imports from `src/auth/types/` directly, coupling it to the auth module. Any other module that wants similar filtering (e.g., products) must duplicate the pattern or also import from `src/auth/types/`.

**Recommended Fix:**
Move enums (`UserRoleEnum`, `StatusEnum`) to a shared location that doesn't imply auth ownership:
```
src/common/types/user-role.enum.ts
src/common/types/status.enum.ts
```

---

### [REUSE-04] 🟡 No Unit Tests for `UserService` — Cannot Verify Module Works in Isolation

**File:** `src/user/` (no `*.spec.ts` files present)

**Problem:**
There are no unit tests for `UserService` or `UserController`. This is a boilerplate project — if another developer copies this module, they have no tests to verify the module works correctly after integration. The lack of tests also makes it impossible to catch the security and logic bugs described in this report automatically.

**Recommended Fix:**
Add `user.service.spec.ts` with at minimum:
- `create()` — tests for duplicate email, password hashing, and response sanitization
- `verifyEmail()` — tests for invalid token, expired token, and successful verification
- `update()` — tests for authorization bypass prevention and admin-only field enforcement
- `findAll()` — tests for pagination and filter combinations

---

### [REUSE-05] 🟢 `UserModule` Does Not Export the `User` Entity — Other Modules Must Re-import It

**File:** `src/user/user.module.ts`

**Problem:**
`UserModule` exports only `UserService`. Modules that need to query the `users` table (e.g., `PaymentsModule`, `OrderModule`) must call `TypeOrmModule.forFeature([User])` again themselves. This leads to duplication of entity registration.

**Recommended Fix:**
Export the TypeORM repository feature:
```typescript
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService, TypeOrmModule], // Export TypeOrmModule so other modules get the repo
})
export class UserModule {}
```

---

## Issue Summary Table

| ID | Severity | Category | File(s) | Description |
|----|----------|----------|---------|-------------|
| SEC-01 | 🔴 Critical | Security / Rate Limiting | `user.controller.ts:39` | No dedicated throttle on `POST /user` — account spam & email enumeration |
| SEC-02 | 🔴 Critical | Security / Rate Limiting | `user.controller.ts:56`, `verify-email.dto.ts` | No throttle + weak token validation on `POST /user/verify-email` |
| RATE-04 | 🔴 Critical | Rate Limiting / Serverless | `throttler.config.ts` | In-memory throttler loses state on cold start — bypass-able on serverless |
| SERV-01 | 🔴 Critical | Serverless | `main.ts`, `user.module.ts` | New DB connection pool on every cold start — exhausts free-tier DB connections |
| SERV-04 | 🔴 Critical | Serverless / Security | `auth.guard.ts` | In-memory token blacklist not shared between serverless instances |
| SEC-03 | 🟠 High | Security | `user.service.ts:114` | Email change with no current-password re-authentication |
| SEC-04 | 🟠 High | Security | `user.service.ts:33`, `user.entity.ts:21` | Hashed password returned in `create()` response |
| SEC-05 | 🟠 High | Security | `user.entity.ts:48-58` | Email/password reset tokens exposed in all user responses |
| SEC-06 | 🟠 High | Security | `user.entity.ts:60` | `stripeCustomerId` exposed in all user responses |
| PERF-01 | 🟠 High | Performance | `user.service.ts:37` | 3 DB queries in `stats()` where 1 suffices |
| PERF-02 | 🟠 High | Performance | `user.service.ts:64` | `ILIKE '%...%'` causes full table scan — no trigram index |
| PERF-03 | 🟠 High | Performance / Serverless | `user.service.ts:31,118` | Argon2 default memory cost may exceed serverless CPU/memory budget |
| RATE-01 | 🔴 Critical | Rate Limiting | `user.controller.ts:39` | Registration endpoint can be spammed at 100 req/min |
| RATE-02 | 🔴 Critical | Rate Limiting | `user.controller.ts:55` | Verification endpoint can be brute-forced at 100 req/min |
| RATE-03 | 🟠 High | Rate Limiting | `user.controller.ts:146` | Password change endpoint has no stricter throttle |
| REUSE-01 | 🟠 High | Reusability | Multiple DTOs/Controller | `src/` absolute imports break module portability |
| REUSE-02 | 🟠 High | Reusability | `user.module.ts` | Implicit coupling to `AuthModule` — not declared in module imports |
| SERV-02 | 🟠 High | Serverless | `user.service.ts:12` | `argon2` native addon may fail in some serverless runtimes |
| SERV-03 | 🟠 High | Serverless | `app.module.ts:64` | `ScheduleModule` timers are incompatible with serverless execution model |
| CODE-01 | 🟠 High | Clean Code | `user.service.ts:103` | Authorization logic mixed into service — violates SRP |
| CODE-02 | 🟡 Medium | Clean Code | `user.service.ts:137` | `findById()` is a redundant alias for `findOne()` |
| CODE-03 | 🟡 Medium | Clean Code | `user.service.ts:25` | `isExists` is grammatically incorrect variable name |
| CODE-04 | 🟡 Medium | Clean Code | `user.controller.ts` | Raw entity returned — no response DTO shaping |
| PERF-04 | 🟡 Medium | Performance | `user.service.ts:99` | `findOne + save` causes 2+ DB queries in `update()` |
| PERF-05 | 🟡 Medium | Performance | `paginate.helper.ts` | No hard cap inside `paginate()` helper |
| PERF-06 | 🟡 Medium | Performance | `user.service.ts:37` | Stats aggregate has no caching |
| SEC-07 | 🟡 Medium | Security | `create-user.dto.ts:24`, `update-user.dto.ts:27` | `avatar` accepts any string — SSRF / XSS risk |
| SEC-08 | 🟡 Medium | Security | Both DTOs | `name` has no length constraint |
| SEC-09 | 🟡 Medium | Security | `user.controller.ts:98` | `stats()` guard chain not explicit — unsafe in reused context |
| REUSE-03 | 🟡 Medium | Reusability | `filter-options.dto.ts` | Enums imported from `auth/types` — wrong shared location |
| REUSE-04 | 🟡 Medium | Reusability | All user files | No unit tests — module can't be verified in isolation |
| SERV-05 | 🟡 Medium | Serverless | `main.ts:65` | Middleware instantiated twice — memory waste on cold start |
| CODE-05 | 🟢 Low | Clean Code | `user.controller.ts:111`, `user.service.ts:37` | Inline return type duplicated — extract to named DTO |
| CODE-06 | 🟢 Low | Clean Code | `user.controller.ts` | Inconsistent decorator ordering across endpoints |
| REUSE-05 | 🟢 Low | Reusability | `user.module.ts` | `TypeOrmModule` not exported — downstream modules must re-register entity |

---

*Report generated by Antigravity AI — 2026-06-06*
