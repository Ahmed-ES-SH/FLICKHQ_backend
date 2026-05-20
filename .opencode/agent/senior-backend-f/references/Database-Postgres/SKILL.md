# Skill: Database — PostgreSQL

## Trigger

Use when the request mentions **PostgreSQL, remote database, schema, migration, query optimization, indexing, transactions, ORM, repository design, pooling, or connection errors**.

---

## Scope

- Remote PostgreSQL connection setup and configuration
- Prisma ORM integration (schema, client, migrations)
- PrismaService as a NestJS provider
- Connection pooling and PgBouncer compatibility
- Schema design and indexing best practices
- Query performance and the N+1 problem
- Transactions (interactive + `$transaction`)
- Raw SQL when Prisma is insufficient
- Migration workflow (dev + production)
- Environment-based config (no hardcoded credentials)

---

## Connection Setup

### Environment Variables

```env
# .env (never commit this file)
DATABASE_URL="postgresql://user:password@host:5432/dbname?schema=public&connection_limit=10&pool_timeout=20"
```

For PgBouncer (transaction mode):

```env
DATABASE_URL="postgresql://user:password@pgbouncer-host:6432/dbname?pgbouncer=true&connection_limit=5"
DIRECT_URL="postgresql://user:password@postgres-host:5432/dbname"
```

### Prisma Schema Setup

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL") // required when using PgBouncer
}
```

---

## PrismaService (NestJS Provider)

```typescript
// prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

```typescript
// prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Register in `AppModule`:

```typescript
imports: [PrismaModule, ConfigModule.forRoot({ isGlobal: true }), ...]
```

---

## Schema Design Conventions

```prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  role      Role     @default(USER)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  orders    Order[]

  @@index([email])
  @@map("users")
}

model Order {
  id        String      @id @default(uuid())
  userId    String
  status    OrderStatus @default(PENDING)
  total     Decimal     @db.Decimal(12, 2)
  createdAt DateTime    @default(now())

  user      User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([status])
  @@index([createdAt])
  @@map("orders")
}

enum Role {
  USER
  ADMIN
}

enum OrderStatus {
  PENDING
  PAID
  SHIPPED
  CANCELLED
}
```

**Rules:**
- UUIDs for all primary keys (no sequential int IDs in distributed systems).
- `@@map` to control actual table names.
- Index every FK and every column used in `WHERE`, `ORDER BY`, or `GROUP BY`.
- Use `Decimal` for money — never `Float`.
- `onDelete: Cascade` or `Restrict` — always explicit, never rely on defaults.

---

## Migration Workflow

```bash
# Development — create and apply in one step
npx prisma migrate dev --name add_orders_table

# Production — generate SQL, review, then apply
npx prisma migrate deploy

# After pulling schema changes from team
npx prisma generate

# Inspect current DB state
npx prisma db pull

# Open GUI for data inspection
npx prisma studio
```

**Production rule**: Never run `migrate dev` in production. Use `migrate deploy` in CI/CD only.

---

## Transactions

### Sequential (array form — simpler)

```typescript
const [user, wallet] = await this.prisma.$transaction([
  this.prisma.user.create({ data: userData }),
  this.prisma.wallet.create({ data: { userId: '...' } }),
]);
```

### Interactive (for conditional logic)

```typescript
async transferFunds(fromId: string, toId: string, amount: Decimal): Promise<void> {
  await this.prisma.$transaction(async (tx) => {
    const sender = await tx.wallet.findUniqueOrThrow({ where: { userId: fromId } });

    if (sender.balance.lt(amount)) {
      throw new BadRequestException('Insufficient funds');
    }

    await tx.wallet.update({
      where: { userId: fromId },
      data: { balance: { decrement: amount } },
    });

    await tx.wallet.update({
      where: { userId: toId },
      data: { balance: { increment: amount } },
    });

    await tx.transaction.create({
      data: { fromId, toId, amount, type: 'TRANSFER' },
    });
  });
}
```

---

## Query Performance

### Avoid N+1 — Use `include` / `select`

```typescript
// BAD — N+1
const orders = await this.prisma.order.findMany();
for (const o of orders) {
  o.user = await this.prisma.user.findUnique({ where: { id: o.userId } });
}

// GOOD — single query with JOIN
const orders = await this.prisma.order.findMany({
  include: { user: { select: { id: true, email: true } } },
});
```

### Pagination (cursor-based for large tables)

```typescript
async findPage(cursor?: string, limit = 20) {
  return this.prisma.order.findMany({
    take: limit,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { createdAt: 'desc' },
  });
}
```

### Raw SQL (when Prisma is insufficient)

```typescript
const result = await this.prisma.$queryRaw<{ total: bigint }[]>`
  SELECT COUNT(*) as total
  FROM orders
  WHERE status = ${OrderStatus.PENDING}
    AND created_at > ${new Date(Date.now() - 86400000)}
`;
```

Always use tagged template literals for raw SQL — never string concatenation.

---

## Connection Pooling Notes

| Mode | Recommended `connection_limit` |
|---|---|
| Direct connection | CPU cores × 2 |
| PgBouncer (transaction) | 5–10 per app instance |
| PgBouncer (session) | Treat as direct |

- Set `pool_timeout` to fail fast rather than queue indefinitely.
- With multiple app replicas, total connections = `connection_limit × replica_count`. Keep this under PostgreSQL's `max_connections`.

---

## Notes

- **Never use `deleteMany` without a `where` clause** in production code. Add an ESLint rule if needed.
- **Soft deletes**: Add `deletedAt DateTime?` + filter in every query, or use Prisma middleware for automatic filtering.
- **Migrations in CI**: Run `prisma migrate deploy` as a pre-deploy step, not at app startup. Use `prisma migrate status` to verify.
- **Schema changes on live tables**: For large tables (>1M rows), index creation and column additions should be done with `CONCURRENTLY` via raw SQL migration rather than through Prisma's default `ALTER TABLE`.
