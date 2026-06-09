# Auth Module — Comprehensive Analysis Report

> **Project:** NestJS Boilerplate Backend  
> **Scope:** `src/auth/` (all files) + related `src/user/`, `src/mail/`, `src/main.ts`  
> **Date:** 2026-06-06  
> **Deployment Target:** Free hosting with serverless functions (stateless, cold-start sensitive)  
> **Analyst:** Antigravity AI Agent  

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Serverless Deployment Considerations (Priority: Critical)](#serverless-deployment-considerations)
3. [Security Issues](#security-issues)
4. [Rate Limiting (Per-Endpoint Review)](#rate-limiting-per-endpoint-review)
5. [Performance Issues](#performance-issues)
6. [Clean Code Issues](#clean-code-issues)
7. [Feature Gap: Register Does Not Send Verification Email](#feature-gap-register-does-not-send-verification-email)
8. [Summary Table](#summary-table)

---

## Executive Summary

The `src/auth` module is generally well-structured and follows NestJS idioms. However, a full audit reveals **30 issues** across security, performance, rate limiting, and clean code categories. The most critical concern is the **serverless deployment environment**: several design choices that work fine on a persistent server become correctness or scalability problems on stateless, ephemeral functions. Additionally, **the register endpoint (`POST /user`) never sends a verification email after account creation**, leaving accounts permanently stuck as unverified until the user attempts login.

---

## Serverless Deployment Considerations

> These issues must be addressed before deploying to any serverless/free-tier host (e.g., Render, Railway, Vercel, Fly.io free tier). They will cause **incorrect behaviour or security bypasses** in that environment.

---

### [SERV-01] In-Memory Throttler Storage Breaks on Serverless

**File:** `src/config/throttler.config.ts`  
**Severity:** Critical  

**Problem:**  
The throttler is configured with **no storage adapter**, meaning it uses in-memory counters. On serverless platforms, each function invocation may run in a **fresh, isolated process** — all rate-limit state is lost between requests. An attacker can simply wait for a cold-start (or make a request to a different instance) and bypass all throttle limits entirely.

```typescript
// Current — in-memory, lost on every cold start
export const throttlerConfig: ThrottlerModuleOptions = {
  throttlers: [
    { name: 'short', ttl: 1000, limit: 5 },
    { name: 'long',  ttl: 60000, limit: 100 },
  ],
};
```

**Fix:**  
Use a Redis-backed throttler storage (`@nestjs-modules/throttler-storage-redis`). On free hosting you can use a free Redis tier (Upstash, Redis Cloud free tier). The storage adapter persists counters across invocations.

```typescript
// Fixed — persistent Redis storage
import { ThrottlerStorageRedisService } from '@nestjs-modules/throttler-storage-redis';

export const throttlerConfig: ThrottlerModuleOptions = {
  storage: new ThrottlerStorageRedisService(process.env.REDIS_URL),
  throttlers: [
    { name: 'short', ttl: 1000,  limit: 5 },
    { name: 'long',  ttl: 60000, limit: 100 },
  ],
};
```

---

### [SERV-02] Token Blacklist Is a Database Table — Checked on Every Request

**File:** `src/auth/guards/auth.guard.ts` · `src/auth/auth.service.ts`  
**Severity:** Critical  

**Problem:**  
Every authenticated request hits `isTokenBlacklisted(token)`, which runs a `SELECT` on the `black_list_tokens` table. On serverless with a free-tier PostgreSQL (e.g., Neon, Supabase free), you get:

- **Cold-start connection overhead** on every request that is not cached.
- **Increased DB connection count** — free tiers cap connections at 5–20.
- **Latency** added to every protected route.

There is also **no automatic cleanup** of expired tokens — the table grows without bound.

**Fix:**  
1. Use Redis for the blacklist with TTL equal to `JWT_EXPIRY_HOURS`. No cleanup needed.
2. If Redis is unavailable, at minimum add a WHERE clause to the blacklist query to filter only non-expired tokens, and add a cron to purge expired rows.

```typescript
// Guard — only check non-expired blacklisted tokens (interim fix)
const isBlacklisted = await this.blackListRepo.findOne({
  where: { token, expiresAt: MoreThan(new Date()) },
});
```

---

### [SERV-03] `NestFactory.create` Bootstrap Has Double Middleware Instantiation

**File:** `src/main.ts`  
**Severity:** Important  

**Problem:**  
On serverless, the entire module initialisation runs on each cold start. The current bootstrap has `RequestLoggerMiddleware` instantiated **twice** on the same line (creates two instances, but binds from the second):

```typescript
// Bug — two instances created, one applied
app.use(
  new RequestLoggerMiddleware().use.bind(new RequestLoggerMiddleware()),
);
```

**Fix:**  
```typescript
// Fix — single instance
const requestLogger = new RequestLoggerMiddleware();
app.use(requestLogger.use.bind(requestLogger));
```

For full serverless performance, cache the app instance outside the handler so warm invocations skip re-initialisation.

---

### [SERV-04] Google OAuth Callback Cannot Reliably Work on Stateless Serverless

**File:** `src/auth/auth.public.controller.ts`  
**Severity:** Important  

**Problem:**  
The Google OAuth flow requires two HTTP calls to the same server instance: `GET /auth/google` (initiates) and `GET /auth/google/callback` (receives the code). On serverless platforms with multiple function instances, these two requests may hit **different instances**, causing Passport to fail to find the session/state.

**Fix:**  
- Use a **stateless OAuth flow**: pass a signed `state` parameter to verify the callback, and use PKCE if possible.
- Ensure the `GOOGLE_CALLBACK_URL` always routes to a stable, predictable URL.
- Explicitly set `session: false` in Passport configuration to avoid any implicit session dependency.

---

## Security Issues

---

### [SEC-01] Logout Accepts Any Token String From Body Without Validating It

**File:** `src/auth/auth.controller.ts` · `src/auth/auth.service.ts`  
**Severity:** Critical  

**Problem:**  
The `logout` endpoint accepts `token` from the request body (`LogoutDto`) and blacklists it as-is, **without validating that the token:**
1. Is a valid JWT.
2. Belongs to the current authenticated user.

An attacker could:
- **Flood the blacklist table** with garbage strings (DoS).
- **Blacklist another user's token** if they know or guess it.
- The `userId` stored in the blacklist comes from the authenticated user's cookie, but the `token` blacklisted is from the body — these two are **never cross-validated**.

```typescript
// No validation that dto.token is a valid JWT or belongs to userId
await this.blackListRepo.save({ token, userId, expiresAt });
```

**Fix:**  
The server should extract the token from the **cookie** (not from the body), since cookie-based auth is used. The logout endpoint should read `req.cookies[cookieName]`, validate it as a JWT, confirm `payload.id === userId`, then blacklist it. The `LogoutDto` and the body parameter can be removed entirely.

---

### [SEC-02] `current-user` Endpoint Returns Raw JWT Payload Without Explicit Shape

**File:** `src/auth/auth.controller.ts`  
**Severity:** Medium  

**Problem:**  
`GET /auth/current-user` returns `req.user` directly, which is the raw decoded JWT payload. The `RequestWithUser` type allows `Partial<User>`, so if future code adds extra fields to `req.user`, they would be exposed without explicit intent.

**Fix:**  
Return a minimal, explicitly typed response object:

```typescript
@Get('current-user')
getProfile(@GetUser() user: Pick<User, 'id' | 'email' | 'role'>) {
  return { id: user.id, email: user.email, role: user.role };
}
```

---

### [SEC-03] Two Parallel Auth Systems Create Confusion and Dead Code

**File:** `src/auth/guards/jwt-auth.guard.ts` · `src/auth/strategies/jwt.strategy.ts` · `src/auth/guards/auth.guard.ts`  
**Severity:** Medium  

**Problem:**  
There is a custom `AuthGuard` (registered globally) that validates JWTs from cookies AND a Passport `JwtStrategy` + `JwtAuthGuard`. The `JwtStrategy.validate()` method hits the database on every request to find the user by ID, even though the custom guard already validates the JWT and populates `req.user`. These two systems are never reconciled and `JwtAuthGuard` appears to be dead code for most routes.

**Fix:**  
Remove `JwtStrategy` and `JwtAuthGuard` and rely solely on the custom `AuthGuard`. Or remove the custom `AuthGuard` and rely solely on the Passport strategy — but add the blacklist check inside the strategy's `validate()` method. Do not maintain two parallel auth systems.

---

### [SEC-04] Google Strategy Passes Undefined Email Silently

**File:** `src/auth/strategies/google.strategy.ts`  
**Severity:** Medium  

**Problem:**  
```typescript
email: emails?.[0]?.value,  // may be undefined
```
`email` can be `undefined` if Google does not return an email. This is passed to `validateGoogleUser`, which does check for it — but the check is in the service, not the strategy. The strategy's `done(null, googleUser)` call succeeds with `email: undefined`, meaning the invalid state passes Passport validation silently.

**Fix:**  
Validate `email` inside the strategy's `validate()` before calling `done()`:

```typescript
if (!emails?.[0]?.value) {
  return done(new UnauthorizedException('No email returned from Google'), false);
}
```

---

### [SEC-05] Password Reset Token Is Stored After Email Is Sent — Race Condition

**File:** `src/auth/auth.service.ts` — `sendResetPassword()`  
**Severity:** Medium  

**Problem:**  
The current order is:
1. Send email (`mailService.sendResetPassword`) ← happens first
2. Save token to DB (`addResetToken`) ← happens second

If step 1 succeeds but step 2 fails (DB error), the user receives an email with a token that is **not in the database** — the link is permanently broken with no way to retry.

**Fix:**  
Reverse the order — save the token first, then send the email. If the email fails, roll back the token:

```typescript
// Save token first, then send email
await this.addResetToken(user.id, hashedToken);
try {
  await this.mailService.sendResetPassword(user, token);
} catch (error) {
  // Roll back the token so the user can try again
  await this.userRepo.update(user.id, {
    passwordResetToken: null,
    passwordResetTokenExpiry: null,
  });
  throw new RequestTimeoutException('Failed to send reset email. Please try again.');
}
```

---

### [SEC-06] Email Verification Token Stored as Plain-Text; Reset Token Is Hashed

**File:** `src/auth/auth.service.ts` — `addVerificationToken()`  
**Severity:** Low–Medium  

**Problem:**  
The password reset token is correctly **hashed with argon2** before storage. However, the **email verification token** is stored as **plain-text** in `emailVerificationToken`. If the database is compromised, an attacker can extract all verification tokens and verify any unverified account.

```typescript
// Reset token — correctly hashed ✅
const hashedToken = await argon2.hash(token);
await this.addResetToken(user.id, hashedToken);

// Verification token — stored as plain-text ❌
const token = await this.mailService.sendVerificationEmail(user);
await this.addVerificationToken(user.id, token);  // raw token stored
```

**Fix:**  
Hash the verification token before storing. Since `verifyEmail()` currently queries `WHERE emailVerificationToken = token` (direct match), the lookup strategy must change — store a short lookup key (e.g., first 8 bytes of the token as hex) separately, then hash the full token. Alternatively, use a signed JWT as the verification token (no DB lookup needed at all).

---

### [SEC-07] No CSRF Protection on Cookie-Based Auth Mutations

**File:** `src/main.ts`  
**Severity:** Medium  

**Problem:**  
The app uses `httpOnly` cookies for JWT delivery. The `SameSite: 'strict'` setting on the Google auth cookie is good, but the general `AuthGuard` reads from cookies with **no CSRF token validation**. The `AGENTS.md` mentions a "CSRF helper" in common, but it is not applied to auth endpoints.

**Fix:**  
Apply the existing CSRF helper middleware to all state-mutating auth endpoints (login, logout, reset-password). Alternatively, adopt the **Double Submit Cookie** pattern where a CSRF token is set in a readable cookie and must be echoed in a request header.

---

### [SEC-08] `JWT_SECRET` Has No Minimum Length Validation

**File:** `src/config/env.validation.ts`  
**Severity:** Low  

**Problem:**  
`JWT_SECRET: Joi.string().required()` accepts a 1-character secret. A weak JWT secret is trivially brute-forceable with offline attacks.

**Fix:**  
```typescript
JWT_SECRET: Joi.string().min(32).required(),
```

---

### [SEC-09] `unsafe-inline` in Content Security Policy Weakens XSS Protection

**File:** `src/main.ts`  
**Severity:** Low  

**Problem:**  
```typescript
scriptSrc: ["'self'", "'unsafe-inline'"],
styleSrc:  ["'self'", "'unsafe-inline'"],
```
`unsafe-inline` for scripts defeats the XSS protection that CSP provides. Any injected inline script would execute.

**Fix:**  
Remove `'unsafe-inline'` from `scriptSrc`. If inline scripts are needed for Swagger UI, scope the exception to the `/api` documentation path using a nonce or hash.

---

## Rate Limiting (Per-Endpoint Review)

> **Warning:** Without a Redis storage adapter ([SERV-01]), all limits below are completely ineffective on serverless — counters reset on every cold start.

| Endpoint | Guard Applied | Limit | TTL | Assessment |
|---|---|---|---|---|
| `POST /auth/login` | ThrottlerGuard ✅ | 5 | 15 min | ✅ Appropriate |
| `POST /auth/verify-email` | ThrottlerGuard ✅ | 5 | 15 min | ✅ Appropriate |
| `POST /auth/reset-password/send` | ThrottlerGuard ✅ | 3 | 15 min | ✅ Appropriate |
| `POST /auth/reset-password/verify` | ThrottlerGuard ✅ | 5 | 15 min | ✅ Appropriate |
| `POST /auth/reset-password` | ThrottlerGuard ✅ | 5 | 1 hour | ✅ Appropriate |
| `GET /auth/google` | ❌ No throttle | — | — | See RL-01 |
| `GET /auth/google/callback` | ❌ No throttle | — | — | See RL-01 |
| `POST /auth/logout` | ❌ No throttle | — | — | See RL-02 |
| `GET /auth/current-user` | Global only | 100 | 1 min | See RL-03 |
| `POST /user` (register) | ❌ No throttle | — | — | Critical — See RL-04 |

---

### [RL-01] Google OAuth Endpoints Have No Rate Limiting

**File:** `src/auth/auth.public.controller.ts`  
**Severity:** Medium  

**Problem:**  
`GET /auth/google` and `GET /auth/google/callback` have no `@Throttle` decorator. While Google OAuth itself rate-limits on their side, the callback endpoint triggers `validateGoogleUser`, which **writes to the database** and potentially creates new user records on every hit.

**Fix:**  
```typescript
@Get('google/callback')
@UseGuards(ThrottlerGuard, AuthGuard('google'))
@Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
async googleAuthRedirect(...) { ... }
```

---

### [RL-02] Logout Endpoint Has No Rate Limiting

**File:** `src/auth/auth.controller.ts`  
**Severity:** Low  

**Problem:**  
`POST /auth/logout` requires authentication (good), but has no rate limit. A malicious authenticated user could flood the `black_list_tokens` table with logout calls, growing the table unboundedly.

**Fix:**  
```typescript
@Post('logout')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: 60 * 1000 } }) // 10 logouts per minute
logout(...) { ... }
```

---

### [RL-03] `current-user` Relies Only on Loose Global Throttle

**File:** `src/auth/auth.controller.ts`  
**Severity:** Low  

**Problem:**  
`GET /auth/current-user` is only covered by the global throttler (100 req/min), which is very loose for an identity endpoint. Combined with [SERV-01], this is ineffective on serverless anyway.

**Fix:**  
After fixing [SERV-01], optionally tighten the limit per route:

```typescript
@Get('current-user')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
getProfile(...) { ... }
```

---

### [RL-04] Register Endpoint Has No Rate Limiting — Critical on Serverless

**File:** `src/user/user.controller.ts`  
**Severity:** Critical  

**Problem:**  
The register endpoint (`POST /user`) is `@Public()` and has **zero rate limiting**. It:
1. Queries the database to check for existing emails.
2. Hashes a password with argon2 (CPU-intensive — ~200–800ms on free-tier).
3. (After the FEAT-01 fix) sends an email.

A flood of registration attempts can exhaust DB connections, saturate argon2 CPU threads, and burn through the entire monthly email quota in minutes on free hosting.

**Fix:**  
```typescript
@Public()
@Post()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } }) // 5 registrations per IP per hour
create(@Body() createUserDto: CreateUserDto) { ... }
```

---

## Performance Issues

---

### [PERF-01] Argon2 Default Settings Are Too Heavy for Free-Tier Serverless CPU

**File:** `src/user/user.service.ts` · `src/auth/auth.service.ts`  
**Severity:** Important for serverless  

**Problem:**  
Argon2 defaults use 64 MB of memory and significant CPU. On free-tier serverless with ~512 MB RAM and shared CPU, argon2 can take 200–800 ms per hash. This affects:
- Login (one `argon2.verify`)
- Register (one `argon2.hash`)
- Reset password send (one `argon2.hash`)
- Reset password verify (one `argon2.verify`)
- Reset password change (one `argon2.hash` + one `argon2.verify`)

Each of these will approach or exceed typical serverless function timeout limits on the cheapest tiers.

**Fix:**  
Tune argon2 parameters for constrained environments:

```typescript
await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 16384,  // 16 MB instead of 64 MB default
  timeCost: 3,
  parallelism: 1,
});
```

This still provides strong security while being feasible on constrained hardware.

---

### [PERF-02] Duplicate Email-Verification Logic in Two Modules

**File:** `src/auth/auth.service.ts` · `src/user/user.service.ts`  
**Severity:** Medium  

**Problem:**  
Email verification logic exists in **two independent places**:
- `AuthService.verifyEmail()` — used by `POST /auth/verify-email`
- `UserService.verifyEmail()` — used by `POST /user/verify-email`

Both perform the same database operations. Having two endpoints for the same action creates:
- Confusion about which to use
- Risk of inconsistency (one clears a field the other misses)
- Unmaintainable duplication

**Fix:**  
Keep one canonical implementation in `AuthService.verifyEmail()` (verification is an auth concern). Delete `UserService.verifyEmail()` and the `POST /user/verify-email` endpoint. Update any consumers.

---

### [PERF-03] No Database Index on `emailVerificationToken` or `passwordResetToken`

**File:** `src/user/schema/user.entity.ts`  
**Severity:** Medium  

**Problem:**  
Both `verifyEmail()` and `verifyResetToken()` query by token value:
- `WHERE emailVerificationToken = ?`
- `WHERE passwordResetToken = ?` (via email lookup first — but still an issue)

Neither `emailVerificationToken` nor `passwordResetToken` has `@Index()`, meaning every verification or reset call does a full table scan.

**Fix:**  
```typescript
@Index()
@Column({ type: 'varchar', nullable: true })
emailVerificationToken?: string | null;

@Index()
@Column({ type: 'varchar', nullable: true })
passwordResetToken?: string | null;
```

Generate and run a TypeORM migration after this change.

---

### [PERF-04] `validateGoogleUser` Makes Two Database Queries When One Would Suffice

**File:** `src/auth/auth.service.ts` — `validateGoogleUser()`  
**Severity:** Low  

**Problem:**  
For a new Google user with an existing email (account linking), the code performs:
1. `findOne({ where: { googleId } })` — miss (no match)
2. `findOne({ where: { email } })` — hit
3. `userRepo.save(user)` — update

This is 3 round-trips to the database. With a serverless DB connection pool, each round-trip has connection overhead.

**Fix:**  
Use a single query with OR condition:

```typescript
const user = await this.userRepo.findOne({
  where: [{ googleId }, { email }],
});
// Then determine: found by googleId (already linked), found by email only (link needed), or not found (create)
```

---

## Clean Code Issues

---

### [CC-01] `ForgotPasswordDto` Is Dead Code

**File:** `src/auth/dto/forgot-password.dto.ts`  
**Severity:** Minor  

**Problem:**  
`ForgotPasswordDto` exists but is never imported or used anywhere. `SendResetPasswordDto` serves the same purpose.

**Fix:** Delete `forgot-password.dto.ts`.

---

### [CC-02] `BlackListTokenDto` Is Dead Code

**File:** `src/auth/dto/blackList-token.dto.ts`  
**Severity:** Minor  

**Problem:**  
`BlackListTokenDto` is defined but not used anywhere. The logout endpoint uses `LogoutDto` instead.

**Fix:** Delete `blackList-token.dto.ts`.

---

### [CC-03] `StatusEnum` Is Misplaced in the Auth Module

**File:** `src/auth/types/StatusEnum.ts`  
**Severity:** Minor  

**Problem:**  
`StatusEnum` (`active`, `inactive`, `banned`) is a user-lifecycle concern, not an authentication concern. It is placed in `src/auth/types/` but used in the `User` entity under `src/user/`. This violates the module boundary principle stated in `AGENTS.md`.

**Fix:**  
Move `StatusEnum` to `src/user/types/` or `src/common/types/` and update all imports.

---

### [CC-04] `UserRoleEnum` Is Misplaced in the Auth Module

**File:** `src/auth/types/UserRoleEnum.ts`  
**Severity:** Minor  

**Problem:**  
`UserRoleEnum` is used by `User` entity, `UserService`, `UserController`, and `RolesGuard`. Having it in `auth/types` means the `user` module depends on `auth` for a fundamental domain type, creating a potential circular-dependency risk.

**Fix:**  
Move `UserRoleEnum` to `src/common/types/UserRoleEnum.ts` and update all imports across modules.

---

### [CC-05] `ReturnJWTOptions` Is an Unnecessary Indirection

**File:** `src/auth/auth.module.ts`  
**Severity:** Minor  

**Problem:**  
```typescript
function ReturnJWTOptions(config: ConfigService) { ... }

const JWT_OPTIONS = {
  useFactory: (config: ConfigService) => {
    return ReturnJWTOptions(config);  // unnecessary wrapper
  },
};
```

The `JWT_OPTIONS` object wraps `ReturnJWTOptions` in an anonymous factory for no reason. The factory could directly contain the logic.

**Fix:**  
Inline the factory:
```typescript
const JWT_OPTIONS = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    secret: config.getOrThrow<string>('JWT_SECRET'),
    signOptions: { expiresIn: config.getOrThrow<string>('JWT_EXPIRES_IN') as never },
  }),
};
```

---

### [CC-06] `expiresIn as never` Type Suppression

**File:** `src/auth/auth.module.ts`  
**Severity:** Minor  

**Problem:**  
```typescript
expiresIn: expiresIn as never,
```
Using `as never` to silence a TypeScript error is a code smell. It hides a legitimate type mismatch.

**Fix:**  
Use the correct type from the `@nestjs/jwt` package to maintain type safety without suppression.

---

### [CC-07] `name` Column Has `unique: true` — Almost Certainly Unintentional

**File:** `src/user/schema/user.entity.ts`  
**Severity:** Medium  

**Problem:**  
```typescript
@Column({ nullable: true, unique: true })
name?: string;
```
Setting `unique: true` on `name` means **no two users can have the same name**. This would reject registrations from users who share a common name (e.g., two people named "John Smith"). This is almost certainly unintentional and will cause hard-to-debug `UniqueViolation` errors in production.

**Fix:**  
Remove `unique: true` from the `name` column. Generate and run a migration to drop the database-level unique constraint.

---

### [CC-08] `@IsEmail()` and `@IsString()` Are Redundant Together

**File:** `src/auth/dto/send-reset-password.dto.ts` · `src/auth/dto/verify-reset-password-token.dto.ts`  
**Severity:** Minor  

**Problem:**  
`@IsEmail()` already validates that the value is a string formatted as an email. Adding `@IsString()` before it is redundant and adds visual noise.

**Fix:**  
Remove `@IsString()` from any field that also has `@IsEmail()`.

---

### [CC-09] Password Minimum Length Is Inconsistent Between Register and Reset

**File:** `src/user/dto/create-user.dto.ts` · `src/auth/dto/reset-password.dto.ts`  
**Severity:** Medium  

**Problem:**  
- **Registration** (`CreateUserDto`): `@MinLength(8)` + `@Matches` (requires uppercase, lowercase, number)  
- **Reset password** (`ResetPasswordDto`): `@MinLength(6)` only — no complexity requirement

A user who resets their password can set a **weaker password** than what the registration policy enforces. This undermines the security policy.

**Fix:**  
Extract shared password validation rules into a `PasswordValidationConstraints` constant and apply it consistently in both DTOs:

```typescript
// shared
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
export const PASSWORD_MIN_LENGTH = 8;
```

---

## Feature Gap: Register Does Not Send Verification Email

---

### [FEAT-01] `POST /user` (Register) Does Not Send a Verification Email

**File:** `src/user/user.controller.ts` · `src/user/user.service.ts`  
**Severity:** Critical (Feature Gap)  

**Problem:**  
When a user registers via `POST /user`, `UserService.create()` saves the user with `isEmailVerified: false` (the default) but **never sends a verification email**. The user is created and the response returns immediately. The only way a verification email is triggered is on the **next login attempt** when the guard detects `!user.isEmailVerified` and calls `sendVerificationEmail()`. This means:

1. A newly registered user receives **no email** — they do not know they need to verify.
2. They must attempt login first to trigger the email — a confusing UX.
3. The registration success response gives no indication that an email was sent or is expected.

**Current flow:**
```
POST /user
  → create user in DB (isEmailVerified: false)
  → return User entity  ← no email sent

POST /auth/login (user tries to login)
  → detect isEmailVerified === false
  → THEN send verification email
  → throw 403 ForbiddenException
```

**Required flow:**
```
POST /user
  → create user in DB
  → send verification email immediately
  → return { message: "Account created. Check your email.", user: { id, email } }
```

**Implementation Plan (no code written — report only):**

**Step 1 — Import MailModule into UserModule:**  
`UserModule` must add `MailModule` to its `imports` array so `MailService` is available as a dependency.

**Step 2 — Inject MailService into UserService:**  
Add `MailService` as a constructor parameter in `UserService`.

**Step 3 — Send verification email inside `UserService.create()`:**  
After `this.userRepo.save(user)`:
- Generate a raw token via `crypto.randomBytes(32).toString('hex')`
- Hash it with argon2 (see SEC-06 for why hashing is needed)
- Call `mailService.sendVerificationEmail(user, rawToken)` — pass the raw token to the email
- Store the hashed token in the user record via `userRepo.update(user.id, { emailVerificationToken: hashedToken, emailVerificationTokenExpiry: expiry })`
- Wrap in try/catch: if the email fails, log the error but still return success — the user can trigger a resend via login or a dedicated endpoint.

**Step 4 — Change the register response shape:**  
Instead of returning the raw `User` entity (which exposes internal fields), return:
```json
{
  "message": "Account created successfully. Please check your email to verify your account.",
  "user": { "id": 1, "email": "user@example.com" }
}
```

**Step 5 — Add rate limiting to register (resolves RL-04):**  
Sending an email on every registration makes email sending part of the register cost. Rate limiting is mandatory to prevent email quota exhaustion on free hosting.

**Step 6 — Remove the auto-resend from login:**  
Once registration reliably sends the email, remove the `sendVerificationEmail` side-effect from `AuthService.login()`. Replace it with a dedicated `POST /auth/resend-verification` endpoint that the user can call explicitly if they did not receive the email. This keeps login clean and predictable.

**Step 7 — Update `verifyEmail` to handle hashed tokens (resolves SEC-06):**  
Since the token will now be stored hashed, the `verifyEmail` method must change its lookup strategy. Two viable approaches:
- Store a short **lookup key** (first 16 hex chars of the raw token) in a separate indexed column, query by lookup key, then `argon2.verify` the full token against the stored hash.
- Use a signed short-lived JWT as the verification token — no DB lookup needed, expiry is built in.

---

## Summary Table

| ID | Category | Severity | File | Description |
|---|---|---|---|---|
| SERV-01 | Serverless | Critical | `throttler.config.ts` | In-memory throttler resets on every cold start |
| SERV-02 | Serverless | Critical | `auth.guard.ts` / `auth.service.ts` | DB blacklist check on every request — connection pressure |
| SERV-03 | Serverless | Important | `main.ts` | Double middleware instantiation; no app caching |
| SERV-04 | Serverless | Important | `auth.public.controller.ts` | Google OAuth stateless incompatibility |
| SEC-01 | Security | Critical | `auth.controller.ts` | Logout blacklists arbitrary body token without validation |
| SEC-02 | Security | Medium | `auth.controller.ts` | `current-user` returns raw JWT payload without explicit shape |
| SEC-03 | Security | Medium | `jwt.strategy.ts` / `auth.guard.ts` | Two parallel auth systems create confusion and dead code |
| SEC-04 | Security | Medium | `google.strategy.ts` | Google strategy passes undefined email silently |
| SEC-05 | Security | Medium | `auth.service.ts` | Reset token saved after email send — race condition |
| SEC-06 | Security | Low-Med | `auth.service.ts` | Verification token stored plain-text; reset token is hashed |
| SEC-07 | Security | Medium | `main.ts` | No CSRF protection on cookie-based auth mutations |
| SEC-08 | Security | Low | `env.validation.ts` | JWT_SECRET has no minimum length enforcement |
| SEC-09 | Security | Low | `main.ts` | `unsafe-inline` in CSP weakens XSS protection |
| RL-01 | Rate Limit | Medium | `auth.public.controller.ts` | Google OAuth endpoints have no rate limit |
| RL-02 | Rate Limit | Low | `auth.controller.ts` | Logout has no rate limit — blacklist table flood risk |
| RL-03 | Rate Limit | Low | `auth.controller.ts` | `current-user` relies only on loose global throttle |
| RL-04 | Rate Limit | Critical | `user.controller.ts` | Register has no rate limit — email/CPU/DB abuse risk |
| PERF-01 | Performance | Important | `user.service.ts` / `auth.service.ts` | Argon2 defaults too heavy for free-tier serverless CPU |
| PERF-02 | Performance | Medium | `auth.service.ts` / `user.service.ts` | Duplicate verify-email logic in two modules |
| PERF-03 | Performance | Medium | `user.entity.ts` | No DB index on emailVerificationToken / passwordResetToken |
| PERF-04 | Performance | Low | `auth.service.ts` | `validateGoogleUser` makes 2 DB queries when 1 would do |
| CC-01 | Clean Code | Minor | `forgot-password.dto.ts` | File is dead code — never imported |
| CC-02 | Clean Code | Minor | `blackList-token.dto.ts` | File is dead code — never imported |
| CC-03 | Clean Code | Minor | `StatusEnum.ts` | Misplaced in auth module; belongs in user or common |
| CC-04 | Clean Code | Minor | `UserRoleEnum.ts` | Misplaced in auth module; creates cross-module dependency |
| CC-05 | Clean Code | Minor | `auth.module.ts` | `ReturnJWTOptions` is unnecessary indirection |
| CC-06 | Clean Code | Minor | `auth.module.ts` | `as never` type suppression hides a real type error |
| CC-07 | Clean Code | Medium | `user.entity.ts` | `name` column has `unique: true` — almost certainly wrong |
| CC-08 | Clean Code | Minor | DTOs | `@IsString()` + `@IsEmail()` is redundant |
| CC-09 | Clean Code | Medium | DTOs | Password min-length: 8 chars on register, 6 chars on reset |
| FEAT-01 | Feature Gap | Critical | `user.controller.ts` | Register does not send verification email on success |

---

## Recommended Fix Priority Order

Given the **serverless / free-hosting** deployment target, fix in this order:

1. **[SERV-01]** — Redis throttler storage (all rate limits are broken without this)
2. **[RL-04]** — Rate limit the register endpoint (critical before adding email sending)
3. **[FEAT-01]** — Send verification email on register (the core requested feature)
4. **[SEC-01]** — Fix logout to validate the token from cookie, not body
5. **[SERV-02]** — Move token blacklist to Redis or add expiry filter + cleanup cron
6. **[SEC-05]** — Fix token save/send order to prevent broken reset links
7. **[SEC-06]** — Hash verification token before DB storage
8. **[CC-07]** — Remove unique constraint from `name` column (requires migration)
9. **[CC-09]** + **[PERF-03]** — Align password policies and add DB indexes (require migrations)
10. **[SERV-03]** — Fix double middleware instantiation
11. **[SEC-03]** — Remove dead `JwtStrategy` / `JwtAuthGuard` (parallel auth systems)
12. **[RL-01]** + **[RL-02]** — Add throttling to Google and logout endpoints
13. **[PERF-01]** — Tune argon2 parameters for free-tier CPU
14. All remaining clean-code items: CC-01 through CC-06, CC-08, PERF-02, PERF-04
