# Skill: API Architecture

## Trigger

Use when the request asks about **REST design, endpoint structure, versioning, pagination, resource naming, module boundaries, or controller/service separation**.

---

## Scope

- RESTful resource naming and HTTP method conventions
- API versioning strategy
- Module boundary decisions (what belongs where)
- Pagination, filtering, sorting patterns
- Idempotency design
- Response shape and serialization
- Error response structure
- Controller/service separation rules
- Global prefix and URI structure

---

## URL Structure

```
/api/v1/{resource}
/api/v1/{resource}/{id}
/api/v1/{resource}/{id}/{sub-resource}
```

```typescript
// main.ts
app.setGlobalPrefix('api');
app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
```

Controllers then declare their version:

```typescript
@Controller({ version: '1', path: 'users' })
export class UsersController {}
// → /api/v1/users
```

---

## HTTP Method Conventions

| Action | Method | URI | Status |
|---|---|---|---|
| List | GET | `/users` | 200 |
| Get one | GET | `/users/:id` | 200 |
| Create | POST | `/users` | 201 |
| Full replace | PUT | `/users/:id` | 200 |
| Partial update | PATCH | `/users/:id` | 200 |
| Delete | DELETE | `/users/:id` | 204 |
| Sub-resource | GET | `/users/:id/orders` | 200 |
| Action (non-CRUD) | POST | `/orders/:id/cancel` | 200 |

Never use GET for state-mutating operations.

---

## Response Shape

### Success

```json
{
  "data": { ... },
  "meta": { "total": 100, "page": 1, "limit": 20 }
}
```

### Error

```json
{
  "statusCode": 422,
  "message": ["email must be an email", "password is too short"],
  "error": "Unprocessable Entity",
  "timestamp": "2025-01-15T10:00:00Z",
  "path": "/api/v1/users"
}
```

### Global Exception Filter

```typescript
// common/filters/http-exception.filter.ts
import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx    = host.switchToHttp();
    const res    = ctx.getResponse<Response>();
    const req    = ctx.getRequest<Request>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException
      ? exception.getResponse()
      : 'Internal server error';

    this.logger.error(exception);

    res.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: req.url,
    });
  }
}
```

Register globally:

```typescript
// main.ts
app.useGlobalFilters(new GlobalExceptionFilter());
```

---

## Pagination

### Query DTO

```typescript
// common/dto/pagination.dto.ts
import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
```

### Service usage

```typescript
async findAll(pagination: PaginationDto) {
  const [items, total] = await Promise.all([
    this.prisma.user.findMany({
      skip: pagination.skip,
      take: pagination.limit,
      orderBy: { createdAt: 'desc' },
    }),
    this.prisma.user.count(),
  ]);

  return {
    data: items,
    meta: {
      total,
      page: pagination.page,
      limit: pagination.limit,
      pages: Math.ceil(total / pagination.limit),
    },
  };
}
```

---

## Filtering and Sorting

```typescript
// common/dto/filter.dto.ts
export class OrderFilterDto extends PaginationDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

  @IsOptional()
  @IsIn(['createdAt', 'total', 'status'])
  sortBy: string = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
```

---

## Response Serialization

Use `ClassSerializerInterceptor` + `@Exclude()` to strip sensitive fields:

```typescript
// user.entity.ts (response shape, not Prisma model)
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class UserResponseDto {
  @Expose() id: string;
  @Expose() email: string;
  @Expose() role: string;
  @Expose() createdAt: Date;
  // password is excluded by default

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}
```

```typescript
// main.ts
app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
```

---

## Module Boundary Rules

| Question | Rule |
|---|---|
| Who owns `User` data? | `UsersModule` — no other module writes to `users` table |
| Can `OrdersModule` read users? | Yes, import `UsersModule` and call `UsersService.findOneOrFail()` |
| Can `AuthModule` import `UsersModule`? | Yes — auth needs to look up users |
| Should `PaymentsModule` know about `OrdersModule`? | Only via an event/queue, not direct import, to avoid tight coupling |
| Shared utilities (pipes, guards, filters)? | `CommonModule` or just register globally in `main.ts` |

---

## Idempotency

For payment and order-creation endpoints, require a client-supplied idempotency key:

```typescript
@Post('charge')
async charge(
  @Headers('Idempotency-Key') idempotencyKey: string,
  @Body() dto: ChargeDto,
) {
  if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header required');
  return this.paymentsService.chargeIdempotent(idempotencyKey, dto);
}
```

Store key + result in DB (or Redis with TTL) and return cached result on duplicate.

---

## Notes

- **Never version by query param** (`?version=1`). URI versioning is the most explicit and cache-friendly.
- **Sub-resources vs. standalone resources**: If a resource only ever exists in context of a parent (`/orders/:id/items`), make it a sub-resource. If it can be accessed independently, give it its own top-level route.
- **404 vs. 403**: Return 404 (not 403) when a resource doesn't exist for the current user — don't reveal existence of records the caller can't access.
- **PATCH vs. PUT**: Default to PATCH for updates. PUT is for full replacement and requires sending every field.
