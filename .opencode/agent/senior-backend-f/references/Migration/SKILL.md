# Skill: Migration

## Trigger

Use when the request mentions **upgrades, refactors, version changes, ORM/database migration, or moving between architectures**.

---

## Scope

- NestJS major version upgrades
- Prisma ORM upgrades
- Schema migrations (rename, split, merge tables)
- Moving from TypeORM to Prisma
- Refactoring module structure
- Node.js version upgrades
- Dependency upgrades
- Zero-downtime schema changes

---

## NestJS Version Upgrade

```bash
# Check current versions
npm outdated @nestjs/core @nestjs/common

# Use the NestJS upgrade CLI
npx @nestjs/cli update

# Or upgrade manually
npm install @nestjs/core@latest @nestjs/common@latest @nestjs/platform-express@latest

# Regenerate and check
npm run build
```

**Migration checklist per major version**:
1. Read the official [NestJS migration guide](https://docs.nestjs.com/migration-guide)
2. Check breaking changes in `CHANGELOG.md`
3. Update all `@nestjs/*` packages together — mismatched versions cause DI failures
4. Run `npm audit` after upgrade
5. Run full test suite

---

## Prisma Upgrade

```bash
npm install prisma@latest @prisma/client@latest
npx prisma generate
npm run build
npm run test
```

Check the [Prisma releases](https://github.com/prisma/prisma/releases) for breaking changes before upgrading major versions.

---

## Schema Migration: Safe Column Rename

**Never rename in a single deployment**. Use a 3-phase approach:

### Phase 1 — Add new column, write to both

```prisma
model User {
  id           String @id
  firstName    String?  // new column
  name         String   // old column — still in use
}
```

```bash
npx prisma migrate dev --name add_first_name_column
```

Deploy. App writes to both `name` and `firstName`.

### Phase 2 — Backfill and switch reads

```typescript
// one-time migration script
await prisma.$executeRaw`
  UPDATE users SET first_name = name WHERE first_name IS NULL
`;
```

Switch all reads to `firstName`. `name` is now write-only.

### Phase 3 — Drop old column

```prisma
model User {
  id           String @id
  firstName    String   // required, backfilled
  // name removed
}
```

```bash
npx prisma migrate dev --name remove_old_name_column
```

Deploy.

---

## Schema Migration: Large Table Index

Prisma's `migrate` uses standard `CREATE INDEX` which locks the table. For tables >1M rows, use `CONCURRENTLY`:

```typescript
// prisma/migrations/20250101_add_status_index/migration.sql
-- This file is intentionally manual SQL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_status_idx" ON "orders"("status");
```

Mark it as applied without running it through Prisma:

```bash
npx prisma migrate resolve --applied "20250101_add_status_index"
```

Then apply the index manually on the production DB first, then run `migrate deploy`.

---

## TypeORM → Prisma Migration

### Step 1: Install Prisma alongside TypeORM

```bash
npm install prisma @prisma/client
npx prisma init
```

### Step 2: Pull existing schema

```bash
npx prisma db pull
# Generates prisma/schema.prisma from existing tables
```

Review and clean up the generated schema (fix naming, add relations, add indexes).

### Step 3: Generate baseline migration

```bash
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0_init/migration.sql

npx prisma migrate resolve --applied "0_init"
```

### Step 4: Create PrismaService and migrate feature by feature

Introduce `PrismaService` and migrate one repository at a time. Run both TypeORM and Prisma in parallel temporarily.

### Step 5: Remove TypeORM

Once all repositories are migrated and tests pass:

```bash
npm uninstall typeorm @nestjs/typeorm
```

---

## Module Refactoring: Split Large Module

When a module grows too large (>5 services, >3 sub-domains):

```
/orders
  orders.module.ts        ← becomes a "barrel" module
  /order-creation
    order-creation.module.ts
    order-creation.service.ts
  /order-fulfillment
    order-fulfillment.module.ts
    order-fulfillment.service.ts
  /order-history
    order-history.module.ts
    order-history.service.ts
```

```typescript
// orders.module.ts — re-exports sub-modules
@Module({
  imports: [
    OrderCreationModule,
    OrderFulfillmentModule,
    OrderHistoryModule,
  ],
  exports: [
    OrderCreationModule,
    OrderFulfillmentModule,
    OrderHistoryModule,
  ],
})
export class OrdersModule {}
```

---

## Node.js Version Upgrade

```bash
# Check current version
node --version

# Update .nvmrc / .node-version
echo "20" > .nvmrc

# Update Dockerfile
FROM node:20-alpine

# Update package.json engines field
"engines": { "node": ">=20.0.0" }
```

After upgrading: run `npm ci`, full test suite, and check for any deprecated API usage.

---

## Notes

- **Feature flags for large migrations**: Use a config flag to enable the new code path while the old one remains. Roll out gradually.
- **Never rename + logic change in one PR**: Schema rename and business logic changes should be separate deployments.
- **Backup before schema changes**: Always have a verified DB backup before running destructive migrations in production.
- **Test migration scripts**: Run the full migration against a copy of production data before applying to prod.
- **Communicate breaking changes**: If an API shape changes, version the endpoint (`/v2/...`) rather than modifying `/v1/...` in place.
