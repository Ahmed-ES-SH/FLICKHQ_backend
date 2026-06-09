# Skill: Deployment & Operations

## Trigger

Use when the request mentions **deployment, release, environment setup, CI/CD, containers, runtime configuration, or production rollout**.

---

## Scope

- Production environment setup
- Dockerfile and container configuration
- Environment variable management
- Database migration strategy in CI/CD
- Health check and readiness probes
- Node.js LTS requirements
- Zero-downtime deployment patterns
- PM2 / process management

---

## Prerequisites

- Node.js LTS (≥ 20.x)
- PostgreSQL running and reachable
- Redis running (if using queues/caching)
- All required env vars set
- Database migrated (`prisma migrate deploy`)

---

## Dockerfile

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --frozen-lockfile

COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 2: Production image
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "dist/main"]
```

---

## docker-compose (Local / Staging)

```yaml
# docker-compose.yml
version: '3.9'
services:
  api:
    build: .
    ports:
      - '3000:3000'
    environment:
      DATABASE_URL: postgresql://postgres:postgres@db:5432/app
      REDIS_URL: redis://redis:6379
      JWT_ACCESS_SECRET: ${JWT_ACCESS_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

---

## Environment Variables

```env
# --- Required ---
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@host:5432/dbname?schema=public
REDIS_URL=redis://:password@host:6379

JWT_ACCESS_SECRET=<64-char-hex>
JWT_REFRESH_SECRET=<64-char-hex>

# --- Optional ---
LOG_LEVEL=info
SERVICE_NAME=api
ALLOWED_ORIGINS=https://app.yourdomain.com
PAYMENT_GATEWAY_URL=https://api.payment.com
PAYMENT_GATEWAY_KEY=<key>
```

**Production secret management**: Do not store secrets in `.env` files on servers. Use:
- AWS Secrets Manager / Parameter Store
- HashiCorp Vault
- Kubernetes Secrets (encrypted at rest)
- Railway / Render / Fly.io secret injection

---

## CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        options: --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgresql://test:test@localhost:5432/test
      JWT_ACCESS_SECRET: test-access-secret-min-32-chars-xx
      JWT_REFRESH_SECRET: test-refresh-secret-min-32-chars-x
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npx prisma migrate deploy
      - run: npm run test
      - run: npm run test:e2e
      - run: npm run build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build and push Docker image
        run: |
          docker build -t registry/app:${{ github.sha }} .
          docker push registry/app:${{ github.sha }}
      - name: Run migrations
        run: |
          # Run against production DB via migration runner or job
          docker run --env DATABASE_URL=${{ secrets.DATABASE_URL }} \
            registry/app:${{ github.sha }} \
            npx prisma migrate deploy
      - name: Deploy
        run: |
          # Your deployment command (kubectl, fly deploy, railway up, etc.)
```

---

## Database Migration Strategy

```bash
# ✅ Development
npx prisma migrate dev --name describe_change

# ✅ Production (CI/CD only, never manually on server)
npx prisma migrate deploy

# ✅ Check migration state before deploy
npx prisma migrate status

# ✅ Emergency rollback — Prisma doesn't support auto-rollback
# Keep rollback SQL scripts for each migration in /prisma/rollbacks/
```

**Rule**: Migrations run as a pre-deploy step in CI, before the new app version starts. This ensures the new schema is in place before any new code reads or writes it.

---

## Kubernetes Readiness / Liveness Probes

```yaml
livenessProbe:
  httpGet:
    path: /api/health/liveness
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
  failureThreshold: 3
```

```typescript
// health/health.controller.ts
@Public()
@Get('liveness')
liveness() {
  return { status: 'ok' }; // Just process alive check, no DB
}

@Public()
@Get()
@HealthCheck()
readiness() {
  return this.health.check([
    () => this.db.isHealthy('database'),
    () => this.redis.isHealthy('redis'),
  ]);
}
```

---

## Notes

- **Never run `prisma migrate dev` in production**. It can reset or mark migrations dirty.
- **Zero-downtime deploys**: Use rolling updates. Ensure backward-compatible schema changes (add columns before removing old ones, never rename in one step).
- **Startup order**: App should not crash on startup if Redis is briefly unavailable. Use retry logic or lazy connection for non-critical services.
- **Process manager**: For non-container deployments, use PM2 with cluster mode: `pm2 start dist/main.js -i max`.
- **Log rotation**: Ensure Docker/PM2 log rotation is configured to prevent disk exhaustion.
