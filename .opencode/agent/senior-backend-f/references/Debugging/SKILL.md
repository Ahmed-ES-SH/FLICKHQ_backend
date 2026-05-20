# Skill: Debugging

## Trigger

Use when the request includes a **bug, error, stack trace, failing build, broken endpoint, database issue, or production incident**.

---

## Scope

- Reading and diagnosing NestJS stack traces
- Database connection errors
- Runtime exceptions (unhandled promises, type errors)
- Broken DI (circular dependencies, missing providers)
- JWT/auth failures
- Prisma query errors
- Build/TypeScript compilation errors
- Slow queries and performance regressions
- Production incident response

---

## Diagnostic Framework

When debugging, always follow this sequence:

1. **Isolate** — Is this a build error, startup error, or runtime error?
2. **Read the full stack trace** — Not just the first line. The root cause is usually deeper.
3. **Identify the layer** — Controller? Service? Repository? Middleware? External call?
4. **Reproduce minimally** — Strip to the smallest failing case.
5. **Fix + verify** — Run the failing test after the fix. Never "it probably works now."

---

## Common Errors and Fixes

### Circular Dependency

```
Error: A circular dependency has been detected. Please, make sure that each side of a bidirectional relationships are using forwardRef(). It was found in: ...
```

**Diagnosis**: Module A imports Module B which imports Module A.

**Fix (short-term)**:

```typescript
// module-a.module.ts
imports: [forwardRef(() => ModuleBModule)]

// module-b.module.ts
imports: [forwardRef(() => ModuleAModule)]

// service-a.ts
constructor(
  @Inject(forwardRef(() => ServiceB)) private readonly serviceB: ServiceB,
) {}
```

**Real fix**: Circular deps indicate a domain boundary problem. Extract the shared logic into a third `SharedModule`, or invert the dependency via events.

---

### Provider Not Found

```
Nest can't resolve dependencies of the XService. Please make sure that the argument YService at index [0] is available in the XModule context.
```

**Checklist**:
- [ ] Is `YService` in the `providers` array of `YModule`?
- [ ] Is `YService` in the `exports` array of `YModule`?
- [ ] Is `YModule` in the `imports` array of `XModule`?

---

### Database Connection Error on Startup

```
Error: Can't reach database server at `host:5432`
```

**Checklist**:
- [ ] `DATABASE_URL` is set and correct in the current env
- [ ] The host is reachable (VPN, firewall, security group)
- [ ] PostgreSQL service is running (`pg_isready -h host -p 5432`)
- [ ] SSL mode matches server config (`?sslmode=require` in URL if needed)
- [ ] Connection pool limit not exceeded (check `pg_stat_activity`)

```bash
# Quick connectivity test
npx prisma db execute --stdin <<< "SELECT 1"
```

---

### Prisma P2002 — Unique Constraint Violation

```
PrismaClientKnownRequestError: 
  Unique constraint failed on the fields: (`email`)
```

**Handling**:

```typescript
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

async create(dto: CreateUserDto) {
  try {
    return await this.prisma.user.create({ data: dto });
  } catch (err) {
    if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
      const field = (err.meta?.target as string[])?.[0] ?? 'field';
      throw new ConflictException(`${field} already in use`);
    }
    throw err;
  }
}
```

Common Prisma error codes: `P2002` unique, `P2003` FK constraint, `P2025` record not found.

---

### JWT 401 Unauthorized

**Diagnosis flow**:

1. Is the token present in `Authorization: Bearer <token>` header?
2. Is the token expired? Decode at [jwt.io](https://jwt.io) — check `exp`.
3. Is `JWT_ACCESS_SECRET` in the environment matching the one used to sign?
4. Is the `JwtStrategy` registered in the auth module?
5. Is the `JwtAuthGuard` applied (globally or on the route)?

```typescript
// Quick debug: add a logger in JwtStrategy.validate()
async validate(payload: JwtPayload) {
  this.logger.debug('JWT validate called', { sub: payload.sub });
  const user = await this.usersService.findOneOrFail(payload.sub);
  if (!user) {
    this.logger.warn('User not found for JWT payload', { sub: payload.sub });
    throw new UnauthorizedException();
  }
  return user;
}
```

---

### ValidationPipe Not Catching Errors

**Symptom**: Bad input reaches the service without throwing.

**Checklist**:
- [ ] Is `ValidationPipe` registered globally in `main.ts`?
- [ ] Is `transform: true` set? Without it, the body isn't instantiated as a DTO class and decorators won't run.
- [ ] For nested objects: Is `@ValidateNested()` + `@Type(() => NestedDto)` both present?
- [ ] For query params: Is `enableImplicitConversion: true` set?

---

### Unhandled Promise Rejection

```
UnhandledPromiseRejection: Error: ...
```

**Root cause**: An `async` function was called without `await` or without `.catch()`.

```typescript
// ❌ Fire-and-forget without error handling
this.emailService.sendWelcomeEmail(user.id); // if this throws, it's unhandled

// ✅ Await it
await this.emailService.sendWelcomeEmail(user.id);

// ✅ Or offload to queue (preferred for side effects)
await this.emailQueue.add('welcome', { userId: user.id });
```

---

### TypeScript Compilation Errors

```
error TS2345: Argument of type 'X' is not assignable to parameter of type 'Y'
```

**Strategy**:
1. Read the full type error — TypeScript tells you exactly which property mismatches.
2. Don't use `as any` as a fix. Find the correct type.
3. Use `typeof`, `keyof`, `Partial<>`, `Required<>`, or discriminated unions.
4. Check if a Prisma type needs to be imported from `@prisma/client`.

---

### Slow Endpoint Investigation

```typescript
// 1. Add timing log around suspect code
const t0 = Date.now();
const result = await this.heavyQuery();
this.logger.debug(`heavyQuery took ${Date.now() - t0}ms`);

// 2. Check for N+1 with Prisma logging
const prisma = new PrismaClient({
  log: [{ emit: 'event', level: 'query' }],
});
prisma.$on('query', (e) => console.log(`Query: ${e.query} | ${e.duration}ms`));
```

---

## Production Incident Response

1. **Don't panic** — start with logs, not code changes.
2. `GET /health` → is the service up? Is the DB reachable?
3. Check error logs for the time window of the incident.
4. Identify the first error, not the cascade.
5. Check for recent deploys — roll back if deployment timing correlates.
6. Check DB: `pg_stat_activity` for long-running queries or lock contention.
7. Check queue: Are jobs failing? Is the queue backed up?
8. Fix, deploy, verify, write a post-mortem.

---

## Notes

- **Never push a "should be fine" fix**. Write a test that reproduces the bug first, then fix until the test passes.
- **`console.log` debugging in production** leaks data and pollutes logs. Use structured logger with debug level, disabled in prod.
- **Prisma query debugging**: Enable query logging only in development. Production query logging is a performance and security risk.
