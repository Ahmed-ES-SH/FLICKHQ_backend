# Skill: Documentation

## Trigger

Use when the request asks for **docs, README, runbooks, handoff notes, API explanations, or developer onboarding text**.

---

## Scope

- Swagger / OpenAPI setup and annotation
- README structure
- Architecture decision records (ADRs)
- Runbooks for common operations
- Developer onboarding guide
- API change documentation
- Environment setup guide

---

## Swagger / OpenAPI Setup

```bash
npm install @nestjs/swagger
```

```typescript
// main.ts
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const config = new DocumentBuilder()
  .setTitle('API')
  .setDescription('Production API documentation')
  .setVersion('1.0')
  .addBearerAuth(
    { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', name: 'Authorization', in: 'header' },
    'access-token',
  )
  .addServer(process.env.API_URL ?? 'http://localhost:3000')
  .build();

const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('api/docs', app, document, {
  swaggerOptions: { persistAuthorization: true },
});
```

Disable Swagger in production if internal only:

```typescript
if (process.env.NODE_ENV !== 'production') {
  SwaggerModule.setup('api/docs', app, document);
}
```

---

## Controller Swagger Annotations

```typescript
@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller({ version: '1', path: 'users' })
export class UsersController {

  @ApiOperation({ summary: 'Create a new user account' })
  @ApiCreatedResponse({ type: UserResponseDto, description: 'User created successfully' })
  @ApiConflictResponse({ description: 'Email already in use' })
  @ApiUnprocessableEntityResponse({ description: 'Validation error' })
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @ApiOperation({ summary: 'Get user by ID' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOneOrFail(id);
  }
}
```

---

## DTO Swagger Annotations

```typescript
export class CreateUserDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Unique email address',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'SecurePass1!',
    minLength: 8,
    description: 'Must contain uppercase, lowercase, and digit',
  })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({
    enum: Role,
    default: Role.USER,
    description: 'User role, defaults to USER',
  })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
```

---

## README Template

```markdown
# Project Name

> One-sentence description of what this service does.

## Stack
- NestJS + TypeScript
- PostgreSQL (Prisma ORM)
- Redis (BullMQ + caching)
- JWT authentication

## Prerequisites
- Node.js >= 20
- Docker + Docker Compose (for local DB/Redis)

## Local Setup

\```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env with your values

# 3. Start dependencies
docker-compose up -d db redis

# 4. Run migrations
npx prisma migrate dev

# 5. Start development server
npm run start:dev
\```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `JWT_ACCESS_SECRET` | ✅ | 64-char random string for access tokens |
| `JWT_REFRESH_SECRET` | ✅ | 64-char random string for refresh tokens |
| `PORT` | ❌ | Server port (default: 3000) |

## API Documentation
Available at `/api/docs` when running locally.

## Testing

\```bash
npm run test           # unit tests
npm run test:e2e       # end-to-end tests
npm run test:cov       # coverage report
\```

## Deployment
See [deployment guide](./docs/deployment.md).
```

---

## Architecture Decision Record (ADR)

```markdown
# ADR-001: Use Prisma instead of TypeORM

## Status
Accepted

## Context
The project requires a reliable ORM with strong TypeScript support,
type-safe queries, and good migration tooling for PostgreSQL.

## Decision
Use Prisma ORM.

## Rationale
- Generated types from schema eliminate runtime type mismatches
- Prisma Migrate provides reviewable SQL migration files
- Better query performance visibility via query events
- Official NestJS recipe with first-class support

## Consequences
- Prisma schema is the single source of truth for DB types
- Team must learn Prisma's query API
- Raw SQL still available for complex queries via `$queryRaw`
```

---

## Runbook: Deploying a Migration

```markdown
## Pre-deploy
1. [ ] Run `npx prisma migrate status` — confirm no pending failed migrations
2. [ ] Back up the production database
3. [ ] Review the migration SQL in `prisma/migrations/*/migration.sql`
4. [ ] Check for locks: long-running transactions on the table being altered?
5. [ ] For large tables: prefer `CREATE INDEX CONCURRENTLY` — see migration guide

## Deploy
1. CI runs `npx prisma migrate deploy` as a pre-step
2. New app version starts
3. Monitor `/api/health` for DB connectivity

## Rollback
1. Prisma does not auto-rollback — use pre-written rollback SQL
2. Location: `prisma/rollbacks/<migration-name>.rollback.sql`
3. Apply: `psql $DATABASE_URL -f prisma/rollbacks/<name>.rollback.sql`
4. Re-deploy previous app version
```

---

## Notes

- **Swagger in production**: Gate behind authentication or disable entirely if the API is internal. Exposed Swagger in production reveals your full API surface to attackers.
- **Keep docs close to code**: `@ApiOperation` on the controller, not in a separate document that drifts. Docs that drift from code are worse than no docs.
- **ADRs for significant decisions**: ORM choice, auth strategy, queue library, caching strategy — these deserve a written record of why, not just what.
- **Runbooks save incidents**: Write the runbook before you need it in a fire drill.
