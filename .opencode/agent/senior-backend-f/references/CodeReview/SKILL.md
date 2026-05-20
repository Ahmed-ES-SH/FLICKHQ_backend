# Skill: Code Review

## Trigger

Use when the request asks for **code review, PR review, quality assessment, production-readiness review, or defect spotting**.

---

## Scope

- Security vulnerabilities
- Missing validation
- Incorrect error handling
- Performance anti-patterns
- Missing or weak tests
- Architecture violations
- Unsafe database operations
- Naming, clarity, and maintainability issues

---

## Review Checklist

### Security
- [ ] No secrets, API keys, or credentials in code
- [ ] All endpoints have appropriate auth (JWT guard + roles)
- [ ] Input validated via DTO + ValidationPipe, not manually in service
- [ ] No raw SQL string concatenation
- [ ] Sensitive fields excluded from responses (`password`, tokens, PII)
- [ ] Rate limiting on public/auth endpoints
- [ ] CORS not set to `*` in production

### Validation & DTOs
- [ ] Every controller endpoint with a body has a typed DTO
- [ ] `@ValidateNested()` + `@Type()` present for nested objects
- [ ] `@IsOptional()` placed before other validators
- [ ] No `any` types in DTOs or service signatures
- [ ] Enums validated with `@IsEnum()`

### Database
- [ ] No `deleteMany()` / `updateMany()` without a `where` clause
- [ ] Multi-step mutations use `prisma.$transaction()`
- [ ] Indexes exist on FK columns and filter columns
- [ ] Raw SQL uses tagged templates, not `$queryRawUnsafe`
- [ ] `Decimal` used for money, not `Float`
- [ ] Schema has explicit `onDelete` behavior on relations

### Error Handling
- [ ] `NotFoundException` thrown for missing records (not returning `null`)
- [ ] `ConflictException` for duplicate violations
- [ ] External API errors caught and wrapped (not leaking 3rd-party stack traces)
- [ ] No swallowed `catch` blocks (`catch (err) {}`)
- [ ] Prisma P2002/P2025 handled explicitly where expected

### Performance
- [ ] No N+1 queries (check `include` vs. loop pattern)
- [ ] `Promise.all()` used for independent async operations
- [ ] Paginated endpoints don't fetch unbounded result sets
- [ ] Heavy CPU work offloaded to queue
- [ ] No `await` inside a loop unless sequential dependency is required

### Architecture
- [ ] Controllers contain only HTTP logic (no business logic, no DB calls)
- [ ] Services contain business logic (no raw `prisma` calls — use repository)
- [ ] No cross-domain direct DB access (OrdersService shouldn't query `users` table directly)
- [ ] Module imports/exports are explicit and minimal
- [ ] No `@Global()` abuse (only `PrismaModule`, `ConfigModule`, `LoggerModule`)

### Testing
- [ ] Unit tests cover happy path + key error cases
- [ ] Mocks are typed (not `jest.fn()` with `as any`)
- [ ] No test that only tests a mock returning what you told it to
- [ ] Integration/E2E tests cover critical flows (auth, payment, data mutation)
- [ ] `jest.clearAllMocks()` in `beforeEach`

### Code Quality
- [ ] No `console.log` — use injected Logger
- [ ] No `any` — explicit types everywhere
- [ ] Return types on all public methods
- [ ] Consistent naming: `findOneOrFail` not `getUser`, `remove` not `deleteUser`
- [ ] Early returns to reduce nesting

---

## Common Review Findings

### Finding: Business Logic in Controller

```typescript
// ❌ BAD — logic in controller
@Post()
async create(@Body() dto: CreateOrderDto) {
  const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
  if (!user) throw new NotFoundException('User not found');
  const total = dto.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  return this.prisma.order.create({ data: { ...dto, total } });
}

// ✅ GOOD — controller delegates
@Post()
create(@Body() dto: CreateOrderDto) {
  return this.ordersService.create(dto);
}
```

---

### Finding: No Transaction for Multi-Step Write

```typescript
// ❌ BAD — non-atomic, partial failure possible
await this.prisma.order.create({ data: orderData });
await this.prisma.inventory.update({ ... });
await this.prisma.wallet.update({ ... }); // if this throws, previous writes persist

// ✅ GOOD — atomic
await this.prisma.$transaction(async (tx) => {
  await tx.order.create({ data: orderData });
  await tx.inventory.update({ ... });
  await tx.wallet.update({ ... });
});
```

---

### Finding: Unguarded Delete

```typescript
// ❌ BAD — deletes all records if called with empty filter
await this.prisma.session.deleteMany();

// ✅ GOOD
await this.prisma.session.deleteMany({ where: { userId: id, expiresAt: { lt: new Date() } } });
```

---

### Finding: Swallowed Error

```typescript
// ❌ BAD — error silently ignored
try {
  await this.notificationsService.send(userId, message);
} catch (err) {
  // nothing
}

// ✅ GOOD — log and decide whether to propagate
try {
  await this.notificationsService.send(userId, message);
} catch (err) {
  this.logger.warn('Notification failed, continuing', { userId, error: (err as Error).message });
  // only swallow if notification failure shouldn't fail the parent operation
}
```

---

### Finding: `Promise.all` Opportunity

```typescript
// ❌ BAD — sequential when independent
const user    = await this.usersService.findOneOrFail(userId);
const wallet  = await this.walletsService.findByUser(userId);
const orders  = await this.ordersService.findByUser(userId);

// ✅ GOOD — parallel
const [user, wallet, orders] = await Promise.all([
  this.usersService.findOneOrFail(userId),
  this.walletsService.findByUser(userId),
  this.ordersService.findByUser(userId),
]);
```

---

## Review Output Format

When performing a review, structure output as:

```
## Critical (must fix before merge)
- [File:Line] Issue description + corrected code snippet

## Major (should fix, affects quality/correctness)
- [File:Line] Issue description + corrected code snippet

## Minor (nice to fix, style/clarity)
- [File:Line] Suggestion

## Approved ✅ / Changes Requested ❌
```
