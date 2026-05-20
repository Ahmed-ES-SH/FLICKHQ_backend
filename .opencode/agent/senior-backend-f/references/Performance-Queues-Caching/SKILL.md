# Skill: Performance, Queues & Caching

## Trigger

Use when the request mentions **performance, latency, caching, queues, background processing, expensive queries, throughput, or scalability**.

---

## Scope

- Response caching with Redis
- BullMQ background job queues
- Query optimization strategies
- Database connection pooling tuning
- Avoiding blocking the event loop
- Rate limiting
- Pagination for large result sets
- Compression

---

## Caching with Redis

```bash
npm install @nestjs/cache-manager cache-manager @keyv/redis
```

```typescript
// app.module.ts
import { CacheModule } from '@nestjs/cache-manager';
import { createKeyv } from '@keyv/redis';

CacheModule.registerAsync({
  isGlobal: true,
  useFactory: (config: ConfigService) => ({
    stores: [
      createKeyv(config.getOrThrow('REDIS_URL')),
    ],
    ttl: 60_000, // 60 seconds default
  }),
  inject: [ConfigService],
}),
```

### Cache-aside in a Service

```typescript
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';

@Injectable()
export class ProductsService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly repo: ProductsRepository,
  ) {}

  async findById(id: string) {
    const key = `product:${id}`;
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const product = await this.repo.findById(id);
    await this.cache.set(key, product, 300_000); // 5 min TTL
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    const product = await this.repo.update(id, dto);
    await this.cache.del(`product:${id}`); // invalidate on write
    return product;
  }
}
```

### HTTP Response Cache (endpoint-level)

```typescript
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { UseInterceptors } from '@nestjs/common';

@UseInterceptors(CacheInterceptor)
@CacheTTL(120_000) // 2 minutes
@Get('stats')
getStats() {
  return this.analyticsService.computeStats();
}
```

---

## Background Jobs with BullMQ

```bash
npm install @nestjs/bullmq bullmq
```

```typescript
// app.module.ts
import { BullModule } from '@nestjs/bullmq';

BullModule.forRootAsync({
  useFactory: (config: ConfigService) => ({
    connection: { url: config.getOrThrow('REDIS_URL') },
  }),
  inject: [ConfigService],
}),
```

### Queue Module

```typescript
// emails/emails.module.ts
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'emails' }),
  ],
  providers: [EmailsService, EmailsProcessor],
  exports: [EmailsService],
})
export class EmailsModule {}
```

### Producer

```typescript
// emails/emails.service.ts
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class EmailsService {
  constructor(@InjectQueue('emails') private readonly queue: Queue) {}

  async sendWelcomeEmail(userId: string, email: string): Promise<void> {
    await this.queue.add(
      'welcome',
      { userId, email },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
  }
}
```

### Processor (Consumer)

```typescript
// emails/emails.processor.ts
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';

@Processor('emails')
export class EmailsProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailsProcessor.name);

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'welcome':
        await this.sendWelcomeEmail(job.data);
        break;
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
    }
  }

  private async sendWelcomeEmail(data: { userId: string; email: string }): Promise<void> {
    // call mail provider SDK here
    this.logger.log(`Sent welcome email to ${data.email}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(`Job ${job.id} failed: ${err.message}`);
  }
}
```

---

## Rate Limiting

```bash
npm install @nestjs/throttler
```

```typescript
// app.module.ts
ThrottlerModule.forRoot([
  { name: 'short', ttl: 1000,  limit: 5  },  // 5 req/sec
  { name: 'long',  ttl: 60000, limit: 100 }, // 100 req/min
]),
```

```typescript
// app.module.ts providers
{ provide: APP_GUARD, useClass: ThrottlerGuard },
```

Override on specific endpoints:

```typescript
@Throttle({ short: { limit: 2, ttl: 1000 } }) // stricter limit
@Post('login')
login(@Body() dto: LoginDto) { ... }

@SkipThrottle() // no limit (internal endpoint)
@Get('health')
health() { ... }
```

---

## Compression

```bash
npm install compression
```

```typescript
// main.ts
import * as compression from 'compression';
app.use(compression());
```

---

## Query Performance Checklist

```typescript
// ❌ N+1 — one query per order
const orders = await prisma.order.findMany();
for (const o of orders) {
  o.user = await prisma.user.findUnique({ where: { id: o.userId } });
}

// ✅ Single JOIN
const orders = await prisma.order.findMany({
  include: { user: { select: { id: true, email: true } } },
});

// ✅ Select only needed fields
const users = await prisma.user.findMany({
  select: { id: true, email: true, name: true },
  // Omit password, refreshTokenHash, etc.
});

// ✅ Count + data in parallel
const [items, total] = await Promise.all([
  prisma.order.findMany({ skip, take, orderBy }),
  prisma.order.count({ where }),
]);
```

---

## Blocking the Event Loop

```typescript
// ❌ CPU-intensive sync work in request handler
@Get('report')
generateReport() {
  const result = computeHeavyReport(); // blocks all requests
  return result;
}

// ✅ Offload to queue
@Post('report')
async queueReport(@CurrentUser() user: User) {
  await this.reportsQueue.add('generate', { userId: user.id });
  return { message: 'Report queued. You will be notified when ready.' };
}
```

---

## Notes

- **Cache invalidation strategy**: Cache on read, invalidate on write. Use tag-based or key-prefix invalidation for related records.
- **Queue concurrency**: Set `concurrency` on the BullMQ worker based on the job type — I/O-bound jobs can run 10–20 concurrent workers; CPU-bound jobs should match core count.
- **Dead letter queue**: Always configure `removeOnFail` + alert on failure count spikes. Failed jobs should not silently disappear.
- **Avoid over-caching**: Don't cache user-specific or security-sensitive data in shared caches without namespacing by `userId`.
- **Redis as single point of failure**: Use Redis Sentinel or Cluster in production. BullMQ requires Redis — plan for its availability.
