# Skill: Observability

## Trigger

Use when the request mentions **logs, metrics, tracing, monitoring, health checks, readiness, liveness, or incident visibility**.

---

## Scope

- Structured JSON logging
- Request ID propagation
- Health checks with `@nestjs/terminus`
- Custom health indicators (DB, Redis, queue)
- Log levels and filtering
- Error tracking integration
- Performance logging middleware

---

## Structured Logger

```bash
npm install winston nest-winston
```

```typescript
// logger/logger.module.ts
import { Global, Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';

@Global()
@Module({
  imports: [
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        level: config.get('LOG_LEVEL', 'info'),
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json(),
        ),
        transports: [
          new winston.transports.Console(),
          // Add file/cloud transport in production
        ],
        defaultMeta: {
          service: config.get('SERVICE_NAME', 'api'),
          env: config.get('NODE_ENV', 'development'),
        },
      }),
    }),
  ],
})
export class LoggerModule {}
```

Inject in services:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async charge(dto: ChargeDto) {
    this.logger.info('Processing charge', {
      userId: dto.userId,
      amount: dto.amount,
      currency: dto.currency,
    });
    // ...
  }
}
```

---

## Request ID Propagation

```typescript
// common/middleware/request-id.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    req['requestId'] = req.headers['x-request-id'] ?? randomUUID();
    res.setHeader('X-Request-Id', req['requestId']);
    next();
  }
}
```

```typescript
// common/interceptors/logging.interceptor.ts
import {
  Injectable, NestInterceptor, ExecutionContext,
  CallHandler, Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req     = ctx.switchToHttp().getRequest();
    const { method, url, requestId } = req;
    const now     = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res    = ctx.switchToHttp().getResponse();
          const ms     = Date.now() - now;
          this.logger.log({
            message: `${method} ${url} ${res.statusCode} +${ms}ms`,
            requestId, method, url,
            statusCode: res.statusCode,
            durationMs: ms,
          });
        },
        error: (err) => {
          const ms = Date.now() - now;
          this.logger.error({
            message: `${method} ${url} ERROR +${ms}ms`,
            requestId, method, url,
            error: err.message,
            durationMs: ms,
          });
        },
      }),
    );
  }
}
```

---

## Health Checks with Terminus

```bash
npm install @nestjs/terminus @nestjs/axios
```

```typescript
// health/health.module.ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator],
})
export class HealthModule {}
```

```typescript
// health/prisma.health.ts
import { Injectable } from '@nestjs/common';
import {
  HealthIndicator, HealthIndicatorResult, HealthCheckError,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError(
        'Database check failed',
        this.getStatus(key, false, { error: (err as Error).message }),
      );
    }
  }
}
```

```typescript
// health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health';
import { Public } from '../common/decorators/public.decorator';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: PrismaHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.isHealthy('database'),
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024), // 300 MB
    ]);
  }
}
```

Response on success:

```json
{
  "status": "ok",
  "info": { "database": { "status": "up" }, "memory_heap": { "status": "up" } },
  "error": {},
  "details": { ... }
}
```

---

## Log Levels by Environment

| Level | Use |
|---|---|
| `error` | Unhandled exceptions, service failures |
| `warn` | Recoverable issues, unexpected but handled states |
| `info` | Request lifecycle, job start/complete |
| `debug` | Detailed flow (disable in production) |
| `verbose` | Internal state dumps (dev only) |

```env
# production
LOG_LEVEL=info

# development
LOG_LEVEL=debug
```

---

## Notes

- **Never use `console.log` in production code**. Replace with the injected Logger at bootstrap.
- **Structured JSON is mandatory for machine parsing**. Plain text logs cannot be queried in log aggregators (Datadog, CloudWatch, Loki).
- **Sensitive field masking**: Create a Winston formatter that redacts known sensitive keys (`password`, `token`, `cvv`, `authorization`).
- **Liveness vs. readiness**: Liveness = is the process alive? Readiness = can it serve traffic? Keep the liveness check fast (no DB). Use readiness for DB + Redis checks. Map them to separate Kubernetes probes.
- **Alerting on error rate**: Set an alert if error log rate exceeds threshold (e.g., >5 errors/min in production triggers PagerDuty).
